# Discover Preview via Native Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route Discover's live preview through the real native engine instead of plain Web Audio, so multiple previewed slots stay sample-accurately in sync over an arbitrarily long preview session, and so master/channel FX plugins are audible while auditioning.

**Architecture:** Extract Discover's "assemble one rifff from slots" logic (currently inline in `plunkInArranger`) into a shared, pure, unit-tested helper. Replace `DiscoverPanel.tsx`'s entire Web Audio preview state machine with a smaller orchestration that builds a throwaway single-rifff `EngineProject` via the existing `buildEngineProject` and sends it to the real engine via `window.rifffApi.engineLoadProject`, pausing the real arrangement on first join and restoring it via the existing `flushEngineSyncNow()` on stop. Delete the now-dead Web-Audio-with-gain preview code.

**Tech Stack:** No new dependencies. Reuses `buildEngineProject`, `engineLoadProject`, `scheduleLiveParamSync`, `flushEngineSyncNow`, and the `PLAY`/`PAUSE`/`SET_POS` actions this codebase already has.

**Design spec:** `docs/superpowers/specs/2026-09-15-discover-native-engine-preview-design.md` (approved).

---

## Before you start

Read these fresh — this plan's own line-number references may have drifted if anything else touched these files after this plan was written:
- `src/renderer/src/components/DiscoverPanel.tsx` (the file every task below touches)
- `src/renderer/src/audio/previewLoop.ts`
- `src/shared/buildEngineProject.ts`
- `src/renderer/src/state/StoreContext.tsx` (specifically `flushEngineSyncNow`/`useFlushEngineSyncNow`, `usePluginCatalog`)
- `src/renderer/src/state/store.ts` (specifically `AppState`, `initialState`)
- `src/renderer/src/components/liveParamSync.ts`

---

### Task 1: Widen the resolved-stem type flowing up from DiscoverSlotRow

**Why:** `DiscoverSlotRow`'s own resolve effect already resolves each candidate to a FULL `ResolvedCandidateStem` (author/name/type/path/durationSec/barLength) via `resolveCandidateStem` — but the `onResolvedChange` prop (and `reportSlotResolution`'s own param, and `rawResolvedStemsRef`'s own Map value type) narrows this down to just `{ path, durationSec, barLength }` before it ever reaches `DiscoverPanel`. Task 3's shared rifff-assembly helper needs the FULL shape (a `Rifff.stems` entry needs `author`/`name`/`type` too) for BOTH `plunkInArranger` and the new preview path — widening this type lets both callers use the exact same already-resolved data, with no second resolve call.

This is a pure typing change — the actual runtime object already carries every field; only the declared TypeScript type is too narrow today. No behavior changes, verified via typecheck.

**Files:**
- Modify: `src/renderer/src/components/DiscoverPanel.tsx`

- [ ] **Step 1: Widen `onResolvedChange`'s prop type on `DiscoverSlotRow`**

Find this in `DiscoverSlotRow`'s own props interface (currently near the bottom of its prop list, right before the closing `}): React.JSX.Element {`):

```ts
  onResolvedChange: (stem: { path: string; durationSec: number; barLength: number } | null) => void
```

Replace with:

```ts
  onResolvedChange: (stem: ResolvedCandidateStem | null) => void
```

- [ ] **Step 2: Widen `reportSlotResolution`'s own param type in `DiscoverPanel`**

Find:

```ts
  function reportSlotResolution(
    id: string,
    stem: { path: string; durationSec: number; barLength: number } | null
  ): void {
```

Replace with:

```ts
  function reportSlotResolution(id: string, stem: ResolvedCandidateStem | null): void {
```

- [ ] **Step 3: Widen `rawResolvedStemsRef`'s own Map value type**

Find:

```ts
  const rawResolvedStemsRef = useRef<
    Map<string, { path: string; durationSec: number; barLength: number }>
  >(new Map())
```

Replace with:

```ts
  const rawResolvedStemsRef = useRef<Map<string, ResolvedCandidateStem>>(new Map())
```

- [ ] **Step 4: Widen `resolvePreviewAudio`'s own param type**

Find:

```ts
  async function resolvePreviewAudio(
    id: string,
    stem: { path: string; durationSec: number; barLength: number }
  ): Promise<void> {
```

Replace with:

```ts
  async function resolvePreviewAudio(id: string, stem: ResolvedCandidateStem): Promise<void> {
```

(This function is deleted entirely in Task 4 — widening it now just keeps the file compiling between tasks, since Tasks 1-3 land as their own separate, working commits before Task 4's larger rewrite.)

- [ ] **Step 5: Verify the whole thing still typechecks and lints clean**

Run: `npm run typecheck`
Expected: no errors (this is a pure widening — every existing call site already passes an object with at least `path`/`durationSec`/`barLength`, which is a strict subset of `ResolvedCandidateStem`'s own fields, so nothing should break)

Run: `npx eslint src/renderer/src/components/DiscoverPanel.tsx`
Expected: no new errors

- [ ] **Step 6: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass (this file has no dedicated test suite of its own — this run is to confirm nothing ELSE regressed)

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/DiscoverPanel.tsx
git commit -m "$(cat <<'EOF'
Widen DiscoverPanel's resolved-stem type to carry author/name/type

Pure typing change ahead of extracting a shared rifff-assembly helper
(next task): DiscoverSlotRow's own resolve effect already resolves each
candidate to a full ResolvedCandidateStem (author/name/type/path/
durationSec/barLength) via resolveCandidateStem, but onResolvedChange/
reportSlotResolution/rawResolvedStemsRef all narrowed the type down to
just {path, durationSec, barLength} before it reached DiscoverPanel. The
runtime object already carries every field -- only the declared type was
too narrow. Widening it now means the upcoming shared "assemble a rifff
from slots" helper (used by both plunkInArranger and the new preview
path) can use this same already-resolved data directly, with no second
resolve call needed.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MRx9ZiTveSQ29tY1LAy7XP
EOF
)"
```

---

### Task 2: Create the shared rifff-assembly helper, with real TDD tests

**Files:**
- Create: `src/renderer/src/audio/discoverRifffAssembly.ts`
- Test: `src/renderer/src/audio/discoverRifffAssembly.test.ts`

**Why:** `plunkInArranger` (in `DiscoverPanel.tsx`) already contains the exact "one stem per slot, longest barLength wins, cap at 8" logic this feature needs — just inline, and coupled to `DiscoverPanel`'s own local variable names (`placeable`, `placed`, `groupId`, `bpm`, `rifffsState`). Extracting it into a pure, standalone function lets both `plunkInArranger` (Task 3) and the new engine-preview sync (Task 4) build the exact same shape of throwaway rifff from a list of resolved stems, with one real test suite instead of two untested inline copies.

- [ ] **Step 1: Write the failing tests**

Create `src/renderer/src/audio/discoverRifffAssembly.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { assembleDiscoverRifff } from './discoverRifffAssembly'
import { stemKey } from '@shared/types'
import type { Stem } from '@shared/types'

function fixtureStem(overrides: Partial<Omit<Stem, 'slot'>> = {}): Omit<Stem, 'slot'> {
  return {
    author: 'elling',
    name: 'a stem',
    type: 'fx',
    path: '/a.wav',
    durationSec: 4,
    barLength: 4,
    ...overrides
  }
}

