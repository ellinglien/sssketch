# Discover Combination Slot Kinds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Discover slot target a set of kinds ("drums · warm", "warm · rhythmic"), edited from a picker on the slot's own kind label, and make the "endlesss" checkbox actually govern drums/bass/lead.

**Architecture:** One rule for every set — mask kinds (drums/bass/lead) are OR'd filters, trait kinds (bass-heavy/rhythmic/bright/warm) are AND'd rankings, a mixed set filters then ranks. A slot's `kind` becomes `kinds: DiscoverSlotKind[]`; `DiscoverCandidate.slotKind`/`traitValue` become `slotKinds`/`traitValues`. Pure set logic and the trait-field table live in `src/shared/` (TDD'd); the main process builds the pool; the renderer ranks it (now actually passing trait targets — today's code never did).

**Tech Stack:** TypeScript, Electron main + React renderer, better-sqlite3, vitest.

**Spec:** `docs/superpowers/specs/2026-09-21-discover-combo-slot-kinds-design.md`
**Mockups:** https://claude.ai/artifact/LfyEt7sqU8REva2bfmaMs1 (option B)

---

## Findings that shaped this plan (read first)

1. **Trait ranking was never wired.** `rankCandidates` has a `targetTrait` option, but `DiscoverPanel.tsx`'s `rollForSlot` never passes one — today a "warm" roll is just a random audio-in/unmasked stem ranked by BPM. Task 5 wires it.
2. **A fixed `maxValue` can't normalize `spectralCentroidHz`** (real Hz, no known bound). Task 2 replaces `TraitTarget {direction, maxValue}` with **pool-relative normalization**: each trait is min–max scaled across the candidate pool being ranked. Direction lives in a shared table.
3. **Placement never consumes an ArrangeRole from Discover** (`assembleDiscoverRifff` takes stems + gains only; `discoverSlotKindToArrangeRole` is only used inside the main-process mask pool). The spec's "first instrument kind wins for placement" therefore needs no code — do not add a `discoverSlotKindsToArrangeRole`.
4. **`StemFeatureCache` covers mask-tagged stems too** — `listLibraryScanTargets` (`discoverLibraryStems.ts`) has no instrument filter, so the background scan extracts features for every stem. Mask + trait combos rank by trait wherever the scan has reached; uncached stems score 0 on the trait term.
5. **Keep typecheck green after every task.** Each task below updates *every* caller of what it changes (see memory: plan task split must track cross-file callers). IPC is untyped at runtime, so preload + `index.ts` + renderer call sites for a changed channel move together in one task.

## File map

| File | Change |
|---|---|
| `src/shared/discoverSlotKind.ts` | + `DiscoverTraitKind`, `DISCOVER_SLOT_KIND_LABEL` (moved from DiscoverPanel), `isMaskSlotKind`, `isTraitSlotKind`, `normalizeSlotKinds`, `toggleSlotKind`, `slotKindsLabel`, `slotKindsKey` |
| `src/shared/discoverTraits.ts` (new) | `DISCOVER_TRAIT_FIELD`, `DISCOVER_TRAIT_DIRECTION`, `TraitValues`, `traitValuesFromFeatures`, `stemMatchesSlotKinds` |
| `src/shared/discoverRanking.ts` | `targetTraits` + pool-relative trait scoring; drop `TraitTarget` |
| `src/main/discoverCandidates.ts` | candidate shape; `getDiscoverCandidates({kinds})`; mask union; trait pool no longer excludes tagged/confirmed stems; `attachTraitValues`; `getRandomLibraryCandidate({kinds})` |
| `src/main/discoverAdjacency.ts` | `kinds`; shared trait table + matcher |
| `src/main/index.ts`, `src/preload/index.ts` | IPC args `kind` → `kinds` |
| `src/renderer/src/components/DiscoverKindPicker.tsx` (new) | the chip popover |
| `src/renderer/src/components/DiscoverPanel.tsx` | `slot.kinds`, label button, `changeSlotKinds`, trait targets, greyed mask add-buttons, column width |
| `src/renderer/src/components/DiscoverNearbyPopover.tsx` | `kinds` prop |
| `src/renderer/src/audio/discoverSeed.ts`, `LibraryBrowser.tsx` | `kinds` / `slotKinds` |
| tests | `discoverSlotKind.test.ts`, `discoverTraits.test.ts` (new), `discoverRanking.test.ts`, `discoverCandidates.test.ts`, `discoverSeed.test.ts` |

Commands used throughout (run from repo root):
- single test file: `npx vitest run <path>`
- all tests: `npm test`
- `npm run typecheck`, `npm run lint`

---

### Task 1: Shared kind-set helpers

**Files:**
- Modify: `src/shared/discoverSlotKind.ts`
- Modify: `src/renderer/src/components/DiscoverPanel.tsx:32-45` (delete local label table, import shared one)
- Test: `src/shared/discoverSlotKind.test.ts`

- [ ] **Step 1: Write the failing tests** — append to `src/shared/discoverSlotKind.test.ts` (extend its existing import to include the new names):

```ts
import {
  DISCOVER_SLOT_KIND_LABEL,
  isMaskSlotKind,
  isTraitSlotKind,
  normalizeSlotKinds,
  toggleSlotKind,
  slotKindsLabel,
  slotKindsKey
} from './discoverSlotKind'

describe('isMaskSlotKind / isTraitSlotKind', () => {
  it('splits the 7 kinds into 3 mask + 4 trait', () => {
    expect(['drums', 'bass', 'lead'].every((k) => isMaskSlotKind(k as never))).toBe(true)
    expect(['bassHeavy', 'rhythmic', 'bright', 'warm'].every((k) => isTraitSlotKind(k as never))).toBe(true)
    expect(isMaskSlotKind('warm')).toBe(false)
    expect(isTraitSlotKind('drums')).toBe(false)
  })
})

describe('normalizeSlotKinds', () => {
  it('dedupes and puts mask kinds first, in DISCOVER_SLOT_KIND_OPTIONS order', () => {
    expect(normalizeSlotKinds(['warm', 'drums', 'rhythmic', 'drums'])).toEqual([
      'drums',
      'rhythmic',
      'warm'
    ])
  })

  it('keeps whichever of bright/warm comes first in the input, never both', () => {
    expect(normalizeSlotKinds(['warm', 'bright'])).toEqual(['warm'])
    expect(normalizeSlotKinds(['bright', 'warm'])).toEqual(['bright'])
  })

  it('returns [] for []', () => {
    expect(normalizeSlotKinds([])).toEqual([])
  })
})

describe('toggleSlotKind', () => {
  it('adds a kind that is off', () => {
    expect(toggleSlotKind(['drums'], 'warm')).toEqual(['drums', 'warm'])
  })

  it('removes a kind that is on', () => {
    expect(toggleSlotKind(['drums', 'warm'], 'drums')).toEqual(['warm'])
  })

  it('never removes the last remaining kind', () => {
    expect(toggleSlotKind(['warm'], 'warm')).toEqual(['warm'])
  })

  it('turning bright on turns warm off, and vice versa', () => {
    expect(toggleSlotKind(['drums', 'warm'], 'bright')).toEqual(['drums', 'bright'])
    expect(toggleSlotKind(['bright'], 'warm')).toEqual(['warm'])
  })
})

describe('slotKindsLabel / slotKindsKey', () => {
  it('joins display labels with a middle dot, canonical order', () => {
    expect(slotKindsLabel(['warm', 'bassHeavy', 'drums'])).toBe('drums · bass-heavy · warm')
  })

  it('key is order-independent', () => {
    expect(slotKindsKey(['warm', 'drums'])).toBe(slotKindsKey(['drums', 'warm']))
    expect(slotKindsKey(['warm', 'drums'])).toBe('drums+warm')
  })

  it('DISCOVER_SLOT_KIND_LABEL hyphenates the camelCase kind', () => {
    expect(DISCOVER_SLOT_KIND_LABEL.bassHeavy).toBe('bass-heavy')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/shared/discoverSlotKind.test.ts`
Expected: FAIL — the new exports don't exist.

- [ ] **Step 3: Implement** — append to `src/shared/discoverSlotKind.ts`:

```ts
export type DiscoverTraitKind = 'bassHeavy' | 'rhythmic' | 'bright' | 'warm'

/** Display text per kind -- the literal value except for the camelCase
 * trait kind. Moved here from DiscoverPanel.tsx so slotKindsLabel (and the
 * kind picker) share one table. */
export const DISCOVER_SLOT_KIND_LABEL: Record<DiscoverSlotKind, string> = {
  drums: 'drums',
  bass: 'bass',
  lead: 'lead',
  bassHeavy: 'bass-heavy',
  rhythmic: 'rhythmic',
  bright: 'bright',
  warm: 'warm'
}

export function isMaskSlotKind(kind: DiscoverSlotKind): boolean {
  return DISCOVER_MASK_SLOT_KINDS.includes(kind)
}

export function isTraitSlotKind(kind: DiscoverSlotKind): kind is DiscoverTraitKind {
  return DISCOVER_TRAIT_SLOT_KINDS.includes(kind)
}

// bright and warm are opposite ends of ONE field (spectralCentroidHz) --
// both in one set would cancel out, so a set holds at most one of them.
const OPPOSITE_KIND: Partial<Record<DiscoverSlotKind, DiscoverSlotKind>> = {
  bright: 'warm',
  warm: 'bright'
}

/** Combination slots (docs/superpowers/specs/2026-09-21-discover-combo-
 * slot-kinds-design.md): dedupes, drops the later of bright/warm if both
 * appear, and returns canonical order (DISCOVER_SLOT_KIND_OPTIONS -- mask
 * kinds first). Every stored/transmitted kind set goes through this so
 * {warm, drums} and {drums, warm} are the same slot. */
export function normalizeSlotKinds(kinds: readonly DiscoverSlotKind[]): DiscoverSlotKind[] {
  const kept = new Set<DiscoverSlotKind>()
  for (const kind of kinds) {
    const opposite = OPPOSITE_KIND[kind]
    if (opposite && kept.has(opposite)) continue
    kept.add(kind)
  }
  return DISCOVER_SLOT_KIND_OPTIONS.filter((k) => kept.has(k))
}

/** One chip click in the kind picker. Turning a kind on also turns its
 * bright/warm opposite off; turning off the LAST kind is a no-op (a slot
 * always targets at least one kind). */
export function toggleSlotKind(
  kinds: readonly DiscoverSlotKind[],
  kind: DiscoverSlotKind
): DiscoverSlotKind[] {
  if (kinds.includes(kind)) {
    if (kinds.length === 1) return normalizeSlotKinds(kinds)
    return normalizeSlotKinds(kinds.filter((k) => k !== kind))
  }
  const opposite = OPPOSITE_KIND[kind]
  return normalizeSlotKinds([...kinds.filter((k) => k !== opposite), kind])
}

export function slotKindsLabel(kinds: readonly DiscoverSlotKind[]): string {
  return normalizeSlotKinds(kinds)
    .map((k) => DISCOVER_SLOT_KIND_LABEL[k])
    .join(' · ')
}

/** Stable string identity for a kind set -- cache/result keys and effect
 * deps (an array prop is a new object every render). */
export function slotKindsKey(kinds: readonly DiscoverSlotKind[]): string {
  return normalizeSlotKinds(kinds).join('+')
}
```

In `src/renderer/src/components/DiscoverPanel.tsx`, delete the local `DISCOVER_SLOT_KIND_LABEL` constant and its comment (lines ~32-45) and extend the existing import on line 9:

```ts
import {
  DISCOVER_SLOT_KIND_LABEL,
  DISCOVER_SLOT_KIND_OPTIONS,
  type DiscoverSlotKind
} from '@shared/discoverSlotKind'
```

- [ ] **Step 4: Verify**

Run: `npx vitest run src/shared/discoverSlotKind.test.ts && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/shared/discoverSlotKind.ts src/shared/discoverSlotKind.test.ts src/renderer/src/components/DiscoverPanel.tsx
git commit -m "Discover: shared kind-set helpers for combination slots"
```

---

### Task 2: Shared trait table + multi-trait ranking + candidate shape

This task changes `DiscoverCandidate` (`slotKind` → `slotKinds`, `traitValue` → `traitValues`) and `rankCandidates` together, because the ranker is the main consumer of `traitValue`. No behaviour change for rolls yet (nothing passes `targetTraits` until Task 5).

**Files:**
- Create: `src/shared/discoverTraits.ts`, `src/shared/discoverTraits.test.ts`
- Modify: `src/shared/discoverRanking.ts`, `src/shared/discoverRanking.test.ts`
- Modify: `src/main/discoverCandidates.ts` (interface + 4 construction sites + `TRAIT_FIELD`)
- Modify: `src/main/discoverAdjacency.ts` (construction site + `TRAIT_FIELD`)
- Modify: `src/renderer/src/components/DiscoverPanel.tsx:~2932`, `src/renderer/src/components/LibraryBrowser.tsx:~1360`, `src/renderer/src/audio/discoverSeed.ts:~112`
- Modify tests: `src/main/discoverCandidates.test.ts`, `src/renderer/src/audio/discoverSeed.test.ts`

- [ ] **Step 1: Write failing tests for the trait table** — create `src/shared/discoverTraits.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { traitValuesFromFeatures, stemMatchesSlotKinds } from './discoverTraits'
import type { StemFeatures } from './stemFeatures'

function features(overrides: Partial<StemFeatures> = {}): StemFeatures {
  return {
    transientDensity: 0.4,
    bassEnergyRatio: 0.7,
    spectralCentroidHz: 1200,
    zcrBrightness: 0.3,
    voicedFraction: 0,
    pitchVarianceCents: 0,
    mfcc: new Array(13).fill(0),
    ...overrides
  }
}

describe('traitValuesFromFeatures', () => {
  it('reads each requested trait kind from its own field', () => {
    expect(traitValuesFromFeatures(features(), ['bassHeavy', 'rhythmic', 'warm'])).toEqual({
      bassHeavy: 0.7,
      rhythmic: 0.4,
      warm: 1200
    })
  })

  it('bright and warm read the same field', () => {
    const v = traitValuesFromFeatures(features(), ['bright'])
    expect(v.bright).toBe(1200)
  })

  it('a non-finite field value becomes null, not NaN', () => {
    expect(
      traitValuesFromFeatures(features({ spectralCentroidHz: Number.NaN }), ['warm'])
    ).toEqual({ warm: null })
  })

  it('returns {} for no kinds', () => {
    expect(traitValuesFromFeatures(features(), [])).toEqual({})
  })
})

describe('stemMatchesSlotKinds', () => {
  const both = { endlesss: true, audioIn: true }
  const DRUM = 1 << 1
  const BASS = 1 << 3
  const MIC = 1 << 4

  it('mask kinds OR together', () => {
    expect(stemMatchesSlotKinds(DRUM, ['drums', 'bass'], both)).toBe(true)
    expect(stemMatchesSlotKinds(BASS, ['drums', 'bass'], both)).toBe(true)
    expect(stemMatchesSlotKinds(MIC, ['drums', 'bass'], both)).toBe(false)
  })

  it('a mask kind in the set means nothing matches while endlesss is off', () => {
    expect(stemMatchesSlotKinds(DRUM, ['drums'], { endlesss: false, audioIn: true })).toBe(false)
  })

  it('trait-only sets accept any stem the sound-source filter allows, tagged or not', () => {
    expect(stemMatchesSlotKinds(DRUM, ['warm'], both)).toBe(true)
    expect(stemMatchesSlotKinds(null, ['warm'], both)).toBe(true)
    expect(stemMatchesSlotKinds(MIC, ['warm'], { endlesss: true, audioIn: false })).toBe(false)
  })

  it('mixed sets filter by the mask kinds only', () => {
    expect(stemMatchesSlotKinds(DRUM, ['drums', 'warm'], both)).toBe(true)
    expect(stemMatchesSlotKinds(null, ['drums', 'warm'], both)).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/shared/discoverTraits.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — create `src/shared/discoverTraits.ts`:

```ts
// src/shared/discoverTraits.ts
import {
  instrumentMaskToSoundType,
  soundSourceMatchesFilter,
  type DiscoverSoundSourceFilter
} from './riffLibraryTypes'
import type { StemFeatures } from './stemFeatures'
import {
  isMaskSlotKind,
  normalizeSlotKinds,
  type DiscoverSlotKind,
  type DiscoverTraitKind
} from './discoverSlotKind'

/** Which StemFeatures field each trait kind reads -- the ONE copy, shared
 * by discoverCandidates.ts and discoverAdjacency.ts (each used to keep its
 * own duplicate). bright/warm share spectralCentroidHz as opposite ends. */
export const DISCOVER_TRAIT_FIELD: Record<
  DiscoverTraitKind,
  'bassEnergyRatio' | 'transientDensity' | 'spectralCentroidHz'
> = {
  bassHeavy: 'bassEnergyRatio',
  rhythmic: 'transientDensity',
  bright: 'spectralCentroidHz',
  warm: 'spectralCentroidHz'
}

/** Which end of its field a trait kind wants -- rankCandidates scores
 * closeness to this end of the POOL's own range. */
export const DISCOVER_TRAIT_DIRECTION: Record<DiscoverTraitKind, 'high' | 'low'> = {
  bassHeavy: 'high',
  rhythmic: 'high',
  bright: 'high',
  warm: 'low'
}

/** Raw field value per requested trait kind (null = unknown). Only the
 * requested kinds are present. */
export type TraitValues = Partial<Record<DiscoverTraitKind, number | null>>

export function traitValuesFromFeatures(
  features: StemFeatures,
  kinds: readonly DiscoverTraitKind[]
): TraitValues {
  const out: TraitValues = {}
  for (const kind of kinds) {
    const value = features[DISCOVER_TRAIT_FIELD[kind]]
    out[kind] = typeof value === 'number' && Number.isFinite(value) ? value : null
  }
  return out
}

/** The combination-slot pool rule, for one stem: any mask kinds in the set
 * are an OR filter on the Endlesss instrument mask (and match nothing while
 * the "endlesss" source is off -- they are Endlesss content by definition);
 * a trait-only set accepts any stem the sound-source filter allows, tagged
 * or not. Trait kinds never filter -- they only rank. */
export function stemMatchesSlotKinds(
  instrumentMask: number | null | undefined,
  kinds: readonly DiscoverSlotKind[],
  soundSource: DiscoverSoundSourceFilter
): boolean {
  const maskKinds = normalizeSlotKinds(kinds).filter(isMaskSlotKind)
  if (maskKinds.length > 0) {
    if (!soundSource.endlesss) return false
    const soundType =
      instrumentMask === null || instrumentMask === undefined
        ? null
        : instrumentMaskToSoundType(instrumentMask)
    return maskKinds.some(
      (k) =>
        (k === 'drums' && soundType === 'drums') ||
        (k === 'bass' && soundType === 'bass') ||
        (k === 'lead' && soundType === 'notes')
    )
  }
  return soundSourceMatchesFilter(instrumentMask, soundSource)
}
```

- [ ] **Step 4: Run** `npx vitest run src/shared/discoverTraits.test.ts` — Expected: PASS.

- [ ] **Step 5: Rewrite the ranking tests** — in `src/shared/discoverRanking.test.ts`, change the fixture's two fields and replace the whole `describe('rankCandidates (trait scoring)', ...)` block:

```ts
// fixture: replace `slotKind: 'drums', traitValue: null,` with
    slotKinds: ['drums'],
    traitValues: {},
    riffCreationTime: null,
```

```ts
describe('rankCandidates (trait scoring)', () => {
  it('ranks the candidate at the "high" end of the pool first', () => {
    const high = candidate({ stemCID: 'high', traitValues: { bassHeavy: 0.9 } })
    const low = candidate({ stemCID: 'low', traitValues: { bassHeavy: 0.1 } })
    const ranked = rankCandidates([low, high], { targetBpm: 128, targetTraits: ['bassHeavy'] })
    expect(ranked[0].candidate.stemCID).toBe('high')
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score)
  })

  it('warm ("low" direction) ranks the smallest centroid first, in real Hz', () => {
    const warm = candidate({ stemCID: 'warm', traitValues: { warm: 300 } })
    const bright = candidate({ stemCID: 'bright', traitValues: { warm: 4200 } })
    const ranked = rankCandidates([bright, warm], { targetBpm: 128, targetTraits: ['warm'] })
    expect(ranked[0].candidate.stemCID).toBe('warm')
  })

  it('sums scores across traits -- good at both beats great at one', () => {
    const both = candidate({ stemCID: 'both', traitValues: { warm: 300, rhythmic: 0.9 } })
    const onlyWarm = candidate({ stemCID: 'onlyWarm', traitValues: { warm: 300, rhythmic: 0.1 } })
    const onlyRhythm = candidate({
      stemCID: 'onlyRhythm',
      traitValues: { warm: 4000, rhythmic: 0.9 }
    })
    const ranked = rankCandidates([onlyWarm, onlyRhythm, both], {
      targetBpm: 128,
      targetTraits: ['warm', 'rhythmic']
    })
    expect(ranked[0].candidate.stemCID).toBe('both')
  })

  it('a null/missing trait value never outranks a real one', () => {
    const top = candidate({ stemCID: 'top', traitValues: { bright: 0.8 } })
    const bottom = candidate({ stemCID: 'bottom', traitValues: { bright: 0.2 } })
    const unknown = candidate({ stemCID: 'unknown', traitValues: {} })
    const ranked = rankCandidates([unknown, bottom, top], {
      targetBpm: 128,
      targetTraits: ['bright']
    })
    expect(ranked[0].candidate.stemCID).toBe('top')
    expect(ranked[ranked.length - 1].score).toBeLessThanOrEqual(ranked[1].score)
  })

  it('a trait with no spread across the pool adds nothing', () => {
    const a = candidate({ stemCID: 'a', traitValues: { rhythmic: 0.5 } })
    const b = candidate({ stemCID: 'b', traitValues: { rhythmic: 0.5 } })
    const ranked = rankCandidates([a, b], { targetBpm: 128, targetTraits: ['rhythmic'] })
    expect(ranked[0].score).toBeCloseTo(ranked[1].score, 5)
  })

  it('omitting targetTraits ranks purely by BPM', () => {
    const close = candidate({ stemCID: 'close', riffBpm: 128, traitValues: { bright: 0.01 } })
    const far = candidate({ stemCID: 'far', riffBpm: 90, traitValues: { bright: 0.99 } })
    const ranked = rankCandidates([far, close], { targetBpm: 128 })
    expect(ranked[0].candidate.stemCID).toBe('close')
  })
})
```

- [ ] **Step 6: Run to verify failure**

Run: `npx vitest run src/shared/discoverRanking.test.ts`
Expected: FAIL — `targetTraits` not supported / `traitValues` not read.

- [ ] **Step 7: Implement ranking** — in `src/shared/discoverRanking.ts`: delete `TraitTarget` and the old `traitScore`; add the import and replace `rankCandidates`:

```ts
import { DISCOVER_TRAIT_DIRECTION } from './discoverTraits'
import type { DiscoverTraitKind } from './discoverSlotKind'
```

```ts
/** Pool-relative closeness for one trait: min-max scaled across the pool
 * being ranked (a fixed max can't normalize spectralCentroidHz, which is
 * raw Hz), then flipped for 'low'. A null value, or a trait with no spread
 * across the pool (range undefined), scores 0 -- never NaN, never a win. */
