# Radio Faves Dial Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the on/off `prefer faves` roll modifier with one `faves` dial (0–100) in sssketch's Discover and radio and in ell.ing/radio's full mode. At each pick, with probability `faves/100`, the pick is drawn only from favourites, falling back to a normal pick when none fit.

**Spec:** `docs/superpowers/specs/2026-10-03-radio-faves-dial-design.md`

**Architecture:** A new pure module, `src/shared/discoverFaves.ts`, holds the dial's rules. It has the draw (`favesDraw`), the boost scale, normalising and migration, the restriction helper and the copy. Both pickers use it. The favourites-only pool is a restriction taken **before** each picker's bounded random sample:
- **Desktop:** main's existing `artistStemCIDs` gate in `getDiscoverCandidates`, fed over IPC.
- **Web:** a record filter applied to `pick.ts`'s buckets.

A sample of 1000 from tens of thousands of stems would rarely hold a favourite, so filtering after the sample would almost always fall back. Normal picks keep ranking favourites up through a new `favouriteScale` option on `rankCandidates`. The desktop dial value lives in the persisted `RadioSettings` (`faves`). The web value lives in `localStorage['radio.faves']`.

**Tech Stack:** TypeScript, vitest, React (sssketch renderer), Electron IPC, plain DOM (ell.ing/radio).

**Repos:**
- `/Users/nickel/Claudecode/sssketch` (Tasks 1–6, 9)
- `/Users/nickel/Claudecode/ell.ing/radio` (Tasks 7–9)

The web repo imports sssketch's `src/shared` through the `@shared` alias from the working tree, so finish Tasks 1–2 before Task 7.

**Before the web tasks:** other agents just changed `ell.ing/radio/src/radio/step.ts` (readout fixes). This plan does **not** touch `step.ts`. Before Task 7, wait for that work to land. Then run `git -C /Users/nickel/Claudecode/ell.ing/radio status --short` (expect it clean) and `npx vitest run` there (expect green). Anchor every edit on the quoted code, not on line numbers.

**Branches:** work on a `radio-faves-dial` branch in each repo (`git switch -c radio-faves-dial`).

**Commits:** every commit message ends with exactly these two lines, after a blank line:

```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz
```

---

## Spec points resolved

1. **Where `prefer faves` was persisted: nowhere.** It was one of DiscoverPanel's `globalModifiers`, which are in-memory only and default to `['mine']`, so `prefer faves` started off every launch.
   - No settings file holds it, so the migration in practice is "starts at 0" (the same as `prefer faves` off).
   - For the spec's rule, `normalizeFaves(value, legacyPreferFaves)` still maps a saved `preferFaves: true` to 50. `normalizeRadioSettings` reads `radio.preferFaves` for it, and that is tested. Nothing on disk triggers it today.
2. **Where the desktop dial value lives:** `RadioSettings.faves`, which is persisted in `discoverSettings.json`.
   - It is optional on the type, like `density`, so the web radio's own `RadioSettings` objects still typecheck.
   - Discover's roll-modifier dial and the radio menu's row read and write the same value. That makes the value persist, unlike the toggle it replaces. One value in two places only works if it persists.
