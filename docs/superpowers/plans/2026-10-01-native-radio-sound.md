# Native radio sound: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Amended 2026-10-01 with Elling's decisions (D1–D5, below).** The radio sound applies **everywhere**: Discover, the arranger timeline, and every bounce and export. It is adjustable through per-project sound settings, and the app-wide defaults have everything on.

**Goal:** sssketch sounds like `ell.ing/radio`, everywhere, adjustably. Port the web radio's sound into the native engine:
- **Sound:** per-row panning, the cavernous reverb, and riser variety.
- **Glue:** dub throws, tape saturation, the drum-keyed pump, the glue compressor and tone, and a −1 dBTP true-peak limiter.

Elling approved the port on 2026-10-01.

**Architecture:**
- **Pure rules are shared, not copied.** The radio repo's pure rules move into `src/shared/`, which the radio repo already imports as `@shared`. Both the web page and the app use them. They decide pan per slot, pump role per slot, when throws happen, and each riser's character.
- **One settings object says what is on.** `SoundSettings` lives in `src/shared/radioSound.ts`:
  - it is stored per project;
  - a new project starts from the app-wide defaults, which are all on;
  - Discover, the timeline, live playback and every bounce read it.
- **The wire carries what the settings and rules decide.** A new optional `EngineProject.sound` block holds the master stages, the reverb room, the pump and the dub bus. Each stem gets optional `pan`, `pumpRole` and a `dubSend` curve. Each riser gets optional character fields.
  - Absent fields mean today's behaviour, bit for bit (the toolkit's "absence is load-bearing" rule).
  - Every stage switched off is also bit-identical to today.
- **The engine performs it per sample.** Throws ride the project as per-stem automation curves:
  - in Discover, radio arms them live, the way it arms gestures;
  - on the timeline, a seeded plan over the arrangement places them, so playback and export hear the same throws.
