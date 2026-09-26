# The phone plays the loop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The phone remote plays the current Discover loop through its own output, gaplessly, with a one-pixel progress line driven by the phone's own audio clock that cannot be dragged to seek.

**Architecture:** The Mac renders the loop Discover is already previewing to a WAV — through the offline `render-export` path exports already use — and serves those bytes over one new authenticated route. The phone fetches them once and loops them in an `AudioBufferSourceNode`. No stream, no clock sync, no position messages. A single **warm** render engine is held for as long as the phone remote is switched on, separate from the app's playback engine, so a roll costs `load-project` plus a render rather than a process spawn.

**Tech Stack:** TypeScript, Electron main/preload/renderer, `node:http`, `node:crypto`, the existing JUCE engine binary (unchanged), Web Audio in mobile Safari, vitest.

**Spec:** `docs/superpowers/specs/2026-09-26-phone-loop-audio-design.md` (2026-09-26). Its decided points are not re-opened here: **render a file, do not stream**; **Web Audio, not an `<audio>` element**; **the progress line is local to the phone and unclickable**; **phone audio is distinct from the Mac's and simultaneous playback is intended, not a bug**.

**Elling's words, verbatim:** *"just discover loops"* · *"show the position on the audio file with the progress line but unclickable"* · *"phone audio distinct from the app"* · *"will it be slow to render and merge those files though"*.

**Baseline (verified on `master`, 2026-09-26):**

```
Test Files  181 passed (181)
     Tests  2742 passed (2742)

CI=1        154 files / 2339 tests
```

`npm run typecheck` — 0 errors. `npm run lint` — 0 errors plus the 4 pre-existing prettier warnings in unrelated files. Any *new* warning is yours.

**NO NATIVE-ENGINE CHANGES.** Nothing in this plan reaches `native-engine/`. This was checked, not assumed — see Finding 1. `EngineProject` / `buildEngineProject.ts` are the hand-synced pair CLAUDE.md warns about and **this plan changes neither**; it only ever consumes a project the renderer already built. If you conclude a native-engine change is needed, **STOP and report it rather than planning one.**

---

## Findings that shaped this plan — read these before Task 1

1. **Everything this needs already exists on the native side.** Verified on disk today.
   - `render-export` is handled at `native-engine/Source/IpcServer.cpp:844-861`. Payload is exactly `{ outputPath: string, durationBars: number }`; the reply type is `render-export-result` with `{ success: boolean, error?: string }`. It renders **whatever project was last sent via `load-project`** (`engine.currentProjectForExport()`).
   - `RenderExport.cpp:92-102` writes **WAV, 44100 Hz, 2 channels, 16-bit** (`wavFormat.createWriterFor(out.get(), sampleRate, 2, 16, {}, 0)`). That is directly decodable by `decodeAudioData` in mobile Safari. No encoder is added anywhere.
   - `spawnEngine()` (`src/main/engineProcess.ts:141`) is stateless and picks a random ephemeral port. Four modules already spawn their own engine alongside the live playback engine: `nativeExport.ts:169/278/461`, `exportToolkitAudio.ts:190`, `exportAudioMaterialization.ts:146`, `bakeOffset.ts:89`.
   - **There is no merge step.** One `load-project` + one `render-export` produces the whole mix in one offline pass. "Render and merge" describes something that does not exist here.

2. **The renderer already builds the exact project.** `DiscoverPanel.tsx`'s `syncPreviewToEngine` (line 722) builds a throwaway single-rifff `previewState` (line 839) and calls `buildEngineProject(previewState, resolveStretchedForPlayback, pluginCatalog)` at **line 858**. That returned `EngineProject` is what this feature renders. Nothing is re-derived and nothing new crosses the wire-format boundary.

3. **`loopLengthBars` is already the loop's own length.** For the Discover preview, `previewState` has one rifff with `startBar: 0` and no `playedBars` entry, so `loopLengthBars(state)` (`src/renderer/src/state/selectors.ts:506`) resolves to that rifff's `barLength`, which is `maxBarLength` — the max bar length of **every resolved slot**. So `EngineProject.loopLengthBars` is exactly what to pass as `durationBars`.

4. **`groupId` is a fresh UUID on every rebuild, and this is the whole reason the fingerprint exists.** `assembleDiscoverRifff` (`src/renderer/src/audio/discoverRifffAssembly.ts:96`) does `groupId = crypto.randomUUID()`, and `stemKey` embeds that groupId. Discover rebuilds the project on **every** slot resolution, mute/solo toggle and bpm change. A naive hash of the project JSON would therefore change several times a second while nothing audible changed, and the phone would refetch identical audio continuously. **The fingerprint must ignore `groupId`, `stemKey` and `channelId`, and must sort the stems** (summing is commutative; slot order is not audio).

5. **`discoveredGroupKey` is the WRONG key here and must not be used.** Its own doc comment (`src/shared/discoveredRoom.ts:17-20`): *"The same five stems balanced differently are the same discovery."* True for a discovery, false for audio — two mixes of the same stems at different gains sound different. Serving one for the other would be nearly impossible to notice and nearly impossible to explain. Gains are part of the fingerprint.

6. **The cost is the spawn, not the render.** `nativeExport.test.ts`'s render tests take 1.2–3.7s each in real CI logs, and each spawns a fresh engine. A few bars of offline render is far faster than realtime. Spawning per roll would put 1–3 seconds between tapping and hearing. Hence one **warm** engine held for the phone-remote session. It must be a **separate** engine from `playbackEngineLifecycle.ts`'s, whose own doc comment says why: *"they must not share a PlaybackEngine/currentProject, since an export's load-project would clobber whatever's currently playing."*

7. **Spawning must not block `start-phone-remote`.** `READINESS_TIMEOUT_MS` is 45s (`engineProcess.ts:69`) for documented cold-start reasons. The renderer module kicks the spawn off at creation and the first render awaits it; the IPC handler returns immediately.

8. **The render timeout is 30s, not ten minutes.** `nativeExport`'s `RENDER_EXPORT_TIMEOUT_MS` is `10 * 60 * 1000` because a full arrangement export can legitimately take that long. Someone is standing in another room holding a phone. Ten minutes is a hang, not a timeout.

9. **Plugins are stripped from the phone render.** `syncPreviewToEngine` calls `buildEngineProject` with **three** arguments (line 858), so `pluginStates` defaults to `{}` and every `stateBase64` is empty. A freshly spawned render engine would therefore instantiate the master chain and channel chains at their **default** state — a third sound belonging to neither the Mac nor the stems. `exportToolkitAudio.ts:184` already strips channel plugins for a related reason. Dry is honestly "the stems, at their gains, at the project tempo." Named as a known limit in the spec.

10. **`remoteState.test.ts` asserts no path ever leaves the Mac, and that must keep holding.** `RemoteState` (what the renderer pushes) is **not** changed. What `/api/state` answers gains one field, and it is a 16-character hex digest injected by main. The `EngineProject` full of real paths reaches main over Electron IPC and is never serialised to any route.

11. **The page's CSP does not change.** `decodeAudioData` is fed from a `fetch`, governed by `connect-src 'self'` — already in `REMOTE_PAGE_CSP`. There is no media element, so no `media-src` is needed and no HTTP byte-range support is needed on the server either (a media element would have demanded both from Safari).

12. **iOS requires a user gesture.** The `AudioContext` must be constructed inside the `play` button's click handler, once, and kept. There is no autoplay path and there must not be one — a context created on page load is suspended and produces silence with no error. Also set `navigator.audioSession.type = 'playback'` where it exists (Safari 16.4+, in a try/catch), or the hardware mute switch silences everything.

