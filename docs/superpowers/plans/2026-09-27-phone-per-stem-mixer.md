# Phone per-stem mixer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The phone holds each Discover stem as its own decoded buffer and mixes them itself in Web Audio, so **mute and solo are a gain change — instant, no render, no fetch** — and rolling one slot downloads one stem instead of re-rendering and re-downloading the whole mix.

**Architecture:** The Mac serves **one lossless mono 48 kHz ALAC `.m4a` per stem**, transcoded with `afconvert` from `EngineStem.resolvedPath` — which is **already time-stretched to the project tempo** by the existing `src/main/rubberband.ts` path, so there is no new stretch pipeline and **no native-engine change**. Each stem is addressed by a content-derived 16-hex `stemId` looked up in a map main builds; no path ever leaves the Mac. The phone runs **one `AudioBufferSourceNode` per stem through its own `GainNode`**, all measured from **one `origin` on the audio clock that never moves**, so a replacement stem enters at the phrase position everything else is already at.

**Tech Stack:** TypeScript, Electron main/preload/renderer, node `child_process` → `/usr/bin/afconvert`, Web Audio in a hand-written page string, vitest.

**Spec:** `docs/superpowers/specs/2026-09-27-phone-per-stem-mixer-design.md` (2026-09-27). Its settled decisions are not re-opened here: **mono**, **ALAC lossless**, **seam blend and trim on the Mac**, **gain baked into the bytes**, **`/api/loop` stays but is no longer called**, **peaks stay on the Mac**, **no `DiscoverPanel` preview refactor**.

**Baseline (verify on `master` before Task 1):**

```
Test Files  193 passed (193)
     Tests  2974 passed (2974)
```

`npm run typecheck` — 0 errors. `npm run lint` — 0 errors + **4 pre-existing prettier warnings in unrelated files**. Any *new* warning is yours.

---

## Read these before Task 1. Each one is a thing that has already cost a session, here or nearby.

1. **NO `native-engine/` CHANGES. NONE.** Time-stretching in this app is **not** an engine feature — the engine has zero stretch code. It is `src/main/rubberband.ts`, a node-side subprocess wrapper around the rubberband CLI, cached at `<userData>/stretch-cache/<sha1(path::ratio)>.wav`. `buildEngineProject` resolves it ahead of time and writes the result into `EngineStem.resolvedPath` + `EngineStem.durationSec`, which is exactly what this plan serves. **If you conclude an engine change is needed, STOP and report it** — the engine does not hot-reload, and every edit costs a `cmake --build` plus a full Cmd+Q and relaunch.

2. **`EngineStem.resolvedPath` is one of four encodings, and you must not assume.** Stretched → a 16- or 24-bit stereo PCM WAV in `stretch-cache`. Ratio within 0.001 of 1 → `renderStretched` returns the **original path**, which for a LORE stem is an **extensionless Ogg Vorbis** (~97%) or FLAC (~3%), and for a drag-and-dropped import is a `.wav`. `afconvert` reads all four; verified on this machine (`afinfo` on a real cached stem: `File type ID: Oggf`, `2 ch, 48000 Hz, vorb`). **Never branch on the file extension** — LORE stems have none.

3. **`durationSec`, not the file's length, is the loop point.** `StemBufferCache::load` (`native-engine/Source/StemBufferCache.cpp:75`) computes `loopEndSample = round(trueDurationSec * sampleRate)` and blends there, with a comment saying why: a LORE Ogg stem's `durationSec` comes from bars × tempo, not from measuring the audio, and the file is often a few frames longer. Task 1 trims to the same number. Get this wrong and every stem drifts a few frames per cycle.

4. **`ANOTHER AGENT WAS EDITING `src/main/remotePage.ts` AND `src/main/remotePage.test.ts` WHEN THIS PLAN WAS WRITTEN.`** Every line number and every quoted snippet from those two files must be **re-read before you touch them** (Tasks 7-11). The structures this plan relies on — `takeLoop`, `commitSwap`, `pendingSwap`, `SWAP_LEAD`, `swapPeriod`, `SWAP_GRIDS`, `adoptPolledSlots`, `holdingForSwap`, `renderRows`, `drawRowWave`, `nextSlotAction` — were all present at commit `e0abb0e`. If one has moved or been renamed, adapt; do not assume.

5. **THE PAGE'S SCRIPT DIALECT IS ENFORCED BY A TEST AND IT IS NOT NEGOTIABLE.** `remotePage.test.ts`'s `csp reality` and `last resort` blocks assert the embedded `<script>` contains **no `=>`, no `??`, no `?.`, no `preventDefault`**, and that `REMOTE_PAGE_HTML` contains **no `opacity` anywhere — comments included**. Write `var`, `function`, explicit null checks. There is no bundler and no transpile step; what you type is what runs on the phone.

6. **No images, at all, ever.** CSP is `default-src 'none'; …; connect-src 'self'` with no `img-src`. Not even a `data:` URI. Anything pictorial is CSS, text or `<canvas>`.

