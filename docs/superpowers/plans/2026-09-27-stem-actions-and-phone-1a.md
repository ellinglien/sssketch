# Stem actions on the phone, and layout 1a — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put Discover's four existing per-slot actions (`similar`, `adjacent`, `random`, `duplicate`) plus a new tap-to-mute onto the phone remote, and rewrite the remote page's app state to layout 1a — a bottom-aligned thumb console with per-stem waveforms, bottom sheets and hold-to-keep.

**Architecture:** **The four actions already exist on the desktop.** This plan does not design or build them; it carries them over the wire. One new HTTP route (`POST /api/slot-action`) carries one new `RemoteCommand` member, which `DiscoverPanel`'s existing `remoteCommandRef` dispatches to the *same* functions the desktop buttons already call — `rerollSlot`, `rerollRandomSlot`, `duplicateSlot`, `toggleSlotPreview`. Only `adjacent` needs a new renderer function, because the desktop's `adjacent` is a browse popover with no one-shot form; its pick is a pure, injected-random function in `src/shared/`. The page then grows two new facts in the state it is already pushed — a `muted` flag and 64 quantised peak buckets per slot — both added to `remoteStateFromSlots`, which is the privacy boundary and has its own tests. The peaks are free: every resolved Discover row already decodes its stem through the path-keyed `peakCache`, so the push effect only has to `peekPeaks(path)`.

**Tech Stack:** TypeScript, React 19, Electron main + renderer, node:http, vitest. The phone page is one hand-written string of plain browser JS in the Electron main process — no bundler, no framework, no build step.

**Spec:** `docs/superpowers/specs/2026-09-27-stem-actions-and-phone-1a-design.md` (2026-09-27). Its **"Not now"** section is the scope boundary — **if something is not named as in, it is out.**

**Brief:** `docs/superpowers/specs/2026-09-27-phone-remote-design-brief.md` (the brief that produced the design pass; full constraint list).

**Elling, verbatim:** *"i think we want this to be as fully featured as the desktop discover, so pls add those things to the hold menu"* / *"similar adjacent random and duplicate"* / *"also we should add one click mute.. long press is the menu.. short is mute or unmute"* / *"follow the patterns from the arrangement view for muted appearance"*

**NO NATIVE-ENGINE CHANGES.** Nothing in this plan reaches `native-engine/`. `EngineProject` / `buildEngineProject.ts` are a hand-synced pair (CLAUDE.md) and **this plan changes neither.** If you conclude a native-engine change is needed, **STOP and report it rather than planning one.**

**NO `vitest.config.ts` CHANGES.** Nothing here opens a database. The 28-file CI exclusion list exists because better-sqlite3 crashes vitest workers on GitHub's macOS runners; this plan adds no SQLite-opening main-process test file, so no exclusion is needed and **none may be added.**

**Baseline (`master`, 2026-09-27):**

```
Test Files  191 passed (191)
     Tests  2901 passed (2901)
npm run typecheck  -> 0 errors
npm run lint       -> 0 errors, 4 pre-existing prettier warnings
```

**Machine note — read before chasing a failure.** `coreaudiod` on this Mac periodically leaks threads and makes every test that spawns the JUCE binary fail on timing. If you see scattered failures in `playbackEngineLifecycle`, `liveReschedule`, `pluginScan`, `engineProcess` or `ipc-roundtrip`, run `ps -M $(pgrep -x coreaudiod) | wc -l` — a few dozen is healthy, ~1000 is the leak. **Do not chase those as code bugs.** Separately, `src/main/remoteServer.test.ts` binds real sockets and has its own worker-partitioned port block; if only that file fails in a full run, re-run it alone (`npx vitest run src/main/remoteServer.test.ts`) and treat a clean isolated run as green. **No other file may fail.**

---

## Findings that shaped this plan — read these before Task 1

1. **The four buttons already exist.** `src/renderer/src/components/DiscoverPanel.tsx`, slot-row grid tracks 12–15: `similar` (`:4549`), `adjacent` (`:4579`), `random` (`:4602`), `duplicate` (`:4630`), with a decorative dice at track 11 (`:4511`). **Add no desktop UI. Change no desktop behaviour. Do not relabel, reorder or renumber the 15-track grid.**

2. **Their handlers.** `onReroll` → `rerollSlot(id)` (`:2004`); `onRerollRandom` → `rerollRandomSlot(id)` (`:2064`); `onDuplicate` → `duplicateSlot(id)` (`:1772`). **`adjacent` has no handler prop** — its `onClick` (`:4553`) opens `DiscoverNearbyPopover` locally, and a pick there calls `onSwapFromNearby` → `swapSlotFromNearby(id, candidate)` (`:1809`).

3. **Undo is already settled.** `rerollSlot`, `rerollRandomSlot`, `duplicateSlot` and `swapSlotFromNearby` each call `pushUndoSnapshot()` first. `toggleSlotPreview` (`:955`) deliberately does not — **mute is not undoable and must not become so.**

4. **Locks are already settled.** Only `rerollAll` skips `slot.locked`. None of the four per-slot actions checks it. **Do not add a lock check anywhere.**

5. **Generation claims.** `pickForSlot` (`:1828`) and `rollRandomForSlot` (`:2033`) each claim `rerollGenerationRef` **before the first `await`**, sharing one map so either can invalidate the other. The one new async renderer function in this plan (Task 5) reuses that pattern verbatim.

6. **`react-hooks/purity` errors on `Math.random()` inside a component-scoped function.** That is why `freshSlotId` and `randomDiscoverSlotKind` live at module scope. Any randomness this plan adds goes in `src/shared/` with an injected `random: () => number` — which is also the only way to test it.

7. **Peaks are already computed for every resolved Discover slot.** The row renders `<Waveform path={resolvedStem.path} …>` (`:4240`, `:4273`); `Waveform.tsx:39-46` reads `peekPeaks(path)` then `getPeaks(path)`; `src/renderer/src/audio/peakCache.ts` is path-keyed, persisted-cache-first, and exposes a **synchronous** `peekPeaks(path): number[] | null`. **Do not add a second decode and do not add an endpoint.**

8. **The remote push effect is already in the panel.** `DiscoverPanel.tsx:1482-1493` calls `window.rifffApi.setRemoteState(remoteStateFromSlots(buildSlotSnapshots(), {...}))`. `buildSlotSnapshots` (`:1437`) already carries `audible: previewingSlotIds.has(slot.id)` and `stem.path`.

9. **`remoteStateFromSlots` is the privacy boundary.** `src/shared/remoteState.ts`. Its tests assert `JSON.stringify(state)` contains neither `/Users/` nor the stem CID. Every field added must keep that true.

10. **The page's script dialect is enforced by a test.** `src/main/remotePage.test.ts`: **no arrow functions, no `??`, no `?.`** — and, critically, **`expect(SCRIPT).not.toContain('preventDefault')` applies to the ENTIRE script.** Suppress iOS long-press selection in CSS, not JS, and give the row no `click` listener.

11. **`remotePage.test.ts` asserts exactly three `pendingMask = ` writes** and that the only selection change is `pendingMask = KIND_TOGGLE[pendingMask][index]`. The bottom-sheet rewrite must not add a fourth.

12. **The button-label test regex is `<button[^>]*>([^<]*)</button>`** — it cannot see a button containing child elements. The new `keep` button (fill span + hint span) drops out of that scan; its labels go in the test's explicit runtime list instead.

13. **React components are NOT unit-tested in this codebase** (CLAUDE.md). Tasks 5 and 6 have **no component tests**, deliberately. They are verified by `npm run typecheck` + `npm run lint` + a green suite, then by Elling's manual walkthrough. **This environment has no GUI or audio tooling — do not claim a button was tapped, a haptic was felt or a loop was heard.**

14. **Design tokens are the law** (`src/renderer/src/styles/tokens.css`, hand-copied into `remotePage.ts`): near-black monochrome, Silkscreen with no bold/italic, **no `border-radius`**, lowercase copy, **no emoji, no exclamation marks**, colour only on things carrying audio information. **Buttons two words maximum or an icon.** `#6a6a6a` is `--ra-text-3`, which is exactly the grey `StemWaveformRow` draws its always-visible layer in — that is why it is the muted colour here.

15. **Lint rules that will bite.** Explicit return type on every function, inline ones included. `react-hooks/set-state-in-effect` **errors** on a synchronous `setState` inside an effect (established workaround: defer through `void Promise.resolve().then(...)`). Prettier: `singleQuote: true`, `semi: false`, `printWidth: 100`, `trailingComma: none`.

---

## File structure

**Created**
- `src/shared/discoverAdjacentPick.ts` — pure pick for the phone's one-tap `adjacent`. Generic over `{ stemCID: string }`, injected random.
- `src/shared/discoverAdjacentPick.test.ts`
- `src/shared/remotePeaks.ts` — `quantiseRemotePeaks`, the 128→64, 0..100 downsample.
- `src/shared/remotePeaks.test.ts`

**Modified**
- `src/shared/remoteState.ts` — `RemoteSlotAction`, `parseRemoteSlotAction`, the `slot-action` command, `muted` + `peaks` on `RemoteSlotView`, third arg on `remoteStateFromSlots`.
- `src/shared/remoteState.test.ts` — coverage for all of the above.
- `src/main/remoteServer.ts` — the eighth route.
- `src/main/remoteServer.test.ts` — a capturing `onCommand`, plus route tests.
- `src/renderer/src/components/DiscoverPanel.tsx` — `rollAdjacentForSlot`, the `slot-action` dispatch, peaks in the push effect.
- `src/main/remotePage.ts` — the app state, rewritten to 1a. **Pair screen, `remoteNoticePage`, `REMOTE_PAGE_CSP`, `acceptsHtml` and the notice constants are untouched.**
- `src/main/remotePage.test.ts` — updated and extended.

**Untouched, and must stay so:** `native-engine/`, `vitest.config.ts`, `src/shared/discoverRanking.ts`, `src/shared/discoverSlotKind.ts`, `src/shared/discoverSlotKindMask.ts`, `src/main/discoverCandidates.ts`, `src/main/discoverAdjacency.ts`, `src/renderer/src/components/DiscoverNearbyPopover.tsx`, `src/renderer/src/audio/peakCache.ts`, and the desktop remote modal.

**Order matters:** Tasks 1–6 are the wire and the Mac. Tasks 7–13 are the page, and **the page cannot call what does not exist**, so do not start Task 7 before Task 6 is green.

---

## Task 1: `parseRemoteSlotAction` and the `slot-action` command

