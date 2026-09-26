# The phone plays the loop

Date: 2026-09-26
Status: decided in chat with Elling, then grounded against the real code; awaiting his walkthrough

A follow-on to `2026-09-26-discovered-library-design.md` — specifically to its Part 2, the phone
remote. That spec said, in as many words:

> Audio stays on the Mac — he wears Bluetooth headphones connected to the computer. **The phone
> is a controller, not an audio client.**

That is the sentence this spec revokes. Everything else in Part 2 stands: the pairing code, the
token, the Host guard, the off-by-default server, the four verbs, the page as a string.

His words for what changes:

> "just discover loops"

> "show the position on the audio file with the progress line but unclickable"

> "phone audio distinct from the app"

So: the phone plays the current Discover loop out of its own output, with a progress line that
tracks position and cannot be dragged. Not the live transport — Discover loops and nothing else.

Elling's governing instruction from the parent spec still applies verbatim: *"keep it simple to
start bit functional... minimum lovable product."* Every section has a **not now** counterpart.
If something is not named as in, it is out.

---

## The approach: render it, serve it, let the phone loop it

**Discover plays a fixed loop of a few bars. There is nothing to stream.**

So the Mac renders that loop to a WAV, the phone fetches it once, and the phone loops it from
memory. Once the bytes are on the phone, playback has no jitter, no drift, no clock to
synchronise and no network in the path at all. The progress line comes off the phone's own audio
clock, which is the only clock that has any authority over what the phone is actually making
audible.

The render path already exists and is not new work: `render-export`
(`native-engine/Source/IpcServer.cpp:844`) renders whatever project was last `load-project`ed to
a WAV file, and `renderToolkitAudio` (`src/main/exportToolkitAudio.ts:190-245`) already drives it
in exactly the shape this needs — spawn an engine, `load-project`, `render-export`, repeat.

**No native-engine change is needed anywhere in this design.** That was checked rather than
assumed, and here is the check:

| what this needs | what already exists |
|---|---|
| render a Discover loop offline | `render-export` takes `{ outputPath, durationBars }` and renders `currentProjectForExport()` — `IpcServer.cpp:844-861` |
| a WAV a phone browser can decode | `RenderExport.cpp:92-102` writes 44100 Hz, 2 channels, **16-bit** WAV via `juce::WavAudioFormat` |
| the exact project Discover is previewing | the renderer already builds it — `DiscoverPanel.tsx:858`, `buildEngineProject(previewState, …)` |
| how long the loop is | `EngineProject.loopLengthBars`, which for a Discover preview is exactly the loop's own bar length (`startBar: 0`, one rifff, no `playedBars`) |
| a second engine, so live playback is undisturbed | `spawnEngine()` is stateless and portless-by-default (`engineProcess.ts:141`); `nativeExport`, `exportToolkitAudio`, `exportAudioMaterialization` and `bakeOffset` all already spawn their own alongside the playback engine |

Nothing in that column is missing, partial, or needs a new message type. `EngineProject` and
`buildEngineProject.ts` are the hand-synced pair CLAUDE.md warns about, and **neither side is
touched** — this feature only ever *consumes* a project the renderer already built.

### Considered and rejected: streaming the engine's live output

Tapping the engine's live mix and pushing audio blocks to the phone would mean: a tap in the
audio thread, blocks crossing the process boundary, a transport-format decision, buffering, and
playback scheduling on the phone against a clock that is not its own. That is real work in the
one place in this codebase where real work is dangerous — the audio thread — and it buys
"live", which a fixed four-bar loop does not need and cannot benefit from. A loop that repeats
forever is fully described by its first repetition.

It is also the strictly worse experience for the thing he is actually doing: judging a loop over
Bluetooth from the sofa, where a stream's jitter and a stream's latency are both audible and a
file's are both zero.

Not re-litigated. If some future feature wants the *live transport* on the phone — the real
arrangement, playing, from the sofa — that is a different spec with a different budget, and it
should start from this paragraph rather than from scratch.

### Considered and rejected: an `<audio loop>` element

Safari puts an audible gap at the loop point of an `<audio>` element. That gap would land on
every bar-1 downbeat, forever, in the exact judgement he is using this to make. It would not be
a rough edge; it would be the loudest thing on the page.

`decodeAudioData` into an `AudioBufferSourceNode` with `loop = true` is sample-accurate — the
wrap happens inside the audio graph, not in a media element's playback engine. That is the whole
reason for the choice, and it brings two things along for free:

- **the progress line has a real clock.** `ctx.currentTime` advances with the audio, so the line
  is showing where the sound is, not where a timer thinks it should be.
