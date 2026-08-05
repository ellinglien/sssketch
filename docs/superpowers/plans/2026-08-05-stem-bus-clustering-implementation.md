# Stem Bus Clustering + Ableton Track Reduction Implementation Plan (Phase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce a real Ableton export from "one group per channel, one audio track per stem" down
to a small, fixed set of mix buses (5: drums/bass/lead/backing/aux), packing each bus's own
non-overlapping stems onto shared audio tracks — without flattening or rendering anything, every
clip stays independently editable in Ableton.

**Architecture:** A new `busOf` reducer slice (mirrors `channelOf`'s shape exactly, keyed by
stemKey), a pure `packIntoTracks` interval-partitioning function in `src/shared/`, and a
restructure of `buildAlsXml.ts`'s track-building so a stem's own clips (already split around mute
regions by an earlier feature) can share a physical Ableton track with other non-overlapping
stems from the same bus. Also fixes a real, separate bug found while researching this: isolated
per-stem solo renders currently run through the FULL master chain (including the limiter)
individually, which won't sum correctly once mixed — fixed first since later phases build on the
same solo-render pattern.

**Tech Stack:** TypeScript (renderer reducer, shared pure logic, main-process Ableton export).

**Spec:** `docs/superpowers/specs/2026-08-05-stem-bus-clustering-design.md`

**Scope note:** This plan covers only the design doc's own "Suggested order" steps 1–4 — the
part that's useful standalone with hand-assigned buses and needs no audio analysis. Steps 5–6
(feature extraction, clustering, the labelling UI) are explicitly out of scope here and will get
their own follow-up spec/plan once this lands. There is deliberately no UI in this plan for
*assigning* a stem to a bus yet (no `ASSIGN_TO_BUS` caller) — an unassigned stem falls back to the
`aux` bus (see Task 4), so the export is useful from the moment this ships, even before any
labelling UI exists.

---

### Task 1: Fix solo renders running through the full master chain

**Files:**
- Modify: `src/main/nativeExport.ts`
- Test: `src/main/nativeExport.test.ts`