13. **`POST /api/transport` and the `transport` command are REMOVED.** One button cannot mean two outputs. This is a removal of something that shipped on 2026-09-25 (`c7cdb5c`), done deliberately. `RemoteState.playing` **stays** — it feeds a `mac playing` eyebrow, which is information, not control.

14. **This plan opens no SQLite database, so `vitest.config.ts`'s CI exclusion list is untouched.** Do not add anything to it. Adding a main-process test file that loads better-sqlite3 *without* adding it to that list is what made the v1.2.0 release unshippable (30 files are on that list today). `remoteLoopRenderer.test.ts` spawns a real engine and touches no database.

15. **Main-process tests spawn the REAL engine, with a narrow electron stand-in.** The established pattern (`exportToolkitAudio.test.ts:13-16`):
    ```ts
    vi.mock('electron', () => ({
      app: { getAppPath: () => process.cwd(), getPath: () => tmpdir() },
      shell: { openPath: vi.fn().mockResolvedValue('') }
    }))
    ```
    `defaultBinaryPath()` (`engineProcess.ts:97`) builds its dev path from `app.getAppPath()`, so that mock alone is enough to find `native-engine/build/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine`. **Do not mock the `electron` module wholesale and do not fake the engine.**

16. **Design tokens are the law** (`src/renderer/src/styles/tokens.css`). `--ra-playhead: #c56164` is the progress line's colour, hand-copied into the page string with a comment saying tokens.css is the source of truth — the same convention `remotePage.ts`'s `TYPE_COLORS` already uses. **No `border-radius` anywhere** (the page already has a global `border-radius: 0`). Lowercase copy, **no emoji, no exclamation marks**. Colour only on things carrying audio information; the progress line qualifies, which is why it is allowed to be the one coloured thing besides the slot rows.

17. **Lint rules that will bite.** Explicit return type on every function, inline ones included. `react-hooks/set-state-in-effect` errors on a synchronous `setState` inside an effect. Prettier: `singleQuote: true`, `semi: false`, `printWidth: 100`, `trailingComma: none`. The page's own JS lives inside a TypeScript template literal and is not linted as JS — keep it ES5-ish `var`/`function`, matching what is already there.

18. **Never write a CSS comment containing a star-slash** — `src/renderer/src/styles/css.test.ts` parses every stylesheet, and Task 5 writes CSS inside a TypeScript string.

## Known limits, accepted on purpose

- **The phone will not match the Mac if a master chain is running.** See Finding 9.
- **Audio stops when the phone's screen locks.** iOS suspends the AudioContext. Resumes when he comes back.
- **A reroll restarts the loop from zero**, with no fade and no phase matching.
- **Both outputs can play at once.** Intended. `mac playing` in the eyebrow is the only accommodation.
- **The latency figure in the spec (0.3–0.8s) is a prediction, not a measurement.** Nobody here can run it on his machine or his network.

## File map

| File | Change |
|---|---|
| `src/shared/phoneLoop.ts` | **NEW** — `phoneLoopProject`, `phoneLoopFingerprint` |
| `src/shared/phoneLoop.test.ts` | **NEW** — full TDD |
| `src/shared/remoteState.ts` | **NEW type** `RemoteStateResponse`; `transport` removed from `RemoteCommand` |
| `src/shared/remoteState.test.ts` | one new case; no existing case changes |
| `src/main/remoteLoopRenderer.ts` | **NEW** — `createRemoteLoopRenderer`, `loopIdFor`, the warm engine, the one-entry cache |
| `src/main/remoteLoopRenderer.test.ts` | **NEW** — real engine, two cases. **NOT added to `vitest.config.ts`** |
| `src/main/remoteServer.ts` | `GET /api/loop`; `POST /api/transport` removed; new `loopWav` option; `getState` retyped |
| `src/main/remotePage.ts` | the track + line, the Web Audio player, the `mac playing` eyebrow; the transport call removed |
| `src/main/index.ts` | the renderer's lifecycle, `set-remote-loop`, `loopId` injected into the state response |
| `src/preload/index.ts` | `setRemoteLoop` |
| `src/renderer/src/components/DiscoverPanel.tsx` | push the project; push `null` on teardown; drop the `transport` branch |

**Nothing else is touched. No file is deleted. `vitest.config.ts` is not touched.**

## Commands (run from `/Users/nickel/Claudecode/sssketch`)

```bash
npx vitest run src/shared/phoneLoop.test.ts    # one file
npm test                                        # full suite
npm run typecheck
npm run lint
```

The engine binary must exist for Task 3's test:

```bash
cd native-engine && cmake -B build && cmake --build build
```

---

## Task 1: The loop, stripped to what the phone will hear

Two pure functions. This is the only genuinely subtle logic in the plan, and it is the only part with real unit coverage.

**Files:**
- Create: `src/shared/phoneLoop.ts`
- Create: `src/shared/phoneLoop.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/shared/phoneLoop.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { EngineProject, EngineStem } from './buildEngineProject'
import { phoneLoopFingerprint, phoneLoopProject } from './phoneLoop'

function stem(overrides: Partial<EngineStem> = {}): EngineStem {
  return {
    stemKey: 'group-a::1',
    resolvedPath: '/Users/nickel/Music/secret/abc123',
    durationSec: 2,
    barLength: 1,
    playedBars: 1,
    leftCropBars: 0,
    offsetSteps: 0,
    startBarOverride: -1,
    volume: 1,
    muted: false,
    muteRegions: [],
    oneShot: false,
    trimStartSec: 0,
    trimEndSec: -1,
    ...overrides
  }
}

function project(overrides: Partial<EngineProject> = {}): EngineProject {
  const slot = { pluginId: '', path: '', stateBase64: '' }
  return {
    bpm: 120,
    snapDiv: 4,
    loopLengthBars: 4,
    rifffs: [{ groupId: 'group-a', channelId: 'ch-a', startBar: 0, barLength: 4, stems: [stem()] }],
    risers: [],
    masterChain: [{ ...slot }, { ...slot }, { ...slot }, { ...slot }],
    channelChains: [],
    reverb: { roomSize: 0.5, damping: 0.5, preDelayMs: 20 },
    ...overrides
  }
}

describe('phoneLoopProject', () => {
  it('empties the master chain, so a fresh render engine cannot instantiate plugins at defaults', () => {
    const withPlugin = project({
      masterChain: [
        { pluginId: 'p1', path: '/p1.vst3', stateBase64: '' },
        { pluginId: '', path: '', stateBase64: '' },
        { pluginId: '', path: '', stateBase64: '' },
        { pluginId: '', path: '', stateBase64: '' }
      ]
    })
    expect(phoneLoopProject(withPlugin).masterChain.map((s) => s.pluginId)).toEqual(['', '', '', ''])
  })

  it('drops every channel chain', () => {
    const withChannel = project({
      channelChains: [
        {
          channelId: 'ch-a',
          slots: [
            { pluginId: 'p1', path: '/p1.vst3', stateBase64: '' },
            { pluginId: '', path: '', stateBase64: '' }
          ]
        }
      ]
    })
    expect(phoneLoopProject(withChannel).channelChains).toEqual([])
  })

  it('leaves the stems, bpm and loop length exactly alone', () => {
    const out = phoneLoopProject(project())
    expect(out.bpm).toBe(120)
    expect(out.loopLengthBars).toBe(4)
    expect(out.rifffs[0].stems[0].resolvedPath).toBe('/Users/nickel/Music/secret/abc123')
  })
})

describe('phoneLoopFingerprint', () => {
  it('is IDENTICAL for two projects differing only in groupId, channelId and stemKey', () => {
    const a = project()
    const b = project({
      rifffs: [
        {
          groupId: 'a-completely-different-uuid',
          channelId: 'ch-z',
          startBar: 0,
          barLength: 4,
          stems: [stem({ stemKey: 'a-completely-different-uuid::1' })]
        }
      ]
    })
    expect(phoneLoopFingerprint(b)).toBe(phoneLoopFingerprint(a))
  })

  it('is IDENTICAL when only the order of the stems differs', () => {
    const one = stem({ stemKey: 'g::1', resolvedPath: '/a' })
    const two = stem({ stemKey: 'g::2', resolvedPath: '/b' })
    const a = project({
      rifffs: [{ groupId: 'g', channelId: 'c', startBar: 0, barLength: 4, stems: [one, two] }]
    })
    const b = project({
      rifffs: [{ groupId: 'g', channelId: 'c', startBar: 0, barLength: 4, stems: [two, one] }]
    })
    expect(phoneLoopFingerprint(b)).toBe(phoneLoopFingerprint(a))
  })

  it('DIFFERS when one stem gain differs', () => {
    const quieter = project({
      rifffs: [
        { groupId: 'group-a', channelId: 'ch-a', startBar: 0, barLength: 4, stems: [stem({ volume: 0.5 })] }
      ]
    })
    expect(phoneLoopFingerprint(quieter)).not.toBe(phoneLoopFingerprint(project()))
  })

  it('DIFFERS when a stem is muted', () => {
    const muted = project({
      rifffs: [
        { groupId: 'group-a', channelId: 'ch-a', startBar: 0, barLength: 4, stems: [stem({ muted: true })] }
      ]
    })
    expect(phoneLoopFingerprint(muted)).not.toBe(phoneLoopFingerprint(project()))
  })

  it('DIFFERS when a stem resolves to a different file', () => {
    const other = project({
      rifffs: [
        {
          groupId: 'group-a',
          channelId: 'ch-a',
          startBar: 0,
          barLength: 4,
          stems: [stem({ resolvedPath: '/Users/nickel/Music/secret/def456' })]
        }
      ]
    })
    expect(phoneLoopFingerprint(other)).not.toBe(phoneLoopFingerprint(project()))
  })

  it('DIFFERS when the tempo differs', () => {
    expect(phoneLoopFingerprint(project({ bpm: 128 }))).not.toBe(phoneLoopFingerprint(project()))
  })

  it('DIFFERS when the loop length differs', () => {
    expect(phoneLoopFingerprint(project({ loopLengthBars: 8 }))).not.toBe(
      phoneLoopFingerprint(project())
    )
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/shared/phoneLoop.test.ts`
Expected: FAIL — `Failed to resolve import "./phoneLoop"`.