- **the server never needs to speak media.** A media element demands HTTP byte-range support
  from Safari; a `fetch` does not. So `GET /api/loop` is an ordinary 200 with a body, and
  `remoteServer.ts` gains no range-request handling, no partial content, no `Accept-Ranges`.

**iOS requires a user gesture before an AudioContext will produce sound.** The page's existing
`play` button is that gesture: the `AudioContext` is constructed inside its click handler, once,
and kept for the session. There is no autoplay path and there must not be one — a page that
tries to start audio on load gets a suspended context and silence with no error.

---

## What the page becomes

```
  sssketch
  side quest
  kept 3 · rolled 11

  drummy     wooden thud
  bassish    late sub
  sparkly    glass bell
  buttery    long pad

  ─────────────·──────────────────────────

  [ roll all ]   [ play ]   [ keep ]
  mac playing
```

One new element: the track, and the line travelling across it. Everything above it is unchanged.

### The progress line

- **One pixel wide, `#c56164`** — the hand-copied literal for `--ra-playhead`, the same accent
  `Playhead.tsx` uses on the real timeline and the same one `DiscoverPanel.tsx:3986` already
  draws over a previewing slot's waveform. This is one of the few places colour is allowed,
  because it carries audio information.
- **Driven by `ctx.currentTime - startedAt`, modulo `buffer.duration`**, in a
  `requestAnimationFrame` loop. Nothing about its position comes from the Mac. There are no
  position messages, no clock sync, and no field in `RemoteState` that says where the playhead
  is.
- **Unclickable, in two independent ways**: the track has `pointer-events: none`, and no
  listener of any kind is attached to it or to the line. There is no seek, no drag, no tap-to-
  jump. It is an indicator. Both guarantees are stated because either alone could be undone by
  accident later.
- It is hidden when nothing is playing rather than parked at zero — a line sitting at the left
  edge reads as "about to start", which is a lie when the context is suspended.
- The track is a bare 1px rule under the slot rows, in the chrome grey the rows already use. No
  waveform behind it (see **not now**).

### The play button now means the phone

`play` starts the phone's own playback and `stop` stops it. The button's label is driven by the
phone's local state, not by anything the Mac reports.

**The Mac is not touched.** Per Elling, directly: *"phone audio distinct from the app."* The two
outputs are independent and that is intended, not a bug to fix:

- the phone playing does not pause, mute, or otherwise reach into the Mac's transport;
- the Mac playing does not stop the phone;
- if both are going at once he hears both, out of phase, and that is a thing he chose to be
  possible.

The naive reading of this feature is that simultaneous playback is a doubling bug. It is not.
Say so plainly wherever it comes up, because the instinct to "fix" it will recur.

The one concession to that reality: **`mac playing` appears in the eyebrow whenever the Mac's
transport is running.** `RemoteState.playing` is already pushed and already polled, so this is
two lines and no new plumbing. It is information, not control — it tells him why he can hear
something from the other room.

### What leaves: the phone can no longer drive the Mac's transport

`POST /api/transport` and the `transport` variant of `RemoteCommand` are **removed**. One button
cannot mean two outputs, and the three-button row has no space for a second.

This is a removal of something that shipped last night, so state the loss honestly: from the
sofa he can no longer start or stop the Mac's own playback. He should not need to — the sound is
now in his hand. If he misses it, it is one route and one button away, and it is named in **not
now**.

`RemoteState.playing` stays (it feeds the eyebrow above). `RemoteCommand` drops from four verbs
to three: `roll-slot`, `roll-all`, `keep`.

---

## Format: WAV, exactly as the engine already writes it

44100 Hz, stereo, 16-bit PCM — `RenderExport.cpp:92-102`, unchanged and unparameterised.

**No encoder exists in this codebase and none is added.** There is no ffmpeg, no lame, no opus
binding, and no reason to acquire one: a Discover loop is a few bars.

The arithmetic, at 44100/2/16 (176.4 kB per second of audio):

| loop | seconds at 120 bpm | bytes |
|---|---|---|
| 1 bar | 2.0 | 353 kB |
| 4 bars | 8.0 | 1.4 MB |
| 8 bars | 16.0 | 2.8 MB |
| 32 bars (the sanity cap) | 64.0 | 11.3 MB |

Over a home 5 GHz LAN, 1.4 MB is on the order of a tenth of a second. `decodeAudioData` on a
modern iPhone handles a WAV of that size in well under that again. Compression would save
perhaps 90% of a transfer that is already not the bottleneck, in exchange for a dependency, a
build step, and a quality question nobody asked.

