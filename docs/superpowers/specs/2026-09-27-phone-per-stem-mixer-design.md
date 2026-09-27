# The phone holds every stem, and mixes them itself

Date: 2026-09-27
Status: **SHIPPED 2026-09-27**, tasks 1-12 of
`docs/superpowers/plans/2026-09-27-phone-per-stem-mixer.md`. Unwalked: nothing about how any
of it sounds, and the one number nobody here can settle (below).

**What shipped differently from this spec, and why:**

- **STEREO, not mono.** Elling asked for it after the spec was written, so
  `PHONE_STEM_CHANNELS = 2` in `src/main/remoteStemRenderer.ts`. Every memory figure in the
  mono table below therefore doubles: 6.14 MB per 16-second stem, 122.9 MB at twenty.
- **The budget is 160 MiB, not 96.** 96 was derived from the mono table and would evict at
  eleven stereo stems. It is set deliberately above twenty stereo 16-second stems, because
  evicting a stem he is actively listening to is a worse failure than a fatter tab: it is
  silent, and it reads as the mix being wrong rather than the phone being full. It binds at
  27 stems of 16 seconds, 13 of 32, or 54 of 8. Still a byte budget, never a stem cap.
- **ALAC survived checkpoint A.** Proved empirically before any page work: a 2.000s stereo
  48kHz ALAC `.m4a` built with the same `afconvert -f m4af -d alac` the renderer uses
  (`afinfo`: `2 ch, 48000 Hz, alac`, `96000 valid frames + 0 priming`), served over loopback
  and decoded with `decodeAudioData` in Safari on a booted iOS 26 iPhone 17 Simulator, which
  runs the same AudioToolbox path as the device: `OK ch=2 rate=48000 dur=2 len=96000`. Stereo,
  48kHz, and exactly `duration x 48000` frames -- no silent offset at the head of a
  sample-locked source. **The WAV fallback was not built.**
- **Three small additions the spec did not anticipate**, each forced by the code: `reconcile`
  drops back to a fresh start when every voice has gone (with no voices `loopDur()` is zero,
  so the period is zero and a row joining would wait for a boundary that can never arrive);
  a new voice's baseline gain is set at `currentTime` rather than at the boundary
  (`setValueCurveAtTime` refuses to run when another automation event falls inside its own
  window, and the crossfade's curve starts at exactly the boundary); and `applyMix` writes
  only a level that actually changed, because a poll every 700ms would otherwise cancel a
  handover's fade four times before it ran.
- **The per-row picture hold does not hold a row while nothing is sounding**, or when that
  stem has given up after three tries. Both are the judgement the deleted whole-page
  `holdingForSwap` already made; without the first, a row rolled with the transport off would
  freeze forever.

**THE ONE THING STILL UNSETTLED, and it needs his phone:** whether an iOS tab holds twenty
stereo stems. That is a jetsam question, not a decode question, and no simulator settles it.
The symptom is the tab reloading itself mid-listen with no console. The retreat is two lines:
halve `STEM_BUDGET_BYTES` in `src/main/remotePage.ts` to 80 and set `PHONE_STEM_CHANNELS` to 1.

> "are we streaming all stems individually? if so lets make mute and solo happen immediately"
> — Elling, 2026-09-27, and on being told no, and hearing the trade:
> "yes spec it out.. so the phone is more full featured"

Today the phone plays **one rendered mixdown**. Every roll, every mute, every solo is a
different mixdown: the Mac re-renders the whole loop through a native engine, the phone
downloads it, decodes it and swaps it at a bar boundary. Mute is a two-second round trip
through a C++ renderer.

This spec makes the phone the mixer. It holds each stem as its own decoded buffer, plays each
one through its own `GainNode`, and **mute and solo become a gain change: instant, no render,
no fetch.** Rolling one slot downloads one stem instead of re-rendering and re-downloading
twelve.

---

## The two things that sink a naive version of this. Both are settled before anything else.

### 1. Stems are at the wrong tempo — but the Mac already solved this, and the answer is on disk

Discover ranks candidates with `rankCandidates({ targetBpm })` and previews them with
`stretch: { [groupId]: true }` (`DiscoverPanel.tsx:889`). A stem pulled from a 96bpm jam into a
128bpm loop is **time-stretched, pitch-preserved** before it is ever heard. Serving the raw file
would hand the phone a stem at the wrong tempo, and `playbackRate` on the phone would fix the
tempo by moving the pitch — which for musical material is not a trade, it is a wrong answer.

The good news, and it reshapes the whole feature:

**Stretching in sssketch is not an engine feature. It is `src/main/rubberband.ts`, in the main
process, and it has already run by the time the phone's loop exists.**

- `renderStretched(stemPath, ratio)` shells out to the rubberband CLI (`-q --tempo <ratio>`),
  writes a WAV, and caches it at `<userData>/stretch-cache/<sha1(path::ratio.toFixed(4))>.wav`
  under a 1 GB LRU. On this machine that cache is real and populated: **114 files, 671 MB, all
  stereo PCM WAV at 44.1 or 48 kHz.**
- `buildEngineProject` resolves every stem's ratio itself, per stem (not per rifff — LORE riffs
  really do mix in stems captured at a different native tempo), and writes the result into
  **`EngineStem.resolvedPath`** and **`EngineStem.durationSec`**. The doc comment on
  `buildEngineProject` says it plainly: stretch is resolved ahead of time "so the engine itself
  never needs to know about stretch ratios at all."