`nativeExportStems` renders each stem in isolation (every other stem muted) by spreading
`state` and overriding only `mute`. Since `state.masterChain` is untouched, `buildEngineProject`
(which always includes `state.masterChain` in the wire format it builds — see
`src/shared/buildEngineProject.ts:224-245`) sends the FULL master chain (including any limiter)
through on every single isolated stem's render. N stems each individually limited will not sum
back to what the real mixdown sounds like. This task extracts the solo-state construction into a
reusable pure function that also zeroes the master chain — reusable later for a per-bus solo
render too (the design doc's own "Solo-render-per-target" note).

- [ ] **Step 1: Write the failing test**

Add to `src/main/nativeExport.test.ts`, alongside the existing `describe('loopLengthBarsFor', ...)`
block (add a new `import { soloState } from './nativeExport'` to the existing import line at the
top — change `import { loopLengthBarsFor, nativeExport } from './nativeExport'` to
`import { loopLengthBarsFor, nativeExport, soloState } from './nativeExport'`):

```ts
describe('soloState', () => {
  it('mutes every key except the target(s), regardless of the input mute map', () => {
    const state = stateWith({ mute: { 'r1:1': false, 'r1:2': true } })
    const result = soloState(state, new Set(['r1:1']), ['r1:1', 'r1:2'])
    expect(result.mute).toEqual({ 'r1:1': false, 'r1:2': true })
  })

  it('zeroes the master chain regardless of what was set', () => {
    const state = stateWith({ masterChain: ['some-limiter-id', null, null, null] })
    const result = soloState(state, new Set(['r1:1']), ['r1:1', 'r1:2'])
    expect(result.masterChain).toEqual([null, null, null, null])
  })

  it('supports multiple simultaneous targets (a bus solo, not just a single stem)', () => {
    const state = stateWith({})
    const result = soloState(state, new Set(['r1:1', 'r1:2']), ['r1:1', 'r1:2', 'r1:3'])
    expect(result.mute).toEqual({ 'r1:1': false, 'r1:2': false, 'r1:3': true })
  })

  it('leaves every other field of state untouched', () => {
    const state = stateWith({ bpm: 133 })
    const result = soloState(state, new Set(['r1:1']), ['r1:1'])
    expect(result.bpm).toBe(133)
    expect(result.rifffs).toBe(state.rifffs)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/nativeExport.test.ts -t "soloState"`
Expected: FAIL — `soloState` isn't exported from `./nativeExport` yet.

- [ ] **Step 3: Implement `soloState` and use it in `nativeExportStems`**

In `src/main/nativeExport.ts`, add this new exported function right after `loopLengthBarsFor`:

```ts
/**
 * Builds the per-target solo state used to isolate one or more stems for a
 * solo render: every stem NOT in `targetKeys` muted, and the master chain
 * zeroed out. A solo render is for auditioning a stem/bus on its own, not
 * through the mix's own limiter/mastering chain -- without this, an
 * isolated stem WAV was previously rendered through the FULL master chain
 * individually, which won't sum correctly with the real mixdown (each
 * stem hits the limiter on its own, N times, instead of the limiter
 * seeing the summed mix once). See
 * docs/superpowers/specs/2026-08-05-stem-bus-clustering-design.md.
 * `allKeys` must include every stemKey that could sound in this project --
 * anything not in `targetKeys` gets muted, so an incomplete list would
 * leave an unrelated stem audible.
 */
export function soloState(state: AppState, targetKeys: Set<string>, allKeys: string[]): AppState {
  const soloMute: Record<string, boolean> = {}
  for (const key of allKeys) soloMute[key] = !targetKeys.has(key)
  return { ...state, mute: soloMute, masterChain: [null, null, null, null] }
}
```

In `nativeExportStems`, replace:

```ts
    for (const target of targets) {
      const soloMute: Record<string, boolean> = {}
      for (const other of targets) soloMute[other.key] = other.key !== target.key
      const soloState: AppState = { ...state, mute: soloMute }

      const project = await buildEngineProject(soloState, resolveStretchedForExport, pluginCatalog)
```

with:

```ts
    const allKeys = targets.map((t) => t.key)
    for (const target of targets) {
      const targetState = soloState(state, new Set([target.key]), allKeys)

      const project = await buildEngineProject(targetState, resolveStretchedForExport, pluginCatalog)
```

(The local variable is renamed `targetState` since it now shadows the imported `soloState`
function name — keep this rename, don't reintroduce the shadow.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/nativeExport.test.ts`
Expected: PASS — all `soloState` tests plus the existing `loopLengthBarsFor` and
`nativeExport — multi-stem/multi-rifff parity` tests (the latter doesn't call
`nativeExportStems` at all, so it's unaffected).

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npx eslint src/main/nativeExport.ts src/main/nativeExport.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/nativeExport.ts src/main/nativeExport.test.ts
git commit -m "Fix solo stem renders running through the full master chain individually"
```

---

### Task 2: `busOf` data model + `ASSIGN_TO_BUS` reducer action

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/renderer/src/state/store.ts`
- Test: `src/renderer/src/state/store.test.ts`

Mirrors `channelOf`'s existing shape exactly, but keyed by `stemKey(groupId, slot)` (not
`groupId`) — a bus is a per-stem assignment, not a per-rifff one, since two stems in the same
rifff could belong to different buses (e.g. a rifff with both a drum stem and a vocal stem).

- [ ] **Step 1: Write the failing tests**

Add to `src/renderer/src/state/store.test.ts`, alongside the existing reducer-action tests:

```ts
describe('bus assignment', () => {
  it('ASSIGN_TO_BUS sets a stem\'s bus', () => {
    const state = reducer(initialState, {
      type: 'ASSIGN_TO_BUS',
      stemKey: 'r1:0',
      busId: 'drums'
    })
    expect(state.busOf['r1:0']).toBe('drums')
  })

  it('ASSIGN_TO_BUS overwrites a previous assignment for the same stem', () => {
    const first = reducer(initialState, {
      type: 'ASSIGN_TO_BUS',
      stemKey: 'r1:0',
      busId: 'drums'
    })
    const state = reducer(first, { type: 'ASSIGN_TO_BUS', stemKey: 'r1:0', busId: 'bass' })
    expect(state.busOf['r1:0']).toBe('bass')
  })

  it('DELETE_RIFFFS strips busOf for every deleted stem', () => {
    const rifff = {
      groupId: 'r1',
      name: 'x',
      bpm: 120,
      barLength: 4,
      folderPath: '/f',
      stems: [{ slot: 0, author: 'a', name: 's', type: 'fx' as const, path: '/p', durationSec: 1, barLength: 1 }]
    }
    const seeded = reducer(
      { ...initialState, rifffs: { r1: rifff } },
      { type: 'ASSIGN_TO_BUS', stemKey: 'r1:0', busId: 'drums' }
    )
    const state = reducer(seeded, { type: 'DELETE_RIFFFS', groupIds: ['r1'] })
    expect(state.busOf['r1:0']).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/state/store.test.ts -t "bus assignment"`
Expected: FAIL — `ASSIGN_TO_BUS` isn't a valid `Action` type yet, `busOf` doesn't exist on
`AppState`, and `'drums'`/`'bass'` aren't recognized as a `BusId`.

- [ ] **Step 3: Add the `BusId` type**

In `src/shared/types.ts`, add near the existing `SoundType` type (read the file first to match
its exact style/placement):

```ts
/** Which mix bus a stem is assigned to, for Ableton export track reduction
 * -- a DIFFERENT axis from SoundType (which describes what Endlesss device
 * produced a stem, not where it belongs in a mix). Deliberately NOT added
 * as a SoundType variant -- see
 * docs/superpowers/specs/2026-08-05-stem-bus-clustering-design.md for why
 * conflating the two would be wrong (SoundType resolves to 'audioIn' for
 * ~90% of live-recorded material, which carries no mix-placement
 * information at all). Five buses is the deliberately chosen starting
 * set -- few enough to label by ear quickly. */
export type BusId = 'drums' | 'bass' | 'lead' | 'backing' | 'aux'
```

- [ ] **Step 4: Add the state shape**

In `src/renderer/src/state/store.ts`, import `BusId` alongside this file's existing import of
`SoundType` from `@shared/types` (find that import line and add `BusId` to it).

Add to the `AppState` interface, right after `channelOf: Record<string, string>` and its doc
comment:

```ts
  /** Which mix bus a stem is assigned to for Ableton export track reduction,
   * keyed by stemKey(groupId, slot) -- mirrors channelOf's own shape, just
   * per-stem instead of per-rifff (two stems in the same rifff can belong
   * to different buses). A stem absent from this map has no assignment
   * yet -- buildAlsXml.ts falls back to the 'aux' bus for those, so export
   * is useful immediately, before any labelling UI exists. Export-time
   * grouping only; never reaches EngineProject or the native engine. See
   * docs/superpowers/specs/2026-08-05-stem-bus-clustering-design.md. */
  busOf: Record<string, BusId>
```

In `initialState`, add `busOf: {},` right after `channelOf: {},`.

In the `Action` union, add right after the existing `MOVE_TO_CHANNEL` variant:

```ts
  | { type: 'ASSIGN_TO_BUS'; stemKey: string; busId: BusId }
```

- [ ] **Step 5: Implement the reducer case**

Add right after the existing `case 'MOVE_TO_CHANNEL':` block's closing brace:

```ts
    case 'ASSIGN_TO_BUS':
      return { ...state, busOf: { ...state.busOf, [action.stemKey]: action.busId } }
```

In the existing `case 'DELETE_RIFFFS':` block, add `busOf: omitStems(state.busOf),` to the
returned object, alongside the existing `vol: omitStems(state.vol),` / `mute:
omitStems(state.mute),` / `muteRegions: omitStems(state.muteRegions),` lines (same `omitStems`
helper already defined in that case).

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/renderer/src/state/store.test.ts -t "bus assignment"`
Expected: PASS (3 tests).

- [ ] **Step 7: Run typecheck and the full state test suite**

Run: `npm run typecheck && npx vitest run src/renderer/src/state/`
Expected: PASS, no type errors, no regressions. `busOf` needs no changes to
`src/renderer/src/state/serialize.ts` or `history.ts` — it's real, persisted arrangement data
(like `channelOf`/`muteRegions`), not transient UI state, so it's included in saves by default
and every dispatch is a real undo-able edit by default (matching `MOVE_TO_CHANNEL`'s own
treatment — neither file's exclusion lists need touching).

- [ ] **Step 8: Commit**

```bash
git add src/shared/types.ts src/renderer/src/state/store.ts src/renderer/src/state/store.test.ts
git commit -m "Add busOf data model and ASSIGN_TO_BUS reducer action"
```

---

### Task 3: `packIntoTracks` — pure interval-partitioning function

**Files:**
- Create: `src/shared/packIntoTracks.ts`
- Test: `src/shared/packIntoTracks.test.ts`

Classic interval partitioning ("minimum meeting rooms"): sort by start, greedily place each item
on the first still-open track whose last-placed item has already ended, otherwise open a new
track. This is implemented as a simple `O(n·k)` scan (k = number of tracks opened so far, not a
heap), not the asymptotically-optimal `O(n log n)` version — deliberately: real per-bus track
counts are small (a handful at most), so the simpler, more obviously-correct implementation is
worth more here than the asymptotic improvement. It still provably yields the minimum possible
track count for any input, which is what actually matters.

- [ ] **Step 1: Write the failing tests**

```ts
// src/shared/packIntoTracks.test.ts
import { describe, it, expect } from 'vitest'
import { packIntoTracks } from './packIntoTracks'

interface Clip {
  name: string
  start: number
  end: number
}

function clip(name: string, start: number, end: number): Clip {
  return { name, start, end }
}

describe('packIntoTracks', () => {
  it('returns an empty array for no clips', () => {
    expect(packIntoTracks<Clip>([], (c) => c.start, (c) => c.end)).toEqual([])
  })

  it('packs non-overlapping clips onto a single track', () => {
    const a = clip('a', 0, 4)
    const b = clip('b', 4, 8)
    const c = clip('c', 10, 12)
    const result = packIntoTracks([a, b, c], (x) => x.start, (x) => x.end)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual([a, b, c])
  })

  it('treats a clip starting exactly when another ends as non-overlapping (half-open interval)', () => {
    // Matches this codebase's own [start, end) convention used throughout
    // buildAlsXml.ts's segment math.
    const a = clip('a', 0, 4)
    const b = clip('b', 4, 8)
    const result = packIntoTracks([a, b], (x) => x.start, (x) => x.end)
    expect(result).toHaveLength(1)
  })

  it('opens a second track for two fully overlapping clips', () => {
    const a = clip('a', 0, 10)
    const b = clip('b', 2, 8)
    const result = packIntoTracks([a, b], (x) => x.start, (x) => x.end)
    expect(result).toHaveLength(2)
  })

  it('reuses a track once it frees up, minimizing total track count', () => {
    // A: 0-10, B: 5-15 (overlaps A), C: 12-20 (overlaps B, but NOT A --
    // starts after A ends at 10). Minimum possible is 2 tracks: A and C
    // share one track, B gets its own.
    const a = clip('a', 0, 10)
    const b = clip('b', 5, 15)
    const c = clip('c', 12, 20)
    const result = packIntoTracks([a, b, c], (x) => x.start, (x) => x.end)
    expect(result).toHaveLength(2)
    const totalPlaced = result.reduce((sum, track) => sum + track.length, 0)
    expect(totalPlaced).toBe(3)
  })

  it('does not drop or duplicate any clip across a larger input', () => {
    const clips = [
      clip('a', 0, 5),
      clip('b', 1, 6),
      clip('c', 2, 7),
      clip('d', 8, 12),
      clip('e', 8, 20),
      clip('f', 15, 18)
    ]
    const result = packIntoTracks(clips, (x) => x.start, (x) => x.end)
    const allPlaced = result.flat()
    expect(allPlaced).toHaveLength(clips.length)
    expect(new Set(allPlaced.map((c) => c.name))).toEqual(new Set(clips.map((c) => c.name)))
  })

  it('sorts by start bar within each track (not insertion order)', () => {
    const a = clip('a', 10, 15)
    const b = clip('b', 0, 5)
    const result = packIntoTracks([a, b], (x) => x.start, (x) => x.end)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual([b, a])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/shared/packIntoTracks.test.ts`
Expected: FAIL — the module doesn't exist yet.

- [ ] **Step 3: Implement `packIntoTracks`**

```ts
// src/shared/packIntoTracks.ts

/**
 * Partitions `clips` into the minimum possible number of tracks such that
 * no two clips on the same track overlap in time -- the classic interval
 * partitioning ("minimum meeting rooms") problem. Half-open intervals:
 * a clip starting exactly when another ends is NOT an overlap (matches
 * buildAlsXml.ts's own [start, end) convention throughout its segment
 * math). Greedy: sort by start, place each clip on the first track whose
 * last-placed clip has already ended, else open a new track. Provably
 * yields the minimum track count for any input (the number of tracks
 * open at any point never exceeds the true max overlap depth, which is a
 * strict lower bound on any valid partition) -- this is a simple O(n*k)
 * scan (k = tracks opened so far) rather than the asymptotically-optimal
 * O(n log n) heap-based version, deliberately: real per-bus track counts
 * are small, so simplicity/obviousness of correctness wins here over the
 * asymptotic improvement. See
 * docs/superpowers/specs/2026-08-05-stem-bus-clustering-design.md.
 */
export function packIntoTracks<T>(
  clips: readonly T[],
  startBar: (c: T) => number,
  endBar: (c: T) => number
): T[][] {
  const sorted = [...clips].sort((a, b) => startBar(a) - startBar(b))
  const tracks: T[][] = []
  const trackEnds: number[] = []

  for (const clip of sorted) {
    const start = startBar(clip)
    let placedOnIndex = -1
    for (let i = 0; i < tracks.length; i++) {
      if (trackEnds[i] <= start) {
        placedOnIndex = i
        break
      }
    }
    if (placedOnIndex === -1) {
      tracks.push([clip])
      trackEnds.push(endBar(clip))
    } else {
      tracks[placedOnIndex].push(clip)
      trackEnds[placedOnIndex] = endBar(clip)
    }
  }

  return tracks
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/shared/packIntoTracks.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npx eslint src/shared/packIntoTracks.ts src/shared/packIntoTracks.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/packIntoTracks.ts src/shared/packIntoTracks.test.ts
git commit -m "Add packIntoTracks: pure interval-partitioning for minimum track count"
```

---

### Task 4: `buildAlsXml.ts` — re-partition by bus, pack stems onto shared tracks

**Files:**
- Modify: `src/main/ableton/buildAlsXml.ts`
- Test: `src/main/ableton/buildAlsXml.test.ts`

This is the biggest task in this plan — a real structural change, not just a parameter addition.
Read `buildAlsXml.ts`'s current `buildStemTrack` function (and the main `buildAlsXml` loop that
calls it) in full before starting. Today, `buildStemTrack` clones ONE audio track per stem and
fills it with that stem's own clips (already split around mute regions by an earlier feature —
see the file's own `subtractMutedRanges`/`tilePhaseAtElapsedBeats`). For bus packing, MULTIPLE
DIFFERENT stems need to be able to share ONE physical Ableton track (since a track can only play
one clip at a time, but non-overlapping stems' clips can interleave on the same track) — so this
task splits stem-level clip-building apart from track-level assembly.

**Design decision made in this plan (not fully specified by the design doc): pack at STEM
granularity, not individual-clip-segment granularity.** A stem that's been split into multiple
segments by a mute region is treated as ONE indivisible packable unit spanning from its earliest
segment's start to its latest segment's end (including any internal silent gap) — not as several
separately-packable segments. This is a deliberate simplification: it means a track holding a
mute-gapped stem won't have another stem's clip slotted into that internal gap, which is a mild
under-packing in that specific case, but keeps the packing logic simple and avoids any risk of a
shared track's clips becoming hard to attribute to their source stem. The design doc doesn't
address this interaction (mute regions and bus packing are two separate features that happened to
land the same day) — this is the chosen resolution, worth knowing if revisited later.

- [ ] **Step 1: Write the failing tests**

Add to `src/main/ableton/buildAlsXml.test.ts`, in a new `describe('bus clustering', ...)` block:

```ts
describe('bus clustering', () => {
  it('groups tracks by bus instead of by channel, using the bus name for the GroupTrack', () => {
    const rifffA = { ...drumsRifff(), groupId: 'rifff-a', name: 'kick-loop' }
    const rifffB: Rifff = {
      groupId: 'rifff-b',
      name: 'bass-loop',
      bpm: 140,
      barLength: 4,
      folderPath: '/fake/folder',
      startBar: 20, // well past rifff-a's own span, so nothing overlaps
      stems: [
        {
          slot: 0,
          author: 'someone',
          name: 'sub',
          type: 'bass',
          path: '/source/sub.wav',
          durationSec: (60 / 140) * 4 * 4,
          barLength: 4
        }
      ]
    }
    const state = emptyAppState({
      rifffs: { 'rifff-a': rifffA, 'rifff-b': rifffB },
      channelOrder: ['rifff-a', 'rifff-b'],
      channelOf: { 'rifff-a': 'rifff-a', 'rifff-b': 'rifff-b' },
      busOf: { 'rifff-a:0': 'drums', 'rifff-b:0': 'bass' }
    })
    const stemFileNames = new Map([
      ['rifff-a:0', 'kick.wav'],
      ['rifff-b:0', 'sub.wav']
    ])

    const xml = buildAlsXml(TEMPLATE_XML, state, '/out', stemFileNames)
    const { tracks } = tracksOf(xml)

    const groupTracks = findAllChildren(tracks, 'GroupTrack')
    const groupNames = groupTracks.map((g) => {
      const nameNode = findChild(childArray(g, 'GroupTrack'), 'Name')!
      return attrs(findChild(childArray(nameNode, 'Name'), 'EffectiveName')!)['@_Value']
    })
    // Fixed bus order (drums, bass, lead, backing, aux), only non-empty
    // buses emitted -- 'drums' before 'bass' regardless of input order.
    expect(groupNames).toEqual(['drums', 'bass'])
    expect(findAllChildren(tracks, 'AudioTrack')).toHaveLength(2)
  })

  it('falls back to the aux bus for a stem with no bus assignment yet', () => {
    const state = emptyAppState({
      rifffs: { 'rifff-1': drumsRifff() },
      channelOrder: ['rifff-1'],
      channelOf: { 'rifff-1': 'rifff-1' }
      // no busOf entry at all
    })
    const stemFileNames = new Map([['rifff-1:0', 'my-rifff-kick.wav']])

    const xml = buildAlsXml(TEMPLATE_XML, state, '/out', stemFileNames)
    const { tracks } = tracksOf(xml)
    const groupTrack = findChild(tracks, 'GroupTrack')!
    const nameNode = findChild(childArray(groupTrack, 'GroupTrack'), 'Name')!
    expect(attrs(findChild(childArray(nameNode, 'Name'), 'EffectiveName')!)['@_Value']).toBe('aux')
  })

  it('packs two non-overlapping stems from the same bus onto ONE shared audio track', () => {
    const rifffA: Rifff = {
      groupId: 'rifff-a',
      name: 'first',
      bpm: 140,
      barLength: 4,
      folderPath: '/fake/folder',
      startBar: 0,
      stems: [
        {
          slot: 0,
          author: 'someone',
          name: 'a',
          type: 'drums',
          path: '/source/a.wav',
          durationSec: (60 / 140) * 4 * 4,
          barLength: 4
        }
      ]
    }
    const rifffB: Rifff = {
      groupId: 'rifff-b',
      name: 'second',
      bpm: 140,
      barLength: 4,
      folderPath: '/fake/folder',
      startBar: 20, // well after rifff-a ends -- no overlap
      stems: [
        {
          slot: 0,
          author: 'someone',
          name: 'b',
          type: 'drums',
          path: '/source/b.wav',
          durationSec: (60 / 140) * 4 * 4,
          barLength: 4
        }
      ]
    }
    const state = emptyAppState({
      rifffs: { 'rifff-a': rifffA, 'rifff-b': rifffB },
      channelOrder: ['rifff-a', 'rifff-b'],
      channelOf: { 'rifff-a': 'rifff-a', 'rifff-b': 'rifff-b' },
      busOf: { 'rifff-a:0': 'drums', 'rifff-b:0': 'drums' }
    })
    const stemFileNames = new Map([
      ['rifff-a:0', 'a.wav'],
      ['rifff-b:0', 'b.wav']
    ])

    const xml = buildAlsXml(TEMPLATE_XML, state, '/out', stemFileNames)
    const { tracks } = tracksOf(xml)

    expect(findAllChildren(tracks, 'GroupTrack')).toHaveLength(1)
    const audioTracks = findAllChildren(tracks, 'AudioTrack')
    expect(audioTracks).toHaveLength(1) // both stems packed onto ONE track

    const body = childArray(audioTracks[0], 'AudioTrack')
    const deviceChain = findChild(body, 'DeviceChain')!
    const mainSeq = findChild(childArray(deviceChain, 'DeviceChain'), 'MainSequencer')!
    const sample = findChild(childArray(mainSeq, 'MainSequencer'), 'Sample')!
    const arrangerAuto = findChild(childArray(sample, 'Sample'), 'ArrangerAutomation')!
    const events = findChild(childArray(arrangerAuto, 'ArrangerAutomation'), 'Events')!
    const clips = findAllChildren(childArray(events, 'Events'), 'AudioClip')
    expect(clips).toHaveLength(2) // one clip per stem, same track
  })

  it('opens a second track when two stems from the same bus DO overlap in time', () => {
    const rifffA = { ...drumsRifff(), groupId: 'rifff-a', name: 'a' } // startBar: 8
    const rifffB: Rifff = {
      ...drumsRifff(),
      groupId: 'rifff-b',
      name: 'b',
      startBar: 8 // same start as rifff-a -- fully overlapping
    }
    const state = emptyAppState({
      rifffs: { 'rifff-a': rifffA, 'rifff-b': rifffB },
      channelOrder: ['rifff-a', 'rifff-b'],
      channelOf: { 'rifff-a': 'rifff-a', 'rifff-b': 'rifff-b' },
      busOf: { 'rifff-a:0': 'drums', 'rifff-b:0': 'drums' }
    })
    const stemFileNames = new Map([
      ['rifff-a:0', 'a.wav'],
      ['rifff-b:0', 'b.wav']
    ])

    const xml = buildAlsXml(TEMPLATE_XML, state, '/out', stemFileNames)
    const { tracks } = tracksOf(xml)
    expect(findAllChildren(tracks, 'AudioTrack')).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/ableton/buildAlsXml.test.ts -t "bus clustering"`
Expected: FAIL — `emptyAppState` doesn't accept `busOf` yet, and the main loop still groups by
channel with one track per stem.

- [ ] **Step 3: Add `busOf` to `emptyAppState`'s defaults**

In `buildAlsXml.test.ts`'s `emptyAppState` function, add `busOf: {},` alongside the existing
`muteRegions: {},` entry.

- [ ] **Step 4: Add the `packIntoTracks` import**

At the top of `buildAlsXml.ts`, add:

```ts
import { packIntoTracks } from '@shared/packIntoTracks'
```

(Check the existing import block for the `@shared/...` alias convention already used by e.g.
`import { stemKey } from '@shared/types'` in this same file — match it exactly.)

- [ ] **Step 5: Split `buildStemTrack` into `buildStemClips` + `buildSharedAudioTrack`**

Read the current `buildStemTrack` function in full first — this step replaces it entirely with
two smaller functions. The full current function (for reference, so you can see exactly what's
being split apart) builds: (a) a cloned+renumbered track shell with `TrackGroupId`/`Name` set,
and (b) that track's own clip segments (already split around mute regions). This task keeps (b)
almost unchanged but decouples it from (a), since (a) now happens ONCE per shared track (possibly
holding several stems' clips), not once per stem.

First, add a small helper right above where `buildStemTrack` currently starts — this finds the
template's own canonical clip WITHOUT cloning the enclosing track, so it can be reused as a
clone-source across many different stems without each one needing its own throwaway track clone:

```ts
/** The template's own canonical AudioClip, found by traversing
 * `canonicalAudioTrack` directly (never cloned) -- a read-only source
 * every stem's own clip segments get cloned FROM. Kept separate from
 * building a real track so many different stems can share one physical
 * Ableton track (see buildSharedAudioTrack) while each still gets its own
 * fully-renumbered clip elements. */
function findCanonicalClip(canonicalAudioTrack: AlsNode): AlsNode {
  const body = childArray(canonicalAudioTrack, 'AudioTrack')
  const deviceChain = findChild(body, 'DeviceChain')!
  const mainSeq = findChild(childArray(deviceChain, 'DeviceChain'), 'MainSequencer')!
  const sample = findChild(childArray(mainSeq, 'MainSequencer'), 'Sample')!
  const arrangerAuto = findChild(childArray(sample, 'Sample'), 'ArrangerAutomation')!
  const events = findChild(childArray(arrangerAuto, 'ArrangerAutomation'), 'Events')!
  return findChild(childArray(events, 'Events'), 'AudioClip')!
}
```

Now replace the entire existing `buildStemTrack` function with:

```ts
interface StemClipsResult {
  clips: AlsNode[]
  trackName: string
  /** This stem's own OVERALL span (earliest segment's start to latest
   * segment's end), including any internal silent gap from a mute region
   * -- used as ONE indivisible packable unit by packIntoTracks. See this
   * task's own "Design decision" note in the plan for why packing doesn't
   * go finer than stem granularity. */
  startBeats: number
  endBeats: number
}

/**
 * Builds the AudioClip elements for one stem -- one per audible segment
 * (see subtractMutedRanges), each independently cloned from
 * `canonicalClipTemplate` and Id-renumbered via the shared `nextId`
 * counter. Does NOT build or clone a track -- callers combine multiple
 * stems' clips onto a shared AudioTrack via packIntoTracks, since
 * Ableton's own audio track can only play one clip at a time but
 * different (non-overlapping) stems can still share one.
 */
function buildStemClips(
  canonicalClipTemplate: AlsNode,
  nextId: () => number,
  rifff: Rifff,
  stem: Stem,
  fileName: string,
  outputDir: string,
  leftCropBars: number,
  playedBars: number,
  projectBpm: number,
  muteRegions: AppState['muteRegions']
): StemClipsResult {
  const trackName = `${rifff.name} - ${stem.name}`
  const nativeBpm = nativeBpmFor(stem)
  const {
    loopStartBeats,
    loopEndBeats,
    loopOn,
    timeShiftBars,
    currentEndBeats,
    hiddenLoopEndBeats,
    isWarped
  } = computeLoopWindow(stem, leftCropBars, playedBars, projectBpm)

  const clipStartBeats = ((rifff.startBar ?? 0) + timeShiftBars) * 4
  const clipEndBeats = clipStartBeats + currentEndBeats
  const muteRegionsForStem = muteRegions[stemKey(rifff.groupId, stem.slot)] ?? []
  const audibleSegments = subtractMutedRanges(clipStartBeats, clipEndBeats, muteRegionsForStem)

  const relativePath = join('Samples', 'Imported', fileName)
  const absolutePath = join(outputDir, relativePath)
  const tileLengthBeats = stem.barLength * 4

  const clips = audibleSegments.map((segment) => {
    const segClip = cloneNode(canonicalClipTemplate)
    renumberIds(segClip, nextId)

    setAttr(segClip, '@_Time', String(segment.segStartBeats))
    const clipBody = childArray(segClip, 'AudioClip')
    setAttr(findChild(clipBody, 'Name')!, '@_Value', trackName)
    setAttr(findChild(clipBody, 'CurrentStart')!, '@_Value', String(segment.segStartBeats))
    setAttr(findChild(clipBody, 'CurrentEnd')!, '@_Value', String(segment.segEndBeats))

    const loop = findChild(clipBody, 'Loop')!
    const loopBody = childArray(loop, 'Loop')
    const segLoopStartBeats = isWarped
      ? tilePhaseAtElapsedBeats(
          loopStartBeats,
          segment.segStartBeats - clipStartBeats,
          tileLengthBeats
        )
      : loopStartBeats
    setAttr(findChild(loopBody, 'LoopStart')!, '@_Value', String(segLoopStartBeats))
    setAttr(findChild(loopBody, 'LoopEnd')!, '@_Value', String(loopEndBeats))
    setAttr(findChild(loopBody, 'LoopOn')!, '@_Value', loopOn ? 'true' : 'false')
    setAttr(findChild(loopBody, 'HiddenLoopStart')!, '@_Value', '0')
    setAttr(findChild(loopBody, 'HiddenLoopEnd')!, '@_Value', String(hiddenLoopEndBeats))

    setAttr(findChild(clipBody, 'IsWarped')!, '@_Value', isWarped ? 'true' : 'false')

    const sampleRef = findChild(clipBody, 'SampleRef')!
    const fileRef = findChild(childArray(sampleRef, 'SampleRef'), 'FileRef')!
    const fileRefBody = childArray(fileRef, 'FileRef')
    setAttr(findChild(fileRefBody, 'Path')!, '@_Value', absolutePath)
    setAttr(findChild(fileRefBody, 'RelativePath')!, '@_Value', relativePath)

    setAttr(findChild(clipBody, 'WarpMode')!, '@_Value', String(warpModeFor(stem)))

    if (isWarped) {
      const warpMarkersNode = findChild(clipBody, 'WarpMarkers')!
      warpMarkersNode['WarpMarkers'] = [
        { WarpMarker: [], ':@': { '@_Id': String(nextId()), '@_SecTime': '0', '@_BeatTime': '0' } },
        {
          WarpMarker: [],
          ':@': { '@_Id': String(nextId()), '@_SecTime': String(60 / nativeBpm), '@_BeatTime': '1' }
        }
      ]
    }

    return segClip
  })

  return { clips, trackName, startBeats: clipStartBeats, endBeats: clipEndBeats }
}

/**
 * Clones the template audio track once and populates it with the given
 * clips (already fully built/Id-renumbered by buildStemClips) -- used for
 * a bus's own packed tracks, where several non-overlapping stems' clips
 * can share one physical Ableton track. `trackName` is the label for this
 * specific physical track, not necessarily any one stem's own name (see
 * this task's caller in buildAlsXml, which picks a shared label when more
 * than one stem lands on the same track).
 */
function buildSharedAudioTrack(
  canonicalAudioTrack: AlsNode,
  nextId: () => number,
  groupTrackId: string,
  trackName: string,
  clips: AlsNode[]
): AlsNode {
  const track = cloneNode(canonicalAudioTrack)
  renumberIds(track, nextId)
  clearSends(track, 'AudioTrack')

  const trackBody = childArray(track, 'AudioTrack')
  setAttr(findChild(trackBody, 'TrackGroupId')!, '@_Value', groupTrackId)
  const nameNode = findChild(trackBody, 'Name')!
  setAttr(findChild(childArray(nameNode, 'Name'), 'EffectiveName')!, '@_Value', trackName)

  const deviceChain = findChild(trackBody, 'DeviceChain')!
  const mainSeq = findChild(childArray(deviceChain, 'DeviceChain'), 'MainSequencer')!
  const sampleNode = findChild(childArray(mainSeq, 'MainSequencer'), 'Sample')!
  const arrangerAuto = findChild(childArray(sampleNode, 'Sample'), 'ArrangerAutomation')!
  const events = findChild(childArray(arrangerAuto, 'ArrangerAutomation'), 'Events')!
  events['Events'] = clips

  return track
}
```

- [ ] **Step 6: Re-partition the main `buildAlsXml` loop by bus**

Replace the existing channel-grouping loop:

```ts
  const byChannel = placedRifffsByChannel(state)
  for (const channelId of state.channelOrder) {
    const rifffs = byChannel.get(channelId)
    if (!rifffs || rifffs.length === 0) continue

    const groupTrack = cloneNode(canonicalGroupTrack)
    renumberIds(groupTrack, nextId)
    clearSends(groupTrack, 'GroupTrack')
    const groupTrackId = attrs(groupTrack)['@_Id']
    const groupName = earliestRifff(rifffs).name
    const groupNameNode = findChild(childArray(groupTrack, 'GroupTrack'), 'Name')!
    setAttr(findChild(childArray(groupNameNode, 'Name'), 'EffectiveName')!, '@_Value', groupName)
    outTracks.push(groupTrack)

    for (const rifff of rifffs) {
      const playedBars = resolvePlayedBarsFor(state, rifff.groupId)
      const leftCropBars = state.leftCrop[rifff.groupId] ?? 0

      for (const stem of rifff.stems) {
        const key = stemKey(rifff.groupId, stem.slot)
        const fileName = stemFileNames.get(key)
        if (!fileName) continue

        const track = buildStemTrack(
          canonicalAudioTrack,
          nextId,
          rifff,
          stem,
          fileName,
          outputDir,
          groupTrackId,
          leftCropBars,
          playedBars,
          state.bpm,
          state.muteRegions
        )
        outTracks.push(track)
      }
    }
  }
```

with:

```ts
  const BUS_IDS: BusId[] = ['drums', 'bass', 'lead', 'backing', 'aux']
  const DEFAULT_BUS: BusId = 'aux'
  const canonicalClipTemplate = findCanonicalClip(canonicalAudioTrack)

  const byBus = new Map<BusId, StemClipsResult[]>()
  for (const busId of BUS_IDS) byBus.set(busId, [])

  const placed = Object.values(state.rifffs).filter((r) => r.startBar !== undefined)
  for (const rifff of placed) {
    const playedBars = resolvePlayedBarsFor(state, rifff.groupId)
    const leftCropBars = state.leftCrop[rifff.groupId] ?? 0

    for (const stem of rifff.stems) {
      const key = stemKey(rifff.groupId, stem.slot)
      const fileName = stemFileNames.get(key)
      if (!fileName) continue

      const result = buildStemClips(
        canonicalClipTemplate,
        nextId,
        rifff,
        stem,
        fileName,
        outputDir,
        leftCropBars,
        playedBars,
        state.bpm,
        state.muteRegions
      )
      if (result.clips.length === 0) continue // fully muted -- nothing to place

      const busId = state.busOf[key] ?? DEFAULT_BUS
      byBus.get(busId)!.push(result)
    }
  }

  for (const busId of BUS_IDS) {
    const entries = byBus.get(busId)!
    if (entries.length === 0) continue

    const groupTrack = cloneNode(canonicalGroupTrack)
    renumberIds(groupTrack, nextId)
    clearSends(groupTrack, 'GroupTrack')
    const groupTrackId = attrs(groupTrack)['@_Id']
    const groupNameNode = findChild(childArray(groupTrack, 'GroupTrack'), 'Name')!
    setAttr(findChild(childArray(groupNameNode, 'Name'), 'EffectiveName')!, '@_Value', busId)
    outTracks.push(groupTrack)

    const packed = packIntoTracks(
      entries,
      (e) => e.startBeats,
      (e) => e.endBeats
    )
    for (const trackEntries of packed) {
      const allClips = trackEntries.flatMap((e) => e.clips)
      // If only one stem landed on this physical track, use its own name
      // -- otherwise several stems share it (packed together because they
      // don't overlap in time), and picking one arbitrarily would
      // misrepresent what's actually on it.
      const trackName =
        trackEntries.length === 1 ? trackEntries[0].trackName : `${busId} (shared)`
      const track = buildSharedAudioTrack(
        canonicalAudioTrack,
        nextId,
        groupTrackId,
        trackName,
        allClips
      )
      outTracks.push(track)
    }
  }
```

Add `import type { BusId } from '@shared/types'` to this file's existing `@shared/types` import
(it already imports `stemKey` from there — add `BusId` as a type-only addition to the same line
if the existing import isn't already `import type`, or add a separate `import type { BusId } from
'@shared/types'` line, matching whatever this file's existing convention is for type-only vs
value imports).

- [ ] **Step 7: Remove now-dead code**

`placedRifffsByChannel` and `earliestRifff` (both module-level functions earlier in this file) are
no longer called by anything after this change — the new loop iterates `Object.values(state.rifffs)`
directly and uses the bus id as the group name instead of `earliestRifff(rifffs).name`. Search the
whole file for any other caller of either function; if none exists (expected), delete both
functions. **This matters**: a previous task in an earlier feature left dead code behind here that
broke `tsc --noEmit` (`'X' is declared but its value is never read`) — don't repeat that, check
this explicitly rather than assuming.

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run src/main/ableton/buildAlsXml.test.ts`
Expected: ALL tests pass — the new `bus clustering` tests plus every pre-existing test in this
file. The pre-existing tests don't set `busOf` at all, so every stem in them falls back to `aux`
— confirm their existing assertions about track/clip attributes (Time, CurrentStart/CurrentEnd,
Loop*, etc.) still hold; only the GROUP TRACK's own name and grouping key changed (channel name
→ bus id), nothing about individual clip attributes should differ for a single-stem-per-bus case.

- [ ] **Step 9: Typecheck and lint**

Run: `npm run typecheck && npx eslint src/main/ableton/buildAlsXml.ts src/main/ableton/buildAlsXml.test.ts`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/main/ableton/buildAlsXml.ts src/main/ableton/buildAlsXml.test.ts
git commit -m "Ableton export: partition by bus and pack non-overlapping stems onto shared tracks"
```

---

### Task 5: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Full automated verification**

Run:
```bash
npm test
npm run typecheck
npm run lint
```
Expected: all pass with zero failures/errors (the pre-existing, unrelated `scanOneCandidate`
flaky test in `pluginScan.test.ts` — see its own history in this repo — may still fail
intermittently under load; not a regression to chase here).

- [ ] **Step 2: Manual walkthrough**

This phase touches only `src/shared/`, `src/renderer/src/state/`, and `src/main/` — no
`native-engine/` changes, so **no native engine rebuild or app relaunch is needed**; a normal
`npm run dev` renderer reload is enough to pick up the reducer/export changes.

Since there's no labelling UI yet in this phase, "hand-assigned buses" means dispatching
`ASSIGN_TO_BUS` isn't reachable from the UI at all yet — walk through what IS reachable:

1. **Export a real multi-stem project with no bus assignments at all**: confirm it opens in
   Ableton with exactly one group track named `aux` (assuming every stem falls back there),
   containing however many audio tracks `packIntoTracks` determined were needed — noticeably
   fewer than "one track per stem" if any stems don't overlap in time.
2. **Confirm every clip is still independently editable**: nothing was flattened/rendered:
   waveforms, warp settings, and loop points on each individual clip should look and behave
   exactly as they did before this change.
3. **Confirm solo-stem export (Export → export stems) still works correctly** and, if you have a
   limiter or other loud/obvious plugin in your master chain, confirm an isolated stem WAV no
   longer sounds affected by it (Task 1's fix) — compare a stem's isolated export against how it
   sounds within the full mix.

Report back if anything doesn't match — apply `superpowers:systematic-debugging` before
proposing a fix rather than guessing, per this project's own established convention.