3. **Web boost at 0.** Today the web radio always ranks loved stems up at full `FAVOURITE_BOOST × weight`.
   - The spec's "defaults 0, nothing changes until the dial is moved" therefore means the web keeps that boost at **every** dial position (scale 1).
   - Moving the web dial adds the favourites-only draw only.
   - On desktop, the boost scales as the spec says: `faves/100 × FAVOURITE_BOOST`, with no boost at 0 (today's `prefer faves` off).
   - Flag for Elling if he wants the web's crowd lean tied to the dial too.
4. **A favourite on the web** is any stem with `loved(id) > 0`: the visitor's 👍 likes, plus any stem with at least one ♥ in loved.json. Counting hearted stems one by one follows the spec.
5. **The favourites-only pool is taken before sampling.** "A filter of the normal candidate pool, taken before ranking" is implemented as a restriction applied before each picker's bounded random sample (see Architecture). Every other slot rule still applies to it: kind mask, trait bar, tempo ranking, the source dial (including its fallback source) and the clash.
6. **When a favourite "fits".** A favourite fits when the favourites-only pool has at least one stem that is not already on another row. Otherwise the pick falls back to a normal roll and is marked `favesFallback: true`. A favourite already playing elsewhere is not a fit, since landing a duplicate is worse than a normal pick.
7. **Determinism.** `favesDraw` takes the picker's random source (web: the seeded `random`; desktop: `Math.random`, like the source dial). It **never calls `random` at 0 or 100**, so at 0 the web picker's random stream, and so every pick, is identical to today. Task 7 tests this across 200 seeds.
8. **Artist mode (desktop).** The dial is dimmed and ignored: your stars are not among the artist's stems. This is the same rule the toggle had.
9. **Readout `no fave fits`: web only.** The web controller flashes `no fave fits` on the row when its pick falls back (Task 8). Desktop records `favesFallback` on the `SlotPick` and logs it. Wiring it into sssketch's flash log is left out to keep this build lean.
10. **`+ random` rolls** (`rollRandomForSlot`, "any stem") never used favourites and still don't.

---

## File map

**sssketch**
- Create `src/shared/discoverFaves.ts`: the dial's constants and copy, `normalizeFaves`, `favesDraw`, `favesBoostScale`, `restrictStems`.
- Create `src/shared/discoverFaves.test.ts`.
- Modify `src/shared/discoverRanking.ts`: the `favouriteScale` option. Test: `src/shared/discoverRanking.test.ts`.
- Modify `src/shared/radioSchedule.ts`: `RadioSettings.faves`, the default, normalising and `radioFavesOf`. Tests: `src/shared/radioSchedule.test.ts` and `src/main/discoverSettingsStore.test.ts`.
- Modify `src/main/index.ts` and `src/preload/index.ts`: the `onlyStemCIDs` IPC argument.
- Modify `src/shared/discoverSlotModifier.ts` (drop `preferFaves`). Test: `src/shared/discoverSlotModifier.test.ts`.
- Modify `src/renderer/src/components/DiscoverPanel.tsx`: the pick and the dial.
- Modify `src/renderer/src/components/DiscoverRadioMenu.tsx`: the `faves` row.

**ell.ing/radio**
- Modify `src/radio/pick.ts`: `faves`, the pre-sample filter and `favesFallback`. Test: `src/radio/pick.test.ts`.
- Create `src/ui/favesPrefs.ts` and `src/ui/favesPrefs.test.ts`.
- Modify `src/radio/controller.ts`: `setFaves`, the picker's options and the flash. Tests: `src/radio/controller.test.ts` and `src/radio/indexPicker.test.ts`.
- Modify `src/ui/full.ts`: the `faves` knob.
- Modify `src/main.ts`: the wiring.

---

### Task 1: Shared `discoverFaves` helper

**Files:**
- Create: `/Users/nickel/Claudecode/sssketch/src/shared/discoverFaves.ts`
- Test: `/Users/nickel/Claudecode/sssketch/src/shared/discoverFaves.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/shared/discoverFaves.test.ts
import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_FAVES,
  FAVES_LABEL,
  FAVES_TOOLTIP,
  LEGACY_PREFER_FAVES,
  NO_FAVE_FITS,
  favesBoostScale,
  favesDraw,
  normalizeFaves,
  restrictStems
} from './discoverFaves'

/** mulberry32 -- a small seeded PRNG. */
function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('the faves dial copy', () => {
  it('is lowercase and says what it does', () => {
    expect(FAVES_LABEL).toBe('faves')
    expect(FAVES_TOOLTIP).toBe('how much to stick to liked stems')
    expect(NO_FAVE_FITS).toBe('no fave fits')
    expect(DEFAULT_FAVES).toBe(0)
  })
})

describe('normalizeFaves', () => {
  it('clamps and rounds a number to 0..100', () => {
    expect(normalizeFaves(37.4)).toBe(37)
    expect(normalizeFaves(-5)).toBe(0)
    expect(normalizeFaves(250)).toBe(100)
  })

  it('anything that is not a number is the default', () => {
    expect(normalizeFaves(undefined)).toBe(0)
    expect(normalizeFaves('50')).toBe(0)
    expect(normalizeFaves(NaN)).toBe(0)
  })

  it('migrates a saved prefer faves: on to 50, off to 0; a saved faves wins', () => {
    expect(LEGACY_PREFER_FAVES).toBe(50)
    expect(normalizeFaves(undefined, true)).toBe(50)
    expect(normalizeFaves(undefined, false)).toBe(0)
    expect(normalizeFaves(undefined, 'yes')).toBe(0)
    expect(normalizeFaves(20, true)).toBe(20)
  })
})

describe('favesDraw', () => {
  it('never draws at the ends: 0 is normal, 100 is only, and random is not called', () => {
    const random = vi.fn(() => 0.5)
    expect(favesDraw(0, random)).toBe('normal')
    expect(favesDraw(100, random)).toBe('only')
    expect(favesDraw(-3, random)).toBe('normal')
    expect(favesDraw(140, random)).toBe('only')
    expect(random).not.toHaveBeenCalled()
  })

  it('in between, draws once per pick: only with probability faves/100', () => {
    for (const faves of [10, 30, 50, 80]) {
      const random = seeded(faves)
      let only = 0
      const n = 20_000
      for (let i = 0; i < n; i++) if (favesDraw(faves, random) === 'only') only++
      expect(only / n).toBeGreaterThan(faves / 100 - 0.02)
      expect(only / n).toBeLessThan(faves / 100 + 0.02)
    }
  })

  it('uses the random it is given', () => {
    expect(favesDraw(50, () => 0.49)).toBe('only')
    expect(favesDraw(50, () => 0.5)).toBe('normal')
  })
})

describe('favesBoostScale', () => {
  it('is faves/100: none at 0, the full boost at 100', () => {
    expect(favesBoostScale(0)).toBe(0)
    expect(favesBoostScale(50)).toBe(0.5)
    expect(favesBoostScale(100)).toBe(1)
    expect(favesBoostScale(Number.NaN)).toBe(0)
  })
})

describe('restrictStems', () => {
  it('no restriction from either side is none', () => {
    expect(restrictStems(undefined, undefined)).toBeUndefined()
  })

  it('one side alone is that side', () => {
    const a = new Set(['x'])
    expect(restrictStems(a, undefined)).toBe(a)
    expect(restrictStems(undefined, a)).toBe(a)
  })

  it('both sides intersect', () => {
    expect([...restrictStems(new Set(['x', 'y']), new Set(['y', 'z']))!]).toEqual(['y'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/nickel/Claudecode/sssketch && npx vitest run src/shared/discoverFaves.test.ts`
Expected: FAIL, "Failed to resolve import './discoverFaves'"

- [ ] **Step 3: Write the implementation**

```ts
// src/shared/discoverFaves.ts
//
// The faves dial (docs/superpowers/specs/2026-10-03-radio-faves-dial-design.md): 0..100, how much
// a pick sticks to favourites. With probability faves/100 a pick is drawn ONLY from favourites
// (same slot rules as any pick), falling back to a normal pick when none fits; every other pick
// is normal, with favourites ranked up by faves/100 of the boost. Replaces the `prefer faves`
// switch. Shared by Discover/radio (desktop: 👍-starred stems) and ell.ing/radio (the visitor's
// 👍 likes and ♥ hearted stems).

export const FAVES_MIN = 0
export const FAVES_MAX = 100
/** Where the dial starts, and where a double-click puts it back: nothing changes until moved. */
export const DEFAULT_FAVES = 0
/** What a saved `prefer faves: on` becomes. */
export const LEGACY_PREFER_FAVES = 50

export const FAVES_LABEL = 'faves'
export const FAVES_TOOLTIP = 'how much to stick to liked stems'
/** The readout's word on a row whose favourites-only pick found nothing that fits. */
export const NO_FAVE_FITS = 'no fave fits'

/** 0..100, whole numbers. Not a number: the legacy switch if it was on (50), else the default. */
export function normalizeFaves(value: unknown, legacyPreferFaves?: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value))
    return Math.round(Math.min(FAVES_MAX, Math.max(FAVES_MIN, value)))
  return legacyPreferFaves === true ? LEGACY_PREFER_FAVES : DEFAULT_FAVES
}

export type FavesWay = 'only' | 'normal'

/** Which way ONE pick goes. The ends never call `random` -- so at 0 a seeded picker's stream,
 * and every pick it makes, is exactly what it was before the dial existed. */
export function favesDraw(faves: number, random: () => number = Math.random): FavesWay {
  const f = normalizeFaves(faves)
  if (f <= FAVES_MIN) return 'normal'
  if (f >= FAVES_MAX) return 'only'
  return random() < f / 100 ? 'only' : 'normal'
}

/** How much of rankCandidates' favourites boost a normal pick gets: faves/100. */
export function favesBoostScale(faves: number): number {
  return normalizeFaves(faves) / 100
}

/** The stems a pool may draw from: one restriction, the other, or both intersected (artist mode
 * and the favourites-only draw); undefined is no restriction. */
export function restrictStems(
  a: ReadonlySet<string> | undefined,
  b: ReadonlySet<string> | undefined
): ReadonlySet<string> | undefined {
  if (a === undefined) return b
  if (b === undefined) return a
  return new Set([...a].filter((id) => b.has(id)))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/nickel/Claudecode/sssketch && npx vitest run src/shared/discoverFaves.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
cd /Users/nickel/Claudecode/sssketch
git add src/shared/discoverFaves.ts src/shared/discoverFaves.test.ts
git commit -F - <<'EOF'
faves dial: the shared rules -- favesDraw (only with probability faves/100, never drawing at the ends), the boost scale, normalizing with the prefer faves migration to 50, restrictStems and the copy

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz
EOF
```

---

### Task 2: `rankCandidates` favourite scale

**Files:**
- Modify: `/Users/nickel/Claudecode/sssketch/src/shared/discoverRanking.ts`
- Test: `/Users/nickel/Claudecode/sssketch/src/shared/discoverRanking.test.ts`

- [ ] **Step 1: Write the failing test.** Append to `src/shared/discoverRanking.test.ts`, and add `import { favesBoostScale } from './discoverFaves'` beside the existing imports at the top:

```ts
describe('rankCandidates: favouriteScale (the faves dial)', () => {
  /** mulberry32 */
  function seeded(seed: number): () => number {
    let a = seed >>> 0
    return () => {
      a = (a + 0x6d2b79f5) >>> 0
      let t = a
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }
  function randomPool(seed: number): { pool: DiscoverCandidate[]; faves: Set<string> } {
    const r = seeded(seed)
    const pool = Array.from({ length: 30 }, (_, i) =>
      candidate({
        stemCID: `s${i}`,
        riffBpm: Math.round(80 + r() * 80),
        traitPercentiles: { warm: r() }
      })
    )
    const faves = new Set(pool.filter(() => r() < 0.3).map((c) => c.stemCID))
    return { pool, faves }
  }

  it('at faves 0 the ranking is identical to one without favourites, across many seeds', () => {
    for (let s = 1; s <= 200; s++) {
      const { pool, faves } = randomPool(s)
      const opts = { targetBpm: 120, targetTraits: ['warm'] as const }
      expect(
        rankCandidates(pool, {
          ...opts,
          targetTraits: [...opts.targetTraits],
          favouriteStemCIDs: faves,
          favouriteScale: favesBoostScale(0)
        })
      ).toEqual(rankCandidates(pool, { ...opts, targetTraits: [...opts.targetTraits] }))
    }
  })

  it('absent, the full boost as before', () => {
    for (let s = 1; s <= 50; s++) {
      const { pool, faves } = randomPool(s)
      expect(
        rankCandidates(pool, { targetBpm: 120, favouriteStemCIDs: faves, favouriteScale: 1 })
      ).toEqual(rankCandidates(pool, { targetBpm: 120, favouriteStemCIDs: faves }))
    }
  })

  it('scales the boost: half the dial, half the boost, for sets and weights alike', () => {
    const fav = candidate({ stemCID: 'fav', riffBpm: 128 })
    const full = rankCandidates([fav], { targetBpm: 128, favouriteStemCIDs: new Set(['fav']) })
    const half = rankCandidates([fav], {
      targetBpm: 128,
      favouriteStemCIDs: new Set(['fav']),
      favouriteScale: favesBoostScale(50)
    })
    expect(full[0].score - 1).toBeCloseTo(1.5, 6)
    expect(half[0].score - 1).toBeCloseTo(0.75, 6)
    const weighted = rankCandidates([fav], {
      targetBpm: 128,
      favouriteWeight: () => 0.5,
      favouriteScale: 0.5
    })
    expect(weighted[0].score - 1).toBeCloseTo(0.375, 6)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/nickel/Claudecode/sssketch && npx vitest run src/shared/discoverRanking.test.ts`
Expected: FAIL. The typecheck-free vitest run reaches the scaling test and fails `expected 1.5 to be close to 0.75`, and the 0-identity test fails because the favourites are still boosted.

- [ ] **Step 3: Implement.** In `src/shared/discoverRanking.ts`, replace

```ts
    favouriteWeight,
    targetTraits = [],
    clash
  }: {
    targetBpm: number
    favouriteStemCIDs?: Set<string>
```

with

```ts
    favouriteWeight,
    favouriteScale = 1,
    targetTraits = [],
    clash
  }: {
    targetBpm: number
    favouriteStemCIDs?: ReadonlySet<string>
```

then replace

```ts
    favouriteWeight?: (stemCID: string) => number
    targetTraits?: readonly DiscoverTraitKind[]
```

with

```ts
    favouriteWeight?: (stemCID: string) => number
    /** The faves dial's lean (@shared/discoverFaves favesBoostScale), clamped to [0, 1]:
     * multiplies the whole favourites boost. Absent: 1, the full boost, as before. 0: no boost
     * at all -- exactly the ranking without favourites. */
    favouriteScale?: number
    targetTraits?: readonly DiscoverTraitKind[]
```

then replace

```ts
  return candidates
    .map((candidate) => {
      const bpmDistance = Math.abs(candidate.riffBpm - targetBpm)
      let score = Math.max(0, 1 - bpmDistance / BPM_FALLOFF)
      if (favouriteStemCIDs?.has(candidate.stemCID)) score += FAVOURITE_BOOST
      else if (favouriteWeight)
        score += FAVOURITE_BOOST * clampWeight(favouriteWeight(candidate.stemCID))
```

with

```ts
  const boost = FAVOURITE_BOOST * clampWeight(favouriteScale)
  return candidates
    .map((candidate) => {
      const bpmDistance = Math.abs(candidate.riffBpm - targetBpm)
      let score = Math.max(0, 1 - bpmDistance / BPM_FALLOFF)
      if (favouriteStemCIDs?.has(candidate.stemCID)) score += boost
      else if (favouriteWeight) score += boost * clampWeight(favouriteWeight(candidate.stemCID))
```

(`clampWeight` already maps non-finite to 0 and clamps to [0, 1].)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/nickel/Claudecode/sssketch && npx vitest run src/shared/discoverRanking.test.ts src/shared/discoverFaves.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/nickel/Claudecode/sssketch
git add src/shared/discoverRanking.ts src/shared/discoverRanking.test.ts
git commit -F - <<'EOF'
rankCandidates: favouriteScale, the faves dial's lean on the favourites boost -- absent is the full boost as before, 0 exactly the ranking without favourites

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz
EOF
```

---

### Task 3: `RadioSettings.faves`, persisted, with the migration

**Files:**
- Modify: `/Users/nickel/Claudecode/sssketch/src/shared/radioSchedule.ts`
- Test: `/Users/nickel/Claudecode/sssketch/src/shared/radioSchedule.test.ts`, `/Users/nickel/Claudecode/sssketch/src/main/discoverSettingsStore.test.ts`

- [ ] **Step 1: Write the failing tests.**

In `src/shared/radioSchedule.test.ts`, inside `describe('RadioSettings', ...)`, the defaults test's literal ends:

```ts
      foldSeed: 'autech',
      density: 'arc'
    })