- `DiscoverPanel.tsx:901-912` builds that project with `resolveStretchedForPlayback` and then
  calls `window.rifffApi.setRemoteLoop(project)`.

So **`remoteLoopRenderer.setLoop` is already handed, on every Discover change, a list of
per-stem files already stretched to the project tempo, each with its own measured duration.**
There is no new stretch pipeline to build, nothing to cache by `(stemCID, targetBpm, barLength)`
— rubberband's own cache is already keyed by `(path, ratio)`, which is the same fact — and

> **NO `native-engine/` CHANGE IS REQUIRED ANYWHERE IN THIS FEATURE.**

That is worth stating loudly because the opposite would have changed the shape of everything:
the engine does not hot-reload, and every edit costs a rebuild and a full app restart.

**What the phone receives, then, in one sentence:** *the stem's own audio, already
time-stretched to the current project tempo, mono, 48 kHz, lossless, trimmed to exactly its own
loop length and seam-blended so it loops without a click.* Same tempo domain as today's
mixdown, because it is literally the same files the mixdown is rendered from.

**One wrinkle, and it must be handled.** When a stem's ratio is within 0.001 of 1,
`renderStretched` returns early and `resolvedPath` is the **original file** — which for a LORE
stem is an extensionless Ogg Vorbis (or, ~3% of the time, FLAC), and for a drag-and-dropped
import is a `.wav`. So `resolvedPath` can be any of four things. That is fine, because the Mac
has to transcode regardless (below), and macOS's own `afconvert` reads all four — verified:
`afinfo` on a real cached stem reports `File type ID: Oggf`, `2 ch, 48000 Hz, vorb`.

It also means **the raw stem could never have been served as-is**: iOS Safari's
`decodeAudioData` goes through AudioToolbox, which on iOS does not decode Ogg Vorbis. Serving
the original encoding was never on the table.

### 2. Memory — the real numbers, at his real sizes

`decodeAudioData` yields float32 PCM at the `AudioContext`'s own sample rate, which on an iPhone
is **48 kHz**. The arithmetic is `seconds × 48000 × channels × 4 bytes`.

A Discover loop is `loopBars` long, where `loopBars` is the longest resolved stem's bar length.
Eight bars at 120 bpm is 16 seconds; four bars is 8.

| | per stem | 12 stems | 20 stems |
|---|---|---|---|
| **stereo, 16 s** | 6.14 MB | **73.7 MB** | **122.9 MB** |
| **mono, 16 s** | 3.07 MB | **36.9 MB** | **61.4 MB** |
| mono, 8 s | 1.54 MB | 18.4 MB | 30.7 MB |

122.9 MB of live `AudioBuffer` in an iOS Safari tab, on top of canvases and the JS heap, is the
kind of number that gets a tab reloaded out from under you — and the failure looks like the page
dying mid-listen, on a sofa, with no console.

**The decision is mono, and it is taken on the Mac.** Not downmixed on the phone after decoding
— that would pay the stereo peak anyway, on every stem, transiently. The Mac serves one channel,
so `decodeAudioData` returns a one-channel buffer and 61.4 MB is the ceiling at twenty stems of
sixteen seconds.

Three things make mono the honest choice rather than a concession:

1. **The phone is a judging surface, not a mixing surface.** The question being answered is "does
   this hat belong under that pad", and an iPhone speaker is one driver.
2. **It halves the decode work too**, not just the memory, which matters when twelve stems land
   at once over a slow link.
3. **The stereo mixdown is not deleted.** `GET /api/loop` stays exactly as it is (see below).

**A budget, not a stem cap.** A cap on stem *count* is the wrong shape: twenty 8-second stems
(30.7 MB) are cheaper than eight 32-second ones (118 MB). The phone computes the projected
footprint from the durations it can see and refuses to exceed
`STEM_BUDGET_BYTES = 96 * 1024 * 1024`, playing the stems it can afford and saying so in the
status line. At his sizes the budget never binds — it binds at 31 stems of 16 s, or 15 of 32 s
— and `PHONE_LOOP_MAX_BARS = 32` already exists as the only path to a loop that long. It is five
lines, and it is the difference between a degraded mix and a dead tab.