function traitScore(
  value: number | null | undefined,
  direction: 'high' | 'low',
  range: { min: number; max: number } | undefined
): number {
  if (value === null || value === undefined || !range) return 0
  const normalized = (value - range.min) / (range.max - range.min)
  return direction === 'high' ? normalized : 1 - normalized
}

/** Scores every candidate by BPM closeness, plus an optional favourites
 * boost, plus one pool-relative score per requested trait kind, summed
 * (combination slots: trait kinds AND together). Descending score order.
 * Never throws; an empty input returns an empty ranking. */
export function rankCandidates(
  candidates: DiscoverCandidate[],
  {
    targetBpm,
    favouriteStemCIDs,
    targetTraits = []
  }: {
    targetBpm: number
    favouriteStemCIDs?: Set<string>
    targetTraits?: readonly DiscoverTraitKind[]
  }
): RankedCandidate[] {
  const ranges = new Map<DiscoverTraitKind, { min: number; max: number }>()
  for (const kind of targetTraits) {
    let min = Infinity
    let max = -Infinity
    for (const c of candidates) {
      const v = c.traitValues[kind]
      if (v === null || v === undefined) continue
      if (v < min) min = v
      if (v > max) max = v
    }
    if (max > min) ranges.set(kind, { min, max })
  }

  return candidates
    .map((candidate) => {
      const bpmDistance = Math.abs(candidate.riffBpm - targetBpm)
      let score = Math.max(0, 1 - bpmDistance / BPM_FALLOFF)
      if (favouriteStemCIDs?.has(candidate.stemCID)) score += FAVOURITE_BOOST
      for (const kind of targetTraits) {
        score +=
          traitScore(candidate.traitValues[kind], DISCOVER_TRAIT_DIRECTION[kind], ranges.get(kind)) *
          TRAIT_SCORE_WEIGHT
      }
      return { candidate, score }
    })
    .sort((a, b) => b.score - a.score)
}
```

Keep `TRAIT_SCORE_WEIGHT`'s comment but change "trait-kind candidate's own BPM score" wording to say it applies per requested trait.

- [ ] **Step 8: Change the candidate shape** — in `src/main/discoverCandidates.ts`, in `interface DiscoverCandidate`, replace the `slotKind` and `traitValue` fields with:

```ts
  /** The slot's own normalized kind set this candidate was drawn for
   * (normalizeSlotKinds) -- combination slots, 2026-09-21. */
  slotKinds: DiscoverSlotKind[]
  /** Raw StemFeatureCache field value per requested TRAIT kind, for
   * rankCandidates' trait terms. {} when the slot has no trait kinds or the
   * stem has no cached features. */
  traitValues: TraitValues