```

Change it to:

```ts
      foldSeed: 'autech',
      density: 'arc',
      faves: 0
    })
```

Append to the same file:

```ts
describe('RadioSettings.faves (the faves dial)', () => {
  it('defaults to 0, keeps a saved value, clamps, and migrates prefer faves: on to 50', () => {
    expect(normalizeRadioSettings({}).faves).toBe(0)
    expect(normalizeRadioSettings({ faves: 35 }).faves).toBe(35)
    expect(normalizeRadioSettings({ faves: 400 }).faves).toBe(100)
    expect(normalizeRadioSettings({ preferFaves: true }).faves).toBe(50)
    expect(normalizeRadioSettings({ preferFaves: false }).faves).toBe(0)
    expect(normalizeRadioSettings({ faves: 10, preferFaves: true }).faves).toBe(10)
  })

  it('radioFavesOf reads an absent field (the web radio builds its own settings) as 0', () => {
    const { faves: _drop, ...noFaves } = DEFAULT_RADIO_SETTINGS
    void _drop
    expect(radioFavesOf(noFaves)).toBe(0)
    expect(radioFavesOf({ ...DEFAULT_RADIO_SETTINGS, faves: 70 })).toBe(70)
  })
})
```

Add `radioFavesOf` to the file's existing `from './radioSchedule'` import list.

In `src/main/discoverSettingsStore.test.ts`, in `it('round-trips every radio setting', ...)`, add `faves: 60` to **both** objects, the saved `radio: { ... }` and the `toEqual({ ... })`. In each, the last line `density: 'off'` becomes:

```ts
        density: 'off',
        faves: 60
```

(and in the expectation object, at its own indentation, `density: 'off',` then `faves: 60`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/nickel/Claudecode/sssketch && npx vitest run src/shared/radioSchedule.test.ts src/main/discoverSettingsStore.test.ts`
Expected: FAIL. The defaults literal is missing `faves`, `radioFavesOf` is not a function, and the round-trip loses `faves`.

- [ ] **Step 3: Implement** in `src/shared/radioSchedule.ts`.

Add, beside the other imports at the top:

```ts
import { DEFAULT_FAVES, normalizeFaves } from './discoverFaves'
```

Replace

```ts
  density?: RadioDensity
}

export function radioDensityOf(settings: RadioSettings): RadioDensity {
  return settings.density ?? DEFAULT_RADIO_DENSITY
}
```

with

```ts
  density?: RadioDensity
  /** The faves dial (@shared/discoverFaves), 0..100: how often a pick is drawn only from
   * 👍-starred stems, and how much the rest lean to them. Discover's roll row and the radio menu
   * set this one value. Optional for the same reason as `density`; normalizeRadioSettings
   * always sets it, and absent reads as 0 (radioFavesOf). */
  faves?: number
}

export function radioDensityOf(settings: RadioSettings): RadioDensity {
  return settings.density ?? DEFAULT_RADIO_DENSITY
}

export function radioFavesOf(settings: RadioSettings): number {
  return normalizeFaves(settings.faves)
}
```

In `DEFAULT_RADIO_SETTINGS`, replace

```ts
  foldSeed: DEFAULT_FOLD_SEED,
  density: DEFAULT_RADIO_DENSITY
}
```

with

```ts
  foldSeed: DEFAULT_FOLD_SEED,
  density: DEFAULT_RADIO_DENSITY,
  faves: DEFAULT_FAVES
}
```

In `normalizeRadioSettings`'s returned object, replace

```ts
    foldSeed: normalizeFoldSeed(raw.foldSeed),
    density: normalizeRadioDensity(raw.density)
  }
}
```

with

```ts
    foldSeed: normalizeFoldSeed(raw.foldSeed),
    density: normalizeRadioDensity(raw.density),
    // A saved `prefer faves: on` (the switch this replaced) reads as 50; a saved faves wins.
    faves: normalizeFaves(raw.faves, (value as { preferFaves?: unknown } | null)?.preferFaves)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/nickel/Claudecode/sssketch && npx vitest run src/shared/radioSchedule.test.ts src/main/discoverSettingsStore.test.ts src/shared/radioDensity.test.ts src/shared/radioFoldSettings.test.ts`
Expected: PASS

- [ ] **Step 5: Typecheck** (the web radio's `WebRadioSettings extends RadioSettings` is unaffected because the field is optional)

Run: `cd /Users/nickel/Claudecode/sssketch && npm run typecheck`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
cd /Users/nickel/Claudecode/sssketch
git add src/shared/radioSchedule.ts src/shared/radioSchedule.test.ts src/main/discoverSettingsStore.test.ts
git commit -F - <<'EOF'
radio settings: faves, persisted with the rest -- 0 by default, a saved prefer faves: on reads as 50, radioFavesOf reads an absent field as 0

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz
EOF
```

---

### Task 4: IPC: a favourites-only restriction before the sample

**Files:**
- Modify: `/Users/nickel/Claudecode/sssketch/src/main/index.ts`
- Modify: `/Users/nickel/Claudecode/sssketch/src/preload/index.ts`

`getDiscoverCandidates` already supports "ONLY these stems may enter any pool, applied BEFORE each pool's bounded random sample", through `artistStemCIDs` for artist mode. The favourites-only draw reuses it, intersected with artist mode through `restrictStems` (tested in Task 1). There is no new main-process logic to unit test. This repo does not test `ipcMain.handle` bodies.

- [ ] **Step 1: Preload.** In `src/preload/index.ts`, replace

```ts
    artist?: string,
    /** Radio fold mode's clash: trait percentiles to attach on top of the slot's own. */
    alsoTraits?: DiscoverTraitKind[]
  ): Promise<DiscoverCandidate[]> =>
    ipcRenderer.invoke(
      'get-discover-candidates',
      kinds,
      onlyOwnStems,
      targetUser,
      soundSource,
      artist,
      alsoTraits
    ),
```

with

```ts
    artist?: string,
    /** Radio fold mode's clash: trait percentiles to attach on top of the slot's own. */
    alsoTraits?: DiscoverTraitKind[],
    /** The faves dial's favourites-only draw: only these stems, before the sample. */
    onlyStemCIDs?: string[]
  ): Promise<DiscoverCandidate[]> =>
    ipcRenderer.invoke(
      'get-discover-candidates',
      kinds,
      onlyOwnStems,
      targetUser,
      soundSource,
      artist,
      alsoTraits,
      onlyStemCIDs
    ),