**The sample rate is deliberately NOT pinned.** `new AudioContext({ sampleRate: 44100 })` would
save 8.8% of memory and would be a new risk on iOS for no real gain. Instead the **Mac encodes
at 48 kHz**, which is the rate the context will be, so no resampling happens on the phone at
all. That is a correctness win as much as a CPU one: with no resampler in the path,
`buffer.length` is exactly the frame count the Mac encoded, which is what makes the loop point
exact (see "one origin", below).

---

## Format and bandwidth

The Mac must transcode regardless — the source is one of four encodings, one of which iOS cannot
decode, and the audio needs sample surgery before it is served (trim and seam-blend). So the
only question is what to transcode *to*.

Measured on this machine, with `/usr/bin/afconvert`, on real stems out of `stretch-cache`:

| encoding of one real 6.000 s stem, mono 48 kHz | bytes | priming |
|---|---|---|
| WAV, 16-bit PCM | 580,096 | — |
| **ALAC in `.m4a`** | **334,339** | **0** |
| FLAC in `.flac` | 330,366 | 0 |
| AAC 96 kbps in `.m4a` | 74,784 | **2112 frames** |

And on a busier 24-second stem: WAV 2,308,092 · FLAC 818,677 · ALAC 842,779.

**ALAC in an `.m4a` is the choice.** The reasoning, in order of weight:

1. **Zero encoder delay, and it is lossless.** `afinfo` reports `audio 288000 valid frames +
   0 priming` — exactly 6.000 s × 48000. AAC is four times smaller and reports **2112 priming
   frames**. macOS's own decoder honours the gapless metadata and round-trips exactly, but
   whether WebKit's `decodeAudioData` applies the edit list is not something this design should
   bet on: 2112 frames is 44 ms of silence bolted onto the front of *every* stem, which in a
   feature whose entire value is twelve sources sample-locked to one clock is not a rough edge,
   it is the whole thing broken. Lossless buys that risk away outright.
2. **ALAC is Apple's codec in Apple's container, and the client is WebKit, always.** Every
   browser on iOS is WebKit, Brave included. FLAC is 1% smaller and more universal; on a target
   that is *only* AudioToolbox, Apple's own format is the surer decode.
3. It is one `afconvert` invocation, on a binary that has shipped with macOS forever, in an app
   that already spawns `rubberband` and a JUCE engine and is not sandboxed (`build/entitlements.mac.plist`
   carries only the three JIT/dyld keys).

Lossless mono at 48 kHz measures **34–55 KB/s** depending on how busy the stem is; call it 40.

| | one stem | 12 stems | 20 stems |
|---|---|---|---|
| **8-bar loop (16 s)** | ~640 KB | **~7.7 MB** | **~12.8 MB** |
| 4-bar loop (8 s) | ~320 KB | ~3.8 MB | ~6.4 MB |
| *today's mixdown, for comparison* | *2.82 MB, **per roll*** | | |

He uses this over Tailscale, sometimes away from home. That case is exactly where the shape of
the change matters most:

- **First load** goes from 2.82 MB to ~7.7 MB. On a 5 Mbps link, about 12 s instead of 4.5 s —
  and it replaces a 1–3 s engine render, so the wall-clock difference is smaller than the byte
  difference.
- **Every roll after that** goes from 2.82 MB **and a full engine render** to **640 KB and no
  render at all.** A roll is the thing he does over and over; it gets roughly four times cheaper
  and loses its render latency entirely.
- **Every mute and every solo** go from 2.82 MB and a render to **zero bytes**.

That trade — pay once, then stop paying — is the whole point.

---

## What the Mac actually does, per stem

Given one `EngineStem` (which already carries `resolvedPath`, the stretched file, and
`durationSec`, its measured duration):

1. `afconvert -f WAVE -d LEI16@48000 -c 1 <resolvedPath> <tmp>.wav` — decode whatever it is
   (Ogg / FLAC / WAV / stretch-cache WAV), downmix to mono, resample to 48 kHz.
2. **Trim to exactly `round(durationSec * 48000)` frames**, padding with silence if short.
3. **Seam-blend the last 128 frames** (below).
4. Scale by `EngineStem.volume`, in the same pass.
5. `afconvert -f m4af -d alac <tmp2>.wav <out>.m4a`.
6. Hold the bytes in memory, keyed by `stemId`. Delete both temp files in a `finally`, exactly
   as `remoteLoopRenderer` already does — **the cache holds bytes, not paths**, and that is a
   stated property of this surface, not an optimisation.