- [ ] **Step 3: Write the implementation**

Create `src/shared/phoneLoop.ts`:

```ts
// src/shared/phoneLoop.ts
import type { EngineProject, EngineMasterChainSlot, EngineStem } from './buildEngineProject'

const EMPTY_SLOT: EngineMasterChainSlot = { pluginId: '', path: '', stateBase64: '' }

/** The loop as the PHONE will hear it: the same stems, at the same gains, at
 * the same tempo, with no plugins anywhere.
 *
 * Stripping is not an optimisation. The Discover preview calls
 * buildEngineProject with THREE arguments (DiscoverPanel.tsx:858), so
 * pluginStates defaults to {} and every stateBase64 on the wire is empty. A
 * freshly spawned render engine would therefore instantiate the master chain
 * and every channel chain at its DEFAULT state -- a third sound belonging
 * neither to the Mac nor to the stems. exportToolkitAudio.ts:184 strips
 * channel plugins from a bake for a closely related reason. Dry is at least
 * honestly "the stems, at their gains, at the project tempo," which is what
 * a Discover judgement is about. Named as a known limit in the spec. */
export function phoneLoopProject(project: EngineProject): EngineProject {
  return {
    ...project,
    masterChain: [{ ...EMPTY_SLOT }, { ...EMPTY_SLOT }, { ...EMPTY_SLOT }, { ...EMPTY_SLOT }],
    channelChains: []
  }
}

const FIELD = ''

function stemLine(startBar: number, barLength: number, stem: EngineStem): string {
  // Deliberately NOT stem.stemKey: it embeds the rifff's groupId, which is a
  // fresh crypto.randomUUID() on every single rebuild (see
  // assembleDiscoverRifff). Everything listed here is something that changes
  // what the render sounds like; nothing listed here is an identifier.
  return [
    startBar,
    barLength,
    stem.resolvedPath,
    stem.durationSec,
    stem.barLength,
    stem.playedBars,
    stem.leftCropBars,
    stem.offsetSteps,
    stem.startBarOverride,
    stem.volume,
    stem.muted ? 1 : 0,
    stem.oneShot ? 1 : 0,
    stem.trimStartSec,
    stem.trimEndSec,
    stem.muteRegions.map((region) => `${region.startBar}-${region.endBar}`).join(','),
    stem.toolkit === undefined ? '' : JSON.stringify(stem.toolkit)
  ].join(FIELD)
}

/** A canonical string that is the same for two projects that would render to
 * the same audio, and different otherwise. Hashed by the main process into
 * the 16-character `loopId` the phone sees; kept as a plain string here so
 * this stays pure, framework-agnostic and testable, and so the one hard part
 * (deciding what "the same loop" means) lives where it can be read.
 *
 * TWO properties are load-bearing and both have tests:
 *
 * 1. IGNORES groupId / channelId / stemKey. Discover rebuilds its preview
 *    project on every slot resolution, every mute or solo toggle and every
 *    bpm change, and assembleDiscoverRifff mints a fresh UUID groupId each
 *    time. Hash the raw JSON and the id changes several times a second while
 *    nothing audible changes, and the phone refetches identical audio forever.
 *
 * 2. SORTS the stems. Summing is commutative; slot order is not audio.
 *
 * And it is deliberately NOT discoveredGroupKey, which is blind to gain by
 * design ("the same five stems balanced differently are the same discovery").
 * True of a discovery, false of a sound. */
export function phoneLoopFingerprint(project: EngineProject): string {
  const lines: string[] = []
  for (const rifff of project.rifffs) {
    for (const stem of rifff.stems) {
      lines.push(stemLine(rifff.startBar, rifff.barLength, stem))
    }
  }
  lines.sort()
  return [
    `bpm=${project.bpm}`,
    `snap=${project.snapDiv}`,
    `bars=${project.loopLengthBars}`,
    `reverb=${JSON.stringify(project.reverb)}`,
    `risers=${JSON.stringify(project.risers)}`,
    ...lines
  ].join('\n')
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/shared/phoneLoop.test.ts`
Expected: PASS — 10 tests.

- [ ] **Step 5: Typecheck and lint**

```bash
npm run typecheck
npm run lint
```

Expected: 0 errors, no new warnings.

- [ ] **Step 6: Commit**