`durationBars` comes from `phoneProject.loopLengthBars` and is **clamped to 32 bars**. That
ceiling is not expected to bind — Discover loops are 1, 2, 4 or 8 bars, set by the longest
resolved stem — it exists so that a malformed or absurd `loopLengthBars` cannot ask the engine
for a gigabyte.

### The render is one pass, not a merge

He asked: *"will it be slow to render and merge those files though"*. There is **no merge step**.
The engine loads the whole loop as one project — several stems on one rifff, each with its own
gain — and renders the mix in a single offline pass, exactly as an export does. Several stems
in, one file out. Nothing is rendered per stem and nothing is combined afterwards.

---

## When the render happens: on demand, with one warm engine

### The cost is the spawn, not the render

Measured from tonight's real CI logs, `nativeExport.test.ts`'s render tests take **1.2–3.7
seconds each**, and every one of them spawns a fresh engine (`spawnEngine()`, and
`exportToolkitAudio.ts:190` does the same). A few bars of offline render is far faster than
realtime; the process spawn dominates that number completely.

Spawning per roll would put one to three seconds between tapping and hearing. That would ruin
the roll/keep loop this whole feature exists for.

So: **one render engine, spawned when the phone remote is switched on, held for the session,
torn down when it is switched off or the app quits.** Each render then costs `load-project` plus
the render itself.