Steps 2–4 are one pass over Int16 samples. Everything needed already exists in `src/shared/`:
`findWavChunks` (which handles the odd interstitial chunks real Endlesss exports contain) and
`encodeWavPCM16`.

**Why step 2 exists.** The engine does the same thing, for a reason worth repeating:
`StemBufferCache::load` computes `loopEndSample` from the stem's **metadata** `durationSec`, not
from the decoded length, because a LORE Ogg stem's `durationSec` comes from bars × tempo and the
file is often a few frames longer. Blending or looping at the file's end would put the loop point
somewhere the engine never reads. By trimming on the Mac, `buffer.duration` on the phone **is**
`durationSec`, by construction — so the phone needs no duration on the wire and cannot disagree
with the Mac about where the loop ends.

### The seam blend is not free and the phone needs it

`native-engine/Source/LoopSewing.cpp`'s `applyLoopSewingBlend` is a verbatim port of OUROVEON's
`Stem::applyLoopSewingBlend`, and its tuning is load-bearing — the header records that widening
the window (they tried up to 4096, and per-stem adaptive) was **reverted**, because it suppressed
natural amplitude swing and read as a loudness dip. The whole thing:

```cpp
const int clampedLoopEnd = std::clamp(loopEndSample, 0, buffer.getNumSamples());
if (clampedLoopEnd <= windowSize * 2) return;
for (int ch = 0; ch < buffer.getNumChannels(); ++ch) {
    auto* data = buffer.getWritePointer(ch);
    const float startSample = data[0];
    for (int i = 0; i < windowSize; ++i) {
        const int endIndex = (clampedLoopEnd - 1) - i;
        const double t = -1.0 + ((double) i / (double) windowSize) * 2.0;
        const float coeff = (float) std::sqrt(0.5 * (1.0 - t));
        data[endIndex] = data[endIndex] + (startSample - data[endIndex]) * coeff;
    }
}
```

128 samples (~2.7 ms at 48 kHz), equal-power, pulling the tail onto the head; `coeff` is exactly
1.0 at the seam and 0 at the window's far edge.

Today the phone never meets this problem, because the mixdown it plays was rendered by an engine
that had already sewn every stem. **Per-stem, it meets it twelve times over**, at twelve
different points in the loop, once per cycle, forever. That is not a rough edge either.

**The blend happens on the Mac, in step 3, not on the phone.** Three reasons: it belongs in the
same pass as the trim it depends on; it can be a pure, unit-tested function in `src/shared/` with
the C++ constants asserted against it, whereas the phone page is a hand-written string with no
test harness beyond `.toContain`; and ALAC being lossless means the sewn samples arrive exactly
as computed.

---

## Addressing: `stemId`, and why it cannot leak a path

`src/shared/remoteState.ts` is a deliberate privacy boundary. `remoteStateFromSlots` is the whole
of it in one pure function, and the recently-added peaks are keyed by **slot id, not path**, for
exactly this reason. A per-stem audio route must not become the door.

The pattern is already in the codebase, one level up: `loopId` is **not** part of `RemoteState`
and is **not** produced by `remoteStateFromSlots`. Main computes it from the `EngineProject`
(which is full of real filesystem paths and never leaves the main process) and injects sixteen
hex characters into the response. `RemoteStateResponse`'s doc comment says so.

**`stemId` is the same trick, one level down.**

- Sixteen hex characters of `sha256` over the audio-bearing fields of one `EngineStem` —
  `resolvedPath`, `durationSec`, `barLength`, `volume`, `oneShot`, `trimStartSec`, `trimEndSec`,
  `toolkit` — joined with the same `\x1f` unit separator `phoneLoop.ts` already uses, and for the
  same stated reason (so `/a1`+`2` cannot collide with `/a`+`12`).
- It is computed by a pure function `phoneStemAudioId(stem)` factored **out of** the existing
  `stemLine`, so `stemLine` keeps calling it and the loop fingerprint and the stem id can never
  drift apart.
- **`muted` is deliberately excluded.** Mute is now a phone-side gain, not a property of the
  bytes; including it would mean a mute changed the id, which would mean a download.
- **`volume` is deliberately included, and the gain is baked into the served audio.** The
  alternative — sending gain as a number and letting the phone's `GainNode` apply it — is
  tempting and is rejected: it would mean adding a field to `RemoteSlotView`, and per-slot gain
  on the phone is on the standing "not now" list anyway. Baking keeps `stemId` meaning exactly
  "these bytes", which is the cleanest possible cache key. The cost, stated as a known limit:
  dragging a slot's gain on the Mac re-renders and re-downloads that one stem.