**Files:**
- Modify: `src/shared/remoteState.ts`
- Test: `src/shared/remoteState.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/shared/remoteState.test.ts`, and add `parseRemoteSlotAction` to the existing import from `./remoteState`:

```ts
describe('parseRemoteSlotAction', () => {
  it('accepts the five actions the phone can actually send', () => {
    expect(parseRemoteSlotAction('mute')).toBe('mute')
    expect(parseRemoteSlotAction('similar')).toBe('similar')
    expect(parseRemoteSlotAction('adjacent')).toBe('adjacent')
    expect(parseRemoteSlotAction('random')).toBe('random')
    expect(parseRemoteSlotAction('duplicate')).toBe('duplicate')
  })

  it('refuses anything else outright rather than best-guessing it', () => {
    // Same trust rule as parseRemoteSlotKinds: an unknown string fails the
    // whole request, so this field can never become a channel for a path.
    expect(parseRemoteSlotAction('MUTE')).toBeNull()
    expect(parseRemoteSlotAction('keep')).toBeNull()
    expect(parseRemoteSlotAction('/Users/nickel/Music/secret/abc123')).toBeNull()
    expect(parseRemoteSlotAction('')).toBeNull()
    expect(parseRemoteSlotAction(undefined)).toBeNull()
    expect(parseRemoteSlotAction(null)).toBeNull()
    expect(parseRemoteSlotAction(1)).toBeNull()
    expect(parseRemoteSlotAction(['mute'])).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/remoteState.test.ts`
Expected: FAIL — `parseRemoteSlotAction is not a function` / TS error "has no exported member".

- [ ] **Step 3: Write minimal implementation**

In `src/shared/remoteState.ts`, above `parseRemoteSlotKinds`:

```ts
/** The five things a long press (or a tap, for `mute`) on a phone row can
 * ask for. Four of them are the buttons that have been on every desktop
 * Discover slot row since 2026-09-20 -- `similar`, `adjacent`, `random`,
 * `duplicate` -- and the fifth is the desktop's own per-row mute. Nothing
 * here is a new Discover operation; see docs/superpowers/specs/2026-09-27-
 * stem-actions-and-phone-1a-design.md §1.1. */
export type RemoteSlotAction = 'mute' | 'similar' | 'adjacent' | 'random' | 'duplicate'

const REMOTE_SLOT_ACTIONS: RemoteSlotAction[] = [
  'mute',
  'similar',
  'adjacent',
  'random',
  'duplicate'
]

/** The whole trust boundary for the action sheet, in one pure function --
 * same shape and the same rule as parseRemoteSlotKinds below: an unknown
 * value is not coerced, dropped or best-guessed, it fails the whole
 * request. */
export function parseRemoteSlotAction(value: unknown): RemoteSlotAction | null {
  if (typeof value !== 'string') return null
  return REMOTE_SLOT_ACTIONS.find((a) => a === value) ?? null
}
```

Then add the command member to `RemoteCommand`:

```ts
  | { kind: 'slot-action'; slotId: string; action: RemoteSlotAction }
```

and amend that union's doc comment: it is now **six** verbs, with one enumerated payload rather than five extra verbs, and **mute comes off** the "deliberately still NOT here" list (per-slot gain, the matching dial, chaos, the roll filters, favourites-only, undo/redo, the adjacency popover and the match meter all stay off it).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shared/remoteState.test.ts`
Expected: PASS, all tests in the file.

- [ ] **Step 5: Commit**

```bash
git add src/shared/remoteState.ts src/shared/remoteState.test.ts
git commit -m "$(cat <<'EOF'
feat(remote): one enumerated slot-action verb for the phone

Four of the five are the buttons already on every desktop Discover slot
row; the fifth is its mute. One command member and one parser, not five
verbs.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

## Task 2: `muted` on the pushed state

**Files:**
- Modify: `src/shared/remoteState.ts`
- Test: `src/shared/remoteState.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/shared/remoteState.test.ts`, update the first `remoteStateFromSlots` assertion and add one:

```ts
  it('carries the slot id, a kind label, the stem name, its sound type and whether it is muted', () => {
    const state = remoteStateFromSlots([slot()], {
      discoverOpen: true,
      playing: false,
      kept: 3,
      rolled: 11,
      lastKeptName: null
    })
    expect(state.slots).toEqual([
      {
        id: 's1',
        kindLabel: 'drummy',
        stemName: 'wooden thud',
        soundType: 'drums',
        muted: false,
        peaks: null
      }
    ])
  })

  it('inverts the snapshot’s audible into the mute the phone actually shows', () => {
    const state = remoteStateFromSlots([slot({ audible: false })], {
      discoverOpen: true,
      playing: false,
      kept: 0,
      rolled: 0,
      lastKeptName: null
    })
    expect(state.slots[0].muted).toBe(true)
  })
```

And update the existing `'reads an unresolved slot as empty rather than dropping the row'` assertion to
`{ id: 's1', kindLabel: 'drummy', stemName: '', soundType: null, muted: false, peaks: null }`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/remoteState.test.ts`
Expected: FAIL — received objects lack `muted` and `peaks`.

- [ ] **Step 3: Write minimal implementation**

In `src/shared/remoteState.ts`, on `RemoteSlotView`:

```ts
  /** Not in Discover's audible preview mix. Inverted from
   * CoachSlotSnapshot's own `audible` HERE, once, rather than on the page:
   * the guided flow asks "is this in the mix", the phone shows a mute
   * state, and the page should not have to invert it at four call sites. */
  muted: boolean
  /** 64 integers, 0..100, for this row's own waveform -- or null when the
   * stem has not been analysed yet. Quantised by quantiseRemotePeaks
   * (@shared/remotePeaks) from peaks the Mac's own Discover rows already
   * computed (peakCache.ts). Amplitude buckets are not a path, do not
   * identify a file and cannot be turned back into one, so this does not
   * widen the boundary this function IS. */
  peaks: number[] | null
```

and in the `slots.map`:

```ts
      muted: !slot.audible,
      peaks: null
```