```

Add imports: `import { DISCOVER_TRAIT_FIELD, type TraitValues } from '@shared/discoverTraits'` and `type DiscoverTraitKind` from `@shared/discoverSlotKind`. Delete the local `TRAIT_FIELD` table and use `DISCOVER_TRAIT_FIELD[kind as DiscoverTraitKind]` where `TRAIT_FIELD[...]` was read. Then fix the 4 construction sites (typecheck will list them):
- mask path (`out.push({...})`): `slotKinds: [kind], traitValues: {},`
- trait path (`result.push({...})`): `slotKinds: [kind], traitValues: { [kind as DiscoverTraitKind]: entry.featureValue },`
- `getRandomLibraryCandidate` and `getRandomOwnStemCandidate` return objects: `slotKinds: [kind], traitValues: {},`

In `src/main/discoverAdjacency.ts`: delete its local `TRAIT_FIELD`, import `DISCOVER_TRAIT_FIELD` from `@shared/discoverTraits` and `type DiscoverTraitKind` from `@shared/discoverSlotKind`, read `features[DISCOVER_TRAIT_FIELD[kind as DiscoverTraitKind]]`, and in the returned object replace `slotKind: kind, ... traitValue,` with:

```ts
        slotKinds: [kind],
        traitValues: isTraitKind ? { [kind as DiscoverTraitKind]: traitValue } : {},