- Main holds `Map<stemId, {resolvedPath, durationSec, volume}>` for the current loop only, built
  in `setLoop`. **The route looks the id up in that map. It never concatenates it into a path.**
  A sixteen-hex-character key that must already be present in a map the Mac built cannot traverse
  anything, and a `/^[0-9a-f]{16}$/` test runs before the lookup regardless.

**How it reaches the phone.** `getState()` in `index.ts` already spreads `lastRemoteState` and
adds `loopId`. It now also maps `stemId` onto each slot row:

```ts
getState: () => {
  const bySlot = remoteStems?.stemIdsBySlotId() ?? new Map<string, string>()
  return {
    ...lastRemoteState,
    loopId: remoteLoop?.currentLoopId() ?? null,
    slots: lastRemoteState.slots.map((s) => ({ ...s, stemId: bySlot.get(s.id) ?? null }))
  }
}
```

`remoteStateFromSlots` — the boundary function — **is not touched**. `RemoteSlotView` gains
nothing. The `stemId` is injected in main, from main's own data, and the no-path property stays
preserved by construction rather than by care, which is the property that file exists to have.

**Where the slot ids come from, and why there is no race.** Main has the `EngineProject` but not
Discover's slot ids — `EngineStem.stemKey` embeds a `crypto.randomUUID()` groupId that is fresh
on every rebuild. The fix is one argument: `setRemoteLoop(project, slotIds)`. At the call site
(`DiscoverPanel.tsx:812`) the array `members` **already carries `id`** and is the same array, in
the same order, that `assembleDiscoverRifff` numbers slots 1..N from. So `members.map((m) => m.id)`
is exactly the slot id per `EngineStem`, from the same snapshot, in the same IPC call. There is
no second push to fall out of step with. If the two lengths ever disagree, the map is dropped
entirely and every `stemId` is null — **fail closed**, because a mis-paired row would be the
worst possible bug here.

### The route

```
GET /api/stem?id=<16 hex>       200 audio/mp4 · 404 unknown or malformed id
```

Behind `isAllowedHost` and `authorized(req)` like everything else, so it lives on the same
token-authenticated `connect-src 'self'` origin. A 404 rather than the surface's usual
indistinguishable 401 is correct here and has precedent: `/api/add-slot` answers 400 for a
malformed body because **a paired phone already knows the route exists** and there is nothing
left to conceal from it.

`cache-control: private, max-age=3600` — the one route on this surface that is not `no-store`.
The id is a content hash, so a stale hit is impossible by construction, and it means a page
reload does not re-download 7.7 MB over Tailscale. If that departure from the surface's one rule
turns out to be unwelcome, it is one string.

No byte-range handling, for the same reason `/api/loop` has none: the phone uses `fetch` +
`decodeAudioData`, not a media element, so Safari never asks for one.

---

## One origin, N sources: the scheduling model

This is where the design gets *simpler* than what it replaces, and the simplification is worth
naming.