```

- [ ] **Step 2: Main.** In `src/main/index.ts`, add `import { restrictStems } from '@shared/discoverFaves'` beside the other `@shared` imports. In the `'get-discover-candidates'` handler, replace

```ts
      artist?: string,
      alsoTraits?: DiscoverTraitKind[]
    ): Promise<DiscoverCandidate[]> => {
```

with

```ts
      artist?: string,
      alsoTraits?: DiscoverTraitKind[],
      onlyStemCIDs?: string[]
    ): Promise<DiscoverCandidate[]> => {
```

then replace

```ts
      const artistStemCIDs = artistName
        ? await getArtistStemCIDs([...new Set(jams.map((j) => j.dbForJam))], artistName)
        : undefined
```

with

```ts
      const artistStemCIDs = artistName
        ? await getArtistStemCIDs([...new Set(jams.map((j) => j.dbForJam))], artistName)
        : undefined
      // The faves dial's favourites-only draw (@shared/discoverFaves): the same before-the-sample
      // gate artist mode uses, so a handful of starred stems is not lost in a 1000-stem sample.
      const favesStemCIDs = Array.isArray(onlyStemCIDs)
        ? new Set(onlyStemCIDs.filter((s): s is string => typeof s === 'string'))
        : undefined
```

then replace

```ts
        soundSource,
        artistStemCIDs,
        // Fold mode's clash (radioClash): the renderer only ever sends 'rhythmic' and 'bright'.
```

with

```ts
        soundSource,
        artistStemCIDs: restrictStems(artistStemCIDs, favesStemCIDs),
        // Fold mode's clash (radioClash): the renderer only ever sends 'rhythmic' and 'bright'.
```

- [ ] **Step 3: Typecheck and lint**

Run: `cd /Users/nickel/Claudecode/sssketch && npm run typecheck && npx eslint src/main/index.ts src/preload/index.ts`
Expected: no errors. If `getDiscoverCandidates`' `artistStemCIDs` is typed `Set<string>` rather than `ReadonlySet<string>`, the typecheck fails here. It is declared `ReadonlySet<string>` (`src/main/discoverCandidates.ts`), so it should pass.

- [ ] **Step 4: Commit**

```bash
cd /Users/nickel/Claudecode/sssketch
git add src/main/index.ts src/preload/index.ts
git commit -F - <<'EOF'
get-discover-candidates: onlyStemCIDs, the faves dial's favourites-only pool, gated before the sample like artist mode (intersected with it)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz
EOF
```

---

### Task 5: Discover: the dial replaces `prefer faves`, and the pick uses it

**Files:**
- Modify: `/Users/nickel/Claudecode/sssketch/src/shared/discoverSlotModifier.ts`
- Test: `/Users/nickel/Claudecode/sssketch/src/shared/discoverSlotModifier.test.ts`
- Modify: `/Users/nickel/Claudecode/sssketch/src/renderer/src/components/DiscoverPanel.tsx`

- [ ] **Step 1: Update the modifier tests first (failing).** In `src/shared/discoverSlotModifier.test.ts`, replace the `describe('DISCOVER_SLOT_MODIFIER_OPTIONS', ...)`, `describe('toggleSlotModifier', ...)` and `describe('slotRollOptions', ...)` blocks (everything from `describe('DISCOVER_SLOT_MODIFIER_OPTIONS'` up to, not including, `const ENDLESSS_ONLY`) with:

```ts
describe('DISCOVER_SLOT_MODIFIER_OPTIONS', () => {
  it('is just my sounds: prefer faves became the faves dial (2026-10-03)', () => {
    expect(DISCOVER_SLOT_MODIFIER_OPTIONS).toEqual(['mine'])
  })

  it('has lowercase display labels', () => {
    expect(DISCOVER_SLOT_MODIFIER_LABEL).toEqual({ mine: 'my sounds' })
  })
})

describe('toggleSlotModifier', () => {
  it('turns a modifier on and off, including the last one', () => {
    expect(toggleSlotModifier([], 'mine')).toEqual(['mine'])
    expect(toggleSlotModifier(['mine'], 'mine')).toEqual([])
  })

  it('dedupes', () => {
    expect(toggleSlotModifier(['mine', 'mine'], 'mine')).toEqual([])
  })
})

describe('slotRollOptions', () => {
  const withUser = { hasUsername: true }

  it('defaults to no ownership filter', () => {
    expect(slotRollOptions([], withUser)).toEqual({ onlyOwnStems: false })
  })

  it("'mine' sets onlyOwnStems only with a username", () => {
    expect(slotRollOptions(['mine'], withUser).onlyOwnStems).toBe(true)
    expect(slotRollOptions(['mine'], { hasUsername: false }).onlyOwnStems).toBe(false)
  })
})

```

Run: `cd /Users/nickel/Claudecode/sssketch && npx vitest run src/shared/discoverSlotModifier.test.ts`
Expected: FAIL (options are still `['preferFaves', 'mine']`)

- [ ] **Step 2: Drop `preferFaves`** in `src/shared/discoverSlotModifier.ts`. Replace

```ts
/** Discover's two remaining roll switches (prefer favourites, only my
 * stems). The endlesss/other source switches became the source dial on
 * 2026-09-29 -- see drawSoundSource. */
export type DiscoverSlotModifier = 'preferFaves' | 'mine'

export const DISCOVER_SLOT_MODIFIER_OPTIONS: DiscoverSlotModifier[] = ['preferFaves', 'mine']

export const DISCOVER_SLOT_MODIFIER_LABEL: Record<DiscoverSlotModifier, string> = {
  preferFaves: 'prefer faves',
  mine: 'my sounds'
}
```

with

```ts
/** Discover's one remaining roll switch (only my stems). The endlesss/other
 * source switches became the source dial on 2026-09-29 (drawSoundSource), and
 * `prefer faves` the faves dial on 2026-10-03 (@shared/discoverFaves). */
export type DiscoverSlotModifier = 'mine'

export const DISCOVER_SLOT_MODIFIER_OPTIONS: DiscoverSlotModifier[] = ['mine']

export const DISCOVER_SLOT_MODIFIER_LABEL: Record<DiscoverSlotModifier, string> = {
  mine: 'my sounds'
}
```

then replace

```ts
export interface DiscoverSlotRollOptions {
  onlyOwnStems: boolean
  preferFavourites: boolean
}
```

with

```ts
export interface DiscoverSlotRollOptions {
  onlyOwnStems: boolean
}
```

then replace

```ts
  return {
    onlyOwnStems: set.has('mine') && hasUsername,
    preferFavourites: set.has('preferFaves')
  }
```

with

```ts
  return {
    onlyOwnStems: set.has('mine') && hasUsername
  }
```

Run: `cd /Users/nickel/Claudecode/sssketch && npx vitest run src/shared/discoverSlotModifier.test.ts`
Expected: PASS

- [ ] **Step 3: DiscoverPanel: imports.** In `src/renderer/src/components/DiscoverPanel.tsx`, add:

```ts
import {
  DEFAULT_FAVES,
  FAVES_LABEL,
  FAVES_TOOLTIP,
  favesBoostScale,
  favesDraw
} from '@shared/discoverFaves'
```

Add `radioFavesOf` to the existing `} from '@shared/radioSchedule'` import list (around line 84).

- [ ] **Step 4: The `SlotPick` field.** Replace

```ts
  unranked?: true
```

(inside `interface SlotPick`, the first occurrence, after the doc comment ending `...misreport it as unanalysed (see meterEntries). */`) with

```ts
  unranked?: true
  /** The faves dial drew favourites-only and none fit, so this is a normal pick
   * (@shared/discoverFaves). Logged; the web radio's readout shows it as `no fave fits`. */
  favesFallback?: true
```

- [ ] **Step 5: The dial's state.** Replace

```ts
  function changeSourceLean(lean: number): void {
    sourceLeanRef.current = lean
    setSourceLean(lean)
  }
```

with

```ts
  function changeSourceLean(lean: number): void {
    sourceLeanRef.current = lean
    setSourceLean(lean)
  }
  // The faves dial (@shared/discoverFaves, 2026-10-03), where `prefer faves` was: 0..100, how
  // often a roll draws only starred stems and how much the rest lean to them. Persisted in the
  // radio settings (the radio menu's `faves` row is the same value). A drag previews locally and
  // persists once, on the gesture's end (Dial's onCommit). Mirrored into a ref like sourceLeanRef:
  // radio's picks run from long-lived callbacks.
  const faves = radioFavesOf(radioSettings)
  const [favesDraft, setFavesDraft] = useState<number | null>(null)
  const favesShown = favesDraft ?? faves
  const favesRef = useRef(faves)
  useEffect(() => {
    favesRef.current = faves
  }, [faves])
  function previewFaves(value: number): void {
    favesRef.current = value
    setFavesDraft(value)
  }
  function commitFaves(value: number): void {
    favesRef.current = value
    void onRadioSettingsChange({ faves: value }).finally(() => setFavesDraft(null))
  }
```

- [ ] **Step 6: The pick (`pickForSlot`).** Delete the line

```ts
      const rollOptions = globalRollOptions
```

(keep the comment above it; `rollFilter()` still reads `globalRollOptions`). Then replace this whole block:

```ts
      const draw = drawSoundSource(sourceLeanRef.current)
      // Fold mode's clash (@shared/radioClash), while radio runs: every candidate carries its
      // rhythm and brightness percentiles, and the ranking turns away from the bed's.
      const clashAmount = radioOnRef.current
        ? radioClashAmount(radioSettings.foldMode, radioSettings.clash)
        : 0
      const alsoTraits = clashAmount > 0 ? [...CLASH_TRAITS] : undefined
      // Tagged with the artist they were rolled under (pickedUnderArtist).
      let candidates = (
        await window.rifffApi.getDiscoverCandidates(
          kinds,
          f.onlyOwnStems,
          f.targetUser,
          draw.first,
          f.artist,
          alsoTraits
        )
      ).map((c) => tagPickedUnderArtist(c, f.artist))
      const drawnHasUnused = candidates.some((c) => !usedElsewhere.has(c.stemCID))
      if (!drawnHasUnused && draw.fallback !== null) {
        if (rerollGenerationRef.current.get(id) !== myGeneration) return null
        const fallbackCandidates = (
          await window.rifffApi.getDiscoverCandidates(
            kinds,
            f.onlyOwnStems,
            f.targetUser,
            draw.fallback,
            f.artist,
            alsoTraits
          )
        ).map((c) => tagPickedUnderArtist(c, f.artist))
        // Switch to the fallback when it has something new, or when the
        // drawn source had nothing at all. Otherwise keep the drawn pool,
        // all duplicates -- the dedupe below then uses it whole, which
        // beats reporting "no match".
        const fallbackHasUnused = fallbackCandidates.some((c) => !usedElsewhere.has(c.stemCID))
        if (fallbackHasUnused || candidates.length === 0) candidates = fallbackCandidates
      }
```

with:

```ts
      const draw = drawSoundSource(sourceLeanRef.current)
      // Fold mode's clash (@shared/radioClash), while radio runs: every candidate carries its
      // rhythm and brightness percentiles, and the ranking turns away from the bed's.
      const clashAmount = radioOnRef.current
        ? radioClashAmount(radioSettings.foldMode, radioSettings.clash)
        : 0
      const alsoTraits = clashAmount > 0 ? [...CLASH_TRAITS] : undefined
      const unused = (c: DiscoverCandidate): boolean => !usedElsewhere.has(c.stemCID)
      /** One source-dial roll: the drawn source, then the other when the drawn one has nothing
       * new. `only` restricts it to those stems, before main's sample (the faves dial's
       * favourites-only draw). Tagged with the artist they were rolled under
       * (pickedUnderArtist). Null when a newer roll for this slot took over meanwhile. */
      const fetchPool = async (only?: string[]): Promise<DiscoverCandidate[] | null> => {
        let pool = (
          await window.rifffApi.getDiscoverCandidates(
            kinds,
            f.onlyOwnStems,
            f.targetUser,
            draw.first,
            f.artist,
            alsoTraits,
            only
          )
        ).map((c) => tagPickedUnderArtist(c, f.artist))
        if (!pool.some(unused) && draw.fallback !== null) {
          if (rerollGenerationRef.current.get(id) !== myGeneration) return null
          const fallbackPool = (
            await window.rifffApi.getDiscoverCandidates(
              kinds,
              f.onlyOwnStems,
              f.targetUser,
              draw.fallback,
              f.artist,
              alsoTraits,
              only
            )
          ).map((c) => tagPickedUnderArtist(c, f.artist))
          // Switch to the fallback when it has something new, or when the
          // drawn source had nothing at all. Otherwise keep the drawn pool,
          // all duplicates -- the dedupe below then uses it whole, which
          // beats reporting "no match".
          if (fallbackPool.some(unused) || pool.length === 0) pool = fallbackPool
        }
        return pool
      }
      // The faves dial (@shared/discoverFaves): with probability faves/100 this roll draws only
      // starred stems, under every other rule of the slot; when none fits (none starred, none of
      // this kind or source, or all already on other rows) it rolls as usual and says so. Off in
      // artist mode, where the dial is dimmed: your stars are not among the artist's stems.
      const faves = f.artist === undefined ? favesRef.current : 0
      let favesFallback = false
      let candidates: DiscoverCandidate[] | null = null
      if (favesDraw(faves) === 'only') {
        const favePool = stemFavourites.size > 0 ? await fetchPool([...stemFavourites]) : []
        if (favePool === null) return null
        if (favePool.some(unused)) candidates = favePool
        else favesFallback = true
      }
      if (candidates === null) {
        if (rerollGenerationRef.current.get(id) !== myGeneration) return null
        candidates = await fetchPool()
        if (candidates === null) return null
      }
      if (favesFallback)
        console.log(`DiscoverPanel: pickForSlot(${slotKindsKey(kinds)}) -- no fave fits`)
```

(`DiscoverCandidate` is already imported at the top of the file, from `'../../../main/discoverCandidates'`.)

- [ ] **Step 7: The ranking.** Replace

```ts
        // Off in artist mode, where the toggle is dimmed: your stars are
        // not among the artist's stems.
        favouriteStemCIDs:
          rollOptions.preferFavourites && f.artist === undefined ? stemFavourites : undefined,
```

with

```ts
        // The faves dial's lean: faves/100 of the favourites boost (0 in artist mode, above).
        favouriteStemCIDs: faves > 0 ? stemFavourites : undefined,
        favouriteScale: favesBoostScale(faves),
```

Then replace

```ts
        `DiscoverPanel: pickForSlot(${slotKindsKey(kinds)}) -- ranked/picked, returning pick (picked=${picked?.stemCID ?? 'null'})`
      )
      return { candidate: picked, barUsed, barRequested: traitMatchBar }