describe('assembleDiscoverRifff', () => {
  it('returns null for an empty member list', () => {
    expect(assembleDiscoverRifff('discover preview', [], 120)).toBeNull()
  })

  it('builds one rifff with one stem per member, in order, 1-indexed slots', () => {
    const assembly = assembleDiscoverRifff(
      'discover: drums+bass',
      [
        { stem: fixtureStem({ path: '/a.wav' }), gain: 1 },
        { stem: fixtureStem({ path: '/b.wav' }), gain: 0.5 }
      ],
      120
    )
    expect(assembly).not.toBeNull()
    expect(assembly!.rifff.stems).toHaveLength(2)
    expect(assembly!.rifff.stems[0]).toMatchObject({ slot: 1, path: '/a.wav' })
    expect(assembly!.rifff.stems[1]).toMatchObject({ slot: 2, path: '/b.wav' })
  })

  it("sets the rifff's own barLength to the LONGEST member's barLength, tiling shorter ones", () => {
    const assembly = assembleDiscoverRifff(
      'discover preview',
      [
        { stem: fixtureStem({ barLength: 1 }), gain: 1 },
        { stem: fixtureStem({ barLength: 8 }), gain: 1 },
        { stem: fixtureStem({ barLength: 4 }), gain: 1 }
      ],
      120
    )
    expect(assembly!.rifff.barLength).toBe(8)
    // Each STEM keeps its own real, unstretched barLength -- only the
    // rifff's own barLength is the max, so shorter stems tile to fill it.
    expect(assembly!.rifff.stems.map((s) => s.barLength)).toEqual([1, 8, 4])
  })

  it('caps at 8 stems, keeping only the first 8 in the given order', () => {
    const members = Array.from({ length: 10 }, (_, i) => ({
      stem: fixtureStem({ path: `/${i}.wav` }),
      gain: 1
    }))
    const assembly = assembleDiscoverRifff('discover preview', members, 120)
    expect(assembly!.rifff.stems).toHaveLength(8)
    expect(assembly!.rifff.stems.map((s) => s.path)).toEqual([
      '/0.wav',
      '/1.wav',
      '/2.wav',
      '/3.wav',
      '/4.wav',
      '/5.wav',
      '/6.wav',
      '/7.wav'
    ])
  })

  it("builds a vol map keyed by stemKey(the rifff's own groupId, slot) for every member's own gain", () => {
    const assembly = assembleDiscoverRifff(
      'discover preview',
      [
        { stem: fixtureStem(), gain: 0.7 },
        { stem: fixtureStem(), gain: 0.3 }
      ],
      120
    )
    const groupId = assembly!.rifff.groupId
    expect(assembly!.vol).toEqual({
      [stemKey(groupId, 1)]: 0.7,
      [stemKey(groupId, 2)]: 0.3
    })
  })

  it('passes name and bpm through verbatim', () => {
    const assembly = assembleDiscoverRifff('discover: lead', [{ stem: fixtureStem(), gain: 1 }], 140)
    expect(assembly!.rifff.name).toBe('discover: lead')
    expect(assembly!.rifff.bpm).toBe(140)
  })

  it("preserves every other field of each member's own stem (author/name/type/path/durationSec) unchanged", () => {
    const stem = fixtureStem({ author: 'elling', name: 'kick', type: 'drums', durationSec: 2.5 })
    const assembly = assembleDiscoverRifff('discover preview', [{ stem, gain: 1 }], 120)
    expect(assembly!.rifff.stems[0]).toMatchObject({
      author: 'elling',
      name: 'kick',
      type: 'drums',
      durationSec: 2.5
    })
  })

  it('sets folderPath to an empty string (no real folder backs an ephemeral Discover rifff)', () => {
    const assembly = assembleDiscoverRifff('discover preview', [{ stem: fixtureStem(), gain: 1 }], 120)
    expect(assembly!.rifff.folderPath).toBe('')
  })

  it('mints a fresh, non-empty groupId on every call', () => {
    const members = [{ stem: fixtureStem(), gain: 1 }]
    const a = assembleDiscoverRifff('discover preview', members, 120)
    const b = assembleDiscoverRifff('discover preview', members, 120)
    expect(a!.rifff.groupId).not.toBe('')
    expect(a!.rifff.groupId).not.toBe(b!.rifff.groupId)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/renderer/src/audio/discoverRifffAssembly.test.ts`
Expected: FAIL — `Cannot find module './discoverRifffAssembly'` (the module doesn't exist yet)

- [ ] **Step 3: Write the implementation**

Create `src/renderer/src/audio/discoverRifffAssembly.ts`:

```ts
// src/renderer/src/audio/discoverRifffAssembly.ts
import { stemKey, type Rifff, type Stem } from '@shared/types'

/** One stem to include in an assembled Discover rifff, paired with its own
 * committed gain (0-1) -- gain lives OUTSIDE the Stem/Rifff shape itself
 * (there's no such field on either), carried the same way every other
 * placed stem's own gain already is: a separate vol map keyed by
 * stemKey(groupId, slot), built alongside the rifff by this same function
 * (see DiscoverRifffAssembly.vol below). `stem` omits `slot` deliberately
 * -- assembleDiscoverRifff always assigns slots itself, 1-indexed in the
 * given member order, so a caller's own placeholder value (if any) would
 * just be silently overwritten; omitting the field entirely avoids that
 * footgun. */
export interface DiscoverRifffMember {
  stem: Omit<Stem, 'slot'>
  gain: number
}

export interface DiscoverRifffAssembly {
  rifff: Rifff
  /** stemKey(rifff.groupId, slot) -> that member's own gain, for every
   * member included in `rifff.stems` -- ready to merge directly into
   * whatever AppState.vol the caller is building (PLACE_LOOP_ON_TIMELINE's
   * own vol param, or a throwaway preview AppState). */
  vol: Record<string, number>
}

// Real-Rifff.stems can only ever address 8 slots (StemCID_1..8 is the
// schema every OTHER rifff in this app -- LORE-imported or hand-built --
// is already bound by, see riffLibrarySchema.ts) -- caps at the first 8
// given members (in their own given order) rather than silently producing
// a Rifff no other part of this codebase's own wire format could
// represent. Originally plunkInArranger's own MAX_STEMS_PER_RIFFF
// constant, moved here now that this is the one place that actually
// builds a Discover rifff.
const MAX_STEMS_PER_RIFFF = 8

/** Assembles one throwaway `Rifff` from a list of already-resolved Discover
 * slot members -- one stem per member, 1-indexed slots in the given order,
 * capped at 8. The rifff's own `barLength` is set to the LONGEST included
 * member's own `stem.barLength`, while each STEM keeps its own real,
 * unstretched barLength unchanged -- exactly the shape a normal multi-bar-
 * length rifff already has, so the SAME tiling machinery every other
 * placed rifff already uses (StemWaveformRow.tsx/CollapsedRifffRow.tsx's
 * tileOffsetsPx on the display side, LoopSewing.cpp on the native engine
 * side) tiles the shorter stems to fill the group for free -- no new
 * looping logic needed here, just correct grouping. `name`/`bpm` are
 * passed through verbatim -- this function has no opinion on what a
 * caller wants either to be.
 *
 * Used by BOTH plunkInArranger (the real, committed placement -- see
 * DiscoverPanel.tsx) and the engine-preview sync (an ephemeral, never-
 * persisted throwaway project) -- extracted here specifically so there's
 * one tested implementation instead of two untested inline copies, per
 * design spec docs/superpowers/specs/2026-09-15-discover-native-engine-
 * preview-design.md.
 *
 * Returns null for an empty `members` list (nothing to assemble) --
 * callers are expected to have already filtered down to placeable/
 * resolved members before calling this; this null case exists so a caller
 * doesn't need to duplicate that same empty-check itself. */
export function assembleDiscoverRifff(
  name: string,
  members: DiscoverRifffMember[],
  bpm: number
): DiscoverRifffAssembly | null {
  if (members.length === 0) return null

  const capped = members.slice(0, MAX_STEMS_PER_RIFFF)
  const groupId = crypto.randomUUID()
  const barLength = Math.max(...capped.map((m) => m.stem.barLength))

  const rifff: Rifff = {
    groupId,
    name,
    bpm,
    barLength,
    folderPath: '',
    stems: capped.map(({ stem }, i) => ({ ...stem, slot: i + 1 }))
  }

  const vol: Record<string, number> = {}
  capped.forEach(({ gain }, i) => {
    vol[stemKey(groupId, i + 1)] = gain
  })

  return { rifff, vol }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/renderer/src/audio/discoverRifffAssembly.test.ts`
Expected: PASS — all 9 tests green

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck`
Expected: no errors

Run: `npx eslint --fix src/renderer/src/audio/discoverRifffAssembly.ts src/renderer/src/audio/discoverRifffAssembly.test.ts`
Expected: no errors (only this project's own established prettier auto-fixes, if any)

- [ ] **Step 6: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass (the new suite plus every pre-existing one, unchanged)

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/audio/discoverRifffAssembly.ts src/renderer/src/audio/discoverRifffAssembly.test.ts
git commit -m "$(cat <<'EOF'
Extract Discover's "assemble one rifff from slots" logic into a shared helper

Preparation for routing Discover's live preview through the native engine
(docs/superpowers/specs/2026-09-15-discover-native-engine-preview-design.md)
-- plunkInArranger already builds exactly this shape of rifff (one stem
per slot, longest barLength wins so shorter stems tile to fill the group,
capped at 8 stems), just inline and untested. Extracted into
assembleDiscoverRifff, a pure function with a real unit test suite, so
both plunkInArranger (next task) and the new preview-sync path (after
that) build the exact same shape of rifff from a list of resolved stems,
with one tested implementation instead of two untested inline copies.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MRx9ZiTveSQ29tY1LAy7XP
EOF
)"
```

---

### Task 3: Switch `plunkInArranger` to the shared helper

**Files:**
- Modify: `src/renderer/src/components/DiscoverPanel.tsx`

**Why:** Proves the new helper actually reproduces `plunkInArranger`'s own existing behavior exactly, on its own, before Task 4's much larger rewrite depends on it too. This task's own diff should be small and easy to eyeball against the helper's own tests.

- [ ] **Step 1: Add the import**

Near the top of `DiscoverPanel.tsx`, alongside the other `../audio/*` imports:

```ts
import { assembleDiscoverRifff } from '../audio/discoverRifffAssembly'
```

- [ ] **Step 2: Replace `plunkInArranger`'s own inline rifff/vol construction**

Find (inside `plunkInArranger`, after the `placed`/`placed.length === 0` check):

```ts
      // crypto.randomUUID(), matching buildRifff.ts's own established
      // convention for minting a brand-new rifff's groupId -- NOT
      // deterministic from candidate content. A second "plunk in arranger"
      // click with the same slots still showing (nothing clears `slots`
      // after a successful plunk, so re-plunking the same loop further
      // along the timeline is normal usage) must mint a fresh groupId,
      // since PLACE_LOOP_ON_TIMELINE's reducer case writes
      // `rifffs[rifff.groupId] = {...}` -- a deterministic id recomputed
      // from the same candidates would silently overwrite (relocate) the
      // first placement instead of adding a second copy alongside it,
      // contradicting this feature's own "adds alongside, never replaces"
      // guarantee (design spec §8.4).
      const groupId = crypto.randomUUID()
      const barLength = Math.max(...placed.map((p) => p.stem.barLength))
      const roles = [...new Set(placeable.map((s) => s.role))]
      const rifff: Rifff = {
        groupId,
        name: `discover: ${roles.join('+')}`,
        bpm,
        barLength,
        folderPath: '',
        stems: placed.map(({ stem }, i) => ({ slot: i + 1, ...stem }))
      }

      // Appends after the furthest-right currently-placed clip, matching
      // "adds alongside, never replaces" from the design spec's own §8.4 --
      // never touches an existing rifff's own startBar.
      const placedEnds = Object.values(rifffsState)
        .filter((r) => r.startBar !== undefined)
        .map((r) => (r.startBar ?? 0) + r.barLength)
      const startBar = placedEnds.length > 0 ? Math.max(...placedEnds) : 0

      // Direct request: each slot's own volume slider "will determine the
      // envelope once it's placed in the arrangement" -- carries the
      // Discover-time gain straight into state.vol, keyed the same way
      // every other placed stem's own gain already is (stemKey(groupId,
      // slot)).
      const vol: Record<string, number> = {}
      placed.forEach(({ gain }, i) => {
        vol[stemKey(groupId, i + 1)] = gain
      })

      dispatch({ type: 'PLACE_LOOP_ON_TIMELINE', stems: [rifff], startBar, vol })
```

Replace with:

```ts
      // crypto.randomUUID() (minted inside assembleDiscoverRifff), matching
      // buildRifff.ts's own established convention for minting a
      // brand-new rifff's groupId -- NOT deterministic from candidate
      // content. A second "plunk in arranger" click with the same slots
      // still showing (nothing clears `slots` after a successful plunk,
      // so re-plunking the same loop further along the timeline is
      // normal usage) must mint a fresh groupId, since
      // PLACE_LOOP_ON_TIMELINE's reducer case writes
      // `rifffs[rifff.groupId] = {...}` -- a deterministic id recomputed
      // from the same candidates would silently overwrite (relocate) the
      // first placement instead of adding a second copy alongside it,
      // contradicting this feature's own "adds alongside, never replaces"
      // guarantee (design spec §8.4).
      const roles = [...new Set(placeable.map((s) => s.role))]
      const assembly = assembleDiscoverRifff(
        `discover: ${roles.join('+')}`,
        placed.map(({ stem, gain }) => ({ stem, gain })),
        bpm
      )
      if (!assembly) return // placed.length === 0 already returned above; unreachable in practice
      const { rifff, vol } = assembly

      // Appends after the furthest-right currently-placed clip, matching
      // "adds alongside, never replaces" from the design spec's own §8.4 --
      // never touches an existing rifff's own startBar.
      const placedEnds = Object.values(rifffsState)
        .filter((r) => r.startBar !== undefined)
        .map((r) => (r.startBar ?? 0) + r.barLength)
      const startBar = placedEnds.length > 0 ? Math.max(...placedEnds) : 0

      dispatch({ type: 'PLACE_LOOP_ON_TIMELINE', stems: [rifff], startBar, vol })
```

- [ ] **Step 3: Delete the now-unused local `MAX_STEMS_PER_RIFFF` constant**

Find and delete (it moved into `discoverRifffAssembly.ts` in Task 2):

```ts
  // Real-Rifff.stems can only ever address 8 slots (StemCID_1..8 is the
  // schema every OTHER rifff in this app -- LORE-imported or hand-built --
  // is already bound by, see riffLibrarySchema.ts), so a plunk with more
  // placeable Discover slots than that caps at the first 8 (in their
  // current on-screen order) rather than silently producing a Rifff no
  // other part of this codebase's own wire format could represent.
  const MAX_STEMS_PER_RIFFF = 8

```

And update the one remaining reference to it, inside `plunkInArranger`:

```ts
      const placeable = slots
        .filter((s): s is DiscoverSlot & { candidate: DiscoverCandidate } => s.candidate !== null)
        .slice(0, MAX_STEMS_PER_RIFFF)
```

Replace with (the cap now lives inside `assembleDiscoverRifff` itself, so `placeable` no longer needs to pre-slice — passing more than 8 resolved members through is fine, the helper caps them):

```ts
      const placeable = slots.filter(
        (s): s is DiscoverSlot & { candidate: DiscoverCandidate } => s.candidate !== null
      )
```

- [ ] **Step 4: Typecheck and lint**

Run: `npm run typecheck`
Expected: no errors. If `Rifff` or `stemKey` are now unused imports (both were only used in the deleted inline block above — check whether anything ELSE in this file still uses them before removing), remove them from the top-of-file import list. `stemKey` is very likely still used elsewhere in this file (check via `grep -n "stemKey(" src/renderer/src/components/DiscoverPanel.tsx` before removing it) — do not remove an import still in use.

Run: `npx eslint --fix src/renderer/src/components/DiscoverPanel.tsx`
Expected: no errors, possibly an unused-import auto-fix if Step 3/4 left one behind

- [ ] **Step 5: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass unchanged (this file has no dedicated tests of its own; `discoverRifffAssembly.test.ts` from Task 2 already covers the extracted logic's own correctness)

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/DiscoverPanel.tsx
git commit -m "$(cat <<'EOF'
plunkInArranger: use the shared assembleDiscoverRifff helper

Switches plunkInArranger's own inline rifff/vol-map construction over to
assembleDiscoverRifff (extracted previous commit) -- same behavior,
now backed by that function's own real test suite instead of an
untested inline copy. The 8-stem cap moved into the helper itself, so
plunkInArranger's own placeable list no longer needs to pre-slice.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MRx9ZiTveSQ29tY1LAy7XP
EOF
)"
```

---

### Task 4: Replace the Web Audio preview backend with native-engine routing

**Files:**
- Modify: `src/renderer/src/components/DiscoverPanel.tsx`

**Why:** This is the core of the feature — see the design spec's own "Architecture" section for the full reasoning. This task removes the entire Web-Audio-based preview state machine (`mixPairsRef`, `mixJoinGenerationRef`, `restartMix`, `resolvePreviewAudio`, `stretchGenerationRef`, `mixStartTime`, the old `resolvedStemsRef`, `stopSlotPreview`, and `DiscoverSlotRow`'s own playhead-sweep effect) and replaces it with a smaller orchestration that builds and sends a throwaway single-rifff `EngineProject` to the real engine.

This is one large, interconnected change — the file cannot meaningfully compile in a half-migrated state (removing half the old preview machinery while leaving the other half referencing it would break the build), so it lands as one commit. The steps below are ordered for a human/agent editing linearly, not independently testable checkpoints.

**Read `src/shared/buildEngineProject.ts`, `src/renderer/src/state/StoreContext.tsx` (`flushEngineSyncNow`/`useFlushEngineSyncNow`/`usePluginCatalog`), `src/renderer/src/state/store.ts` (`AppState`/`initialState`), and `src/renderer/src/components/liveParamSync.ts` fresh before starting** — this task's own code blocks below assume their current real shapes; if any of those files changed since this plan was written, adapt accordingly rather than following this task's code blindly.

- [ ] **Step 1: Update imports**

Find the top-of-file import block:

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import { Waveform } from './Waveform'
import { stemColorVar } from '../theme/typeColor'
import { getAudioContext } from '../audio/peakCache'
import {
  startPreviewLoopWithGain,
  stopPreviewSources,
  registerActivePreview,
  unregisterActivePreview,
  type PreviewSourceWithGain,
  type PreviewStemInput
} from '../audio/previewLoop'
import { resolveStretchedForPlayback } from '../audio/resolveStretchedForPlayback'
import { ARRANGE_ROLE_OPTIONS, type ArrangeRole } from '@shared/stemRole'
import { instrumentMaskToSoundType } from '@shared/riffLibraryTypes'
import { guessSoundTypeFromPresetName } from '@shared/presetNames'
import { rankCandidates, pickReroll } from '@shared/discoverRanking'
import { useAppSelector, useDispatch, usePlaying } from '../state/StoreContext'
import { tileOffsetsPx } from '../state/selectors'
import { startPointerDrag } from './dragUtils'
import { stemKey, type ProjectRef, type Rifff, type SoundType, type Stem } from '@shared/types'
import type { DiscoverCandidate } from '../../../main/discoverCandidates'
```

(Note: this already reflects Task 3's own `assembleDiscoverRifff` import having been added right after `resolveStretchedForPlayback` — adjust the exact line if Task 3 placed it somewhere else.)

Replace with:

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import { Waveform } from './Waveform'
import { stemColorVar } from '../theme/typeColor'
import { assembleDiscoverRifff } from '../audio/discoverRifffAssembly'
import { resolveStretchedForPlayback } from '../audio/resolveStretchedForPlayback'
import { scheduleLiveParamSync } from './liveParamSync'
import { ARRANGE_ROLE_OPTIONS, type ArrangeRole } from '@shared/stemRole'
import { instrumentMaskToSoundType } from '@shared/riffLibraryTypes'
import { guessSoundTypeFromPresetName } from '@shared/presetNames'
import { rankCandidates, pickReroll } from '@shared/discoverRanking'
import { buildEngineProject } from '@shared/buildEngineProject'
import {
  useAppSelector,
  useDispatch,
  usePlaying,
  useFlushEngineSyncNow,
  usePluginCatalog
} from '../state/StoreContext'
import { initialState, type AppState } from '../state/store'
import { tileOffsetsPx } from '../state/selectors'
import { startPointerDrag } from './dragUtils'
import { stemKey, type ProjectRef, type SoundType } from '@shared/types'
import type { DiscoverCandidate } from '../../../main/discoverCandidates'
```

(`getAudioContext`, `startPreviewLoopWithGain`, `stopPreviewSources`, `registerActivePreview`, `unregisterActivePreview`, `PreviewSourceWithGain`, `PreviewStemInput` are all gone — nothing in this file needs them anymore. `Rifff` and `Stem` are dropped from the `@shared/types` import too — `Rifff` is no longer referenced directly in this file after Task 3 removed its last use, and `Stem` was only used by the now-deleted `resolved` state's `status: 'ready'; stem: Stem` shape in `DiscoverSlotRow`, replaced by `ResolvedCandidateStem` — verify both are genuinely unused before removing via `grep -n "\bRifff\b\|\bStem\b" src/renderer/src/components/DiscoverPanel.tsx` and only drop what's truly gone.)

- [ ] **Step 2: Add the new state reads DiscoverPanel needs**

Find:

```ts
  const dispatch = useDispatch()
  const playing = usePlaying()
  const rifffsState = useAppSelector((s) => s.rifffs)
  const bpm = useAppSelector((s) => s.bpm)
```

Replace with:

```ts
  const dispatch = useDispatch()
  const playing = usePlaying()
  const rifffsState = useAppSelector((s) => s.rifffs)
  const bpm = useAppSelector((s) => s.bpm)
  // Real arrangement's own master/channel plugin chains -- copied into the
  // throwaway preview AppState (syncPreviewToEngine, below) so a Discover
  // preview is genuinely mixed through them, same as the real arrangement,
  // confirmed 2026-09-15: "that would also mean that the fx on main could
  // be used right?" -- yes, since the engine's own mixer already applies
  // masterChain to everything it plays once it's part of whatever
  // EngineProject was last loaded.
  const masterChain = useAppSelector((s) => s.masterChain)
  const channelPlugins = useAppSelector((s) => s.channelPlugins)
  const pluginCatalog = usePluginCatalog()
  // Rebuilds and re-sends the REAL, unmodified project once a Discover
  // preview stops -- see syncPreviewToEngine's own doc comment below for
  // when/why this gets called instead of just letting the normal
  // state-driven engine-sync effect (StoreContext.tsx) catch up on its
  // own.
  const flushEngineSyncNow = useFlushEngineSyncNow()
```

- [ ] **Step 3: Replace the entire Web Audio preview state machine**

Find the whole block from `const [previewingSlotIds, setPreviewingSlotIds] = useState<Set<string>>(new Set())` through the end of `updateSlotGain`'s closing `}` (this spans the `previewingSlotIds`/`previewingSlotIdsRef` pair, the old `resolvedStemsRef` and `rawResolvedStemsRef`, `mixPairsRef`, `mixJoinGenerationRef`, `unmountedRef`, `previewTokenRef`, `resolvedBarLengths`, `mixStartTime`, `stopSlotPreview`, the mount/unmount `useEffect`, `restartMix`, `toggleSlotPreview`, `reportSlotResolution`, `stretchGenerationRef`, `resolvePreviewAudio`, the bpm-retune `useEffect`, and `updateSlotGain`).

Replace the ENTIRE block with:

```ts
  // `previewingSlotIds` is the set of Discover slot ids currently included
  // in the shared preview loop -- toggled per-slot (the waveform click, or
  // the dedicated mute button) or auto-joined the moment a slot's own
  // candidate resolves (see reportSlotResolution below). Mirrored into a
  // ref for the same reason it always has been in this file: several
  // slots can resolve within the same render batch (candidate resolution
  // got meaningfully faster this same session), and a callback reading the
  // stale pre-effect React state value here would silently drop whichever
  // slot resolved first -- see the ref-sync write inside
  // reportSlotResolution below for exactly where this bit before.
  const [previewingSlotIds, setPreviewingSlotIds] = useState<Set<string>>(new Set())
  const previewingSlotIdsRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    previewingSlotIdsRef.current = previewingSlotIds
  }, [previewingSlotIds])

  // Every slot's own real, resolved stem (author/name/type/path/
  // durationSec/barLength) -- reported by each DiscoverSlotRow's own
  // resolve effect (reportSlotResolution below). This is the RAW,
  // native-tempo stem; syncPreviewToEngine (below) hands it to
  // buildEngineProject, which does its own per-stem stretch-ratio
  // resolution internally (the exact same resolveStretchedForPlayback
  // resolver the real arranger and Tidy Up already use) -- Discover no
  // longer pre-stretches anything itself the way the old Web-Audio preview
  // had to.
  const resolvedStemsRef = useRef<Map<string, ResolvedCandidateStem>>(new Map())
  // Each row's own real barLength, reactive (unlike resolvedStemsRef) so
  // the row waveforms' own tiled width -- see DiscoverSlotRow's own
  // `loopBars`/tileOffsetsPx usage below -- re-renders when a slot
  // resolves/re-resolves/clears. Unrelated to playback; purely the
  // display-side "how wide should this row's waveform tile" concern.
  const [resolvedBarLengths, setResolvedBarLengths] = useState<Map<string, number>>(new Map())

  // True once a Discover preview project is actually loaded and playing in
  // the real native engine -- false while nothing is previewing. Drives
  // whether syncPreviewToEngine (below) needs to pause the real
  // arrangement + seek to bar 0 + PLAY (only on the empty -> non-empty
  // transition) vs. just re-sending an updated project into an
  // already-playing preview (every later change).
  const previewLoadedRef = useRef(false)
  // The CURRENTLY live preview project's own groupId, plus which 1-indexed
  // slot number each Discover slot id currently occupies within it --
  // both change on EVERY syncPreviewToEngine call (assembleDiscoverRifff
  // mints a fresh groupId every time), so this is only ever read
  // immediately after the most recent successful sync. updateSlotGain
  // (below) uses it to address a live volume update at the right
  // stemKey(groupId, slot) via scheduleLiveParamSync. Null whenever
  // nothing is currently loaded.
  const currentPreviewMappingRef = useRef<{
    groupId: string
    slotIndexById: Map<string, number>
  } | null>(null)
  // Per-call generation counter guarding syncPreviewToEngine's own async
  // chain (candidate stems are already resolved by the time it's called,
  // but buildEngineProject's own stretch resolution and the
  // engineLoadProject IPC round-trip are both real async work) -- mirrors
  // rerollGenerationRef's already-established pattern elsewhere in this
  // file: bumped synchronously before the first await, checked again
  // after, so a NEWER sync call (a fast second slot change landing before
  // an OLDER call's own build-and-send finishes) always wins, never the
  // reverse.
  const previewSyncGenerationRef = useRef(0)
  // Set true by the unmount effect below, checked at the top of
  // syncPreviewToEngine -- load-bearing, not defensive fluff: this app
  // runs under <StrictMode> (main.tsx), which in development mounts every
  // component through an extra synchronous setup -> cleanup -> setup
  // cycle. Reset back to false in the SETUP body (not just the
  // useRef(false) initializer), same fix already applied once this same
  // session for the exact same gotcha (see useStemPreviewPlayback.ts's own
  // cancelledRef, and this file's own git history) -- without the reset,
  // StrictMode's first FAKE cleanup would permanently wedge this true, and
  // every REAL sync call for the rest of the component's life would
  // silently no-op.
  const unmountedRef = useRef(false)

  // Rebuilds and re-sends the REAL, unmodified project -- used when a
  // Discover preview stops with nothing else about to trigger a resync on
  // its own (emptying out, or this whole panel unmounting). Deliberately
  // NOT called after a successful plunkInArranger: that dispatches
  // PLACE_LOOP_ON_TIMELINE, which changes real state.rifffs -- the
  // ALREADY-EXISTING coalesced engine-sync effect (StoreContext.tsx) picks
  // that real change up on its own, so forcing an extra flush there would
  // just be redundant (see plunkInArranger's own call site, below).
  // Wrapped in useCallback (matching this file's own established
  // stopSlotPreview precedent for the identical reason) so it can be
  // safely listed in the unmount effect's own dependency array below,
  // rather than an eslint-disable for a plain function react-hooks/
  // exhaustive-deps would otherwise flag as a missing dependency.
  const restorePreviewIfLoaded = useCallback((): void => {
    if (!previewLoadedRef.current) return
    previewLoadedRef.current = false
    currentPreviewMappingRef.current = null
    void flushEngineSyncNow()
  }, [flushEngineSyncNow])

  useEffect(() => {
    unmountedRef.current = false
    return () => {
      unmountedRef.current = true
      restorePreviewIfLoaded()
    }
  }, [restorePreviewIfLoaded])

  /** Builds a throwaway, single-rifff EngineProject from every slot id in
   * `ids` that currently has a resolved stem, and sends it to the real
   * native engine -- see design spec docs/superpowers/specs/
   * 2026-09-15-discover-native-engine-preview-design.md for the full
   * reasoning. Called on every slot-set change: a toggle, an auto-join, a
   * reroll landing, a slot leaving the mix, or a bpm change.
   *
   * The preview AppState is built from `initialState` (every field this
   * app's reducer knows about, safely defaulted) with only `bpm`,
   * `masterChain`, `channelPlugins`, and the one throwaway rifff/vol
   * overridden -- it never touches or copies the REAL state.rifffs,
   * state.vol, state.mute, etc., so a Discover preview can never leak into
   * (or be corrupted by) the real arrangement's own committed state.
   *
   * On the transition from "nothing previewing" to "something previewing"
   * (previewLoadedRef flips false -> true), pauses the real arrangement if
   * it was playing and starts fresh from bar 0 -- "press a button, hear
   * THAT thing, from its own start, every time," matching
   * useStemPreviewPlayback.ts's own established convention. Does NOT
   * auto-resume the real arrangement when preview stops (confirmed,
   * 2026-09-15). A LATER call while already previewing just re-sends an
   * updated project -- setProject is documented safe to call at high
   * frequency, and playback position is a separate, continuously-running
   * transport concept the engine keeps regardless of which project is
   * loaded, so an in-progress preview keeps playing right through a
   * rebuild rather than restarting. */
  async function syncPreviewToEngine(ids: Set<string>): Promise<void> {
    if (unmountedRef.current) return
    const myGeneration = ++previewSyncGenerationRef.current

    const members = [...ids]
      .map((id) => {
        const stem = resolvedStemsRef.current.get(id)
        if (!stem) return null
        const gain = slots.find((s) => s.id === id)?.gain ?? 1
        return { id, stem, gain }
      })
      .filter((x): x is { id: string; stem: ResolvedCandidateStem; gain: number } => x !== null)

    if (members.length === 0) {
      restorePreviewIfLoaded()
      return
    }

    const assembly = assembleDiscoverRifff(
      'discover preview',
      members.map(({ stem, gain }) => ({ stem, gain })),
      bpm
    )
    if (!assembly) return // members.length === 0 already handled above; unreachable in practice
    const { rifff, vol } = assembly

    const previewState: AppState = {
      ...initialState,
      bpm,
      masterChain,
      channelPlugins,
      rifffs: { [rifff.groupId]: rifff },
      vol,
      stretch: { [rifff.groupId]: true }
    }

    const project = await buildEngineProject(previewState, resolveStretchedForPlayback, pluginCatalog)
    if (unmountedRef.current || previewSyncGenerationRef.current !== myGeneration) return
    await window.rifffApi.engineLoadProject(project)
    if (unmountedRef.current || previewSyncGenerationRef.current !== myGeneration) return

    currentPreviewMappingRef.current = {
      groupId: rifff.groupId,
      slotIndexById: new Map(members.map(({ id }, i) => [id, i + 1]))
    }

    if (!previewLoadedRef.current) {
      previewLoadedRef.current = true
      if (playing) dispatch({ type: 'PAUSE' })
      void window.rifffApi.engineSetPosition(0)
      dispatch({ type: 'PLAY' })
    }
  }

  function toggleSlotPreview(id: string): void {
    const next = new Set(previewingSlotIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    previewingSlotIdsRef.current = next
    setPreviewingSlotIds(next)
    void syncPreviewToEngine(next)
  }

  // Called by each DiscoverSlotRow whenever its OWN resolved stem changes
  // (a fresh resolution lands, a reroll invalidates the old one, or the
  // slot unmounts/gets removed) -- keeps `resolvedStemsRef` accurate and,
  // if this particular slot is currently part of the playing preview (or
  // becoming part of it for the first time), re-syncs so the engine
  // actually reflects what's now showing on screen.
  //
  // Direct request: "it all should autoplay" -- a slot that just landed a
  // real, playable stem (its first-ever roll on addSlot, or a later
  // reroll) joins the shared preview automatically here rather than
  // requiring an explicit click on its own waveform first.
  //
  // Reads/writes `previewingSlotIdsRef` directly (not the closed-over
  // `previewingSlotIds` state) for the same real reason this file has
  // used that ref before: this function is invoked from EACH ROW's own
  // effect, which deliberately does NOT depend on onResolvedChange itself
  // (only on resolvedStem, see DiscoverSlotRow's own effect below) -- so
  // its closure can be stale relative to the most recent DiscoverPanel
  // render. With candidate resolution now fast, it's common for two
  // slots' own resolutions to land within the same tick; reading AND
  // writing the ref synchronously here means the second call always
  // unions onto the true current set, never a stale snapshot missing the
  // first slot's own just-landed membership.
  function reportSlotResolution(id: string, stem: ResolvedCandidateStem | null): void {
    if (stem) {
      resolvedStemsRef.current.set(id, stem)
      setResolvedBarLengths((prev) => {
        const next = new Map(prev)
        next.set(id, stem.barLength)
        return next
      })
      const currentlyPreviewing = previewingSlotIdsRef.current
      if (!currentlyPreviewing.has(id)) {
        const next = new Set(currentlyPreviewing).add(id)
        previewingSlotIdsRef.current = next
        setPreviewingSlotIds(next)
        void syncPreviewToEngine(next)
        return
      }
      void syncPreviewToEngine(currentlyPreviewing)
      return
    }
    resolvedStemsRef.current.delete(id)
    setResolvedBarLengths((prev) => {
      if (!prev.has(id)) return prev
      const next = new Map(prev)
      next.delete(id)
      return next
    })
    const currentlyPreviewing = previewingSlotIdsRef.current
    if (currentlyPreviewing.has(id)) void syncPreviewToEngine(currentlyPreviewing)
  }

  // Re-syncs the currently-previewing loop when the project's own bpm
  // changes (TransportBar's +/- buttons, its own tempo field, loading a
  // different project, or Discover's own tempo control) -- direct
  // request, 2026-09-15: "it'd be nice to be able to adjust the track
  // tempo from the discover section." A single syncPreviewToEngine call
  // re-resolves EVERY currently-included stem's own stretch ratio against
  // the new bpm at once (buildEngineProject recomputes each stem's ratio
  // fresh from its own native durationSec/barLength every time it's
  // called) -- simpler than the old Web-Audio preview's own per-stem
  // re-stretch loop, since there's only ever one project to rebuild now,
  // not N independent sources to individually rejoin. Skips the very
  // first run (component mount/tab open) -- reportSlotResolution already
  // resolves/syncs each slot once at its own native pace; re-syncing
  // again immediately on mount would just be redundant work.
  const skipFirstBpmRetuneRef = useRef(true)
  useEffect(() => {
    if (skipFirstBpmRetuneRef.current) {
      skipFirstBpmRetuneRef.current = false
      return
    }
    void syncPreviewToEngine(previewingSlotIdsRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- syncPreviewToEngine is a plain function re-created every render, not a real reactive dependency; only an actual bpm change should retune.
  }, [bpm])

  // Live-updates a slot's own committed gain -- both in `slots` state (so
  // the volume slider itself, and "plunk in arranger" later, read the
  // current value) and, if this slot's own stem is part of the CURRENTLY
  // loaded preview project, live on the real engine too.
  //
  // Direct request, 2026-09-15: "dragging envelope/volume shouldn't
  // retrigger start of samples... should not affect playhead." Routes
  // through scheduleLiveParamSync (liveParamSync.ts) -- the exact same
  // rAF-coalesced, full-reload-bypassing path the real arranger's own
  // volume sliders already use -- addressed at the CURRENT live preview
  // project's own groupId/slot-index for this id (currentPreviewMappingRef,
  // set by syncPreviewToEngine's own last successful call). If this slot
  // isn't part of the currently-loaded preview (not resolved yet, or not
  // currently included), there's nothing live to update -- the gain still
  // lands correctly the next time syncPreviewToEngine runs for it, via
  // `slots.find(...)?.gain` read fresh at assembly time.
  function updateSlotGain(id: string, gain: number): void {
    setSlots((prev) => prev.map((s) => (s.id === id ? { ...s, gain } : s)))
    const mapping = currentPreviewMappingRef.current
    const slotIndex = mapping?.slotIndexById.get(id)
    if (mapping && slotIndex !== undefined) {
      scheduleLiveParamSync('volume', stemKey(mapping.groupId, slotIndex), gain)
    }
  }
```

- [ ] **Step 4: Update `plunkInArranger` to reset the preview-loaded flag without forcing a redundant flush**

Find (the very end of `plunkInArranger`, right after the `dispatch({ type: 'PLACE_LOOP_ON_TIMELINE', ... })` line added in Task 3):

```ts
      dispatch({ type: 'PLACE_LOOP_ON_TIMELINE', stems: [rifff], startBar, vol })
    } finally {
      setPlacing(false)
    }
  }
```

Replace with:

```ts
      dispatch({ type: 'PLACE_LOOP_ON_TIMELINE', stems: [rifff], startBar, vol })
      // Real state.rifffs just changed, which the ALREADY-EXISTING
      // coalesced engine-sync effect (StoreContext.tsx) reacts to on its
      // own -- no explicit restorePreviewIfLoaded() call needed here (that
      // would force a REDUNDANT extra flush on top of the one about to
      // happen anyway). Just mark the preview as no longer loaded, so the
      // NEXT slot change (if the user keeps building right after
      // plunking) correctly treats it as starting a fresh preview rather
      // than assuming a still-loaded one that the real sync effect
      // already silently overwrote.
      previewLoadedRef.current = false
      currentPreviewMappingRef.current = null
    } finally {
      setPlacing(false)
    }
  }
```

- [ ] **Step 5: Remove `DiscoverSlotRow`'s `mixStartTime` prop entirely**

Find, in the `<DiscoverSlotRow ... />` JSX call inside `DiscoverPanel`'s own return:

```tsx
          <DiscoverSlotRow
            key={slot.id}
            slot={slot}
            rerolling={rerollingSlotIds.has(slot.id)}
            previewing={previewingSlotIds.has(slot.id)}
            mixStartTime={mixStartTime}
            maxBarLength={maxBarLength}
```

Replace with:

```tsx
          <DiscoverSlotRow
            key={slot.id}
            slot={slot}
            rerolling={rerollingSlotIds.has(slot.id)}
            previewing={previewingSlotIds.has(slot.id)}
            maxBarLength={maxBarLength}
```

Find, in `DiscoverSlotRow`'s own destructured props:

```ts
function DiscoverSlotRow({
  slot,
  rerolling,
  previewing,
  mixStartTime,
  maxBarLength,
```

Replace with:

```ts
function DiscoverSlotRow({
  slot,
  rerolling,
  previewing,
  maxBarLength,
```

Find, in `DiscoverSlotRow`'s own props type (right after the `previewing: boolean` doc comment/field):

```ts
  previewing: boolean
  /** AudioContext.currentTime the shared preview mix's CURRENT generation
   * started at (DiscoverPanel's own `mixStartTime`), or null while nothing
   * is playing -- this row's own orbiting position dot below is derived
   * from it. */
  mixStartTime: number | null
  /** The longest currently-resolved slot's own barLength, library-wide
```

Replace with:

```ts
  previewing: boolean
  /** The longest currently-resolved slot's own barLength, library-wide
```

- [ ] **Step 6: Remove `DiscoverSlotRow`'s playhead-sweep effect entirely**

Find and delete this whole block (its own preceding doc comment through the closing `}, [previewing, mixStartTime, resolvedStem])`):

```ts
  // Playhead sweep across this row's own linear Waveform, mirroring
  // ClusterStemsBrowser.tsx's own thumbnail playhead line (same absolutely-
  // positioned 1px `var(--ra-playhead)` bar at `left: fraction*100%`) and
  // BeatPicker.tsx's own AudioContext-time-driven sweep -- but read-only (no
  // drag/scrub; this is a passive preview, not a transport) and keyed off
  // `mixStartTime` (AudioContext.currentTime the shared mix last (re)started
  // at) rather than the project's own playhead, since this preview never
  // touches the native engine. Direct report: multi-slot looping preview
  // shipped with no visual indication of playback position, leaving no way
  // to tell the loop was actually running versus stalled.
  //
  // Each row sweeps at its OWN lap speed (its own resolvedStem.durationSec),
  // since two stems in the same mix can have different loop lengths.
  const [sweepFraction, setSweepFraction] = useState<number | null>(null)
  useEffect(() => {
    // No setState here on the "nothing to animate" path -- same
    // early-return-with-no-setState shape BeatPicker.tsx's own sweep effect
    // uses, since setState synchronously in an effect body (even guarded)
    // trips this codebase's react-hooks/set-state-in-effect rule. The reset
    // instead lives in the cleanup below, which only ever runs once a raf
    // loop was actually started.
    if (!previewing || mixStartTime === null || !resolvedStem || resolvedStem.durationSec <= 0) {
      return
    }
    const durationSec = resolvedStem.durationSec
    let raf: number
    const tick = (): void => {
      const elapsed = getAudioContext().currentTime - mixStartTime
      setSweepFraction((((elapsed % durationSec) + durationSec) % durationSec) / durationSec)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      setSweepFraction(null)
    }
  }, [previewing, mixStartTime, resolvedStem])
```

**Note:** now that the real engine drives playback, `previewing`'s own boolean state is still exactly right for "is this row's own waveform outlined as currently included in the mix" (the button/border treatment) — only the moving playhead LINE is removed here. Re-adding an accurate position indicator, driven by the real transport's own position feed instead of `AudioContext.currentTime`, is exactly the "real click-accurate scrub/playhead" follow-up work the design spec's own Non-Goals section already calls out as separate — do not attempt to rebuild it as part of this task.

- [ ] **Step 7: Remove the sweep's own JSX rendering**

Find and delete (inside the waveform tiling render, right after the gain-clip-line `<div>` and before the closing `</>` of that same tiled-render block):

```tsx
                {sweepFraction !== null &&
                  tileOffsets.map((leftPct) => (
                    <div
                      key={`sweep-${leftPct}`}
                      style={{
                        position: 'absolute',
                        top: 0,
                        bottom: 0,
                        left: `${leftPct + sweepFraction * tileWidthPct}%`,
                        width: 1,
                        background: 'var(--ra-playhead)',
                        pointerEvents: 'none'
                      }}
                    />
                  ))}
```

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck`
Expected: no errors. If any linger, they're almost certainly a leftover reference to something removed in Steps 1-7 (`mixStartTime`, `sweepFraction`, `getAudioContext`, `PreviewStemInput`, `PreviewSourceWithGain`, `restartMix`, `resolvePreviewAudio`, `stopSlotPreview`, `mixPairsRef`, `mixJoinGenerationRef`, `stretchGenerationRef`, `rawResolvedStemsRef`, `previewTokenRef`) — grep for the exact symbol name to find where it's still referenced and remove that reference too, rather than reintroducing the old code to satisfy it.

- [ ] **Step 9: Lint**

Run: `npx eslint --fix src/renderer/src/components/DiscoverPanel.tsx`
Expected: no errors after auto-fix. Re-run without `--fix` afterward (`npx eslint src/renderer/src/components/DiscoverPanel.tsx`) to confirm zero remaining warnings/errors, not just zero auto-fixable ones.

- [ ] **Step 10: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass — `discoverRifffAssembly.test.ts` (Task 2) and every pre-existing suite, unchanged. This file itself has no dedicated tests (React component, typecheck+lint verified only, per this codebase's established convention).

- [ ] **Step 11: Commit**

```bash
git add src/renderer/src/components/DiscoverPanel.tsx
git commit -m "$(cat <<'EOF'
Route Discover's live preview through the real native engine

Implements docs/superpowers/specs/2026-09-15-discover-native-engine-
preview-design.md. Replaces the entire Web-Audio-based preview state
machine (mixPairsRef, mixJoinGenerationRef, restartMix,
resolvePreviewAudio, stretchGenerationRef, mixStartTime,
stopSlotPreview) with a smaller orchestration: build a throwaway
single-rifff EngineProject from whatever Discover slots are currently
included (assembleDiscoverRifff, previous commits) against a synthetic
AppState copying only bpm/masterChain/channelPlugins from the real
project, resolve it via the existing buildEngineProject (already
parallelized for stretch resolution), and send it to the real engine via
window.rifffApi.engineLoadProject -- the exact same pipeline the real
arrangement and Tidy Up's own preview already use, not a second one.

Fixes the real, confirmed-live sync-drift bug this was built to fix:
several independently-looping Web Audio sources of different bar lengths
only stay in phase if their own loop lengths are EXACT integer multiples
of a shared bar length, which floating-point durations/encoder padding/
rubberband rounding never quite are in practice -- tiny per-loop errors
compounded over a long preview session into audible drift. The real
engine's own sample-accurate loop-sewing (LoopSewing.cpp) doesn't have
this problem, since it was already solving it correctly for real placed
clips. As a direct consequence of going through the engine's own mixer,
master/channel FX plugins are now genuinely audible while auditioning
too (confirmed requirement, not a side effect nobody asked for).

The real arrangement pauses the moment a preview starts (if it was
playing) and does NOT auto-resume when preview stops, matching every
other "audition something else" flow in this app. "Restoring" the real
arrangement needs no snapshot/undo machinery (unlike Tidy Up's own
mute/vol snapshot) -- the engine has no persistent memory of its own, so
stopping a Discover preview is just: stop sending it, and call the
existing flushEngineSyncNow() once to push the real, unmodified project
back. plunkInArranger's own real PLACE_LOOP_ON_TIMELINE dispatch already
triggers the SAME real resync on its own (via the pre-existing coalesced
engine-sync effect), so it doesn't need an extra explicit flush.

Per-slot volume dragging now goes through scheduleLiveParamSync (the
same fast, full-reload-bypassing path the real arranger's own volume
sliders use) once a slot is part of the currently-loaded preview,
instead of a full project rebuild per drag tick.

Removed DiscoverSlotRow's own AudioContext-time-driven playhead sweep
(mixStartTime/sweepFraction) -- it has no equivalent under engine-driven
playback. previewing's own boolean state (the "included in the mix"
outline/mute-button treatment) is untouched; only the moving position
line is gone. A real, engine-position-driven playhead/scrub is separate,
already-flagged follow-up work (see the design spec's own Non-Goals).

No dedicated test for this file: React component, typecheck+lint
verified only, per this codebase's established convention (no GUI/audio
interaction tooling in this environment). Needs a real manual
walkthrough before this can be considered fully verified -- see the
final task in this plan.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MRx9ZiTveSQ29tY1LAy7XP
EOF
)"
```

---

### Task 5: Delete the now-dead Web Audio preview-with-gain code

**Files:**
- Modify: `src/renderer/src/audio/previewLoop.ts`

**Why:** `startPreviewLoopWithGain`/`PreviewSourceWithGain`/`PreviewStemInput.startOffsetSec` were added earlier this same session specifically for `DiscoverPanel.tsx`'s own Web Audio preview — Task 4 removed their only caller. Left behind, they're pure dead code (and a misleading trap for a future reader wondering who uses them). `startPreviewLoop` itself (used by `Shelf.tsx`, `LibraryBrowser.tsx`, `ProjectLibraryBrowser.tsx`) is untouched.

- [ ] **Step 1: Confirm no other caller exists before deleting anything**

Run: `grep -rn "startPreviewLoopWithGain\|PreviewSourceWithGain" src/renderer/src --include='*.ts' --include='*.tsx'`
Expected: zero matches outside `previewLoop.ts` itself (Task 4 already removed `DiscoverPanel.tsx`'s own import/usage). If anything else still references either, STOP — do not delete; something in this plan's own assumptions is stale, investigate before proceeding.

Run: `grep -rn "startOffsetSec" src/renderer/src --include='*.ts' --include='*.tsx'`
Expected: zero matches outside `previewLoop.ts` itself, for the same reason.

- [ ] **Step 2: Remove `startOffsetSec` from `PreviewStemInput`**

Find:

```ts
  durationSec?: number
  /** Buffer offset (seconds) to START playback from, instead of the loop's
   * own beginning -- direct request, 2026-09-15: "any button press...
   * triggers the samples to start from the beginning." DiscoverPanel's own
   * restartMix uses this so a source joining an ALREADY-PLAYING mix (an
   * unmute, a reroll landing new audio) starts phase-aligned to wherever
   * the rest of the tempo-synced mix already is in its own loop, rather
   * than audibly retriggering at position 0 out of sync with everyone
   * else. Must be < durationSec (or < the decoded buffer's own duration
   * when durationSec is unset) to land within one loop's own length;
   * defaults to 0 (start of buffer), the previous, only behavior. */
  startOffsetSec?: number
}
```

Replace with:

```ts
  durationSec?: number
}
```

- [ ] **Step 3: Revert `buildPreviewSources`'s per-stem body to its pre-phase-alignment shape**

Find (the whole per-stem body inside the `for (const result of decodeResults)` loop):

```ts
    const { stem, buffer } = result.value
    try {
      // Loop content isn't guaranteed to zero-cross exactly at the seam —
      // native buffer looping wraps sample-accurately with no per-iteration
      // hook to schedule a fade against, so a short one gets baked directly
      // into a copy of the decoded samples instead (see microFade.ts).
      const loopEndSec = stem.durationSec !== undefined ? stem.durationSec : buffer.duration
      const source = ctx.createBufferSource()
      source.buffer = applyLoopMicroFade(ctx, buffer, Math.min(loopEndSec, buffer.duration))
      source.loop = true
      if (stem.durationSec !== undefined) {
        source.loopStart = 0
        source.loopEnd = Math.min(stem.durationSec, buffer.duration)
      }
      const gainNode = ctx.createGain()
      gainNode.gain.value = stem.gain ?? 1
      source.connect(gainNode)
      gainNode.connect(ctx.destination)
      // Real bug, found live 2026-09-15 ("discover stems are loading but
      // not playing"): AudioBufferSourceNode.start(when, offset) THROWS
      // synchronously if offset isn't a finite, non-negative number --
      // DiscoverPanel's own restartMix computes startOffsetSec via a
      // modulo against the stem's own durationSec, which is NaN if that
      // duration is ever 0 (or otherwise non-finite). Uncaught here (this
      // whole per-stem body used to run with no try/catch at all), that
      // throw aborted buildPreviewSources entirely -- since neither this
      // function nor any caller ever attaches a .catch() (matching every
      // OTHER "fire the preview, handle it in .then()" callsite in this
      // codebase), it silently became an unhandled promise rejection: NO
      // stem in the batch ended up playing, with no visible error
      // anywhere. Clamping/validating here, isolated per-stem inside this
      // try, means one bad stem's offset can't sink every other stem in
      // the same restartMix call -- same "one bad one doesn't block the
      // rest" resilience decode failures already get, just one step later.
      const rawOffset = stem.startOffsetSec ?? 0
      const safeOffset = Number.isFinite(rawOffset) ? Math.max(0, rawOffset) : 0
      source.start(0, safeOffset)
      pairs.push({ source, gainNode, stem })
    } catch (err) {
      console.error('previewLoop: failed to start preview source:', err)
    }
```

Replace with:

```ts
    const { stem, buffer } = result.value
    try {
      // Loop content isn't guaranteed to zero-cross exactly at the seam —
      // native buffer looping wraps sample-accurately with no per-iteration
      // hook to schedule a fade against, so a short one gets baked directly
      // into a copy of the decoded samples instead (see microFade.ts).
      const loopEndSec = stem.durationSec !== undefined ? stem.durationSec : buffer.duration
      const source = ctx.createBufferSource()
      source.buffer = applyLoopMicroFade(ctx, buffer, Math.min(loopEndSec, buffer.duration))
      source.loop = true
      if (stem.durationSec !== undefined) {
        source.loopStart = 0
        source.loopEnd = Math.min(stem.durationSec, buffer.duration)
      }
      const gainNode = ctx.createGain()
      gainNode.gain.value = stem.gain ?? 1
      source.connect(gainNode)
      gainNode.connect(ctx.destination)
      source.start(0)
      pairs.push({ source, gainNode, stem })
    } catch (err) {
      console.error('previewLoop: failed to start preview source:', err)
    }
```

(The per-stem `try`/`catch` itself stays — it's real, independently-useful hardening against any OTHER unexpected `.start()`/node-setup failure, not specific to the now-removed offset logic. Only the offset computation and its own justifying comment come out.)

- [ ] **Step 4: Delete `PreviewSourceWithGain` and `startPreviewLoopWithGain`**

Find and delete this whole block (its own preceding doc comment through the closing `}`):

```ts
/** One started preview source, paired with its own GainNode and the
 * INPUT stem it came from (by reference -- callers that need to find
 * "which pair is THIS stem" again later can compare by identity or by
 * `stem.path`, whichever fits). Exposing the gain node lets a caller
 * adjust volume LIVE (direct-node adjustment, no stop/restart) instead
 * of tearing down and re-starting playback just to change a level --
 * see startPreviewLoopWithGain's own doc comment for why this is a
 * separate function rather than changing startPreviewLoop's own return
 * type. */
export interface PreviewSourceWithGain {
  source: AudioBufferSourceNode
  gainNode: GainNode
  stem: PreviewStemInput
}
```

And, further down, find and delete:

```ts
/** Same as startPreviewLoop, but also returns each source's own GainNode
 * (and the stem it came from) -- direct request, 2026-09-15: "dragging
 * envelope/volume shouldn't retrigger start of samples... should not
 * affect playhead." DiscoverPanel's own multi-slot mix previously had no
 * way to change one slot's volume without a FULL restartMix (stop every
 * source, re-decode, re-start every source from position 0) -- audible
 * as every OTHER currently-playing slot's own loop position visibly
 * jumping back to its start, not just the one being adjusted. Exposing
 * the gain node lets a caller set `.gain.value` directly instead --
 * genuinely live, zero-latency, and touches only the one node being
 * adjusted, leaving every other source's own playback position (and the
 * preview's own playhead) completely undisturbed. A separate function
 * rather than changing startPreviewLoop's own return type, since three
 * OTHER callers (LibraryBrowser/Shelf/ProjectLibraryBrowser, none of
 * which need live per-stem gain access) already depend on its existing
 * `AudioBufferSourceNode[]` shape. */
export async function startPreviewLoopWithGain(
  ctx: AudioContext,
  stems: PreviewStemInput[],
  isCancelled: () => boolean
): Promise<PreviewSourceWithGain[]> {
  return buildPreviewSources(ctx, stems, isCancelled)
}
```

**Note:** `buildPreviewSources` itself (the internal, non-exported helper both `startPreviewLoop` and the now-deleted `startPreviewLoopWithGain` shared) stays exactly as-is — it still needs to build a `{source, gainNode, stem}` triple internally either way, since a real `GainNode` is what makes `stem.gain` apply at all; only the EXPORTED "give me the gain nodes too" surface is gone. `startPreviewLoop` itself is untouched (still does `pairs.map((p) => p.source)`).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 6: Lint**

Run: `npx eslint --fix src/renderer/src/audio/previewLoop.ts`
Expected: no errors

- [ ] **Step 7: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass unchanged

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/audio/previewLoop.ts
git commit -m "$(cat <<'EOF'
Delete previewLoop.ts's now-dead Web Audio preview-with-gain code

startPreviewLoopWithGain/PreviewSourceWithGain/PreviewStemInput's own
startOffsetSec field were added earlier this session specifically for
DiscoverPanel.tsx's own Web Audio preview -- the previous commit removed
its only caller, routing Discover's preview through the real native
engine instead. Confirmed via grep that nothing else in the codebase
ever referenced either symbol before deleting. startPreviewLoop itself
(still used by Shelf.tsx/LibraryBrowser.tsx/ProjectLibraryBrowser.tsx)
is completely untouched -- buildPreviewSources still builds a real
GainNode per source internally (stem.gain needs one to apply at all),
just no longer exposes it externally.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MRx9ZiTveSQ29tY1LAy7XP
EOF
)"
```

---

### Task 6: Final full verification + manual walkthrough checklist

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 2: Full lint**

Run: `npm run lint`
Expected: 0 errors (pre-existing, unrelated prettier warnings elsewhere in the codebase are fine — this session has consistently seen the same ~4 warnings in unrelated files all day; do not "fix" files this plan didn't touch)

- [ ] **Step 3: Full test suite**

Run: `npx vitest run`
Expected: all tests pass, including the new `discoverRifffAssembly.test.ts` suite from Task 2

- [ ] **Step 4: Review the real diff end to end**

Run: `git log --oneline -6` and `git diff master...HEAD --stat` (or `git diff <the commit right before Task 1>..HEAD --stat` if `master` has diverged) to confirm the full set of changes matches this plan's own scope: `discoverRifffAssembly.ts` + its test (new), `DiscoverPanel.tsx` (modified), `previewLoop.ts` (modified). No native-engine (C++), `buildEngineProject.ts`, or `StoreContext.tsx` changes — if any of those three show up in the diff, something went off-plan; investigate before considering this done.

- [ ] **Step 5: Write up the manual walkthrough checklist for Elling**

This feature cannot be verified by typecheck/lint/tests alone (real audio playback through a real native engine subprocess, in a real Electron window) — say so explicitly rather than claiming it's "done." Report back with this exact checklist, asking Elling to confirm each item once he's back:

- [ ] Open Discover, add a few slots of different roles. They should autoplay together, audibly in sync, through the real engine (not the browser's own Web Audio) -- check Activity Monitor or just listen for the native engine subprocess actually being what's making sound.
- [ ] Let a multi-slot preview run for several minutes. Confirm it does NOT drift out of sync the way the old Web Audio preview did -- this is the whole point of this change.
- [ ] While a preview is playing, add a plugin to the master chain (or confirm one is already there) and verify it's audibly applied to the Discover preview too, not just real placed clips.
- [ ] Reroll a slot while previewing -- the loop should keep playing through the swap, not glitch/restart/go silent.
- [ ] Mute/unmute a slot (the M button or clicking its waveform) while previewing -- same, no glitch.
- [ ] Drag a slot's own volume while previewing -- should be audibly live/instant, no retrigger.
- [ ] Remove a slot while previewing -- same, no glitch to the remaining slots.
- [ ] Start playing the real arrangement, THEN open Discover and add a slot -- the real arrangement should pause automatically the moment the Discover preview starts.
- [ ] After a Discover preview has played and then stopped (last slot removed, or the panel closed), confirm the REAL arrangement's own project is what's loaded in the engine afterward (e.g. press play on the real transport -- it should play the real arrangement, not silence or stale Discover audio). It should NOT auto-resume playing on its own.
- [ ] "Plunk in arranger" while a preview is playing -- should hand off cleanly to the real, now-updated arrangement.
- [ ] Change the project's tempo (TransportBar or Discover's own tempo control) while previewing -- the loop should audibly re-tune to the new tempo without needing to stop/restart it manually.

Do not mark this task's own steps complete in the plan tracking until Elling has actually confirmed the above — this is the one part of this plan that genuinely cannot be self-verified.