```bash
git add src/shared/phoneLoop.ts src/shared/phoneLoop.test.ts
git commit -m "The loop, stripped to what the phone will hear

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

---

## Task 2: A loop gets an id, and the phone stops steering the Mac

Two edits to the shared vocabulary: what `/api/state` answers gains a `loopId`, and `transport` leaves `RemoteCommand`.

**Files:**
- Modify: `src/shared/remoteState.ts`
- Modify: `src/shared/remoteState.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/shared/remoteState.test.ts`, after the existing `describe` block:

```ts
describe('RemoteStateResponse', () => {
  it('carries a loop id and still never carries a filesystem path', () => {
    const response: RemoteStateResponse = {
      ...remoteStateFromSlots([slot()], {
        discoverOpen: true,
        playing: false,
        kept: 0,
        rolled: 0,
        lastKeptName: null
      }),
      loopId: '0123456789abcdef'
    }
    expect(response.loopId).toMatch(/^[0-9a-f]{16}$/)
    expect(JSON.stringify(response)).not.toContain('/Users/')
    expect(JSON.stringify(response)).not.toContain('abc123')
  })

  it('reads a missing loop as null rather than an empty string', () => {
    const response: RemoteStateResponse = {
      ...remoteStateFromSlots([], {
        discoverOpen: false,
        playing: false,
        kept: 0,
        rolled: 0,
        lastKeptName: null
      }),
      loopId: null
    }
    expect(response.loopId).toBeNull()
  })
})
```

Fix the import line at the top of the file to:

```ts
import { remoteStateFromSlots, type RemoteStateResponse } from './remoteState'
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/shared/remoteState.test.ts`
Expected: FAIL — TypeScript/vitest reports `RemoteStateResponse` is not exported from `./remoteState`.

- [ ] **Step 3: Add the response type and remove the transport verb**

In `src/shared/remoteState.ts`, add after the `RemoteState` interface:

```ts
/** What GET /api/state actually answers: the snapshot the renderer pushed,
 * plus the id of the loop the phone can fetch right now.
 *
 * `loopId` is deliberately NOT part of RemoteState and is NOT produced by
 * remoteStateFromSlots. The renderer does not know it -- main computes it
 * from the EngineProject Discover pushes over IPC, which is full of real
 * filesystem paths and never leaves the main process. Sixteen hex characters
 * of a sha256 is what leaves, and the no-path property remoteState.test.ts
 * asserts is preserved by construction rather than by care. */
export interface RemoteStateResponse extends RemoteState {
  loopId: string | null
}
```

And change `RemoteCommand` to:

```ts
/** Everything the phone can ask the Mac to do. THREE verbs, and nothing
 * else: no arranging, no timeline, no slot add/remove, no kind picker, no
 * gain, no settings, no library browsing. The Mac sets the shape of the
 * loop; the phone rolls it.
 *
 * `transport` was here until 2026-09-26 and was removed on purpose when the
 * phone became an audio client. One button cannot mean two outputs, and the
 * phone's `play` now means the phone. The two outputs are independent by
 * Elling's own instruction ("phone audio distinct from the app") -- the phone
 * does not reach into the Mac's transport in either direction, and both
 * playing at once is intended rather than a bug. */
export type RemoteCommand =
  | { kind: 'roll-slot'; slotId: string }
  | { kind: 'roll-all' }
  | { kind: 'keep' }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/shared/remoteState.test.ts`
Expected: PASS — the 5 original cases plus the 2 new ones.

`npm run typecheck` will now fail in the two places that still reference the removed verb: `src/main/remoteServer.ts` (its `/api/transport` handler constructs `{ kind: 'transport', … }`) and `src/renderer/src/components/DiscoverPanel.tsx` (its `remoteCommandRef` branch). Both are fixed in Tasks 4 and 7. `remotePage.ts` calls the route but never names the type, so it does not appear. That breakage is expected and this task's commit is documentation and shared types only — it is not a shippable point on its own, and the plan is not shippable again until Task 7.

- [ ] **Step 5: Verify the rest of the suite is unaffected**

Run: `npx vitest run src/shared/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/remoteState.ts src/shared/remoteState.test.ts
git commit -m "A loop gets an id, and the phone stops steering the mac

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

---

## Task 3: One warm engine, one loop, and the file deleted behind it

The whole main-process render path: the held engine, the on-demand render, the one-entry cache, and the temp file that outlives nothing.

**Files:**
- Create: `src/main/remoteLoopRenderer.ts`
- Create: `src/main/remoteLoopRenderer.test.ts`
- **Do NOT modify `vitest.config.ts`.** This test opens no database (Finding 14).

**Prerequisite:** the engine binary must be built, or the test cannot run:

```bash
cd native-engine && cmake -B build && cmake --build build
```

- [ ] **Step 1: Write the failing test**

Create `src/main/remoteLoopRenderer.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { writeFileSync, mkdtempSync, readdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { EngineProject } from '../shared/buildEngineProject'

// The same narrow electron stand-in exportToolkitAudio.test.ts uses, and for
// the same reasons: app.getAppPath() is what defaultBinaryPath() builds the
// dev engine path from, and app.getPath('temp') is where the render writes.
// The REAL compiled engine is spawned here on purpose -- what is under test
// is a wav a phone has to be able to decode.
vi.mock('electron', () => ({
  app: { getAppPath: () => process.cwd(), getPath: () => tmpdir() },
  shell: { openPath: vi.fn().mockResolvedValue('') }
}))

import { createRemoteLoopRenderer } from './remoteLoopRenderer'

/** A 16-bit mono WAV of a constant sample value -- the same helper
 * exportToolkitAudio.test.ts and nativeExport.test.ts both carry. */
function writeConstantWav(path: string, value: number, numSamples: number): void {
  const sampleRate = 44100
  const dataSize = numSamples * 2
  const buf = Buffer.alloc(44 + dataSize)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataSize, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(dataSize, 40)
  const sample16 = Math.round(value * 32767)
  for (let i = 0; i < numSamples; i++) buf.writeInt16LE(sample16, 44 + i * 2)
  writeFileSync(path, buf)
}

function oneStemProject(stemPath: string): EngineProject {
  const slot = { pluginId: '', path: '', stateBase64: '' }
  return {
    bpm: 120,
    snapDiv: 4,
    loopLengthBars: 1,
    rifffs: [
      {
        groupId: 'g',
        channelId: 'c',
        startBar: 0,
        barLength: 1,
        stems: [
          {
            stemKey: 'g::1',
            resolvedPath: stemPath,
            durationSec: 2,
            barLength: 1,
            playedBars: 1,
            leftCropBars: 0,
            offsetSteps: 0,
            startBarOverride: -1,
            volume: 1,
            muted: false,
            muteRegions: [],
            oneShot: false,
            trimStartSec: 0,
            trimEndSec: -1
          }
        ]
      }
    ],
    risers: [],
    masterChain: [{ ...slot }, { ...slot }, { ...slot }, { ...slot }],
    channelChains: [],
    reverb: { roomSize: 0.5, damping: 0.5, preDelayMs: 20 }
  }
}

describe('createRemoteLoopRenderer', () => {
  it('renders the held loop to a 44100/stereo/16-bit wav and deletes the file behind it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-phone-loop-src-'))
    const stemPath = join(dir, 'stem.wav')
    writeConstantWav(stemPath, 0.5, 88200)

    const renderer = createRemoteLoopRenderer()
    try {
      renderer.setLoop(oneStemProject(stemPath))
      const got = await renderer.wav()
      expect(got).not.toBeNull()
      const bytes = got!.bytes
      expect(bytes.toString('ascii', 0, 4)).toBe('RIFF')
      expect(bytes.toString('ascii', 8, 12)).toBe('WAVE')
      // 1 bar at 120bpm is 2 seconds; 44100 * 2ch * 2 bytes * 2s = 352800
      // bytes of audio, plus however many bytes of header chunks JUCE writes.
      expect(bytes.length).toBeGreaterThan(352800)
      expect(bytes.length).toBeLessThan(352800 + 4096)
      expect(got!.id).toMatch(/^[0-9a-f]{16}$/)

      // Nothing is left on disk -- the cache holds bytes, not a path.
      const loopDir = join(tmpdir(), 'sssketch-phone-loop')
      if (existsSync(loopDir)) expect(readdirSync(loopDir)).toEqual([])
    } finally {
      renderer.stop()
    }
  }, 120_000)

  it('serves the same loop from cache rather than rendering it twice', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-phone-loop-src-'))
    const stemPath = join(dir, 'stem.wav')
    writeConstantWav(stemPath, 0.5, 88200)

    const renderer = createRemoteLoopRenderer()
    try {
      renderer.setLoop(oneStemProject(stemPath))
      const first = await renderer.wav()
      // Setting the SAME loop again must not invalidate anything -- Discover
      // rebuilds its project constantly with a fresh groupId each time.
      renderer.setLoop(oneStemProject(stemPath))
      const second = await renderer.wav()
      // Buffer IDENTITY, not equality: only the cache can return this.
      expect(second!.bytes).toBe(first!.bytes)
      expect(second!.id).toBe(first!.id)
    } finally {
      renderer.stop()
    }
  }, 120_000)

  it('answers null when no loop is held', async () => {
    const renderer = createRemoteLoopRenderer()
    try {
      expect(await renderer.wav()).toBeNull()
      renderer.setLoop(null)
      expect(await renderer.wav()).toBeNull()
    } finally {
      renderer.stop()
    }
  }, 120_000)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/remoteLoopRenderer.test.ts`