```

with

```ts
        `DiscoverPanel: pickForSlot(${slotKindsKey(kinds)}) -- ranked/picked, returning pick (picked=${picked?.stemCID ?? 'null'})`
      )
      return {
        candidate: picked,
        barUsed,
        barRequested: traitMatchBar,
        ...(favesFallback ? { favesFallback: true as const } : {})
      }
```

- [ ] **Step 8: The dial in the roll-modifier row.** Replace

```tsx
          {/* Global roll filters -- see globalModifiers. */}
          <div
            style={{
              display: 'flex',
              gap: 8,
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            {DISCOVER_SLOT_MODIFIER_OPTIONS.map((modifier) => {
              const needsUsername = modifier === 'mine' && !hasUsername
              // Artist mode picks the artist's stems: `my sounds` is moot, and
              // `prefer faves` too -- your stars are not among their stems.
```

with

```tsx
          {/* Global roll filters -- see globalModifiers -- and the faves dial where `prefer
              faves` sat (@shared/discoverFaves): 0 no lean, 100 only starred stems (a roll with
              none that fits rolls as usual). Dimmed in artist mode: your stars are not among
              the artist's stems. */}
          <div
            style={{
              display: 'flex',
              gap: 8,
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                opacity: mode === 'other' ? 0.4 : 1
              }}
            >
              <Dial
                value={favesShown}
                onChange={previewFaves}
                onCommit={commitFaves}
                defaultValue={DEFAULT_FAVES}
                size={22}
                ariaLabel={FAVES_LABEL}
                tooltip={mode === 'other' ? `artist mode picks ${artist}'s stems` : FAVES_TOOLTIP}
              />
              <span style={{ fontSize: 8, color: 'var(--ra-text-3)' }}>{FAVES_LABEL}</span>
            </span>
            {DISCOVER_SLOT_MODIFIER_OPTIONS.map((modifier) => {
              const needsUsername = modifier === 'mine' && !hasUsername
              // Artist mode picks the artist's stems: `my sounds` is moot.
```

Also update the comment above `globalModifiers` (`// Direct request, 2026-09-22: the roll filters (prefer faves, my sounds;`) so it reads `// Direct request, 2026-09-22: the roll filters (my sounds -- prefer faves became the faves dial on 2026-10-03; the endlesss/other pair became the source dial on 2026-09-29) are`. The rest of that comment stays.

- [ ] **Step 9: Typecheck, lint, full tests**

Run: `cd /Users/nickel/Claudecode/sssketch && npm run typecheck && npm run lint && npx vitest run`
Expected: typecheck clean, lint clean (in particular no unused `rollOptions`), all tests pass.

If `grep -n "preferFavourites\|preferFaves" -r src` prints anything other than `src/shared/radioSchedule.ts` (the migration read) and the tests from Tasks 1 and 3, fix it before committing.

- [ ] **Step 10: Commit**

```bash
cd /Users/nickel/Claudecode/sssketch
git add src/shared/discoverSlotModifier.ts src/shared/discoverSlotModifier.test.ts src/renderer/src/components/DiscoverPanel.tsx
git commit -F - <<'EOF'
discover: the faves dial replaces prefer faves -- a roll draws only starred stems with probability faves/100 (before main's sample, every slot rule kept), falling back to a normal roll when none fits; the rest lean by faves/100 of the boost; dimmed in artist mode; persisted with the radio settings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz
EOF
```

---

### Task 6: The radio menu's `faves` row

**Files:**
- Modify: `/Users/nickel/Claudecode/sssketch/src/renderer/src/components/DiscoverRadioMenu.tsx`

React components are verified by typecheck and lint here (CLAUDE.md, Testing conventions).

- [ ] **Step 1: Imports.** Replace

```ts
import { RADIO_DENSITY_OPTIONS, radioDensityOf } from '@shared/radioSchedule'
```

with

```ts
import { RADIO_DENSITY_OPTIONS, radioDensityOf, radioFavesOf } from '@shared/radioSchedule'
import { FAVES_LABEL, FAVES_TOOLTIP } from '@shared/discoverFaves'
```

- [ ] **Step 2: The row.** Replace

```tsx
      {/* Fold mode (@shared/radioFold): one anchor at full length, one or two short rhythmic
```

with

```tsx
      {/* The faves dial (@shared/discoverFaves): the same value as Discover's dial -- how often
          a pick is drawn only from starred stems, and how much the rest lean to them. A fader
          like bend's, committed on release so a drag writes the settings once. */}
      {mode === 'running' &&
        row(
          FAVES_LABEL,
          [
            <FoldSlider
              key="faves"
              label={FAVES_LABEL}
              value={radioFavesOf(settings)}
              onCommit={(v) => onChange({ faves: v })}
            />
          ],
          FAVES_TOOLTIP
        )}
      {/* Fold mode (@shared/radioFold): one anchor at full length, one or two short rhythmic
```

- [ ] **Step 3: Typecheck and lint**

Run: `cd /Users/nickel/Claudecode/sssketch && npm run typecheck && npx eslint src/renderer/src/components/DiscoverRadioMenu.tsx`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
cd /Users/nickel/Claudecode/sssketch
git add src/renderer/src/components/DiscoverRadioMenu.tsx
git commit -F - <<'EOF'
radio menu: the faves row, a fader on the same value as discover's dial, committed on release

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz
EOF
```

---

### Task 7: Web picker: `faves` in `pick.ts`

**Files:**
- Modify: `/Users/nickel/Claudecode/ell.ing/radio/src/radio/pick.ts`
- Test: `/Users/nickel/Claudecode/ell.ing/radio/src/radio/pick.test.ts`

Precondition: run the check under "Before the web tasks" (step.ts work landed, tree clean, `npx vitest run` green).

- [ ] **Step 1: Write the failing tests.** Append to `src/radio/pick.test.ts` (it already has `seeded`, `rec`, `base`, the mask constants and imports `buildPickIndex`, `pickStem`, `PICK_SAMPLE_SIZE`):

```ts
describe('pickStem: the faves dial (@shared/discoverFaves)', () => {
  // drums and bass from both sources, a third of the drums loved
  const records = [
    ...Array.from({ length: 30 }, (_, i) => rec(`d${i}`, { mask: DRUMS, bpm: 100 + i })),
    ...Array.from({ length: 30 }, (_, i) => rec(`a${i}`, { mask: AUDIO_IN, role: 'drums', roleSource: 'confirmed', bpm: 100 + i })),
    ...Array.from({ length: 10 }, (_, i) => rec(`b${i}`, { mask: BASS }))
  ]
  const lovedIds = new Set(records.filter((_, i) => i % 3 === 0).map((r) => r.id))
  const loved = (id: string): number => (lovedIds.has(id) ? 0.29 : 0)
  const index = buildPickIndex(records)

  it('at 0, every pick (and the random stream after it) is exactly as without the dial, across many seeds', () => {
    for (let s = 1; s <= 200; s++) {
      const ra = seeded(s)
      const rb = seeded(s)
      const opts = base(['drums'], { chaos: 75, loved, sourceLean: 50, usedElsewhere: new Set(['d3']) })
      const a = pickStem(index, { ...opts, random: ra })
      const b = pickStem(index, { ...opts, faves: 0, random: rb })
      expect(b?.record.id).toBe(a?.record.id)
      expect(b?.source).toBe(a?.source)
      expect(b?.favesFallback).toBeUndefined()
      expect(rb()).toBe(ra())
    }
  })

  it('at 100, every pick is a favourite while one fits', () => {
    for (let s = 1; s <= 200; s++) {
      const p = pickStem(index, base(['drums'], { chaos: 100, loved, faves: 100, random: seeded(s) }))
      expect(lovedIds.has(p!.record.id)).toBe(true)
      expect(p!.favesFallback).toBeUndefined()
    }
  })

  it('keeps every slot rule: a loved bass stem never lands on drums -- the pick falls back', () => {
    const onlyBassLoved = (id: string): number => (id === 'b0' ? 1 : 0)
    const p = pickStem(index, base(['drums'], { loved: onlyBassLoved, faves: 100, random: seeded(1) }))
    expect(p!.record.id).not.toBe('b0')
    expect(p!.favesFallback).toBe(true)
  })

  it('falls back with nothing loved at all', () => {
    const p = pickStem(index, base(['drums'], { faves: 100, random: seeded(2) }))
    expect(p).not.toBeNull()
    expect(p!.favesFallback).toBe(true)
  })

  it('a favourite already on another row does not fit: the pick falls back rather than duplicate it', () => {
    const one = (id: string): number => (id === 'd0' ? 1 : 0)
    const p = pickStem(index, base(['drums'], { loved: one, faves: 100, sourceLean: 0, usedElsewhere: new Set(['d0']), random: seeded(3) }))
    expect(p!.record.id).not.toBe('d0')
    expect(p!.favesFallback).toBe(true)
  })

  it('reaches a favourite the 1000-stem sample would miss: the filter comes before the sample', () => {
    const many = Array.from({ length: PICK_SAMPLE_SIZE * 3 }, (_, i) => rec(`m${i}`, { mask: DRUMS }))
    const big = buildPickIndex(many)
    const one = (id: string): number => (id === 'm2999' ? 1 : 0)
    for (let s = 1; s <= 20; s++) {
      const p = pickStem(big, base(['drums'], { sourceLean: 0, loved: one, faves: 100, random: seeded(s) }))
      expect(p!.record.id).toBe('m2999')
    }
  })

  it('in between, about faves/100 of picks are drawn from favourites', () => {
    const many = Array.from({ length: PICK_SAMPLE_SIZE * 3 }, (_, i) => rec(`m${i}`, { mask: DRUMS }))
    const big = buildPickIndex(many)
    const one = (id: string): number => (id === 'm7' ? 1 : 0)
    let hits = 0
    const n = 600
    for (let s = 1; s <= n; s++) {
      const p = pickStem(big, base(['drums'], { chaos: 100, sourceLean: 0, loved: one, faves: 50, random: seeded(s) }))
      if (p!.record.id === 'm7') hits++
    }
    // ~50% from the draw, plus a sliver from normal picks that sampled and ranked it up
    expect(hits / n).toBeGreaterThan(0.42)
    expect(hits / n).toBeLessThan(0.6)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/nickel/Claudecode/ell.ing/radio && npx vitest run src/radio/pick.test.ts`
Expected: FAIL. The faves tests fail: at 100, picks are not all loved, and `favesFallback` is undefined where `true` is expected. The 0-identity test may already pass, which is fine. It guards the change.

- [ ] **Step 3: Implement** in `src/radio/pick.ts`.

Add to the imports:

```ts
import { favesDraw } from '@shared/discoverFaves'
```

In the header comment, replace the line

```ts
//   rank     @shared/discoverRanking rankCandidates against the transport
```

with

```ts
//   faves    @shared/discoverFaves favesDraw: with probability faves/100 the
//            pool is only loved stems (filtered BEFORE the sample, every rule
//            above kept), falling back to the normal pool when none fits
//   rank     @shared/discoverRanking rankCandidates against the transport
```

In `PickOptions`, replace

```ts
  /** Fold mode's clash (@shared/radioClash): passed to rankCandidates. Absent: as before. */
  clash?: RankClash
  random?: () => number
}
```

with

```ts
  /** Fold mode's clash (@shared/radioClash): passed to rankCandidates. Absent: as before. */
  clash?: RankClash
  /** The faves dial, 0..100 (@shared/discoverFaves): how often a pick is drawn only from loved
   * stems (loved > 0). Absent or 0: exactly as before -- the draw never touches `random` there.
   * The loved boost in the ranking is unchanged at every position (it predates the dial). */
  faves?: number
  random?: () => number
}
```

In `Pick`, replace

```ts
  /** The source the pool was drawn from, after any fallback. */
  source: 'endlesss' | 'audioIn'
}
```

with

```ts
  /** The source the pool was drawn from, after any fallback. */
  source: 'endlesss' | 'audioIn'
  /** The faves dial drew loved-only and none fit, so this is a normal pick (`no fave fits`). */
  favesFallback?: true
}
```

Add after `function emptyBucket()`:

```ts
/** A bucket with only the records `keep` admits (the faves dial's loved-only pool). */
function keepBucket(b: Bucket, keep: (r: IndexRecord) => boolean): Bucket {
  return { endlesss: b.endlesss.filter(keep), audioIn: b.audioIn.filter(keep) }
}
```

In `poolFor`, replace the signature and the two sampling call sites:

```ts
function poolFor(
  index: PickIndex,
  slotKinds: DiscoverSlotKind[],
  maskKinds: DiscoverMaskKind[],
  source: DiscoverSoundSourceFilter,
  random: () => number
): Pool {
```

becomes

```ts
function poolFor(
  index: PickIndex,
  slotKinds: DiscoverSlotKind[],
  maskKinds: DiscoverMaskKind[],
  source: DiscoverSoundSourceFilter,
  random: () => number,
  keep?: (r: IndexRecord) => boolean
): Pool {
```

```ts
    for (const r of sampleTraitPool(index.withTraits, source, random)) {
```

becomes

```ts
    for (const r of sampleTraitPool(keep ? index.withTraits.filter(keep) : index.withTraits, source, random)) {
```

```ts
    for (const r of sample(index.byMaskKind[kind], source, random)) {
```

becomes

```ts
    const bucket = keep ? keepBucket(index.byMaskKind[kind], keep) : index.byMaskKind[kind]
    for (const r of sample(bucket, source, random)) {
```

In `pickStem`, replace

```ts
    loved,
    clash,
    random = Math.random
  } = opts
```

with

```ts
    loved,
    clash,
    faves = 0,
    random = Math.random
  } = opts
```

and replace this block:

```ts
  const unused = (c: DiscoverCandidate): boolean => !usedElsewhere?.has(c.stemCID)
  const draw = drawSoundSource(sourceLean, random)
  let source = draw.first
  let pool = poolFor(index, slotKinds, maskKinds, draw.first, random)
  if (!pool.candidates.some(unused) && draw.fallback !== null) {
    const fallback = poolFor(index, slotKinds, maskKinds, draw.fallback, random)
    if (fallback.candidates.some(unused) || pool.candidates.length === 0) {
      pool = fallback
      source = draw.fallback
    }
  }
  const { candidates, records } = pool
```

with

```ts
  const unused = (c: DiscoverCandidate): boolean => !usedElsewhere?.has(c.stemCID)
  /** One source-dial roll over the records `keep` admits (all when absent). */
  const drawPool = (keep?: (r: IndexRecord) => boolean): { pool: Pool; source: DiscoverSoundSourceFilter } => {
    const draw = drawSoundSource(sourceLean, random)
    let source = draw.first
    let pool = poolFor(index, slotKinds, maskKinds, draw.first, random, keep)
    if (!pool.candidates.some(unused) && draw.fallback !== null) {
      const fallback = poolFor(index, slotKinds, maskKinds, draw.fallback, random, keep)
      if (fallback.candidates.some(unused) || pool.candidates.length === 0) {
        pool = fallback
        source = draw.fallback
      }
    }
    return { pool, source }
  }
  // The faves dial (@shared/discoverFaves): loved-only with probability faves/100, filtered
  // before the sample so a few loved stems are not lost among thousands; when none fits (none
  // loved, none of this kind or source, or all on other rows), a normal pick that says so.
  let drawn: { pool: Pool; source: DiscoverSoundSourceFilter } | null = null
  let favesFallback = false
  if (favesDraw(faves, random) === 'only') {
    const faved = loved ? drawPool((r) => loved(r.id) > 0) : null
    if (faved && faved.pool.candidates.some(unused)) drawn = faved
    else favesFallback = true
  }
  drawn ??= drawPool()
  const { source } = drawn
  const { candidates, records } = drawn.pool
```

Finally replace

```ts
  return {
    record: records.get(candidate.stemCID)!,
    candidate,
    barUsed,
    source: sourceName(source)
  }
```

with

```ts
  return {
    record: records.get(candidate.stemCID)!,
    candidate,
    barUsed,
    source: sourceName(source),
    ...(favesFallback ? { favesFallback: true as const } : {})
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/nickel/Claudecode/ell.ing/radio && npx vitest run src/radio/pick.test.ts src/radio/indexPicker.test.ts`
Expected: PASS (the old pick tests unchanged too)

- [ ] **Step 5: Typecheck**

Run: `cd /Users/nickel/Claudecode/ell.ing/radio && npm run typecheck`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
cd /Users/nickel/Claudecode/ell.ing/radio
git add src/radio/pick.ts src/radio/pick.test.ts
git commit -F - <<'EOF'
picker: the faves dial -- with probability faves/100 a pick draws only loved stems (likes and hearts), filtered before the sample with every slot rule kept, falling back to a normal pick marked favesFallback; at 0 every pick and the random stream are unchanged

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz
EOF
```

---

### Task 8: Web: `radio.faves` prefs, the controller, the full-mode knob, `no fave fits`

**Files:**
- Create: `/Users/nickel/Claudecode/ell.ing/radio/src/ui/favesPrefs.ts`
- Test: `/Users/nickel/Claudecode/ell.ing/radio/src/ui/favesPrefs.test.ts`
- Modify: `/Users/nickel/Claudecode/ell.ing/radio/src/radio/controller.ts`
- Test: `/Users/nickel/Claudecode/ell.ing/radio/src/radio/controller.test.ts`, `/Users/nickel/Claudecode/ell.ing/radio/src/radio/indexPicker.test.ts`
- Modify: `/Users/nickel/Claudecode/ell.ing/radio/src/ui/full.ts`, `/Users/nickel/Claudecode/ell.ing/radio/src/main.ts`

- [ ] **Step 1: Prefs test (failing)**

```ts
// src/ui/favesPrefs.test.ts
import { describe, expect, it } from 'vitest'
import { FAVES_KEY, loadFaves, saveFaves } from './favesPrefs'

const memory = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init))
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }
}
const throwing = {
  getItem: () => {
    throw new Error('blocked')
  },
  setItem: () => {
    throw new Error('blocked')
  }
}

describe('the faves dial (radio.faves)', () => {
  it('0 until set; a set value is remembered', () => {
    const s = memory()
    expect(FAVES_KEY).toBe('radio.faves')
    expect(loadFaves(s)).toBe(0)
    saveFaves(65, s)
    expect(s.m.get(FAVES_KEY)).toBe('65')
    expect(loadFaves(s)).toBe(65)
  })

  it('clamps and rounds; anything unreadable is 0', () => {
    expect(loadFaves(memory({ [FAVES_KEY]: '140' }))).toBe(100)
    expect(loadFaves(memory({ [FAVES_KEY]: '33.6' }))).toBe(34)
    expect(loadFaves(memory({ [FAVES_KEY]: 'lots' }))).toBe(0)
    expect(loadFaves(memory({ [FAVES_KEY]: '{"a":1}' }))).toBe(0)
  })

  it('without storage: 0, and saving never throws', () => {
    expect(loadFaves(null)).toBe(0)
    expect(loadFaves(throwing)).toBe(0)
    expect(() => saveFaves(50, throwing)).not.toThrow()
  })
})
```

Run: `cd /Users/nickel/Claudecode/ell.ing/radio && npx vitest run src/ui/favesPrefs.test.ts`
Expected: FAIL, "Failed to resolve import './favesPrefs'"

- [ ] **Step 2: Prefs module**

```ts
// src/ui/favesPrefs.ts -- the listener's faves dial (full mode's strip; sssketch spec
// 2026-10-03-radio-faves-dial-design): 0..100, how much the radio sticks to loved stems,
// remembered per visitor in localStorage['radio.faves'] and given to the radio when it is made,
// and on every change. Missing or unreadable: 0, the radio as before.
import { DEFAULT_FAVES, normalizeFaves } from '@shared/discoverFaves'

export const FAVES_KEY = 'radio.faves'

type PrefsStorage = Pick<Storage, 'getItem' | 'setItem'> | null

export function loadFaves(storage: PrefsStorage): number {
  try {
    const raw = storage?.getItem(FAVES_KEY)
    const v: unknown = raw ? JSON.parse(raw) : null
    return normalizeFaves(v)
  } catch {
    return DEFAULT_FAVES
  }
}

export function saveFaves(faves: number, storage: PrefsStorage): void {
  try {
    storage?.setItem(FAVES_KEY, JSON.stringify(normalizeFaves(faves)))
  } catch {
    // not remembered past this visit
  }
}
```

Run: `cd /Users/nickel/Claudecode/ell.ing/radio && npx vitest run src/ui/favesPrefs.test.ts`
Expected: PASS

- [ ] **Step 3: Controller tests (failing).**

In `src/radio/controller.test.ts`, widen the fake picker. Replace

```ts
  const picks: { kinds: DiscoverSlotKind[]; used: string[]; targetBpm: number; id: string | null; loved?: (id: string) => number }[] = []
```

with

```ts
  const picks: { kinds: DiscoverSlotKind[]; used: string[]; targetBpm: number; id: string | null; loved?: (id: string) => number; faves?: number }[] = []
  /** When set, every pick reports that no fave fit. */
  const noFaveFits = { on: false }
```

Replace

```ts
    o: { usedElsewhere: ReadonlySet<string>; targetBpm: number; loved?: (id: string) => number }
```

with

```ts
    o: { usedElsewhere: ReadonlySet<string>; targetBpm: number; loved?: (id: string) => number; faves?: number; onFavesFallback?: () => void }
```

Replace

```ts
    picks.push({ kinds: [...kinds], used: [...o.usedElsewhere], targetBpm: o.targetBpm, id: r?.id ?? null, loved: o.loved })
    return r
  }
  return { pick, picks }
```

with

```ts
    picks.push({ kinds: [...kinds], used: [...o.usedElsewhere], targetBpm: o.targetBpm, id: r?.id ?? null, loved: o.loved, faves: o.faves })
    if (noFaveFits.on) o.onFavesFallback?.()
    return r
  }
  return { pick, picks, noFaveFits }
```

Then, in `rig(...)`, replace `const { pick, picks } = picker(opts.barsOf)` with `const { pick, picks, noFaveFits } = picker(opts.barsOf)`. Add `noFaveFits` beside `picks,` in the object `rig` returns. In `interface Rig`, below `picks: ReturnType<typeof picker>['picks']`, add `noFaveFits: { on: boolean }`.

Append:

```ts
// ---- the faves dial ----

describe('setFaves', () => {
  it('passes the dial to every pick from then on; 0 passes none', async () => {
    const r = rig({ settings: { paceBars: { min: 4, max: 4 } } })
    await started(r)
    expect(r.picks.every((p) => p.faves === undefined)).toBe(true)
    r.ctl.setFaves(70)
    const before = r.picks.length
    await r.run(r.eng.lap() * 3)
    expect(r.picks.length).toBeGreaterThan(before)
    expect(r.picks.slice(before).every((p) => p.faves === 70)).toBe(true)
    r.ctl.setFaves(0)
    const after = r.picks.length
    await r.run(r.eng.lap() * 3)
    expect(r.picks.length).toBeGreaterThan(after)
    expect(r.picks.slice(after).every((p) => p.faves === undefined)).toBe(true)
  })

  it('a pick where no fave fits flashes `no fave fits` on its row', async () => {
    const r = rig({ settings: { paceBars: { min: 4, max: 4 } } })
    await started(r)
    r.ctl.setFaves(100)
    r.noFaveFits.on = true
    // a flash is pruned a bar after it shows, so look for it as the radio runs
    let seen = false
    for (let i = 0; i < 400 && !seen; i++) {
      await r.run(0.1)
      seen = r.ctl.flashLog().some((f) => f.word === 'no fave fits')
    }
    expect(seen).toBe(true)
  })
})
```

In `src/radio/indexPicker.test.ts`, append:

```ts
describe('indexPicker: the faves dial', () => {
  it('passes faves through and calls onFavesFallback when no fave fits', () => {
    const index = pick.buildPickIndex([rec('d1'), rec('d2')])
    const onFavesFallback = vi.fn()
    const picker = indexPicker(index, seeded(1))
    // nothing loved: a faves-100 pick falls back
    expect(picker(['drums'], { usedElsewhere: new Set(), targetBpm: 120, faves: 100, onFavesFallback })).not.toBeNull()
    expect(onFavesFallback).toHaveBeenCalledTimes(1)
    // d2 loved: it fits, no callback
    picker(['drums'], { usedElsewhere: new Set(), targetBpm: 120, faves: 100, loved: (id) => (id === 'd2' ? 1 : 0), onFavesFallback })
    expect(onFavesFallback).toHaveBeenCalledTimes(1)
  })
})
```

Run: `cd /Users/nickel/Claudecode/ell.ing/radio && npx vitest run src/radio/controller.test.ts src/radio/indexPicker.test.ts`
Expected: FAIL (`r.ctl.setFaves is not a function`; the picker ignores `faves`)

- [ ] **Step 4: Controller.** In `src/radio/controller.ts`:

Replace

```ts
import { RADIO_THROW_WORD, dropRadioFlashes, pruneRadioFlashes, radioGestureFlashWord, type RadioFlash } from '@shared/radioReadout'
```

with

```ts
import { RADIO_THROW_WORD, dropRadioFlashes, pruneRadioFlashes, radioGestureFlashWord, type RadioFlash } from '@shared/radioReadout'
import { NO_FAVE_FITS, normalizeFaves } from '@shared/discoverFaves'
```

In `RadioPicker`, replace

```ts
    /** Fold mode's clash for this pick (@shared/radioClash). */
    clash?: RankClash
  }
) => IndexRecord | null
```

with

```ts
    /** Fold mode's clash for this pick (@shared/radioClash). */
    clash?: RankClash
    /** The faves dial, 0..100 (@shared/discoverFaves). Absent: 0. */
    faves?: number
    /** Called when the pick drew loved-only, none fit, and it picked as usual. */
    onFavesFallback?: () => void
  }
) => IndexRecord | null
```

Replace

```ts
  return (kinds, { usedElsewhere, targetBpm, loved, clash }) =>
    pickStem(index, { kinds, targetBpm, usedElsewhere, random, loved, chaos, clash })?.record ?? null
}
```

with

```ts
  return (kinds, { usedElsewhere, targetBpm, loved, clash, faves, onFavesFallback }) => {
    const p = pickStem(index, { kinds, targetBpm, usedElsewhere, random, loved, chaos, clash, faves })
    if (p?.favesFallback) onFavesFallback?.()
    return p?.record ?? null
  }
}
```

Replace

```ts
  private loved: ((id: string) => number) | null = null
```

with

```ts
  private loved: ((id: string) => number) | null = null
  /** The faves dial, 0..100 (ui/favesPrefs.ts); 0 passes nothing to the picker. */
  private faves = 0
```

Replace

```ts
  setLoved(loved: ((id: string) => number) | null): void {
    this.loved = loved
  }
```

with

```ts
  setLoved(loved: ((id: string) => number) | null): void {
    this.loved = loved
  }
  /** The faves dial (@shared/discoverFaves), 0..100, for every pick from now on. */
  setFaves(faves: number): void {
    this.faves = normalizeFaves(faves)
  }
```

In `run`'s `case 'arm'`, replace

```ts
            ...(this.loved ? { loved: this.loved } : {}),
            ...(a.clash ? { clash: a.clash } : {})
          })
```

with

```ts
            ...(this.loved ? { loved: this.loved } : {}),
            ...(a.clash ? { clash: a.clash } : {}),
            // the readout says so on the row when a loved-only pick found none that fits
            ...(this.faves > 0
              ? {
                  faves: this.faves,
                  onFavesFallback: () => this.flash(a.slot, NO_FAVE_FITS, e.now, `fave@${a.token}`)
                }
              : {})
          })
```

(`e` is `this.deps.engine`, declared at the top of `run`. `a.token` is the arm's token, already used in the `picked` event just below.)

Run: `cd /Users/nickel/Claudecode/ell.ing/radio && npx vitest run src/radio/controller.test.ts src/radio/indexPicker.test.ts`
Expected: PASS

- [ ] **Step 5: Full mode's knob.** In `src/ui/full.ts`, add the import:

```ts
import { FAVES_LABEL, FAVES_TOOLTIP } from '@shared/discoverFaves'
```

In `FullHandlers`, replace

```ts
  /** The listener's fold mode controls (ui/foldPrefs.ts): read, and set. */
  readFold(): FoldPrefs
  fold(p: FoldPrefs): void
```

with

```ts
  /** The listener's fold mode controls (ui/foldPrefs.ts): read, and set. */
  readFold(): FoldPrefs
  fold(p: FoldPrefs): void
  /** The faves dial, 0..100 (ui/favesPrefs.ts): read, and set. */
  readFaves(): number
  faves(n: number): void
```

Replace

```ts
  const fxRanges = FX_NAMES.map((name) => range(name, name, fx0[name], (v) => on.fx({ ...on.readFx(), [name]: v })))
```

with

```ts
  const fxRanges = FX_NAMES.map((name) => range(name, name, fx0[name], (v) => on.fx({ ...on.readFx(), [name]: v })))
  // the faves dial (ui/favesPrefs.ts), first in the strip: how much to stick to loved stems (your
  // 👍 and the crowd's ♥); a knob like the others, so it wraps with them on a phone
  const favesKnob = range(FAVES_LABEL, FAVES_LABEL, on.readFaves() / 100, (v) => on.faves(Math.round(v * 100)))
  favesKnob.wrap.title = FAVES_TOOLTIP
```

and in the `masterGrp.append(` line, replace its start `masterGrp.append(level.wrap, reverb.wrap,` with `masterGrp.append(favesKnob.wrap, level.wrap, reverb.wrap,`. The rest of that line stays as it is.

- [ ] **Step 6: Wiring.** In `src/main.ts`, add the import beside the fold prefs import:

```ts
import { loadFaves, saveFaves } from './ui/favesPrefs'
```

Replace

```ts
let fold: FoldPrefs = loadFoldPrefs(localStore(), FOLD_DEFAULTS)
```

with

```ts
let fold: FoldPrefs = loadFoldPrefs(localStore(), FOLD_DEFAULTS)
/** The faves dial (full mode's strip), remembered per visitor; 0 until set. Given to the radio when
 * it is made (withLoved), and on every change. */
let faves = loadFaves(localStore())
```

In the `mountFull(` handlers, replace

```ts
    readFold: () => fold,
    fold: (p) => setFold(p),
```

with

```ts
    readFold: () => fold,
    fold: (p) => setFold(p),
    readFaves: () => faves,
    faves: (n) => {
      faves = n
      saveFaves(n, localStore())
      radio?.setFaves(n)
    },
```

Replace

```ts
function withLoved(r: RadioController): RadioController {
  r.setLoved(loved)
  return r
}
```

with

```ts
function withLoved(r: RadioController): RadioController {
  r.setLoved(loved)
  r.setFaves(faves)
  return r
}
```

- [ ] **Step 7: Typecheck and full tests**

Run: `cd /Users/nickel/Claudecode/ell.ing/radio && npm run typecheck && npx vitest run`
Expected: typecheck clean, all tests pass.

- [ ] **Step 8: Commit**

```bash
cd /Users/nickel/Claudecode/ell.ing/radio
git add src/ui/favesPrefs.ts src/ui/favesPrefs.test.ts src/radio/controller.ts src/radio/controller.test.ts src/radio/indexPicker.test.ts src/ui/full.ts src/main.ts
git commit -F - <<'EOF'
full mode: the faves dial -- a knob first in the strip, remembered per visitor (radio.faves), given to every pick; a loved-only pick with none that fits flashes no fave fits on its row

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz
EOF
```

---

### Task 9: Verification and Elling's walkthrough

- [ ] **Step 1: sssketch, everything**

Run: `cd /Users/nickel/Claudecode/sssketch && npm run typecheck && npm run lint && npx vitest run`
Expected: all clean and green. (Engine-spawn test failures caused by a stuck `coreaudiod` are the machine, not the code; see memory `coreaudiod_thread_leak.md`.)

- [ ] **Step 2: ell.ing/radio, everything**

Run: `cd /Users/nickel/Claudecode/ell.ing/radio && npm run typecheck && npx vitest run && npm run build`
Expected: all clean and green, and the build succeeds.

- [ ] **Step 3: Leftovers**

Run: `grep -rn "preferFaves\|preferFavourites\|prefer faves" /Users/nickel/Claudecode/sssketch/src /Users/nickel/Claudecode/ell.ing/radio/src`
Expected: only the migration in `src/shared/radioSchedule.ts`, `discoverFaves.ts`'s comment, the migration tests and the `discoverSlotModifier.ts` history comment.

- [ ] **Step 4: Report honestly.** No agent can hear audio, see the UI or hold a phone. Say that plainly, and hand Elling the walkthrough below. Do not deploy or upload the web radio without his go-ahead.

**Elling's walkthrough**

Desktop (`npm run dev`). The main process changed (IPC), so fully quit the app (Cmd+Q) and relaunch:
1. Discover: `prefer faves` is gone. A small `faves` dial sits in its place beside `my sounds`, starting at 0. Hovering it shows "how much to stick to liked stems".
2. Star (👍) a handful of stems across kinds. Set faves to **100** and reroll every row several times. Only starred stems land, except a row whose kind has no starred stem; that row rolls as usual, and the console shows `no fave fits`.
3. Set it to **0**: rolls feel as before.
4. Around **50**: starred stems clearly come up more often, but not every time.
5. Start radio, open the radio menu: the `faves` row shows the same value. Move it there and close the menu: Discover's dial follows. Quit and relaunch: the value is kept.
6. Artist mode: the dial dims, its tooltip names the artist, and the artist's stems roll as before.

Web (`npm run dev` in ell.ing/radio, full mode):
1. A `faves` knob leads the strip and wraps with the others on a phone width.
2. 👍 a few stems. At **100**, only liked or hearted stems play; a row with none that fits flashes `no fave fits`.
3. At **0**, it plays as before.
4. Around **50**, liked stems clearly come up more often. Reload the page: the knob keeps its value.

Open question for Elling (Spec points resolved, 3): on the web, the crowd's ♥ lean on the ranking stays on at every dial position, so 0 is today's radio. Does he want that lean tied to the dial too?