7. **NO NEW TEST FILE IN THIS PLAN OPENS better-sqlite3, so `vitest.config.ts` IS NOT TOUCHED.** This is checked, not assumed: the two new test files are `src/shared/loopSewPCM16.test.ts` (pure) and `src/main/remoteStemRenderer.test.ts` (mocks only `electron`'s `app.getPath`, spawns only `afconvert`). The existing remote test files are not on the CI exclusion list either, because none of them touch the addon. **If you find yourself adding a test file that opens a database, adding it to that list is a mandatory step** — a stale list broke every release for six weeks with 22 `Worker exited unexpectedly` errors and zero failed tests.

8. **`src/shared/remoteState.ts` is a privacy boundary and `remoteStateFromSlots` is not modified by this plan.** `stemId` is injected in **main**, in `index.ts`'s `getState`, exactly the way `loopId` already is — main computes it from the `EngineProject`, which is full of real filesystem paths and never leaves the main process. Do not add a path, a CID or a filename to anything in `src/shared/remoteState.ts`.

9. **`members` at `DiscoverPanel.tsx:807-815` already carries the slot id.** It is built as `{ id, stem, gain }`, filtered, and then handed to `assembleDiscoverRifff` as `members.map(({ stem, gain }) => ({ stem, gain }))` — same array, same order, and `assembleDiscoverRifff` numbers slots `i + 1` off that order. So `members.map(function (m) { return m.id })` is exactly the slot id per `EngineStem`. **This is the only change `DiscoverPanel.tsx` needs.** Do not refactor `syncPreviewToEngine`; see finding 10.

10. **DO NOT change which slots go into the preview project.** `syncPreviewToEngine(ids)` is called with the **previewing (audible)** set, so a muted slot is not in the `EngineProject` at all and gets no `stemId`. The page handles that by remembering the last `stemId` the Mac named per slot (Task 7's `wantedStemId`). The tidier alternative — include every resolved slot and express mute as `EngineStem.muted` — was considered and rejected in the spec: that function has a documented history of resolution races (`previewingSlotIdsRef` and the `barLengthOverride` both exist because of live-reported bugs), and it would make the Mac's engine decode buffers nobody is listening to.

11. **`stemLine`'s `FIELD` separator is `\x1f` and it is load-bearing.** `phoneLoop.ts` says why: joining with the empty string lets `'/a1' + 2` collide with `'/a' + 12`, which would surface as the phone serving the *wrong audio*, silently. Task 2 factors a function out of `stemLine` and must keep using the same separator.

12. **A gain step on a sounding source is an audible pop.** Every gain change in this plan is a ramp — 15 ms for mute/solo, equal-power curves for the crossfade. The engine has `FadeGain`'s ~3 ms micro-fade for the same reason. "Instant" means 15 ms, not zero.

13. **React components and the phone page are NOT unit-tested in this codebase.** The page's only checks are `.toContain` assertions against the string. This environment has **no GUI and no audio tooling**: you cannot press play, you cannot hear anything, and you must not claim you did. Say so explicitly in every report.

14. **Lint rules that will bite.** Explicit return type on every function, inline ones included. Prettier: `singleQuote: true`, `semi: false`, `printWidth: 100`, `trailingComma: none`. The page string's *contents* are not linted (it is a template literal) but the TypeScript around it is.

## Known limits, accepted on purpose

- **Mono.** Halves memory (61.4 MB at twenty 16-second stems, against 122.9 MB stereo) and halves decode. One constant (`-c 1`) if he wants stereo after hearing it.
- **The gain is baked into the served bytes**, so dragging a slot's gain on the Mac re-renders and re-downloads that one stem. Rare; keeps `stemId` meaning exactly "these bytes".
- **A slot rolled while muted gets no new `stemId` until it is unmuted**, so unmuting it waits for one download. Follows from finding 10.
- **The phone hears the stems dry** — no master chain, no channel plugins, no toolkit. `phoneLoopProject` already strips plugins for a stated reason; this is the same known limit, not a new one.
- **The Mac keeps warming a render engine for `/api/loop`, which nothing calls any more.** Retiring it is the follow-up and is where the tap-to-sound win is; doing it here would remove the only thing to compare against while twelve new parts settle.
- **First load grows** from 2.82 MB to ~7.7 MB at twelve stems. Every roll after it shrinks from 2.82 MB **and an engine render** to ~640 KB and no render.

## File map

| File | Change |
|---|---|
| `src/shared/loopSewPCM16.ts` | **NEW** — `LOOP_SEW_WINDOW_FRAMES`, `sewLoopPCM16` (trim/pad to N frames, scale by gain, equal-power seam blend) |
| `src/shared/loopSewPCM16.test.ts` | **NEW** — full TDD, pure, **not** CI-excluded |
| `src/shared/phoneLoop.ts` | `stemAudioFields` + `phoneStemAudioId` factored out of `stemLine`; `stemLine` keeps calling it |
| `src/shared/phoneLoop.test.ts` | new cases for the new export |
| `src/main/remoteStemRenderer.ts` | **NEW** — the per-stem transcode pipeline, the in-memory byte cache, `stemIdsBySlotId()`, `bytes(stemId)` |
| `src/main/remoteStemRenderer.test.ts` | **NEW** — real `afconvert`, real fixture WAV, **not** CI-excluded |
| `src/shared/remoteState.ts` | `RemoteSlotResponse`; `RemoteStateResponse.slots` narrowed to it |
| `src/shared/remoteState.test.ts` | one case: the boundary function still emits no `stemId` |
| `src/main/remoteServer.ts` | `GET /api/stem?id=`; `stemBytes` option |
| `src/main/remoteServer.test.ts` | route cases incl. malformed id and unknown id |
| `src/main/index.ts` | create/stop the stem renderer; `set-remote-loop` takes `slotIds`; inject `stemId` into `getState` |
| `src/preload/index.ts` | `setRemoteLoop(project, slotIds)` |
| `src/renderer/src/components/DiscoverPanel.tsx` | one call site: pass `members.map(m => m.id)` |
| `src/main/remotePage.ts` | the mixer: N voices on one origin, gain mute/solo, per-stem replacement, the `own loop` chip, budget/eviction/failures, the crossfade chips |
| `src/main/remotePage.test.ts` | the audio assertions, rewritten |

**Nothing else is touched. No file is deleted.** `src/main/remoteLoopRenderer.ts`, `src/shared/buildEngineProject.ts`, `src/main/rubberband.ts`, `vitest.config.ts`, the pair screen, the wrong-address notice page and **everything under `native-engine/`** are NOT in this plan.

## Commands (run from `/Users/nickel/Claudecode/sssketch`)

```bash
npx vitest run src/shared/loopSewPCM16.test.ts    # one file
npm test                                           # full suite
npm run typecheck
npm run lint
npm run dev                                        # manual walkthrough
```

---

# PHASE A — the mixer

Tasks 1-10. **First sound arrives at Task 7; the feature is complete and usable at Task 10.**

---

### Task 1: The trim-and-sew pass

A pure function over a mono 16-bit WAV: trim or pad to an exact frame count, scale by a gain, and blend the seam. It is the port of `native-engine/Source/LoopSewing.cpp`'s `applyLoopSewingBlend` plus `StemBufferCache::load`'s truncation, in one pass, so the two cannot drift.

Works directly on `Int16Array`, not floats: `afconvert` hands us 16-bit and `encodeWavPCM16` would take it back to 16-bit, so a float round trip only adds rounding to samples nobody touched. Untouched samples stay bit-identical this way.

**Files:**
- Create: `src/shared/loopSewPCM16.ts`
- Test: `src/shared/loopSewPCM16.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/shared/loopSewPCM16.test.ts
import { describe, expect, it } from 'vitest'
import { findWavChunks } from './wavChunks'
import { LOOP_SEW_WINDOW_FRAMES, sewLoopPCM16 } from './loopSewPCM16'

/** A mono 16-bit WAV whose Nth frame is `value(n)`. Same header layout as
 * encodeWavPCM16 writes, so the fixture and the subject agree by
 * construction rather than by transcription. */
function monoWav(frames: number, value: (n: number) => number, sampleRate = 48000): Uint8Array {
  const dataSize = frames * 2
  const bytes = new Uint8Array(44 + dataSize)
  const view = new DataView(bytes.buffer)
  const put = (o: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i))
  }
  put(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  put(8, 'WAVE')
  put(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  put(36, 'data')
  view.setUint32(40, dataSize, true)
  for (let n = 0; n < frames; n++) view.setInt16(44 + n * 2, value(n), true)
  return bytes
}

function samplesOf(wav: Uint8Array): Int16Array {
  const { dataOffset, dataSize } = findWavChunks(wav)
  const out = new Int16Array(dataSize / 2)
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(dataOffset + i * 2, true)
  return out
}

describe('sewLoopPCM16 trimming', () => {
  it('cuts a file that is longer than the loop it declares', () => {
    // The real case: a LORE ogg stem's durationSec comes from bars x tempo,
    // and the decoded file is a few frames longer. The engine trims at the
    // metadata duration for exactly this reason (StemBufferCache.cpp:75) and
    // so does this.
    const out = sewLoopPCM16(monoWav(1000, () => 500), 900, 1)
    expect(samplesOf(out)).toHaveLength(900)
  })

  it('pads a file that is shorter, with silence, rather than looping early', () => {
    const out = sewLoopPCM16(monoWav(800, () => 500), 900, 1)
    const samples = samplesOf(out)
    expect(samples).toHaveLength(900)
    expect(samples[899]).toBe(0)
  })

  it('rewrites both size headers so the result is a valid wav', () => {
    const out = sewLoopPCM16(monoWav(1000, () => 500), 900, 1)
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength)
    expect(out.byteLength).toBe(44 + 1800)
    expect(view.getUint32(4, true)).toBe(36 + 1800)
    const { dataSize, sampleRate, numChannels, bitsPerSample } = findWavChunks(out)
    expect(dataSize).toBe(1800)
    expect(sampleRate).toBe(48000)
    expect(numChannels).toBe(1)
    expect(bitsPerSample).toBe(16)
  })
})

describe('sewLoopPCM16 gain', () => {
  it('scales every sample, and clamps rather than wrapping', () => {
    const out = samplesOf(sewLoopPCM16(monoWav(1000, () => 20000), 1000, 2))
    // 40000 does not fit in an int16; it must saturate, not wrap to -25536.
    expect(out[10]).toBe(32767)
  })

  it('leaves unity gain bit-identical away from the seam', () => {
    const out = samplesOf(sewLoopPCM16(monoWav(1000, (n) => n - 500), 1000, 1))
    for (let n = 0; n < 1000 - LOOP_SEW_WINDOW_FRAMES; n++) expect(out[n]).toBe(n - 500)
  })
})

describe('sewLoopPCM16 seam blend', () => {
  it('lands the last frame exactly on the first, so the wrap is continuous', () => {
    // coeff is sqrt(0.5 * (1 - t)) with t = -1 at i = 0, i.e. exactly 1.0 --
    // the last frame BECOMES the first. Ported verbatim from
    // native-engine/Source/LoopSewing.cpp.
    const out = samplesOf(sewLoopPCM16(monoWav(1000, (n) => (n === 0 ? 1000 : 8000)), 1000, 1))
    expect(out[999]).toBe(1000)
  })

  it('touches exactly 128 frames and not one more', () => {
    expect(LOOP_SEW_WINDOW_FRAMES).toBe(128)
    const out = samplesOf(sewLoopPCM16(monoWav(1000, (n) => (n === 0 ? 0 : 8000)), 1000, 1))
    expect(out[1000 - LOOP_SEW_WINDOW_FRAMES - 1]).toBe(8000)
    expect(out[1000 - LOOP_SEW_WINDOW_FRAMES]).not.toBe(8000)
  })

  it('decays monotonically away from the seam', () => {
    const out = samplesOf(sewLoopPCM16(monoWav(1000, (n) => (n === 0 ? 0 : 8000)), 1000, 1))
    for (let i = 1; i < LOOP_SEW_WINDOW_FRAMES; i++) {
      expect(out[999 - i]).toBeGreaterThanOrEqual(out[999 - (i - 1)])
    }
  })

  it('does nothing at all to a loop too short to blend', () => {
    // The engine's own guard: clampedLoopEnd <= windowSize * 2 returns early.
    const out = samplesOf(sewLoopPCM16(monoWav(200, () => 8000), 200, 1))
    for (let n = 0; n < 200; n++) expect(out[n]).toBe(8000)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/shared/loopSewPCM16.test.ts`
Expected: FAIL — `Failed to resolve import "./loopSewPCM16"`.

- [ ] **Step 3: Write the implementation**

```ts
// src/shared/loopSewPCM16.ts
import { findWavChunks } from './wavChunks'

/** 128 frames, ~2.7ms at 48kHz. NOT a number to tune.
 *
 * It is `windowSize`'s default in native-engine/Source/LoopSewing.h, itself
 * a verbatim port of OUROVEON's Stem::applyLoopSewingBlend, and that header
 * records that widening it -- up to 4096, and per-stem adaptive -- was tried
 * and REVERTED: a longer blend suppresses the natural amplitude swing at the
 * end of a bar and reads as a loudness dip rather than as a declick. */
export const LOOP_SEW_WINDOW_FRAMES = 128

/**
 * Takes a MONO 16-bit PCM WAV and returns the audio the phone should loop:
 * trimmed (or silence-padded) to exactly `frames`, scaled by `gain`, and with
 * its last LOOP_SEW_WINDOW_FRAMES blended onto its own first frame so the
 * wrap is continuous.
 *
 * WHY THE TRIM IS NOT OPTIONAL, and why `frames` comes from the caller rather
 * than from the file: a LORE Ogg stem's EngineStem.durationSec is derived
 * from bars x tempo, not measured, and the decoded file is routinely a few
 * frames longer. native-engine/Source/StemBufferCache.cpp:75 computes
 * `loopEndSample = round(trueDurationSec * sampleRate)` and blends THERE for
 * exactly this reason -- blending at the file's own end would declick a seam
 * that is never read, and looping there would drift a few frames per cycle.
 * Trimming here means the phone's `buffer.duration` IS durationSec by
 * construction, so no duration has to travel on the wire and the two ends
 * cannot disagree about where the loop is.
 *
 * Works on Int16 rather than converting to float and back: afconvert hands us
 * 16-bit and the result is re-encoded as 16-bit, so a float round trip would
 * only add rounding error to samples this function never touches. At unity
 * gain every frame outside the blend window is bit-identical.
 */
export function sewLoopPCM16(wav: Uint8Array, frames: number, gain: number): Uint8Array {
  const info = findWavChunks(wav)
  if (info.dataOffset < 0 || info.numChannels !== 1 || info.bitsPerSample !== 16) {
    throw new Error('sewLoopPCM16 expects a mono 16-bit PCM wav')
  }
  const target = Math.max(0, Math.floor(frames))
  const available = Math.floor(info.dataSize / 2)
  const dataSize = target * 2

  const src = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)
  const out = new Uint8Array(44 + dataSize)
  const dst = new DataView(out.buffer)

  const put = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) dst.setUint8(offset + i, text.charCodeAt(i))
  }
  put(0, 'RIFF')
  dst.setUint32(4, 36 + dataSize, true)
  put(8, 'WAVE')
  put(12, 'fmt ')
  dst.setUint32(16, 16, true)
  dst.setUint16(20, 1, true)
  dst.setUint16(22, 1, true)
  dst.setUint32(24, info.sampleRate, true)
  dst.setUint32(28, info.sampleRate * 2, true)
  dst.setUint16(32, 2, true)
  dst.setUint16(34, 16, true)
  put(36, 'data')
  dst.setUint32(40, dataSize, true)

  const samples = new Int16Array(target)
  const copy = Math.min(target, available)
  for (let n = 0; n < copy; n++) {
    samples[n] = clampInt16(src.getInt16(info.dataOffset + n * 2, true) * gain)
  }
  // Anything past `copy` is already 0 -- silence padding, not a wrapped loop.

  // The seam blend, ported from LoopSewing.cpp. coeff is exactly 1.0 at
  // i = 0, so the final frame BECOMES the first; it decays to 0 at the far
  // edge of the window on an equal-power curve.
  if (target > LOOP_SEW_WINDOW_FRAMES * 2) {
    const first = samples[0]
    for (let i = 0; i < LOOP_SEW_WINDOW_FRAMES; i++) {
      const index = target - 1 - i
      const t = -1 + (i / LOOP_SEW_WINDOW_FRAMES) * 2
      const coeff = Math.sqrt(0.5 * (1 - t))
      const value = samples[index]
      samples[index] = clampInt16(value + (first - value) * coeff)
    }
  }

  for (let n = 0; n < target; n++) dst.setInt16(44 + n * 2, samples[n], true)
  return out
}

function clampInt16(value: number): number {
  const rounded = Math.round(value)
  if (rounded > 32767) return 32767
  if (rounded < -32768) return -32768
  return rounded
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run src/shared/loopSewPCM16.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/shared/loopSewPCM16.ts src/shared/loopSewPCM16.test.ts
git commit -m "$(cat <<'EOF'
Trim a stem to its own loop, and sew the seam, in one pass

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

### Task 2: `phoneStemAudioId` — one stem's identity, factored out of the loop's

`phoneLoop.ts`'s `stemLine` already canonicalises everything about a stem that changes what it sounds like. The stem id is a hash of a subset of that, and it is **factored out of `stemLine` rather than written beside it** so the two can never drift apart.

Two exclusions are load-bearing. `muted` is out, because mute is now a phone-side gain and including it would mean a mute triggered a download. The rifff-level `startBar`/`barLength` are out, because they describe where the stem sits in a loop, not what it sounds like.

**Files:**
- Modify: `src/shared/phoneLoop.ts`
- Test: `src/shared/phoneLoop.test.ts`

- [ ] **Step 1: Write the failing test** (append to the existing file)

```ts
describe('phoneStemAudioId', () => {
  function stem(over: Partial<EngineStem> = {}): EngineStem {
    return {
      stemKey: 'group-a::1',
      resolvedPath: '/tmp/stretch-cache/abc.wav',
      durationSec: 4,
      barLength: 2,
      playedBars: 2,
      leftCropBars: 0,
      offsetSteps: 0,
      startBarOverride: -1,
      volume: 1,
      muted: false,
      muteRegions: [],
      oneShot: false,
      trimStartSec: 0,
      trimEndSec: -1,
      ...over
    }
  }

  it('is sixteen hex characters, like the loop id it sits under', () => {
    expect(phoneStemAudioId(stem())).toMatch(/^[0-9a-f]{16}$/)
  })

  it('ignores stemKey, which is a fresh uuid on every rebuild', () => {
    expect(phoneStemAudioId(stem({ stemKey: 'other-group::7' }))).toBe(phoneStemAudioId(stem()))
  })

  it('IGNORES muted, because mute is a gain on the phone and not a download', () => {
    expect(phoneStemAudioId(stem({ muted: true }))).toBe(phoneStemAudioId(stem()))
  })

  it('changes with the resolved path, which is where the stretch lives', () => {
    expect(phoneStemAudioId(stem({ resolvedPath: '/tmp/stretch-cache/def.wav' }))).not.toBe(
      phoneStemAudioId(stem())
    )
  })

  it('changes with the gain, because the gain is baked into the bytes served', () => {
    expect(phoneStemAudioId(stem({ volume: 0.5 }))).not.toBe(phoneStemAudioId(stem()))
  })

  it('changes with the duration, which is where the loop point is', () => {
    expect(phoneStemAudioId(stem({ durationSec: 8 }))).not.toBe(phoneStemAudioId(stem()))
  })

  it('cannot be confused by two fields running together', () => {
    // The whole reason FIELD is \x1f and not ''. '/a1' + 2 must not collide
    // with '/a' + 12.
    const a = phoneStemAudioId(stem({ resolvedPath: '/a1', durationSec: 2 }))
    const b = phoneStemAudioId(stem({ resolvedPath: '/a', durationSec: 12 }))
    expect(a).not.toBe(b)
  })

  it('is still what the loop fingerprint is built from, not a second copy', () => {
    // stemLine must keep CALLING stemAudioFields. If someone reimplements
    // the field list beside it, this catches it.
    expect(stemAudioFields(stem())).toContain('/tmp/stretch-cache/abc.wav')
    expect(stemAudioFields(stem())).not.toContain('group-a::1')
  })
})
```

Add `phoneStemAudioId` and `stemAudioFields` to the file's existing import, and `EngineStem` to the type import.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/shared/phoneLoop.test.ts`
Expected: FAIL — `phoneStemAudioId is not a function`.

- [ ] **Step 3: Implement**

In `src/shared/phoneLoop.ts`, add `import { createHash } from 'node:crypto'` at the top, then insert **above** `stemLine` and rewrite `stemLine` to use it:

```ts
/** Everything about one stem that changes what its own audio sounds like --
 * and nothing that identifies it, places it in a loop, or mixes it.
 *
 * NOT `stemKey`: it embeds the rifff's groupId, which is a fresh
 * crypto.randomUUID() on every rebuild (see assembleDiscoverRifff).
 * NOT `muted`: mute is a gain on the phone now, applied to a buffer it
 * already holds. Including it would mean a mute changed the id, which would
 * mean a download, which is precisely the thing per-stem audio exists to
 * stop.
 * `volume` IS here, because the gain is baked into the bytes the phone is
 * served -- so a gain change is genuinely different audio. */
export function stemAudioFields(stem: EngineStem): string {
  return [
    stem.resolvedPath,
    stem.durationSec,
    stem.barLength,
    stem.volume,
    stem.oneShot ? 1 : 0,
    stem.trimStartSec,
    stem.trimEndSec,
    stem.toolkit === undefined ? '' : JSON.stringify(stem.toolkit)
  ].join(FIELD)
}

/** The 16-character id ONE stem's audio is addressed by, over
 * GET /api/stem?id=. Same length and same derivation style as the loopId
 * above it, one level down.
 *
 * It is a lookup key into a map the main process builds from the loop it is
 * currently holding -- never a path, never concatenated into one, and
 * meaningless to anything that does not already hold that map. That is what
 * lets a per-stem audio route exist at all without widening the boundary
 * src/shared/remoteState.ts IS. */
export function phoneStemAudioId(stem: EngineStem): string {
  return createHash('sha256').update(stemAudioFields(stem)).digest('hex').slice(0, 16)
}
```

And `stemLine` becomes (the field order is unchanged for the fields it keeps; the audio fields now come from the one function):

```ts
function stemLine(startBar: number, barLength: number, stem: EngineStem): string {
  return [
    startBar,
    barLength,
    stemAudioFields(stem),
    stem.playedBars,
    stem.leftCropBars,
    stem.offsetSteps,
    stem.startBarOverride,
    stem.muted ? 1 : 0,
    stem.muteRegions.map((region) => `${region.startBar}-${region.endBar}`).join(',')
  ].join(FIELD)
}
```

- [ ] **Step 4: Run the whole shared suite**

Run: `npx vitest run src/shared/`
Expected: PASS. `phoneLoop.test.ts`'s existing fingerprint cases still pass — the field *set* is unchanged, only its assembly moved. **If an existing fingerprint test asserts an exact string, update it to the new field order and say so in the commit; the loopId changing once is harmless (the phone refetches one loop).**

- [ ] **Step 5: Commit**

```bash
git add src/shared/phoneLoop.ts src/shared/phoneLoop.test.ts
git commit -m "$(cat <<'EOF'
One stem's identity, taken out of the loop's rather than written beside it

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

### Task 3: `remoteStemRenderer` — the Mac's side of the whole feature

Holds the current loop's stems, transcodes each one on demand, caches the bytes in memory, and answers two questions: "what is this slot's stem id" and "give me that stem's bytes".

**Files:**
- Create: `src/main/remoteStemRenderer.ts`
- Test: `src/main/remoteStemRenderer.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/main/remoteStemRenderer.test.ts
import { describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { EngineProject, EngineStem } from '../shared/buildEngineProject'
import { phoneStemAudioId } from '../shared/phoneLoop'

// The same narrow electron stand-in remoteLoopRenderer.test.ts uses, and for
// the same reason: app.getPath('temp') is the only thing the subject needs
// from electron. afconvert is REAL here -- what is under test is bytes an
// iphone has to be able to decode, and a fake would test nothing.
vi.mock('electron', () => ({ app: { getPath: (): string => tmpdir() } }))

import { createRemoteStemRenderer } from './remoteStemRenderer'

const dir = mkdtempSync(join(tmpdir(), 'stem-renderer-'))

/** A real stereo 16-bit 44.1k wav of a constant value, so afconvert has
 * something genuine to downmix and resample. */
function writeStereoWav(path: string, seconds: number): string {
  const rate = 44100
  const frames = Math.round(seconds * rate)
  const dataSize = frames * 4
  const buf = Buffer.alloc(44 + dataSize)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataSize, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(2, 22)
  buf.writeUInt32LE(rate, 24)
  buf.writeUInt32LE(rate * 4, 28)
  buf.writeUInt16LE(4, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(dataSize, 40)
  for (let n = 0; n < frames; n++) {
    const v = Math.round(8000 * Math.sin((n / rate) * 2 * Math.PI * 220))
    buf.writeInt16LE(v, 44 + n * 4)
    buf.writeInt16LE(v, 46 + n * 4)
  }
  writeFileSync(path, buf)
  return path
}

function stemAt(path: string, durationSec: number, over: Partial<EngineStem> = {}): EngineStem {
  return {
    stemKey: `g::${Math.random()}`,
    resolvedPath: path,
    durationSec,
    barLength: 2,
    playedBars: 2,
    leftCropBars: 0,
    offsetSteps: 0,
    startBarOverride: -1,
    volume: 1,
    muted: false,
    muteRegions: [],
    oneShot: false,
    trimStartSec: 0,
    trimEndSec: -1,
    ...over
  }
}

function projectOf(stems: EngineStem[]): EngineProject {
  return {
    bpm: 120,
    snapDiv: 4,
    loopLengthBars: 2,
    rifffs: [{ groupId: 'g', channelId: 'g', startBar: 0, barLength: 2, stems }],
    risers: [],
    masterChain: [
      { pluginId: '', path: '', stateBase64: '' },
      { pluginId: '', path: '', stateBase64: '' },
      { pluginId: '', path: '', stateBase64: '' },
      { pluginId: '', path: '', stateBase64: '' }
    ],
    channelChains: [],
    reverb: { roomSize: 0.5, damping: 0.5, width: 1, wetLevel: 0, dryLevel: 1 }
  } as EngineProject
}

describe('remoteStemRenderer addressing', () => {
  it('names each slot the stem id its own engine stem hashes to', () => {
    const r = createRemoteStemRenderer()
    const a = stemAt('/a.wav', 4)
    const b = stemAt('/b.wav', 4)
    r.setLoop(projectOf([a, b]), ['slot-1', 'slot-2'])
    expect(r.stemIdsBySlotId().get('slot-1')).toBe(phoneStemAudioId(a))
    expect(r.stemIdsBySlotId().get('slot-2')).toBe(phoneStemAudioId(b))
    r.stop()
  })

  it('FAILS CLOSED when the slot ids do not line up with the stems', () => {
    // A mis-paired row -- hearing one stem while looking at another -- is the
    // worst bug this feature can have, so a disagreement drops the whole map
    // rather than guessing at an alignment.
    const r = createRemoteStemRenderer()
    r.setLoop(projectOf([stemAt('/a.wav', 4), stemAt('/b.wav', 4)]), ['slot-1'])
    expect(r.stemIdsBySlotId().size).toBe(0)
    r.stop()
  })

  it('forgets everything when the loop is cleared', () => {
    const r = createRemoteStemRenderer()
    r.setLoop(projectOf([stemAt('/a.wav', 4)]), ['slot-1'])
    r.setLoop(null, [])
    expect(r.stemIdsBySlotId().size).toBe(0)
    r.stop()
  })
})

describe('remoteStemRenderer bytes', () => {
  it('answers null for an id it is not holding', async () => {
    const r = createRemoteStemRenderer()
    r.setLoop(projectOf([stemAt('/a.wav', 4)]), ['slot-1'])
    await expect(r.bytes('0000000000000000')).resolves.toBeNull()
    r.stop()
  })

  it('renders a real stem to mono 48k alac of exactly the declared length', async () => {
    const path = writeStereoWav(join(dir, 'src.wav'), 2)
    const stem = stemAt(path, 2)
    const r = createRemoteStemRenderer()
    r.setLoop(projectOf([stem]), ['slot-1'])
    const bytes = await r.bytes(phoneStemAudioId(stem))
    expect(bytes).not.toBeNull()
    const out = join(dir, 'probe.m4a')
    writeFileSync(out, bytes as Buffer)
    const info = execFileSync('/usr/bin/afinfo', [out]).toString()
    // The three facts the phone depends on, read back off the real file.
    expect(info).toContain('1 ch,  48000 Hz')
    expect(info).toContain('alac')
    // 2.000s at 48000 -- exactly, because sewLoopPCM16 trimmed it there and
    // alac has no encoder priming to add.
    expect(info).toMatch(/audio 96000 valid frames \+ 0 priming/)
    r.stop()
  }, 30_000)

  it('renders each id once and hands the same buffer back', async () => {
    const path = writeStereoWav(join(dir, 'src2.wav'), 1)
    const stem = stemAt(path, 1)
    const r = createRemoteStemRenderer()
    r.setLoop(projectOf([stem]), ['slot-1'])
    const first = await r.bytes(phoneStemAudioId(stem))
    const second = await r.bytes(phoneStemAudioId(stem))
    expect(second).toBe(first)
    r.stop()
  }, 30_000)

  it('leaves no temp file behind', async () => {
    const path = writeStereoWav(join(dir, 'src3.wav'), 1)
    const stem = stemAt(path, 1)
    const r = createRemoteStemRenderer()
    r.setLoop(projectOf([stem]), ['slot-1'])
    await r.bytes(phoneStemAudioId(stem))
    expect(readdirSync(join(tmpdir(), 'sssketch-phone-stems'))).toEqual([])
    r.stop()
  }, 30_000)

  it('keeps a stem that survived a roll, and drops one that did not', async () => {
    const keep = stemAt(writeStereoWav(join(dir, 'keep.wav'), 1), 1)
    const gone = stemAt(writeStereoWav(join(dir, 'gone.wav'), 1), 1)
    const fresh = stemAt(writeStereoWav(join(dir, 'fresh.wav'), 1), 1)
    const r = createRemoteStemRenderer()
    r.setLoop(projectOf([keep, gone]), ['slot-1', 'slot-2'])
    await r.bytes(phoneStemAudioId(keep))
    await r.bytes(phoneStemAudioId(gone))
    r.setLoop(projectOf([keep, fresh]), ['slot-1', 'slot-2'])
    expect(r.cachedIds()).toEqual([phoneStemAudioId(keep)])
    r.stop()
  }, 60_000)

  it('rejects rather than hanging when the source cannot be read', async () => {
    const stem = stemAt(join(dir, 'does-not-exist'), 1)
    const r = createRemoteStemRenderer()
    r.setLoop(projectOf([stem]), ['slot-1'])
    await expect(r.bytes(phoneStemAudioId(stem))).rejects.toThrow()
    r.stop()
  }, 30_000)
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/main/remoteStemRenderer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/main/remoteStemRenderer.ts
import { execFile } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { app } from 'electron'
import type { EngineProject, EngineStem } from '@shared/buildEngineProject'
import { phoneStemAudioId } from '@shared/phoneLoop'
import { sewLoopPCM16 } from '@shared/loopSewPCM16'

const execFileAsync = promisify(execFile)

/** Part of macOS since forever, and this app is macOS-only, ships a vendored
 * rubberband binary it already spawns, and is not sandboxed
 * (build/entitlements.mac.plist carries only the three JIT/dyld keys). */
const AFCONVERT = '/usr/bin/afconvert'

/** 48000 because that is what an iPhone's AudioContext runs at. Material that
 * arrives at the context's own rate is not resampled, so buffer.length on the
 * phone is EXACTLY the frame count encoded here -- which is what makes the
 * loop point exact without any duration travelling on the wire. */
export const PHONE_STEM_SAMPLE_RATE = 48000

/** ONE CHANNEL. Halves both the bytes on the wire and -- the binding
 * constraint -- the float32 an iOS tab holds: 3.07 MB per 16-second stem
 * instead of 6.14, so twenty stems is 61 MB rather than 123. The phone is a
 * judging surface and an iPhone speaker is one driver. Change to 2 and
 * double the memory table if he asks for stereo after hearing it. */
export const PHONE_STEM_CHANNELS = 1

/** ALAC in an .m4a. Lossless, and afinfo reports `0 priming` -- an AAC at
 * a quarter the size reports 2112 priming frames, which is 44ms of silence
 * bolted to the front of every stem if WebKit's decodeAudioData does not
 * apply the container's edit list. Twelve sources sample-locked to one clock
 * cannot take that bet. FLAC measures within 1% and is more universal; ALAC
 * is Apple's codec in Apple's container and every browser on iOS is WebKit,
 * so ALAC is the surer decode on the only client there is.
 *
 * IF A REAL IPHONE CANNOT DECODE IT: this is the one line to change. WAV
 * (`['-f', 'WAVE', '-d', 'LEI16']`, content type 'audio/wav') is guaranteed
 * and costs 2.4x the bytes. */
const OUTPUT_ARGS = ['-f', 'm4af', '-d', 'alac']
export const PHONE_STEM_CONTENT_TYPE = 'audio/mp4'

/** Not nativeExport's ten minutes and not even remoteLoopRenderer's thirty
 * seconds. This is two afconvert passes over a few seconds of audio;
 * anything past ten seconds is a hang, and somebody in another room holding
 * a phone cannot wait it out. */
const TRANSCODE_TIMEOUT_MS = 10_000

interface HeldStem {
  resolvedPath: string
  durationSec: number
  volume: number
}

export interface RemoteStemRenderer {
  /** Discover slot id -> the 16-hex id of the stem in it. Empty when there
   * is no loop, and empty (deliberately) when the slot ids and the engine
   * stems disagree -- see setLoop. */
  stemIdsBySlotId(): ReadonlyMap<string, string>
  /** Replace the held loop, or clear it. `slotIds` must be one id per
   * EngineStem, in the same order. */
  setLoop(project: EngineProject | null, slotIds: readonly string[]): void
  /** The stem's bytes, transcoding if they are not cached. Null when this
   * id is not in the held loop. Rejects when the transcode failed. */
  bytes(stemId: string): Promise<Buffer | null>
  /** Tests only. */
  cachedIds(): string[]
  stop(): void
}

export function createRemoteStemRenderer(): RemoteStemRenderer {
  const dir = join(app.getPath('temp'), 'sssketch-phone-stems')
  // Sweep anything a previous crash left behind.
  rmSync(dir, { recursive: true, force: true })

  let held = new Map<string, HeldStem>()
  let bySlot = new Map<string, string>()
  const cache = new Map<string, Buffer>()
  const inFlight = new Map<string, Promise<Buffer>>()
  let stopped = false

  async function transcode(stemId: string, stem: HeldStem): Promise<Buffer> {
    mkdirSync(dir, { recursive: true })
    const monoPath = join(dir, `${stemId}.mono.wav`)
    const sewnPath = join(dir, `${stemId}.sewn.wav`)
    const outPath = join(dir, `${stemId}.out`)
    try {
      // Pass 1: whatever it is (ogg / flac / wav / a stretch-cache wav) ->
      // mono 16-bit at the phone's own rate. NEVER branch on the extension:
      // a LORE stem's path is a bare StemCID with no extension at all.
      await execFileAsync(
        AFCONVERT,
        [
          '-f',
          'WAVE',
          '-d',
          `LEI16@${PHONE_STEM_SAMPLE_RATE}`,
          '-c',
          String(PHONE_STEM_CHANNELS),
          stem.resolvedPath,
          monoPath
        ],
        { timeout: TRANSCODE_TIMEOUT_MS }
      )
      // Trim to the loop the engine would read, bake the gain, sew the seam.
      const frames = Math.round(stem.durationSec * PHONE_STEM_SAMPLE_RATE)
      writeFileSync(sewnPath, sewLoopPCM16(readFileSync(monoPath), frames, stem.volume))
      // Pass 2: the lossless container the phone decodes.
      await execFileAsync(AFCONVERT, [...OUTPUT_ARGS, sewnPath, outPath], {
        timeout: TRANSCODE_TIMEOUT_MS
      })
      return readFileSync(outPath)
    } finally {
      // The cache holds BYTES, not paths. Nothing this route serves is ever
      // read off disk after this returns, and no temp file outlives the
      // transcode that made it -- a failed pass's partial file included.
      rmSync(monoPath, { force: true })
      rmSync(sewnPath, { force: true })
      rmSync(outPath, { force: true })
    }
  }

  return {
    stemIdsBySlotId: (): ReadonlyMap<string, string> => bySlot,

    setLoop: (project: EngineProject | null, slotIds: readonly string[]): void => {
      if (project === null || stopped) {
        held = new Map()
        bySlot = new Map()
        cache.clear()
        return
      }
      const stems: EngineStem[] = []
      for (const rifff of project.rifffs) for (const stem of rifff.stems) stems.push(stem)

      const nextHeld = new Map<string, HeldStem>()
      const nextBySlot = new Map<string, string>()
      for (let i = 0; i < stems.length; i++) {
        const stem = stems[i]
        const stemId = phoneStemAudioId(stem)
        nextHeld.set(stemId, {
          resolvedPath: stem.resolvedPath,
          durationSec: stem.durationSec,
          volume: stem.volume
        })
        // FAIL CLOSED. A row that says one stem's name while the phone plays
        // another is the worst bug available here, so a length disagreement
        // gives up the whole map rather than pairing by a guess. The audio
        // simply does not appear, which is visible; a mis-pairing is not.
        if (slotIds.length === stems.length) nextBySlot.set(slotIds[i], stemId)
      }
      if (slotIds.length !== stems.length) {
        console.error(
          `remoteStemRenderer: ${slotIds.length} slot ids for ${stems.length} stems, dropping the map`
        )
      }
      held = nextHeld
      bySlot = nextBySlot
      // A roll changes ONE stem. Everything still in the loop keeps its
      // bytes, so eleven of twelve are never re-rendered and never
      // re-downloaded; only what left is dropped.
      for (const id of [...cache.keys()]) if (!held.has(id)) cache.delete(id)
    },

    bytes: async (stemId: string): Promise<Buffer | null> => {
      if (stopped) return null
      const stem = held.get(stemId)
      if (stem === undefined) return null
      const cached = cache.get(stemId)
      if (cached !== undefined) return cached
      const running = inFlight.get(stemId)
      if (running !== undefined) return await running
      const promise = transcode(stemId, stem)
      inFlight.set(stemId, promise)
      try {
        const buffer = await promise
        // Only cache it if the loop still wants it -- a roll can land while
        // afconvert is running, and caching a stem nobody holds would leak.
        if (!stopped && held.has(stemId)) cache.set(stemId, buffer)
        return buffer
      } finally {
        inFlight.delete(stemId)
      }
    },

    cachedIds: (): string[] => [...cache.keys()],

    stop: (): void => {
      stopped = true
      held = new Map()
      bySlot = new Map()
      cache.clear()
      rmSync(dir, { recursive: true, force: true })
    }
  }
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run src/main/remoteStemRenderer.test.ts`
Expected: PASS, 9 tests. The `afinfo` case is the one that matters: `1 ch,  48000 Hz`, `alac`, `audio 96000 valid frames + 0 priming`.

- [ ] **Step 5: Confirm this test file does NOT need the CI exclusion list**

Run: `grep -n "better-sqlite3\|Database" src/main/remoteStemRenderer.ts src/main/remoteStemRenderer.test.ts`
Expected: no output. It mocks only `electron` and spawns only `afconvert`. **Do not add it to `vitest.config.ts`.**

- [ ] **Step 6: Commit**

```bash
git add src/main/remoteStemRenderer.ts src/main/remoteStemRenderer.test.ts
git commit -m "$(cat <<'EOF'
Every stem on its own, mono and lossless, at the tempo it is already in

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

### Task 4: `stemId` on the wire, without touching the boundary function

**Files:**
- Modify: `src/shared/remoteState.ts`
- Test: `src/shared/remoteState.test.ts`

- [ ] **Step 1: Write the failing test** (append)

```ts
describe('remoteStateFromSlots and the stem id', () => {
  it('still emits no stem id of its own, because main injects it', () => {
    // The whole point. This function does not see a resolvedPath and never
    // will; the stem id is derived in main from the EngineProject, exactly
    // the way loopId already is.
    const state = remoteStateFromSlots([snapshot({ id: 'a' })], meta())
    expect(Object.keys(state.slots[0])).not.toContain('stemId')
  })

  it('types a response row as a view plus the id main added', () => {
    const row: RemoteSlotResponse = {
      ...remoteStateFromSlots([snapshot({ id: 'a' })], meta()).slots[0],
      stemId: 'abcdef0123456789'
    }
    expect(row.stemId).toBe('abcdef0123456789')
  })
})
```

(Reuse whatever `snapshot()`/`meta()` helpers the file already has; if it builds them inline, do the same.)

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/shared/remoteState.test.ts`
Expected: FAIL — `RemoteSlotResponse` is not exported.

- [ ] **Step 3: Implement** — in `src/shared/remoteState.ts`, directly above `RemoteStateResponse`:

```ts
/** One row as GET /api/state actually answers it: the view the renderer
 * pushed, plus the id of that slot's own audio.
 *
 * `stemId` is deliberately NOT part of RemoteSlotView and is NOT produced by
 * remoteStateFromSlots -- same reason, and same shape, as loopId one level
 * up. The renderer's boundary function has never seen a resolvedPath and
 * still does not; main derives this from the EngineProject it holds, which
 * is full of real filesystem paths and never leaves the main process.
 *
 * Sixteen hex characters of a sha256 is what leaves. It is a lookup key into
 * a map main built, meaningless to anything that does not hold that map, and
 * GET /api/stem never concatenates it into a path -- so the no-path property
 * remoteState.test.ts asserts stays preserved by construction rather than by
 * care, even though the phone can now fetch audio one stem at a time.
 *
 * Null for a slot the Mac has no audio for right now: unresolved, or muted
 * (a muted slot is not in Discover's preview project at all). The phone
 * reads null as "the Mac is not naming one", never as "throw the audio
 * away" -- see remotePage's wantedStemId. */
export interface RemoteSlotResponse extends RemoteSlotView {
  stemId: string | null
}
```

and narrow the response:

```ts
export interface RemoteStateResponse extends RemoteState {
  loopId: string | null
  slots: RemoteSlotResponse[]
}
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `npx vitest run src/shared/remoteState.test.ts && npm run typecheck`
Expected: tests PASS; typecheck FAILS in `src/main/index.ts` because `getState` no longer returns `RemoteSlotResponse[]`. **That is expected and Task 6 fixes it.** Note it and move on.

- [ ] **Step 5: Commit**

```bash
git add src/shared/remoteState.ts src/shared/remoteState.test.ts
git commit -m "$(cat <<'EOF'
A row can name its own audio without naming a file

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

### Task 5: `GET /api/stem`

**Files:**
- Modify: `src/main/remoteServer.ts`
- Test: `src/main/remoteServer.test.ts`

- [ ] **Step 1: Write the failing test** (append; reuse the file's existing `start`/`pair` helpers)

```ts
describe('GET /api/stem', () => {
  it('refuses an unpaired phone exactly like every other route', async () => {
    const { url, stop } = start({ stemBytes: async () => Buffer.from('x') })
    const res = await fetch(`${url}/api/stem?id=abcdef0123456789`, { headers: { host: HOST } })
    expect(res.status).toBe(401)
    stop()
  })

  it('serves the stem as one lossless file, named by nothing but its id', async () => {
    const bytes = Buffer.from([1, 2, 3, 4])
    const { url, token, stop } = await startPaired({ stemBytes: async () => bytes })
    const res = await fetch(`${url}/api/stem?id=abcdef0123456789`, {
      headers: { host: HOST, authorization: `Bearer ${token}` }
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('audio/mp4')
    expect(Buffer.from(await res.arrayBuffer())).toEqual(bytes)
    stop()
  })

  it('never lets anything path-shaped reach the lookup', async () => {
    // The id is checked against /^[0-9a-f]{16}$/ BEFORE anything looks it up,
    // so a traversal attempt is rejected as a malformed id and the callback
    // is never even called.
    const stemBytes = vi.fn(async () => Buffer.from('x'))
    const { url, token, stop } = await startPaired({ stemBytes })
    for (const id of ['../../etc/passwd', '/tmp/x', 'ABCDEF0123456789', 'abc', '']) {
      const res = await fetch(`${url}/api/stem?id=${encodeURIComponent(id)}`, {
        headers: { host: HOST, authorization: `Bearer ${token}` }
      })
      expect(res.status).toBe(404)
    }
    expect(stemBytes).not.toHaveBeenCalled()
    stop()
  })

  it('answers 404 for a well-formed id the mac is not holding', async () => {
    const { url, token, stop } = await startPaired({ stemBytes: async () => null })
    const res = await fetch(`${url}/api/stem?id=abcdef0123456789`, {
      headers: { host: HOST, authorization: `Bearer ${token}` }
    })
    expect(res.status).toBe(404)
    stop()
  })

  it('answers 503 rather than taking the server down when a transcode throws', async () => {
    const { url, token, stop } = await startPaired({
      stemBytes: async () => {
        throw new Error('afconvert exploded')
      }
    })
    const res = await fetch(`${url}/api/stem?id=abcdef0123456789`, {
      headers: { host: HOST, authorization: `Bearer ${token}` }
    })
    expect(res.status).toBe(503)
    stop()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/main/remoteServer.test.ts`
Expected: FAIL — `stemBytes` is not an option; the route 401s.

- [ ] **Step 3: Implement**

Add to `RemoteServerOptions`, beside `loopWav`:

```ts
  /** One stem's audio bytes for a 16-hex stem id, or null when the Mac is
   * not holding that id. Rejects when the transcode failed -- answered as
   * 503 rather than crashing the server. */
  stemBytes: (stemId: string) => Promise<Buffer | null>
```

Add a module-level constant beside the other helpers:

```ts
/** The ONLY shape GET /api/stem will consider. Checked before anything is
 * looked up, so nothing path-shaped ever reaches a map lookup, let alone a
 * filesystem call -- and the id is a lookup key into a map main built from
 * the loop it is holding, never a fragment of a filename. */
const STEM_ID = /^[0-9a-f]{16}$/
```

and the route, immediately after the `/api/loop` block:

```ts
      // The per-stem audio route, 2026-09-27. Unlike /api/loop it DOES take a
      // parameter, and the parameter is the whole security argument: sixteen
      // lowercase hex characters, tested by STEM_ID before anything else
      // happens, then used as a key into a Map the main process built from
      // the EngineProject it is holding. It is never joined to a path,
      // never opened, and means nothing to anything that does not already
      // hold that map -- so this route serves audio one stem at a time
      // without the surface gaining any way to name a file.
      //
      // A 404 rather than the surface's usual indistinguishable 401 is
      // deliberate and has precedent: /api/add-slot answers 400 for a
      // malformed body, because a PAIRED phone already knows the route
      // exists and there is nothing left to conceal from it.
      //
      // cache-control is the one departure from no-store on this surface.
      // The id is a content hash, so a stale hit is impossible by
      // construction, and it saves re-downloading megabytes over tailscale
      // on a reload. Change it to no-store if that trade stops being worth
      // it; nothing else depends on it.
      if (req.method === 'GET' && url === '/api/stem') {
        const query = new URL(req.url ?? '/', 'http://localhost').searchParams
        const stemId = query.get('id') ?? ''
        if (!STEM_ID.test(stemId)) return respond(res, 404)
        let bytes: Buffer | null
        try {
          bytes = await options.stemBytes(stemId)
        } catch (error) {
          console.error('remoteServer: stem transcode failed:', error)
          return respond(res, 503)
        }
        if (bytes === null) return respond(res, 404)
        res.writeHead(200, {
          'content-type': 'audio/mp4',
          'content-length': String(bytes.length),
          'cache-control': 'private, max-age=3600'
        })
        res.end(bytes)
        return
      }
```

Also extend the function's own doc comment: it says "Seven routes, and no route takes or returns a filesystem path". Make it eight, and add the sentence about `STEM_ID`.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run src/main/remoteServer.test.ts`
Expected: PASS. Existing cases that construct `startRemoteServer` need `stemBytes` added — add `stemBytes: async () => null` to the shared helper's defaults, not to every call site.

- [ ] **Step 5: Commit**

```bash
git add src/main/remoteServer.ts src/main/remoteServer.test.ts
git commit -m "$(cat <<'EOF'
An eighth route that serves audio and still cannot name a file

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

### Task 6: Wire it up — preload, main, and the one line in Discover

**Files:**
- Modify: `src/preload/index.ts:612-613`
- Modify: `src/main/index.ts` (imports, `remoteStems` handle, `startPhoneRemoteOn`, `stopPhoneRemote`, `set-remote-loop`)
- Modify: `src/renderer/src/components/DiscoverPanel.tsx` (three `setRemoteLoop` call sites)

- [ ] **Step 1: Preload takes the slot ids**

```ts
  setRemoteLoop: (project: unknown, slotIds: string[]): Promise<void> =>
    ipcRenderer.invoke('set-remote-loop', project, slotIds),
```

Extend its existing doc comment: the ids travel **in the same call as the project**, deliberately, so main can pair a row to its stem from one snapshot rather than from two pushes that can fall out of step.

- [ ] **Step 2: Main creates, feeds and stops the stem renderer**

Import beside the loop renderer:

```ts
import { createRemoteStemRenderer, type RemoteStemRenderer } from './remoteStemRenderer'
```

Beside `let remoteLoop`:

```ts
let remoteStems: RemoteStemRenderer | null = null
```

In `startPhoneRemoteOn`, beside `remoteLoop ??= createRemoteLoopRenderer()`:

```ts
  // No engine, no spawn, no cold start -- it shells out to afconvert per
  // stem and caches the bytes. Created here only so it dies with the server.
  remoteStems ??= createRemoteStemRenderer()
```

`getState` and the new option:

```ts
    getState: () => {
      // stemId is injected HERE, from main's own map, for the same reason
      // loopId is: remoteStateFromSlots is the privacy boundary and has
      // never seen a resolvedPath. See RemoteSlotResponse.
      const bySlot = remoteStems?.stemIdsBySlotId() ?? new Map<string, string>()
      return {
        ...lastRemoteState,
        loopId: remoteLoop?.currentLoopId() ?? null,
        slots: lastRemoteState.slots.map((slot) => ({
          ...slot,
          stemId: bySlot.get(slot.id) ?? null
        }))
      }
    },
    loopWav: () => remoteLoop?.wav() ?? Promise.resolve(null),
    stemBytes: (stemId: string) => remoteStems?.bytes(stemId) ?? Promise.resolve(null),
```

In `stopPhoneRemote`, beside the loop renderer's teardown:

```ts
  remoteStems?.stop()
  remoteStems = null
```

And the handler:

```ts
  ipcMain.handle('set-remote-loop', (_event, project: EngineProject | null, slotIds: string[]) => {
    // The project is full of real filesystem paths and NEVER leaves the main
    // process. What the phone sees is remoteLoop.currentLoopId() and, per
    // row, remoteStems.stemIdsBySlotId() -- sixteen hex characters each.
    //
    // slotIds rides along rather than arriving in a second call: it is one
    // id per EngineStem, in the same order, taken from the same array in the
    // same render (DiscoverPanel's `members`), so there is no second push to
    // fall out of step with. A length disagreement drops the map entirely.
    remoteLoop?.setLoop(project)
    remoteStems?.setLoop(project, slotIds ?? [])
  })
```

- [ ] **Step 3: Discover passes the ids**

At `DiscoverPanel.tsx:912` (re-read it — another agent may have moved it):

```ts
      // `members` carries each slot's own id and is the SAME array, in the
      // same order, that assembleDiscoverRifff numbered slots 1..N from --
      // so this is exactly one slot id per EngineStem, from one snapshot.
      void window.rifffApi.setRemoteLoop(
        project,
        members.map(function (m) {
          return m.id
        })
      )
```

The three `setRemoteLoop(null)` call sites (around `:817`, `:869`, `:1554` — re-read) become `setRemoteLoop(null, [])`.

- [ ] **Step 4: Typecheck, lint, full suite**

Run: `npm run typecheck && npm run lint && npm test`
Expected: typecheck 0 errors (Task 4's expected failure is now resolved), lint 0 errors + the 4 pre-existing warnings, all tests pass with 2 new files.

- [ ] **Step 5: Commit**

```bash
git add src/preload/index.ts src/main/index.ts src/renderer/src/components/DiscoverPanel.tsx
git commit -m "$(cat <<'EOF'
The slot ids ride with the loop, so a row cannot point at the wrong stem

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

## CHECKPOINT A — STOP HERE AND PROVE THE PHONE CAN DECODE IT

**This is the one assumption in the whole design that, if wrong, takes the feature with it, and it is checked before a single line of page work.**

- [ ] `npm run dev`, open Discover, build a loop of three or four stems, turn the phone remote on in the gear menu, and pair a real iPhone.
- [ ] On the Mac, read a `stemId` out of the state: `curl -s -H "Authorization: Bearer $TOKEN" http://<lan>:7373/api/state | python3 -m json.tool | grep stemId`
- [ ] Fetch one: `curl -s -H "Authorization: Bearer $TOKEN" "http://<lan>:7373/api/stem?id=<id>" -o /tmp/stem.m4a && afinfo /tmp/stem.m4a`
  Expect `1 ch,  48000 Hz`, `alac`, `+ 0 priming`, and a duration that matches the stem.
- [ ] **On the iPhone, in Safari, open that same URL directly.** Safari will offer to play or download it. If it plays, AudioToolbox decodes it and `decodeAudioData` will too. **Do it in Brave as well.**
- [ ] **If it does not play:** change `OUTPUT_ARGS` to `['-f', 'WAVE', '-d', 'LEI16']` and `PHONE_STEM_CONTENT_TYPE` / the route's `content-type` to `audio/wav`, update `remoteStemRenderer.test.ts`'s `afinfo` assertion, and carry on. It costs 2.4× the bytes and nothing else. **Report which one you shipped.**

Nobody on the implementing end can hold a phone. **Do not proceed past this checkpoint on an assumption, and do not claim the probe passed unless Elling ran it.**

---

### Task 7: The page becomes a mixer — N voices on one origin

The big one. It replaces the single-buffer player (`audioBuffer` / `srcNode` / `startedAt` / `takeLoop` / `commitSwap` / `pendingSwap` / `loadLoop` / `barsForLoop`) with a set of voices. **Re-read `src/main/remotePage.ts` and `src/main/remotePage.test.ts` before starting** — another agent was editing both.

At the end of this task the phone plays all the stems and the picture is right. Mute still comes from the poll (Task 8 makes it instant) and a changed stem still cuts in immediately rather than waiting for a boundary (Task 9 fixes that). **The app works at every point.**

**Files:**
- Modify: `src/main/remotePage.ts`
- Modify: `src/main/remotePage.test.ts`

- [ ] **Step 1: Replace the audio section of the page script**

Delete `audioBuffer`, `srcNode`, `startedAt`, `loadedLoopId`, `loadedLoopBars`, `barsForLoop`, `takeLoop`, `commitSwap`, `cancelPendingSwap`, `startSource`, `stopSource`, `loadLoop`, `adoptPolledSlots`, `holdingForSwap`. Put this in their place (keep `swapGrid`, `SWAP_GRIDS`, `SWAP_GRID_KEY`, `paintGridChips` and the chip row exactly as they are):

```js
  // THE PHONE IS THE MIXER. One AudioBufferSourceNode per stem, each through
  // its own GainNode, all measured from ONE instant on the audio clock.
  //
  // `origin` is set once, when playback starts, and NEVER MOVES. That is the
  // whole simplification. The old single-buffer player moved startedAt on
  // every handover because the incoming mix began at its own bar 0 and there
  // was no phase to match it to. Per stem there is: when one voice of twelve
  // is replaced, eleven are still mid-phrase, so the new one enters at the
  // phrase position everything else is already at (see offsetAt). One clock,
  // one origin, and nothing writes to origin after the first start -- which
  // is also why ios suspending the tab cannot desync the stems from each
  // other.
  var audioCtx = null
  var origin = 0
  var haveOrigin = false
  var wantPlaying = false
  // slotId -> { stemId, src, gain, dur }. What is SOUNDING.
  var voices = {}
  // stemId -> AudioBuffer. Survives a stem leaving the mix, because rolling
  // back to it must not cost another download.
  var buffers = {}
  // stemId -> true while its fetch is in flight.
  var fetchingIds = {}
  // stemId -> how many times it has failed. Three strikes and it is left
  // alone until the id changes -- the poll runs every 700ms and an uncounted
  // retry is an infinite download.
  var failedIds = {}
  // slotId -> the last stemId the mac named for that row. NOT cleared when
  // the mac stops naming one: a muted slot is not in discover's preview
  // project at all, so its stemId goes null, and null means "the mac is not
  // naming one right now", never "throw the audio away".
  var wantedStemId = {}
  // How many bars the current set is, off the poll. 0 means not known.
  var loopBars = 0

  var START_LEAD = 0.08
  var SWAP_LEAD = 0.08
  var MAX_STEM_TRIES = 3

  function setPlayLabel() {
    playEl.textContent = wantPlaying ? 'stop' : 'play'
    playEl.className = wantPlaying ? 'big on' : 'big'
  }

  // The phrase length, in seconds. The longest voice spans the whole loop by
  // definition -- loopBars IS the longest resolved stem's bar length -- so
  // this is the loop, derived from the buffers rather than from a tempo. A
  // tempo on the wire would be a second copy of the same fact, free to
  // disagree with it.
  function loopDur() {
    var best = 0
    for (var id in voices) {
      if (voices[id].dur > best) best = voices[id].dur
    }
    return best
  }

  // Where in its own cycle a stem of length `dur` is at time `at`. This one
  // line is what makes a replacement musical rather than merely
  // sample-accurate: the new stem does not start at its own bar 0, it starts
  // where the phrase already is.
  function offsetAt(at, dur) {
    var o = (at - origin) % dur
    if (o < 0) o = o + dur
    return o
  }

  function makeVoice(stemId, buf, at, level) {
    var g = audioCtx.createGain()
    g.gain.setValueAtTime(level, at)
    g.connect(audioCtx.destination)
    var src = audioCtx.createBufferSource()
    src.buffer = buf
    // An AudioBufferSourceNode loops sample-accurately inside the audio
    // graph. loopEnd is the buffer's whole duration because the mac trimmed
    // it to exactly durationSec before encoding -- so the loop point is
    // where the engine would put it, without a number on the wire.
    src.loop = true
    src.loopStart = 0
    src.loopEnd = buf.duration
    src.connect(g)
    src.start(at, offsetAt(at, buf.duration))
    return { stemId: stemId, src: src, gain: g, dur: buf.duration }
  }

  function killVoice(v) {
    if (!v) return
    try { v.src.stop() } catch (e) {}
    try { v.src.disconnect() } catch (e) {}
    try { v.gain.disconnect() } catch (e) {}
  }

  function stopAll() {
    for (var id in voices) killVoice(voices[id])
    voices = {}
    haveOrigin = false
    lineEl.hidden = true
  }

  function levelFor(slotId) {
    var slots = lastSlots
    for (var i = 0; i < slots.length; i++) {
      if (slots[i].id === slotId) return slots[i].muted ? 0 : 1
    }
    return 1
  }

  // Everything the mixer does, in one function, called from the poll and
  // from every landed fetch. It compares what the mac is naming against what
  // is sounding and closes the gap; it is safe to call at any time and does
  // nothing when nothing has changed.
  function reconcile() {
    if (!audioCtx || !wantPlaying) return
    var slotId

    // Rows that are gone take their voice with them.
    for (slotId in voices) {
      if (!wantedStemId[slotId]) {
        killVoice(voices[slotId])
        delete voices[slotId]
      }
    }

    if (!haveOrigin) {
      // Nothing is sounding yet. Start every voice we can, together, at one
      // instant a little way ahead of the clock so nothing is clamped to
      // "as soon as possible".
      var ready = 0
      for (slotId in wantedStemId) {
        if (buffers[wantedStemId[slotId]]) ready = ready + 1
      }
      if (ready === 0) return fetchMissing()
      origin = audioCtx.currentTime + START_LEAD
      haveOrigin = true
      for (slotId in wantedStemId) {
        var first = buffers[wantedStemId[slotId]]
        if (first) voices[slotId] = makeVoice(wantedStemId[slotId], first, origin, levelFor(slotId))
      }
      lineEl.hidden = false
      return fetchMissing()
    }

    // Something is sounding. Bring every other voice up to what the mac
    // names, one row at a time -- ten rows that did not change are not
    // touched, and that is the entire point of this feature.
    for (slotId in wantedStemId) {
      var want = wantedStemId[slotId]
      var buf = buffers[want]
      if (!buf) continue
      var v = voices[slotId]
      if (v && v.stemId === want) continue
      killVoice(v)
      voices[slotId] = makeVoice(want, buf, audioCtx.currentTime + START_LEAD, levelFor(slotId))
    }
    fetchMissing()
  }

  function fetchMissing() {
    for (var slotId in wantedStemId) {
      var id = wantedStemId[slotId]
      if (buffers[id] || fetchingIds[id]) continue
      if (failedIds[id] >= MAX_STEM_TRIES) continue
      fetchStem(id)
    }
  }

  function fetchStem(stemId) {
    fetchingIds[stemId] = true
    fetch('/api/stem?id=' + stemId, { headers: { authorization: 'Bearer ' + token } })
      .then(function (r) {
        if (!r.ok) return null
        return r.arrayBuffer()
      })
      .then(function (bytes) {
        if (!bytes) return null
        return audioCtx.decodeAudioData(bytes).then(function (buf) {
          // Kept whether or not anything still wants it: he may roll back,
          // and it is already paid for. Eviction is the budget's job.
          buffers[stemId] = buf
          delete failedIds[stemId]
          restStatus()
        })
      })
      .catch(function () {
        failedIds[stemId] = (failedIds[stemId] || 0) + 1
      })
      .then(function () {
        delete fetchingIds[stemId]
        reconcile()
      })
  }

  // The progress line, driven by the phone's OWN audio clock and by the one
  // origin every voice shares. Nothing about its position comes from the mac.
  // It no longer jumps back on a roll, because the loop no longer restarts --
  // one stem changed, the phrase did not. Still unclickable in two
  // independent ways: .lane and .line are both pointer-events:none, and no
  // listener of any kind is attached to either. It is an indicator. Do not
  // add a seek.
  function tick() {
    var dur = audioCtx && haveOrigin ? loopDur() : 0
    if (dur > 0) {
      var t = (audioCtx.currentTime - origin) % dur
      if (t < 0) t = t + dur
      lineEl.style.left = ((t / dur) * 100) + '%'
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
```

- [ ] **Step 2: Rewrite `swapPeriod` against the new state** (kept here, used from Task 9)

```js
  function swapPeriod() {
    var dur = loopDur()
    if (!(dur > 0)) return 0
    if (swapGrid === 0) return dur
    var bars = loopBars
    if (!(bars > 0) || bars !== Math.floor(bars)) return dur
    var step = swapGrid
    if (step > bars) step = bars
    while (step > 1 && bars % step !== 0) step = step - 1
    return (dur * step) / bars
  }
```

- [ ] **Step 3: Rewrite the poll's `render(state)` audio half**

Replace the `currentLoopId` / `polledLoopId` / `polledLoopBars` / `loadLoop()` block with:

```js
    loopBars = state.loopBars > 0 ? state.loopBars : 0
    var seen = {}
    for (var i = 0; i < state.slots.length; i++) {
      var s = state.slots[i]
      seen[s.id] = true
      // A null stemId means the mac is not naming one right now -- an
      // unresolved slot, or a muted one (a muted slot is not in discover's
      // preview project at all). Keep whatever this row last had; throwing
      // the audio away would make unmuting cost a download.
      if (s.stemId) wantedStemId[s.id] = s.stemId
    }
    for (var gone in wantedStemId) {
      if (!seen[gone]) delete wantedStemId[gone]
    }
    if (wantPlaying) reconcile()
```

and in the `!state.discoverOpen` teardown, replace the old audio reset with:

```js
      wantedStemId = {}
      buffers = {}
      fetchingIds = {}
      failedIds = {}
      loopBars = 0
      stopAll()
      if (wantPlaying) { wantPlaying = false; setPlayLabel() }
```

`lastSlots = state.slots` becomes unconditional — `holdingForSwap` is gone, and Task 10 puts a per-row version of it back.

- [ ] **Step 4: Rewrite the play button's second half**

```js
    if (audioCtx.state === 'suspended') audioCtx.resume()
    wantPlaying = true
    setPlayLabel()
    reconcile()
```

and the stop branch calls `stopAll()` instead of `stopSource()`.

- [ ] **Step 5: Rewrite the page's audio tests**

Delete `describe('remotePage seamless loop swap')` wholesale — it asserts `takeLoop`/`commitSwap`/`startedAt`, none of which exist. Replace with:

```ts
describe('remotePage per-stem mixer', () => {
  it('gives every stem its own source and its own gain', () => {
    expect(SCRIPT).toContain('function makeVoice(')
    expect(SCRIPT).toContain('audioCtx.createGain()')
    expect(SCRIPT).toContain('audioCtx.createBufferSource()')
    expect(SCRIPT).toContain('src.loop = true')
  })

  it('measures every source from one origin that never moves', () => {
    // The whole simplification: the old player moved startedAt on every
    // handover because the incoming mix began at its own bar 0. Per stem
    // there is a phrase to enter, so there is nothing to reset.
    expect(SCRIPT).toContain('var haveOrigin = false')
    expect(SCRIPT).toContain('origin = audioCtx.currentTime + START_LEAD')
    // Exactly one place writes it, and one place clears the flag.
    const writes = SCRIPT.match(/origin = /g) ?? []
    expect(writes).toHaveLength(2) // the declaration and the one start
  })

  it('enters a stem at the phase the phrase is already at, not at its bar 0', () => {
    expect(SCRIPT).toContain('function offsetAt(at, dur)')
    expect(SCRIPT).toContain('var o = (at - origin) % dur')
    expect(SCRIPT).toContain('src.start(at, offsetAt(at, buf.duration))')
  })

  it('loops each stem at its own length, which is the tiling', () => {
    // A 2-bar hat under an 8-bar pad wraps four times a phrase, in phase,
    // with no arithmetic -- the same thing tileOffsetsPx draws and
    // PlaybackEngine::renderBlock walks.
    expect(SCRIPT).toContain('src.loopEnd = buf.duration')
    expect(SCRIPT).toContain('src.loopStart = 0')
  })

  it('takes the phrase length off the buffers, never off a bpm', () => {
    expect(SCRIPT).toContain('function loopDur()')
    expect(SCRIPT).toContain('return (dur * step) / bars')
    expect(SCRIPT).not.toContain('bpm')
  })

  it('addresses a stem only by the id the mac named, and never by a path', () => {
    const gets = SCRIPT.match(/fetch\('\/api\/stem[^)]*\)/g) ?? []
    expect(gets).toEqual([
      "fetch('/api/stem?id=' + stemId, { headers: { authorization: 'Bearer ' + token } })"
    ])
  })

  it('keeps a stem the mac stopped naming, because a mute is not a delete', () => {
    expect(SCRIPT).toContain('if (s.stemId) wantedStemId[s.id] = s.stemId')
    expect(SCRIPT).toContain('if (!seen[gone]) delete wantedStemId[gone]')
  })

  it('never downloads the same stem twice at once', () => {
    expect(SCRIPT).toContain('if (buffers[id] || fetchingIds[id]) continue')
  })

  it('runs the playhead off the one origin, so a roll no longer resets it', () => {
    expect(SCRIPT).toContain('var t = (audioCtx.currentTime - origin) % dur')
    expect(SCRIPT).toContain('if (t < 0) t = t + dur')
    expect(REMOTE_PAGE_HTML).toContain('pointer-events: none')
  })

  it('no longer fetches the rendered mixdown at all', () => {
    expect(SCRIPT).not.toContain("'/api/loop'")
  })
})
```

Update the surviving `swap grid` cases: `var dur = audioBuffer.duration` becomes `var dur = loopDur()`, and `barsForLoop`/`loadedLoopBars` become `loopBars`.

- [ ] **Step 6: Run the page tests, typecheck and lint**

Run: `npx vitest run src/main/remotePage.test.ts && npm run typecheck && npm run lint`
Expected: PASS, 0, 0 + the 4 pre-existing warnings. **Check the dialect cases specifically** — `csp reality` asserts no `=>`, no `??`, no `?.`; `text selection` asserts no `selectstart`; `rows` asserts no `opacity` **anywhere in `REMOTE_PAGE_HTML`, comments included**.

- [ ] **Step 7: Manual — this is the first time it makes a sound**

`npm run dev`, Discover open with four or five stems, phone paired, press play. Expect every stem audible together and in time, the playhead moving, and a roll bringing the new stem in. **Report honestly that you cannot hear it and that only Elling can judge it.**

- [ ] **Step 8: Commit**

```bash
git add src/main/remotePage.ts src/main/remotePage.test.ts
git commit -m "$(cat <<'EOF'
Twelve sources on one clock, instead of one mixdown on twelve

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

### Task 8: Mute and solo become a gain ramp — the thing he asked for

**Files:** `src/main/remotePage.ts`, `src/main/remotePage.test.ts`

- [ ] **Step 1: Add the ramp**

```js
  // 15ms. "Instant" cannot be zero: a gain STEP on a sounding source is a
  // discontinuity, which is an audible pop -- the engine carries FadeGain's
  // ~3ms micro-fade for the same reason. 15ms is inaudible as a fade and is
  // the difference between a mute and a click.
  var MUTE_RAMP = 0.015

  function setLevel(v, level) {
    if (!v) return
    var now = audioCtx.currentTime
    // cancelScheduledValues first: a crossfade curve may still be running on
    // this param, and a mute you asked for has to win.
    v.gain.gain.cancelScheduledValues(now)
    v.gain.gain.setValueAtTime(v.gain.gain.value, now)
    v.gain.gain.linearRampToValueAtTime(level, now + MUTE_RAMP)
  }

  // The mix, applied to what is sounding. No render, no fetch, no round trip
  // to the mac -- this IS the feature.
  function applyMix() {
    if (!audioCtx) return
    for (var slotId in voices) setLevel(voices[slotId], levelFor(slotId))
  }
```

- [ ] **Step 2: Call it from the tap, before the POST**

The row tap already paints optimistically (`slot.muted = !slot.muted` for mute; `lastSlots[i].muted = lastSlots[i].id !== slot.id` for solo). Add `applyMix()` immediately after each of those blocks, **before** `api('/api/slot-action', ...)`. Also call `applyMix()` at the end of `render(state)` so a mute made on the Mac lands on the phone.

- [ ] **Step 3: Tests**

```ts
describe('remotePage mute is a gain', () => {
  it('changes the sound before the mac has heard about it', () => {
    // "lets make mute and solo happen immediately" -- Elling, 2026-09-27.
    // The gain moves in the tap handler; the POST is only how the mac
    // catches up.
    const handler = (/slot\.muted = !slot\.muted[\s\S]{0,400}/.exec(SCRIPT) ?? [''])[0]
    expect(handler.indexOf('applyMix()')).toBeGreaterThan(-1)
    expect(handler.indexOf('applyMix()')).toBeLessThan(handler.indexOf("api('/api/slot-action'"))
  })

  it('ramps rather than stepping, because a step on a live source pops', () => {
    expect(SCRIPT).toContain('MUTE_RAMP = 0.015')
    expect(SCRIPT).toContain('linearRampToValueAtTime(level, now + MUTE_RAMP)')
    expect(SCRIPT).not.toContain('.gain.value = ')
  })

  it('lets a mute win over a fade that is already running', () => {
    expect(SCRIPT).toContain('v.gain.gain.cancelScheduledValues(now)')
  })

  it('leaves a muted stem sounding silently, so unmuting is free', () => {
    // It is not stopped and its buffer is not dropped, so unmuting is
    // another 15ms ramp and it comes back IN PHASE, because it never left
    // the clock.
    const mix = (/function applyMix\(\)[\s\S]{0,300}/.exec(SCRIPT) ?? [''])[0]
    expect(mix).not.toContain('killVoice')
    expect(mix).not.toContain('delete buffers')
  })

  it('still says muted by taking the colour away, never by dimming', () => {
    expect(SCRIPT).toContain("slot.muted ? '#6a6a6a' : (TYPE_COLORS[slot.soundType] || '#6a6a6a')")
    expect(REMOTE_PAGE_HTML).not.toContain('opacity')
  })
})
```

- [ ] **Step 4: Run, manual, commit**

Run: `npx vitest run src/main/remotePage.test.ts && npm run typecheck && npm run lint`, then `npm run dev` and tap rows on the phone.

```bash
git add src/main/remotePage.ts src/main/remotePage.test.ts
git commit -m "$(cat <<'EOF'
Mute is a gain now, so it happens while your thumb is still on the row

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

### Task 9: A changed stem lands on a boundary, and `own loop` becomes possible

Task 7 cuts a replacement in immediately. This puts it on the grid, per stem, using the same arithmetic the whole-mix handover used — and adds the chip that per-stem makes newly meaningful.

**Files:** `src/main/remotePage.ts`, `src/main/remotePage.test.ts`

- [ ] **Step 1: Add the pending-replacement machinery**

```js
  // slotId -> { stemId, src, gain, dur, at }. A replacement already
  // scheduled: its source has start(at) called with at still in the future,
  // and the voice it replaces has stop(at) called on the same instant.
  var pending = {}

  function cancelPending(slotId) {
    var p = pending[slotId]
    if (!p) return
    try { p.src.stop() } catch (e) {}
    try { p.src.disconnect() } catch (e) {}
    try { p.gain.disconnect() } catch (e) {}
    delete pending[slotId]
  }

  // HOW OFTEN THIS VOICE OFFERS A HANDOVER. Global for every setting but
  // one: `own loop` is the stem's own cycle, which is the boundary per-stem
  // replacement finally makes available -- without it a 2-bar hat rolled at
  // bar one of an 8-bar loop waits four times longer than it needs to.
  function periodFor(v) {
    if (swapGrid === -1) return v.dur > 0 ? v.dur : loopDur()
    return swapPeriod()
  }

  function scheduleReplace(slotId, stemId, buf) {
    var v = voices[slotId]
    var period = periodFor(v)
    if (!(period > 0)) return
    var now = audioCtx.currentTime
    var at = origin + Math.ceil((now - origin) / period) * period
    // Too close to schedule honestly -- start(t) and stop(t) with a t inside
    // the block the audio thread is rendering are clamped to "as soon as
    // possible", which is the mid-bar cut this exists to avoid. Take the
    // next boundary instead; one more cycle of the old stem is the price,
    // and nobody can hear a change that did not happen yet.
    if (at - now < SWAP_LEAD) at = at + period
    var p = pending[slotId]
    if (p) {
      // A third stem for this row arriving before the second has started.
      // Replacing it is clean only at the same instant, because the playing
      // voice's stop is already scheduled for p.at and re-scheduling a stop
      // that is about to fire has no honest answer. The boundary can only
      // have moved if we are inside SWAP_LEAD, so this one is dropped;
      // wantedStemId is unchanged, so the next reconcile asks again.
      if (p.at !== at) return
      cancelPending(slotId)
    }
    var next = makeVoice(stemId, buf, at, levelFor(slotId))
    v.src.stop(at)
    // The old source ending IS the boundary, reported by the audio system
    // rather than guessed at by a second clock that could drift from it.
    v.src.onended = function () { commitReplace(slotId, at) }
    pending[slotId] = { stemId: next.stemId, src: next.src, gain: next.gain, dur: next.dur, at: at }
  }

  function commitReplace(slotId, at) {
    var p = pending[slotId]
    if (!p || p.at !== at) return
    delete pending[slotId]
    var old = voices[slotId]
    if (old) {
      old.src.onended = null
      try { old.src.disconnect() } catch (e) {}
      try { old.gain.disconnect() } catch (e) {}
    }
    voices[slotId] = { stemId: p.stemId, src: p.src, gain: p.gain, dur: p.dur }
    renderRows()
  }
```

- [ ] **Step 2: Route `reconcile`'s replacement branch through it**

The sounding branch becomes:

```js
    for (slotId in wantedStemId) {
      var want = wantedStemId[slotId]
      var buf = buffers[want]
      if (!buf) continue
      var v = voices[slotId]
      if (!v) {
        // A row that joined mid-phrase -- a new slot, or a fetch that took
        // its time. It enters on a boundary too, at the phrase's phase.
        var period = swapPeriod()
        if (!(period > 0)) continue
        var now = audioCtx.currentTime
        var at = origin + Math.ceil((now - origin) / period) * period
        if (at - now < SWAP_LEAD) at = at + period
        voices[slotId] = makeVoice(want, buf, at, levelFor(slotId))
        continue
      }
      if (v.stemId === want) continue
      if (pending[slotId] && pending[slotId].stemId === want) continue
      scheduleReplace(slotId, want, buf)
    }
```

`killVoice` for a vanished row and `stopAll` both call `cancelPending` first — a scheduled replacement is part of what is playing, and left alone it would start into a stopped transport and commit itself through `onended`.

- [ ] **Step 3: Add the `own loop` chip**

```js
  // FIVE options now. `own loop` is what per-stem replacement made possible:
  // the most musical boundary for a stem changing under eleven others is its
  // own cycle. The default stays 0 -- his phone already has a value stored
  // under SWAP_GRID_KEY and a default that changed under him would be a
  // surprise -- but this is the one to try first.
  var SWAP_GRIDS = [
    { g: -1, l: 'own loop' },
    { g: 0, l: 'loop end' },
    { g: 8, l: '8 bars' },
    { g: 4, l: '4 bars' },
    { g: 2, l: '2 bars' }
  ]
```

Five at `flex: 1 1 0` in the 390px column is ~68px each; `min-height: 42px` is unchanged and still the tap floor. The stored-value read already matches against the options table rather than parsing, so `-1` round-trips with no other change.

- [ ] **Step 4: Tests**

```ts
describe('remotePage per-stem handover', () => {
  it('lands a changed stem on a boundary, against the one origin', () => {
    expect(SCRIPT).toContain('var at = origin + Math.ceil((now - origin) / period) * period')
    expect(SCRIPT).toContain('if (at - now < SWAP_LEAD) at = at + period')
    expect(SCRIPT).toContain('SWAP_LEAD = 0.08')
    expect(SCRIPT).toContain('v.src.stop(at)')
  })

  it('moves ONE row, and leaves the other eleven sounding', () => {
    // The whole reason for per-stem. scheduleReplace is keyed by slotId and
    // touches nothing else.
    expect(SCRIPT).toContain('function scheduleReplace(slotId, stemId, buf)')
    expect(SCRIPT).toContain('function commitReplace(slotId, at)')
    expect(SCRIPT).not.toContain('function commitSwap(')
  })

  it('never leaves a scheduled replacement behind it', () => {
    expect(SCRIPT).toContain('function cancelPending(slotId)')
    expect(SCRIPT).toContain('if (p.at !== at) return')
    expect(SCRIPT).toContain('old.src.onended = null')
  })

  it('offers own loop, loop end and three bar counts, and nothing else', () => {
    expect(SCRIPT).toContain("{ g: -1, l: 'own loop' }")
    expect(SCRIPT).toContain("{ g: 0, l: 'loop end' }")
    expect(SCRIPT).toContain("{ g: 8, l: '8 bars' }")
    expect(SCRIPT).toContain("{ g: 4, l: '4 bars' }")
    expect(SCRIPT).toContain("{ g: 2, l: '2 bars' }")
    const options = SCRIPT.match(/\{ g: -?\d+, l: '/g) ?? []
    expect(options).toHaveLength(5)
  })

  it('gives own loop the stem its own cycle, and everything else the grid', () => {
    expect(SCRIPT).toContain('function periodFor(v)')
    expect(SCRIPT).toContain('if (swapGrid === -1) return v.dur > 0 ? v.dur : loopDur()')
  })

  it('still starts on loop end and still keeps the setting on the phone', () => {
    expect(SCRIPT).toContain('var swapGrid = 0')
    expect(SCRIPT).toContain("SWAP_GRID_KEY = 'sssketch-remote-swap-grid'")
    const posts = SCRIPT.match(/api\('\/api\/[a-z-]+'/g) ?? []
    expect(posts).not.toContain("api('/api/swap-grid'")
  })
})
```

Also update `it('keeps every button to two words')`'s `runtime` list with `'own loop'`.

- [ ] **Step 5: Run, manual, commit**

```bash
git add src/main/remotePage.ts src/main/remotePage.test.ts
git commit -m "$(cat <<'EOF'
One stem changes on the grid, and the grid can be the stem's own loop

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

### Task 10: The budget, the eviction, the failures, and the picture

**Files:** `src/main/remotePage.ts`, `src/main/remotePage.test.ts`

- [ ] **Step 1: The memory budget and eviction**

```js
  // 96 MB of decoded float32. THE NUMBER THAT MATTERS: decodeAudioData
  // yields float32 at the context's rate, so a 16-second mono stem at 48kHz
  // is 3.07 MB and twenty of them is 61 MB -- comfortable. A CAP ON STEM
  // COUNT WOULD BE THE WRONG SHAPE: twenty 8-second stems (31 MB) are
  // cheaper than eight 32-second ones (118 MB), and PHONE_LOOP_MAX_BARS is
  // 32. This binds at 31 stems of 16 seconds, which is past anything
  // discover can build, and it is what stops a tab dying mid-listen with
  // nothing on screen to say why.
  var STEM_BUDGET_BYTES = 96 * 1024 * 1024

  function bytesOf(buf) {
    return buf.length * buf.numberOfChannels * 4
  }

  function decodedBytes() {
    var total = 0
    for (var id in buffers) total = total + bytesOf(buffers[id])
    return total
  }

  // Drops buffers nothing is asking for. A stem that survived a roll is
  // still wanted and is never touched -- eleven of twelve are kept, which is
  // the whole economy of this feature.
  function evict() {
    if (decodedBytes() <= STEM_BUDGET_BYTES) return
    var wanted = {}
    for (var slotId in wantedStemId) wanted[wantedStemId[slotId]] = true
    for (var id in buffers) {
      if (wanted[id]) continue
      delete buffers[id]
      if (decodedBytes() <= STEM_BUDGET_BYTES) return
    }
  }
```

`evict()` is called at the end of every landed fetch. `fetchMissing` gains a guard before starting one:

```js
      if (decodedBytes() >= STEM_BUDGET_BYTES) { overBudget = true; continue }
```

- [ ] **Step 2: Say what is wrong, in the status line**

```js
  // What the status line rests on when nothing else is happening. A missing
  // stem is NOT hidden: judging an incomplete mix without knowing it is
  // incomplete is the one thing this screen must never do.
  function restStatus() {
    var missing = 0
    for (var slotId in wantedStemId) {
      if (failedIds[wantedStemId[slotId]] >= MAX_STEM_TRIES) missing = missing + 1
    }
    if (overBudget) { msgEl.textContent = 'too many stems'; return }
    if (missing > 0) {
      msgEl.textContent = missing + (missing === 1 ? ' stem missing' : ' stems missing')
      return
    }
    msgEl.textContent = lastKept ? 'last kept · ' + lastKept : ''
  }
```

A row whose stem has given up draws in the muted grey — `levelFor` already returns 0 for it because there is no voice, so add to `drawRowWave`'s colour decision:

```js
    var dead = slot.stemId && failedIds[slot.stemId] >= MAX_STEM_TRIES
    var colour = (slot.muted || dead) ? '#6a6a6a' : (TYPE_COLORS[slot.soundType] || '#6a6a6a')
```

- [ ] **Step 3: Put the picture hold back, per row**

Task 7 made `lastSlots = state.slots` unconditional. Restore the property `adoptPolledSlots` had — the rows never run ahead of the sound — but one row at a time:

```js
  // The rows catch up with the sound, row by row. The mac's picture changes
  // the moment a roll lands; that stem then has to be transcoded, downloaded,
  // decoded and waited on until a boundary. Drawing its new name at the front
  // of that gap means the row says one thing while the phone plays another,
  // and judging what you are hearing is the entire purpose of this screen.
  //
  // Per ROW now, not per page: eleven rows that did not change are drawn
  // from the newest poll immediately, and only the one that is mid-change
  // holds. That is strictly better than the whole-page hold it replaces.
  function mergePolledSlots(polled) {
    var out = []
    for (var i = 0; i < polled.length; i++) {
      var s = polled[i]
      var want = wantedStemId[s.id]
      var v = voices[s.id]
      var inFlight = want && ((v && v.stemId !== want) || (!v && !buffers[want]))
      if (!inFlight) { out.push(s); continue }
      var drawn = null
      for (var j = 0; j < lastSlots.length; j++) if (lastSlots[j].id === s.id) drawn = lastSlots[j]
      // Its sound has not changed yet, so its name and shape do not either --
      // but its own mute state is a thing he just did and must be shown.
      if (drawn) { drawn.muted = s.muted; drawn.soloed = s.soloed; out.push(drawn) }
      else out.push(s)
    }
    return out
  }
```

`render` calls `lastSlots = mergePolledSlots(state.slots)`, and `commitReplace` already calls `renderRows()` at the boundary.

- [ ] **Step 4: Tests**

```ts
describe('remotePage stem budget and failures', () => {
  it('budgets decoded bytes, not a stem count', () => {
    // Twenty 8-second stems are cheaper than eight 32-second ones, and
    // PHONE_LOOP_MAX_BARS is 32. A count would be the wrong shape.
    expect(SCRIPT).toContain('STEM_BUDGET_BYTES = 96 * 1024 * 1024')
    expect(SCRIPT).toContain('buf.length * buf.numberOfChannels * 4')
    expect(SCRIPT).not.toMatch(/MAX_STEMS?\s*=\s*\d+/)
  })

  it('evicts only what nothing is asking for', () => {
    expect(SCRIPT).toContain('if (wanted[id]) continue')
  })

  it('gives up on a stem after three tries rather than downloading forever', () => {
    // The poll runs every 700ms. An uncounted retry is an infinite download.
    expect(SCRIPT).toContain('MAX_STEM_TRIES = 3')
    expect(SCRIPT).toContain('if (failedIds[id] >= MAX_STEM_TRIES) continue')
  })

  it('says a stem is missing rather than hiding an incomplete mix', () => {
    expect(SCRIPT).toContain("' stem missing'")
    expect(SCRIPT).toContain("' stems missing'")
    expect(SCRIPT).toContain("'too many stems'")
  })

  it('draws a stem that never arrived the way it draws a muted one', () => {
    // There is no spare colour on this page and nothing on it may fade.
    expect(SCRIPT).toContain('(slot.muted || dead)')
    expect(REMOTE_PAGE_HTML).not.toContain('opacity')
  })

  it('holds the picture per row, not per page', () => {
    expect(SCRIPT).toContain('function mergePolledSlots(')
    expect(SCRIPT).not.toContain('function holdingForSwap(')
    // A mute he just made is still shown at once, even on a held row.
    expect(SCRIPT).toContain('drawn.muted = s.muted')
  })
})
```

- [ ] **Step 5: Full verification**

```bash
npm test && npm run typecheck && npm run lint
```
Expected: all pass, 195 files, 0 errors, 0 new warnings.

- [ ] **Step 6: Commit**

```bash
git add src/main/remotePage.ts src/main/remotePage.test.ts
git commit -m "$(cat <<'EOF'
A budget in bytes, three tries, and a row that says when it has nothing

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

## CHECKPOINT B — THIS IS THE FEATURE. STOP AND USE IT.

Everything Elling asked for is here: the phone holds every stem, mute and solo are instant, a roll costs one stem. Phase B is the transition control he approved separately.

- [ ] `npm run dev`, twelve stems, phone paired over the LAN, then again over Tailscale from off the network.
- [ ] Tap rows: mute and solo should land under the thumb with no gap and no click.
- [ ] Roll one slot: one row changes, the other eleven keep playing without a break.
- [ ] Try each swap-grid chip, `own loop` first.
- [ ] Watch the Mac's console for `remoteStemRenderer:` lines.
- [ ] **Report what you could not judge**, which is everything about how it sounds.

---

# PHASE B — the transition he approved

---

### Task 11: `cut` / `short` / `long`

Approved on 2026-09-27 and deliberately not started, because per-stem changed the question. A crossfade between two whole mixes is a strange object — the same eleven stems fade out of themselves and back in, three decibels down in the middle, for nothing. A crossfade between **one outgoing stem and one incoming stem, under eleven that never move**, is an ordinary and useful control.

**Files:** `src/main/remotePage.ts`, `src/main/remotePage.test.ts`

- [ ] **Step 1: The setting, in the swap grid's exact shape**

```js
  // Bar-relative, not fixed seconds, so the control means the same thing at
  // 90bpm and at 160. Seconds per bar is already derived from the buffers
  // (see swapPeriod), so no new number goes on the wire.
  var XFADES = [
    { x: 0, l: 'cut' },
    { x: 0.125, l: 'short' },
    { x: 0.5, l: 'long' }
  ]
  var XFADE_KEY = 'sssketch-remote-xfade'
  var xfade = 0
  try {
    var savedX = localStorage.getItem(XFADE_KEY)
    for (var xi = 0; xi < XFADES.length; xi++) {
      if (String(XFADES[xi].x) === savedX) xfade = XFADES[xi].x
    }
  } catch (e) {}

  // How long a handover takes, in seconds. `cut` is 5ms -- not zero: a hard
  // gain step on a sounding source pops, the same reason MUTE_RAMP exists.
  function xfadeSec() {
    if (xfade === 0) return 0.005
    var dur = loopDur()
    var bars = loopBars
    if (!(dur > 0) || !(bars > 0)) return 0.005
    return xfade * (dur / bars)
  }
```

- [ ] **Step 2: Equal-power curves**

```js
  // EQUAL POWER, not linear. Two uncorrelated stems crossfaded on straight
  // lines dip about 3dB in the middle -- inaudible at `cut`, obvious at
  // `long`. setValueCurveAtTime takes an arbitrary shape, so the fade is the
  // same sqrt curve every other blend in this codebase uses
  // (LoopSewing.cpp, LoopBoundaryFade.cpp). Built once.
  var XFADE_POINTS = 64
  var FADE_IN = new Float32Array(XFADE_POINTS)
  var FADE_OUT = new Float32Array(XFADE_POINTS)
  for (var fi = 0; fi < XFADE_POINTS; fi++) {
    var ft = fi / (XFADE_POINTS - 1)
    FADE_IN[fi] = Math.sqrt(ft)
    FADE_OUT[fi] = Math.sqrt(1 - ft)
  }

  function scaledCurve(shape, level) {
    var out = new Float32Array(XFADE_POINTS)
    for (var i = 0; i < XFADE_POINTS; i++) out[i] = shape[i] * level
    return out
  }
```

- [ ] **Step 3: Use them in `scheduleReplace`**

```js
    var fade = xfadeSec()
    var level = levelFor(slotId)
    var next = makeVoice(stemId, buf, at, 0)
    next.gain.gain.setValueCurveAtTime(scaledCurve(FADE_IN, level), at, fade)
    v.gain.gain.cancelScheduledValues(at)
    v.gain.gain.setValueCurveAtTime(scaledCurve(FADE_OUT, v.gain.gain.value), at, fade)
    // The OLD source runs until the fade is over, not until the boundary --
    // otherwise there is nothing to fade out.
    v.src.stop(at + fade)
    v.src.onended = function () { commitReplace(slotId, at) }
```

`commitReplace` must set the incoming voice's gain to its plain level after the curve is done (`p.gain.gain.setValueAtTime(levelFor(slotId), audioCtx.currentTime)`), so a later `setLevel` is not fighting a finished curve.

`MUTE_RAMP` is untouched and mute is **not** governed by this setting: a mute you asked for must not take half a bar to arrive.

- [ ] **Step 4: The chips**

A second `.chips.grid` row under the swap grid, inside `#loop`, with its own eyebrow `and take`. Three chips at `flex: 1 1 0`, `min-height: 42px`, selected chip `chip on` (inversion, not colour — there is no spare colour on this page).

- [ ] **Step 5: Tests**

```ts
describe('remotePage crossfade', () => {
  it('offers cut, short and long, and nothing else', () => {
    expect(SCRIPT).toContain("{ x: 0, l: 'cut' }")
    expect(SCRIPT).toContain("{ x: 0.125, l: 'short' }")
    expect(SCRIPT).toContain("{ x: 0.5, l: 'long' }")
    const options = SCRIPT.match(/\{ x: [\d.]+, l: '/g) ?? []
    expect(options).toHaveLength(3)
  })

  it('measures the fade in bars, so it means the same at any tempo', () => {
    expect(SCRIPT).toContain('return xfade * (dur / bars)')
    expect(SCRIPT).not.toContain('bpm')
  })

  it('is equal power, because a linear crossfade of two stems dips', () => {
    expect(SCRIPT).toContain('FADE_IN[fi] = Math.sqrt(ft)')
    expect(SCRIPT).toContain('FADE_OUT[fi] = Math.sqrt(1 - ft)')
    expect(SCRIPT).toContain('setValueCurveAtTime')
  })

  it('never lets cut mean a hard step, which pops', () => {
    expect(SCRIPT).toContain('if (xfade === 0) return 0.005')
  })

  it('keeps the old source alive until the fade is over', () => {
    expect(SCRIPT).toContain('v.src.stop(at + fade)')
  })

  it('does not slow a mute down with it', () => {
    const mix = (/function setLevel\(v, level\)[\s\S]{0,400}/.exec(SCRIPT) ?? [''])[0]
    expect(mix).toContain('MUTE_RAMP')
    expect(mix).not.toContain('xfadeSec')
  })

  it('keeps the setting on the phone, with no route and no mac involved', () => {
    expect(SCRIPT).toContain("XFADE_KEY = 'sssketch-remote-xfade'")
    expect(SCRIPT).toContain('localStorage.getItem(XFADE_KEY)')
  })

  it('never lets storage being off take the page down with it', () => {
    const reads = SCRIPT.match(/localStorage\.(get|set)Item/g) ?? []
    const guards = SCRIPT.match(/try \{[^}]*localStorage/g) ?? []
    expect(guards).toHaveLength(reads.length)
  })

  it('starts on cut, so nobody’s phone changes until they touch a chip', () => {
    expect(SCRIPT).toContain('var xfade = 0')
  })
})
```

Add `'cut'`, `'short'`, `'long'` to the two-words button list.

- [ ] **Step 6: Run, manual, commit**

```bash
git add src/main/remotePage.ts src/main/remotePage.test.ts
git commit -m "$(cat <<'EOF'
A stem can fade in under the others, now that it is not the whole mix

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

### Task 12: Final sweep

- [ ] **Step 1:** `npm test` — expect 195 files, all passing, and a count 2 files above the 193 baseline.
- [ ] **Step 2:** `npm run typecheck` — 0 errors.
- [ ] **Step 3:** `npm run lint` — 0 errors, and exactly the 4 pre-existing prettier warnings. Any fifth is yours.
- [ ] **Step 4:** `grep -rn "opacity" src/main/remotePage.ts` — must be empty, comments included.
- [ ] **Step 5:** `grep -n "=>\|??\|?\." <(node -e "…extract the script…")` or simply confirm `remotePage.test.ts`'s `csp reality` block passes.
- [ ] **Step 6:** Update the spec's status line to record what shipped, which encoding survived Checkpoint A, and what is still unwalked.
- [ ] **Step 7:** Commit the spec edit.

---

## Self-review against the spec

- **Tempo domain** → findings 1-3, Task 3's `transcode`. Stated in the spec and asserted by `remoteStemRenderer.test.ts`'s `afinfo` case.
- **Memory** → Task 10's budget, mono in Task 3, the tables in the spec.
- **Format and bandwidth** → Task 3's `OUTPUT_ARGS`, Checkpoint A's fallback.
- **Caching both sides** → `remoteStemRenderer`'s `cache` pruned on `setLoop` (Task 3), `buffers` + `evict` on the phone (Tasks 7, 10).
- **Loop sewing** → Task 1, on the Mac.
- **Sample-accurate alignment of N sources, including mid-flight replacement** → Task 7's `origin`/`offsetAt`, Task 9's `scheduleReplace`/`commitReplace`.
- **The swap grid survives; the crossfade is built** → Tasks 9 and 11. Neither is dropped.
- **`/api/loop`** → argued in the spec; untouched in code; the page stops calling it (Task 7, Step 5's assertion).
- **Auth and privacy** → Task 4 (`RemoteSlotResponse`, boundary function untouched), Task 5 (`STEM_ID` before any lookup), Task 6 (`stemId` injected in main).
- **Peaks** → unchanged, argued in the spec, no task.
- **Failure modes** → Task 10.
- **`vitest.config.ts`** → finding 7, checked in Task 3 Step 5, not modified.
- **No native-engine change** → finding 1.
