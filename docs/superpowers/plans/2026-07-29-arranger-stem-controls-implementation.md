# Arranger Stem Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring per-stem mute, volume, fade-in/out, and clip-length editing directly into the
arranger timeline (replacing Inspector-only editing), per
`docs/superpowers/specs/2026-07-29-arranger-stem-controls-design.md`.

**Architecture:** Mute/volume/fade already flow end-to-end (state → `buildEngineProject` →
native engine) — this plan only changes *where* they're set (a new always-visible per-stem
row instead of the Inspector panel) and adds one new capability, per-stem clip resize, which
needs a new state field, a `buildEngineProject`/wire-format addition, and a real (if small)
change to both scheduler implementations (TS reference + native C++, kept in sync by hand per
this codebase's existing convention).

**Tech Stack:** TypeScript/React (renderer), Node/Electron (main), C++/JUCE (native engine),
Vitest (TS tests), the native engine's own `--test` unit-test binary (C++ tests).

---

## Design decisions made while writing this plan (not fully pinned down by the design doc)

The design doc intentionally left some implementation-level details for this plan to resolve.
Resolved here, not left as open questions for the implementer:

1. **Only the right edge is an active resize handle.** The design doc's mockups showed handles
   at both edges, but only the *right* edge maps unambiguously onto the existing data model:
   `playedBars` controls how far the tiling loop runs *from the stem's own start*, and there's
   no existing concept of "extend the start earlier" without also moving `stemStart`/
   `startBar` (a different, existing mechanism — offset/nudge). Left-edge trim is a reasonable
   future addition but out of scope here to keep the semantics unambiguous.
2. **Fades stay per-group only** (matching the design doc) — the envelope is drawn identically
   on every stem row in a group using the shared `fadeIn`/`fadeOut` values; no new per-stem
   fade field.
3. **Drag interactions use local component state, dispatching once on release, not
   continuously during the drag.** `historyReducer` (`src/renderer/src/state/history.ts`)
   pushes a new undo entry on every dispatched action *except* an explicit
   `TRANSIENT_ACTION_TYPES` allowlist (currently just `SET_POS`/`PLAY`/`PAUSE`/`STOP`). A drag
   dispatching on every `mousemove` would flood undo history with dozens of intermediate
   frames per gesture and, since `MAX_HISTORY = 100`, could evict all prior real edits during
   one long drag. Each drag task below tracks an in-progress value in local `useState`,
   renders from that while dragging, and dispatches exactly once on `mouseup` — never adding
   these new action types to `TRANSIENT_ACTION_TYPES` (unlike playback position, a completed
   drag edit *should* be undo-able as one step).
4. **`loopLengthBars` and `stemGeometry` both need updating**, not just the scheduler — found
   by tracing what actually determines the overall project loop length and each row's
   displayed width. Missing this would mean a stem resized longer than its rifff's nominal
   `barLength` gets audibly cut off by the transport wrapping around before its extended tail
   finishes, even though the engine itself would schedule it correctly — a real, easy-to-miss
   bug if only the engine-facing plumbing were fixed. Task 1 fixes both.

---

### Task 1: State + selectors for per-stem resize

**Files:**
- Modify: `src/renderer/src/state/store.ts`
- Modify: `src/renderer/src/state/selectors.ts`
- Modify (or create if it doesn't exist yet — check first): `src/renderer/src/state/store.test.ts`, `src/renderer/src/state/selectors.test.ts`

- [ ] **Step 1: Read the current files in full**

Read `store.ts` and `selectors.ts` completely, and their existing test files if present,
before editing — match existing test conventions exactly rather than guessing their shape.

- [ ] **Step 2: Write the failing tests**

In `store.test.ts` (or wherever `SET_STEM_START`'s reducer test currently lives — add
alongside it, matching that test's exact style):

```ts
describe('SET_PLAYED_BARS', () => {
  it('sets playedBars for the given key', () => {
    const next = reducer(initialState, { type: 'SET_PLAYED_BARS', key: 'r1', bars: 12 })
    expect(next.playedBars.r1).toBe(12)
  })

  it('clamps to a minimum of 0.25 bars', () => {
    const next = reducer(initialState, { type: 'SET_PLAYED_BARS', key: 'r1', bars: -3 })
    expect(next.playedBars.r1).toBe(0.25)
  })
})
```

In `selectors.test.ts` (add alongside existing `stemGeometry`/`loopLengthBars` tests — read
those first for exact fixture conventions, e.g. how a `Rifff`/`AppState` fixture is built in
this file, and match it rather than reinventing one):

```ts
describe('resolvePlayedBars', () => {
  it('falls back to rifff.barLength when unset', () => {
    // build a minimal state with one placed 8-bar rifff, no playedBars entry
    expect(resolvePlayedBars(state, 'r1', 1)).toBe(8)
  })

  it('uses the group-shared value while linked', () => {
    const withOverride = { ...state, playedBars: { r1: 16 } }
    expect(resolvePlayedBars(withOverride, 'r1', 1)).toBe(16)
  })

  it('uses the per-stem value while unlinked', () => {
    const withOverride = {
      ...state,
      unlinked: { r1: true },
      playedBars: { 'r1:1': 20 }
    }
    expect(resolvePlayedBars(withOverride, 'r1', 1)).toBe(20)
  })
})

describe('stemGeometry width with a playedBars override', () => {
  it('reflects the resolved playedBars, not rifff.barLength', () => {
    const withOverride = { ...state, unlinked: { r1: true }, playedBars: { 'r1:1': 16 } }
    const geo = stemGeometry(withOverride, 'r1', 1, 24)
    expect(geo.widthPx).toBe(16 * 24) // 16 bars at ppb=24, assuming stretch stays on
  })
})

describe('loopLengthBars with a playedBars override', () => {
  it('extends the loop for a linked group resized beyond rifff.barLength', () => {
    const withOverride = { ...state, playedBars: { r1: 16 } } // rifff.barLength is 8
    expect(loopLengthBars(withOverride)).toBe(rifff.startBar! + 16)
  })

  it('extends the loop for an unlinked stem resized beyond rifff.barLength', () => {
    const withOverride = {
      ...state,
      unlinked: { r1: true },
      playedBars: { 'r1:1': 20 }
    }
    expect(loopLengthBars(withOverride)).toBe(rifff.startBar! + 20)
  })
})
```

Adjust the exact numbers/fixture shape to whatever `selectors.test.ts` already establishes as
its shared fixture — the intent above is what matters, not the literal fixture values.

- [ ] **Step 3: Run to confirm failure**

```bash
npx vitest run src/renderer/src/state/store.test.ts src/renderer/src/state/selectors.test.ts
```

- [ ] **Step 4: Implement — `store.ts`**

Add to `AppState` (alongside the other `Record<string, ...>` per-group-or-stem fields):

```ts
  /** This stem's own played length, in bars — the tiling loop's bound for this
   * specific stem, resolved via resolveOffsetKey (shared while linked, per-stem
   * once unlinked). Unset means "use rifff.barLength" — today's implicit
   * behavior, unchanged for a project with no resize edits. */
  playedBars: Record<string, number>
```

Add to `initialState`:

```ts
  playedBars: {},
```

Add to the `Action` union (alongside `SET_STEM_START`):

```ts
  | { type: 'SET_PLAYED_BARS'; key: string; bars: number }
```

Add the reducer case (alongside `SET_STEM_START`'s case):

```ts
    case 'SET_PLAYED_BARS':
      return {
        ...state,
        playedBars: { ...state.playedBars, [action.key]: Math.max(0.25, action.bars) }
      }
```

- [ ] **Step 5: Implement — `selectors.ts`**

Add near `resolveOffsetKey`:

```ts
/** A stem's own played length, in bars — the tiling loop's bound for this
 * specific stem. Falls back to rifff.barLength (today's implicit behavior)
 * when no override has been set. Same linked/unlinked resolution as off/vol/mute. */
export function resolvePlayedBars(state: AppState, groupId: string, slot: number): number {
  const rifff = state.rifffs[groupId]
  const key = resolveOffsetKey(state, groupId, slot)
  return state.playedBars[key] ?? rifff.barLength
}
```

Update `stemGeometry` to use it instead of always `rifff.barLength`:

```ts
export function stemGeometry(
  state: AppState,
  groupId: string,
  slot: number,
  ppb: number
): ClipGeometry {
  const rifff = state.rifffs[groupId]
  const start = stemStartBar(state, groupId, slot)
  const offsetSteps = state.off[resolveOffsetKey(state, groupId, slot)] ?? 0
  const snapDiv = SNAP_DIVS[state.snapIdx]
  const offsetPx = (offsetSteps * ppb) / snapDiv
  const playedBars = resolvePlayedBars(state, groupId, slot)
  const stretchOn = state.stretch[groupId] ?? true
  const shownBars = stretchOn ? playedBars : playedBars * (rifff.bpm / state.bpm)
  return { leftPx: start * ppb + offsetPx, widthPx: shownBars * ppb }
}
```

(Note `clipGeometry` — the whole-rifff-header geometry, not per-stem — is deliberately left
unchanged here; it's used for the header column's own click/drag target sizing, not tied to
any individual stem's resize.)

Update `loopLengthBars` to account for a resized stem/group, in both branches:

```ts
export function loopLengthBars(state: AppState): number {
  const ends: number[] = []
  for (const rifff of Object.values(state.rifffs)) {
    if (rifff.startBar === undefined) continue
    if (state.unlinked[rifff.groupId]) {
      for (const stem of rifff.stems) {
        const playedBars = resolvePlayedBars(state, rifff.groupId, stem.slot)
        ends.push(stemStartBar(state, rifff.groupId, stem.slot) + playedBars)
      }
    } else {
      const playedBars = state.playedBars[rifff.groupId] ?? rifff.barLength
      ends.push(rifff.startBar + playedBars)
    }
  }
  return ends.length === 0 ? DEFAULT_LOOP_BARS : Math.max(...ends)
}
```

- [ ] **Step 6: Run tests, confirm pass**

```bash
npx vitest run src/renderer/src/state/store.test.ts src/renderer/src/state/selectors.test.ts
```

- [ ] **Step 7: Typecheck, lint**

```bash
npm run typecheck && npm run lint
```

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/state/store.ts src/renderer/src/state/selectors.ts src/renderer/src/state/store.test.ts src/renderer/src/state/selectors.test.ts
git commit -m "arranger controls: playedBars state field, SET_PLAYED_BARS action, selector updates"
```

---

### Task 2: `buildEngineProject.ts` — resolve `playedBars` onto `EngineStem`

**Files:**
- Modify: `src/shared/buildEngineProject.ts`
- Modify: `src/shared/buildEngineProject.test.ts`

- [ ] **Step 1: Read both files in full** (the test file especially — Task 1's dependency,
  `resolvePlayedBars`, is now available to import here).

- [ ] **Step 2: Write the failing test**

Add to `buildEngineProject.test.ts`, matching the existing fixture (`rifff`, `stateWith`):

```ts
it('resolves playedBars via resolvePlayedBars, defaulting to rifff.barLength when unset', async () => {
  const state = stateWith({ bpm: 150 }) // ratio 1, no stretch call needed
  const project = await buildEngineProject(state, vi.fn())
  expect(project.rifffs[0].stems[0].playedBars).toBe(rifff.barLength)
})

it('reflects a playedBars override', async () => {
  const state = stateWith({ bpm: 150, playedBars: { r1: 16 } })
  const project = await buildEngineProject(state, vi.fn())
  expect(project.rifffs[0].stems[0].playedBars).toBe(16)
})
```

- [ ] **Step 3: Run to confirm failure**

```bash
npx vitest run src/shared/buildEngineProject.test.ts
```

- [ ] **Step 4: Implement**

Add to `EngineStem`:

```ts
export interface EngineStem {
  // ...existing fields...
  playedBars: number
}
```

Import `resolvePlayedBars` (alongside the existing `resolveOffsetKey`/`stemStartBar` import
from `'../renderer/src/state/selectors'`), and use it when pushing each stem:

```ts
      stems.push({
        stemKey: key,
        resolvedPath: resolved.path,
        durationSec: resolved.durationSec,
        barLength: stem.barLength,
        playedBars: resolvePlayedBars(state, rifff.groupId, stem.slot),
        offsetSteps,
        startBarOverride: override,
        volume: state.vol[key] ?? 1,
        muted: state.mute[key] ?? false
      })
```

- [ ] **Step 5: Run tests, confirm pass**

```bash
npx vitest run src/shared/buildEngineProject.test.ts
```

- [ ] **Step 6: Typecheck, lint**

```bash
npm run typecheck && npm run lint
```

- [ ] **Step 7: Commit**

```bash
git add src/shared/buildEngineProject.ts src/shared/buildEngineProject.test.ts
git commit -m "arranger controls: resolve playedBars onto EngineStem"
```

---

### Task 3: TS scheduler — `ScheduleOptions.playedBars`

**Files:**
- Modify: `src/shared/schedulePlayback.ts`
- Modify: `src/shared/schedulePlayback.test.ts`

Note: `computeStemSchedule` in this file is no longer called by any live production code path
(`AudioEngine.ts`, its only production consumer, was deleted when live playback moved to the
native engine) — it now exists purely as the TS-side reference that the native C++ port
(`native-engine/Source/SchedulePlayback.cpp`) is manually kept in sync with, and that this
file's own unit tests exercise. This task updates that reference; Task 4 updates the real,
live C++ port to match.

- [ ] **Step 1: Read both files in full.**

- [ ] **Step 2: Write the failing tests**

Add to `schedulePlayback.test.ts`, matching its existing fixture/style:

```ts
it('tiles the stem twice when playedBars exceeds rifff.barLength by one full stem length', () => {
  const segments = computeStemSchedule(rifff, rifff.stems[0], {
    offsetSteps: 0,
    snapDiv: 16,
    projectPos: -Infinity,
    projectBpm: rifff.bpm,
    playedBars: rifff.stems[0].barLength * 2 // stem's own barLength doubled
  })
  expect(segments).toHaveLength(2)
  expect(segments[0].bufferOffsetSec).toBe(0)
  expect(segments[1].bufferOffsetSec).toBe(0) // second tile restarts from the stem's own beginning
  expect(segments[1].startBarInTimeline).toBe(segments[0].startBarInTimeline + rifff.stems[0].barLength)
})

it('truncates to one shorter segment when playedBars is less than the stem barLength', () => {
  const segments = computeStemSchedule(rifff, rifff.stems[0], {
    offsetSteps: 0,
    snapDiv: 16,
    projectPos: -Infinity,
    projectBpm: rifff.bpm,
    playedBars: rifff.stems[0].barLength / 2
  })
  expect(segments).toHaveLength(1)
  expect(segments[0].barLength).toBe(rifff.stems[0].barLength / 2)
})

it('defaults to rifff.barLength when playedBars is omitted (unchanged existing behavior)', () => {
  const withOverride = computeStemSchedule(rifff, rifff.stems[0], {
    offsetSteps: 0, snapDiv: 16, projectPos: -Infinity, projectBpm: rifff.bpm,
    playedBars: rifff.barLength
  })
  const withoutOverride = computeStemSchedule(rifff, rifff.stems[0], {
    offsetSteps: 0, snapDiv: 16, projectPos: -Infinity, projectBpm: rifff.bpm
  })
  expect(withoutOverride).toEqual(withOverride)
})
```

(Adjust exact fixture field access to whatever `rifff`/`stems[0]` shape the existing test file
already defines.)

- [ ] **Step 3: Run to confirm failure**

```bash
npx vitest run src/shared/schedulePlayback.test.ts
```

- [ ] **Step 4: Implement**

Add to `ScheduleOptions`:

```ts
export interface ScheduleOptions {
  offsetSteps: number
  snapDiv: number
  projectPos: number
  projectBpm: number
  startBarOverride?: number
  /** Overrides rifff.barLength as this stem's own tiling bound. Undefined
   * means "use rifff.barLength" — today's implicit default, unchanged. */
  playedBars?: number
}
```

Change the loop bound (both the `for` condition and the `min(...)` clamp) from
`rifff.barLength` to a resolved `bound`:

```ts
export function computeStemSchedule(
  rifff: Rifff,
  stem: Stem,
  opts: ScheduleOptions
): PlaybackSegment[] {
  const start = opts.startBarOverride ?? rifff.startBar ?? 0
  const offsetBars = opts.offsetSteps / opts.snapDiv
  const secPerBarNative = stem.durationSec / stem.barLength
  const bound = opts.playedBars ?? rifff.barLength

  const segments: PlaybackSegment[] = []
  for (let barOffset = 0; barOffset < bound; barOffset += stem.barLength) {
    const segmentBarLength = Math.min(stem.barLength, bound - barOffset)
    const startBarInTimeline = start + offsetBars + barOffset
    const endBarInTimeline = startBarInTimeline + segmentBarLength
    if (endBarInTimeline <= opts.projectPos) continue
    segments.push({
      startBarInTimeline,
      barLength: segmentBarLength,
      bufferOffsetSec: 0,
      durationSec: segmentBarLength * secPerBarNative
    })
  }
  return segments
}
```

- [ ] **Step 5: Run tests, confirm pass**

```bash
npx vitest run src/shared/schedulePlayback.test.ts
```

- [ ] **Step 6: Typecheck, lint**

```bash
npm run typecheck && npm run lint
```

- [ ] **Step 7: Commit**

```bash
git add src/shared/schedulePlayback.ts src/shared/schedulePlayback.test.ts
git commit -m "arranger controls: playedBars option in TS reference scheduler"
```

---

### Task 4: Native C++ — wire format + scheduler + `PlaybackEngine` threading

**Files:**
- Modify: `native-engine/Source/EngineProject.h`
- Modify: `native-engine/Source/EngineProject.cpp`
- Modify: `native-engine/Source/SchedulePlayback.h`
- Modify: `native-engine/Source/SchedulePlayback.cpp`
- Modify: `native-engine/Source/PlaybackEngine.cpp`
- Modify: `native-engine/Source/SchedulePlaybackTests.cpp`

This is the one part of this whole plan that touches native C++ — give it the same care and
independent re-verification the earlier JUCE engine integration phases gave any native change.

- [ ] **Step 1: Read all six files in full** before editing — confirm the current exact
  contents match what's described below (this plan was written against a specific snapshot;
  re-confirm nothing has shifted).

- [ ] **Step 2: `EngineProject.h`** — add the field to `EngineStem`:

```cpp
    struct EngineStem
    {
        juce::String stemKey;
        juce::String resolvedPath;
        double durationSec = 0.0;
        int barLength = 0;
        double playedBars = 0.0; // this stem's own tiling bound
        double offsetSteps = 0.0;
        double startBarOverride = -1.0; // -1.0 = use the rifff's own startBar
        double volume = 1.0;
        bool muted = false;
    };
```

- [ ] **Step 3: `EngineProject.cpp`** — parse it, defaulting to the just-parsed
  `rifff.barLength` if absent (defensive backward-compat fallback — the real TS client always
  sends a concrete value, per Task 2, so this default should never actually be hit in
  practice, but keeps parsing safe against a malformed/older payload):

```cpp
                        stem.durationSec = getDouble(stemVar, "durationSec", 0.0);
                        stem.barLength = (int) getDouble(stemVar, "barLength", 0.0);
                        stem.playedBars = getDouble(stemVar, "playedBars", (double) rifff.barLength);
                        stem.offsetSteps = getDouble(stemVar, "offsetSteps", 0.0);
```

(Insert the new line directly after `barLength` is parsed, before `offsetSteps` — matches the
struct's own field order and keeps `rifff.barLength` in scope as the fallback default, since
`rifff.barLength` was parsed earlier in this same function, above the stems loop.)

- [ ] **Step 4: `SchedulePlayback.h`** — add the field to `ScheduleOptions`:

```cpp
    struct ScheduleOptions
    {
        double offsetSteps = 0.0;
        double snapDiv = 16.0;
        double projectPos = 0.0;
        double projectBpm = 0.0;
        double startBarOverride = -1.0;
        /** Overrides rifff.barLength as this stem's own tiling bound. -1.0 means
         * "no override — use rifff.barLength", matching startBarOverride's own
         * sentinel convention above. */
        double playedBars = -1.0;
    };
```

- [ ] **Step 5: `SchedulePlayback.cpp`** — resolve the bound and use it in place of
  `rifff.barLength` in both the loop condition and the `min(...)` clamp:

```cpp
    std::vector<PlaybackSegment> computeStemSchedule(
        const RifffInfo& rifff,
        const StemInfo& stem,
        const ScheduleOptions& opts)
    {
        const double start = opts.startBarOverride >= 0.0 ? opts.startBarOverride : rifff.startBar;
        const double offsetBars = opts.offsetSteps / opts.snapDiv;
        const double secPerBarNative = stem.durationSec / (double) stem.barLength;
        const double bound = opts.playedBars >= 0.0 ? opts.playedBars : (double) rifff.barLength;

        std::vector<PlaybackSegment> segments;
        for (double barOffset = 0.0; barOffset < bound; barOffset += (double) stem.barLength)
        {
            const double segmentBarLength = std::min((double) stem.barLength, bound - barOffset);
            const double startBarInTimeline = start + offsetBars + barOffset;
            const double endBarInTimeline = startBarInTimeline + segmentBarLength;
            if (endBarInTimeline <= opts.projectPos)
                continue;
            segments.push_back(PlaybackSegment {
                startBarInTimeline,
                segmentBarLength,
                0.0,
                segmentBarLength * secPerBarNative
            });
        }
        return segments;
    }
```

Note `RifffInfo.barLength` itself is deliberately left unchanged/unremoved in `SchedulePlayback.h`
even though this function no longer reads it for its loop bound — a minimal, surgical diff;
removing the field would mean auditing every other construction site of `RifffInfo` for no
benefit to this task.

- [ ] **Step 6: `PlaybackEngine.cpp`** — thread `stem.playedBars` through into the
  `ScheduleOptions` constructed for each stem (this is a positional/aggregate initializer —
  the new value must be appended in the same order as the struct's fields, i.e. last):

```cpp
                const ScheduleOptions opts {
                    stem.offsetSteps, currentProject.snapDiv,
                    -std::numeric_limits<double>::infinity(),
                    currentProject.bpm, stem.startBarOverride, stem.playedBars
                };
```

- [ ] **Step 7: `SchedulePlaybackTests.cpp`** — read this file's existing test style/framework
  (JUCE's `UnitTest` class) and add test cases mirroring Task 3's three new TS cases: tiling
  twice when `playedBars` exceeds the stem's own `barLength`, truncating to one shorter
  segment when `playedBars` is less than it, and unchanged behavior when `playedBars` is left
  at its `-1.0` default. Match this file's existing assertion helper style exactly (read a
  couple of its current test cases first) rather than inventing new conventions.

- [ ] **Step 8: Rebuild the native engine**

```bash
cd native-engine/build && cmake --build . && cd ../..
```

- [ ] **Step 9: Run the native test suite, confirm pass (including the new cases)**

```bash
native-engine/build/ssstitch_engine_artefacts/Debug/ssstitch_engine --test
```

- [ ] **Step 10: Run the full TS suite too, confirm no regressions**

```bash
npx vitest run
```

- [ ] **Step 11: Commit**

```bash
git add native-engine/Source/EngineProject.h native-engine/Source/EngineProject.cpp native-engine/Source/SchedulePlayback.h native-engine/Source/SchedulePlayback.cpp native-engine/Source/PlaybackEngine.cpp native-engine/Source/SchedulePlaybackTests.cpp
git commit -m "arranger controls: playedBars support in native scheduler + wire format"
```

---

### Task 5: Native-side render-parity test for `playedBars`

**Files:**
- Modify: `native-engine/test/parity/render-parity.test.ts`

Proves the Task 4 change holds in real rendered audio, not just the scheduling data
structure — matching this project's established "measure the real thing" precedent from its
other parity tests.

- [ ] **Step 1: Read the current file in full** (it now has the 4 cases from the JUCE engine
  phases — volume, fade-in, invalid-bpm, stretch-ratio — plus whatever Task 4 didn't touch
  here, since Task 4 only changed native C++ source, not this test file).

- [ ] **Step 2: Add a 5th case**

```ts
  it('re-loops a stem from its own beginning when playedBars exceeds its native barLength', async () => {
    // 1-bar stem (4s tone at 60bpm), playedBars=2 -> should tile twice, restarting
    // from the buffer's own start each time (not looping/wrapping mid-buffer).
    const project: EngineProject = {
      bpm: 60,
      snapDiv: 16,
      rifffs: [
        {
          groupId: 'r1',
          startBar: 0,
          barLength: 1, // rifff.barLength deliberately UNCHANGED/irrelevant here —
                        // playedBars is what the scheduler now actually reads
          fadeInBars: 0,
          fadeOutBars: 0,
          stems: [
            {
              stemKey: 'r1:1',
              resolvedPath: tonePath,
              durationSec: 4.0,
              barLength: 1,
              playedBars: 2, // the actual point of this test
              offsetSteps: 0,
              startBarOverride: -1,
              volume: 1.0,
              muted: false
            }
          ]
        }
      ]
    }
    const projectPath = join(dir, 'project-playedbars.json')
    writeFileSync(projectPath, JSON.stringify(project))
    const nativeOutPath = join(dir, 'native-out-playedbars.wav')
    // durationBars=2 to cover the full 8s (2 tiles x 4s) this project should now render.
    execFileSync(ENGINE_BINARY, ['--render-test', projectPath, nativeOutPath, '2'])
    const nativeSamples = readWavSamples(nativeOutPath)

    // Reference: the 4s tone concatenated with itself (two full, unstretched,
    // unfaded repeats back-to-back), each repeat starting from the buffer's own
    // sample 0 — exactly what "re-loops from the beginning" means.
    const toneBuf = readFileSync(tonePath)
    const oneTileSamples = new Int16Array(Math.floor(4.0 * 44100))
    for (let i = 0; i < oneTileSamples.length; i++) {
      oneTileSamples[i] = toneBuf.readInt16LE(44 + i * 2)
    }
    const expectedSamples = new Int16Array(oneTileSamples.length * 2)
    expectedSamples.set(oneTileSamples, 0)
    expectedSamples.set(oneTileSamples, oneTileSamples.length)

    expect(nativeSamples.length).toBeGreaterThanOrEqual(expectedSamples.length)
    let maxDiff = 0
    for (let i = 0; i < expectedSamples.length; i++) {
      maxDiff = Math.max(maxDiff, Math.abs(nativeSamples[i * 2] - expectedSamples[i]))
    }
    console.log('render-parity: playedBars re-loop test maxDiff =', maxDiff)
    expect(maxDiff).toBeLessThanOrEqual(2) // 16-bit rounding tolerance, matching the other cases
  })
```

- [ ] **Step 3: Run it**

```bash
npx vitest run native-engine/test/parity/render-parity.test.ts
```

Expected: PASS, all 5 cases. If the new case fails, that's a genuine finding about Task 4's
correctness — investigate and fix Task 4's native code, don't weaken this test's tolerance to
make it pass.

- [ ] **Step 4: Commit**

```bash
git add native-engine/test/parity/render-parity.test.ts
git commit -m "arranger controls: render-parity test for playedBars re-loop behavior"
```

---

### Task 6: `StemWaveformRow.tsx` — static rendering + mute toggle (replaces `StemSubRow`)

**Files:**
- Create: `src/renderer/src/components/StemWaveformRow.tsx`
- Delete: `src/renderer/src/components/StemSubRow.tsx` (confirm no other importer first — see
  Step 1)

This task establishes the new component's basic shape: layered waveform (gray underneath,
full-color on top, clipped by the volume/fade envelope), the mute dot, and the envelope path
math — no drag interactions yet (Tasks 7-9 add those). Muting is a simple click, included here
since it's tightly coupled to "how does a muted row look" (already needed for this task's
static rendering) rather than being its own task.

- [ ] **Step 1: Read current files first**

Read `StemSubRow.tsx` (being replaced), `Waveform.tsx`, `selectors.ts` (`stemGeometry`,
`resolveOffsetKey`), `Ruler.tsx` (`PPB`), and `theme/typeColor.ts` (`typeColorVar`) in full.
Confirm `StemSubRow` has no other importer besides `RifffBlockRow.tsx`
(`grep -rn "StemSubRow" src/`) — Task 8 will remove that one remaining usage; don't delete
`StemSubRow.tsx` itself until Task 8 has landed and confirmed clean (leave the delete as the
literal last step of *this* task's own commit only if the grep above is already clean *and*
you've also updated `RifffBlockRow.tsx`'s import — if that feels like it's creeping into Task
8's scope, it's fine to leave `StemSubRow.tsx` in place, still imported by the still-untouched
`RifffBlockRow.tsx`, and let Task 8 do the actual deletion once it stops being the thing that
imports it. Either ordering is fine; don't leave the repo mid-task in a state where
`RifffBlockRow.tsx` imports a file that no longer exists.

- [ ] **Step 2: Implement**

```tsx
// src/renderer/src/components/StemWaveformRow.tsx
import { useDispatch, useAppState } from '../state/StoreContext'
import { stemKey } from '@shared/types'
import { stemGeometry, resolveOffsetKey } from '../state/selectors'
import { typeColorVar } from '../theme/typeColor'
import { Waveform } from './Waveform'
import { PPB } from './Ruler'

const ROW_HEIGHT = 44

/** Builds the SVG path `d` for the "below the envelope" region — a closed shape
 * bounded above by a curve that eases from silence at the very start, up to the
 * volume plateau by fadeInPx, holds flat until foStart, then eases back down to
 * silence by the very end. Used as a CSS clip-path on the full-color waveform
 * layer; everything outside this region (above the curve) shows only the
 * always-visible gray layer underneath. */
function buildEnvelopePath(
  width: number,
  height: number,
  fadeInPx: number,
  fadeOutPx: number,
  plateauY: number
): string {
  const fiEnd = Math.min(fadeInPx, width / 2)
  const foStart = Math.max(width - fadeOutPx, width / 2)
  const c1x = fiEnd * 0.35
  const c2x = fiEnd * 0.65
  const c3x = foStart + (width - foStart) * 0.35
  const c4x = foStart + (width - foStart) * 0.65
  return (
    `M0,${height} ` +
    `C${c1x},${height} ${c2x},${plateauY} ${fiEnd},${plateauY} ` +
    `L${foStart},${plateauY} ` +
    `C${c3x},${plateauY} ${c4x},${height} ${width},${height} ` +
    `Z`
  )
}

export function StemWaveformRow({
  groupId,
  slot
}: {
  groupId: string
  slot: number
}): React.JSX.Element {
  const state = useAppState()
  const dispatch = useDispatch()
  const rifff = state.rifffs[groupId]
  const stem = rifff.stems.find((s) => s.slot === slot)!
  const color = typeColorVar(stem.type)
  const key = stemKey(groupId, slot)
  const muted = !!state.mute[key]
  const unlinked = !!state.unlinked[groupId]
  const volume = state.vol[key] ?? 1
  const fadeIn = state.fadeIn[groupId] ?? 0
  const fadeOut = state.fadeOut[groupId] ?? 0

  const stemGeo = stemGeometry(state, groupId, slot, PPB)
  const fadeInPx = fadeIn * PPB
  const fadeOutPx = fadeOut * PPB
  const plateauY = ROW_HEIGHT * (1 - volume)
  const envelopePath = buildEnvelopePath(stemGeo.widthPx, ROW_HEIGHT, fadeInPx, fadeOutPx, plateauY)

  return (
    <div style={{ display: 'flex', height: ROW_HEIGHT, borderTop: '1px solid var(--ra-bg-row)' }}>
      <div style={{ width: 212, flexShrink: 0 }} />
      <div style={{ flex: 1, position: 'relative' }}>
        <div
          draggable={unlinked}
          onDragStart={(e) => {
            if (!unlinked) return
            e.dataTransfer.setData('text/rifff-stem-key', key)
          }}
          title={unlinked ? 'drag to move this stem independently' : undefined}
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: stemGeo.leftPx,
            width: stemGeo.widthPx,
            cursor: unlinked ? 'grab' : 'default',
            borderRadius: 3,
            border: `1px solid color-mix(in srgb, ${color} 40%, transparent)`,
            background: 'var(--ra-bg-row-sub)',
            overflow: 'hidden'
          }}
        >
          {/* Always-visible gray layer underneath */}
          <Waveform path={stem.path} color="var(--ra-text-3)" opacity={1} />

          {/* Full-color layer on top, clipped to the envelope — suppressed
              entirely while muted, since mute always wins over the envelope. */}
          {!muted && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                clipPath: `path("${envelopePath}")`
              }}
            >
              <Waveform path={stem.path} color={color} opacity={1} />
            </div>
          )}

          {/* Mute dot: filled = unmuted (active), hollow = muted (off). Bigger
              than a typical small control, vertically centered on the row. */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              dispatch({ type: 'TOGGLE_MUTE', stemKey: key })
            }}
            title={muted ? 'unmute' : 'mute'}
            style={{
              position: 'absolute',
              top: '50%',
              left: 7,
              transform: 'translateY(-50%)',
              width: 12,
              height: 12,
              borderRadius: '50%',
              border: '1.5px solid rgba(201,191,232,0.6)',
              background: muted ? 'transparent' : 'var(--ra-text-2)',
              padding: 0,
              cursor: 'pointer',
              zIndex: 3
            }}
          />
        </div>
      </div>
    </div>
  )
}
```

A few things intentionally deferred to later tasks, not oversights: no resize handles (Task
7), no fade-knee dots (Task 8), no volume-plateau drag (Task 9). This task's `StemWaveformRow`
is fully usable (correct static visual + working mute) on its own — Tasks 7-9 layer
interactions onto the same file without changing this task's core structure.

- [ ] **Step 3: Typecheck, lint**

```bash
npm run typecheck && npm run lint
```

No automated test for this component — consistent with this codebase's existing precedent (no
renderer component test framework in use; `StemSubRow.tsx`, which this replaces, never had one
either). Visual/interaction correctness is verified manually in Task 12, once `RifffBlockRow.tsx`
(Task 10) actually renders this component in the real running app.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/StemWaveformRow.tsx
git commit -m "arranger controls: StemWaveformRow — layered waveform, envelope clip, mute toggle"
```

