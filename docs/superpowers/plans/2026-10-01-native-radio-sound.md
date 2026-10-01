# Native radio sound: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Discover radio in the app sounds like `ell.ing/radio`. Port the web radio's sound into the native engine:
- **Sound:** per-row panning, the cavernous reverb, and riser variety.
- **Glue:** dub throws, tape saturation, the drum-keyed pump, the glue compressor, and a −1 dBTP true-peak limiter.

Elling approved the port on 2026-10-01.

**Architecture:**
- **Pure rules are shared, not copied.** The radio repo's pure rules move into `src/shared/`, where the radio repo already imports from (`@shared`). Both the web page and the app's renderer then use them. They decide pan per slot, pump role per slot, when throws happen, and each riser's character.
- **The wire carries what the rules decide.** New optional fields go on `EngineProject`. Each one is absent by default, and absence means today's behaviour, bit for bit (the toolkit's "absence is load-bearing" rule). Discover's preview project turns them on.
- **The engine performs it per sample.** Throws ride the project as per-stem automation curves, the same way radio's gestures already do. This keeps the 30 Hz React clock out of the timed path.
- **Master DSP comes from the web's own Faust sources, compiled to C++.** Saturation, glue, pump and the true-peak limiter are compiled with the Faust compiler's C++ backend. The generated code is committed, with golden vectors from the web's wasm proving it is the same DSP.
- **Some parts are hand-written C++.** The reverb (the web's default is a generated-IR convolver, not Faust), the dub delay, the panner and the riser changes are written by hand.

**Tech stack:** C++20, JUCE 8.0.4 (`juce_dsp`), JUCE `UnitTest`, the Faust compiler (build-time only), TypeScript, vitest.

**References:**
- Web spec §3: `~/Claudecode/ell.ing/radio/docs/specs/2026-09-30-radio-a-design.md`. It lists every stage and its measured targets.
- Web sources: `src/audio/{engine,rowVoice,masterChain,riserVoice,riserCharacter,dubDelay,gestures,noise}.ts`, `src/audio/faust/*.dsp`, `src/radio/{pan,pump,throws}.ts`.

---

## Decisions Elling needs to make (before Task 2)

| # | question | recommendation |
|---|---|---|
| D1 | Where does the radio sound apply? Discover's preview only while radio is on, Discover's preview always, or the arranger timeline too? | **Discover's preview, always** (radio on or off). The rows are slots in both cases. The timeline is untouched. |
| D2 | Should mastering (the headroom trim, glue, saturation and limiter) reach the timeline or render-export? | **No.** Discover's preview only for now. Add a project toggle later if he wants it on bounces. |
| D3 | Discover's reverb: should the cavernous convolver replace zita there? | **Yes, in Discover only.** The timeline's zita reverb and its three controls are unchanged. |
| D4 | Where do the `.dsp` files live? | **Move them into sssketch** at `native-engine/Source/dsp/faust/`. The radio repo's `build-faust.mjs` reads them from `../../sssketch`, as it already does for `@shared`. One copy, no drift. |
| D5 | Can a native Faust compiler be installed on the dev Mac (`brew install faust` gives 2.85.9; GRAME's release page has 2.89.2, the web's version)? | **Yes, and pin 2.89.2** if it installs cleanly. If not, the fallback is a hand port of the four DSPs against the same golden vectors (see "Faust vs C++"). |

---

## Ground rules

- **Read first:**
  - `CLAUDE.md`, especially "Wire format twins" and the engine rebuild/relaunch rule.
  - `native-engine/Source/PlaybackEngine.h`, the comments on `renderBlock` and `ProjectSnapshot`.
  - `ReverbBus.h`, `NoiseRiser.h`, and the gesture block in `DiscoverPanel.tsx`. Find that block by searching for `const gestureList: RadioGesture[]`.
- **Staging:** stage explicit paths only. Never `git add -A`.
- **Line numbers drift.** `DiscoverPanel.tsx` is about 8,800 lines. Anchor on quoted code and grep.
- **After every task:**
  - `npm run typecheck`, `npx vitest run`, and eslint on the changed files are clean.
  - `cd native-engine && cmake --build build`, then `…/sssketch-engine --test` ends with `All unit tests passed.`
  - On 2026-10-01 the native suite was 269 tests, all passing, in 3.1 s.
- **Nothing changes until it is asked for.** Every new wire field is optional. With it absent, the engine's output is bit-identical to today's, and a test pins that for each field. The existing live-equals-export and block-split parity tests must stay green untouched.
- **Live and export must match.** Any master-stage DSP runs in both `Transport.cpp` (live) and `RenderExport.cpp` (bounce), in the same order. It also has to be block-size invariant, because Transport splits blocks at loop tops.
- **No allocation on the audio thread** for anything bigger than today's precedent: zita's lazy ~100 ms of lines. The convolver's IR and partitions are built on the message thread, in `setProject`/`stageProject`.
- **The library DBs are not touched.** Nothing in this plan opens them.
- **No agent can hear the output.** Never claim a sound "works". Every task that changes sound ends with items for Elling's listening list.
- **Commits.** End every commit message with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Y5WKV5FKJn5tyvHsfmELBA
  ```

---

## The engine as it stands (read 2026-10-01)

**Build and tests.** CMake + JUCE 8.0.4 `juce_add_gui_app`.
- Build: `cd native-engine && cmake -B build && cmake --build build`.
- Tests: `native-engine/build/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine --test` runs JUCE `UnitTest`s compiled into the same binary. Each `FooTests.cpp` is listed in `CMakeLists.txt`.
- An end-to-end render-parity test in vitest drives the binary: `native-engine/test/parity/`.

**The signal path today** (`PlaybackEngine::renderBlock`, then the caller):

```
per stem:  samples x fades x volume x mute regions
           -> [if toolkit] own buffer: ChannelFilter -> volume curve -> reverbBus.addSend (post-fader) -> channel
           -> [else]       straight into the channel
per channel: sum (+ RiserVoice noise, rendered into the channel, no send)
           -> channel plugin chain (2 slots) -> master sum
master:    + ReverbBus wet (zita-rev1, lazily built, 100% wet)
           -> master filter (ChannelFilter, bypassed when neutral)
caller:    Transport: masterChain (4 user plugin slots) -> reposition fade -> device
           RenderExport: masterChain -> WAV
```

- **No pan.** A stereo stem passes L/R as is. A mono stem is copied to both sides.
- **No master level in the engine.** The renderer scales stem gains and volume curves (`masterScaledGains` and `masterScaledCurve` in `src/shared/performanceDeck.ts`).
- **No mastering.** There is no headroom trim, compressor, saturation or limiter. A dense mix can pass 0 dBFS, and `NoiseRiser.h`'s comment on `kRiserBandpassNormalisation` records a bounce clipping exactly this way.
- **The reverb exists:** one shared zita-rev1 FDN (`ReverbBus`), fed by per-clip post-fader sends.
  - Its settings are `roomSize` (rtmid 0.5–8 s, log), `damping` (fdamp 20 kHz–1.5 kHz) and `preDelayMs` (20–115 ms).
  - rtlow is fixed at 1.5 × rtmid.
  - Discover sends every stem an equal static amount (`masterSendsFor`). A bloom is a `reverbSend` curve on one stem.

**How gestures are scheduled.** All of it is renderer-side data. The engine has no notion of "radio".
- `DiscoverPanel` turns the armed gesture into project data:
  - hole and drop-out become `volume` curves;
  - duck becomes `volume` curves on every other stem;
  - filter in becomes a `filterCutoff` curve;
  - bloom becomes a `reverbSend` curve;
  - riser becomes an `EngineRiser` from `buildTransitionRiser`.
- The builders live in `src/shared/radioTransition.ts`.
- Curves are anchored at loop bar 0 and play every lap until a later sync clears them.
- A change plus its arrival gesture goes out as a **staged project** (`stageProject`). `Transport::applyStagedProjectAtWrap` promotes it exactly at the loop top.

**The preview's shape matters.** Discover's preview is one rifff on one channel (its `groupId`). Each row is a stem keyed `stemKey(groupId, i + 1)`. So everything per row (pan, pump role, throw send) must be a **per-stem** field. A per-channel field would hit every row at once.

**Wire twins.** `EngineProject.h`/`EngineProject.cpp` (parse) and `src/shared/buildEngineProject.ts` are hand-synced. Each field added below touches both, plus `EngineProjectTests.cpp` and `buildEngineProject.test.ts`.

---

## Faust vs C++

**What was checked.** On 2026-10-01 the radio repo's pinned `@grame/faustwasm` 0.18.5 (libfaust 2.89.2) was asked for C++:
- `generateAuxFiles(name, code, '-lang cpp …')` fails with `-lang cpp not supported since CPP backend is not built`.
- `-lang c` and `-lang rust` fail the same way.
- `-lang cmajor-hybrid` hits an internal assert on `saturate.dsp`.

**So faustwasm cannot emit the C++.** A native Faust compiler is needed as a build-time tool:
- Homebrew's formula is 2.85.9.
- GRAME publishes 2.89.2 on its release page.
- Nothing from the compiler ships.

**Licences.**
- The five `.dsp` files are written from Faust primitives only (no `import`, no `stdfaust.lib`) and declare GPL-2.0-or-later.
- Faust's documentation states that the generated code carries the licence of the DSP source, not the compiler's.
- sssketch is GPL-3.0-or-later. GPL-2.0-or-later code can be combined into it under v3. Elling also wrote both.
- **One thing to avoid:** Faust's stock architecture headers (`faust/dsp/dsp.h`, `faust/gui/UI.h`, `faust/gui/meta.h`) carry GRAME's own licence terms. Compile with `-i` against **our own minimal architecture file** that defines the tiny `dsp`, `UI` and `Meta` bases, so no GRAME file enters the tree.
- The licence file for this lives beside the generated code (see Task 1).

| | Faust → C++ (recommended for the four) | hand-written C++ |
|---|---|---|
| same sound as the web | the same DSP graph, compiled. Golden vectors from the wasm match to float rounding | a re-derivation; drift possible in exactly the details Elling tuned by ear (soft knee, dual-envelope release, true-peak taps, box-average attack) |
| effort | a script, an architecture file, a thin wrapper per DSP | ~40 lines (truepeak) to ~20 (glue, pump) and ~10 (saturate) each, plus the same tests |
| readability | generated code (`fRec0[2]`…) is opaque. Vendored and compiled with `-w`, like zita | in the codebase's commented style |
| future tuning | edit the `.dsp`, recompile both targets: one source | edit two implementations and keep them in step |
| toolchain risk | needs the native compiler (D5). Version skew between 2.85.9 and 2.89.2 changes code generation, not semantics: primitives only. Golden vectors catch any difference | none |
| real-time safety | Faust C++ never allocates in `compute()`. State is member arrays, so the object is heap-allocated off the audio thread | same discipline by hand |

**Recommendation.**
- **Use Faust → C++ for `saturate`, `glue`, `truepeak` and `pump`.** The generated `.cpp` files are committed (as the web commits its `.wasm`), with a regeneration script and a drift check that runs when the compiler is installed.
- **Do not port `reverb.dsp`.** It is the web's A/B candidate, not its default. Elling's verdict was "sounds a bit different". Port the **convolver** he chose: a C++ twin of `noise.ts` `reverbImpulse` plus a hand-written uniformly partitioned FFT convolver. If he later picks the Faust room on the web, the same pipeline gives it to native for free.
- **Golden vectors make either route safe.** If D5 is a no-go, hand-port the four DSPs and hold them to the same vectors.

---

## File map

| path | responsibility |
|---|---|
| `src/shared/radioPan.ts` (+test) | `panForSlots`, `ROW_PAN`, moved from radio `src/radio/pan.ts` |
| `src/shared/radioPump.ts` (+test) | `pumpRoleFor`, `PumpRole`, moved from radio `src/radio/pump.ts` and `audio/engine.ts` |
| `src/shared/radioThrows.ts` (+test) | `stepThrows`, `throwDelaySec`, `throwTailSec`, `THROW_*`, moved from radio `src/radio/throws.ts` and `audio/dubDelay.ts` |
| `src/shared/riserCharacter.ts` (+test) | `drawRiserCharacter`, `RISER_RANGES`, `RISER_BEFORE`, moved from radio `src/audio/riserCharacter.ts` |
| `src/shared/radioSound.ts` (+test) | the shared numbers both engines cite: `REVERB_IR` (T60 table, 30 ms), `REVERB_RETURN_DB`, `MASTERING`, `DUB_*`. Each has a C++ twin pinned by a native test |
| `native-engine/Source/dsp/faust/*.dsp` | the five DSPs, moved here from the radio repo (D4) |
| `native-engine/Source/dsp/faust/arch.cpp`, `LICENSES.md` | our own minimal architecture, and the licence notes |
| `native-engine/Source/dsp/faust/generated/*.h` | committed Faust C++ output (`-w`) |
| `scripts/build-faust-cpp.mjs` (+ `buildFaustCpp.test.ts`, skipped without `faust`) | regenerates the C++; fails on drift |
| `native-engine/test/golden/*.f32` | golden in/out vectors rendered from the web's wasm |
| `native-engine/Source/FaustStage.h/.cpp` (+Tests) | a thin, allocation-free wrapper: `init(sr)`, set params by address, `process(n, ins, outs)` |
| `native-engine/Source/MasterStage.h/.cpp` (+Tests) | headroom → HP 25 → saturate → glue → width → shelves → true-peak limiter. Called by Transport and RenderExport |
| `native-engine/Source/StemPan.h` (+Tests) | the StereoPannerNode law, inline |
| `native-engine/Source/CavernReverb.h/.cpp` (+Tests) | the IR generator (twin of `reverbImpulse`), Web Audio's convolver normalisation, a partitioned convolver |
| `native-engine/Source/DubDelayBus.h/.cpp` (+Tests) | the ping-pong echo bus |
| `native-engine/Source/DrumPump.h/.cpp` (+Tests) | the pump's key/program routing around the Faust `pump` |
| `NoiseRiser.*`, `ReverbBus.*`, `PlaybackEngine.*`, `Transport.cpp`, `RenderExport.cpp`, `EngineProject.*` | modified |
| `src/shared/buildEngineProject.ts`, `src/renderer/src/components/DiscoverPanel.tsx` | modified |

---

### Task 0 (sssketch, then radio): move the pure rules into `src/shared`

No sound changes in this task. It makes the rules importable by both engines.

**Files:**
- Create in sssketch: `src/shared/{radioPan,radioPump,radioThrows,riserCharacter,radioSound}.ts`, each with a test.
- Modify in radio: `src/radio/{pan,pump,throws}.ts`, `src/audio/{riserCharacter,dubDelay,noise,masterChain,engine}.ts`. Each becomes a re-export or an import.

- [ ] **Step 1.** Copy each module verbatim, doc comments included, into sssketch `src/shared/`. Move its existing radio test with it (`pan.test.ts`, `pump.test.ts`, `throws.test.ts`, `riserCharacter.test.ts`). Run them red-then-green in sssketch.
  - `radioThrows.ts` takes the pure `throwDelaySec`/`throwTailSec`/`ThrowTiming` out of `dubDelay.ts`.
  - `radioPump.ts` takes `PumpRole` out of `engine.ts`.
- [ ] **Step 2.** Put the numbers in `radioSound.ts`: `REVERB_IR`, `REVERB_RETURN_DB`, the `MASTERING` object, `DUB_HIGHPASS_HZ`, `DUB_LOWPASS_HZ`, `DUB_TO_REVERB`. Write a test that pins each value as the web spec states it, for example `t60At(REVERB_IR, 1000) === 4.5` and `REVERB_IR.preDelaySec === 0.03`.
- [ ] **Step 3.** In the radio repo, replace each module's body with `export … from '@shared/…'`. Run its `npx vitest run` and typecheck, and commit there.
- [ ] **Step 4.** In sssketch, commit. No renderer or engine change yet.

**Risk:** low. The only trap is the radio repo building against an sssketch checkout that lacks the new files. Land the sssketch commit first.

---

### Task 1: Faust → C++ toolchain and golden vectors (nothing wired yet)

**Files:**
- Move the `.dsp` files (D4).
- Create `dsp/faust/arch.cpp`, `dsp/faust/LICENSES.md`, `dsp/faust/generated/{saturate,glue,pump,truepeak}.h`.
- Create `scripts/build-faust-cpp.mjs`, `FaustStage.h/.cpp`, `FaustStageTests.cpp`, `native-engine/test/golden/`.
- Modify `CMakeLists.txt`.
- In radio: `scripts/build-faust.mjs` (read the `.dsp` from sssketch), and a new `scripts/golden-vectors.mjs`.

- [ ] **Step 1. Golden vectors first (the red test's data).**
  - In the radio repo, `golden-vectors.mjs` instantiates each committed `.wasm` in Node, the way `faustProcessor.js` does, at 48 kHz.
  - It feeds a fixed, seeded input: 2 s of a burst, sine and noise programme. For `pump` it also feeds a seeded kick key.
  - Parameters are left at their defaults.
  - It writes raw little-endian float32 in and out files into sssketch `native-engine/test/golden/` (a few hundred KB each).
- [ ] **Step 2. Failing native test.** `FaustStageTests`: for each DSP, load the golden input, run it through `FaustStage` in blocks of 1, 64, 512 and a random split, and compare with the golden output.
  - **Pass:** max abs error ≤ 1e-5, and the block splits are bit-identical to each other.
  - **Also check:**
    - `latencySamples()` reads the DSP's `latency_samples` meta (truepeak 75, others 0);
    - `setParam("/truepeak/ceiling", …)` reaches the zone;
    - the meter address (`/glue/gr`, `/pump/duck`, `/truepeak/gr`) can be read back.
- [ ] **Step 3. Generate.**
  - `build-faust-cpp.mjs` runs `faust -lang cpp -i -a arch.cpp -cn <Name>Dsp -ftz 2 -single <name>.dsp` for each of the four. The `-ftz 2` matches the web's compile.
  - It writes `generated/<name>.h` with a header naming the compiler version and the `.dsp` hash.
  - `arch.cpp` declares the minimal `dsp`, `UI` and `Meta` bases in `namespace sssketch::faust`.
- [ ] **Step 4.** Wire the headers into `CMakeLists.txt`'s vendored list (compiled with `-w`). `FaustStage` holds the DSP by `std::unique_ptr`, allocated in `prepare()` on the message thread, and collects param zones through our `UI`. Make the tests green.
- [ ] **Step 5.** `buildFaustCpp.test.ts` re-runs the generator into a temp dir and diffs it against `generated/`. It is skipped with a clear message when `faust --version` is missing, the same way the radio repo's `buildFaust.test.ts` checks its wasm.
- [ ] **Step 6.** Write `LICENSES.md`: the DSPs are GPL-2.0-or-later and combined into GPL-3.0-or-later; the compiler is a build tool only; no GRAME architecture file is used. Commit.

**Risk:**
- **Compiler version skew (D5).** Mitigation: the golden tolerance, and pinning the version in the script.
- **The radio repo's build now reads from sssketch.** Mitigation: it already depends on `../../sssketch` for `@shared`.

---

### Task 2: the master stage, with the true-peak limiter at −1 dBTP (item 7)

**Where:** after the user's master plugin slots, as the very last thing before the device or WAV. A user plugin after a limiter would undo the −1 dBTP promise.
- `Transport.cpp`: in both `renderLoopAware` call sites, right after `masterChain.process(...)` and before the reposition fade.
- `RenderExport.cpp`: after its `masterChain.process(...)`.
- Both call one `MasterStage` owned by `PlaybackEngine` (`engine.processMaster(n, l, r)`). It reads the published snapshot's `mastering` flag. The two paths cannot diverge.

**Trigger:** a new wire field, `EngineProject.mastering: { enabled: bool }`. Absent means off. Discover's preview sets it (D1/D2). A dev-only bypass for A/B comes for free: flip the flag and reload.

**Params (`MASTERING` from `radioSound.ts`):**
- headroom −4 dB;
- truepeak: ceiling −1 dBTP, release 0.1 s, lookahead 64, latency 75 samples.

This task ships headroom + limiter only. The later stages slot in between.

**Native tests (`MasterStageTests`, `TransportTests`, `EngineProjectTests`):**
- [ ] **Off:** with `mastering` absent, `processMaster` leaves the buffers bit-identical. Every existing parity test passes unchanged.
- [ ] **True peak:** a +6 dBFS sine at fs/4 at a 45° phase has intersample peaks about 3 dB over its samples. Measure the output's true peak with the test's own 8× sinc upsampler: ≤ −1.0 dBTP + 0.1 dB.
- [ ] **Transparent below threshold:** a −20 dBFS sine comes out ×10^(−4/20), delayed exactly 75 samples. The gain path is exactly 1.
- [ ] **Block-size invariant:** a 512 block vs a random split of the same render is bit-identical.
- [ ] **Live equals export:** a project rendered through `RenderExport` and through `Transport::renderLoopAware` + `processMaster` matches.
- [ ] **Parse:** `mastering` is parsed, and junk degrades to off.
- [ ] **TS:** `buildEngineProject` omits `mastering` unless it is set (`buildEngineProject.test.ts`). DiscoverPanel sets it on `previewState`.

**Latency:** the 75 samples (1.6 ms at 48 kHz) are not compensated against the playhead. They are under the reposition fade and the device buffer. Write that down in the code comment.

**Risk:**
- **Level change.** The headroom trim makes Discover about 4 dB quieter before limiting, and Elling's master-fader habits will notice.
- The `processMaster` call order relative to the reposition fade.
- A stale engine binary: rebuild and relaunch per `CLAUDE.md`.

**Elling listens:**
- loud stacks no longer crackle;
- the level drop;
- is anything pumping or dulled?
- export a Discover bounce and confirm it sounds the same as the pass.

---

### Task 3: per-row panning (item 1)

**Where:** per stem, in the stem's own buffer, after the volume curve and **before the reverb send**. That is post-pan, as on the web, so a row placed right gets its room mostly on the right. Order: `filter → volume → pan → send → channel`.
- A stem with pan ≠ 0 takes the toolkit path, so it has its own buffer.
- Pan 0 never touches the samples.

**Law:** Web Audio's `StereoPannerNode` on a stereo input (a mono stem is already L = R natively, as the web up-mixes it):
- for p ≤ 0, x = p + 1: `L' = L + R·cos(x·π/2)`, `R' = R·sin(x·π/2)`;
- for p > 0, x = p: `L' = L·cos(x·π/2)`, `R' = R + L·sin(x·π/2)`.

**Trigger:**
- New wire field `EngineStem.pan` (−1..1, absent means 0).
- The renderer computes `panForSlots(slots)` (shared) over **all** slots in slot order, keyed by slot id, so a swap or a mute never moves a row. It maps each slot to its member's stem key.
- Drums and bass are 0; the rest go +0.25, −0.25, … (`ROW_PAN`).

**Native tests (`StemPanTests`, `PlaybackEngineTests`):**
- [ ] Pan 0 is bit-identical to today.
- [ ] +0.25 on a stereo stem matches the formula sample for sample.
- [ ] A mono stem at +0.25 comes out at `L = cos(π/8)·x`, `R = (1 + sin(π/8))·x` (R/L ≈ 1.50), as the web gives.
- [ ] The send is post-pan: a stem at +1 with a send feeds the reverb on the right only.
- [ ] Block-split invariance.
- [ ] **TS:** the `panForSlots` mapping in DiscoverPanel is pure (extract `stemPansFor(slots, members)` into shared and test it). `buildEngineProject` omits `pan` when it is 0.

**Risk:** low.
- Pan reroutes neutral stems onto the toolkit path. That costs one extra buffer copy per stem, which is trivial.
- Sends: today a stem without a toolkit has no send at all, so check that a panned stem with send 0 stays send 0.

**Elling listens:** drums and bass in the middle; the others slightly left and right; a swap doesn't move a row.

---

### Task 4: the cavernous reverb (item 2)

**Where:** `ReverbBus` gets a second room. `ReverbSettings.room: 'zita' | 'cavern'`, absent means zita. With `cavern`, the bus runs `CavernReverb` instead of zita. The sends and the lazy, neutral-is-free behaviour stay exactly as they are.

**What it is:** a C++ twin of `noise.ts` `reverbImpulse`:
- mulberry32 white noise, seeds `0x5eed` and `0x5eed ^ 0x9e3779b9` (different per side, so it is wide);
- 1024-point STFT synthesis, hop 256, Hann analysis and synthesis, normalised by 1/1.5;
- per-bin decay `exp(-ln(1000)/T60(f)·t)` from `REVERB_IR`: 5 s at 125–250 Hz, 4.5 s at 1 kHz, 2.2 s at 8 kHz, 1.5 s at 16 kHz;
- 30 ms of leading zeros;
- then Web Audio's `ConvolverNode` normalisation: scale = 0.00125 / max(rms over all channels and samples, 0.000125), × 44100 / sr; then `REVERB_RETURN_DB` (−3.4 dB).

**The convolver:**
- Hand-written, uniformly partitioned (partition 1024, `juce::dsp::FFT`), with an input FIFO, so the output never depends on the host's block size. That keeps the live-equals-export bit-identity.
- Its 1024-sample FIFO latency is cancelled by **trimming the first 1024 zeros of the 30 ms pre-delay** out of the IR. 30 ms is 1323 samples at 44.1 kHz, 1440 at 48 kHz, both at least 1024. The tail lands exactly where the web's does.
- **Why not `juce::dsp::Convolution`:** it loads IRs on a background thread. A fresh offline export would render its first blocks dry. It is also not block-size invariant to the bit.

**Built where:**
- The IR and its frequency-domain partitions (2 ch × about 240 partitions × 1025 complex bins, about 4 MB) are built in `setProject`/`stageProject` on the message thread, when a project first asks for `cavern`.
- They are cached per sample rate and swapped in through the snapshot. They are never built on the audio thread.
- If the device rate differs from the cached one at render time, the bus stays silent for that block and the message thread rebuilds. Log it, because it should never happen.

**Trigger:** DiscoverPanel's `previewState.reverb = { ...reverb, room: 'cavern' }` (D3). The master send default stays the renderer's.

**Native tests (`CavernReverbTests`):**
- [ ] **IR shape:** length = pre + 5 s; exactly zero for the first 30 ms; L/R correlation < 0.1.
- [ ] **Decay per band:** band-pass the IR at 1 kHz and fit the energy decay: T60 4.5 s ± 10%. At 8 kHz: 2.2 s ± 10%. At 250 Hz: 5.0 s ± 10%.
- [ ] **Twin:** the first 8,192 samples after the pre-delay match the TS `reverbImpulse` at 48 kHz within 1e-6 (golden file from the radio repo, same seed).
- [ ] **Normalisation:** equals the Web Audio formula computed in the test.
- [ ] **Convolver:** an impulse in gives the normalised IR out, aligned to the sample (pre-delay included). Blocks of 1, 64, 512, 4096 and random splits are bit-identical. With no send, nothing is built and the output is unchanged. It reports ringing for the IR's length after the last send.
- [ ] **Room switch:** zita projects are bit-identical to today.
- [ ] **TS:** the `room` field round-trips, and is omitted when it is `zita`.

**Risk:**
- **CPU:** about 240 partitions × 1025 complex MACs per 1024 samples per side. Back of the envelope, a few percent of one core. Measure it in a `PlaybackEngineTests` timing note, not a hard assert.
- **Memory:** ~4 MB per sample rate.
- The FIFO and partition bookkeeping is the most intricate new C++ in this plan, so test it hardest.
- **Level:** the web's −3.4 dB return was measured against its old 2.5 s room. The native send-level history differs (zita is 100% wet). Expect a level trim by ear.

**Elling listens:**
- the room is huge and darkens as it decays;
- the pre-delay keeps transients clear;
- a bloom still reads;
- send at 0.5 is about where the web sits;
- CPU is fine on the laptop.

---

### Task 5: riser variety (item 3)

**Where:** `RiserVoice`/`NoiseRiser`, still rendered into the channel. A riser with a send also feeds `reverbBus.addSend`. Risers with a send mark the snapshot as `anyToolkitActive`, so the bus runs.

**Wire (`EngineRiser`, all optional, absent means today's riser):**
- `q` (1–6, default `kRiserBandwidthQ` 2);
- `colour: 'white' | 'pink'`;
- `stereo: 'wide' | 'mono'`;
- `send` (0–1, default 0).

Level, sweep range and sweep curve need **no** native change:
- The renderer draws a `RiserCharacter` with the shared `drawRiserCharacter`, seeded from the riser id, so a re-sync redraws the same character.
- `level = 0.35 · 10^(levelDb/20)`. That is +1 to +5 dB, +3 dB on average.
- `startCutoffValue`/`endCutoffValue` come from the character.
- The sweep shape `start + (end − start)·p^curve` is written into `RiserClip.curve` as 17 points, which `riserCutoffAt` already follows.
- The timing stays `buildTransitionRiser`'s.

**Native changes:**
- **Q:** the gain is `level · (1/Q) · sqrt(Q/2)`. The 1/Q is the SVF bandpass's peak normalisation (today's constant). The `sqrt(Q/2)` is the web's `qTrim`: noise power level-matched to Q 2. At Q 2 this is exactly today's gain.
- **Pink:**
  - Paul Kellet's economy filter (three one-poles, the same coefficients as `riserVoice.ts`) over `riserNoiseAt`.
  - Scaled by a constant k that matches white at 6 kHz, as the web's `MATCH_HZ` does. Compute k analytically from the filter's magnitude at 6 kHz for the running sample rate, and pin it against the web's measured value.
  - The filter has state, so **index addressing is kept by warm-up**: on a discontinuity (a seek or the first block), re-run the filter over the 16,384 samples before the index. 0.99765^16384 ≈ e^−38, so the state matches a from-zero run to float precision.
- **Mono:** `seedR = seedL`.

**Native tests (`NoiseRiserTests`):**
- [ ] **Regression:** all 13 existing riser tests pass unchanged with the new fields absent. "Level means level" stays true for Q 2, white.
- [ ] **Q:** the RMS over the sweep is within 0.5 dB across Q 1, 2, 4 and 6 at one level, and the resonant ones are narrower (the band's bandwidth).
- [ ] **Pink:** the slope is −3 dB/oct ± 1 dB from 200 Hz to 8 kHz.
- [ ] **Pink, by index:** a render seeked into the middle matches a continuous render within 1e-6, and two fresh renders are bit-identical (live equals offline).
- [ ] **Mono:** L == R exactly. Wide: decorrelated (the existing test).
- [ ] **Send:** a riser with a send rings the reverb, and with send 0 the bus is never built.
- [ ] **TS:**
  - the riser character becomes `RiserClip` fields (a pure helper in shared, with a test);
  - `buildEngineRisers` omits absent fields;
  - the same id gives the same character.

**Risk:**
- At Q > 2 the noise's peaks can pass `level`. The "level means level" doc comment changes from a peak bound to a power match. Task 2's limiter is the backstop, which is why it lands first.
- The pink warm-up costs about 16k × 3 one-poles once per seek.

**Elling listens:**
- risers vary: some whistle (resonant), some have body (pink), a few are narrow (mono);
- louder by about 3 dB;
- they bloom into the room;
- the timing is unchanged.

---

### Task 6: glue compression and tone (the master stage's middle)

**Where:** inside `MasterStage`, between the headroom trim and the limiter. Order:
1. HP 25 Hz;
2. a saturation slot (Task 7);
3. glue (Faust `glue` at its own `.dsp` defaults: threshold −14, ratio 2, soft knee 6 dB, dual envelope);
4. width (mid/side, the side through a +2 dB high shelf at 250 Hz, so the mono sum is unchanged);
5. low shelf +1 dB at 100 Hz;
6. high shelf +1 dB at 10 kHz;
7. limiter.

Use RBJ biquads with the **web's actual Q**: the HP uses `biquadQ(0)` = −3.01 dB in Web Audio's decibel Q, which is linear 0.7071.

**Trigger:** the same `mastering` flag.

**Params:** the HP, width and shelves from `MASTERING` in `radioSound.ts`. The glue runs at `glue.dsp`'s own defaults (−14 dB, ratio 2, knee 6). The web's `loadFaust` sets no glue params, and `MASTERING.glue` (−11, knee 0) belongs only to its `DynamicsCompressorNode` fallback. Pin the defaults in a test so a `.dsp` edit is a visible change.

**Native tests:**
- [ ] Golden vector, the whole stage: the radio repo renders the same seeded mix through its Faust chain (`spike/engine-check`'s offline render, Faust stages on, convolver off) and native matches within 1e-4.
- [ ] The glue alone: a signal below the knee comes out at unity; +10 dB over the threshold comes out at about +5 dB (2:1).
- [ ] Width: the mono sum L + R is unchanged to 1e-6.
- [ ] Shelves: ±0.1 dB at their corners against RBJ formulas.
- [ ] Block-split invariance; mastering off is still bit-identical.

**Risk:**
- The web's chain order and its fallback trims are subtle (`GLUE_TRIM_DB` exists only for `DynamicsCompressorNode`). The Faust glue has no makeup gain, so **no trim natively**. Port the Faust-path chain, not the fallback.

**Elling listens:** layers from different jams sit together; gain reduction is about 1–3 dB on a dense mix (expose `/glue/gr` in the dev readout if he wants it); nothing breathes.

---

### Task 7: tape saturation (item 5)

**Where:** `MasterStage`'s saturation slot: after the HP, before the glue. Faust `saturate`: drive 1.8, bias 0.1, makeup +0.5 dB, DC blocker at 5 Hz.

**Native tests:**
- [ ] Golden vector (Task 1's harness).
- [ ] A −40 dBFS sine comes out at unity ± 0.01 dB.
- [ ] THD of a −14 dBFS 1 kHz sine is 1.8% ± 0.3%.
- [ ] No DC on an asymmetric input after 1 s.
- [ ] A dense-mix level match within 0.3 dB (spec 1a).

**Risk:** aliasing. The web's Faust stage runs **without** oversampling; only the WaveShaper stand-in was 4×. Native matches the Faust stage. If Elling hears grit on bright material, add 2× oversampling later as its own task. Don't pre-empt it.

**Elling listens:** peaks rounded a little, nothing obviously distorted; A/B with the dev bypass.

---

### Task 8: the drum-keyed pump (item 6)

**Where:** `renderBlock`. The pumped stems' dry signal goes into a per-channel pumped scratch buffer, after filter → volume → pan → send. The send is therefore **not** pumped, as on the web. The drums stems' dry signal also goes into one key buffer.
- After the channel loop, `DrumPump` runs the Faust `pump` (4 in: program L/R, key L/R; 2 out) over each channel's pumped buffer, keyed by the block's key buffer.
- It then adds the result into the channel before the channel plugin chain.
- The pump is sample by sample with no look-ahead, so using the same block's key is exact.
- The pump's gain multiplies the stems' own gain, so the duck gesture's `volume` curve still works.

**Trigger:**
- New wire field `EngineStem.pumpRole: 'key' | 'pumped' | 'none'`, absent means none.
- The renderer sets it from the shared `pumpRoleFor(slot.kinds)`: drums are key, bass is none, everything else is pumped.
- No key stem in the project means no pump at all; the gain is exactly 1.

**Params:** depth 4 dB, attack 3 ms, release 200 ms, key low-passed at 150 Hz twice, range −30 to −10 dB.

**Native tests (`DrumPumpTests`, `PlaybackEngineTests`):**
- [ ] Golden vector.
- [ ] No key: pumped stems are bit-identical to unpumped.
- [ ] A 60 Hz kick burst at −10 dBFS ducks a pumped pad by 4 dB ± 0.3. The attack reaches 90% in about 7 ms, and recovery is about 63% in 200 ms.
- [ ] Hats alone at −10 dBFS (8 kHz) duck by under 0.5 dB.
- [ ] Drums and bass stems are untouched.
- [ ] The reverb send is not pumped.
- [ ] Block-split invariance.
- [ ] **TS:** `pumpRole` mapping and omission.

**Risk:**
- This is a new routing shape inside `renderBlock` (a second per-channel scratch buffer and a project-wide key), in the engine's most commented, most fragile function. Keep the change to routing pointers and one post-loop pass.
- A muted drums row stops keying, which is correct: it isn't heard.

**Elling listens:** a subtle breath on pads and leads with each kick; nothing on drums and bass; the duck gesture still dips over it.

---

### Task 9: the dub echo bus (item 4, engine half)

**Where:** a new `DubDelayBus`, shaped like `ReverbBus`: lazy, neutral-is-free.
- Fed by a per-stem, post-pan `dubSend` (the stem's own buffer, like the reverb send).
- Processed before `reverbBus.endBlock`, so its output can feed `DUB_TO_REVERB` (0.15) into the reverb in the same block.
- Its wet signal goes into the master sum.

The DSP is a stereo ping-pong:
- L delay → HP 200 → LP 3500 → feedback → R delay, and R back to L.
- The lowpass is in the loop, so each repeat is darker.
- Feedback is clamped to 0.95.
- Fractional delay is linear-interpolated, the line sized for 2 s.
- **Web quirk to match deliberately:** `dubDelay.ts` passes `Q: Math.SQRT1_2` to Web Audio low and high passes, whose Q is in **decibels**. So the web's filters are linear Q 10^(0.7071/20) ≈ 1.085, about +0.7 dB of bump. Match what Elling heard, and note it as a candidate fix in the radio repo.

**Wire:**
- `EngineStemAutomation.dubSend` (a curve; wire-only, not a UI lane in `AUTOMATION_PARAMS`);
- `EngineProject.dub: { delayBeats: 0.75 | 1, feedback }`, absent means no bus.

The delay time is `delayBeats × 60 / bpm`, so it follows tempo. A settings change is taken only while the bus is silent (`!isRinging()`). Otherwise it waits, so a ringing tail is never retimed.

**Native tests (`DubDelayBusTests`):**
- [ ] An impulse into L gives echoes at d (R), 2d (L), 3d (R)…, each about `feedback` times the last, with the −3 dB point falling each pass.
- [ ] d = 0.375 s at 120 bpm dotted-eighth, and 0.5 s quarter.
- [ ] Feedback 2.0 is clamped and does not run away over 30 s.
- [ ] No send and no tail: nothing built, output bit-identical.
- [ ] Echoes reach the reverb at 0.15.
- [ ] A settings change while ringing is deferred.
- [ ] Block-split invariance.
- [ ] Parse and round-trip of `dub` and `dubSend`.

**Risk:**
- A second bus in the render order; the dub-before-reverb ordering is easy to get wrong. Test it explicitly.
- The Q quirk.

**Elling listens:** nothing yet (Task 10 triggers it). Optionally a dev button that throws the first eligible row now.

---

### Task 10: throw scheduling in Discover (item 4, renderer half)

**Where:** DiscoverPanel's radio loop, next to the gesture code.

**Rules (all shared `radioThrows.ts`):**
- `stepThrows` is fed a tick of `now` and `nextBeat` in transport seconds (bars × secPerBar), plus `bpm`, `held`, `leadingArmed` and the rows' kinds and audibility.
- It answers with a `ThrowPlan` or nothing:
  - every 16–32 bars;
  - 1 or 2 beats;
  - dotted eighth or quarter;
  - feedback 0.45–0.6;
  - never drums or bass;
  - never two at once;
  - never while held or over a hole, riser or drop-out.

**Turning a plan into the project:**
- **The curve.** A plan becomes a `dubSend` curve on the chosen row's stem key, in loop-relative bars, with 5 ms ramps either side of 1, as `engine.ts` `throwDelay` draws it, plus `dub` settings. It is pushed with the live project, the same way a bloom is.
- **How far ahead.** Choose `nextBeat` at least **one bar** ahead. The measured load-project latency is 0.02–0.22 bar.
- **Clearing.** Clear the curve after the throw's beats pass and before the next lap reaches that bar. Otherwise it fires every lap.
- **Staged projects.** A throw armed while a staged swap is pending must also go into the staged project, as gestures' `spares` do. Otherwise the swap at the wrap drops it mid-throw.

**Tests (vitest):**
- [ ] Extract `throwCurveFor(plan, loopBars, spb)` into shared and test it:
  - points at the right bars;
  - a 5 ms ramp in bars at that tempo;
  - wrap-safe when the throw crosses the loop top (split into two segments, or refused and redrawn; decide in the test).
- [ ] `stepThrows` is already tested (moved in Task 0).
- [ ] A DiscoverPanel-level test that a throw curve survives a staged swap, if the panel's existing test seams allow it. If not, add it to the walkthrough.

**Risk:**
- This is the most renderer plumbing in the plan: an 8.8k-line component, curves that repeat every lap until cleared, and the staged/live split.
- Two load-projects per throw add IPC churn.
- **Mitigation:** gate every branch on `radioOnRef.current`, as the other gestures are; with radio off, nothing changes.

**Elling listens:**
- now and then a lead or pad echoes into the room;
- never on drums or bass;
- the echoes are in time and darken as they go;
- never during a hole or riser;
- held means no throws.

---

### Task 11: final verification

- [ ] The native suite is green; the count goes up by the new tests and nothing is skipped. `npx vitest run` is green, including the render-parity test.
- [ ] Mastering, pan, room, pump and dub all absent: a timeline project renders bit-identical to a pre-plan build (render-parity plus a saved fixture).
- [ ] Profile a dense Discover mix (8 rows, all features on) at 48 kHz/256 for CPU. Note the numbers in the commit.
- [ ] A Discover bounce null-tests against the live pass, with all features on.
- [ ] Hand Elling the walkthrough below.

---

## What Elling needs to listen to

Do this in `npm run dev`, after a **full Cmd+Q and relaunch** once the engine is rebuilt. Use the same rifffs as on the web where possible, and A/B against `ell.ing/radio` at the same tempo.

1. **Limiter (T2):**
   - stack eight loud rows: no crackle;
   - the level drop from the −4 dB headroom; is the master fader's range still right?
   - a bounce sounds the same as the pass.
2. **Pan (T3):** drums and bass in the middle, the rest gently left and right; a swap never moves a row.
3. **Reverb (T4):**
   - cavernous, darkening tail, clear transients;
   - is a send of 0.5 the same amount of room as the web?
   - blooms;
   - CPU on the laptop.
4. **Risers (T5):** variety (whistly, full-bodied, narrow); about 3 dB louder; blooming into the room; never harsh at Q 6.
5. **Glue and tone (T6):** layers sit together; no audible pumping from the compressor; low and high end a touch fuller.
6. **Saturation (T7):** peaks rounded, no grit on hats or cymbals (if there is grit, ask for oversampling).
7. **Pump (T8):** a subtle breath on pads with each kick; drums and bass untouched; the duck gesture still dips over it.
8. **Throws (T10):** occasional in-time echoes on non-drum, non-bass rows; darker each repeat; none while held or over a hole or riser.
9. **The whole (T11):** an hour of radio. Does the app now sound like the web? Note anything that differs, with the rifff names.

---

## Risks, in one place

| risk | where | mitigation |
|---|---|---|
| Wire-twin blast radius (≈10 new fields) | every task | optional fields with absence meaning today; one field group per task; parse and round-trip tests on both sides |
| Live ≠ export | T2, T4–T9 | one `processMaster` for both callers; block-size-invariant DSP; the existing parity tests plus new ones |
| Audio-thread allocation | T1, T4 | Faust objects and the convolver's IR and partitions built on the message thread, swapped via the snapshot |
| Faust toolchain (no C++ in faustwasm; brew 2.85.9 vs 2.89.2) | T1 | native compiler pinned; generated code committed; golden vectors; a hand port as fallback |
| Loudness shift in Discover | T2, T5 | headroom first, limiter as the backstop; Elling tunes the master fader by ear |
| CPU (convolution, four Faust stages, pump) | T4–T8 | measured in T11; if the convolver is heavy, a two-size (non-uniform) partition scheme, still latency-free behind the pre-delay |
| Matching web quirks rather than intent | T4, T6, T9 | match what Elling heard (convolver normalisation, Web Audio's dB Q, StereoPanner law); list each quirk in the code comment and in the radio repo |
| `renderBlock` routing (pump, dub, pan) | T3, T8, T9 | pointer-routing changes only; a separate post-loop pass; heavy tests |
| DiscoverPanel plumbing (throws, staged projects) | T10 | gated on `radioOnRef`; pure helpers extracted and tested; the walkthrough covers what can't be tested |
| The riser's "level means level" contract | T5 | it becomes a power match, documented; the limiter backstops it |