- **It is a separate engine from the app's playback engine.** `playbackEngineLifecycle.ts` owns
  the single session-long engine that is busy playing; a `render-export` on it would fight live
  playback, and its own doc comment says exactly that ("they must not share a
  PlaybackEngine/currentProject, since an export's load-project would clobber whatever's
  currently playing"). Spawning a second engine alongside it is not a new pattern — four
  existing modules already do it.
- **Spawning is not blocking.** `start-phone-remote` kicks the spawn off and returns; the first
  render awaits it. `READINESS_TIMEOUT_MS` is 45s for cold-start reasons documented at length in
  `engineProcess.ts`, and the gear menu must not sit on that.
- **If that engine dies mid-session** — crash, or a socket that closes under it — the next
  render notices the failed send, drops the dead handle, spawns a fresh one, and retries **once**.
  A second failure answers the route with 503 and the phone shows `render failed`. It does not
  retry in a loop and it does not take the remote server down with it.
- **A render has a 30-second ceiling**, not `nativeExport`'s ten minutes. Somebody is standing in
  another room holding a phone; ten minutes is not a timeout, it is a hang.

### On demand, not on every roll

The phone asks for audio; the Mac does not push it.

He rolls repeatedly and listens to each one, so in practice almost every roll gets rendered
anyway — but "almost" is doing real work here. A burst of slot resolutions produces several
project rebuilds in a few hundred milliseconds (`reportSlotResolution` fires per slot, coalesced
through a rAF), and a roll he never hears because he rolled again should never cost a render. On
demand gets that for free, with no scheduling, no debounce, and no cancelling of an in-flight
render when a newer roll lands.

It also means the whole thing costs nothing at all while he is not playing. Rolling with the
phone stopped renders no audio.

Two overlapping requests for the same loop share one render — a single in-flight promise, not
two engine round trips.

### Expected latency, as a prediction

**Tap to sound: on the order of 0.3–0.8 seconds**, warm.

That is `load-project` (milliseconds — the stems are already on disk, and any time-stretched
variants were already resolved and written by the Mac's own preview) plus an offline render of a
few seconds of audio at many times realtime, plus a 1.4 MB LAN transfer, plus a decode.

**This is a prediction, not a measurement.** Nobody in this session can run it on his machine
or his network. If it is wrong it will be wrong in the direction of the spawn still costing
something the first time, and the honest fallback is in **could not settle**.

---

## Caching: exactly one loop

The loop currently held, and its rendered bytes. That is the whole cache.

**It is not keyed by `discoveredGroupKey`.** That helper is deliberately blind to gain and to
order — its own doc comment says so: *"The same five stems balanced differently are the same
discovery."* True for a discovery; false for audio. Two mixes of the same stems at different
gains are the same discovery and different sounds, and serving one for the other would be a bug
that is nearly impossible to notice and nearly impossible to explain.

Instead, the key is a **fingerprint of the project as the phone will actually hear it**:

- `assembleDiscoverRifff` mints `groupId = crypto.randomUUID()` on **every** rebuild, and
  `stemKey` embeds that groupId. So a naive hash of the project JSON would change on every
  rebuild even when nothing audible changed — and Discover rebuilds constantly (every slot
  resolution, every mute toggle, every bpm change). The phone would refetch identical audio
  several times a second. **The fingerprint therefore ignores `groupId`, `stemKey` and
  `channelId`, and sorts the stems**, because summing is commutative and slot order is not audio.
- Everything that *is* audio is in it: bpm, loop length, and per stem the resolved path, volume,
  mute, bar length, played bars, crop, offset, one-shot flag and trims.

The fingerprint is hashed to a 16-character hex `loopId`, which is what the phone sees. Comparing
that against the one it has playing is the whole "has the loop changed" test.

**One entry, not an LRU.** Discover has no history — there is no way to go back to the previous
roll — so a second cache entry could never be hit. What the one entry does buy is the case that
actually happens: stop, think, play again. That is free instead of a re-render. With a warm
engine a re-render would only be a few hundred milliseconds, but a few hundred milliseconds of
nothing after pressing play reads as broken, and the cache is five lines.

---

## Cleanup: nothing outlives a render

`render-export` writes to a file, so a file is written. It is then read into memory and deleted
immediately — the cache holds **bytes, not a path**.

- **Where:** `app.getPath('temp')/sssketch-phone-loop/<loopId>.wav`.
- **Who deletes it, and when:** the render itself, in a `finally`, as soon as the bytes are read.
  A render that fails deletes its partial file the same way.
- **The directory** is removed when the phone remote is switched off and on `will-quit` (where
  `remoteServer?.stop()` already runs), and swept on start so a previous crash leaves nothing
  behind.
- **Memory:** one loop, 1.4 MB for a typical four-bar mix. Dropped when the remote stops.

So at rest — remote on, phone idle — this feature owns one engine process and nothing on disk.

---

## Security

The audio route is behind both existing gates, in the existing order, and adds no new ones.

**`GET /api/loop`** sits below `if (!authorized(req)) return respond(res, 401)` in
`remoteServer.ts`, so it is unreachable without a paired token, and below `isAllowedHost`, so it
is unreachable from a rebound DNS name. An unauthenticated request for it gets the same empty 401
as any other path, revealing nothing.

**It takes no parameters at all.** Not a path, not an id, not a query string. It serves whatever
loop is current and names it in an `x-loop-id` response header; the phone reads that header to
learn which one it got. There is nothing to validate, nothing to traverse, no stale-id case, and
no way to address anything but "now". A route with no input cannot be given a bad one.

- **200** with `content-type: audio/wav`, `cache-control: no-store`, and the bytes.
- **204** when there is no current loop (Discover closed, or nothing resolved yet). The phone
  says `nothing to play`.
- **503** when the render failed after its one retry.

**No path ever leaves the Mac, and `remoteState.test.ts`'s standing assertion still holds.** The
snapshot the renderer pushes (`RemoteState`, built by `remoteStateFromSlots`) is unchanged and
still contains no path. What `/api/state` answers gains exactly one field, `loopId`, injected by
main: sixteen hex characters. The project full of real filesystem paths lives only in main, is
never serialised to any route, and reaches main over Electron IPC, not HTTP.

The one honest caveat: a digest is a confirmation oracle. Somebody who already knew the exact set
of paths, gains, bpm and bars could confirm a guess by recomputing the hash. They would need the
paired token to see the digest at all, and if they have that they can already roll dice and save
a rifff. This does not move the blast radius.

**The page's CSP does not change.** `decodeAudioData` is fed from a `fetch`, which is governed by
`connect-src 'self'` — already there. There is no media element, so no `media-src` is needed.
`REMOTE_PAGE_CSP` is untouched.

---

## What ships (the minimum)

1. `GET /api/loop` — authenticated, parameterless, serves the current Discover loop as a WAV.
2. One warm render engine, held for the phone-remote session, separate from playback.
3. A one-entry cache keyed by an audio-accurate fingerprint of the loop.
4. The phone plays it with Web Audio, looping, started by the existing `play` button's gesture.
5. A one-pixel `#c56164` progress line driven by the phone's own audio clock, unclickable.
6. `mac playing` in the eyebrow when the Mac's transport is also running.
7. `POST /api/transport` and the `transport` command removed.

## Not now

- **Live streaming of the real transport.** Rejected above, with reasons, for this scope.
- **Seeking or scrubbing of any kind.** He asked for unclickable and this spec means it.
- **A waveform behind the progress line.** The desktop draws the playhead over a waveform; the
  phone draws it over a rule. A waveform needs peaks, which needs a decode, which needs another
  route or another payload.
- **Pre-rendering a roll before he asks for it.** Speculative work, scheduling, and cancellation,
  to save a few hundred milliseconds that may already be imperceptible.
- **Anything but a Discover loop.** Not the arrangement, not the shelf, not a library preview.
  *"just discover loops."*
- **Compressed audio.** No encoder, no need.
- **Stopping the Mac's playback from the phone.** Removed deliberately; one route and one button
  away if he misses it.
- **Per-slot mute or solo, or a gain fader, from the phone.** Still out, as in the parent spec.
- **Keeping audio alive when the screen locks.** iOS suspends the AudioContext when the page is
  backgrounded or the phone locks; the loop stops and resumes when he comes back. A silent
  keep-alive element or a Media Session is a real technique and a real amount of fiddling.
- **A volume control on the page.** The phone has hardware buttons.
- **A bar counter, a bpm readout, or a time display.** The line is the display.
- **More than one phone**, as before.

---

## Could not settle

- **Whether the phone should hear the master chain and channel plugins.** It will not: the
  render strips them, exactly as `exportToolkitAudio`'s `dryOfPlugins` does, and for a sharper
  reason than the bake had. The Discover preview passes no `pluginStates` to
  `buildEngineProject` (three arguments, not four — `DiscoverPanel.tsx:858`), so a *fresh* render
  engine would instantiate every plugin at its default state. That is not what the Mac sounds
  like; it is a third sound belonging to neither. Dry is at least honestly "the stems, at their
  gains, at the project tempo," which is what a Discover judgement is about. But if he has a
  master chain running while he rolls, the phone will not match the room, and he will hear that
  before he reads this.
- **Whether 0.3–0.8 seconds is right.** It is a prediction. If the real number is bad, the first
  things to look at, in order: whether the spawn is genuinely warm (log the render duration
  separately from the total), whether the LAN transfer is the cost (it is 1.4 MB), and whether
  the loop should be rendered the moment it changes rather than when the phone asks.
- **Whether the iOS mute switch will bite.** Web Audio on iOS plays through the ringer channel
  and is silenced by the hardware switch. The page sets `navigator.audioSession.type =
  'playback'` where it exists (Safari 16.4+), which asks iOS to ignore the switch — guarded in a
  try/catch because it does not exist everywhere. If he gets silence with a moving progress line,
  the switch is the first thing to check, and that is not a bug anyone can fix from here.
- **Whether a reroll should restart the loop or crossfade into it.** It restarts, from zero, with
  no fade. That matches what the desktop does on an *empty-to-loaded* transition
  (`engineSetPosition(0)`), but not what it does on a rebuild of an already-loaded preview, which
  keeps playing through. Matching the desktop exactly would mean starting the new buffer at the
  old one's phase, which is three lines and might be lovely or might be worse. Restart is the
  simpler thing to have wrong.
- **Whether `mac playing` earns its line.** It exists because doubling is now possible on
  purpose and unexplained doubling is maddening. It may also just be clutter on a four-line page.

---

## Testing

Pure logic in `src/shared/` is TDD'd, as ever. That is exactly one new module here: the loop
fingerprint and the strip-to-what-the-phone-hears transform. Its tests are the interesting ones,
because they encode the two non-obvious facts:

- two projects differing **only** in `groupId`/`stemKey` fingerprint identically (otherwise the
  phone refetches several times a second);
- two projects differing **only** in one stem's gain fingerprint differently (otherwise
  `discoveredGroupKey`'s gain-blindness would have been fine and it is not).

The render module is tested against the **real compiled engine**, following
`exportToolkitAudio.test.ts`'s pattern exactly — the narrow `vi.mock('electron', …)` stand-in and
a real spawn, never a fake engine. Two cases: a one-stem project renders to a 44100/2/16 WAV of
roughly the right length, and a second request for the same loop id returns the identical buffer
object, which is only possible from the cache.

**This plan opens no SQLite database, so `vitest.config.ts`'s CI exclusion list is untouched.**
Worth saying out loud: adding a main-process test file that loads better-sqlite3 without adding
it to that list is what made the v1.2.0 release unshippable. Nothing here goes near it.

**What cannot be verified from this environment, and must not be claimed:**

- whether the loop actually sounds gapless on his phone — the entire reason for choosing Web
  Audio over an `<audio>` element is a Safari behaviour no agent here can hear;
- whether the progress line reads clearly at arm's length in a dark room, or whether one pixel is
  too thin on a phone;
- whether tap-to-sound is fast enough to keep the roll/keep loop enjoyable, which is the only
  real requirement;
- whether the iOS mute switch or a screen lock gets in the way in practice;
- whether the phone and the Mac both playing is as tolerable as "distinct" implies once he is
  actually sitting between them;
- any claim about how any of it sounds.

React components are not unit-tested in this codebase, and the phone page is a string served to a
real mobile browser that nothing in this environment can open, tap, or hear. Nothing in a build
log covers any of the above.