```

Renderer sites:
- `DiscoverPanel.tsx` seed-lookup anchor (~line 2932): `slotKinds: [slot.kind], traitValues: {},`
- `LibraryBrowser.tsx` (~line 1360): `slotKinds: [discoverSlotKindForSoundType(...same expression...)],` and `traitValues: {},`
- `discoverSeed.ts` `buildSeedSlotsFromCandidates`: `kind: candidate.slotKinds[0],` (Task 5 makes it `kinds`).

Tests:
- `src/main/discoverCandidates.test.ts`: `slotKind: 'drums'` → `slotKinds: ['drums']` (3 places: ~228, ~597, ~1057); in the bassHeavy test (~1177) replace the two expectations with
  `expect(high.traitValues.bassHeavy).toBeCloseTo(0.9)` and `expect(high.slotKinds).toEqual(['bassHeavy'])`.
- `src/renderer/src/audio/discoverSeed.test.ts`: fixture `slotKind: 'drums', traitValue: null` → `slotKinds: ['drums'], traitValues: {}`; overrides `slotKind: 'drums'` / `'bass'` → `slotKinds: ['drums']` / `['bass']`.

- [ ] **Step 9: Verify**

Run: `npm test && npm run typecheck`
Expected: all PASS, no type errors.

- [ ] **Step 10: Commit**

```bash
git add src/shared src/main/discoverCandidates.ts src/main/discoverCandidates.test.ts src/main/discoverAdjacency.ts src/renderer/src/components/DiscoverPanel.tsx src/renderer/src/components/LibraryBrowser.tsx src/renderer/src/audio/discoverSeed.ts src/renderer/src/audio/discoverSeed.test.ts
git commit -m "Discover: candidate slotKinds/traitValues, pool-relative multi-trait ranking"
```

---

### Task 3: Main pool takes a kind set

**Files:**
- Modify: `src/main/discoverCandidates.ts` (`getDiscoverCandidates`, trait pool, new `attachTraitValues`, `getRandomLibraryCandidate`, `getRandomOwnStemCandidate`)
- Modify: `src/main/index.ts` (`get-discover-candidates`, `get-random-discover-candidate` handlers)
- Modify: `src/preload/index.ts` (`getDiscoverCandidates`, `getRandomDiscoverCandidate`)
- Modify: `src/renderer/src/components/DiscoverPanel.tsx` (the two call sites pass `[kind]`)
- Test: `src/main/discoverCandidates.test.ts`

- [ ] **Step 1: Mechanically convert existing test calls**

```bash
perl -pi -e "s/\bkind: '(\w+)'/kinds: ['\$1']/g" src/main/discoverCandidates.test.ts
grep -n "\bkind:" src/main/discoverCandidates.test.ts
```
Expected: the grep prints nothing (`slotKinds:` is unaffected — `\bkind` doesn't match inside `slotKinds`).

- [ ] **Step 2: Update tests whose expectations change by design** (spec: trait-only pools include tagged and role-confirmed stems):
- `'returns bassHeavy candidates ranked by bassEnergyRatio, excluding drums/bass/notes-masked stems'` → rename to `'trait-only pool includes mask-tagged stems too'` and expect `['high', 'low', 'masked-out']` (sorted).
- `'excludes a stem already confirmed (StemCategories) for ANY role, even with no reliable mask signal'` → rename to `'trait-only pool includes a stem confirmed for some role'` and expect `['confirmed-elsewhere']` via `candidates.map((c) => c.stemCID)`.

- [ ] **Step 3: Add the new tests** — append a new block:

```ts
describe('getDiscoverCandidates (kind sets)', () => {
  const DRUM = 1 << 1
  const BASS = 1 << 3

  it('mask kinds OR together, deduped', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['d', 'b', 'n'])
    seedStem(own, 'd', 'jam1', { instrument: DRUM })
    seedStem(own, 'b', 'jam1', { instrument: BASS })
    seedStem(own, 'n', 'jam1', { instrument: 1 << 2 })

    const candidates = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      kinds: ['bass', 'drums']
    })
    expect(candidates.map((c) => c.stemCID).sort()).toEqual(['b', 'd'])
    expect(candidates.every((c) => c.slotKinds.join('+') === 'drums+bass')).toBe(true)
  })

  it('mask kinds return nothing while the endlesss source is off', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['d'])
    seedStem(own, 'd', 'jam1', { instrument: DRUM })

    expect(
      await getDiscoverCandidates({
        ownDb: own,
        jams: [{ jamCID: 'jam1', dbForJam: own }],
        kinds: ['drums'],
        soundSource: { endlesss: false, audioIn: true }
      })
    ).toEqual([])
  })

  it('mask + trait: filters by mask, attaches trait values from StemFeatureCache', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['cached', 'uncached', 'mic'])
    seedStem(own, 'cached', 'jam1', { instrument: DRUM })
    seedFeatures(own, 'cached', featuresJSON({ spectralCentroidHz: 400 }))
    seedStem(own, 'uncached', 'jam1', { instrument: DRUM })
    seedStem(own, 'mic', 'jam1', { instrument: 1 << 4 })
    seedFeatures(own, 'mic', featuresJSON({ spectralCentroidHz: 100 }))

    const candidates = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      kinds: ['warm', 'drums']
    })
    expect(candidates.map((c) => c.stemCID).sort()).toEqual(['cached', 'uncached'])
    expect(candidates.find((c) => c.stemCID === 'cached')!.traitValues).toEqual({ warm: 400 })
    expect(candidates.find((c) => c.stemCID === 'uncached')!.traitValues).toEqual({})
  })

  it('trait-only: every requested trait value is attached', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['s1'])
    seedStem(own, 's1', 'jam1')
    seedFeatures(own, 's1', featuresJSON({ transientDensity: 0.6, spectralCentroidHz: 900 }))

    const [c] = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      kinds: ['rhythmic', 'warm']
    })
    expect(c.traitValues).toEqual({ rhythmic: 0.6, warm: 900 })
    expect(c.slotKinds).toEqual(['rhythmic', 'warm'])
  })

  it('an empty kind set returns []', async () => {
    const own = freshDb()
    expect(
      await getDiscoverCandidates({
        ownDb: own,
        jams: [{ jamCID: 'jam1', dbForJam: own }],
        kinds: []
      })
    ).toEqual([])
  })
})
```

- [ ] **Step 4: Run to verify failure**

Run: `npx vitest run src/main/discoverCandidates.test.ts`
Expected: FAIL (`kinds` not a known option; type errors surface at runtime as wrong results).

- [ ] **Step 5: Implement** in `src/main/discoverCandidates.ts`:

(a) Rename the current `getDiscoverCandidates` to a private `getMaskDiscoverCandidates` with params `{ ownDb, jams, kind, onlyOwnStems, targetUser }` (drop `soundSource`), and delete its leading `if (DISCOVER_TRAIT_SLOT_KINDS.includes(kind)) { return getTraitDiscoverCandidates(...) }` branch. Everything after that branch stays verbatim. Keep its long doc comments.

(b) Add the new public entry point above it:

```ts
/** Combination slots (docs/superpowers/specs/2026-09-21-discover-combo-
 * slot-kinds-design.md) -- ONE rule for every kind set: mask kinds
 * (drums/bass/lead) OR together as a filter on Endlesss's own instrument
 * mask, and yield nothing while the "endlesss" source is off (they are
 * Endlesss content by definition -- this is the fix for "unticked endlesss,
 * still got Endlesss drums"); a trait-only set draws from every stem with
 * cached features (tagged or not) and the sound-source filter. Trait kinds
 * never filter -- they only attach traitValues for rankCandidates to rank
 * by, in the renderer. */