Today `startedAt` is the instant the audible buffer started, and **it moves on every swap**,
because the incoming mix begins at its own bar 0 (`commitSwap`: "there is no phase in it to
match the outgoing loop to"). The playhead jumps back to the left at the same instant the sound
does, and that is the honest picture of a whole-mix handover.

Per-stem, that is no longer true. When one stem of twelve is replaced, **eleven stems are still
mid-phrase, and the twelfth has a phase to match.** So:

**`origin` is set once, when playback starts, and never moves again.** Every source is measured
from it:

- each stem is one `AudioBufferSourceNode` (`loop = true`, `loopStart = 0`,
  `loopEnd = buffer.duration`) through its own `GainNode` into `ctx.destination`;
- all of them are started with `src.start(origin)` at the same instant of the audio clock,
  scheduled `START_LEAD = 0.08` s ahead so nothing is clamped to "as soon as possible";
- a stem that joins later — a slot added, a fetch that landed slowly, a roll — enters at a
  boundary `at` **with the phase the phrase is already at**:

```js
var o = (at - origin) % dur
if (o < 0) o = o + dur
src.start(at, o)
```

That single line is what makes a replacement musical instead of merely sample-accurate. A DAW
does exactly this; the whole-mix swap could not, because there was no phrase to be in.

**Tiling comes free, and it is the same tiling the app already does.** `assembleDiscoverRifff`
keeps each stem's own `barLength` unchanged and only the rifff's `barLength` is the max — its own
doc comment says this is precisely so the existing machinery handles shorter stems for free
(`tileOffsetsPx` on screen, `PlaybackEngine::renderBlock`'s tile walk in the engine). A source
looping at its own `duration` **is** that tiling, computed by the audio thread. A 2-bar hat under
an 8-bar pad wraps four times per phrase, in phase, with no arithmetic anywhere.

**Two numbers the page derives rather than receives.** The phrase length is
`loopDur = max(buffer.duration)` across the voices — by definition of `loopBars` (the longest
resolved stem's bar length) that buffer's stem spans the whole loop. Seconds per bar is
`loopDur / loopBars`, and `loopBars` is already on the wire. So the rule the swap grid was built
on survives unchanged: **derived from the buffer, never from a bpm.** A tempo on the wire would
be a second copy of the same fact, free to disagree with it.

**Backgrounding the tab gets easier, not harder.** iOS suspends the `AudioContext`; every source
is on that one clock, so they resume in exactly the phase they left. The single-origin model
makes desync between stems structurally impossible — there is only one clock and one origin, and
nothing in the page ever writes to `origin` after the first start.

---

## Mute, solo, and what the transition controls now mean

### Mute and solo: a gain ramp, and that is the whole feature

Tapping a row sets that voice's `GainNode` **now**:

```js
g.gain.cancelScheduledValues(now)
g.gain.setValueAtTime(g.gain.value, now)
g.gain.linearRampToValueAtTime(target, now + MUTE_RAMP)   // MUTE_RAMP = 0.015
```

15 ms is instant to the ear and is the difference between a mute and a click. A hard
`gain.value = 0` on a sounding source is a step discontinuity, which is an audible pop — the
engine has `FadeGain`'s ~3 ms micro-fade for the same reason. This is not a compromise on
"immediately"; it is what immediately has to mean.

The POST still goes to the Mac (`/api/slot-action`, unchanged, with its `mute`/`solo` verbs and
its solo-then-mute tap cycle from `a596b39`), so the Mac's own Discover mix follows. But the
phone no longer waits for it, and no longer re-downloads anything when it lands.

**A muted stem keeps sounding silently.** It is not stopped and its buffer is not dropped, so
unmuting is another 15 ms ramp and the stem comes back **in phase**, because it never left the
clock.

**A muted slot's `stemId` goes null, and that is handled without touching `DiscoverPanel`'s
preview.** `syncPreviewToEngine(ids)` builds the preview project from the *previewing* (audible)
set — a muted slot is simply not in the `EngineProject` at all, so main has no `EngineStem` for it
and no `stemId`. The page therefore keeps `wantedStemId[slotId]`: **the last stemId the Mac named
for this row**, cleared only when the row itself disappears. A null is "the Mac is not naming one
right now", never "throw the audio away".

The alternative was considered and rejected: teach `syncPreviewToEngine` to include every
*resolved* slot and express mute as `EngineStem.muted` (which `buildEngineProject` already reads
from `state.mute`). It is arguably the tidier model — the manifest and the row list would finally
have identical membership — but it changes the meaning of a function with a long, documented
history of resolution races (`previewingSlotIdsRef` exists because of one; the barLength override
exists because of another), it makes the Mac's engine load and decode buffers for stems nobody is
listening to, and it buys six lines on the page. **Not worth it.** The one honest cost of the
cheap version: a slot rolled *while muted* gets no new `stemId` until it is unmuted, so unmuting
it waits for one download. Rare, and it degrades in the right direction.

### The swap grid: it survives, and its meaning changes

`e0abb0e` shipped it two commits ago — chips `loop end · 8 bars · 4 bars · 2 bars`, phone-local
in `localStorage` under `sssketch-remote-swap-grid`, no route, no Mac involvement, defaulting to
`loop end` so nobody's phone changes until they touch a chip. **All of that survives verbatim**:
the key, the four values, the default, the storage guards, and `swapPeriod()`'s two hard-won
edges (cap the grid at the loop; step a grid that does not divide the loop *down* to one that
does, so 4 over a 6-bar loop becomes 3 and the downbeats stay put).

What changes is what crosses the boundary. It was *"when does the whole mix swap"*. It is now
*"when can **this stem** change"*. The chips read the same; the sentence "swap every 4 bars" is
still true, and re-labelling shipped copy for its own sake is churn.

**One chip is added, and it is the one that is newly possible: `own loop`.** With per-stem
replacement the most musical boundary is the stem's own loop point, and without it a 2-bar hat
rolled at bar one of an 8-bar loop waits four times longer than it needs to. `own loop`'s period
is that voice's own `dur`; every other setting's period is global. Five chips at `flex: 1 1 0` in
a 390 px column is ~68 px each, still well over the 42 px tap floor the page holds itself to, and
`own loop` is two words.

**The default stays `loop end` (`g: 0`)**, because his phone already has a value stored under
that key and a default that changed under him would be a surprise. `own loop` is the first thing
worth trying.

### The crossfade: `cut` / `short` / `long`

Approved on 2026-09-27 and deliberately not started, because per-stem changes the question. It is
**not dropped** — it is Phase B of the plan, and per-stem is what finally makes it mean something.

A crossfade between two whole mixes is a strange object: the same eleven stems fade out of
themselves and back in, three decibels down in the middle for no reason. A crossfade between
**one outgoing stem and one incoming stem**, under eleven that never move, is an ordinary and
useful musical control.

- **`cut`** — a hard handover at the boundary, with a 5 ms anti-click ramp. The behaviour that
  ships in Phase A, named.
- **`short`** — ⅛ bar. 0.25 s at 120 bpm.
- **`long`** — ½ bar. 1.0 s at 120 bpm.

Bar-relative rather than fixed seconds, so the control means the same thing at 90 bpm and 160;
the page already derives seconds per bar from the buffers, so no new number goes on the wire.

**Equal-power, via `setValueCurveAtTime`, not `linearRampToValueAtTime`.** Two uncorrelated stems
crossfaded linearly dip ~3 dB in the middle — inaudible at `cut`, obvious at `long`. A 64-point
`sqrt` curve costs one `Float32Array` built once, and matches the equal-power convention every
other blend in this codebase already uses (`LoopSewing.cpp`, `LoopBoundaryFade.cpp`).

Phone-local, same shape as the swap grid: three chips, `localStorage` key
`sssketch-remote-xfade`, default `cut` (today's behaviour), guarded reads and writes, no route.
Mute and solo keep their own fixed 15 ms ramp and are **not** governed by this setting — a mute
you asked for should not take a bar to arrive.

---

## `/api/loop` stays, and the page stops calling it

The argument for deleting it is real and worth putting on the record, because it is where the
remaining win is: `/api/loop` is the only reason the phone remote spawns a **second native
engine**. `createRemoteLoopRenderer` holds one warm for the whole session specifically because a
cold spawn is up to 45 s and a render is 1–3 s. Per-stem takes the engine out of the phone's
critical path entirely — no render wait, no 30 s timeout, no respawn-and-retry, no 503.

It stays anyway, untouched, for this pass:

- It is the **only** thing that can render the loop as the Mac's own engine hears it, and it is
  stereo.
- It is built, shipped and tested. Deleting it is not free, and deleting it in the same change
  that introduces twelve new moving parts means that when something sounds wrong there is nothing
  to compare against.
- Keeping it costs one `if` in a route table.

The page simply stops fetching it. **Retiring it — and with it `remoteLoopRenderer`, the warm
engine and the whole render path — is the follow-up**, once he has lived with the stem player for
a week. That is where the tap-to-sound improvement actually lands, and it is a much better change
to make on its own than buried in this one.

Note the consequence in the meantime, honestly: the Mac keeps warming a render engine for a route
nobody calls.

---

## Peaks stay on the Mac

Peaks are pushed today from `peakCache.ts`, quantised to 64 buckets by `quantiseRemotePeaks`,
keyed by slot id. With real audio on the phone they could be computed locally from the decoded
buffer instead.

**They stay as they are.** The Mac's peaks arrive with the poll, *before* the audio does — so a
row draws its shape the moment it resolves, rather than sitting blank until 640 KB has landed and
decoded. Computing them locally would trade a strictly-earlier picture for an imperceptibly more
accurate one: they are 64 amplitude buckets, and time-stretching scales the time axis, which at
64 buckets is invisible. It also keeps one drawing path rather than two.

Worth revisiting only if the Mac's peaks ever turn out to be wrong for a stretched stem, which
they are not.

---

## Failure modes, each with a decided answer

| | what happens |
|---|---|
| **a stem 404s** | that voice plays nothing; its row draws in the muted grey `#6a6a6a`; the status line says `1 stem missing`. The other eleven play. Retried on the next poll, up to 3 attempts per `stemId`, then left alone until the id changes. Falling back to the whole mixdown for one missing stem would be a very large hammer, and hiding it would mean judging an incomplete mix without knowing. |
| **a decode fails** | identical treatment, same attempt counter. Deliberately **not** the analysis caches' "evict on rejection so a transient failure cannot poison it" rule — that rule is for a cache that will be asked again on the next mount; this is a poll running every 700 ms, and an un-counted retry is an infinite download loop. |
| **the set changes mid-flight** | every fetch is tagged with its `stemId`. On landing, the buffer goes into the cache regardless of whether anything still wants it (he may roll back, and it is already paid for); scheduling only happens if some slot's `wantedStemId` still names it. Nothing is keyed by slot index, so three in flight cannot cross. |
| **a slot disappears** | its voice is stopped and disconnected, its `wantedStemId` entry is deleted. Its buffer stays in the cache until the budget evicts it, least-recently-wanted first. |
| **the budget is exceeded** | the voices that fit are played, in manifest order; the status line says `too many stems`. |
| **the tab is backgrounded** | the context suspends; `requestAnimationFrame` stops so the playhead stops; every source resumes in phase because they share one origin. The 700 ms poll may throttle and catches up on return. |
| **the AudioContext needs a gesture** | unchanged and unchangeable. `play` is the gesture, the context is built inside its click handler, once, and kept. There is no autoplay path and there must not be one: a context created on load is suspended and plays silence with no error. |
| **`afconvert` fails or is missing** | the route answers 503 for that stem and it is treated as a 404 above. There is no realistic path to this on macOS, but a spawn that throws must not take the http server down with it. |
| **`discoverOpen` goes false** | every voice is stopped, every buffer dropped, `origin` cleared, transport off — the same unconditional teardown `render()` already performs. |

---

## Constraints this page is built under, restated because they bind every line of it

- **CSP, unchangeable**: `default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';
  font-src data:; connect-src 'self'`. Same-origin fetch only, **no images of any kind**, not even
  a data URI.
- **Dialect, enforced by `remotePage.test.ts`**: no arrow functions, no `??`, no `?.`, no
  `preventDefault`, and **no `opacity` anywhere in the page, comments included** — mute is the
  absence of colour, never a fade.
- Near-black monochrome, no `border-radius`, lowercase, no emoji, no exclamation marks, buttons
  two words or an icon, ~42 px tap targets, 390×844, `env(safe-area-inset-*)`, iOS Safari and
  Brave.
- Colour is spent only on things carrying audio information. This feature adds no colour.
- The page is one string constant with no bundler, so it cannot import from `src/shared/`.
  Everything pure that can live outside it, does.

**Out of scope entirely: the pair screen and the wrong-address notice page.** Neither is touched.

---

## Not now

Each of these is a real idea, deliberately left out so this ships as something he can use.

- **Retiring `/api/loop`, `remoteLoopRenderer` and the warm render engine.** The follow-up, and
  the biggest remaining win. Argued above.
- **A per-slot gain fader on the phone.** Baking `volume` into the stem forecloses nothing: the
  `GainNode` per voice is already there and already the right place for it.
- **Computing peaks on the phone.** Argued above.
- **Stereo.** One constant on the Mac (`-c 1` → `-c 2`) and a doubled memory table. Worth
  revisiting only after he has heard mono on the sofa.
- **Pre-fetching a roll before he asks for it.** Already on the 2026-09-26 spec's "not now" list;
  per-stem makes it cheaper but no less speculative.
- **Applying the Mac's master or channel plugins.** `phoneLoopProject` strips them for a stated
  reason and the per-stem path inherits it; the phone hears the stems dry, at their gains, at the
  project tempo. Same known limit as today.
- **Radio mode on the phone.** Explicitly ruled out in the 2026-09-27 design brief: "Do not add
  speculative UI for it."
- **Seeking or scrubbing.** The playhead is an indicator, in two independent ways (the lane and
  the line are both `pointer-events: none`, and no listener is attached to either). Do not add a
  seek.
- **More than one phone.**

---

## What could not be settled here

1. **Whether iOS Safari's `decodeAudioData` accepts ALAC in `.m4a`.** It should — it is Apple's
   codec, in Apple's container, decoded by AudioToolbox, which is the same path a WAV takes. But
   nobody on this end can hold an iPhone, and this is the one assumption that, if wrong, takes the
   feature with it. **It is therefore the very first manual checkpoint of the plan**, before any
   page work, and the fallback is one constant: `-f m4af -d alac` → `-f WAVE -d LEI16@48000`,
   which is guaranteed to decode and costs 2.4× the bytes.
2. **Whether mono is acceptable to his ears.** The memory table says it should be, and a phone
   speaker is one driver, but he may be on earbuds. One constant on the Mac.
3. **Whether `cut` at a 2-bar grid is musical or jarring** when one stem changes under eleven.
   The reason the crossfade exists, and the reason it is Phase B rather than a guess baked into
   Phase A.
4. **What ~7.7 MB of first load actually feels like over Tailscale on LTE**, as against 2.82 MB
   plus a 1–3 s render. The arithmetic says roughly even; the arithmetic is not a measurement.
5. **Whether `own loop` should be the default.** It is the most musical setting and the argument
   for it is strong, but the existing default is stored on his phone and this spec will not change
   a value under him.
6. **Whether the seam blend is audible at all on his material.** Endlesss stems are recorded to a
   loop and mostly already meet themselves; the engine applies it unconditionally anyway, and so
   does this.
7. **Nothing about how any of this sounds.** This environment has no GUI and no audio tooling. No
   claim in this spec about audible behaviour has been heard by anyone.