Expected: FAIL — `Failed to resolve import "./remoteLoopRenderer"`.

- [ ] **Step 3: Write the implementation**

Create `src/main/remoteLoopRenderer.ts`:

```ts
// src/main/remoteLoopRenderer.ts
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { EngineProject } from '@shared/buildEngineProject'
import { phoneLoopFingerprint, phoneLoopProject } from '@shared/phoneLoop'
import { spawnEngine, type EngineHandle } from './engineProcess'
import { EngineClient } from './engineClient'

/** A Discover loop is 1, 2, 4 or 8 bars, set by the longest resolved stem.
 * This ceiling is not expected to bind; it exists so a malformed
 * loopLengthBars cannot ask the engine for a gigabyte. 32 bars at 120bpm is
 * 64 seconds, which is 11.3 MB at 44100/2/16. */
export const PHONE_LOOP_MAX_BARS = 32

/** NOT nativeExport's ten minutes. A full arrangement export can legitimately
 * take that long; somebody standing in another room holding a phone cannot.
 * Ten minutes here would be a hang, not a timeout. */
export const PHONE_LOOP_RENDER_TIMEOUT_MS = 30_000

export interface RenderedLoop {
  /** 16 hex characters. The only thing about the loop that ever leaves the
   * Mac -- the phone compares it against what it is playing. */
  id: string
  bytes: Buffer
}

export interface RemoteLoopRenderer {
  /** The id of the loop currently held, or null. Injected into GET
   * /api/state's answer as `loopId`. */
  currentLoopId(): string | null
  /** Replace the held loop with what Discover is previewing, or clear it. */
  setLoop(project: EngineProject | null): void
  /** The held loop's wav bytes, rendering if they are not cached. Null when
   * nothing is held. Rejects when the render fails twice. */
  wav(): Promise<RenderedLoop | null>
  stop(): void
}

interface EngineSession {
  handle: EngineHandle
  client: EngineClient
}

/** The 16-character id the phone sees, derived from the project as the phone
 * will actually hear it. See phoneLoopFingerprint for the two properties that
 * make this stable across Discover's constant rebuilds. */
export function loopIdFor(phoneProject: EngineProject): string {
  return createHash('sha256').update(phoneLoopFingerprint(phoneProject)).digest('hex').slice(0, 16)
}

async function openEngine(binaryPathOverride?: string): Promise<EngineSession> {
  const handle = await spawnEngine(binaryPathOverride ? { binaryPathOverride } : {})
  const client = new EngineClient()
  await client.connect(handle.port)
  return { handle, client }
}

/**
 * The phone remote's own render engine and its one-loop cache.
 *
 * ONE WARM ENGINE, held for as long as the phone remote is switched on.
 * Measured from real CI logs, nativeExport.test.ts's render tests take
 * 1.2-3.7s each and every one of them SPAWNS a fresh engine; a few bars of
 * offline render is far faster than realtime, so the spawn is essentially the
 * whole number. Spawning per roll would put one to three seconds between
 * tapping and hearing, which would ruin the roll/keep loop this exists for.
 *
 * It is a SEPARATE engine from playbackEngineLifecycle.ts's, which is busy
 * playing -- a render-export on that one would clobber whatever is loaded, as
 * its own doc comment says. Four other modules (nativeExport,
 * exportToolkitAudio, exportAudioMaterialization, bakeOffset) already spawn
 * their own engine alongside it, so this is a pattern, not a new idea.
 *
 * The spawn is kicked off here and NOT awaited: READINESS_TIMEOUT_MS is 45s
 * for documented cold-start reasons, and the gear menu must not sit on it.
 */
export function createRemoteLoopRenderer(
  options: { binaryPathOverride?: string } = {}
): RemoteLoopRenderer {
  const dir = join(app.getPath('temp'), 'sssketch-phone-loop')
  // Sweep anything a previous crash left behind.
  rmSync(dir, { recursive: true, force: true })

  let held: { id: string; project: EngineProject } | null = null
  let cached: RenderedLoop | null = null
  let inFlight: { id: string; promise: Promise<Buffer> } | null = null
  let session: Promise<EngineSession> | null = null
  let stopped = false

  function engine(): Promise<EngineSession> {
    if (session === null) {
      session = openEngine(options.binaryPathOverride)
      // Reset on failure so the next render tries again rather than awaiting
      // a permanently rejected promise. Assigning BEFORE attaching this means
      // the returned promise is the real one, not the catch's.
      void session.catch(() => {
        session = null
      })
    }
    return session
  }

  function dropEngine(): void {
    const dying = session
    session = null
    if (dying === null) return
    void dying
      .then(({ handle, client }) => {
        client.disconnect()
        handle.stop()
      })
      .catch(() => {})
  }

  async function renderOnce(id: string, project: EngineProject): Promise<Buffer> {
    const { client } = await engine()
    mkdirSync(dir, { recursive: true })
    const outputPath = join(dir, `${id}.wav`)
    const durationBars = Math.min(PHONE_LOOP_MAX_BARS, Math.max(1, project.loopLengthBars))
    try {
      client.send('load-project', project)
      const result = (await client.sendAndAwaitType(
        'render-export',
        { outputPath, durationBars },
        'render-export-result',
        PHONE_LOOP_RENDER_TIMEOUT_MS
      )) as { success: boolean; error?: string }
      if (!result.success) throw new Error(result.error ?? 'unknown error')
      return readFileSync(outputPath)
    } finally {
      // The cache holds BYTES, not a path. Nothing this route serves is ever
      // read off disk, and no temp file outlives the render that made it --
      // a failed render's partial file goes the same way.
      rmSync(outputPath, { force: true })
    }
  }

  async function wav(): Promise<RenderedLoop | null> {
    const loop = held
    if (loop === null || stopped) return null
    if (cached !== null && cached.id === loop.id) return cached
    if (inFlight !== null && inFlight.id === loop.id) {
      return { id: loop.id, bytes: await inFlight.promise }
    }
    const promise = (async (): Promise<Buffer> => {
      try {
        return await renderOnce(loop.id, loop.project)
      } catch (first) {
        // One retry, with a fresh engine. The realistic failure is a held
        // engine that died or a socket that closed under us. A second
        // failure is answered as 503 by the route; it does not retry in a
        // loop and it does not take the remote server down.
        console.error('remoteLoopRenderer: render failed, respawning once:', first)
        dropEngine()
        return await renderOnce(loop.id, loop.project)
      }
    })()
    inFlight = { id: loop.id, promise }
    try {
      const bytes = await promise
      const rendered: RenderedLoop = { id: loop.id, bytes }
      if (!stopped) cached = rendered
      return rendered
    } finally {
      if (inFlight !== null && inFlight.promise === promise) inFlight = null
    }
  }

  // Warm it up now, so the first roll he listens to is not the one that pays
  // for the spawn.
  void engine().catch((error) => {
    console.error('remoteLoopRenderer: engine spawn failed:', error)
  })

  return {
    currentLoopId: (): string | null => held?.id ?? null,
    setLoop: (project: EngineProject | null): void => {
      if (project === null) {
        held = null
        cached = null
        return
      }
      const forPhone = phoneLoopProject(project)
      const id = loopIdFor(forPhone)
      // Discover rebuilds its preview project constantly, with a fresh
      // groupId every time. An unchanged loop must not invalidate the cache.
      if (held !== null && held.id === id) return
      held = { id, project: forPhone }
      cached = null
    },
    wav,
    stop: (): void => {
      stopped = true
      held = null
      cached = null
      inFlight = null
      dropEngine()
      rmSync(dir, { recursive: true, force: true })
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/main/remoteLoopRenderer.test.ts`
Expected: PASS — 3 tests. The first spawn can take a few seconds; the per-test timeout is 120s for that reason.