export async function getDiscoverCandidates({
  ownDb,
  jams,
  kinds,
  onlyOwnStems = false,
  targetUser,
  soundSource = { endlesss: true, audioIn: true }
}: {
  ownDb: Database.Database
  jams: JamDbPair[]
  kinds: readonly DiscoverSlotKind[]
  onlyOwnStems?: boolean
  targetUser?: string
  soundSource?: DiscoverSoundSourceFilter
}): Promise<DiscoverCandidate[]> {
  const normalized = normalizeSlotKinds(kinds)
  const maskKinds = normalized.filter(isMaskSlotKind)
  const traitKinds = normalized.filter(isTraitSlotKind)

  if (maskKinds.length === 0) {
    if (traitKinds.length === 0) return []
    const pool = await getTraitPoolCandidates({
      ownDb,
      jams,
      traitKinds,
      onlyOwnStems,
      targetUser,
      soundSource
    })
    return pool.map((c) => ({ ...c, slotKinds: normalized }))
  }

  if (!soundSource.endlesss) return []
  const seen = new Set<string>()
  const pool: DiscoverCandidate[] = []
  for (const kind of maskKinds) {
    const perKind = await getMaskDiscoverCandidates({ ownDb, jams, kind, onlyOwnStems, targetUser })
    for (const candidate of perKind) {
      if (seen.has(candidate.stemCID)) continue
      seen.add(candidate.stemCID)
      pool.push({ ...candidate, slotKinds: normalized })
    }
  }
  return traitKinds.length > 0 ? attachTraitValues(ownDb, pool, traitKinds) : pool
}

/** Mask + trait sets: looks up each pooled stem's cached features (ownDb's
 * StemFeatureCache, primary-key lookups, chunked like every other IN query
 * in this file) and attaches the requested trait values. A stem with no
 * cached row (or a malformed one) keeps traitValues {} -- it stays
 * eligible and simply scores 0 on the trait terms. */
function attachTraitValues(
  ownDb: Database.Database,
  pool: DiscoverCandidate[],
  traitKinds: readonly DiscoverTraitKind[]
): DiscoverCandidate[] {
  const featuresByStemCID = new Map<string, StemFeatures>()
  for (const cidChunk of chunk(
    pool.map((c) => c.stemCID),
    CANDIDATE_QUERY_CHUNK_SIZE
  )) {
    const placeholders = cidChunk.map(() => '?').join(', ')
    let rows: FeatureCandidateRow[]
    try {
      rows = ownDb
        .prepare(
          `SELECT StemCID, FeaturesJSON FROM StemFeatureCache WHERE StemCID IN (${placeholders})`
        )
        .all(...cidChunk) as FeatureCandidateRow[]
    } catch {
      continue
    }
    for (const row of rows) {
      try {
        featuresByStemCID.set(row.StemCID, JSON.parse(row.FeaturesJSON) as StemFeatures)
      } catch {
        // malformed row -- this stem just gets no trait values
      }
    }
  }
  return pool.map((c) => {
    const features = featuresByStemCID.get(c.stemCID)
    return features ? { ...c, traitValues: traitValuesFromFeatures(features, traitKinds) } : c
  })
}
```

Imports to add/adjust at the top: from `@shared/discoverSlotKind` import `isMaskSlotKind, isTraitSlotKind, normalizeSlotKinds, type DiscoverTraitKind` (drop `DISCOVER_TRAIT_SLOT_KINDS` if now unused); from `@shared/discoverTraits` add `traitValuesFromFeatures`. `FeatureCandidateRow` and `StemFeatures` are already in scope.

(c) Rename `getTraitDiscoverCandidates` → `getTraitPoolCandidates`, param `kind: DiscoverSlotKind` → `traitKinds: readonly DiscoverTraitKind[]`, and inside it:
- delete `const field = ...`;
- delete the whole `confirmedAnyRole` block (the comment + `const confirmedAnyRole = new Set(...)`) and the `if (confirmedAnyRole.has(row.StemCID)) break` line;
- delete the mask-exclusion lines (`const instrument ... if (soundType === 'drums' || ...) break` — keep `const instrument = instrumentByStemCID.get(row.StemCID)` since the sound-source check below uses it);
- `TraitMatchedStem.featureValue: number` → `traitValues: TraitValues`, and push `{ stemCID: row.StemCID, jamCID, traitValues: traitValuesFromFeatures(features, traitKinds) }`;
- in `result.push({...})`: `slotKinds: [...traitKinds], traitValues: entry.traitValues,`.
Replace its doc comment's first paragraph with: "Candidate pool for a TRAIT-ONLY kind set -- any stem with a cached StemFeatureCache row (tagged or not, since combination slots, 2026-09-21), narrowed by the sound-source filter. Trait values for every requested kind are attached from the same parse." Keep the remaining paragraphs (bounded random-offset scan rationale).

(d) `getRandomLibraryCandidate`: param `kind: DiscoverSlotKind` → `kinds: readonly DiscoverSlotKind[]`; pass `kinds` to `getRandomOwnStemCandidate(jams, kinds, targetUser)`; in both returned objects `slotKinds: normalizeSlotKinds(kinds),`. Update `getRandomOwnStemCandidate`'s own `kind` param the same way.

(e) `src/main/index.ts` `get-discover-candidates` handler: param `kind: DiscoverSlotKind` → `kinds: DiscoverSlotKind[]`, pass `kinds`, and replace `${kind}` in its two log lines with `${kinds.join('+')}`. `get-random-discover-candidate` handler: same param rename, pass `kinds`.

(f) `src/preload/index.ts`:

```ts
  getDiscoverCandidates: (
    kinds: DiscoverSlotKind[],
    onlyOwnStems: boolean,
    targetUser?: string,
    soundSource?: DiscoverSoundSourceFilter
  ): Promise<DiscoverCandidate[]> =>
    ipcRenderer.invoke('get-discover-candidates', kinds, onlyOwnStems, targetUser, soundSource),
  getRandomDiscoverCandidate: (
    kinds: DiscoverSlotKind[],
    onlyOwnStems: boolean,
    targetUser?: string
  ): Promise<DiscoverCandidate | null> =>
    ipcRenderer.invoke('get-random-discover-candidate', kinds, onlyOwnStems, targetUser),