(`peaks` is wired for real in Task 3; leaving it `null` here keeps this task one idea.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shared/remoteState.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/remoteState.ts src/shared/remoteState.test.ts
git commit -m "$(cat <<'EOF'
feat(remote): carry each slot's mute state to the phone

Inverted from the snapshot's `audible` at the boundary, so the page never
has to.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

## Task 3: `quantiseRemotePeaks`, and peaks in the pushed state

**Files:**
- Create: `src/shared/remotePeaks.ts`
- Create: `src/shared/remotePeaks.test.ts`
- Modify: `src/shared/remoteState.ts`
- Test: `src/shared/remoteState.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/shared/remotePeaks.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { REMOTE_PEAK_BUCKETS, quantiseRemotePeaks } from './remotePeaks'

describe('quantiseRemotePeaks', () => {
  it('returns exactly the bucket count the page draws', () => {
    const peaks = Array.from({ length: 128 }, (_, i) => i / 127)
    expect(quantiseRemotePeaks(peaks)).toHaveLength(REMOTE_PEAK_BUCKETS)
    expect(REMOTE_PEAK_BUCKETS).toBe(64)
  })

  it('takes the MAX of each window, never an average', () => {
    // An average of a drum hit and the silence around it draws a quiet drum
    // hit -- the same rule peaksFromChannel and the page's own
    // peaksFromBuffer already follow.
    const peaks = [1, 0, 0, 0]
    expect(quantiseRemotePeaks(peaks, 2)).toEqual([100, 0])
  })

  it('scales to whole numbers from 0 to 100', () => {
    expect(quantiseRemotePeaks([0, 0.5, 1, 0.25], 4)).toEqual([0, 50, 100, 25])
  })

  it('clamps and abs-es rather than trusting its input', () => {
    // -3 abs-es to 3 and clamps to the top; a NaN and an infinity are
    // skipped, so their buckets are simply empty rather than NaN.
    expect(quantiseRemotePeaks([-3, 2, Number.NaN, Number.POSITIVE_INFINITY], 4)).toEqual([
      100, 100, 0, 0
    ])
  })

  it('stretches a short input rather than returning a short row', () => {
    // Two peaks over four buckets repeats each one, which draws a coarse
    // shape. Padding with silence would draw a shape that is half wrong.
    expect(quantiseRemotePeaks([1, 1], 4)).toEqual([100, 100, 100, 100])
  })

  it('reads an empty input as no waveform rather than throwing', () => {
    expect(quantiseRemotePeaks([])).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/remotePeaks.test.ts`
Expected: FAIL — "Failed to resolve import './remotePeaks'".

- [ ] **Step 3: Write minimal implementation**

Create `src/shared/remotePeaks.ts`:

```ts
// src/shared/remotePeaks.ts

/** How many buckets a phone row's waveform is drawn from. The desktop's own
 * peaks are 128 (peaksFromChannel, @shared/visuals); a phone row is under
 * 250 css pixels wide, so sending all 128 would be twice the payload for
 * sub-pixel detail. 64 integers is roughly 200 bytes per slot, which at the
 * page's 700ms poll is nothing on a LAN. */
export const REMOTE_PEAK_BUCKETS = 64

/** Downsamples a stem's peaks for the phone: max per window (never an
 * average -- an average of a drum hit and the silence around it draws a
 * quiet drum hit), then whole numbers 0..100.
 *
 * Integers, not floats, because this rides in the state poll and a float
 * costs three times the characters for detail no 18px canvas can show.
 * Never throws; an empty input is null, meaning "this row has no waveform
 * yet", which the page already knows how to draw. */
export function quantiseRemotePeaks(
  peaks: readonly number[],
  buckets: number = REMOTE_PEAK_BUCKETS
): number[] | null {
  if (peaks.length === 0 || buckets <= 0) return null
  const out: number[] = []
  for (let i = 0; i < buckets; i += 1) {
    const a = Math.floor((i * peaks.length) / buckets)
    const b = Math.max(a + 1, Math.floor(((i + 1) * peaks.length) / buckets))
    let max = 0
    for (let j = a; j < b && j < peaks.length; j += 1) {
      const v = peaks[j]
      if (!Number.isFinite(v)) continue
      const abs = v < 0 ? -v : v
      if (abs > max) max = abs
    }
    if (max > 1) max = 1
    out.push(Math.round(max * 100))
  }
  return out
}
```

Note on the short-input case: `b = Math.max(a + 1, …)` is what makes an upsample repeat rather than emit zeros — with `peaks = [1, 1]` and `buckets = 4`, every window is one real sample wide, so the shape is coarse but not half-silent. Do not "fix" that `Math.max` away; without it, windows where `a === b` would emit `0` and the row would draw a comb.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shared/remotePeaks.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write the failing test for the boundary**

Add to `src/shared/remoteState.test.ts`:

```ts
  it('carries quantised peaks for a slot the mac has already analysed', () => {
    const state = remoteStateFromSlots(
      [slot()],
      { discoverOpen: true, playing: false, kept: 0, rolled: 0, lastKeptName: null },
      new Map([['s1', [0, 0.5, 1, 0.25]]])
    )
    expect(state.slots[0].peaks).toHaveLength(64)
    expect(state.slots[0].peaks?.[0]).toBe(0)
    expect(state.slots[0].peaks?.[63]).toBe(25)
  })

  it('reads a slot with no analysis yet as no waveform, not an empty one', () => {
    const state = remoteStateFromSlots(
      [slot()],
      { discoverOpen: true, playing: false, kept: 0, rolled: 0, lastKeptName: null },
      new Map()
    )
    expect(state.slots[0].peaks).toBeNull()
  })

  it('is keyed by slot id, so a path cannot enter through the new door either', () => {
    const state = remoteStateFromSlots(
      [slot()],
      { discoverOpen: true, playing: false, kept: 0, rolled: 0, lastKeptName: null },
      new Map([['s1', [0.4, 0.9]]])
    )
    expect(JSON.stringify(state)).not.toContain('/Users/')
    expect(JSON.stringify(state)).not.toContain('abc123')
    for (const v of state.slots[0].peaks ?? []) {
      expect(Number.isInteger(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(100)
    }
  })
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run src/shared/remoteState.test.ts`
Expected: FAIL — `remoteStateFromSlots` takes two arguments, and `peaks` is `null`.

- [ ] **Step 7: Wire it**

In `src/shared/remoteState.ts`, import and widen the signature:

```ts
import { quantiseRemotePeaks } from './remotePeaks'
```

```ts
export function remoteStateFromSlots(
  slots: readonly CoachSlotSnapshot[],
  meta: RemoteStateMeta,
  // Keyed by SLOT ID, never by path -- the caller has the paths and this
  // function deliberately still never sees one.
  peaksBySlotId?: ReadonlyMap<string, readonly number[]>
): RemoteState {
```

and in the map, replacing `peaks: null`:

```ts
      peaks: quantiseRemotePeaks(peaksBySlotId?.get(slot.id) ?? [])
```

- [ ] **Step 8: Run both test files**

Run: `npx vitest run src/shared/remoteState.test.ts src/shared/remotePeaks.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/shared/remotePeaks.ts src/shared/remotePeaks.test.ts src/shared/remoteState.ts src/shared/remoteState.test.ts
git commit -m "$(cat <<'EOF'
feat(remote): 64 quantised peak buckets per slot, keyed by slot id

Amplitude integers, not a path and not reversible to one -- the boundary
this function is stays exactly as wide as it was.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

## Task 4: `pickAdjacentCandidate`

**Files:**
- Create: `src/shared/discoverAdjacentPick.ts`
- Create: `src/shared/discoverAdjacentPick.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/shared/discoverAdjacentPick.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { pickAdjacentCandidate } from './discoverAdjacentPick'

function c(stemCID: string): { stemCID: string } {
  return { stemCID }
}

describe('pickAdjacentCandidate', () => {
  it('draws from older first, then newer -- earlier before later', () => {
    const pick = pickAdjacentCandidate([c('o1'), c('o2')], [c('n1')], 'anchor', () => 0)
    expect(pick?.stemCID).toBe('o1')
  })

  it('reaches the newer end of the pool too', () => {
    // random -> 0.99 picks the last of three: older o1, o2, then newer n1.
    const pick = pickAdjacentCandidate([c('o1'), c('o2')], [c('n1')], 'anchor', () => 0.99)
    expect(pick?.stemCID).toBe('n1')
  })

  it('never hands back the stem already in the slot', () => {
    const pick = pickAdjacentCandidate([c('same')], [c('other')], 'same', () => 0)
    expect(pick?.stemCID).toBe('other')
  })

  it('returns null when the jam has nothing else nearby', () => {
    expect(pickAdjacentCandidate([], [], 'anchor', () => 0)).toBeNull()
    expect(pickAdjacentCandidate([c('same')], [], 'same', () => 0)).toBeNull()
  })

  it('cannot run off the end of the pool on a random of exactly 1', () => {
    const pick = pickAdjacentCandidate([c('o1')], [], 'anchor', () => 1)
    expect(pick?.stemCID).toBe('o1')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/discoverAdjacentPick.test.ts`
Expected: FAIL — "Failed to resolve import './discoverAdjacentPick'".

- [ ] **Step 3: Write minimal implementation**

Create `src/shared/discoverAdjacentPick.ts`:

```ts
// src/shared/discoverAdjacentPick.ts

/** One pick out of a slot's temporal-adjacency window, for the PHONE's
 * one-tap `adjacent`.
 *
 * The desktop's own `adjacent` is a browser -- DiscoverNearbyPopover draws
 * up to four thumbnails per direction and the user chooses one. That does
 * not fit a 2x2 sheet of 64px buttons on a phone, so the phone gets the
 * one-tap form of the same thing: same IPC (getAdjacentDiscoverCandidates),
 * same candidate, same commit (swapSlotFromNearby), one of them chosen
 * here. See docs/superpowers/specs/2026-09-27-stem-actions-and-phone-1a-
 * design.md §1.4.
 *
 * Generic over `{ stemCID }` so src/shared/ never imports from src/main/,
 * where AdjacentDiscoverCandidate lives. `random` is injected because this
 * repo's react-hooks/purity rule errors on Math.random() inside a
 * component-scoped function, and because a test needs it determined.
 *
 * `older` first, then `newer` -- chronological, matching the popover's own
 * older -> "earlier" / newer -> "later" labelling. Uniform, NOT
 * nearest-first: all four of these actions are randomisers (the desktop row
 * puts a dice icon beside them to say so), and adjacency's value is
 * "something else from that moment in that jam", not "the closest possible
 * thing". Never throws; nothing eligible returns null, and the caller then
 * leaves the slot exactly as it was.
 */
export function pickAdjacentCandidate<T extends { stemCID: string }>(
  older: readonly T[],
  newer: readonly T[],
  anchorStemCID: string,
  random: () => number = Math.random
): T | null {
  const pool = [...older, ...newer].filter((c) => c.stemCID !== anchorStemCID)
  if (pool.length === 0) return null
  const index = Math.min(pool.length - 1, Math.floor(random() * pool.length))
  return pool[index]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shared/discoverAdjacentPick.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/shared/discoverAdjacentPick.ts src/shared/discoverAdjacentPick.test.ts
git commit -m "$(cat <<'EOF'
feat(discover): a pure one-tap pick out of a slot's adjacency window

The phone's `adjacent` is the desktop popover compressed to one tap -- same
ipc, same candidate, same commit, the choice made here so it can be tested
and so Math.random stays out of the component.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

## Task 5: the eighth route, `POST /api/slot-action`

**Files:**
- Modify: `src/main/remoteServer.ts`
- Test: `src/main/remoteServer.test.ts`

- [ ] **Step 1: Make the test harness able to see commands**

In `src/main/remoteServer.test.ts`, add a module-level capture and push into it from `start()`:

```ts
import type { RemoteCommand } from '@shared/remoteState'

const commands: RemoteCommand[] = []
```

In `start()`, replace `onCommand: () => {},` with:

```ts
    onCommand: (command) => {
      commands.push(command)
    },
```

and in the existing `afterEach`, clear it:

```ts
afterEach(() => {
  handle?.stop()
  handle = null
  commands.length = 0
})
```

(The second `onCommand: () => {}` at `:261`, inside the rebinding test, is left alone — that test does not send commands.)

- [ ] **Step 2: Write the failing test**

Append to `src/main/remoteServer.test.ts`:

```ts
/** The eighth route, 2026-09-27. One route with an enumerated action, not
 * five near-identical routes -- and parseRemoteSlotAction is the only thing
 * that decides whether an action is an action at all. */
describe('the slot action route', () => {
  async function pairedToken(port: number, pairingCode: string): Promise<string> {
    const res = await send(
      port,
      '/api/pair',
      { host: `192.168.1.40:${port}`, 'content-type': 'application/json' },
      'POST',
      JSON.stringify({ code: pairingCode })
    )
    return JSON.parse(res.body).token as string
  }

  it('forwards each of the five actions verbatim', async () => {
    const { port, pairingCode } = await start()
    const token = await pairedToken(port, pairingCode)
    for (const action of ['mute', 'similar', 'adjacent', 'random', 'duplicate']) {
      const res = await send(
        port,
        '/api/slot-action',
        {
          host: `192.168.1.40:${port}`,
          'content-type': 'application/json',
          authorization: `Bearer ${token}`
        },
        'POST',
        JSON.stringify({ slotId: 'slot-7', action })
      )
      expect(res.status).toBe(200)
    }
    expect(commands).toEqual([
      { kind: 'slot-action', slotId: 'slot-7', action: 'mute' },
      { kind: 'slot-action', slotId: 'slot-7', action: 'similar' },
      { kind: 'slot-action', slotId: 'slot-7', action: 'adjacent' },
      { kind: 'slot-action', slotId: 'slot-7', action: 'random' },
      { kind: 'slot-action', slotId: 'slot-7', action: 'duplicate' }
    ])
  })

  it('refuses an action it does not know, and forwards nothing', async () => {
    const { port, pairingCode } = await start()
    const token = await pairedToken(port, pairingCode)
    const res = await send(
      port,
      '/api/slot-action',
      {
        host: `192.168.1.40:${port}`,
        'content-type': 'application/json',
        authorization: `Bearer ${token}`
      },
      'POST',
      JSON.stringify({ slotId: 'slot-7', action: 'delete-everything' })
    )
    expect(res.status).toBe(400)
    expect(commands).toEqual([])
  })

  it('refuses an empty slot id', async () => {
    const { port, pairingCode } = await start()
    const token = await pairedToken(port, pairingCode)
    const res = await send(
      port,
      '/api/slot-action',
      {
        host: `192.168.1.40:${port}`,
        'content-type': 'application/json',
        authorization: `Bearer ${token}`
      },
      'POST',
      JSON.stringify({ slotId: '', action: 'mute' })
    )
    expect(res.status).toBe(400)
    expect(commands).toEqual([])
  })

  it('tells an unpaired caller nothing about the route existing', async () => {
    const { port } = await start()
    const res = await send(
      port,
      '/api/slot-action',
      { host: `192.168.1.40:${port}`, 'content-type': 'application/json' },
      'POST',
      JSON.stringify({ slotId: 'slot-7', action: 'mute' })
    )
    expect(res.status).toBe(401)
    expect(commands).toEqual([])
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/main/remoteServer.test.ts`
Expected: FAIL — the four new tests get 401 (the catch-all refusal) instead of 200/400.

- [ ] **Step 4: Write the implementation**

In `src/main/remoteServer.ts`, add `parseRemoteSlotAction` to the existing `@shared/remoteState` import, and insert this block immediately after the `/api/remove-slot` handler and before the catch-all `refuse(...)`:

```ts
      // One route for all five of the phone's per-row actions, 2026-09-27
      // -- four of them are the buttons already on every desktop Discover
      // slot row (similar/adjacent/random/duplicate) and the fifth is its
      // mute. parseRemoteSlotAction is the only thing that decides whether
      // an action is an action: an unknown string fails the whole request
      // rather than being dropped, exactly as an unknown kind does on
      // /api/add-slot, so this route cannot be handed anything
      // path-shaped either. An id the Mac no longer has is a harmless
      // no-op on the renderer's side, so the id is only checked for being
      // a non-empty string, same as /api/remove-slot.
      if (req.method === 'POST' && url === '/api/slot-action') {
        const body = await readJsonBody(req)
        const slotId = typeof body.slotId === 'string' ? body.slotId : ''
        const action = parseRemoteSlotAction(body.action)
        if (slotId === '' || action === null) return respond(res, 400)
        options.onCommand({ kind: 'slot-action', slotId, action })
        return respond(res, 200)
      }
```

- [ ] **Step 5: Update the CSP doc comment in `remotePage.ts`**

`src/main/remotePage.ts`'s `REMOTE_PAGE_CSP` comment says "same-origin fetch for the seven API routes" and "The kind picker added two routes and no new kind of resource, so this is unchanged by it and must stay that way." Change "seven" to "eight" and append: `The slot-action route (2026-09-27) added one more route and, again, no new kind of resource.` **`REMOTE_PAGE_CSP` itself does not change.**

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/main/remoteServer.test.ts`
Expected: PASS. If this file alone fails in a later full run, see the machine note at the top.

- [ ] **Step 7: Commit**

```bash
git add src/main/remoteServer.ts src/main/remoteServer.test.ts src/main/remotePage.ts
git commit -m "$(cat <<'EOF'
feat(remote): POST /api/slot-action, the eighth route

An unknown action fails the whole request rather than being best-guessed,
same rule as the kind picker's own parser.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

## Task 6: the renderer — dispatch, one-tap `adjacent`, and peaks in the push

**Files:**
- Modify: `src/renderer/src/components/DiscoverPanel.tsx`

**No component tests.** Per CLAUDE.md, React components are not unit-tested in this codebase; this task is verified by `npm run typecheck`, `npm run lint`, the full suite staying green, and Elling's manual walkthrough. **Do not claim a row was tapped or a stem was heard.**

- [ ] **Step 1: Add `rollAdjacentForSlot`**

Insert directly **after** `swapSlotFromNearby` (`:1809-1817`), so the two sit together:

```ts
  // The PHONE's one-tap `adjacent` (docs/superpowers/specs/2026-09-27-stem-
  // actions-and-phone-1a-design.md §1.4). The desktop's own `adjacent` is
  // DiscoverNearbyPopover -- a browser -- which does not fit a 2x2 sheet of
  // 64px buttons on a phone. Same IPC, same candidate, same commit
  // (swapSlotFromNearby above, undo snapshot and all); only the choosing is
  // different, and that lives in @shared/discoverAdjacentPick so it can be
  // tested and so Math.random() stays out of this component
  // (react-hooks/purity).
  //
  // Claims a generation BEFORE the await, into the same rerollGenerationRef
  // map pickForSlot and rollRandomForSlot share -- without it, a slower
  // adjacency lookup could land on top of a newer `similar` the user fired
  // afterwards. Does NOT bump setRolledCount: the desktop's popover pick
  // does not either, and the phone's counters should keep meaning what they
  // mean on the Mac.
  async function rollAdjacentForSlot(id: string): Promise<void> {
    const slot = slotsRef.current.find((s) => s.id === id)
    const anchor = slot?.candidate ?? null
    // No anchor is the desktop's "there is no adjacent button at all" state,
    // not an error -- leave the slot exactly as it is.
    if (!slot || !anchor) return
    const myGeneration = (rerollGenerationRef.current.get(id) ?? 0) + 1
    rerollGenerationRef.current.set(id, myGeneration)
    setRerollingSlotIds((prev) => new Set(prev).add(id))
    try {
      const nearby = await window.rifffApi.getAdjacentDiscoverCandidates(
        anchor.riffCID,
        slot.kinds,
        globalRollOptions.soundSource
      )
      if (rerollGenerationRef.current.get(id) !== myGeneration) return
      const pick = pickAdjacentCandidate(nearby.older, nearby.newer, anchor.stemCID)
      // Nothing nearby: the stem that is already playing is still the right
      // stem. Never blank the row.
      if (pick === null) return
      swapSlotFromNearby(id, pick)
    } catch (err) {
      console.error(`DiscoverPanel: rollAdjacentForSlot(${id}) failed:`, err)
    } finally {
      if (rerollGenerationRef.current.get(id) === myGeneration) {
        setRerollingSlotIds((prev) => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
      }
    }
  }
```

Add the import at the top of the file:

```ts
import { pickAdjacentCandidate } from '@shared/discoverAdjacentPick'
```

- [ ] **Step 2: Dispatch the new command**

In the `remoteCommandRef` effect (`:1515-1533`), extend the chain. The existing comment about calling "the EXACT functions this panel's own buttons call" is the reason this is a straight mapping:

```ts
      else if (command.kind === 'remove-slot') removeSlot(command.slotId)
      // The four actions are the four buttons on every desktop slot row --
      // same functions, same undo snapshots, same lack of a lock check
      // (only rerollAll skips a locked slot). mute is the row's own mute
      // button and, like it, is deliberately not undoable. `adjacent` is
      // the one-tap form of the desktop popover; see rollAdjacentForSlot.
      else if (command.kind === 'slot-action') {
        if (command.action === 'mute') toggleSlotPreview(command.slotId)
        else if (command.action === 'similar') void rerollSlot(command.slotId)
        else if (command.action === 'random') void rerollRandomSlot(command.slotId)
        else if (command.action === 'duplicate') duplicateSlot(command.slotId)
        else if (command.action === 'adjacent') void rollAdjacentForSlot(command.slotId)
      }
```

- [ ] **Step 3: Put the peaks into the push**

Add the import:

```ts
import { getPeaks, peekPeaks } from '../audio/peakCache'
```

Add a tick, next to the other push-effect state near `:1480`:

```ts
  // Bumped when a stem's peaks settle AFTER a push has already gone out, so
  // the effect below runs again and the phone's row stops being a flat line.
  // peekPeaks is a synchronous read of peakCache's settled map -- the very
  // same entry this slot's own <Waveform> tiles populate -- so the common
  // case costs a Map.get and the uncommon one costs a cache hit.
  const [remotePeaksTick, setRemotePeaksTick] = useState(0)
```

Replace the push effect (`:1482-1493`) with:

```ts
  useEffect(() => {
    void remotePeaksTick
    const snapshots = buildSlotSnapshots()
    const peaksBySlotId = new Map<string, readonly number[]>()
    let awaiting = false
    for (const snapshot of snapshots) {
      const path = snapshot.stem?.path
      if (path === undefined) continue
      const ready = peekPeaks(path)
      if (ready) peaksBySlotId.set(snapshot.id, ready)
      else awaiting = true
    }
    if (awaiting) {
      // Not a decode of its own in any realistic case -- the row's own
      // <Waveform> is already asking for the same path, and peakCache
      // dedupes by path. A rejection evicts its own entry there, so a
      // transient failure cannot permanently poison a row.
      for (const snapshot of snapshots) {
        const path = snapshot.stem?.path
        if (path === undefined || peekPeaks(path)) continue
        void getPeaks(path)
          .then(() => setRemotePeaksTick((n) => n + 1))
          .catch(() => {})
      }
    }
    void window.rifffApi.setRemoteState(
      remoteStateFromSlots(
        snapshots,
        {
          discoverOpen: true,
          playing,
          kept: keptCount,
          rolled: rolledCount,
          lastKeptName
        },
        peaksBySlotId
      )
    )
  }, [buildSlotSnapshots, playing, keptCount, rolledCount, lastKeptName, remotePeaksTick])
```

`setRemotePeaksTick` is called from a promise callback, not synchronously in the effect body, so `react-hooks/set-state-in-effect` is satisfied without a `void Promise.resolve().then(...)` wrapper.

- [ ] **Step 4: Verify**

```bash
npm run typecheck && npm run lint && npx vitest run
```
Expected: typecheck 0 errors; lint 0 errors and the 4 pre-existing prettier warnings and no more; the suite green at **191 files / 2917 tests** (2901 baseline + 5 Task 1 + 2 Task 2 + 9 Task 3 + 5 Task 4 + 4 Task 5 — note Task 2 modified two existing tests rather than adding them, so count what the runner actually prints and reconcile it against this list rather than asserting a number you did not see).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/DiscoverPanel.tsx
git commit -m "$(cat <<'EOF'
feat(discover): dispatch the phone's slot actions to the desktop's own

similar/random/duplicate/mute call the exact functions the row's buttons
call. adjacent is the popover compressed to one tap, with the same
generation claim every other async roll path takes.

Per-slot peaks join the pushed state, read straight out of peakCache --
the rows already decoded them.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

# Piece 2 — the page

**Everything below rewrites only the app state of `src/main/remotePage.ts`.** The pair screen markup, `remoteNoticePage`, `REMOTE_PAGE_CSP`, `acceptsHtml`, `REMOTE_WRONG_ADDRESS_NOTICE`, `REMOTE_NOTHING_HERE_NOTICE`, the `@font-face` block, the global `*` rule and the entire pairing script are **untouched**.

**Re-read before writing a line of it:** §2.11 and §2.12 of the spec, and `src/main/remotePage.test.ts`. In particular: **no arrow functions, no `??`, no `?.`, and no `preventDefault` anywhere in the script**; no images of any kind; no new colour; `* { border-radius: 0 }` and `touch-action: manipulation` stay global.

---

## Task 7: the 1a shell — top row, status line, bottom-aligned stack, foot

**Files:**
- Modify: `src/main/remotePage.ts`
- Test: `src/main/remotePage.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/main/remotePage.test.ts`:

```ts
describe('remotePage layout 1a', () => {
  it('puts the counters up on the eyebrow row instead of on their own line', () => {
    // Four grey lines (eyebrow, h1, counts, kept-name) collapse to two.
    expect(REMOTE_PAGE_HTML).toContain('class="topbar"')
    expect(SCRIPT).toContain("countsEl.textContent = 'kept '")
  })

  it('grows the stack up from the thumb rather than down from the title', () => {
    expect(REMOTE_PAGE_HTML).toContain('min-height: 100dvh')
    expect(REMOTE_PAGE_HTML).toContain('margin-top: auto')
  })

  it('rests the status line on the last kept rifff instead of on nothing', () => {
    expect(SCRIPT).toContain('function restStatus()')
    expect(SCRIPT).toContain("'last kept \\u00b7 '")
  })

  it('keeps the app state free of a second title', () => {
    // `side quest` belongs on the pair screen -- it names the thing you are
    // connecting to. Once connected you are looking at your own loop.
    const h1s = REMOTE_PAGE_HTML.match(/<h1>/g) ?? []
    expect(h1s).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/main/remotePage.test.ts`
Expected: FAIL on all four.

- [ ] **Step 3: Implement the shell**

Markup — replace the app state's first four lines and its foot:

```html
  <div id="app" hidden>
    <div class="topbar">
      <span class="eyebrow">sssketch</span>
      <span class="eyebrow" id="counts">kept 0 · rolled 0</span>
    </div>
    <div class="msg" id="msg"></div>
    <div class="empty" id="empty" hidden>pick what you want below, then add it</div>
    <div class="rows" id="rows"><div class="line" id="line" hidden></div></div>
    ...
    <div class="eyebrow foot" id="mac"></div>
  </div>
```

Delete `<h1>side quest</h1>` and `<div class="kept-name" id="kept-name"></div>` **from the app state only** (the pair screen's own `<h1>` stays). Delete the whole `<div class="track" id="track">…</div>` block (Task 9 removes its script).

CSS — replace `.wrap`, and add:

```css
/* 100vh first as the fallback, then 100dvh: ios safari's collapsing
 * toolbar is precisely what dvh exists for, and a bottom-aligned layout
 * measured against the tall viewport puts the buttons under the chrome. */
.wrap {
  max-width: 420px;
  margin: 0 auto;
  padding: 24px 0 16px;
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
}
.topbar { display: flex; justify-content: space-between; align-items: baseline; }
/* The whole of "bottom-aligned". Everything above this is pushed up; the
 * stack, the new-stem button and the transport sit on the thumb. */
.rows { position: relative; margin: 20px 0 10px; margin-top: auto; }
.foot { text-align: center; margin-top: 12px; }
```

Delete `.kept-name` and `.track` from the stylesheet. Keep `.line` (Task 9 re-points it).

Script:
- delete `var keptNameEl = document.getElementById('kept-name')` and its write in `render`
- add, next to `flash`:

```ts
  // What the status line says when nothing transient is on it. The counters
  // moved up to the eyebrow row, so this line is the only place the last
  // kept name has left to live -- and an empty line under a busy thumb is
  // better than a stale one.
  var lastKept = null
  function restStatus() {
    msgEl.textContent = lastKept ? 'last kept · ' + lastKept : ''
  }
```

- change `flash`'s timeout body from `msgEl.textContent = ''` to `restStatus()`, and its delay from `1400` to `2000`
- in `render`, set `lastKept = state.lastKeptName` and call `restStatus()` wherever the old code cleared `msgEl` to `''`. The "open discover on the mac" branch still overwrites it and must still be cleared by the `if (msgEl.textContent === 'open discover on the mac')` guard, which now calls `restStatus()` instead of assigning `''`.
- in `render`, keep `macEl.textContent = state.playing ? 'mac playing' : ''`. **Do not add a machine or interface name** — see spec §2.10.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/main/remotePage.test.ts`
Expected: the four new tests PASS. Other tests in the file will fail from here until Task 13; that is expected and is fixed there. If you want a clean signal in between, run only the new `describe`: `npx vitest run src/main/remotePage.test.ts -t 'layout 1a'`.

- [ ] **Step 5: Commit**

```bash
git add src/main/remotePage.ts src/main/remotePage.test.ts
git commit -m "$(cat <<'EOF'
feat(remote): layout 1a shell -- two grey lines, a stack that grows up

Counters join the eyebrow row, kept-name and the transient message share
the status line, the mac line moves to the foot, and the whole page is
bottom-aligned so the stack grows toward the thumb.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

## Task 8: the row — `84px | 1fr | 44px`, per-stem waveform, muted treatment

**Files:**
- Modify: `src/main/remotePage.ts`
- Test: `src/main/remotePage.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe('remotePage rows', () => {
  it('lays a row out as label, stem, remove', () => {
    expect(REMOTE_PAGE_HTML).toContain('grid-template-columns: 84px 1fr 44px')
    expect(REMOTE_PAGE_HTML).toContain('min-height: 50px')
  })

  it('draws each stem’s own waveform, from peaks the mac already had', () => {
    expect(SCRIPT).toContain('function drawRowWave(')
    expect(SCRIPT).toContain('slot.peaks')
  })

  it('says muted by taking the colour away, never by dimming it', () => {
    // StemWaveformRow.tsx's "gray means quieter/off": the colour layer is
    // suppressed and the grey one stays at full strength. #6a6a6a is the
    // hand-copied --ra-text-3 that layer is drawn in.
    expect(SCRIPT).toContain("slot.muted ? '#6a6a6a' : (TYPE_COLORS[slot.soundType] || '#6a6a6a')")
    // The whole rule, asserted rather than remembered: mute is the absence
    // of colour. Nothing on this page may express it by fading.
    expect(REMOTE_PAGE_HTML).not.toContain('opacity')
  })

  it('shortens remove to an icon and still needs two taps', () => {
    expect(SCRIPT).toContain("drop.textContent = armed ? 'sure' : 'x'")
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/main/remotePage.test.ts -t 'remotePage rows'`
Expected: FAIL on all four.

- [ ] **Step 3: Implement**

CSS — replace `.slot`, `.row`, `.row .kind`, `.row .name` and `button.drop`:

```css
.row {
  display: grid;
  grid-template-columns: 84px 1fr 44px;
  align-items: center;
  column-gap: 10px;
  min-height: 50px;
  margin-bottom: 6px;
  padding: 0 0 0 10px;
  background: #0a0a0a;
  border: 1px solid #222222;
  color: #ededed;
  /* A 450ms press on text raises ios's selection callout and magnifier.
   * Suppressed here and not in js, because remotePage.test.ts asserts the
   * script never contains preventDefault. */
  -webkit-user-select: none;
  user-select: none;
  -webkit-touch-callout: none;
}
.row:active { background: #161616; }
.row .kind { font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row .stem { min-width: 0; padding: 6px 0; }
.row .name {
  display: block;
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row canvas { display: block; width: 100%; height: 18px; margin-top: 3px; }
button.drop {
  width: 44px;
  height: 48px;
  padding: 0;
  background: transparent;
  border: none;
  border-left: 1px solid #222222;
  color: #6a6a6a;
  font: inherit;
  font-size: 10px;
}
button.drop:active { background: #161616; }
button.drop.armed { background: #ededed; color: #050505; }
```

Script — `renderRows` rebuilds each row as a `<div class="row">` holding three children, and the change key grows:

```ts
  function rowColor(slot) {
    // "gray means quieter/off" (StemWaveformRow.tsx). Mute suppresses the
    // colour; it never dims it. #6a6a6a is --ra-text-3, the exact grey the
    // desktop's always-visible layer is drawn in. A row with no sound type
    // yet has no colour to spend either.
    return slot.muted ? '#6a6a6a' : (TYPE_COLORS[slot.soundType] || '#6a6a6a')
  }

  // One flat colour, once per row, on state change and on resize. Not per
  // frame -- these are static shapes; only the playhead moves.
  function drawRowWave(canvas, peaks, color) {
    var ctx = canvas.getContext ? canvas.getContext('2d') : null
    if (!ctx) return
    var cssW = canvas.clientWidth
    var cssH = canvas.clientHeight
    if (cssW <= 0 || cssH <= 0) return
    var dpr = window.devicePixelRatio || 1
    var w = Math.round(cssW * dpr)
    var h = Math.round(cssH * dpr)
    if (canvas.width !== w) canvas.width = w
    if (canvas.height !== h) canvas.height = h
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cssW, cssH)
    var mid = cssH / 2
    if (!peaks || peaks.length === 0) {
      // Nothing analysed yet: a flat rule, never a faked shape. Same answer
      // the master track used to give when it held no loop.
      ctx.fillStyle = '#222222'
      ctx.fillRect(0, Math.floor(mid), cssW, 1)
      return
    }
    var n = peaks.length
    var room = mid - 1
    ctx.fillStyle = color
    for (var i = 0; i < n; i++) {
      var x = (i * cssW) / n
      var bw = (((i + 1) * cssW) / n) - x - 0.5
      if (bw < 1) bw = 1
      var amp = (peaks[i] / 100) * room
      if (amp < 0.5) amp = 0.5
      ctx.fillRect(x, mid - amp, bw, amp * 2)
    }
  }
```

and inside the existing `lastSlots.forEach(...)`, replacing the old `<button class="row">` construction (the remove button keeps its handler, its arming, its 4-second lapse and `api('/api/remove-slot', { slotId: slot.id })` exactly):

```ts
      var row = document.createElement('div')
      row.className = 'row'
      var color = rowColor(slot)

      var kind = document.createElement('span')
      kind.className = 'kind'
      kind.textContent = slot.kindLabel
      kind.style.color = color

      var stem = document.createElement('span')
      stem.className = 'stem'
      var name = document.createElement('span')
      name.className = 'name'
      name.textContent = slot.stemName || '…'
      var canvas = document.createElement('canvas')
      stem.appendChild(name)
      stem.appendChild(canvas)

      var armed = armedRemoveId === slot.id
      var drop = document.createElement('button')
      drop.className = armed ? 'drop armed' : 'drop'
      drop.textContent = armed ? 'sure' : 'x'
      // ... existing drop click handler, unchanged ...

      row.appendChild(kind)
      row.appendChild(stem)
      row.appendChild(drop)
      rowsEl.appendChild(row)
      // After append, so the canvas has a box to measure.
      drawRowWave(canvas, slot.peaks, color)
      rowCanvases.push({ canvas: canvas, peaks: slot.peaks, color: color })
```

`rowsEl.innerHTML = ''` must not wipe `#line`, which now lives inside `.rows`. Move the playhead element out of the loop by re-appending it after the rebuild (`rowsEl.appendChild(lineEl)`), and reset `rowCanvases = []` at the top of the rebuild.

Redraw on resize: replace the old `window.addEventListener('resize', markWaveDirty)` / `orientationchange` pair with one handler that walks `rowCanvases` and calls `drawRowWave` again.

Finally, the change key must see the new fields or the optimistic mute paint in Task 9 is swallowed:

```ts
    var key = JSON.stringify(lastSlots) + '|' + armedRemoveId
```

already stringifies the whole slot objects, **including `muted` and `peaks`** — leave it exactly as it is, and note in a comment that it now covers both.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/main/remotePage.test.ts -t 'remotePage rows'`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/remotePage.ts src/main/remotePage.test.ts
git commit -m "$(cat <<'EOF'
feat(remote): a row is a label, a stem over its own waveform, and an x

Muted takes the colour away and leaves the shape at full strength --
StemWaveformRow's own "gray means quieter/off", with #6a6a6a standing in
for --ra-text-3. No opacity, no hatch, no badge.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

## Task 9: drop the master waveform, keep the playhead

**Files:**
- Modify: `src/main/remotePage.ts`
- Test: `src/main/remotePage.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe('remotePage without a master waveform', () => {
  it('lets the stack of per-stem shapes be the picture', () => {
    expect(SCRIPT).not.toContain('peaksFromBuffer')
    expect(SCRIPT).not.toContain('wavePeaks')
    expect(REMOTE_PAGE_HTML).not.toContain('id="wave"')
  })

  it('keeps the playhead, because it is the only motion on the page', () => {
    expect(REMOTE_PAGE_HTML).toContain('id="line"')
    expect(REMOTE_PAGE_HTML).toContain('background: #c56164')
    expect(SCRIPT).toContain("lineEl.style.left = (progress * 100) + '%'")
    // An indicator, not a seek. Both guards, as before.
    expect(REMOTE_PAGE_HTML).toContain('pointer-events: none')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/main/remotePage.test.ts -t 'without a master waveform'`
Expected: FAIL — the master-waveform code is still there.

- [ ] **Step 3: Delete, carefully**

Remove from the script: `WAVE_BUCKETS`, `waveCtx`, `wavePeaks`, `wavePeaksLoopId`, `waveDrawnCol`, `waveDirty`, `markWaveDirty`, `peaksFromBuffer`, `setWavePeaks`, `clearWavePeaks`, `drawWave`, `var waveEl = …`, the `setWavePeaks(got.id, buf)` call in `loadLoop`, the `clearWavePeaks()` call in `render`'s closed-Discover branch, and the `loopWasHidden`/`markWaveDirty` bookkeeping in `render`.

`tick()` becomes:

```ts
  // The progress line, driven by the phone's OWN audio clock. Nothing about
  // its position comes from the Mac: no position messages, no clock sync.
  // It spans the slot-row stack now that there is no master waveform to sit
  // over -- and it is still unclickable in two independent ways: .line is
  // pointer-events:none, and no listener of any kind is attached to it. It
  // is an indicator. Do not add a seek.
  function tick() {
    if (srcNode && audioBuffer && audioCtx && audioBuffer.duration > 0) {
      var t = (audioCtx.currentTime - startedAt) % audioBuffer.duration
      lineEl.style.left = ((t / audioBuffer.duration) * 100) + '%'
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
```

`.line` keeps `position: absolute; top: 0; bottom: 0; width: 1px; background: #c56164; pointer-events: none;` and now sits inside `.rows` (which Task 7 gave `position: relative`).

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/main/remotePage.test.ts -t 'without a master waveform'`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/remotePage.ts src/main/remotePage.test.ts
git commit -m "$(cat <<'EOF'
refactor(remote): drop the master waveform, keep the red line

In 1a the stack of per-stem shapes is the picture. The playhead moves to
span the stack -- it is the only motion on the page and it is how you know
the phone is playing.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

## Task 10: tap to mute, long press for the sheet

**Files:**
- Modify: `src/main/remotePage.ts`
- Test: `src/main/remotePage.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe('remotePage row gestures', () => {
  it('opens the menu on a long press and mutes on a short tap', () => {
    expect(SCRIPT).toContain('HOLD_MS = 450')
    expect(SCRIPT).toContain("action: 'mute'")
  })

  it('never lets a fired long press also fire the tap on release', () => {
    expect(SCRIPT).toContain('if (holdFired || holdMoved) return')
  })

  it('cancels the press on a scroll, a leave or a cancel', () => {
    expect(SCRIPT).toContain('SLOP_PX = 10')
    expect(SCRIPT).toContain("row.addEventListener('pointercancel'")
    expect(SCRIPT).toContain("row.addEventListener('pointerleave'")
  })

  it('leaves the x out of both gestures', () => {
    expect(SCRIPT).toContain("e.target.tagName === 'BUTTON'")
  })

  it('guards the haptic rather than calling it bare', () => {
    // ios safari does not implement it at all.
    expect(SCRIPT).toContain('if (navigator.vibrate)')
    expect(SCRIPT).toContain('navigator.vibrate(10)')
  })

  it('paints a mute before the poll can confirm it', () => {
    // The poll is up to 700ms behind. A mute you cannot see land is
    // indistinguishable from a tap that missed.
    expect(SCRIPT).toContain('slot.muted = !slot.muted')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/main/remotePage.test.ts -t 'row gestures'`
Expected: FAIL on all six.

- [ ] **Step 3: Implement**

Add near the top of the row section:

```ts
  // Two gestures on one element, arbitrated exactly. Short tap mutes, long
  // press opens the action sheet. The rules that matter: a fired long press
  // must NOT also fire the tap on release; a scroll must not come back as a
  // mute; and the x inside the row must start neither.
  var HOLD_MS = 450
  var SLOP_PX = 10
  var holdTimer = null
  var holdFired = false
  var holdMoved = false
  var holdX = 0
  var holdY = 0

  function cancelHold() {
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null }
  }

  function buzz() {
    // ios safari does not implement this; some browsers implement it and
    // throw when the document is not focused.
    if (navigator.vibrate) {
      try { navigator.vibrate(10) } catch (e) {}
    }
  }
```

and, inside `renderRows`' per-slot loop, after the row is built:

```ts
      // An unresolved row does neither, matching the desktop's own
      // hasStemToActOn guard on its mute button.
      if (slot.stemName) {
        row.addEventListener('pointerdown', function (e) {
          if (e.target.tagName === 'BUTTON') return
          holdFired = false
          holdMoved = false
          holdX = e.clientX
          holdY = e.clientY
          cancelHold()
          holdTimer = setTimeout(function () {
            holdTimer = null
            holdFired = true
            buzz()
            openActionSheet(slot)
          }, HOLD_MS)
        })
        row.addEventListener('pointermove', function (e) {
          if (holdTimer === null && !holdFired) return
          var dx = e.clientX - holdX
          var dy = e.clientY - holdY
          if (dx < 0) dx = -dx
          if (dy < 0) dy = -dy
          if (dx > SLOP_PX || dy > SLOP_PX) { holdMoved = true; cancelHold() }
        })
        row.addEventListener('pointercancel', function () { holdMoved = true; cancelHold() })
        row.addEventListener('pointerleave', function () { holdMoved = true; cancelHold() })
        row.addEventListener('pointerup', function (e) {
          cancelHold()
          if (e.target.tagName === 'BUTTON') return
          if (holdFired || holdMoved) return
          disarmRemove()
          // Optimistic: the poll is up to 700ms behind and the row must
          // answer the thumb now. The next poll overwrites it either way.
          slot.muted = !slot.muted
          renderRows()
          api('/api/slot-action', { slotId: slot.id, action: 'mute' })
        })
      }
```

**The row gets no `click` listener.** The old `<button class="row">` rolled the slot on click; that is gone — rolling a single slot is now `similar` in the action sheet, which is what the desktop's button of that name does anyway.

`openActionSheet` is defined in Task 12; add a forward `function openActionSheet(slot) {}` stub here if you want Task 10 to run standalone, and replace it there.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/main/remotePage.test.ts -t 'row gestures'`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/remotePage.ts src/main/remotePage.test.ts
git commit -m "$(cat <<'EOF'
feat(remote): short tap mutes a row, long press opens its menu

450ms, 10px of slop, and a release after a fired press does nothing. The
mute paints before the poll can confirm it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

## Task 11: `new stem`, and the kind picker as a bottom sheet

**Files:**
- Modify: `src/main/remotePage.ts`
- Test: `src/main/remotePage.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe('remotePage bottom sheets', () => {
  it('has one sheet treatment, used by both sheets', () => {
    expect(REMOTE_PAGE_HTML).toContain('rgba(5,5,5,0.72)')
    expect(REMOTE_PAGE_HTML).toContain('border-top: 1px solid #3a3a3a')
  })

  it('makes new stem the one lit control on the page', () => {
    expect(REMOTE_PAGE_HTML).toContain('id="new-stem"')
    expect(REMOTE_PAGE_HTML).toContain('height: 120px')
    expect(REMOTE_PAGE_HTML).toContain('border: 1px solid #ededed')
  })

  it('splits the chips into what it is and what it feels like', () => {
    expect(REMOTE_PAGE_HTML).toContain('what kind')
    expect(REMOTE_PAGE_HTML).toContain('what it feels like')
  })

  it('still changes a selection only by a table lookup', () => {
    // Unchanged from before the rewrite, and the reason the phone's picker
    // IS the mac's picker.
    expect(SCRIPT).toContain('pendingMask = KIND_TOGGLE[pendingMask][index]')
    const writes = SCRIPT.match(/pendingMask = /g) ?? []
    expect(writes).toHaveLength(3)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/main/remotePage.test.ts -t 'bottom sheets'`
Expected: FAIL on the first three.

- [ ] **Step 3: Implement**

CSS, one treatment shared by both sheets:

```css
.sheet-bg {
  position: fixed;
  inset: 0;
  background: rgba(5,5,5,0.72);
}
.sheet {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 16px 16px calc(16px + env(safe-area-inset-bottom, 0px));
  background: #0a0a0a;
  border-top: 1px solid #3a3a3a;
}
.sheet .eyebrow { margin-top: 10px; }
.sheet .eyebrow:first-child { margin-top: 0; }
/* The one lit control on the page. In a typeface with no bold, an #ededed
 * border IS the hierarchy -- so nothing else may take one. */
button.lit {
  width: 100%;
  height: 120px;
  background: transparent;
  border: 1px solid #ededed;
  color: #ededed;
  font: inherit;
  font-size: 13px;
}
button.lit:active { background: #ededed; color: #050505; }
```

Markup — replace the old `.picker` block with the button, and put the sheet at the end of `#app`:

```html
    <button class="lit" id="new-stem">new stem</button>
    <div id="loop" hidden>
      <div class="actions">
        <button class="big" id="play">play</button>
        <button class="big keep" id="keep"><span class="fill" id="keep-fill"></span><span class="keep-label">keep</span><span class="hint">hold</span></button>
        <button class="big" id="roll-all">roll all</button>
      </div>
    </div>
    <div class="eyebrow foot" id="mac"></div>

    <div id="kind-sheet" hidden>
      <div class="sheet-bg" id="kind-sheet-bg"></div>
      <div class="sheet">
        <div class="eyebrow">what kind</div>
        <div class="chips" id="chips-mask"></div>
        <div class="eyebrow">what it feels like</div>
        <div class="chips trait" id="chips-trait"></div>
        <div class="actions">
          <button class="big dim" id="kind-cancel">never mind</button>
          <button class="big dim" id="add-slot">add slot</button>
        </div>
      </div>
    </div>
```

Script:
- delete `pickerOpen`, `pickerHasSlots`, `paintPicker`, `pickerToggleEl`/`pickerToggleRowEl`/`pickerBodyEl`/`pickerEl` and their listener
- add `function openKindSheet() { kindSheetEl.hidden = false }` and `function closeKindSheet() { kindSheetEl.hidden = true }`; wire `new-stem` → `openKindSheet`, and `kind-cancel` and `kind-sheet-bg` → `closeKindSheet` (`never mind` does **not** clear the selection — closing a sheet is not discarding a choice)
- the `add-slot` handler keeps `if (kinds.length === 0) return`, `api('/api/add-slot', { kinds: kinds })`, `pendingMask = 0`, `paintChips()` and `flash('adding')`; replace the two `pickerOpen`/`paintPicker` lines with `closeKindSheet()`
- in `render`, delete the `pickerEl.hidden` / `pickerHasSlots` / `paintPicker()` lines; keep `emptyEl.hidden = state.slots.length > 0` and `loopEl.hidden = state.slots.length === 0`; add `closeKindSheet()` to the closed-Discover branch

**Three `pendingMask = ` writes, no more** — the declaration, the `KIND_TOGGLE` lookup and the clear after an add. Do not add one for `never mind`.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/main/remotePage.test.ts -t 'bottom sheets'`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/remotePage.ts src/main/remotePage.test.ts
git commit -m "$(cat <<'EOF'
feat(remote): a 120px new stem button, and the chooser as a bottom sheet

The chooser stops living in the page. The selection still changes only by
a KIND_TOGGLE lookup, so the phone's picker is still the mac's by
construction.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

## Task 12: the three-up row, and hold-to-keep

**Files:**
- Modify: `src/main/remotePage.ts`
- Test: `src/main/remotePage.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe('remotePage hold to keep', () => {
  it('takes 700ms of thumb, not a tap', () => {
    expect(SCRIPT).toContain('KEEP_MS = 700')
    expect(SCRIPT).toContain("api('/api/keep', {})")
  })

  it('sweeps an inversion, not a colour', () => {
    expect(REMOTE_PAGE_HTML).toContain('mix-blend-mode: difference')
    expect(REMOTE_PAGE_HTML).toContain('isolation: isolate')
    expect(REMOTE_PAGE_HTML).toContain('transition: width 700ms linear')
  })

  it('says how to use it, in one word', () => {
    expect(REMOTE_PAGE_HTML).toContain('>hold</span>')
  })

  it('abandons the hold on a lift, a leave or a cancel', () => {
    expect(SCRIPT).toContain('function cancelKeep()')
  })

  it('keeps the transport three-up and 52px', () => {
    expect(REMOTE_PAGE_HTML).toContain('height: 52px')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/main/remotePage.test.ts -t 'hold to keep'`
Expected: FAIL on all five.

- [ ] **Step 3: Implement**

CSS:

```css
.actions { display: flex; gap: 8px; margin-top: 8px; }
button.big {
  flex: 1;
  height: 52px;
  padding: 0 8px;
  background: transparent;
  border: 1px solid #3a3a3a;
  color: #ededed;
  font: inherit;
  font-size: 12px;
}
button.big:active { background: #161616; }
button.big.on { background: #ededed; color: #050505; }
button.big.dim { border-color: #222222; color: #5a5a5a; }
/* isolation scopes the blend to this button, so the fill inverts the label
 * and nothing else on the page. */
button.keep { position: relative; overflow: hidden; isolation: isolate; }
button.keep .fill {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 0;
  background: #ededed;
}
button.keep .fill.run { transition: width 700ms linear; }
/* The label is white on black; where the white fill passes under it, the
 * difference blend makes it black on white. An inversion, not a colour --
 * #ededed is the page's own text colour. */
button.keep .keep-label,
button.keep .hint {
  position: relative;
  mix-blend-mode: difference;
  color: #ededed;
}
button.keep .hint { font-size: 9px; margin-left: 6px; color: #6a6a6a; }
```

Script:

```ts
  // Keeping is the one thing on this page that feels irreversible, and the
  // thumb doing it is the same thumb tapping rows to mute them. Same
  // arbitration shape as a row's long press, so there is one mental model
  // on the page and not two.
  var KEEP_MS = 700
  var keepTimer = null
  var keepX = 0
  var keepY = 0
  var keepFillEl = document.getElementById('keep-fill')
  var keepEl = document.getElementById('keep')

  function cancelKeep() {
    if (keepTimer) { clearTimeout(keepTimer); keepTimer = null }
    keepFillEl.className = 'fill'
    keepFillEl.style.width = '0'
  }

  keepEl.addEventListener('pointerdown', function (e) {
    keepX = e.clientX
    keepY = e.clientY
    cancelKeep()
    keepFillEl.className = 'fill run'
    keepFillEl.style.width = '100%'
    keepTimer = setTimeout(function () {
      keepTimer = null
      buzz()
      api('/api/keep', {})
      flash('kept')
      cancelKeep()
    }, KEEP_MS)
  })
  keepEl.addEventListener('pointermove', function (e) {
    if (keepTimer === null) return
    var dx = e.clientX - keepX
    var dy = e.clientY - keepY
    if (dx < 0) dx = -dx
    if (dy < 0) dy = -dy
    if (dx > SLOP_PX || dy > SLOP_PX) cancelKeep()
  })
  keepEl.addEventListener('pointerup', cancelKeep)
  keepEl.addEventListener('pointerleave', cancelKeep)
  keepEl.addEventListener('pointercancel', cancelKeep)
```

Delete the old `document.getElementById('keep').addEventListener('click', …)`. `play` and `roll all` keep their existing click handlers verbatim — `play` in particular must stay a plain click handler, because it is the iOS user gesture that is allowed to create the `AudioContext`.

The markup order inside `.actions` is `play` · `keep` · `roll all`, per the design.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/main/remotePage.test.ts -t 'hold to keep'`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/remotePage.ts src/main/remotePage.test.ts
git commit -m "$(cat <<'EOF'
feat(remote): keep is a 700ms hold, with an inversion sweeping under it

The fill is #ededed and the label blends difference over it, so the button
inverts as it fills rather than growing a colour the palette does not have.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

## Task 13: the stem action sheet

**Files:**
- Modify: `src/main/remotePage.ts`
- Test: `src/main/remotePage.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe('remotePage stem action sheet', () => {
  it('offers the four actions the desktop row already has', () => {
    expect(REMOTE_PAGE_HTML).toContain('id="act-sheet"')
    for (const action of ['similar', 'adjacent', 'random', 'duplicate']) {
      expect(SCRIPT).toContain(`"a":"${action}"`)
    }
  })

  it('sends only actions the mac will accept, to the one route', () => {
    const posts = SCRIPT.match(/api\('\/api\/slot-action'[^)]*\)/g) ?? []
    expect(posts).toEqual([
      "api('/api/slot-action', { slotId: slot.id, action: 'mute' })",
      "api('/api/slot-action', { slotId: actSlot.id, action: act.a })"
    ])
  })

  it('lays the four out two by two, at 64px', () => {
    expect(REMOTE_PAGE_HTML).toContain('grid-template-columns: 1fr 1fr')
    expect(REMOTE_PAGE_HTML).toContain('min-height: 64px')
  })

  it('closes when the slot it points at is gone', () => {
    expect(SCRIPT).toContain('if (!actStillThere) closeActionSheet()')
  })

  it('never has two sheets open at once', () => {
    expect(SCRIPT).toContain('closeKindSheet()')
    expect(SCRIPT).toContain('closeActionSheet()')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/main/remotePage.test.ts -t 'stem action sheet'`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add near `KIND_CHIPS`, at module scope in `remotePage.ts` (TypeScript side, interpolated into the script):

```ts
/** The stem action sheet, as data. Four actions, and they are exactly the
 * four buttons that have been on every desktop Discover slot row since
 * 2026-09-20 -- `similar`, `adjacent`, `random`, `duplicate` -- reached from
 * a long press instead of a mouse. `a` is the wire value
 * (RemoteSlotAction, @shared/remoteState), `l` is the two-word-maximum
 * label and `h` is the hint line under it. The hints are what a label of
 * two words cannot say; they are not tooltips and they are not sentences. */
const STEM_ACTIONS = [
  { a: 'similar', l: 'similar', h: 'another like it' },
  { a: 'adjacent', l: 'adjacent', h: 'same jam' },
  { a: 'random', l: 'random', h: 'anything at all' },
  { a: 'duplicate', l: 'duplicate', h: 'one more row' }
]
```

Markup, after the kind sheet:

```html
    <div id="act-sheet" hidden>
      <div class="sheet-bg" id="act-sheet-bg"></div>
      <div class="sheet">
        <div class="eyebrow" id="act-kind"></div>
        <div class="act-name" id="act-name"></div>
        <div class="acts" id="acts"></div>
        <div class="actions">
          <button class="big dim" id="act-cancel">never mind</button>
        </div>
      </div>
    </div>
```

CSS:

```css
.act-name { font-size: 12px; color: #ededed; margin: 2px 0 10px; }
.acts { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
button.act {
  min-height: 64px;
  padding: 8px 6px;
  background: #0a0a0a;
  border: 1px solid #222222;
  color: #ededed;
  font: inherit;
  font-size: 11px;
  text-align: left;
}
button.act:active { background: #161616; }
button.act .h { display: block; margin-top: 4px; font-size: 9px; color: #6a6a6a; }
```

Script:

```ts
  var ACTS = ${JSON.stringify(STEM_ACTIONS)}
  var actSheetEl = document.getElementById('act-sheet')
  var actsEl = document.getElementById('acts')
  var actSlot = null

  function closeActionSheet() {
    actSheetEl.hidden = true
    actSlot = null
  }

  // Every action is offered on every resolved row, including a locked one
  // -- that is what the desktop does: only `roll all` skips a locked slot,
  // and a deliberate per-slot action always wins. `adjacent` is offered
  // even when the mac would find nothing nearby; hiding it would mean
  // shipping a "has a riff anchor" flag to a page that deliberately knows
  // nothing about the library, and an adjacent with nothing nearby simply
  // leaves the row playing what it was already playing.
  function openActionSheet(slot) {
    closeKindSheet()
    actSlot = slot
    document.getElementById('act-kind').textContent = slot.kindLabel
    document.getElementById('act-kind').style.color = rowColor(slot)
    document.getElementById('act-name').textContent = slot.stemName || '…'
    actsEl.innerHTML = ''
    ACTS.forEach(function (act) {
      var b = document.createElement('button')
      b.className = 'act'
      b.appendChild(document.createTextNode(act.l))
      var hint = document.createElement('span')
      hint.className = 'h'
      hint.textContent = act.h
      b.appendChild(hint)
      b.addEventListener('click', function () {
        if (!actSlot) return
        api('/api/slot-action', { slotId: actSlot.id, action: act.a })
        flash(act.a === 'duplicate' ? 'copied' : 'rolling')
        closeActionSheet()
      })
      actsEl.appendChild(b)
    })
    actSheetEl.hidden = false
  }

  document.getElementById('act-cancel').addEventListener('click', closeActionSheet)
  document.getElementById('act-sheet-bg').addEventListener('click', closeActionSheet)
```

and in `openKindSheet`, add `closeActionSheet()` as its first line, so only one sheet is ever open.

In `render`, alongside the existing armed-remove reconciliation:

```ts
    // A slot that vanished from under an open sheet must not leave it
    // pointing at an id the mac no longer has -- same rule as an armed
    // remove.
    if (actSlot !== null) {
      var actStillThere = state.slots.some(function (s) { return s.id === actSlot.id })
      if (!actStillThere) closeActionSheet()
    }
```

and add `closeActionSheet()` to the closed-Discover branch.

Replace the Task 10 `openActionSheet` stub with this real one.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/main/remotePage.test.ts -t 'stem action sheet'`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/remotePage.ts src/main/remotePage.test.ts
git commit -m "$(cat <<'EOF'
feat(remote): the hold menu -- similar, adjacent, random, duplicate

Two by two at 64px, each with the hint line a two-word label cannot carry.
They are the desktop row's own four buttons, reached from a thumb.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

## Task 14: reconcile the old page tests, and verify the whole thing

**Files:**
- Modify: `src/main/remotePage.test.ts`

- [ ] **Step 1: Run the whole page test file and read every failure**

Run: `npx vitest run src/main/remotePage.test.ts`

The failures you should see, and the only changes you may make in response:

1. **`'needs two taps to remove, because the phone has no undo'`** — update
   `expect(SCRIPT).toContain("drop.textContent = armed ? 'sure' : 'remove'")` to
   `"drop.textContent = armed ? 'sure' : 'x'"`. Everything else in that test
   (`if (armedRemoveId === slot.id) {`, the single `api('/api/remove-slot', …)`) must still pass
   unchanged. **If it does not, you broke the remove, not the test.**

2. **`'keeps every button to two words, as asked on 2026-09-26'`** — the runtime list becomes:

```ts
    // The labels swapped in at runtime are here too -- they are buttons the
    // same way. So are the ones inside a button that contains elements: the
    // regex above matches only <button>text</button>, so `keep` (a fill span
    // and two label spans) is invisible to it.
    const runtime = [
      'stop',
      'play',
      'sure',
      'x',
      'keep',
      'hold',
      'similar',
      'adjacent',
      'random',
      'duplicate'
    ]
```

3. **`'shows the picker whenever discover is open, slots or not'`** — rewrite it for the sheet.
   `pickerEl.hidden = false` no longer exists; `new stem` is visible at all times and is the one
   thing you can do with nothing on screen:

```ts
  it('always offers the first add, slots or not', () => {
    // The chooser is a sheet now, so there is no always-visible picker to
    // unhide -- `new stem` is simply never hidden, and it is the one thing
    // you can do with an empty screen.
    expect(SCRIPT).not.toContain('pickerEl.hidden')
    expect(SCRIPT).toContain('emptyEl.hidden = state.slots.length > 0')
    expect(SCRIPT).toContain('loopEl.hidden = state.slots.length === 0')
  })
```

4. **`'invites the first add rather than reporting emptiness'`** — unchanged, and must still pass.
   `pick what you want below, then add it` stays, `no slots` and `nothing here` stay absent.

5. Everything in the `remotePage pairing`, `remotePage kind picker`, `acceptsHtml`,
   `remoteNoticePage` and `remotePage last resort` blocks must pass **completely untouched.** In
   particular `expect(SCRIPT).not.toContain('preventDefault')` and the three `pendingMask = `
   writes. **If either fails, fix the page, not the test.**

- [ ] **Step 2: Add the last two guards**

```ts
describe('remotePage csp reality', () => {
  it('has no image of any kind, because the csp forbids even a data uri', () => {
    expect(REMOTE_PAGE_HTML).not.toContain('<img')
    expect(REMOTE_PAGE_HTML).not.toContain('url(data:image')
    expect(REMOTE_PAGE_HTML).not.toContain('background-image')
  })

  it('stays in the conservative dialect the whole page is written in', () => {
    expect(SCRIPT).not.toContain('=>')
    expect(SCRIPT).not.toContain('??')
    expect(SCRIPT).not.toContain('?.')
  })
})
```

Note: the dialect test is genuinely new — until now it was a convention held by review. If it
fails, **the page is wrong**, not the test. (`?.` will also match a `?` followed by `.` inside a
regex literal or a string; if that produces a false positive, narrow the assertion to the
offending construct rather than deleting the test.)

- [ ] **Step 3: Run the page tests**

Run: `npx vitest run src/main/remotePage.test.ts`
Expected: PASS, every test in the file.

- [ ] **Step 4: Full verification**

```bash
npm run typecheck
npm run lint
npx vitest run
```

Expected:
- typecheck: 0 errors
- lint: 0 errors, exactly the 4 pre-existing prettier warnings
- vitest: 193 files (191 baseline + `remotePeaks.test.ts` + `discoverAdjacentPick.test.ts`), all
  green. **Report the number the runner actually prints. Do not assert a count you did not see.**
  If `remoteServer.test.ts` alone fails, re-run it in isolation; if anything in
  `playbackEngineLifecycle`, `liveReschedule`, `pluginScan`, `engineProcess` or `ipc-roundtrip`
  fails, check `ps -M $(pgrep -x coreaudiod) | wc -l` before treating it as a code bug.

- [ ] **Step 5: State what was NOT verified**

In the final report, say plainly: **no part of the phone page was exercised in a browser.** This
environment has no GUI, no touch device and no audio. The gesture arbitration, the haptics, the
hold-to-keep sweep, the per-stem waveforms, the bottom sheets, the mute appearance and every one
of the five actions end-to-end are verified only by the string assertions above, by typecheck and
by lint. **They need Elling's walkthrough on a real iPhone at 390×844, in Safari and in Brave.**

- [ ] **Step 6: Commit**

```bash
git add src/main/remotePage.test.ts
git commit -m "$(cat <<'EOF'
test(remote): reconcile the page tests with layout 1a

x replaces remove, the runtime label list grows the labels the regex
cannot see, the picker assertions follow the chooser into its sheet, and
the dialect and no-images rules are asserted rather than remembered.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

## Self-review against the spec

**Spec coverage.** §1.1 and §1.2 are a report, not work — they need no task. §1.3 → Tasks 1 and 5.
§1.4 → Tasks 4 and 6. §1.5 → Tasks 2, 3 and 6. §2.2 → Task 7. §2.3 → Tasks 7 and 8. §2.4 → Task 8.
§2.5 → Task 9. §2.6 → Task 10. §2.7 → Task 11. §2.8 → Task 12. §2.9 → Task 13. §2.10 → Task 7
(the foot, and the deliberate refusal). §2.11 → asserted in Task 14. §2.12 → Task 14.

**Type consistency.** `RemoteSlotAction` (Task 1) is the type the route parses (Task 5), the
command carries (Task 1) and the renderer switches on (Task 6); `'mute' | 'similar' | 'adjacent' |
'random' | 'duplicate'` is spelled identically in all four places and in `STEM_ACTIONS.a`
(Task 13). `quantiseRemotePeaks` and `REMOTE_PEAK_BUCKETS` (Task 3) are used only there and in
`remoteStateFromSlots`. `pickAdjacentCandidate(older, newer, anchorStemCID, random?)` (Task 4) is
called with exactly that argument order in Task 6. `rowColor(slot)` (Task 8) is reused by
`openActionSheet` (Task 13). `buzz()` and `SLOP_PX` (Task 10) are reused by the keep hold
(Task 12) — Task 12 depends on Task 10 having landed, which the ordering already guarantees.
`closeKindSheet` (Task 11) is called by `openActionSheet` (Task 13) and vice versa; both are
function declarations, so hoisting makes the order in the file irrelevant.

**Known ordering dependency.** Task 10 references `openActionSheet`, which Task 13 defines. The
stub is called out in Task 10 Step 3 so each task can be run and verified on its own.

---

## Not now — the boundary, restated

If it is not in this plan, it is out.

- **No new desktop UI**, no fifth action, no relabel, no reorder of the 15-track slot row.
- **No change to what `similar`, `random` or `duplicate` mean.** Their labels are looser than
  their behaviour in places; reshaping that is its own spec, and doing it inside "put them on the
  phone" would ship Elling a behaviour change he did not ask for, on the surface he uses most.
- **No per-slot gain, lock, solo, favourite, chaos, matching dial, roll filters, undo/redo,
  reclassify or match meter on the phone.**
- **No phone-side kind editing of an existing slot.** Add and remove only.
- **No seek on the playhead.**
- **No machine name or interface name over the wire.**
- **No changes to the pair screen or to the desktop remote modal.**
- **No `native-engine/` changes. No `vitest.config.ts` changes.**