If it fails with `engine binary not found`, build the engine (see this task's prerequisite) and re-run.

- [ ] **Step 5: Typecheck and lint**

```bash
npm run typecheck
npm run lint
```

Expected: `typecheck` still reports the two `transport` errors from Task 2 (`remoteServer.ts`, `DiscoverPanel.tsx`) and **nothing else**. Lint: 0 errors, no new warnings.

- [ ] **Step 6: Commit**

```bash
git add src/main/remoteLoopRenderer.ts src/main/remoteLoopRenderer.test.ts
git commit -m "One warm engine, one loop, and the file deleted behind it

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

---

## Task 4: Five routes still, and one of them is audio

`POST /api/transport` out, `GET /api/loop` in.

**Files:**
- Modify: `src/main/remoteServer.ts`

There is no test here. `remoteServer.ts` has never had one — its logic lives in the pure functions of `remoteAuth.ts`, which are tested, and the route table itself is verified by Elling's own walkthrough. Do not add a live-socket test just for this route; do not claim the route was tested.

- [ ] **Step 1: Retype the state getter and add the loop option**

In `src/main/remoteServer.ts`, change the import:

```ts
import type { RemoteCommand, RemoteStateResponse } from '@shared/remoteState'
```

and in `RemoteServerOptions`, change `getState` and add `loopWav`:

```ts
  /** The last state the renderer pushed, plus the current loopId. Answered
   * verbatim by GET /api/state -- the server holds no model of Discover at
   * all. */
  getState: () => RemoteStateResponse
  /** The current Discover loop as wav bytes, rendered on demand and cached
   * by the caller. Null when there is no loop to play. Rejects when the
   * render failed -- answered as 503 rather than crashing the server. */
  loopWav: () => Promise<{ id: string; bytes: Buffer } | null>
```

- [ ] **Step 2: Delete the transport route**

Remove this block entirely:

```ts
      if (req.method === 'POST' && url === '/api/transport') {
        const body = await readJsonBody(req)
        options.onCommand({ kind: 'transport', play: body.play === true })
        return respond(res, 200)
      }
```

- [ ] **Step 3: Add the audio route**

Insert immediately after the `/api/state` block and before `/api/roll`:

```ts
      if (req.method === 'GET' && url === '/api/loop') {
        // TAKES NO PARAMETERS AT ALL -- not a path, not an id, not a query
        // string. It serves whatever loop is current and names it in a
        // header. There is nothing to validate, nothing to traverse, and no
        // way to address anything but "now". A route with no input cannot be
        // given a bad one, which is how this keeps the property the rest of
        // the surface has: no route takes or returns a filesystem path.
        //
        // No byte-range handling, deliberately: the phone uses fetch +
        // decodeAudioData, not a media element, so Safari never asks for one.
        let loop: { id: string; bytes: Buffer } | null
        try {
          loop = await options.loopWav()
        } catch (error) {
          console.error('remoteServer: loop render failed:', error)
          return respond(res, 503)
        }
        if (loop === null) {
          res.writeHead(204)
          res.end()
          return
        }
        res.writeHead(200, {
          'content-type': 'audio/wav',
          'content-length': String(loop.bytes.length),
          'x-loop-id': loop.id,
          'cache-control': 'no-store'
        })
        res.end(loop.bytes)
        return
      }
```

- [ ] **Step 4: Update the module doc comment**

In `startRemoteServer`'s doc comment, replace the line

```
 * Five routes, and no route takes or returns a filesystem path or reads
 * the library. A paired attacker can roll dice and save a rifff. That is
 * the entire blast radius, by design rather than by accident.
```

with

```
 * Five routes, and no route takes or returns a filesystem path or reads
 * the library. GET /api/loop takes no parameters of any kind -- it serves
 * the current Discover loop's wav bytes and names it in an x-loop-id
 * header, so there is no id to validate and nothing to address but "now".
 * A paired attacker can roll dice, save a rifff, and hear the loop that is
 * already on screen. That is the entire blast radius, by design rather
 * than by accident.
```

- [ ] **Step 5: Verify**

```bash
npm run typecheck
```

Expected: the `transport` error in `remoteServer.ts` is gone; `src/main/index.ts` now fails because its `startRemoteServer` call is missing the new `loopWav` option and its `getState` returns a `RemoteState` rather than a `RemoteStateResponse`, and `DiscoverPanel.tsx` still fails on the removed verb. Those are Tasks 6 and 7.

```bash
npm run lint
```

Expected: 0 errors, no new warnings.

- [ ] **Step 6: Commit**

```bash
git add src/main/remoteServer.ts
git commit -m "Five routes still, and one of them is audio

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

---

## Task 5: A red hairline, and the loop in the phone's own hands

The page: the track, the line, the Web Audio player, the `mac playing` eyebrow, and the transport call gone.

**Files:**
- Modify: `src/main/remotePage.ts`

**The CSP does not change.** `decodeAudioData` is fed from a `fetch`, governed by `connect-src 'self'`, already present. There is no media element, so no `media-src`. Do not touch `REMOTE_PAGE_CSP`.

**Write ES5-flavoured JS** (`var`, `function`) to match what is already in the string. It is inside a TypeScript template literal and is not linted as JS. **No star-slash inside any CSS comment** (Finding 18).

- [ ] **Step 1: Add the track styles**

In the `<style>` block, immediately after the `.rows` rule, add:

```css
.track {
  position: relative;
  height: 22px;
  margin: 2px 0 18px;
  border-top: 1px solid #222222;
  pointer-events: none;
}
.line {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: #c56164;
  pointer-events: none;
}
```

and immediately above the `TYPE_COLORS` constant's existing comment, extend that comment's last sentence so it also covers the line. Replace:

```
// Colour is spent only on the slot rows, which carry a stem's own sound type -- the
// one thing on this page that carries audio information. Everything else
// is monochrome, sharp-cornered, lowercase.
```

with:

```
// Colour is spent only on the slot rows, which carry a stem's own sound type,
// and on the progress line, which is #c56164 -- the same hand-copied
// --ra-playhead literal Playhead.tsx uses on the real timeline and
// DiscoverPanel.tsx draws over a previewing slot's waveform. Those two are
// the only things on this page that carry audio information. Everything else
// is monochrome, sharp-cornered, lowercase.
```

- [ ] **Step 2: Add the track and the eyebrow to the markup**

In the `<div id="app">` block, insert the track between `.rows` and `.actions`, and the mac eyebrow after `.actions`:

```html
    <div class="rows" id="rows"></div>
    <div class="track" id="track"><div class="line" id="line" hidden></div></div>
    <div class="actions">
      <button class="big" id="roll-all">roll all</button>
      <button class="big" id="play">play</button>
      <button class="big" id="keep">keep</button>
    </div>
    <div class="eyebrow" id="mac"></div>
    <div class="msg" id="msg"></div>
```

- [ ] **Step 3: Add the player**

In the `<script>` block, after the existing `var playEl = document.getElementById('play')` line, add:

```js
  var lineEl = document.getElementById('line')
  var macEl = document.getElementById('mac')

  // The phone plays the loop ITSELF. The Mac is not touched in either
  // direction -- "phone audio distinct from the app", Elling, 2026-09-26 --
  // so both playing at once is intended, not a bug. macEl says so when it
  // happens.
  var audioCtx = null
  var audioBuffer = null
  var srcNode = null
  var loadedLoopId = null
  var currentLoopId = null
  var startedAt = 0
  var wantPlaying = false
  var fetching = false

  function setPlayLabel() {
    playEl.textContent = wantPlaying ? 'stop' : 'play'
    playEl.className = wantPlaying ? 'big on' : 'big'
  }

  function stopSource() {
    if (srcNode) {
      try { srcNode.stop() } catch (e) {}
      srcNode.disconnect()
      srcNode = null
    }
    lineEl.hidden = true
  }

  function startSource() {
    if (!audioCtx || !audioBuffer) return
    stopSource()
    srcNode = audioCtx.createBufferSource()
    srcNode.buffer = audioBuffer
    // An AudioBufferSourceNode loops sample-accurately, inside the audio
    // graph. An <audio loop> element puts an audible gap at the loop point in
    // Safari, which would land on every downbeat of the exact judgement this
    // page exists to make.
    srcNode.loop = true
    srcNode.connect(audioCtx.destination)
    startedAt = audioCtx.currentTime
    srcNode.start()
    lineEl.hidden = false
  }

  function loadLoop() {
    if (fetching || !wantPlaying || !token || !audioCtx) return
    if (!currentLoopId) { msgEl.textContent = 'nothing to play'; return }
    if (currentLoopId === loadedLoopId) return
    fetching = true
    msgEl.textContent = 'loading the loop'
    fetch('/api/loop', { headers: { authorization: 'Bearer ' + token } })
      .then(function (r) {
        if (r.status === 204) { msgEl.textContent = 'nothing to play'; return null }
        if (!r.ok) { msgEl.textContent = 'render failed'; return null }
        var id = r.headers.get('x-loop-id')
        return r.arrayBuffer().then(function (bytes) { return { id: id, bytes: bytes } })
      })
      .then(function (got) {
        if (!got) return null
        return audioCtx.decodeAudioData(got.bytes).then(function (buf) {
          audioBuffer = buf
          loadedLoopId = got.id
          msgEl.textContent = ''
          if (wantPlaying) startSource()
        })
      })
      .catch(function () { msgEl.textContent = 'render failed' })
      .then(function () { fetching = false })
  }

  // The progress line, driven by the phone's OWN audio clock. Nothing about
  // its position comes from the Mac: no position messages, no clock sync.
  // Unclickable in two independent ways -- .track is pointer-events:none, and
  // no listener of any kind is attached to it or to the line. It is an
  // indicator. Do not add a seek.
  function tick() {
    if (srcNode && audioBuffer && audioCtx && audioBuffer.duration > 0) {
      var t = (audioCtx.currentTime - startedAt) % audioBuffer.duration
      lineEl.style.left = ((t / audioBuffer.duration) * 100) + '%'
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
```

- [ ] **Step 4: Replace the play button's handler**

Replace:

```js
  playEl.addEventListener('click', function () {
    api('/api/transport', { play: playEl.textContent === 'play' })
  })
```

with:

```js
  playEl.addEventListener('click', function () {
    if (wantPlaying) {
      wantPlaying = false
      stopSource()
      setPlayLabel()
      return
    }
    // iOS will not let an AudioContext produce sound unless it was started
    // from a user gesture. THIS CLICK IS THAT GESTURE -- the context is built
    // here, once, and kept. There is no autoplay path and there must not be
    // one: a context created on load is suspended and plays silence with no
    // error.
    if (!audioCtx) {
      var Ctor = window.AudioContext || window.webkitAudioContext
      audioCtx = new Ctor()
    }
    // Safari 16.4+. Without it, the hardware mute switch silences web audio
    // while the progress line keeps moving, which looks exactly like a bug.
    if (navigator.audioSession) {
      try { navigator.audioSession.type = 'playback' } catch (e) {}
    }
    if (audioCtx.state === 'suspended') audioCtx.resume()
    wantPlaying = true
    setPlayLabel()
    if (audioBuffer && loadedLoopId === currentLoopId) startSource()
    else loadLoop()
  })
```

- [ ] **Step 5: Teach `render` about the loop id**

In `render(state)`, replace:

```js
    msgEl.textContent = ''
    playEl.textContent = state.playing ? 'stop' : 'play'
    playEl.className = state.playing ? 'big on' : 'big'
```

with:

```js
    if (msgEl.textContent === 'open discover on the mac') msgEl.textContent = ''
    // state.playing is the MAC's transport, shown and never obeyed.
    macEl.textContent = state.playing ? 'mac playing' : ''
    setPlayLabel()
    currentLoopId = state.loopId
    if (wantPlaying && currentLoopId !== loadedLoopId) loadLoop()
```

and in the `!state.discoverOpen` branch, add a stop so a closed Discover does not leave the phone looping something that no longer exists:

```js
    if (!state.discoverOpen) {
      rowsEl.innerHTML = ''
      macEl.textContent = ''
      currentLoopId = null
      loadedLoopId = null
      audioBuffer = null
      if (wantPlaying) { wantPlaying = false; stopSource(); setPlayLabel() }
      msgEl.textContent = 'open discover on the mac'
      return
    }
```

- [ ] **Step 6: Verify**

```bash
npm run typecheck
npm run lint
```

Expected: `remotePage.ts` is clean (it only ever used the route, never the `transport` type, so it never appeared in the Task 2 error list). `index.ts` still fails on the missing `loopWav` option and `DiscoverPanel.tsx` still fails on the removed verb. 0 lint errors, no new warnings.

**Do not claim the page was opened, tapped, or heard.** This environment has no phone, no browser and no audio.

- [ ] **Step 7: Commit**

```bash
git add src/main/remotePage.ts
git commit -m "A red hairline, and the loop in the phone's own hands

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

---

## Task 6: Main holds the render engine for as long as the remote is on

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`

- [ ] **Step 1: Add the renderer to main's remote state**

In `src/main/index.ts`, add to the imports near line 89:

```ts
import { createRemoteLoopRenderer, type RemoteLoopRenderer } from './remoteLoopRenderer'
import type { EngineProject } from '@shared/buildEngineProject'
```

and beside `let remoteServer` (line 262), add:

```ts
// The phone remote's own render engine -- SEPARATE from the session-long
// playback engine, which is busy playing. Created when the remote is switched
// on and torn down with it, so at rest this feature owns no process at all.
let remoteLoop: RemoteLoopRenderer | null = null
```

- [ ] **Step 2: Create and destroy it with the server**

In `stopPhoneRemote()`, add the teardown:

```ts
function stopPhoneRemote(): void {
  remoteServer?.stop()
  remoteServer = null
  remoteLoop?.stop()
  remoteLoop = null
  remotePairingGate = { attemptsUsed: 0, lockedOut: false }
}
```

In the `start-phone-remote` handler, create the renderer **before** the server and wire both new options. Replace the `getState` line and add `loopWav`:

```ts
    remotePairingGate = { attemptsUsed: 0, lockedOut: false }
    // Spawned here and deliberately NOT awaited: READINESS_TIMEOUT_MS is 45s
    // for documented cold-start reasons and the gear menu must not sit on it.
    // The first render awaits it instead.
    remoteLoop = createRemoteLoopRenderer()
    remoteServer = startRemoteServer({
      lanAddress,
      getState: () => ({ ...lastRemoteState, loopId: remoteLoop?.currentLoopId() ?? null }),
      loopWav: () => remoteLoop?.wav() ?? Promise.resolve(null),
```

Leave `onCommand`, `onPairingChanged` and `onServerError` exactly as they are.

- [ ] **Step 3: Add the loop push handler**

Beside the existing `set-remote-state` handler:

```ts
  ipcMain.handle('set-remote-loop', (_event, project: EngineProject | null) => {
    // The project is full of real filesystem paths and NEVER leaves the main
    // process. What the phone sees is remoteLoop.currentLoopId() -- sixteen
    // hex characters of a sha256 of the loop's audio-bearing fields.
    remoteLoop?.setLoop(project)
  })
```

- [ ] **Step 4: Expose it in preload**

In `src/preload/index.ts`, beside `setRemoteState` (around line 597), add:

```ts
  setRemoteLoop: (project: unknown | null): Promise<void> =>
    ipcRenderer.invoke('set-remote-loop', project),
```

and add the matching signature to the `rifffApi` type declaration in the same file, next to `setRemoteState`'s:

```ts
  /** The EngineProject Discover is previewing, so the phone can be served a
   * render of it. Typed as `unknown` here for the same reason
   * engineLoadProject is: the project crosses the IPC boundary as plain JSON
   * and preload has no business re-stating EngineProject's shape. */
  setRemoteLoop: (project: unknown | null) => Promise<void>
```

**Check how `engineLoadProject` is declared in this file and match it exactly** — if it types its project parameter differently, use the same form for consistency rather than introducing a second convention.

- [ ] **Step 5: Verify**

```bash
npm run typecheck
```

Expected: only `DiscoverPanel.tsx`'s `transport` error remains.

```bash
npm run lint
```

Expected: 0 errors, no new warnings.

- [ ] **Step 6: Commit**

```bash
git add src/main/index.ts src/preload/index.ts
git commit -m "Main holds the render engine for as long as the remote is on

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

---

## Task 7: Discover hands the phone the same loop the Mac is holding

**Files:**
- Modify: `src/renderer/src/components/DiscoverPanel.tsx`

No component test. React components are not unit-tested in this codebase (CLAUDE.md); this is verified by typecheck, lint, the pure logic's own tests, and Elling's walkthrough.

- [ ] **Step 1: Push the project the preview just built**

In `syncPreviewToEngine`, the existing lines around 859-863 read:

```ts
      const project = await buildEngineProject(
        previewState,
        resolveStretchedForPlayback,
        pluginCatalog
      )
      if (unmountedRef.current || previewSyncGenerationRef.current !== myGeneration) return
      if (!stillOwnEngine(engineToken)) return

      await window.rifffApi.engineLoadProject(project)
```

Insert one statement between the generation check and the ownership check:

```ts
      if (unmountedRef.current || previewSyncGenerationRef.current !== myGeneration) return
      // The phone gets the loop whether or not the Mac's engine is showing
      // it -- pushed BEFORE the ownership gate below on purpose, so a
      // Discover panel that has lost the engine to something else still has
      // something to hand the sofa. Main strips the plugins, fingerprints it
      // and renders it on demand; nothing here blocks on any of that.
      void window.rifffApi.setRemoteLoop(project)
      if (!stillOwnEngine(engineToken)) return
```

It must be **after** the generation check — a superseded build must not overwrite a newer loop.

- [ ] **Step 2: Clear it on the two early returns**

In the same function, the `members.length === 0` branch reads:

```ts
    if (members.length === 0) {
      await restorePreviewIfLoaded()
      return
    }
```

Make it:

```ts
    if (members.length === 0) {
      void window.rifffApi.setRemoteLoop(null)
      await restorePreviewIfLoaded()
      return
    }
```

and do the same in the `if (!assembly)` branch below it:

```ts
    if (!assembly) {
      void window.rifffApi.setRemoteLoop(null)
      await restorePreviewIfLoaded()
      return
    }
```

- [ ] **Step 3: Clear it on unmount**

In the unmount effect that already pushes a closed state (the one containing `discoverOpen: false`), add the loop clear:

```ts
  useEffect(() => {
    return () => {
      void window.rifffApi.setRemoteLoop(null)
      void window.rifffApi.setRemoteState({
        discoverOpen: false,
        playing: false,
        kept: 0,
        rolled: 0,
        lastKeptName: null,
        slots: []
      })
    }
  }, [])
```

- [ ] **Step 4: Drop the transport branch**

In `remoteCommandRef`'s effect, remove the `transport` line so it reads:

```ts
    remoteCommandRef.current = (command: RemoteCommand): void => {
      if (command.kind === 'roll-all') void rerollAll()
      else if (command.kind === 'roll-slot') void rerollSlot(command.slotId)
      else if (command.kind === 'keep') void keepGroup()
    }
```

- [ ] **Step 5: Verify**

```bash
npm run typecheck
npm run lint
```

Expected: **0 typecheck errors**, 0 lint errors, exactly the 4 pre-existing prettier warnings.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/DiscoverPanel.tsx
git commit -m "Discover hands the phone the same loop the mac is holding

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

---

## Task 8: Final gate

- [ ] **Step 1: Everything, locally**

```bash
npm test
npm run typecheck
npm run lint
```

Expected: **183 test files** — 181 baseline plus `phoneLoop` and `remoteLoopRenderer` — all passing. 0 typecheck errors, 0 lint errors, exactly the 4 pre-existing prettier warnings.

- [ ] **Step 2: Everything, as CI would run it**

```bash
CI=1 npm test 2>&1 | tail -20
```

Expected: **156 test files** (154 baseline plus the two new ones — **neither is excluded, and neither should be added to the exclusion list**), green, and no `Worker exited unexpectedly`.

- [ ] **Step 3: Confirm the engine is untouched**

```bash
git diff --stat c7cdb5c..HEAD -- native-engine/
```

Expected: empty. If it is not, something went wrong — the whole premise of this plan is that `render-export` already does the job.

- [ ] **Step 4: Confirm the CI exclusion list is untouched**

```bash
git diff c7cdb5c..HEAD -- vitest.config.ts
```

Expected: empty.

- [ ] **Step 5: Confirm no path leaks**

```bash
npx vitest run src/shared/remoteState.test.ts
```

Expected: PASS, including the two standing no-path assertions and the new `loopId` shape check.

- [ ] **Step 6: Hand off honestly**

Report, in these words or close to them, that the following were **not** verified and cannot be from this environment:

- whether the loop actually sounds gapless on his phone — the entire reason for choosing Web Audio over an `<audio>` element is a Safari behaviour nothing here can hear;
- whether tap-to-sound is fast enough to keep the roll/keep loop enjoyable, which is the only real requirement; the 0.3–0.8s figure in the spec is a prediction, not a measurement;
- whether the progress line reads clearly at arm's length in a dark room, or whether one pixel is too thin on a phone;
- whether the iOS hardware mute switch or a screen lock gets in the way in practice;
- whether the phone and the Mac both playing at once is as tolerable as "distinct" implies once he is sitting between them;
- whether losing the ability to stop the Mac's playback from the phone is missed;
- anything at all about how it sounds.

Nothing in a build log covers any of those.