```

(g) `DiscoverPanel.tsx`: in `rollForSlot` pass `[kind]` as the first arg of `getDiscoverCandidates`; in `rollRandomForSlot` pass `[kind]` to `getRandomDiscoverCandidate`. (Task 5 turns these into the slot's real kind set.)

- [ ] **Step 6: Verify**

Run: `npx vitest run src/main/discoverCandidates.test.ts && npm test && npm run typecheck`
Expected: all PASS. (Note: `better-sqlite3` tests are excluded under `CI` — see memory; locally they run.)

- [ ] **Step 7: Commit**

```bash
git add src/main/discoverCandidates.ts src/main/discoverCandidates.test.ts src/main/index.ts src/preload/index.ts src/renderer/src/components/DiscoverPanel.tsx
git commit -m "Discover: candidate pool takes a kind set (mask OR, trait-only includes tagged stems)"
```

---

### Task 4: Adjacency takes a kind set

**Files:**
- Modify: `src/main/discoverAdjacency.ts` (`getAdjacentDiscoverCandidates`)
- Modify: `src/main/index.ts` (`get-adjacent-discover-candidates`), `src/preload/index.ts` (`getAdjacentDiscoverCandidates`)
- Modify: `src/renderer/src/components/DiscoverNearbyPopover.tsx` (`kind` prop → `kinds`), `DiscoverPanel.tsx` (passes `[slot.kind]`)

The per-stem rule is already TDD'd (`stemMatchesSlotKinds`, Task 2). `getAdjacentDiscoverCandidates` itself has no test harness (it reads the live riff library) — verified by typecheck + manual walkthrough, consistent with this file today.

- [ ] **Step 1: Implement** — in `getAdjacentDiscoverCandidates`, change the param to `kinds: readonly DiscoverSlotKind[]`, and replace `const isTraitKind = ...` and the whole body of `matchRole`'s `for (const stem of resolved.stems)` loop up to (not including) `return {` with:

```ts
  const normalizedKinds = normalizeSlotKinds(kinds)
  const traitKinds = normalizedKinds.filter(isTraitSlotKind)
  const hasMaskKind = normalizedKinds.some(isMaskSlotKind)
```

```ts
    for (const stem of resolved.stems) {
      const soundType = instrumentMaskToSoundType(stem.instrumentMask)
      if (!stemMatchesSlotKinds(stem.instrumentMask, normalizedKinds, soundSource)) continue

      // Trait kinds rank, never filter -- but a TRAIT-ONLY set has nothing
      // to rank by without a cached feature row, so it still requires one
      // (same as before combination slots). A mask + trait set keeps a
      // mask-matched stem either way.
      let traitValues: TraitValues = {}
      if (traitKinds.length > 0) {
        const featureRow = ownDb
          .prepare(`SELECT FeaturesJSON FROM StemFeatureCache WHERE StemCID = ?`)
          .get(stem.stemCID) as { FeaturesJSON: string } | undefined
        let features: StemFeatures | null = null
        if (featureRow) {
          try {
            features = JSON.parse(featureRow.FeaturesJSON) as StemFeatures
          } catch {
            features = null
          }
        }
        if (features) traitValues = traitValuesFromFeatures(features, traitKinds)
        else if (!hasMaskKind) continue
      }
```

and in the returned object: `slotKinds: normalizedKinds, traitValues,`. Update imports: from `@shared/discoverSlotKind` import `isMaskSlotKind, isTraitSlotKind, normalizeSlotKinds, type DiscoverSlotKind` (drop `DISCOVER_TRAIT_SLOT_KINDS`, `DiscoverTraitKind` if unused); from `@shared/discoverTraits` import `stemMatchesSlotKinds, traitValuesFromFeatures, type TraitValues`; drop `soundSourceMatchesFilter` from the riffLibraryTypes import if now unused. Update the soundSource param comment: mask kinds now return nothing while "endlesss" is off.

- [ ] **Step 2: IPC + preload**

`src/main/index.ts`:
```ts
  ipcMain.handle(
    'get-adjacent-discover-candidates',
    (
      _event,
      centerRiffCID: string,
      kinds: DiscoverSlotKind[],
      soundSource?: DiscoverSoundSourceFilter
    ) => getAdjacentDiscoverCandidates(centerRiffCID, kinds, soundSource)
  )
```

`src/preload/index.ts`: `getAdjacentDiscoverCandidates: (centerRiffCID: string, kinds: DiscoverSlotKind[], soundSource?: DiscoverSoundSourceFilter) => ipcRenderer.invoke('get-adjacent-discover-candidates', centerRiffCID, kinds, soundSource)` (keep its return type).

- [ ] **Step 3: Popover** — in `DiscoverNearbyPopover.tsx`: prop `kind: DiscoverSlotKind` → `kinds: DiscoverSlotKind[]` (update its doc comment: mask kinds return nothing while "endlesss" is off); import `slotKindsKey`; then:

```ts
  const kindsKey = slotKindsKey(kinds)
  const resultKey = `${centerCandidate.riffCID}:${kindsKey}:${soundSource.endlesss}:${soundSource.audioIn}`
```
the fetch call passes `kinds`; the effect deps become `[centerCandidate.riffCID, kindsKey, soundSource.endlesss, soundSource.audioIn, resultKey]` (extend the existing eslint-disable comment: `kinds` is a fresh array each render, `kindsKey` carries its identity).

In `DiscoverPanel.tsx` where `<DiscoverNearbyPopover` renders: `kinds={[slot.kind]}`.

- [ ] **Step 4: Verify**

Run: `npm test && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/discoverAdjacency.ts src/main/index.ts src/preload/index.ts src/renderer/src/components/DiscoverNearbyPopover.tsx src/renderer/src/components/DiscoverPanel.tsx
git commit -m "Discover: nearby-jam adjacency takes a kind set"
```

---

### Task 5: Panel uses `slot.kinds`, rolls rank by trait

**Files:**
- Modify: `src/renderer/src/components/DiscoverPanel.tsx`
- Modify: `src/renderer/src/audio/discoverSeed.ts`
- Test: `src/renderer/src/audio/discoverSeed.test.ts`

- [ ] **Step 0: Update seed test expectations first** — in `discoverSeed.test.ts`, convert every assertion on a built slot's `kind` to `kinds`, e.g. `expect(slots.map((s) => s.kind)).toEqual(['drums', 'bass'])` → `expect(slots.map((s) => s.kinds)).toEqual([['drums'], ['bass']])` (search the file for `.kind` / `kind:`). Run `npx vitest run src/renderer/src/audio/discoverSeed.test.ts` — Expected: FAIL (`kinds` undefined).

- [ ] **Step 1: Flip the slot type** — in `DiscoverPanel.tsx`, `interface DiscoverSlot`: replace `kind: DiscoverSlotKind` with

```ts
  /** Combination slots, 2026-09-21: the normalized set of kinds this slot
   * targets (normalizeSlotKinds) -- never empty. A one-click "+ drums" slot
   * is ['drums']. Editable after creation via the kind picker. */
  kinds: DiscoverSlotKind[]
```

`discoverSeed.ts`: `buildSeedSlotsFromStems` → `kinds: [discoverSlotKindForSoundType(stem.type)],`; `buildSeedSlotsFromCandidates` → `kinds: normalizeSlotKinds(candidate.slotKinds),` (import `normalizeSlotKinds`). Update the doc comment's "`kind` comes directly off the candidate's own `slotKind`" to `kinds` / `slotKinds`.

- [ ] **Step 2: Fix every slot-kind use in DiscoverPanel.tsx** (typecheck lists them):

- `addSlot(kind)`: create `{ id, kinds: [kind], ... }` and call `rollRandomForSlot(id, [kind])` / `rollForSlot(id, [kind])`.
- `addRandomSlot`: `const kinds = [randomDiscoverSlotKind()]`, create with `kinds`, `rollRandomForSlot(id, kinds)`.
- external sample import (`kind: 'bright'`): `kinds: ['bright'],`.
- `rollForSlot(id: string, kinds: DiscoverSlotKind[])`: pass `kinds` to `getDiscoverCandidates` (replacing Task 3's `[kind]`); logs use `${slotKindsKey(kinds)}`; the ranking call becomes

```ts
      const ranked = rankCandidates(pool, {
        targetBpm: bpm,
        favouriteStemCIDs: preferFavourites ? stemFavourites : undefined,
        // Finding, 2026-09-21: trait kinds were never passed here before,
        // so a "warm" roll ranked by BPM alone. Every trait kind in the set
        // now adds its own pool-relative score (rankCandidates).
        targetTraits: kinds.filter(isTraitSlotKind)
      })
```
- `rollRandomForSlot(id, kinds: DiscoverSlotKind[])`: pass `kinds`; log uses `slotKindsKey(kinds)`.
- `rerollSlot`, `rerollRandomSlot`, `rerollAll`: `slot.kind` → `slot.kinds`.
- `resolveDiscoverRifff`: `const kinds = [...new Set(placeable.map((s) => slotKindsLabel(s.kinds)))]` (keeps the `discover: ...` name readable).
- seed-lookup anchor: `slotKinds: slot.kinds,`; update the eslint-disable comment's "kind is fixed at slot creation" clause to say kinds only change via the picker, which rerolls (candidate set → this lookup no longer applies).
- kind label span: `{slotKindsLabel(slot.kinds)}` (Task 6 turns it into the picker button).
- `<DiscoverNearbyPopover kinds={slot.kinds} ...`.

Import `isTraitSlotKind, slotKindsKey, slotKindsLabel` from `@shared/discoverSlotKind`.

- [ ] **Step 3: Verify**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all PASS, including `discoverSeed.test.ts` from Step 0.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/DiscoverPanel.tsx src/renderer/src/audio/discoverSeed.ts src/renderer/src/audio/discoverSeed.test.ts
git commit -m "Discover: slots carry a kind set; trait kinds now actually rank rolls"
```

---

### Task 6: Kind picker on the slot label

**Files:**
- Create: `src/renderer/src/components/DiscoverKindPicker.tsx`
- Modify: `src/renderer/src/components/DiscoverPanel.tsx`

React components are verified by typecheck + lint + manual walkthrough in this codebase (CLAUDE.md, Testing conventions); the toggle logic itself is already unit-tested (`toggleSlotKind`, Task 1).

- [ ] **Step 1: Create the picker** — `src/renderer/src/components/DiscoverKindPicker.tsx`:

```tsx
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  DISCOVER_MASK_SLOT_KINDS,
  DISCOVER_SLOT_KIND_LABEL,
  DISCOVER_TRAIT_SLOT_KINDS,
  slotKindsKey,
  toggleSlotKind,
  type DiscoverSlotKind
} from '@shared/discoverSlotKind'

/** Combination slots (docs/superpowers/specs/2026-09-21-discover-combo-
 * slot-kinds-design.md, mockup option B): opened from a slot's own kind
 * label. Two chip rows -- instrument (OR filter) and trait (AND ranking).
 * Every toggle calls onChange immediately (the panel rerolls the slot);
 * the picker stays open so several chips can be tried in a row. Position +
 * dismissal mirror DiscoverNearbyPopover.tsx / ContextMenu.tsx. */
export function DiscoverKindPicker({
  x,
  y,
  kinds,
  maskKindsDisabled,
  onChange,
  onClose,
  ignoreRef
}: {
  x: number
  y: number
  kinds: DiscoverSlotKind[]
  /** DiscoverPanel's "endlesss" checkbox is off -- instrument kinds are
   * Endlesss content by definition, so they can't be picked. */
  maskKindsDisabled: boolean
  onChange: (kinds: DiscoverSlotKind[]) => void
  onClose: () => void
  ignoreRef: React.RefObject<HTMLElement | null>
}): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: x, top: y })

  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const margin = 8
    const left = Math.max(margin, Math.min(x, window.innerWidth - rect.width - margin))
    const top = Math.max(margin, Math.min(y, window.innerHeight - rect.height - margin))
    setPosition({ left, top })
  }, [x, y])

  useEffect(() => {
    function handleDismiss(e: MouseEvent): void {
      if (menuRef.current?.contains(e.target as Node)) return
      if (ignoreRef.current?.contains(e.target as Node)) return
      onClose()
    }
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    const id = setTimeout(() => {
      window.addEventListener('click', handleDismiss, true)
    }, 0)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      clearTimeout(id)
      window.removeEventListener('click', handleDismiss, true)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose, ignoreRef])

  function chip(kind: DiscoverSlotKind): React.JSX.Element {
    const on = kinds.includes(kind)
    const disabled = maskKindsDisabled && DISCOVER_MASK_SLOT_KINDS.includes(kind)
    const isLastOn = on && kinds.length === 1
    return (
      <button
        key={kind}
        disabled={disabled}
        aria-pressed={on}
        data-tooltip={
          disabled ? 'needs endlesss on' : isLastOn ? 'a slot needs at least one kind' : undefined
        }
        onClick={() => {
          const next = toggleSlotKind(kinds, kind)
          if (slotKindsKey(next) !== slotKindsKey(kinds)) onChange(next)
        }}
        style={{
          fontFamily: 'inherit',
          fontSize: 9,
          padding: 'var(--ra-s-0) 8px',
          background: on ? 'var(--ra-bg-row-active)' : 'transparent',
          border: `1px solid ${on ? 'var(--ra-text)' : 'var(--ra-border)'}`,
          color: on ? 'var(--ra-text)' : 'var(--ra-text-2)',
          opacity: disabled ? 0.3 : 1,
          cursor: disabled ? 'not-allowed' : 'pointer'
        }}
      >
        {DISCOVER_SLOT_KIND_LABEL[kind]}
      </button>
    )
  }

  function row(label: string, list: DiscoverSlotKind[]): React.JSX.Element {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span
          style={{
            width: 76,
            fontSize: 9,
            color: 'var(--ra-text-3)',
            textTransform: 'uppercase',
            letterSpacing: 'var(--ra-track-eyebrow)'
          }}
        >
          {label}
        </span>
        {list.map(chip)}
      </div>
    )
  }

  return (
    <div
      ref={menuRef}
      role="dialog"
      aria-label="slot kinds"
      style={{
        position: 'fixed',
        left: position.left,
        top: position.top,
        zIndex: 1200,
        background: 'var(--ra-bg-bar)',
        border: '1px solid var(--ra-border-strong)',
        padding: 8,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        boxShadow: '0 6px 20px rgba(0,0,0,0.4)'
      }}
    >
      {row('instrument', DISCOVER_MASK_SLOT_KINDS)}
      {row('trait', DISCOVER_TRAIT_SLOT_KINDS)}
      <span style={{ fontSize: 9, color: 'var(--ra-text-3)' }}>
        changing kinds rerolls this slot
      </span>
    </div>
  )
}
```

- [ ] **Step 2: Panel handler** — in `DiscoverPanel` (next to `rerollSlot`):

```ts
  // Combination slots, 2026-09-21: the kind picker on a slot's own label.
  // One undo step per change; always rerolls, since the old candidate was
  // drawn for the old kind set.
  function changeSlotKinds(id: string, kinds: DiscoverSlotKind[]): void {
    pushUndoSnapshot()
    setSlots((prev) => prev.map((s) => (s.id === id ? { ...s, kinds } : s)))
    void rollForSlot(id, kinds)
  }
```

Pass it to each row: `onChangeKinds={(kinds) => changeSlotKinds(slot.id, kinds)}`. Add `onChangeKinds` to `DiscoverSlotRow`'s destructured props and prop type:

```ts
  /** DiscoverPanel's own changeSlotKinds -- fired by the kind picker on
   * every chip toggle (the panel rerolls this slot). */
  onChangeKinds: (kinds: DiscoverSlotKind[]) => void
```

- [ ] **Step 3: Label becomes the picker trigger** — in `DiscoverSlotRow`, next to the `nearbyMenu` state:

```ts
  const [kindMenu, setKindMenu] = useState<{ x: number; y: number } | null>(null)
  const kindButtonRef = useRef<HTMLButtonElement>(null)
  // Stable identity -- same playhead-tick re-render reasoning as closeNearbyMenu.
  const closeKindMenu = useCallback(() => setKindMenu(null), [])
```

Replace the `gridColumn: 9` kind `<span>` with:

```tsx
        <button
          ref={kindButtonRef}
          disabled={slot.locked}
          onClick={(e) => {
            if (kindMenu) {
              closeKindMenu()
              return
            }
            const rect = e.currentTarget.getBoundingClientRect()
            setKindMenu({ x: rect.left, y: rect.bottom + 4 })
          }}
          aria-expanded={kindMenu !== null}
          aria-label={`kinds: ${slotKindsLabel(slot.kinds)}`}
          data-tooltip={slot.locked ? 'unlock to change kinds' : slotKindsLabel(slot.kinds)}
          style={{
            gridColumn: 9,
            display: 'flex',
            alignItems: 'center',
            gap: 3,
            width: 110,
            padding: 0,
            fontFamily: 'inherit',
            fontSize: 9,
            textAlign: 'left',
            background: 'transparent',
            border: 'none',
            color: kindMenu ? 'var(--ra-text)' : 'var(--ra-text-3)',
            cursor: slot.locked ? 'default' : 'pointer'
          }}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {slotKindsLabel(slot.kinds)}
          </span>
          {!slot.locked && <span aria-hidden="true">▾</span>}
        </button>
```

Render the picker next to the nearby popover at the bottom of the row:

```tsx
      {kindMenu && !slot.locked && (
        <DiscoverKindPicker
          x={kindMenu.x}
          y={kindMenu.y}
          kinds={slot.kinds}
          maskKindsDisabled={!soundSourceEndlesss}
          onChange={onChangeKinds}
          onClose={closeKindMenu}
          ignoreRef={kindButtonRef}
        />
      )}
```

Import `DiscoverKindPicker` from `./DiscoverKindPicker`.

- [ ] **Step 4: Widen the label column** — row grid (`gridTemplateColumns`, ~line 3131): the 9th track `64px` → `110px`:

```ts
            '18px 18px 18px 18px 18px 14px 1fr 14px 110px 14px 16px 70px 70px 70px 70px',
```

Add-row `marginRight: 452` → `498` (+46), and in the comment above it update `(388)` → `(434)` and `= 452` → `= 498` and the quoted template string to the new one.

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npm run lint && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/DiscoverKindPicker.tsx src/renderer/src/components/DiscoverPanel.tsx
git commit -m "Discover: kind picker on the slot label -- combine instrument and trait kinds"
```

---

### Task 7: "endlesss" off greys out instrument kinds

**Files:**
- Modify: `src/renderer/src/components/DiscoverPanel.tsx`

- [ ] **Step 1: Grey the add-row buttons** — in the `DISCOVER_SLOT_KIND_OPTIONS.map((kind) => ...)` add-row:

```tsx
        {DISCOVER_SLOT_KIND_OPTIONS.map((kind) => {
          // Instrument kinds are Endlesss content by definition -- with the
          // "endlesss" source off they can't match anything (spec, 2026-09-21).
          const disabled = !soundSourceEndlesss && isMaskSlotKind(kind)
          return (
            <button
              key={kind}
              disabled={disabled}
              onClick={() => addSlot(kind)}
              data-tooltip={disabled ? 'needs endlesss on' : undefined}
              style={{
                fontFamily: 'inherit',
                fontSize: 9,
                padding: '4px 8px',
                background: 'transparent',
                border: 'none',
                color: 'var(--ra-text-2)',
                opacity: disabled ? 0.3 : 1,
                cursor: disabled ? 'not-allowed' : 'pointer'
              }}
            >
              + {DISCOVER_SLOT_KIND_LABEL[kind]}
            </button>
          )
        })}
```

- [ ] **Step 2: Empty-panel dice** — in `rerollAll`, `addSlot(DISCOVER_SLOT_KIND_OPTIONS[0])` → `addSlot(soundSourceEndlesss ? DISCOVER_SLOT_KIND_OPTIONS[0] : DISCOVER_TRAIT_SLOT_KINDS[0])` (import `DISCOVER_TRAIT_SLOT_KINDS`, `isMaskSlotKind`).

- [ ] **Step 3: Checkbox tooltips** — the two sound-source checkboxes' `title`s no longer say "only affects bright/warm/rhythmic/bass-heavy":
  - endlesss: `"stems made with Endlesss instruments or effects -- turning this off also turns off drums/bass/lead, which are Endlesss-only"`
  - non-endlesss: `"audio-in / microphone stems (real recorded input, not an Endlesss instrument or effect)"`
  Also update the code comment above that row (it says mask kinds are unaffected by design — no longer true).

- [ ] **Step 4: Verify** — `npm run typecheck && npm run lint` — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/DiscoverPanel.tsx
git commit -m "Discover: instrument kinds grey out while the endlesss source is off"
```

---

### Task 8: Final verification + handoff

- [ ] **Step 1:** `npm test && npm run typecheck && npm run lint` — all green; paste the summary lines.
- [ ] **Step 2:** `grep -rn "slotKind\b\|traitValue\b\|\.kind\b" src/main/discover* src/renderer/src/components/Discover* src/renderer/src/audio/discoverSeed.ts src/shared/discover*` — expect no leftover single-kind reads (comments excepted).
- [ ] **Step 3:** Tell Elling this needs a full quit + `npm run dev` restart (main-process changes don't hot-reload) and give him this walkthrough:
  1. `+ drums` still adds one drum slot in one click.
  2. Click a slot's label (`drums ▾`) → picker opens under it; add `warm` → slot rerolls, label reads `drums · warm`.
  3. Turn `warm` on then `bright` → warm switches off.
  4. Try to turn off the last chip → nothing happens.
  5. Trait-only `warm · rhythmic` → rolls come from any stem (Endlesss-tagged included).
  6. Untick `endlesss` → `+ drums/bass/lead` grey out, the picker's instrument chips grey out, rerolling an existing drums slot shows "no match".
  7. Lock a slot → its label no longer opens the picker.
  8. Undo after a kind change restores the previous kinds + stem.
  9. "nearby jam" on a combo slot lists stems matching the set.
- [ ] **Step 4:** Update memory `discover_combination_trait_kinds_queued.md` → shipped, needs walkthrough; note the "trait ranking was never wired" finding.