---

### Task 7: `StemWaveformRow.tsx` — resize-handle drag (right edge, `SET_PLAYED_BARS`)

**Files:**
- Modify: `src/renderer/src/components/StemWaveformRow.tsx`
- Create: `src/renderer/src/components/dragUtils.ts`

- [ ] **Step 1: Read the current `StemWaveformRow.tsx` in full** (Task 6's output).

- [ ] **Step 2: Create the shared drag utility**

Four separate drag gestures land on this one component across Tasks 7-9 (resize, fade-in
knee, fade-out knee, volume plateau) — a small shared utility avoids reinventing
mousemove/mouseup wiring four times:

```ts
// src/renderer/src/components/dragUtils.ts

/** Starts a window-level mouse drag from a React mousedown event. `onMove`
 * receives the CUMULATIVE delta from the drag's start point on every move
 * (not a frame-to-frame incremental delta) — callers should compute
 * `newValue = valueAtDragStart + delta / scale` rather than accumulating
 * incrementally, to avoid rounding drift across a long drag. Cleans up its
 * own listeners on mouseup and calls `onEnd` once, if provided. */
export function startPointerDrag(
  e: React.MouseEvent,
  onMove: (deltaX: number, deltaY: number) => void,
  onEnd?: () => void
): void {
  e.preventDefault()
  e.stopPropagation()
  const startX = e.clientX
  const startY = e.clientY

  function handleMove(ev: MouseEvent): void {
    onMove(ev.clientX - startX, ev.clientY - startY)
  }
  function handleUp(): void {
    window.removeEventListener('mousemove', handleMove)
    window.removeEventListener('mouseup', handleUp)
    onEnd?.()
  }
  window.addEventListener('mousemove', handleMove)
  window.addEventListener('mouseup', handleUp)
}
```

- [ ] **Step 3: Implement the resize handle**

Add `useState`/`useRef` imports and a local in-progress value, a resolved `playedBars` read,
and the handle itself. Insert the handle as a new child inside the same draggable stem
container `StemWaveformRow` already renders (after the mute-dot button), and wire the
component's displayed width to the in-progress value while dragging:

```tsx
import { useState } from 'react'
import { useDispatch, useAppState } from '../state/StoreContext'
import { stemKey } from '@shared/types'
import { stemGeometry, resolveOffsetKey, resolvePlayedBars } from '../state/selectors'
import { typeColorVar } from '../theme/typeColor'
import { Waveform } from './Waveform'
import { PPB } from './Ruler'
import { startPointerDrag } from './dragUtils'

// ...(buildEnvelopePath, ROW_HEIGHT unchanged from Task 6)...

export function StemWaveformRow({ groupId, slot }: { groupId: string; slot: number }): React.JSX.Element {
  const state = useAppState()
  const dispatch = useDispatch()
  const rifff = state.rifffs[groupId]
  const stem = rifff.stems.find((s) => s.slot === slot)!
  const color = typeColorVar(stem.type)
  const key = stemKey(groupId, slot)
  const playedBarsKey = resolveOffsetKey(state, groupId, slot)
  const muted = !!state.mute[key]
  const unlinked = !!state.unlinked[groupId]
  const volume = state.vol[key] ?? 1
  const fadeIn = state.fadeIn[groupId] ?? 0
  const fadeOut = state.fadeOut[groupId] ?? 0

  const [dragPlayedBars, setDragPlayedBars] = useState<number | null>(null)
  const resolvedPlayedBars = resolvePlayedBars(state, groupId, slot)
  const displayedPlayedBars = dragPlayedBars ?? resolvedPlayedBars

  const stemGeo = stemGeometry(state, groupId, slot, PPB)
  // While actively dragging, use the in-progress width instead of the
  // committed-state one, so the row visibly resizes in real time.
  const widthPx = dragPlayedBars !== null ? dragPlayedBars * PPB : stemGeo.widthPx

  const fadeInPx = fadeIn * PPB
  const fadeOutPx = fadeOut * PPB
  const plateauY = ROW_HEIGHT * (1 - volume)
  const envelopePath = buildEnvelopePath(widthPx, ROW_HEIGHT, fadeInPx, fadeOutPx, plateauY)

  function handleResizeStart(e: React.MouseEvent): void {
    const startPlayedBars = resolvedPlayedBars
    startPointerDrag(
      e,
      (deltaX) => {
        const next = Math.max(0.25, startPlayedBars + deltaX / PPB)
        setDragPlayedBars(next)
      },
      () => {
        setDragPlayedBars((current) => {
          if (current !== null) {
            dispatch({ type: 'SET_PLAYED_BARS', key: playedBarsKey, bars: current })
          }
          return null
        })
      }
    )
  }

  return (
    <div style={{ display: 'flex', height: ROW_HEIGHT, borderTop: '1px solid var(--ra-bg-row)' }}>
      <div style={{ width: 212, flexShrink: 0 }} />
      <div style={{ flex: 1, position: 'relative' }}>
        <div
          draggable={unlinked}
          onDragStart={(e) => {
            if (!unlinked) return
            e.dataTransfer.setData('text/rifff-stem-key', key)
          }}
          title={unlinked ? 'drag to move this stem independently' : undefined}
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: stemGeo.leftPx,
            width: widthPx,
            cursor: unlinked ? 'grab' : 'default',
            borderRadius: 3,
            border: `1px solid color-mix(in srgb, ${color} 40%, transparent)`,
            background: 'var(--ra-bg-row-sub)',
            overflow: 'hidden'
          }}
        >
          <Waveform path={stem.path} color="var(--ra-text-3)" opacity={1} />
          {!muted && (
            <div style={{ position: 'absolute', inset: 0, clipPath: `path("${envelopePath}")` }}>
              <Waveform path={stem.path} color={color} opacity={1} />
            </div>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation()
              dispatch({ type: 'TOGGLE_MUTE', stemKey: key })
            }}
            title={muted ? 'unmute' : 'mute'}
            style={{
              position: 'absolute',
              top: '50%',
              left: 7,
              transform: 'translateY(-50%)',
              width: 12,
              height: 12,
              borderRadius: '50%',
              border: '1.5px solid rgba(201,191,232,0.6)',
              background: muted ? 'transparent' : 'var(--ra-text-2)',
              padding: 0,
              cursor: 'pointer',
              zIndex: 3
            }}
          />
          <div
            onMouseDown={handleResizeStart}
            title={`${displayedPlayedBars.toFixed(2)} bars`}
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              right: 0,
              width: 5,
              cursor: 'ew-resize',
              background: '#fff',
              opacity: 0.55,
              zIndex: 3
            }}
          />
        </div>
      </div>
    </div>
  )
}
```

`e.stopPropagation()` inside `startPointerDrag` (already called there) prevents the resize
handle's `mousedown` from also triggering the outer container's native HTML5 `draggable`
interaction (relevant only while `unlinked`, since that's the only state where the outer
container is itself draggable) — confirm this holds during Task 12's manual verification
(drag the resize handle on an *unlinked* stem specifically, confirm it resizes rather than
starting a whole-stem move).

- [ ] **Step 4: Typecheck, lint**

```bash
npm run typecheck && npm run lint
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/StemWaveformRow.tsx src/renderer/src/components/dragUtils.ts
git commit -m "arranger controls: resize-handle drag for per-stem playedBars"
```

---

### Task 8: `StemWaveformRow.tsx` — fade-knee drags (`SET_FADE_IN`/`SET_FADE_OUT`)

**Files:**
- Modify: `src/renderer/src/components/StemWaveformRow.tsx`

- [ ] **Step 1: Read the current file in full** (Task 7's output).

- [ ] **Step 2: Implement**

Add two more local drag-in-progress values (`dragFadeIn`, `dragFadeOut`), the same
`FADE_MAX`/`FADE_STEP`-matching clamp Inspector used (`FADE_MAX = 4` bars — no lower clamp
below 0 needed beyond `Math.max(0, ...)`, matching `SET_FADE_IN`/`SET_FADE_OUT`'s own reducer
clamp), and two small white dot handles positioned at each envelope knee.

**This REPLACES, not adds alongside, Task 6/7's existing**
`const fadeInPx = fadeIn * PPB` **and** `const fadeOutPx = fadeOut * PPB` **lines** — declaring
both again under the same names would be a duplicate-declaration compile error. Delete those
two lines and put these in their place:

```tsx
const FADE_MAX = 4 // bars — matches Inspector's own fade clamp, now removed from that panel

// ...inside the component, alongside the existing dragPlayedBars state...
  const [dragFadeIn, setDragFadeIn] = useState<number | null>(null)
  const [dragFadeOut, setDragFadeOut] = useState<number | null>(null)
  const displayedFadeIn = dragFadeIn ?? fadeIn
  const displayedFadeOut = dragFadeOut ?? fadeOut
  // REPLACES Task 6/7's `const fadeInPx = fadeIn * PPB` / `const fadeOutPx = fadeOut * PPB`:
  const fadeInPx = displayedFadeIn * PPB
  const fadeOutPx = displayedFadeOut * PPB
  // envelopePath below (unchanged call, already in the file from Task 6/7) now picks up
  // these redeclared fadeInPx/fadeOutPx automatically — no other line needs to change.

  function handleFadeInStart(e: React.MouseEvent): void {
    const startFadeIn = fadeIn
    startPointerDrag(
      e,
      (deltaX) => setDragFadeIn(Math.max(0, Math.min(FADE_MAX, startFadeIn + deltaX / PPB))),
      () => {
        setDragFadeIn((current) => {
          if (current !== null) dispatch({ type: 'SET_FADE_IN', groupId, bars: current })
          return null
        })
      }
    )
  }

  function handleFadeOutStart(e: React.MouseEvent): void {
    const startFadeOut = fadeOut
    startPointerDrag(
      e,
      // Dragging the fade-OUT knee LEFT (negative deltaX) lengthens the fade —
      // it's the mirror of fade-in, so the sign is inverted here.
      (deltaX) => setDragFadeOut(Math.max(0, Math.min(FADE_MAX, startFadeOut - deltaX / PPB))),
      () => {
        setDragFadeOut((current) => {
          if (current !== null) dispatch({ type: 'SET_FADE_OUT', groupId, bars: current })
          return null
        })
      }
    )
  }
```

Add the two dot handles as children of the same draggable stem container, positioned at the
envelope's knee coordinates (reuse the same `fiEnd`/`foStart` logic `buildEnvelopePath`
already computes internally — either export those two numbers alongside the path string from
a small refactor of `buildEnvelopePath`, or recompute them inline here with the identical
formula; recomputing inline is simpler and avoids changing that function's signature):

```tsx
          {(() => {
            const fiEnd = Math.min(fadeInPx, widthPx / 2)
            const foStart = Math.max(widthPx - fadeOutPx, widthPx / 2)
            return (
              <>
                <div
                  onMouseDown={handleFadeInStart}
                  title={`fade in: ${displayedFadeIn.toFixed(2)} bars`}
                  style={{
                    position: 'absolute',
                    left: fiEnd,
                    top: plateauY,
                    transform: 'translate(-50%, -50%)',
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: '#fff',
                    cursor: 'pointer',
                    zIndex: 4
                  }}
                />
                <div
                  onMouseDown={handleFadeOutStart}
                  title={`fade out: ${displayedFadeOut.toFixed(2)} bars`}
                  style={{
                    position: 'absolute',
                    left: foStart,
                    top: plateauY,
                    transform: 'translate(-50%, -50%)',
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: '#fff',
                    cursor: 'pointer',
                    zIndex: 4
                  }}
                />
              </>
            )
          })()}
```

- [ ] **Step 3: Typecheck, lint**

```bash
npm run typecheck && npm run lint
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/StemWaveformRow.tsx
git commit -m "arranger controls: fade-in/fade-out knee drag handles"
```

---

### Task 9: `StemWaveformRow.tsx` — volume-plateau drag + value tooltip

**Files:**
- Modify: `src/renderer/src/components/StemWaveformRow.tsx`

- [ ] **Step 1: Read the current file in full** (Task 8's output).

- [ ] **Step 2: Implement**

**This REPLACES, not adds alongside, Task 6/7's existing**
`const plateauY = ROW_HEIGHT * (1 - volume)` **line** — delete it and put this in its place
(same duplicate-declaration hazard as Task 8's `fadeInPx`/`fadeOutPx` fix):

```tsx
import { dbLabel } from '@shared/visuals' // add to existing imports

// ...inside the component...
  const [dragVolume, setDragVolume] = useState<number | null>(null)
  const displayedVolume = dragVolume ?? volume
  // REPLACES Task 6/7's `const plateauY = ROW_HEIGHT * (1 - volume)`:
  const plateauY = ROW_HEIGHT * (1 - displayedVolume)

  function handleVolumeStart(e: React.MouseEvent): void {
    const startVolume = volume
    startPointerDrag(
      e,
      // Up (negative deltaY) increases volume — hence the subtraction.
      (_dx, deltaY) => setDragVolume(Math.max(0, Math.min(1, startVolume - deltaY / ROW_HEIGHT))),
      () => {
        setDragVolume((current) => {
          if (current !== null) dispatch({ type: 'SET_VOLUME', stemKey: key, volume: current })
          return null
        })
      }
    )
  }
```

Make the flat plateau section of the envelope itself the drag target (a thin invisible strip
spanning the width between the two fade knees, at `plateauY`), plus the drag-time tooltip.
Insert both as new children inside the same draggable stem container Tasks 6-8 already added
children to (alongside the mute button, resize handle, and fade-knee dots — order among
siblings doesn't matter, `zIndex` already governs stacking):

```tsx
          <div
            onMouseDown={handleVolumeStart}
            title="drag to adjust volume"
            style={{
              position: 'absolute',
              left: Math.min(fadeInPx, widthPx / 2),
              width: Math.max(0, widthPx - Math.min(fadeInPx, widthPx / 2) - Math.min(fadeOutPx, widthPx / 2)),
              top: plateauY - 4,
              height: 8,
              cursor: 'ns-resize',
              zIndex: 3
            }}
          />
          {dragVolume !== null && (
            <div
              style={{
                position: 'absolute',
                left: '50%',
                top: plateauY,
                transform: 'translate(-50%, -130%)',
                padding: '2px 6px',
                background: 'var(--ra-mute-on)',
                color: 'var(--ra-mute-on-ink)',
                fontSize: 10,
                fontWeight: 700,
                borderRadius: 4,
                zIndex: 5,
                whiteSpace: 'nowrap',
                pointerEvents: 'none'
              }}
            >
              {muted ? 'mute' : dbLabel(displayedVolume)}
            </div>
          )}
```

(`var(--ra-mute-on)`/`var(--ra-mute-on-ink)` and `dbLabel` are both existing, already used by
Inspector's own volume readout today — reusing them here keeps the new tooltip visually and
numerically consistent with how volume has always been displayed elsewhere in this app, rather
than inventing a new color/format.)

- [ ] **Step 3: Typecheck, lint**

```bash
npm run typecheck && npm run lint
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/StemWaveformRow.tsx
git commit -m "arranger controls: volume-plateau drag with drag-time dB tooltip"
```

---

### Task 10: `RifffBlockRow.tsx` — always render `StemWaveformRow`, drop the combined waveform

**Files:**
- Modify: `src/renderer/src/components/RifffBlockRow.tsx`
- Delete: `src/renderer/src/components/StemSubRow.tsx` (if Task 6 didn't already do this — see
  Task 6's Step 1 note; delete it now if it's still present and this task removes its last
  importer)

- [ ] **Step 1: Read the current file in full.**

- [ ] **Step 2: Implement**

Replace the whole "clip" div (the header strip + combined `Waveform` + fade-triangle
overlays) with nothing — that visual is gone. Keep the outer 212px header column exactly as
it is today MINUS the expand/collapse toggle button (no longer meaningful — stems are now
always shown), and keep its `onClick`/`draggable`/`onDragStart`/`onContextMenu` behavior
completely unchanged, since that's still the only way to select/move/right-click the whole
rifff as a unit. Replace the `{expanded && rifff.stems.map(...)}` block with an unconditional
map over `StemWaveformRow`:

```tsx
import { useAppState, useDispatch } from '../state/StoreContext'
import type { Rifff } from '@shared/types'
import { typeColorVar } from '../theme/typeColor'
import { StemWaveformRow } from './StemWaveformRow'
import { PolarGlyph } from './PolarGlyph'

function identityColor(rifff: Rifff): string {
  return typeColorVar(rifff.stems[0]?.type ?? 'fx')
}

export function RifffBlockRow({
  groupId,
  onOpenContextMenu
}: {
  groupId: string
  onOpenContextMenu: (x: number, y: number, groupId: string) => void
}): React.JSX.Element {
  const state = useAppState()
  const dispatch = useDispatch()
  const rifff = state.rifffs[groupId]
  const selected = state.sel === groupId
  const color = identityColor(rifff)

  return (
    <div style={{ borderBottom: '1px solid var(--ra-border-soft)' }}>
      <div
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('text/rifff-group-id', groupId)
        }}
        onClick={() => dispatch({ type: 'SELECT', groupId })}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          dispatch({ type: 'SELECT', groupId })
          onOpenContextMenu(e.clientX, e.clientY, groupId)
        }}
        style={{
          width: 212,
          flexShrink: 0,
          borderRight: '1px solid var(--ra-border)',
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          padding: '0 10px',
          height: 44,
          background: selected ? 'var(--ra-bg-row-active)' : 'var(--ra-bg-row)',
          cursor: 'grab'
        }}
      >
        <PolarGlyph stems={rifff.stems} identityColor={color} size={30} />
        <div style={{ overflow: 'hidden' }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              whiteSpace: 'nowrap',
              textOverflow: 'ellipsis',
              overflow: 'hidden'
            }}
          >
            {rifff.name}
          </div>
          <div style={{ fontSize: 9, color: 'var(--ra-text-3)' }}>
            {rifff.stems.length} stems · {rifff.barLength} bars · {rifff.bpm} bpm
          </div>
        </div>
      </div>

      {rifff.stems.map((stem) => (
        <StemWaveformRow key={stem.slot} groupId={groupId} slot={stem.slot} />
      ))}
    </div>
  )
}
```

Note the header column's `style` moved from a sibling-of-the-clip-div `display: flex` row
layout to standing alone at a fixed `height: 44` (matching `StemWaveformRow`'s own
`ROW_HEIGHT`) — since there's no longer a separate 52px clip-row to align it against, it's now
just the header for the first stem row's height. If a rifff has multiple stems, this header
sits taller than any *individual* stem row visually (spanning only the first row's height
looks odd against 3+ stacked rows) — decide during Task 12's manual look whether the header
should instead span the full stack's height (e.g. via a flex layout wrapping the whole
component, header as a fixed-width column beside a `flexDirection: column` stack of stem
rows) rather than sitting only beside the first one. The code above intentionally leaves this
as a starting point to react to visually, not a pixel-final answer — this project's own
established pattern is to nail exact layout/spacing during manual verification against the
real running app, not to guess pixel-perfect values from code alone.

Also remove the now-dead `TOGGLE_EXPAND` action type and reducer case from
`src/renderer/src/state/store.ts` — its only call site (the expand/collapse button) no longer
exists after this task. Leave the `exp: Record<string, boolean>` state field itself in place
(don't remove it) — an unused key in `AppState` is harmless and removing it risks
save/load-file compatibility for old project files that might still have it serialized,
whereas the dead reducer case has no such downside to removing.

- [ ] **Step 3: Confirm `StemSubRow.tsx` has no remaining importers, then delete it if not
  already done**

```bash
grep -rn "StemSubRow" src/
```

If clean:

```bash
git rm src/renderer/src/components/StemSubRow.tsx
```

- [ ] **Step 4: Typecheck, lint, full suite**

```bash
npm run typecheck && npm run lint && npm test -- --run
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "arranger controls: RifffBlockRow always renders StemWaveformRow, drop combined waveform + expand toggle"
```

---

### Task 11: Inspector.tsx cleanup — remove duplicate mute/volume/fade controls

**Files:**
- Modify: `src/renderer/src/components/Inspector.tsx`

- [ ] **Step 1: Read the current file in full.**

- [ ] **Step 2: Remove the "fade" section** — the whole `section(<>...</>)` block containing
  the "fade" eyebrow label and the in/out stepper button pairs (the block dispatching
  `SET_FADE_IN`/`SET_FADE_OUT`). Also remove the now-unused `FADE_STEP`/`FADE_MAX` local
  constants if nothing else in this file still references them (`grep -n "FADE_STEP\|FADE_MAX"`
  within this file after the section removal — if the only remaining hits are the constant
  declarations themselves, remove those two lines too).

- [ ] **Step 3: Remove the mute button + volume slider from the per-stem "stems" list** —
  within the `rifff.stems.map((stem) => {...})` block, remove the mute `<button>` (dispatching
  `TOGGLE_MUTE`), the volume `<input type="range">` (dispatching `SET_VOLUME`), and the
  trailing `<span>` showing `{muted ? 'mute' : dbLabel(volume)}`. **Keep** everything else in
  that per-stem row: the type-cycle color chip, slot number, stem name, and (for unlinked
  groups) the offset nudge/zero buttons below it. Also remove the now-unused `muted`/`volume`
  local variables from that map callback if nothing else in the callback body still references
  them after the removal (`stemOffsetKey`/`stemOffsetSteps`/`stemLabels` are still needed for
  the offset controls — keep those).

- [ ] **Step 4: Check for now-unused imports** — `dbLabel` was imported from `@shared/visuals`
  specifically for the volume readout just removed; if nothing else in this file uses it,
  remove it from the import line (keep `offsetLabels`, which is still used).

- [ ] **Step 5: Typecheck, lint**

```bash
npm run typecheck && npm run lint
```

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/Inspector.tsx
git commit -m "arranger controls: remove mute/volume/fade from Inspector — now set on the arranger row"
```

---

### Task 12: Manual verification

**Files:** none (verification only, no commit unless issues found and fixed)

- [ ] **Step 1: Start the dev app**

```bash
npm run dev
```

Perform, and report on each specifically:

1. Place a rifff with multiple stems on the timeline. Confirm every stem shows its own
   waveform row (no more single combined waveform, no expand/collapse toggle), each with a
   visible mute dot.
2. Click a mute dot. Confirm it toggles (filled ↔ hollow), the row's waveform fully
   desaturates when muted, and audio actually stops for that stem while playing.
3. Drag a stem row's volume plateau (between the two fade knees) up and down while the
   project is playing. Confirm: the value tooltip appears only while dragging and shows a
   sensible dB figure, the waveform's saturation split visibly follows the drag in real time,
   audio volume audibly changes, and exactly ONE new undo-history entry is created per
   completed drag (press Cmd+Z once after a drag — confirm it reverts the whole drag in one
   step, not one intermediate frame at a time).
4. Drag a fade-in knee and a fade-out knee. Confirm the curve updates smoothly, audio fade
   timing audibly matches, and (same as volume) one undo step per completed drag.
5. Drag a stem's right-edge resize handle to extend it well past its own native length while
   playing. Confirm the row visibly widens, and — the actual point of this whole feature —
   audio audibly re-loops from the stem's own beginning partway through rather than going
   silent. Then drag it shorter than the stem's own native length and confirm it audibly
   truncates early rather than looping or erroring.
6. Confirm the header column (name/stem-count/bpm) still supports: click to select, drag to
   move the whole rifff, right-click for the context menu — unaffected by everything else in
   this plan.
7. Confirm an *unlinked* stem's row can still be dragged (via its own container, not the new
   resize handle) to reposition it independently, and that dragging its resize handle resizes
   it rather than accidentally triggering that move (the interaction-conflict risk flagged in
   Task 7).
8. Open the Inspector panel for a rifff. Confirm the mute button, volume slider, and fade
   section are gone, and everything else (offset nudge, stretch toggle, unlink/relink,
   re-pick beat) still works exactly as before.
9. Confirm the loop wraps correctly (doesn't cut off early) for a project containing a stem
   resized well beyond its rifff's nominal `barLength` — this is `loopLengthBars`'s fix from
   Task 1 actually mattering in the running app, not just in its own unit tests.

- [ ] **Step 2: Report findings**

If anything above reveals a real bug, fix it in the relevant earlier task's files, following
that file's existing conventions, before considering this plan complete.