- **Master DSP comes from the Faust sources, compiled to C++.** Saturation, glue, pump and the true-peak limiter come from the Faust `.dsp` files, which now live in sssketch as the single copy. They are compiled to C++ with a native Faust compiler pinned to the web's version. The generated code is committed, with golden vectors from the web's wasm proving it is the same DSP. The web compiles the same `.dsp` files to wasm from sssketch.
- **Some parts are hand-written C++.** The reverb (the web's default is a generated-IR convolver, not Faust), the dub delay, the panner and the riser changes are written by hand.

**Tech stack:** C++20, JUCE 8.0.4 (`juce_dsp`), JUCE `UnitTest`, the Faust compiler (build-time only, via Homebrew), TypeScript, React, vitest.

**References:**
- Web spec §3: `~/Claudecode/ell.ing/radio/docs/specs/2026-09-30-radio-a-design.md`. It lists every stage and its measured targets.
- Web sources: `src/audio/{engine,rowVoice,masterChain,riserVoice,riserCharacter,dubDelay,gestures,noise}.ts`, `src/audio/faust/*.dsp`, `src/radio/{pan,pump,throws}.ts`.

---

## Elling's decisions (2026-10-01)

| # | decision |
|---|---|
| D1/D2 | The radio sound applies **everywhere**: Discover, the timeline, playback, and every export and bounce. It is **adjustable**. <br>**Per-stage switches:** mastering/limiter, glue, saturation, pump, the cavernous reverb vs zita, panning and throws, plus amounts where they make sense. <br>**Storage:** per project, with app-wide defaults all on. <br>**Exports and bounces:** follow the project's settings. |
| D3 | The cavernous reverb replaces zita, selectable in the settings. Zita stays available and keeps its three existing controls. |
| D4 | The `.dsp` files move into sssketch (`native-engine/Source/dsp/faust/`) as the single source. The web compiles them from there (Task 1). |
| D5 | Faust → C++ with a native compiler, installed with Homebrew (approved). Pin it to match the web; see Task 1 for the version situation. |
| D6 | **Old projects get it all on too.** A project saved before this plan opens with the app-wide defaults (all on), the same as a new one; Elling switches stages off per project. |
| D7 | **Saturation is adjustable and quieter by default.** Elling found drive 1.8 too strong. The web now takes an amount 0..1, drive = amount × 1.8, default 0.5 (drive 0.9, 0.83% THD on a −14 dBFS sine instead of 1.8%; radio commit `4c233bf`); the makeup follows the drive squared (+0.5 dB at 1.8), and drive 0 is an exact pass-through (`saturate.dsp`). `SoundSettings.saturation` uses the same amount scale and default. |

**Version situation for D5** (checked 2026-10-01):
- The web's `@grame/faustwasm` 0.18.5 bundles libfaust **2.89.2**, which is a development build. The newest **published** Faust release is **2.88.0**: Homebrew's formula, and GRAME's GitHub release with a `Faust-2.88.0-arm64.dmg`. 2.89.2 is not installable as a release.
- So the plan installs 2.88.0 natively and **re-pins the web's faustwasm to the release whose libfaust reports 2.88.0**. The two compilers then match exactly.
- If no published faustwasm bundles 2.88.0, the fallback is to build Faust from source at the 2.89.2 commit and keep the web where it is.

**One ruling inside D1/D2, confirmed by Elling (2026-10-01):** in DAW exports (Ableton/REAPER) and per-stem bakes, every stem gets its **per-stem** stages (pan, filter, sends), but the **master-bus** stages (headroom, saturation, glue, tone, limiter, the pump's mix) do not. The DAW session has its own master, and each stem would be limited on its own. Mixdown bounces get the whole chain.

---

## Ground rules

- **Read first:**
  - `CLAUDE.md`, especially "Wire format twins" and the engine rebuild/relaunch rule.
  - `native-engine/Source/PlaybackEngine.h`, the comments on `renderBlock` and `ProjectSnapshot`.
  - `ReverbBus.h`, `NoiseRiser.h`, `src/shared/buildEngineProject.ts`, `src/renderer/src/state/{store,serialize}.ts`, `src/main/discoverSettingsStore.ts` (the app-wide settings pattern).
  - The gesture block in `DiscoverPanel.tsx`; find it by searching for `const gestureList: RadioGesture[]`.
- **Staging:** stage explicit paths only. Never `git add -A`.
- **Line numbers drift.** `DiscoverPanel.tsx` is about 8,800 lines. Anchor on quoted code and grep.
- **After every task:**
  - `npm run typecheck`, `npx vitest run`, and eslint on the changed files are clean.
  - `cd native-engine && cmake --build build`, then `…/sssketch-engine --test` ends with `All unit tests passed.`
  - On 2026-10-01 the native suite was 269 tests, all passing, in 3.1 s.
- **Off is today.** With the `sound` block absent, or with every stage switched off, the engine's output is bit-identical to today's, and a test pins both for each stage. The existing live-equals-export and block-split parity tests stay green untouched.
- **Live and export must match.** Any master-stage DSP runs in both `Transport.cpp` (live) and `RenderExport.cpp` (bounce), in the same order, through one shared call. It also has to be block-size invariant, because Transport splits blocks at loop tops.
- **No allocation on the audio thread** for anything bigger than today's precedent: zita's lazy ~100 ms of lines. Faust objects and the convolver's IR and partitions are built on the message thread, in `setProject`/`stageProject`.
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
- **No master level in the engine.** The renderer scales stem gains and volume curves (`masterScaledGains`/`masterScaledCurve`).
- **No mastering.** There is no headroom trim, compressor, saturation or limiter. A dense mix can pass 0 dBFS, and `NoiseRiser.h`'s comment on `kRiserBandpassNormalisation` records a bounce clipping this way.
- **The reverb exists:** one shared zita-rev1 FDN (`ReverbBus`), fed by per-clip post-fader sends.
  - Its settings are `roomSize` (rtmid 0.5–8 s), `damping` (fdamp 20 kHz–1.5 kHz) and `preDelayMs` (20–115 ms).
  - rtlow is fixed at 1.5 × rtmid.
  - `state.reverb` is saved per project (`serialize.ts`). `exportToolkitAudio.ts` mirrors zita's decay to size bake tails.

**How gestures are scheduled.** All of it is renderer-side data. The engine has no notion of "radio".
- `DiscoverPanel` turns the armed gesture into project data:
  - hole and drop-out become `volume` curves;
  - duck becomes `volume` curves on every other stem;
  - filter in becomes a `filterCutoff` curve;
  - bloom becomes a `reverbSend` curve;
  - riser becomes an `EngineRiser` from `buildTransitionRiser`.
- The builders live in `src/shared/radioTransition.ts`.
- Curves are anchored at loop bar 0 and play every lap until cleared.
- A change goes out as a **staged project**. `Transport::applyStagedProjectAtWrap` promotes it exactly at the loop top.

**Rows differ between the two places.**
- **Discover's preview** is one rifff on one channel. Each row is a stem keyed `stemKey(groupId, i + 1)`, with slot kinds.
- **On the timeline** a rifff clip carries up to 8 stems, each with a `SoundType` (`drums`, `bass`, …).
- So every per-row stage (pan, pump role, throw send) is a **per-stem** field in both places:
  - in Discover, a "slot" is a Discover slot, with its kinds;
  - on the timeline, a "slot" is the stem's slot in its rifff, with its `SoundType`.

**Wire twins.** `EngineProject.h`/`EngineProject.cpp` (parse) and `src/shared/buildEngineProject.ts` are hand-synced. Each field added below touches both, plus `EngineProjectTests.cpp` and `buildEngineProject.test.ts`.

**Bounce and export paths** (all must follow the project's sound settings):
- the mixdown: `exportMix.ts` via `nativeExport.ts` → `RenderExport.cpp`;
- toolkit bakes: `exportToolkitAudio.ts` → `BakeStem.cpp`, which sizes reverb tails;
- the DAW exports: `exportAbleton.ts`, `exportReaper.ts`;
- the phone renderers: `remoteLoopRenderer.ts`, `remoteStemRenderer.ts`.

---

## Faust vs C++

**What was checked.** On 2026-10-01 the radio repo's `@grame/faustwasm` 0.18.5 was asked for C++:
- `generateAuxFiles(…, '-lang cpp …')` fails with `CPP backend is not built`.
- C and Rust fail the same way.
- `cmajor-hybrid` hits an internal assert on `saturate.dsp`.
- **So the wasm compiler cannot emit C++.** A native compiler is needed at build time (D5). Nothing from it ships.

**Licences.**
- The `.dsp` files are written from Faust primitives only and declare GPL-2.0-or-later.
- Faust's documentation states that the generated code carries the DSP source's licence.
- sssketch is GPL-3.0-or-later. GPL-2.0-or-later code can be combined into it under v3. Elling also wrote both.
- Faust's stock architecture headers (`faust/dsp/dsp.h`, `faust/gui/UI.h`, `faust/gui/meta.h`) carry GRAME's own licence terms. Avoid them: compile with `-i` against **our own minimal architecture file**.

| | Faust → C++ (decided, D5) | hand-written C++ |
|---|---|---|
| same sound as the web | the same DSP graph from the same `.dsp` file. With matched compiler versions the code generation is the same too; golden vectors check it | a re-derivation; drift possible in the details Elling tuned by ear |
| effort | a script, an architecture file, a thin wrapper | ~10–40 lines per DSP plus the same tests |
| readability | generated code, vendored and compiled with `-w`, like zita | the codebase's commented style |
| future tuning | edit one `.dsp`, recompile both targets | edit two implementations |
| real-time safety | `compute()` never allocates; heap-allocate the object off the audio thread | the same discipline by hand |

**Decided:**
- **Faust → C++** for `saturate`, `glue`, `truepeak` and `pump`.
- **The convolver**, a C++ twin of `noise.ts` `reverbImpulse`, for the cavernous room. The web's Faust `reverb.dsp` is only its A/B candidate.
- `reverb.dsp` moves too (D4), and the toolchain compiles it to C++, so a later switch is one wiring change. It is not wired now.

---

## File map

| path | responsibility |
|---|---|
| `src/shared/radioPan.ts` (+test) | `panForSlots`, `ROW_PAN`, moved from radio `src/radio/pan.ts`; plus `stemPansForRifff` for the timeline |
| `src/shared/radioPump.ts` (+test) | `pumpRoleFor`, `PumpRole`, moved from radio; plus `pumpRoleForSoundType` |
| `src/shared/radioThrows.ts` (+test) | `stepThrows`, `throwDelaySec`, `throwTailSec`, `THROW_*`, moved from radio; plus `throwCurveFor` and `planArrangementThrows` |
| `src/shared/riserCharacter.ts` (+test) | `drawRiserCharacter`, `RISER_RANGES`, `RISER_BEFORE`, moved from radio |
| `src/shared/radioSound.ts` (+test) | `SoundSettings`, `DEFAULT_SOUND_SETTINGS` (all on), `normalizeSoundSettings`, amount-to-parameter maps, and the shared numbers (`REVERB_IR`, `REVERB_RETURN_DB`, `MASTERING`, `DUB_*`). Each number has a C++ twin pinned by a native test |
| `src/main/soundSettingsStore.ts` (+test), IPC in `index.ts`, `preload` | app-wide default sound settings (a userData JSON, the `discoverSettingsStore.ts` pattern) |
| `src/renderer/src/state/{store,serialize}.ts` (+tests) | `AppState.sound`, `SET_SOUND_SETTINGS`, saved per project, legacy projects normalised |
| `src/renderer/src/components/SoundSettingsPanel.tsx`, `TransportBar.tsx` | the settings UI (Task 13) |
| `native-engine/Source/dsp/faust/*.dsp` | the five DSPs, moved here from the radio repo (D4): the single copy |
| `native-engine/Source/dsp/faust/arch.cpp`, `LICENSES.md`, `FAUST_VERSION` | our own minimal architecture, licence notes, and the pinned compiler version |
| `native-engine/Source/dsp/faust/generated/*.h` | committed Faust C++ output (`-w`) |
| `scripts/build-faust-cpp.mjs` (+ `buildFaustCpp.test.ts`) | regenerates the C++, checks the pinned version, fails on drift |
| `native-engine/test/golden/*.f32` | golden in/out vectors rendered from the web's wasm |
| `native-engine/Source/FaustStage.h/.cpp` (+Tests) | an allocation-free wrapper: `init(sr)`, set params by address, `process` |
| `native-engine/Source/SoundSettings.h` (+ parse in `EngineProject.cpp`) | the C++ twin of the wire's `sound` block |
| `native-engine/Source/MasterStage.h/.cpp` (+Tests) | headroom → HP 25 → saturate → glue → width → shelves → true-peak limiter, each switchable. Called by Transport and RenderExport |
| `native-engine/Source/StemPan.h` (+Tests) | the StereoPannerNode law |
| `native-engine/Source/CavernReverb.h/.cpp` (+Tests) | the IR generator, Web Audio's convolver normalisation, a partitioned convolver |
| `native-engine/Source/DubDelayBus.h/.cpp` (+Tests) | the ping-pong echo bus |
| `native-engine/Source/DrumPump.h/.cpp` (+Tests) | the pump's key/program routing around Faust `pump` |
| `NoiseRiser.*`, `ReverbBus.*`, `PlaybackEngine.*`, `Transport.cpp`, `RenderExport.cpp`, `BakeStem.*`, `EngineProject.*` | modified |
| `src/shared/buildEngineProject.ts`, `src/main/{exportToolkitAudio,nativeExport,exportAbleton,exportReaper,remoteLoopRenderer,remoteStemRenderer}.ts`, `DiscoverPanel.tsx` | modified |
| radio repo: `scripts/build-faust.mjs`, `scripts/buildFaust.test.ts`, `package.json`, `src/audio/faust/LICENSES.md` | compile from sssketch's `.dsp`; re-pinned faustwasm |

---

## The sound settings (shape)

```ts
// src/shared/radioSound.ts
export interface SoundSettings {
  mastering: { on: boolean; headroomDb: number; ceilingDb: number } // the headroom trim (-8..0, -4) and the true-peak limiter (ceiling -3..-0.3 dBTP, -1); the master stages below need it on
  glue: { on: boolean; amount: number }       // 0..1 -> threshold -8..-20 dB (more glue, lower threshold); 0.5 -> -14 (glue.dsp's default, what the web runs)
  tone: { on: boolean; amount: number }       // HP 25 Hz, width, and the shelves at 100 Hz / 10 kHz; amount -1..1 tilts them (toneShelvesDb): low 1 - 1.5a dB, high 1 + 1.5a dB; 0 is today's +1/+1, negative warmer, positive brighter
  saturation: { on: boolean; amount: number } // 0..1 -> drive 0..1.8; 0.5 -> 0.9, the web's default (D7)
  reverb: { room: 'cavern' | 'zita'; amount: number } // amount 0..1 scales the return (reverbReturnGain = 2a x the room's trim): 0.5 is today's level for either room. zita keeps its own roomSize/damping/preDelayMs in state.reverb
  panning: { on: boolean; width: number }     // 0..0.5; 0.25 is ROW_PAN
  pump: { on: boolean; depthDb: number }      // 0..8 dB; 4 dB is the web's
  throws: { on: boolean; rate: 'rare' | 'normal' | 'often'; level: number }  // rate: 32-64 / 16-32 / 8-16 bars, normal is the web's; level 0..1 scales each throw's send (the web's Engine.setEcho), 1 by default
  riserVariety: { on: boolean }               // radio's transition risers draw a character; hand-drawn risers keep theirs
}
```

- `DEFAULT_SOUND_SETTINGS` is all on, at the web's values.
- `DEFAULT_SOUND_SETTINGS` is typed `DeepReadonly` and frozen at runtime, as are `REVERB_IR`, `MASTERING` and `FAUST_DEFAULTS`.
- `normalizeSoundSettings(unknown, defaults?)` fills anything missing or junk from the defaults it is given, and clamps the amounts. A custom `defaults` is normalised against `DEFAULT_SOUND_SETTINGS` first.
- The maps:
  - `glueThresholdDb(amount)`;
  - `saturationDrive(amount)`;
  - `saturationMakeupDb(drive)`;
  - `toneShelvesDb(amount)`;
  - `reverbReturnGain(amount, room)`;
  - `throwEveryBars(rate)`.

  `SOUND_LIMITS` holds the ranges. In every map, a non-finite amount gives the default amount's result. `saturationMakeupDb` of a non-finite drive is 0 dB. Task 0 landed these.
- **The wire carries resolved parameters, not amounts.** For example `glue.thresholdDb`, not `glue.amount`. The engine never needs to know the UI's scale, and the TS maps are unit-tested.
- **Glue, tone and saturation are master stages.** They only run when `mastering.on` is true. The UI greys them out otherwise, so a limiter-less glue chain can't be built by accident.

---

### Task 0 (sssketch, then radio): move the pure rules into `src/shared`; define `SoundSettings`

No sound changes in this task.

**Files:**
- Create in sssketch: `src/shared/{radioPan,radioPump,radioThrows,riserCharacter,radioSound}.ts`, each with a test.
- Modify in radio: `src/radio/{pan,pump,throws}.ts`, `src/audio/{riserCharacter,dubDelay,noise,masterChain,engine}.ts`, which become re-exports or imports.
- **As landed (2026-10-01):** all eight radio files listed above now import or re-export from `@shared`. That includes `masterChain.ts` (`MASTERING`, `saturationDrive`, `saturationMakeupDb`) and `engine.ts` (`PumpRole`), which were edited after radio commit `4c233bf` (the listener's saturation, pump and echo controls) had landed. `stepThrows` takes an optional `everyBars`, which defaults to `THROW_EVERY_BARS`, so Task 11 can pass `throwEveryBars(rate)`. The web's echo level (`Engine.setEcho`, 0..1) is `throws.level`, which Task 11/12 multiplies into the `dubSend` curve. The radio's tests for the moved rules were trimmed to one re-export smoke test (`src/radio/sharedRules.test.ts`), so the logic is tested once, in sssketch. Follow-up, Elling 2026-10-01: `reverb.amount`, `mastering.headroomDb`/`ceilingDb` and `tone.amount` are adjustable too.

- [x] **Step 1.** Copy each module verbatim, doc comments included, into sssketch `src/shared/`. Move its existing radio test with it. Run the tests red-then-green.
  - `radioThrows.ts` takes the pure `throwDelaySec`/`throwTailSec`/`ThrowTiming` out of `dubDelay.ts`.
  - `radioPump.ts` takes `PumpRole` out of `engine.ts`.
- [x] **Step 2.** In `radioSound.ts`, add the numbers (`REVERB_IR`, `REVERB_RETURN_DB`, `MASTERING`, `DUB_*`) and the `SoundSettings` shape above, with `DEFAULT_SOUND_SETTINGS`, `normalizeSoundSettings` and the amount-to-parameter maps. Tests pin:
  - every number as the web spec states it;
  - defaults all on;
  - junk normalised to defaults;
  - amounts clamped;
  - `glueThresholdDb(0.5) === -14`;
  - `throwEveryBars('normal')` deep-equals `[16, 32]`.
- [x] **Step 3.** Add the timeline helpers, test-first:
  - `stemPansForRifff(stems)`: `panForSlots` over the rifff's stems in slot order, with a `drums`/`bass` `SoundType` counted as centred;
  - `pumpRoleForSoundType(type)`.
- [x] **Step 4.** In the radio repo, replace each module's body with `export … from '@shared/…'`. Make radio's `panForSlots` call honour a width argument, defaulting to `ROW_PAN`. Run its tests and commit there.
- [x] **Step 5.** Commit in sssketch. No renderer or engine change yet.

**Risk:** low. Land the sssketch commit before the radio one.

---

### Task 1: the Faust toolchain, `.dsp` files in sssketch, the web re-pinned, golden vectors (nothing wired)

**Files:**
- Move the five `.dsp` files from radio `src/audio/faust/` to sssketch `native-engine/Source/dsp/faust/`.
- Create `arch.cpp`, `LICENSES.md`, `FAUST_VERSION`, `generated/{saturate,glue,pump,truepeak,reverb}.h`.
- Create `scripts/build-faust-cpp.mjs`, `scripts/buildFaustCpp.test.ts`, `FaustStage.h/.cpp`, `FaustStageTests.cpp`, `native-engine/test/golden/`.
- Modify `CMakeLists.txt`.
- In radio: `scripts/build-faust.mjs`, `scripts/buildFaust.test.ts`, `package.json`, `src/audio/faust/LICENSES.md`, plus a new `scripts/golden-vectors.mjs`.

- **As landed (2026-10-01):**
  - Native Faust 2.88.0 from Homebrew, `brew pin`ned. Of faustwasm 0.17.0–0.18.5, 0.18.3 and 0.18.4 bundle libfaust 2.88.0; the web is pinned to **0.18.4**. The re-pin gate passed: the seeded golden input through each committed wasm, before and after, is bit-identical for saturate, glue, pump and truepeak, and within 2.4e-7 for reverb.
  - The compile line gained two options beyond Step 6's: `-fm arch` (the math functions are `fast_<fn>f`, defined in `FaustArch.h` in double precision rounded to float, as the wasm gets them from JS `Math`) and `-fp` (full parentheses: without it the C++ printer drops the brackets of a long sum and C++ adds left to right, while the wasm keeps Faust's order; truepeak came out 1.4e-6 off). With both, native matches the web **bit for bit** for saturate, glue, pump and truepeak, and within 2.4e-7 for reverb (its `sin`).
  - The bases live in `FaustArch.h`, which `arch.cpp` includes, so `FaustStage.h` can use them without the generated code. The generated headers are included by one TU, `dsp/faust/FaustDsps.cpp` (`makeFaustDsp(kind)`), compiled `-w -ffp-contract=off`.
  - **`pump.dsp` was 8 inputs, now 4.** `duckDb`'s `-(...)` was a partial application (`_ - x`), leaving free inputs the web's upmix fed with silence. It is now `0 - (...)`: 4 inputs, one `duck` bargraph, and the same output to the byte (the re-rendered `pump.out.f32` is identical). `FaustStage::process` still feeds silence to any input a caller doesn't supply.
  - Golden vectors: radio's `scripts/golden-vectors.mjs` runs `faustProcessor.js` itself in Node. `test/golden/` holds `programme.f32`, `key.f32` (2 s, 48 kHz, planar float32), `<name>.out.f32` and `manifest.json`. `FaustStageTests` finds them from the executable's location (`$SSSKETCH_GOLDEN_DIR` first); no source path is compiled in.
  - Checks: CI runs only the hash test (each `.dsp` against line 2 of its header and the golden manifest); the regenerate-and-compare drift test (needs `faust`) and `FaustStageTests` run locally. Radio's `deploy/deploy-page.sh` runs its `buildFaust.test.ts` before building (not for `RADIO_SRC` rollbacks) and counts sssketch's `native-engine/Source/dsp/faust` in its dirty check.

- [x] **Step 1. Install and pin the native compiler.** `brew install faust`, then `faust --version`; expect 2.88.0. Then `brew pin faust`, so an upgrade can't move it under the generated code. Record the exact version string in `native-engine/Source/dsp/faust/FAUST_VERSION`.
- [x] **Step 2. Match the web to it.**
  - In the scratchpad, `npm pack @grame/faustwasm@<v>` for each release from 0.17.0 to 0.18.4. For each one, instantiate it and print `compiler.version()`. Pick the release whose libfaust equals `FAUST_VERSION`.
  - Before re-pinning, render golden vectors with the **current** wasm (Step 4's script) and keep them.
  - In the radio repo, set that version in `package.json` (exact, no caret), update `PINNED_VERSION` in `build-faust.mjs`, run `node scripts/build-faust.mjs`, and commit the new `.wasm`/`.json`.
  - Re-render the golden vectors and diff them against the pre-re-pin ones. The expectation is max abs difference ≤ 1e-6 per DSP.
  - **If the difference is larger**, the DSP changed audibly between compiler versions. Stop and tell Elling, who A/Bs the web before and after.
  - **If no published faustwasm reports the native version**, keep the web at 0.18.5, build Faust 2.89.2 from source (`grame-cncm/faust`, the commit that sets `FAUSTVERSION` to 2.89.2), and pin that path in `FAUST_VERSION` instead.
- [x] **Step 3. One copy of each DSP (D4).**
  - `git mv` is impossible across repos: add the files in sssketch, then delete them in radio in the same session.
  - Radio's `build-faust.mjs` sets `FAUST_SRC_DIR = process.env.SSSKETCH_DIR ? join(SSSKETCH_DIR, 'native-engine/Source/dsp/faust') : join(ROOT, '..', '..', 'sssketch', 'native-engine', 'Source', 'dsp', 'faust')`. That is the same relative layout the `@shared` alias in `tsconfig.json`/`vite.config.ts` already assumes.
  - It keeps writing `.wasm`/`.json` into radio's `src/audio/faust/`, where they are committed.
  - `buildFaust.test.ts` already recompiles and diffs, so it now also fails when a `.dsp` in sssketch changes without the radio's wasm being rebuilt. That is the drift alarm between the repos.
  - Radio's `LICENSES.md` points at sssketch's.
- [x] **Step 4. Golden vectors (the red test's data).**
  - Radio's `scripts/golden-vectors.mjs` instantiates each committed `.wasm` in Node, as `faustProcessor.js` does, at 48 kHz.
  - It feeds a fixed, seeded input: 2 s of a burst, sine and noise programme, plus a seeded kick key for `pump`.
  - Parameters stay at their defaults.
  - It writes little-endian float32 in and out files into sssketch `native-engine/test/golden/`.
- [x] **Step 5. Failing native test.** `FaustStageTests`, for each DSP, run with `cd native-engine && cmake --build build && build/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine --test`:
  - the golden input through `FaustStage` in 128-sample blocks matches the golden output: **bit-identical (memcmp) for saturate, glue, pump and truepeak; max abs error ≤ 5e-7 for reverb** (its per-sample `sin`); and the same again, to the bit, under `juce::ScopedNoDenormals`;
  - blocks of 1, 64, 512 and a random split are bit-identical to the 128-sample render;
  - `latencySamples()` reads `latency_samples` (truepeak 75);
  - `setParam("/truepeak/ceiling", …)` reaches its zone;
  - the meters (`/glue/gr`, `/pump/duck`, `/truepeak/gr`) can be read.
- [x] **Step 6. Generate.**
  - `build-faust-cpp.mjs` checks that `faust --version` equals `FAUST_VERSION`, refusing otherwise.
  - It then runs `faust -lang cpp -i -a arch.cpp -cn <Name>Dsp -ftz 2 -single <name>.dsp` per DSP. The `-ftz 2` is the web's.
  - It writes `generated/<name>.h` with a header naming the version and the `.dsp` hash.
  - `arch.cpp` declares the minimal `dsp`, `UI` and `Meta` bases in `namespace sssketch::faust`.
- [x] **Step 7. Make it green.**
  - Add the headers to `CMakeLists.txt`'s vendored list, compiled with `-w`.
  - `FaustStage` holds the DSP in a `std::unique_ptr`, allocated in `prepare()` on the message thread, and collects param zones through our `UI`.
- [x] **Step 8.** `buildFaustCpp.test.ts` regenerates into a temp dir and diffs it against `generated/`. It is skipped with a clear message without `faust`.
- [x] **Step 9.** Write `LICENSES.md`:
  - GPL-2.0-or-later DSPs, combined into GPL-3.0-or-later;
  - the compiler is a build tool;
  - no GRAME architecture file is used;
  - the pinned versions on both sides.

  Commit in both repos.

**Risk:**
- **Re-pinning the web might change its sound.** Step 2's before/after golden diff is the gate, and Elling listens if it fails.
- **Version skew later.** `brew pin`, the `FAUST_VERSION` check and the drift tests on both sides cover it.
- **The radio build now needs an sssketch checkout.** It already does, for `@shared`.

---

### Task 2: the sound settings: storage, defaults and the wire (no DSP yet)

**What it does:** puts `SoundSettings` in each project and the app-wide defaults in a store, and sends the resolved settings to the engine. The engine parses them and ignores each stage until its task lands.

**Files:**
- `src/main/soundSettingsStore.ts` (+test), `src/main/index.ts` (IPC `sound-settings:get`/`:set`), `src/preload/index.ts`.
- `store.ts`, `serialize.ts` (+tests), `buildEngineProject.ts` (+test).
- `native-engine/Source/SoundSettings.h`, `EngineProject.{h,cpp}` (+Tests).

- **As landed (2026-10-01):**
  - `AppState.sound` is **optional**: absent means today's sound (no `sound` on the wire). Only the pre-project startup state and the throwaway previews that copy no project lack one. Every real project has one: `commitNewProject` takes the app-wide defaults, and `deserializeProject(data, soundDefaults)` gives a legacy project those defaults and normalises a saved one against them. `App.tsx` passes them in from `state/appSoundDefaults.ts`, which fetches them once (`sound-settings:get`) and falls back to all on.
  - `SET_SOUND_SETTINGS { settings: SoundSettingsPatch }` merges per stage (`mergeSoundSettings` in `radioSound.ts`), normalises, and is undoable (`history.ts` excludes only view and transient actions).
  - The wire: `buildEngineSound` in `buildEngineProject.ts`. Glue, tone and saturation are sent only with mastering on. `reverbReturn` is 2 × amount (the room's trim cancels), absent at 1. The block is omitted when it would be just `{ room: 'zita' }`. Panning, throws and riser variety put nothing in it.
  - Native: `SoundSettings.{h,cpp}` with `parseSoundSettings`, called by `parseEngineProject`. A stage that is not an object or has a missing or non-finite number is off. A room other than `"cavern"` is zita. Values are clamped to each stage's range. Tests: `SoundSettingsTests.cpp`.
  - Discover's `previewState` and `useThrowawayStemPreview` copy `sound`, falling back to `appSoundDefaultsNow()`. The backup preview (`ProjectLibraryBrowser`) plays stems only, not an engine project.
  - **Review follow-up:** the live store starts from `startupState` (`initialState` plus `sound`, all on), so a project saved without "new project" still carries settings. When the startup fetch resolves, App dispatches `ADOPT_APP_SOUND_DEFAULTS`, which is transient and only takes effect while the sound is still the untouched startup object. `SET_SOUND_SETTINGS` on a state with none merges onto `appSoundDefaultsNow()`. The C++ parser drops glue, tone and saturation without mastering. `soloState` (`nativeExport.ts`) applies `stemExportSound`: per-stem bakes and stem exports keep the room, its return and the per-stem stages, and drop mastering, glue, tone, saturation and the pump.

- [x] **Step 1. App-wide defaults.** `soundSettingsStore.ts` is a userData JSON read through `normalizeSoundSettings(…, DEFAULT_SOUND_SETTINGS)`, as `discoverSettingsStore.ts` does. Tests follow that file's pattern (mock only `app.getPath`):
  - a missing file gives all on;
  - junk is normalised;
  - a set round-trips.
- [x] **Step 2. Per project.**
  - `AppState.sound: SoundSettings`.
  - `SET_SOUND_SETTINGS` takes a partial and merges it.
  - A **new project** initialises from the app-wide defaults (fetched over IPC once at startup).
  - `serialize.ts` saves `sound`.
  - `deserializeProject` normalises it, and a **legacy project without `sound` gets the app-wide defaults**. "Everywhere" includes old projects; Elling can switch stages off per project.
  - Tests:
    - round-trip;
    - legacy gets the defaults;
    - unsaved-changes tracking sees a settings edit (`unsavedChanges.ts`);
    - undo history covers it, if `history.ts` covers comparable project-level edits such as `reverb`. Check it and follow the same rule.
- [x] **Step 3. The wire.** `buildEngineProject` emits `sound` with **resolved** parameters:
  ```ts
  sound: {
    mastering: { headroomDb, ceilingDb } | absent,      // straight from the settings (-4, -1 by default)
    glue: { thresholdDb, ratio: 2, kneeDb: 6 } | absent,
    tone: { lowShelfDb, highShelfDb } | absent,          // toneShelvesDb(amount); +1/+1 at 0
    saturation: { drive } | absent,
    room: 'cavern' | 'zita',
    reverbReturn: number | absent,                       // reverbReturnGain(amount, room) / today's trim for the room; absent at 1 (amount 0.5)
    pump: { depthDb } | absent,
    dub: absent   // Task 10
  }
  ```
  - Stage off means the key is absent.
  - Every stage off still sends `room`; with `room: 'zita'`, the reverb amount at 0.5 and nothing else on, `sound` is omitted entirely, so the wire is byte-identical to today's.
  - The per-stem fields (`pan`, `pumpRole`, `dubSend`) and the riser fields arrive with their own tasks.
  - TS tests:
    - all-off is byte-identical to a pre-plan project;
    - each stage maps its amounts.
- [x] **Step 4. Parse.** `EngineProject.sound` (`SoundSettings.h`), where absent fields mean off. Native tests:
  - each field parses;
  - junk degrades to off;
  - an absent block gives an all-off struct.
- [x] **Step 5.** Discover's `previewState` already copies project-level fields from the real project (`reverb`, `masterChain`). Copy `sound` the same way. Discover then follows the open project's settings.

**Risk:** this is the widest twin change in the plan. It is all data with no DSP, which is why it is its own task. Each later task only flips its own stage from "parsed" to "performed".

---

### Task 3: the master stage, with the true-peak limiter at −1 dBTP (item 7)

**Where:** after the user's master plugin slots, as the last thing before the device or WAV. A user plugin after a limiter would undo −1 dBTP.
- `Transport.cpp`: in both `renderLoopAware` call sites, after `masterChain.process(...)` and before the reposition fade.
- `RenderExport.cpp`: after its `masterChain.process(...)`.
- Both call `engine.processMaster(n, l, r)`, backed by one `MasterStage` that `PlaybackEngine` owns. It reads `sound.mastering` from the published snapshot, so the two paths cannot diverge.

**Trigger:** `sound.mastering` (the "mastering" switch). **Params:** headroom −4 dB; truepeak ceiling −1 dBTP, release 0.1 s, lookahead 64, latency 75 samples.

**Native tests (`MasterStageTests`, `TransportTests`):**
- [x] **Off** (absent or switched off): `processMaster` leaves the buffers bit-identical.
- [x] **True peak:** a +6 dBFS sine at fs/4, at a 45° phase, measured with the test's own 8× sinc upsampler, comes out ≤ −1.0 dBTP + 0.1 dB.
- [x] **Transparent below threshold:** a −20 dBFS sine comes out ×10^(−4/20), delayed exactly 75 samples.
- [x] **Block-size invariant**, bit-identical.
- [x] **Live equals export:** the same project through `RenderExport` and through `renderLoopAware` + `processMaster` matches.

- **As landed (2026-10-01):**
  - `MasterStage.{h,cpp}`: headroom trim → Faust `truepeak` (ceiling from `sound.mastering.ceilingDb`, release and lookahead at the `.dsp`'s defaults). `PlaybackEngine` owns the one instance; `processMaster(sampleRate, n, l, r)` is called by `Transport` (both `renderLoopAware` sites, after `masterChain.process`, before the reposition and halt fades) and by `RenderExport`, after its `masterChain.process`.
  - **Where the settings come from:** `renderBlock` copies its snapshot's `sound.mastering` into a rendering-thread member and `processMaster` uses that, rather than loading `published` a second time (a second `shared_ptr` load per callback, and one more place the audio thread could drop a snapshot's last reference). A staged swap mid-block brings its mastering with it.
  - **Threading (the PluginChain slot pattern):** an `Instance` (the Faust object plus fixed 512-sample scratch, so the device block size never matters) is built on the message thread and parked in an atomic `pending` cell; `process()` promotes it and parks the old one in `retired`, deferring while `retired` is occupied; `PlaybackEngine::drainRetiredProject()` frees it. Built by `buildSnapshot` (so `setProject` and `stageProject`) when a project has mastering, and rebuilt by `prepareMaster(rate)`, which `Transport::audioDeviceAboutToStart` and `RenderExport` (before `setProject`) call. Until told, the rate is 44.1 kHz, the transport's and export's default. A block at a rate with no instance ready passes through untouched and is counted (`masterRateMismatchCount`), rather than going silent or allocating.
  - **`RenderExport`** is split: `renderProjectToBuffer(project, bars, rate, blockSize, out, err)` renders floats, and `renderProjectToWavFile` writes it (still 44.1 kHz / 512, 16-bit). The live-equals-export test compares the float buffer with the Transport callback output in 300-sample and random blocks, to the bit.
  - **Beyond the plan (conservative additions):** switching mastering on or off mid-play crossfades over 20 ms between the dry and limited signals (no 4 dB step, no 75-sample jump; the ceiling is not held during those 20 ms). That includes switching on in a play that started with mastering off: `MasterStage` remembers it has sounded (any `process()` call, off ones included -- a flag, not a sample) since it was built or reset, so the first engage after that fades in. A headroom change ramps over 20 ms. Only the very first `process()` of a fresh stage, or after `reset()`, engages at once with no fade, so an export and a play from a stop start the same (live equals export, to the bit). `Transport` calls `engine.resetMaster()` when a stop or pause fade completes, so the limiter's line (which holds unfaded audio, since the fade runs after it) does not replay 75 old samples on the next play, and from `audioDeviceAboutToStart` (no callback runs there: JUCE calls it before the device starts or under its `audioCallbackLock`), so a restart at the same rate does not either.
  - **Seeks with the stage on (review fix, 2026-10-02):** the reposition fade runs after the limiter but the playhead jumps at its input, so the fade-in now holds at silence `MasterStage::kLatencySamples` longer (`repositionHoldSec`, from `engine.masterLatencySamples()`, set when the fade-out completes; 0 with the stage off, so the off path's timing is unchanged). The 75 old samples left in the line play at gain 0 and the new audio arrives as the fade-in starts from 0.
  - **Rate swaps:** a second rate change while `retired` is still occupied leaves blocks at the new rate passing through unlimited (counted in `masterRateMismatchCount`) until the next `drainRetiredProject` -- on every IPC message, ~30 Hz while playing, every 750 ms otherwise. Commented in `MasterStage.h`.
  - **Latency:** 75 samples, not compensated (commented in `MasterStage.h`). An export keeps its length, so its last 75 samples stay in the line.
  - **Limiter measured:** ≤ −0.99 dBTP on a tonal programme driven ~11 dB into it, at 44.1/48/96 kHz. On full-band noise driven 8–11 dB in, the web's `truepeak.dsp` reaches **−0.67 dBTP** (its header records −0.86 at a lower drive): per-sample gain modulation plus the 4× detector missing near-Nyquist peaks. The native stage is the web's DSP to the bit (the golden test runs `programme.f32` through the whole stage at 0 dB headroom and matches `truepeak.out.f32` by memcmp), so this is pinned as a ≤ +0.4 dB regression bound, not changed. Fixing it is a `.dsp` change for both repos (e.g. 8× detector points or a longer filter), for Elling to decide.
  - **Tests:** `MasterStageTests` (17: off, unprepared/mismatched rate, transparency with the exact 75-sample delay at 44.1/48/88.2/96/176.4/192 kHz, true peak on the fs/4 sine at three ceilings and four rates, the tonal and full-band programmes, the golden, block sizes 1–8192 and random, fade out, fade in after on→off→on, fade in when switched on in a play that started off, fades and ramps block-size invariant to the bit under the same switch schedule, the headroom ramp, reset, rate swaps and deferral, a concurrency stress); `TransportTests` (5: live equals export to the bit, off is today's for no `sound` and for glue/saturation without mastering, a stop resets the stage, `prepareMaster` reaching the stage, a seek with the stage on lands under silence).
  - **Overshoot decision (Elling, 2026-10-02): leave it.** The −0.67 dBTP on hot noise stays; no `.dsp` change.

**The 75-sample latency** (1.6 ms at 48 kHz) is not compensated against the playhead. Say so in the code comment.

**Risk:**
- **Level:** the −4 dB headroom makes every project, the timeline included, quieter before limiting.
- A stale engine binary: rebuild and relaunch.

**Elling listens:**
- loud stacks no longer crackle;
- the level drop on an existing timeline project;
- switching mastering off in the project gives today's sound back.

---

### Task 4: per-row panning (item 1)

**Where:** per stem, in its own buffer, after the volume curve and **before the reverb send**. That is post-pan, as on the web. Order: `filter → volume → pan → send → channel`.
- A stem with pan ≠ 0 takes the toolkit path, so it has its own buffer.
- Pan 0 never touches the samples.

**Law:** Web Audio's `StereoPannerNode` on a stereo input (a mono stem is already L = R natively):
- for p ≤ 0, x = p + 1: `L' = L + R·cos(x·π/2)`, `R' = R·sin(x·π/2)`;
- for p > 0, x = p: `L' = L·cos(x·π/2)`, `R' = R + L·sin(x·π/2)`.

**Trigger:** new wire field `EngineStem.pan` (−1..1, absent means 0), emitted when `sound.panning.on`. The pan is `±width`:
- **Discover:** `panForSlots(slots, width)` over **all** slots in slot order, keyed by slot id, so a swap or a mute never moves a row.
- **Timeline:** `stemPansForRifff(stems, width)` per rifff, by slot and `SoundType`.

**Native tests (`StemPanTests`, `PlaybackEngineTests`):**
- [x] Pan 0 is bit-identical to today.
- [x] +0.25 on a stereo stem matches the formula sample for sample.
- [x] A mono stem at +0.25 gives `L = cos(π/8)·x`, `R = (1 + sin(π/8))·x`.
- [x] The send is post-pan.
- [x] Block-split invariance.
- [x] **TS:** the Discover and timeline pan maps, width honoured, panning off emits no `pan`.

**Risk:** low. Check that a panned stem with no send still adds no send, since today a stem without a toolkit has none.

- **As landed (2026-10-02):**
  - **Engine.** `StemPan.h` (`applyStemPan(pan, n, l, r)`): the StereoPannerNode law, arithmetic as Chromium's `stereo_panner.cc` (gains and each output sample in double, rounded to float once); pan 0 (and -0, and NaN) returns without touching a sample; clamps to [-1, 1]; stateless, so block splits cannot matter. `EngineStem::pan` (parsed in `EngineProject.cpp`: absent, non-finite or junk is 0, clamped). In `renderBlock` a stem takes its own buffer when `hasToolkit || pan != 0`; `finishStem` runs `applyStemToolkit(..., pan, ...)` (filter → volume → **pan** → `addSend`) or, for a panned stem without a toolkit, `applyStemPan` alone and no send: such a stem never opens or feeds the reverb bus (`anyToolkitActive` is untouched), as the risk note asked. No allocation: the stem scratch is today's. One shared path, so live, every export and the phone loop render all pan the same.
  - **Wire (TS).** `EngineStem.pan?` in `buildEngineProject.ts`, present only when non-zero (absence is load-bearing, like `toolkit`; `-0` from a width of 0 is omitted too). `timelineStemPans(state)` is the timeline rule (`stemPansForRifff` per **placed** rifff, by slot and `SoundType`, muted stems included so a mute moves no row), empty with panning off or no `sound`. `buildEngineProject` gained a fifth argument, `options: { stemPans? }`: Discover's map **replaces** the timeline rule, and is ignored while panning is off. Discover: `discoverStemPans(slots, memberSlotIds, groupId, width)` in `radioPan.ts` runs `panForSlots` over **all** the panel's slots (`slotsRef.current`), by slot id, onto the preview stems' keys (`stemKey(groupId, i + 1)` in member order). `stereoPanFrame` in `radioPan.ts` is the TS twin of the law.
  - **Bounces and exports.** Everything that builds through `buildEngineProject` with the project's `sound` carries pan with no further change: the mixdown (`nativeExport`), stem and bus exports and per-stem bakes (`soloState` → `stemExportSound` keeps panning, per the D1/D2 ruling), the phone loop (`remoteLoopRenderer` renders the Discover project). **The phone's per-stem files** (`remoteStemRenderer`) are transcoded, not engine-rendered, so `sewLoopPCM16` gained a `pan` argument (applied after the gain by `stereoPanFrame`, stereo files only, pan 0 byte-identical) and `stemAudioFields` includes `pan` so a pan change is a new stem id.
  - **DAW exports (decision).** The bake/automation split the toolkit already has decides it. **Bake mode** bakes the pan: `clipsToBake` (now exported) adds every clip `timelineStemPans` puts off centre, toolkit or not, so a panned clip's file is rendered by the engine's own law and the session sounds as sssketch does. **Automation mode** keeps the audio dry and writes the pan as the stem's own track pan (every stem has its own track in that mode): Ableton `Mixer/Pan` `Manual`, REAPER a track `VOLPAN 1 <pan> -1 -1 1`. Those are each DAW's pan law, not StereoPannerNode's: same side, different near-side level (commented in both). Session track pan in bake mode was ruled out because bake mode packs several stems with different pans onto one track. Since panning is on by default, the export picker now offers the bake/automation choice when any placed stem is panned (`App.tsx`: `projectUsesToolkit(state) || timelineStemPans(state).size > 0`), and its heading reads "the filter, reverb, volume and pan".
  - **Auditions are centred (conservative addition).** Tidy Up / Auto Arrange auditions (`stemPreviewOverrides`) and the library audition (`useThrowawayStemPreview`) switch `panning.on` off for their one engine load, beside the toolkit they already strip: "Tidy Up is for deciding what a stem IS, so it has to sound like the file". Mastering and the room stay as Task 2 left them.
  - **Tests.** Native 354 (was 340): `StemPanTests` 7 (pan 0 / -0 / NaN untouched; ±0.25 stereo to the formula bit for bit; mono +0.25; the ends; clamping; block splits), `PlaybackEngineTests` 6 (pan 0 and -0 bit-identical with and without a toolkit; +0.25 stereo equals the formula over the unpanned render, bit for bit; mono +0.25 within 1e-6; a panned stem with no toolkit leaves exact silence after its last sample; the send is post-pan -- a hard-right mono row's tail matches a right-only stem's within 2e-4 and differs from a centred row's by over 4e-3, and the test fails with pan and send swapped; block sizes 512 / mixed / random bit-identical), `EngineProjectTests` 1 (parse, clamp, junk). Vitest: `radioPan` (`discoverStemPans`, `stereoPanFrame`), `buildEngineProject` (timeline map, width, mute keeps places, panning off / width 0 / no sound emit no `pan`, Discover's map replaces the rule and is ignored when off, `timelineStemPans` placed-only), `exportToolkitAudio` (a panned clip is baked by the real engine at cos(π/8)·x / (1 + sin(π/8))·x, not in automation mode, not with panning off), `buildAlsXml` / `buildRppProject` (track pan in automation mode only, none for a centred stem), `loopSewPCM16`, `phoneLoop`, `store` (an audition's panning is off).
  - **Not covered:** a width or on/off change mid-play steps the pan at the swap (the pan is static per project, no smoothing); at the default ±0.25 that is −0.7 dB on the far side and, for a mono stem, +2.8 dB on the near side. The phone loop fingerprint (`phoneLoopFingerprint`) carries pan through the stems but not the project's `sound` block, so a mastering or room change alone does not re-render the phone's loop (from Task 2/3, not changed here).

**Elling listens:**
- drums and bass centred, the rest gently left and right, in Discover and on the timeline;
- a swap doesn't move a row;
- the width slider.

---

### Task 5: the cavernous reverb (item 2, D3)

**Where:** `ReverbBus` gets a second room. With `sound.room === 'cavern'` the bus runs `CavernReverb` instead of zita. The sends and the lazy, neutral-is-free behaviour stay as they are. With `zita`, the bus is bit-identical to today.

**What it is:** a C++ twin of `noise.ts` `reverbImpulse`:
- mulberry32 white noise, seeds `0x5eed` and `0x5eed ^ 0x9e3779b9` (wide);
- 1024-point STFT synthesis, hop 256, Hann and Hann, divided by 1.5;
- per-bin decay `exp(-ln(1000)/T60(f)·t)` from `REVERB_IR`: 5 s at 125–250 Hz, 4.5 s at 1 kHz, 2.2 s at 8 kHz, 1.5 s at 16 kHz;
- 30 ms of leading zeros;
- Web Audio's `ConvolverNode` normalisation: scale = 0.00125 / max(rms over all channels and samples, 0.000125), × 44100 / sr; then `REVERB_RETURN_DB` (−3.4 dB).

**The convolver:**
- Hand-written, uniformly partitioned (1024, `juce::dsp::FFT`), with an input FIFO, so it is block-size invariant to the bit.
- Its 1024-sample latency is cancelled by trimming 1024 of the pre-delay's leading zeros. The pre-delay is 1323 samples at 44.1 kHz and 1440 at 48 kHz, both at least 1024.
- **Why not `juce::dsp::Convolution`:** it loads IRs on a background thread, so a fresh export would start dry.

**Built where:** the IR and its partitions (about 240 partitions per side, ~4 MB) are built on the message thread in `setProject`/`stageProject`. They are cached per sample rate and handed over through the snapshot. If there is a rate mismatch at render time, the bus is silent for that block and the message thread rebuilds; log it.

**Bake tails:** `exportToolkitAudio.ts` `reverbTailSeconds` learns the room. A cavern tail is pre-delay + 5 s. A test pins it.

**Native tests (`CavernReverbTests`):**
- [ ] **IR shape:** length = pre + 5 s; exactly zero for the first 30 ms; L/R correlation < 0.1.
- [ ] **Decay per band:** T60 at 1 kHz is 4.5 s ± 10%, at 8 kHz 2.2 s ± 10%, at 250 Hz 5.0 s ± 10%.
- [ ] **Twin:** the first 8,192 samples after the pre-delay match the TS `reverbImpulse` at 48 kHz within 1e-6 (a golden file from the radio repo).
- [ ] **Normalisation:** equals the Web Audio formula.
- [ ] **Convolver:**
  - an impulse in gives the normalised IR out, sample-aligned;
  - blocks of 1, 64, 512, 4096 and random splits are bit-identical;
  - with no send, nothing is built;
  - it reports ringing for the IR's length.
- [ ] **Zita:** projects with zita are bit-identical to today.

**Risk:**
- **CPU:** a few percent of a core per instance. Measure it in Task 14.
- **Memory:** ~4 MB per sample rate.
- **Bookkeeping:** the FIFO and partitions are the most intricate new C++.
- **Send level:** expect a trim by ear.

**Elling listens:**
- huge and darkening, with clear transients;
- a send of 0.5 against the web;
- blooms;
- switching to zita in a project restores today's room.

---

### Task 6: riser variety (item 3)

**Where:** `RiserVoice`/`NoiseRiser`, still rendered into the channel. A riser with a send also feeds `reverbBus.addSend`. Risers with a send mark the snapshot as `anyToolkitActive`.

**Wire (`EngineRiser`, all optional, absent means today's riser):**
- `q` (1–6, default 2);
- `colour: 'white' | 'pink'`;
- `stereo: 'wide' | 'mono'`;
- `send` (0–1).

**Trigger:**
- With `sound.riserVariety.on`, radio's transition risers (`buildTransitionRiser`) draw a `RiserCharacter`. They do this with the shared `drawRiserCharacter`, seeded from the riser id, so a re-sync redraws the same character.
- `level = 0.35 · 10^(levelDb/20)` (+3 dB on average).
- The sweep ends and the shape `start + (end − start)·p^curve` go into `RiserClip.curve` as 17 points, which `riserCutoffAt` already follows.
- Hand-drawn risers keep exactly what the user drew.
- The timing stays `buildTransitionRiser`'s.

**Native changes:**
- **Q:** gain `level · (1/Q) · sqrt(Q/2)`. This is today's peak normalisation times the web's power match to Q 2; it equals today's gain at Q 2.
- **Pink:**
  - Kellet's three one-poles over `riserNoiseAt`, with `riserVoice.ts`'s coefficients.
  - Level-matched to white at 6 kHz (`MATCH_HZ`) by a constant computed from the filter's magnitude there at the running rate. Pin it to the web's measured value.
  - Index addressing is kept by warm-up: on a discontinuity, re-run the filter over the 16,384 samples before the index (0.99765^16384 ≈ e^−38).
- **Mono:** `seedR = seedL`.

**Native tests (`NoiseRiserTests`):**
- [ ] The 13 existing tests pass unchanged when the fields are absent.
- [ ] RMS is within 0.5 dB across Q 1, 2, 4 and 6.
- [ ] The pink slope is −3 dB/oct ± 1 from 200 Hz to 8 kHz.
- [ ] A pink seek matches a continuous render within 1e-6, and two fresh renders are bit-identical.
- [ ] Mono gives L == R.
- [ ] A send rings the reverb; send 0 builds nothing.
- [ ] **TS:** character to fields; omission; same id gives the same character; variety off leaves the riser as today.

**Risk:** at Q > 2, "level means level" becomes a power match. Document it; the limiter (Task 3) is the backstop.

**Elling listens:**
- varied risers: whistly, full, narrow;
- about +3 dB;
- they bloom into the room;
- variety off restores today's riser.

---

### Task 7: glue compression and tone

**Where:** `MasterStage`, between the headroom trim and the limiter, in this order:
1. HP 25 Hz (tone);
2. a saturation slot (Task 8);
3. glue (Faust);
4. width (mid/side, the side through a +2 dB high shelf at 250 Hz; the mono sum is unchanged) (tone);
5. low shelf +1 dB at 100 Hz (tone);
6. high shelf +1 dB at 10 kHz (tone);
7. limiter.

The biquads are RBJ, at the web's Q: the HP's `biquadQ(0)` is −3.01 dB in Web Audio's decibel Q, which is linear 0.7071.

**Trigger and params:**
- `sound.glue` (threshold from the amount: 0.5 gives −14 dB, ratio 2, knee 6). That is `glue.dsp`'s defaults: the web's `loadFaust` sets no glue params, and `MASTERING.glue` (−11, knee 0) belongs only to its `DynamicsCompressorNode` fallback.
- `sound.tone` switches the HP, width and shelves.
- Both only run with mastering on.

**Native tests:**
- [ ] Whole-stage golden: the radio repo renders a seeded mix through its Faust chain (convolver off), and native matches within 1e-5.
- [ ] Glue below the knee is unity; +10 dB over the threshold comes out about +5 dB over.
- [ ] Width leaves L + R unchanged to 1e-6.
- [ ] The shelves are within ±0.1 dB of the RBJ formulas.
- [ ] Each switch off removes exactly its stage.
- [ ] Block-split invariance.

**Risk:** port the web's **Faust-path** chain, not its fallback trims (`GLUE_TRIM_DB` exists only for the `DynamicsCompressorNode`).

**Elling listens:** layers sit together; about 1–3 dB of gain reduction on a dense mix; nothing breathes; the glue amount slider; tone off.

---

### Task 8: tape saturation (item 5)

**Where:** `MasterStage`'s saturation slot, after the HP and before the glue. Faust `saturate`: drive from the settings (`saturationDrive(amount)`, 0.9 by default, D7), bias 0.1, makeup `0.5 × (drive/1.8)²` dB (inside the `.dsp`), DC blocker at 5 Hz. The drive is smoothed over ~20 ms in the `.dsp`, and drive 0 is an exact pass-through.

**Native tests:**
- [ ] Golden vector.
- [ ] A −40 dBFS sine comes out at unity ± 0.01 dB.
- [ ] THD of a −14 dBFS sine at the default drive 0.9 is 0.83% ± 0.2% (the web's measured figure). At drive 1.8 (amount 1) it is 1.8% ± 0.3%.
- [ ] Drive 0 is bit-identical to the stage switched off, latency included.
- [ ] No DC.
- [ ] A dense mix level-matches within 0.3 dB.
- [ ] Switched off, the stage is absent.

**Risk:** aliasing. The web's Faust stage is not oversampled, and native matches it. Add 2× oversampling only if Elling hears grit.

**Elling listens:** peaks rounded, nothing gritty; the drive slider.

---

### Task 9: the drum-keyed pump (item 6)

**Where:** `renderBlock`.
- The pumped stems' dry signal goes into a per-channel pumped scratch buffer, after filter → volume → pan → send, so the send is not pumped.
- The key stems' dry signal also goes into one project-wide key buffer.
- After the channel loop, `DrumPump` runs Faust `pump` (4 in, 2 out) over each pumped buffer and adds it into its channel, before the channel plugin chain.
- The pump works sample by sample with no look-ahead, so using the same block's key is exact.
- It multiplies the stems' own gains, so duck curves still work.

**Trigger:** `EngineStem.pumpRole: 'key' | 'pumped' | 'none'` (absent means none), emitted when `sound.pump.on`:
- **Discover:** `pumpRoleFor(slot.kinds)`.
- **Timeline:** `pumpRoleForSoundType(stem.type)`.

No key stem means no pump. Depth comes from the settings (4 dB by default); attack 3 ms; release 200 ms.

**Native tests (`DrumPumpTests`, `PlaybackEngineTests`):**
- [ ] Golden vector.
- [ ] No key: bit-identical.
- [ ] A 60 Hz kick at −10 dBFS ducks a pad by `depthDb` ± 0.3, reaching 90% in about 7 ms and recovering about 63% in 200 ms.
- [ ] 8 kHz hats duck it by under 0.5 dB.
- [ ] Drums and bass are untouched.
- [ ] The send is not pumped.
- [ ] Block-split invariance.
- [ ] **TS:** both role maps; pump off emits no `pumpRole`.

**Risk:** a new routing shape in `renderBlock`. Keep it to routing pointers and one post-loop pass.

**Elling listens:** a breath on pads with each kick, in Discover and on the timeline; drums and bass untouched; the depth slider.

---

### Task 10: the dub echo bus (item 4, engine half)

**Where:** `DubDelayBus`, shaped like `ReverbBus`: lazy, neutral-is-free.
- Fed by a per-stem, post-pan `dubSend` curve.
- Processed before `reverbBus.endBlock`, so 0.15 of it (`DUB_TO_REVERB`) can feed the reverb in the same block.
- Its wet signal goes into the master sum.

The DSP is a stereo ping-pong:
- L → HP 200 → LP 3500 → feedback → R, and back to L;
- each repeat is darker;
- feedback is clamped to 0.95;
- the line holds 2 s, with linear-interpolated fractional delay.
- **Web quirk, matched on purpose:** `dubDelay.ts` gives Web Audio's decibel-Q filters `Q: Math.SQRT1_2`, which is linear ≈ 1.085. Note it as a candidate fix on the web.

**Wire:**
- `EngineStemAutomation.dubSend` (wire-only, not a UI lane);
- `sound.dub: { delayBeats: 0.75 | 1, feedback }`.

The delay is `delayBeats × 60 / bpm`. A settings change is taken only while the bus is silent.

**Native tests (`DubDelayBusTests`):**
- [ ] An impulse into L gives echoes at d (R), 2d (L)…, each about `feedback` times the last, and darker.
- [ ] d = 0.375 s at 120 bpm dotted-eighth, and 0.5 s quarter.
- [ ] Feedback 2.0 is clamped; no runaway over 30 s.
- [ ] No send: nothing built, bit-identical.
- [ ] Echoes reach the reverb at 0.15.
- [ ] A change while ringing is deferred.
- [ ] Block-split invariance.
- [ ] Parse and round-trip.

**Risk:** the bus order (dub before reverb end); the Q quirk.

---

### Task 11: throws in Discover (item 4, live)

**Where:** DiscoverPanel's radio loop, beside the gesture code, gated on `radioOnRef.current` and `sound.throws.on`.

**Rules:** the shared `stepThrows`, fed a tick of `now` and `nextBeat` in transport seconds (bars × secPerBar), plus `bpm`, `held`, `leadingArmed` and the rows. `THROW_EVERY_BARS` comes from `throws.rate`.

**Turning a plan into the project:**
- A plan becomes `throwCurveFor(plan, loopBars, spb)`: a `dubSend` curve with 5 ms ramps, as `engine.ts` `throwDelay` draws it, plus `sound.dub`.
- Choose `nextBeat` at least one bar ahead (load-project lands 0.02–0.22 bar late).
- Clear the curve after the throw, before the lap returns to it.
- Also put it into any pending staged project, like gestures' `spares`.

**Tests:**
- [ ] `throwCurveFor`: bars, ramps, and the loop-top crossing (decide in the test: split into two segments, or refuse and redraw).
- [ ] A staged swap keeps the curve, if the panel's test seams allow it; otherwise add it to the walkthrough.

**Risk:** renderer plumbing in an 8.8k-line component, and curves that repeat every lap until cleared.

**Elling listens:** occasional in-time echoes on leads and pads, never drums or bass, darker each repeat, none while held or over a hole or riser; the rate setting.

---

### Task 12: throws on the timeline and in exports (item 4, deterministic)

**Why:** throws "everywhere" on the timeline cannot be live random draws. A bounce would then differ from the pass Elling just heard. So they are **planned from the project**.

**What:** `planArrangementThrows(arrangement, settings, seed)` in shared steps `stepThrows` across the arrangement's beat grid with a seeded random.
- The seed is a hash of the project's id and the rate, so the throws are stable across sessions and edits elsewhere.
- Eligible rows are timeline stems whose `SoundType` is neither `drums` nor `bass` and that are audible at that bar.
- It returns throw plans in absolute bars.
- `buildEngineProject` writes them as `dubSend` curves on each stem's toolkit, in **clip-relative** bars (the automation lane convention: bar 0 is the clip's left edge, `originBar`).
- Live playback and every export render the same project, so they hear the same throws.

**Tests (vitest):**
- [ ] The same project gives the same throws, and a different seed gives different ones.
- [ ] Never two at once (`busyUntil`); never on drums or bass; never on a muted stem.
- [ ] The rate is honoured.
- [ ] Throws off gives no curves.
- [ ] Clip-relative conversion for a clip that starts mid-arrangement and for a left-cropped clip.
- [ ] A throw near a clip's end is dropped rather than cut.
- [ ] **Native:** a timeline project with a planned throw renders the same live and through `RenderExport`.

**Risk:**
- Throws on hand-made arrangements may surprise. The setting is per project, and Elling can switch it off or set it to `rare`.
- A stem that already carries a user-drawn automation curve is fine: `dubSend` is a separate wire-only param and never collides with the user's lanes.

**Elling listens:** a timeline project with throws on; export it and compare it with the pass; `rare` vs `often`.

---

### Task 13: the sound settings UI

**Where, following existing patterns:**
- **Per project:** a `SoundSettingsPanel` opened from `TransportBar`, next to the master chain button, built like `MasterChainPanel`: the same open/close state and the same anchored panel. It is the project's mixer-level sound. It dispatches `SET_SOUND_SETTINGS`.
- **App-wide defaults:** a "sound defaults…" entry in TransportBar's settings (gear) menu opens the same panel bound to the app store (`sound-settings:get`/`:set`). It has a "use these in this project" action and a "make this project's the default" action.
- **Design:** `tokens.css`, lowercase copy, Silkscreen, sharp corners, no colour on chrome.

**Content, top to bottom:**
1. **mastering** (limiter) on/off + headroom (dB) + ceiling (dBTP);
2. **glue** on/off + amount, greyed out without mastering;
3. **saturation** on/off + drive, greyed out without mastering;
4. **tone** on/off + tilt (warmer ↔ brighter), greyed out without mastering;
5. **reverb** cavern | zita + amount;
6. **panning** on/off + width;
7. **pump** on/off + depth (dB);
8. **throws** on/off + rare/normal/often + level;
9. **riser variety** on/off.

The defaults panel adds **reset to defaults**.

**Readouts in dev only** (behind the existing dev flag, if there is one; otherwise none): glue gain reduction, pump duck and limiter gain reduction from the Faust meters, through a small engine query IPC.

**Carried over from Task 2's review (do these here):**
- After `window.rifffApi.setSoundSettings(...)`, call `forgetAppSoundDefaults()` (`state/appSoundDefaults.ts`), so the next new project and `appSoundDefaultsNow()` see the change.
- The Discover preview copies `sound` only when it syncs. A settings change mid-preview must resync it, the way the bpm effect does, so a switch is heard within a sync.
- Sliders commit on release (the `SET_DRAG_PREVIEW` pattern): live values while dragging, one `SET_SOUND_SETTINGS` on release, so undo is not flooded with one step per frame.

**Tests:**
- [ ] Reducer and selector tests for every control's action.
- [ ] A pure `soundPanelModel(settings)` covering what is greyed out and each label, tested.
- [ ] Components are verified by typecheck and lint, plus the walkthrough, per `CLAUDE.md`.

**Risk:** UI scope creep. Keep it to switches and sliders, with no new visual language.

**Elling listens and looks:**
- each switch changes what it says, live, within a sync;
- a project saves and reopens its settings;
- a new project starts from the defaults;
- an old project opens with the defaults;
- the defaults panel doesn't change the open project unless asked.

---

### Task 14: the bounce paths, and final verification

Every export follows the project's settings.

**The tests:**
- [ ] **Mixdown** (`nativeExport.ts` → `RenderExport.cpp`), native: for each stage switched on alone, then all on, a project renders the same live (`renderLoopAware` + `processMaster`) as through `RenderExport`. Mixdown in vitest: `nativeExport.test.ts` asserts the project it sends carries `sound` from the state.
- [ ] **Render parity** (`native-engine/test/parity/render-parity.test.ts`): add an all-stages-on case next to the existing one.
- [ ] **Already in place (Task 2 review):** `soloState` (`nativeExport.ts`) applies `stemExportSound` (`radioSound.ts`), so every solo render (per-stem bakes, stem and bus exports, the riser file) drops mastering, glue, tone, saturation and the pump, and keeps the room, its return and the per-stem stages. Check that each path below goes through it, and route `remoteStemRenderer.ts` the same way.
- [ ] **Toolkit bakes** (`exportToolkitAudio.ts`, `BakeStem.cpp`):
  - a baked stem carries its per-stem stages (pan, the `dubSend` throws and their tail, the reverb room and its tail);
  - it carries none of the master stages (the ruling above);
  - tail lengths account for the cavern (5 s) and the dub (`throwTailSec`).
- [ ] **DAW exports** (`exportAbleton.ts`, `exportReaper.ts`): the exported stems match the bakes above, and the project's master settings are not baked in. Note in the export README/notes that the mastering was left to the DAW. Follow whatever notes channel these exporters already use; if none exists, add nothing.
- [ ] **Phone renderers** (`remoteLoopRenderer.ts`, `remoteStemRenderer.ts`): the loop renderer is a mixdown, so the full chain. The stem renderer is per stem, so per-stem stages only. Tests mirror their existing ones.
- [ ] **Off is today:** a project with every stage off renders bit-identical to a pre-plan build (render parity plus a saved fixture).
- [ ] **CPU:** profile a dense mix (8 rows, all on) at 48 kHz/256. Note the numbers in the commit.
- [ ] The full native suite and `npx vitest run` are green. Hand Elling the walkthrough below.

**Ruling:** the per-stem/master split in DAW and stem exports is confirmed by Elling (see the decisions section).

---

## What Elling needs to listen to

Do this in `npm run dev`, after a **full Cmd+Q and relaunch** once the engine is rebuilt. A/B against `ell.ing/radio` at the same tempo where possible.

1. **Web re-pin (T1):** if the golden diff in Task 1 Step 2 was not clean, A/B the web before and after the faustwasm re-pin.
2. **Limiter (T3):** loud stacks don't crackle; the level drop on an old timeline project; mastering off restores today's sound.
3. **Pan (T4):** centred drums and bass, the rest gently spread, in Discover and on the timeline; the width setting.
4. **Reverb (T5):** cavernous and darkening; a send of 0.5 against the web; zita still available.
5. **Risers (T6):** varied, about +3 dB, blooming into the room; variety off restores today's.
6. **Glue and tone (T7):** layers sit together, nothing breathes; the amount setting; tone off.
7. **Saturation (T8):** peaks rounded, no grit; the drive setting.
8. **Pump (T9):** a breath on pads with each kick; the depth setting.
9. **Throws (T11, T12):**
   - in Discover: occasional, in time, darkening, never on drums or bass;
   - on the timeline: the export has the same throws as the pass;
   - the rate setting.
10. **Settings (T13):** every switch works live; settings save with the project; a new project gets the defaults; an old project opens with the defaults on.
11. **Exports (T14):** a mixdown sounds like the pass; a DAW export's stems have pan, throws and reverb but no mastering (the ruling Elling confirmed).
12. **The whole:** an hour of radio, and one finished timeline project. Does the app now sound like the web? Note anything that differs, with rifff names.

---

## Risks, in one place

| risk | where | mitigation |
|---|---|---|
| Old projects change sound on open (defaults all on) | T2 | Elling's decision; per-project switches; mastering off restores today's |
| Wire-twin blast radius (`sound` + per-stem + riser fields) | T2–T12 | T2 lands all the data first; optional fields; parse and round-trip tests both sides; off is bit-identical |
| Live ≠ export | T3–T12, T14 | one `processMaster` for both callers; block-size-invariant DSP; timeline throws planned from the project; explicit bounce-path tests |
| Audio-thread allocation | T1, T5 | Faust objects and the convolver built on the message thread, handed over via the snapshot |
| Faust versions (2.89.2 is not a release; brew is 2.88.0) | T1 | native 2.88.0 pinned (`brew pin`, `FAUST_VERSION` check); web re-pinned to the matching faustwasm, gated by a before/after golden diff; build from source as the fallback |
| Cross-repo `.dsp` drift | T1 | one copy in sssketch; radio compiles from it; both repos' drift tests fail on a stale build |
| Loudness shift | T3, T6 | headroom first, limiter as the backstop; Elling sets the level by ear |
| CPU | T5–T9 | measured in T14; a two-size partition scheme if the convolver is heavy |
| Matching web quirks rather than intent | T5, T7, T10 | match what Elling heard (convolver normalisation, decibel Q, StereoPanner law); each listed in code comments and offered as web fixes |
| `renderBlock` routing (pan, pump, dub) | T4, T9, T10 | pointer routing only; separate post-loop passes; heavy tests |
| DiscoverPanel plumbing | T11 | gated on `radioOnRef` and the setting; pure helpers extracted and tested |
| Per-stem vs master split in DAW and stem exports | T14 | confirmed by Elling, 2026-10-01 |
| The riser's "level means level" contract | T6 | becomes a power match, documented; the limiter backstops it |
