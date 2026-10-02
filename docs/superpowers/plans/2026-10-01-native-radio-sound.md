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
| `native-engine/Source/MasterTone.h/.cpp` (+`MasterGlueToneTests`) | Web Audio's BiquadFilterNode as Chromium runs it; the HP, width and shelves (Task 7) |
| `scripts/golden-master-chain.mjs` | the whole master chain's golden, rendered by the radio's own `masterChain.ts` in headless Chrome (Task 7) |
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
  - **Review follow-up (2026-10-02):**
    - **Per-block cost.** With panning on by default most stems take their own buffer, so the buffer is now cleared lazily (`prepareStemBuffer` in `renderBlock`), by the first segment that overlaps the block. A panned stem without a toolkit that has nothing in the block clears nothing and adds nothing (`finishStem` returns). A toolkit stem still runs every block over silence (its smoothers and filter tail), as before. Output is unchanged to the bit, and every existing parity test is untouched.
    - **DAW default.** `exportToolkitChoice` (`src/shared/exportToolkitChoice.ts`) decides the picker. It is offered when a clip has a toolkit, a riser exists, or a stem is panned. It starts on **automation** when pan is the only per-stem stage (no clip filter, send or volume curve; risers don't count), so a default export no longer bakes two thirds of the stems. Otherwise it starts on bake, as before. Bake still bakes panned clips when chosen.
    - **Overs.** A panned row's near side is louder than its source (+2.8 dB for a mono stem at width 0.25, +4.6 dB at 0.5), and per-stem renders have no master stage. So the per-stem renders are now **32-bit float WAV**: `render-export` takes an optional `sampleFormat: 'float32'` (`RenderExport.h`'s `WavSampleFormat`), sent by toolkit bakes (`exportToolkitAudio`) and by stem/bus and stem-track exports (`nativeExport`). The mixdown (limited), `risers.wav` and the phone loop stay 16-bit. Nothing downstream reads those files' sample format: the DAW sessions reference them by path, at the same 44.1 kHz.
    - **Phone stem id.** `pan` joins `stemAudioFields` only when it is non-zero, so a centred stem keeps its pre-Task-4 id (pinned by a test).
    - Pan-only bakes keep the `…-toolkit.wav` name. Nothing reads the name, but renaming buys nothing either.
    - **Tests:** native 358 (`PlaybackEngineTests` +4: a panned stem out of range leaves the mix bit-identical; a panned one-shot and a panned stem under a drawn volume curve both match the formula over their unpanned render, bit for bit; a float render keeps a 1.54 FS near side that 16-bit clips at 1). Vitest: `exportToolkitChoice`; a near-full-scale bake passes 1.0 in float; the stems export is float; the phone's 16-bit clipping limit (see below); the centred id.
  - **Not covered / for Elling:**
    - **The phone's per-stem files are 16-bit ALAC** (`sewLoopPCM16`). A near-full-scale row panned hard clips on its near side there (pinned as a known limit in `loopSewPCM16.test.ts`). At the default width it takes a source above about −2.8 dBFS (mono) to clip.
    - **Discover to the timeline can move a row.** A loop moved from Discover to the timeline is re-panned by `SoundType` over the stems it has there, not by its Discover slots, so a row can switch sides.
  - **Also not covered:** a width or on/off change mid-play steps the pan at the swap (the pan is static per project, no smoothing); at the default ±0.25 that is −0.7 dB on the far side and, for a mono stem, +2.8 dB on the near side. The phone loop fingerprint (`phoneLoopFingerprint`) carries pan through the stems but not the project's `sound` block, so a mastering or room change alone does not re-render the phone's loop (from Task 2/3, not changed here).

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
- [x] **IR shape:** length = pre + 5 s; exactly zero for the first 30 ms; L/R correlation < 0.1.
- [x] **Decay per band:** T60 at 1 kHz is 4.5 s ± 10%, at 8 kHz 2.2 s ± 10%, at 250 Hz 5.0 s ± 10%.
- [x] **Twin:** the first 8,192 samples after the pre-delay match the TS `reverbImpulse` at 48 kHz within 1e-6 (a golden file from the radio repo).
- [x] **Normalisation:** equals the Web Audio formula.
- [x] **Convolver:**
  - an impulse in gives the normalised IR out, sample-aligned;
  - blocks of 1, 64, 512, 4096 and random splits are bit-identical;
  - with no send, nothing is built;
  - it reports ringing for the IR's length.
- [x] **Zita:** projects with zita are bit-identical to today.

**Risk:**
- **CPU:** a few percent of a core per instance. Measure it in Task 14.
- **Memory:** ~4 MB per sample rate.
- **Bookkeeping:** the FIFO and partitions are the most intricate new C++.
- **Send level:** expect a trim by ear.

- **As landed (2026-10-02):**
  - **The impulse.** `CavernReverb.{h,cpp}`: `cavernImpulse(rate)` is `noise.ts` `reverbImpulse` line for line -- mulberry32 in uint32 (JS's int32 wrap), the noise rounded to float as the `Float32Array` does, Hann/Hann at hop 256 over 1024, `/1.5`, the per-bin `exp(-ln 1000 / T60(f) · t)` at the frame centre, 30 ms of exact zeros -- computed in double with a twin of the web's own radix-2 `fft.ts` (same bit reversal, butterflies and `cos/sin(ang·k)` twiddles), so it matches the TS **to the bit** at 48 kHz (max abs error 0, not just under 1e-6). Every number in the plan's description checked against the web code; they agree. `kCavernT60`/`kCavernPreDelaySec`/`kCavernReturnDb` twin `REVERB_IR`/`REVERB_RETURN_DB`.
  - **The golden.** `native-engine/test/golden/cavern-ir.{f32,json}`: L then R, the first 8,192 samples after the pre-delay at 48 kHz, plus the whole impulse's length and mean square (the normalisation's input). Written by sssketch's **`scripts/golden-cavern-ir.mjs`**, which bundles the radio's own `src/audio/noise.ts` with esbuild (`@shared` aliased to this repo's `src/shared`, as the radio's tsconfig does) and runs it in Node: `node scripts/golden-cavern-ir.mjs` (radio at `../ell.ing/radio`, or `RADIO_DIR=…`). Nothing was added to or changed in the radio repo. Regenerate after changing `REVERB_IR` or `noise.ts`. It sits beside the Faust goldens in its own files, since the radio's `golden-vectors.mjs` rewrites `manifest.json`.
  - **Normalisation.** `webAudioConvolverScale`: 0.00125 / max(rms, 0.000125) × 44100 / rate, the rms over both channels and every sample (pre-delay included), in double -- the Web Audio spec's `GainCalibration`/`MinPower`/`GainCalibrationSampleRate`, and the plan's formula. The native scale equals the one from the TS impulse's mean square to 1e-6. Then the −3.4 dB return. Both are folded into the partitions as one float gain, so an impulse in gives impulse × scale × trim out. (Chromium writes its calibration as −58 dB, 0.001259 rather than 0.00125: +0.06 dB, if the web is heard in Chrome. Not chased.)
  - **The convolver.** `CavernConvolver`: uniformly partitioned overlap-save, 1024-sample partitions, a 2048-point `juce::dsp::FFT` (real-only), split-complex spectra, the multiply-adds through `juce::FloatVectorOperations`. An input FIFO fills whole 1024-sample frames whatever the host's split, so the output is block-size invariant to the bit; the 1024-sample latency is cancelled by trimming 1024 of the pre-delay's zeros (1323 at 44.1 kHz, 1440 at 48 kHz), so the room lands exactly where a zero-latency convolution puts it. Below ~34.1 kHz the pre-delay is shorter than a partition: all of it is trimmed and the room arrives `1024 − pre` samples late (`extraLatency`; commented, not expected in practice). Silence is cheap: an all-zero input frame is flagged rather than transformed, and silent remembered frames are skipped in the multiply-add. 216 partitions a side at 44.1 kHz, 235 at 48 kHz; 3.9 MB of partitions per rate (shared) plus as much again of per-instance state.
  - **The bus.** `ReverbBus` runs two rooms: `setRoom(room, returnGain)` per block from the snapshot (`sound.room`, `sound.reverbReturn`). The sends feed the current room; a room that is not current but still ringing rings out on silence, so switching rooms mid-play hands over rather than cutting. The cavern's tail is `(partitions + 2) × 1024` samples after the last fed block -- a little past the impulse's length, after which its state is exactly zero, so stopping changes nothing; a room starting from silence clears its (already zero) state first. With `zita` and today's return the zita code path is unchanged. **`reverbReturn` is now performed for both rooms** (Task 2 parsed it; a wet × gain only when it is not 1).
  - **Threading (the MasterStage pattern, not the snapshot).** The convolver's state (the last ~235 input spectra) has to outlive snapshots -- `setProject` republishes at live-drag rate, and a fresh state per snapshot would cut the tail on every drag frame -- so it cannot ride the snapshot. Instead: the impulse and partitions come from `cavernIrFor(rate)`, a process-wide per-rate cache (mutex; message thread); `ReverbBus::prepareCavern(rate)` builds a convolver on the message thread and parks it in an atomic `pending` cell; the audio thread promotes it in `endBlock` and parks the displaced one in `retired`, which `PlaybackEngine::drainRetiredProject` frees. `buildSnapshot` (so `setProject` and `stageProject`) prepares one when the project's room is `cavern` and a stem sends (static send or send curve: `ProjectSnapshot::anyReverbSend`), at `masterRate` -- so with no send nothing is built. `prepareMaster(rate)` (Transport's device start, RenderExport) rebuilds it at a new rate if one exists. A cavern block at a rate with no convolver adds no wet signal, is counted (`cavernRateMismatchCount`) and leaves the rate for the message thread, which logs it and builds one on its next `drainRetiredProject`. Building the 48 kHz room takes 36 ms at Release (195 ms in the unoptimised local build), once per rate per process.
  - **CPU (measured).** 10 s of one stem sending throughout, rendered offline at 44.1 kHz: Release (`-O3`) 0.131 s with the cavern against 0.019 s with zita, i.e. the room is about **1.1% of a core**; the unoptimised local build 0.79 s against 0.09 s. Logged by `CavernReverbTests`' cost test, not asserted. Per callback, see the review follow-up below.
  - **Bake tails.** `exportToolkitAudio.ts` `reverbTailSeconds(roomSize, preDelayMs, room)` is exported: `cavern` is `REVERB_IR.preDelaySec` + the longest T60 = 5.03 s; zita's is unchanged. `renderToolkitAudio` reads the room from the project's sound settings (zita without any). The plan's "BakeStem sizes reverb tails" meant this: `BakeStem.cpp` is the LORE stem rotation and has no reverb.
  - **Export paths.** All of them build through `buildEngineProject` with the project's `sound`, so they follow the room with no further change: the mixdown and stem/bus exports (`nativeExport` → `RenderExport`, which calls `prepareMaster` before `setProject`, so the room is built at the export's rate before the first block), toolkit bakes (`soloState` → `stemExportSound` keeps the room and its return), the phone loop (`remoteLoopRenderer`). The phone's per-stem files (`remoteStemRenderer`) are transcodes with no reverb, as before. **DAW exports (decision: follow what exists).** Bake mode bakes each sent clip through the engine, so the cavern is in the audio, with the longer tail; automation mode keeps the audio dry and maps the send onto the DAW's own reverb return (Ableton's stock Reverb, REAPER's ReaVerbate), as it did for zita -- neither DAW can host this room, and the D1/D2 ruling's per-stem sends still apply as sends.
  - **Tests.** Native 374 (was 358; 379 after the review below): `CavernReverbTests` 16 -- the impulse's shape at 44.1/48 kHz (length, exact silence for 30 ms, L/R correlation); T60 per band (measured 4.50 s at 1 kHz, 2.20 s at 8 kHz, 5.07 s at 250 Hz); the golden (bit-exact; asserted exactly since the review) and the TS mean square; the normalisation formula, its floor and rate factor; an impulse through the convolver at both rates (aligned, within 1e-6 of peak); convolver splits 1/64/512/4096/random to the bit; the bus ringing for the impulse's length and then silent; in the engine: a send is the stem convolved with the normalised impulse, sample-aligned; with no send nothing is built (and zita builds no convolver); zita equals a project with no `sound` to the bit, and its return scales it; block sizes 1/64/4096/random and Transport (random device blocks) equal the export to the bit; a room that rings out and starts again is split-invariant; the return scales the cavern; switching rooms lets zita ring out; a rate mismatch is dry, counted, logged and rebuilt; the cost log. Vitest: `exportToolkitAudio` (the cavern tail is 5.03 s, a cavern bake is two bars longer, rings at +4 s and is silent after the impulse). **Zita against today, outside the suite:** a temporary test rendering a zita project (two stems, a static send and a send curve, panned, at blocks of 512, 300 and 1) was built into the pre-Task-5 code (a scratch worktree at `fef2443`) and into this code: the 4.2 MB float dumps are byte-identical.
  - **Not covered / found on the way:**
    - **`ChannelFilter` resets a clip's toolkit filter when a block is bigger than any before it** (`ChannelFilter::prepare` → `filter.prepare` wipes the state). So any clip with a toolkit -- every send, zita's too -- is not split-invariant for growing block sizes, and live is not export-identical for such a clip when the device block varies (a possible small click when the host block grows). Pre-existing, not changed; the new split tests start each render on its largest block. Worth a one-line fix in its own task.
    - The toolkit evaluates send curves once per block, so a send curve is split-dependent too (pre-existing). A room can only restart from silence at a project swap (a block boundary in every split) or under a send curve, so the cavern adds no split-dependence of its own.
    - The Transport's loop-seam anchor (`renderBlock(loopStart, …, 1, …)`) feeds one extra sample through the bus at each seam, cavern and zita alike (pre-existing).
    - Mixdowns, stem exports and the phone loop end at the arrangement's (loop's) end, so a 5 s cavern tail past it is cut there, as zita's was.
    - A room or amount change alone does not re-render the phone's loop (the fingerprint has no `sound`; Task 4's note).
  - **Review follow-up (2026-10-02):**
    - **A stop drops the cavern's tail.** Nothing renders while halted, so the room used to freeze and ring on under the first seconds of the next play (and that play differed from an export). `ReverbBus::dropCavernTail()` (O(1); the next block clears the convolver) is called through `PlaybackEngine::dropReverbTail()` where Transport's stop/pause fade completes, beside `resetMaster()`, and from `audioDeviceAboutToStart`. Tested: a loud send stopped mid-tail and played from bar 0 equals the export (to within denormal dust, below); without the drop it is ~0.02 off throughout. **A seek keeps the tail** (a real room keeps ringing), pinned by a test. **Zita is left as it was**: it has no state-only clear and its `init()` allocates its delay lines, so after a stop zita still rings on from where it froze (pre-existing; a play after a stop is not an export for zita sends).
    - **The convolver's work is spread over the frame.** All partitions in the frame-completing callback measured 0.41 ms at 48 kHz and 0.83 ms at 96 kHz (Release), over a 64-sample buffer's 0.67 ms at 96 kHz. Partitions 1..P-1 need only remembered frames, so they are now multiply-added ahead, `(P-1) × fifoPos / 1024` of them by each FIFO position, and the completing callback does partition 0, the FFTs and the inverse. The schedule depends on the FIFO position only and the sum order is fixed (1..P-1, then 0), so the output stays block-size invariant to the bit (the split tests, unchanged, pass) and the golden still matches exactly. Worst 64-sample callback, Release: **0.05 ms at 48 kHz, 0.08 ms at 96 kHz** (budgets 1.33 / 0.67 ms); a whole frame's work is unchanged (0.42 / 0.83 ms per 1024 samples). 192 kHz is not measured (Task 14).
    - **Rebuild loop closed.** `buildSnapshot` builds the cavern only when none exists (at `masterRate`); after that the rate is `prepareMaster`'s or the drain path's. Before, a render rate other than `masterRate` would have been rebuilt by the drain and then undone by the next project load, over and over. Tested.
    - **Tests (+5, native 379):** switching rooms with a clip still sending, both ways, equals the sum of the old room fed up to the switch and the new room fed from it, to the bit; a live convolver rebuilt at a new rate is promoted, the old one retired and drained (and `prepareMaster` reaches it; a later load does not move it); a rate the engine was not told about is built once, with no rebuild loop; the stop test; the seek test. The old "switching rooms" engine test is retitled to what it checks (zita's tail rings out). The golden check now asserts exact equality, with a note to loosen it to the plan's 1e-6 if another libm moves a sample. The cost test logs the worst 64-sample callback at 48 and 96 kHz.
    - Small: `stemSendsToReverb` is shared by the neutrality rule and the cavern's "anything sends?" (now a local, not a snapshot field); comments that the return gain is not smoothed (as zita's), that the cavern runs at a return of 0 to keep its state, and that the per-rate impulse cache and the live convolver are never freed (bounded by the rates used, ~8 MB each).
    - **Found:** the per-clip toolkit filter (`stemDsp`) is not reset by a stop either; its state decays to denormals (~1e-44) rather than zero, which reach the first sample of the next play. Inaudible; it is why the stop test compares within 1e-30 rather than to the bit. Pre-existing, beside the `ChannelFilter::prepare` note above.

**Elling listens:**
- huge and darkening, with clear transients;
- a send of 0.5 against the web;
- blooms;
- switching to zita in a project restores today's room.
- **added 2026-10-02:** existing projects (all on by default) now play the cavern: their sends sound longer and darker than before, and a DAW bake's sent clips are about two seconds longer -- is that wanted for old timeline projects, or should they keep zita? The reverb amount now scales zita's return too (0.5 = today's).
- the room switch mid-play (zita rings out, the cavern takes over) for a click or a jump.

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
- [x] The 13 existing tests pass unchanged when the fields are absent.
- [x] RMS is within 0.5 dB across Q 1, 2, 4 and 6.
- [x] The pink slope is −3 dB/oct ± 1 from 200 Hz to 8 kHz.
- [x] A pink seek matches a continuous render within 1e-6, and two fresh renders are bit-identical.
- [x] Mono gives L == R.
- [x] A send rings the reverb; send 0 builds nothing.
- [x] **TS:** character to fields; omission; same id gives the same character; variety off leaves the riser as today.

**Risk:** at Q > 2, "level means level" becomes a power match. Document it; the limiter (Task 3) is the backstop.

- **As landed (2026-10-02):**
  - **Wire.** `EngineRiser` (`EngineProject.h`) gains `q` (default `kRiserDefaultQ` 2, clamped to `kRiserMinQ`..`kRiserMaxQ` 1..6), `pink`, `mono` and `send` (clamped 0..1). Parse (`EngineProject.cpp`): only a JSON number counts for `q`/`send` (a string would otherwise read as 0, i.e. a real Q of 1); absent, junk or non-finite is today's riser; `colour` is pink only for `"pink"`, `stereo` mono only for `"mono"`. TS: `RiserClip` gains optional `q`/`colour`/`stereo`/`send` (`riser.ts`; `normaliseRiser` keeps each only when present and readable, clamped, never invented), and `buildEngineRisers` emits each **only when it differs from today's** (Q ≠ 2, pink, mono, send > 0), so a riser without a character sends exactly the keys it always did.
  - **Trigger.** `buildTransitionRiser(channelId, loopBars, bars, { variety })`: off (the default) is today's riser field for field; on, `applyRiserCharacter(riser, riserCharacterForId(riser.id))`. `riserCharacterForId` (`riserCharacter.ts`) is the shared `drawRiserCharacter` fed mulberry32 seeded by FNV-1a of the id (the radio's own `seededRandom`/`seedFor`). `applyRiserCharacter` (`radioTransition.ts`): level `0.35 · 10^(levelDb/20)`; the declared ends are the character's; the sweep `start + (end − start)·p^curve` as `RISER_SWEEP_POINTS` = 17 points on `curve` (`riserCutoffAt` follows them linearly); Q, colour, stereo and send as fields; id, row, timing and length untouched. `DiscoverPanel` passes `variety: normalizeSoundSettings(sound ?? appSoundDefaultsNow()).riserVariety.on`. Hand-drawn risers never get a character.
  - **Native (`NoiseRiser.{h,cpp}`).**
    - **Q:** `riserGainNormalisation(q)` = `(1/q) · sqrt(q/2)`, exactly 0.5 at Q 2 (so today's gain to the bit); the filter's resonance is set only when a riser asks for a Q other than the one it has.
    - **Pink:** `RiserPinkFilter`, Kellet's three one-poles in double over `riserNoiseAt` with `riserVoice.ts`'s coefficients, times `riserPinkMatchGain(rate)` = 1/|H(e^jω)| at 6 kHz (`kRiserPinkMatchHz`), computed once per rate in `prepare`. Against the web's **measured** constant (its `rmsAtMatch` code run in node): 0.5089 vs 0.5114 at 44.1 kHz (+0.04 dB), 0.4835 vs 0.4898 at 48 kHz (+0.11 dB); pinned within 0.15 dB. The web's band average and the analytic value drift apart higher up (+0.39 dB at 96 kHz; not pinned, the web runs at 44.1/48).
    - **Warm-up:** on a discontinuity (the voice's existing "the index I expected next is not this one" test -- a seek, a transport start, a loop wrap back into the riser, the first block it sounds in), `warmTo` re-runs the filter from silence over the 16,384 white samples before the index. At most one per riser per render call (indices inside a call are consecutive); never at a block boundary in continuous playback (a test counts exactly one warm-up for blocks of 1, 64, 333, 512, 4096 and random sizes). **Cost, measured:** 0.07 ms per warm-up for both sides at `-O3` (a standalone copy of the same code; 0.7 ms in the unoptimised local build), i.e. about 5% of a 64-sample callback at 48 kHz, once per riser start or seek. A mono pink riser warms one side.
    - **Mono:** the right side uses `seedL` (`streamR`), so L == R exactly; a mono pink riser runs one filter and uses it for both sides. The left side is the wide riser's left side.
    - `RiserVoice::render` now returns whether the block had any of the riser in it.
  - **The send (`PlaybackEngine.cpp`).** A riser with `send > 0` marks the snapshot `anyToolkitActive` and counts for "anything sends?" (so the cavern's convolver is built for it, and with send 0 nothing is). It renders into the snapshot's stem scratch (sized the way `prepareStemBuffer` sizes it), which is added into its channel and fed to `reverbBus.addSend` at a constant gain (a settled `ParamSmoother` at `send`), post-level, pre the channel's plugins. It is **fed every block, silence included**, as a sending clip's toolkit is: the cavern's convolver frames its input from the first block it is fed, so feeding only the blocks the riser sounds in framed it from a split-dependent block and the room differed by a few ULPs between live and export (found by the split test). A riser without a send renders straight into the channel as before.
  - **Beyond the plan (a fix, flagged):** `RiserVoice::prepare` now re-prepares only on a **rate** change. It used to also re-prepare when a block was bigger than any before, and JUCE's `StateVariableTPTFilter::prepare` resets the filter: a riser was reset mid-sweep (a possible click) whenever the host's block grew -- e.g. Transport's loop-top split followed by a full block -- and was not split-invariant for growing blocks (white too). For pink that would also have been a warm-up at a plain block boundary, which this task rules out. JUCE's SVF never reads the block size. Fixed-size renders (every export, every existing test) are unchanged.
  - **Off is today, checked outside the suite.** A temporary test dumping the riser (voice at blocks 512/300/64/1; the engine with a plain and a drawn-curve riser, zita and cavern rooms, blocks 512/300) was built into the pre-Task-6 code (a scratch worktree at `0091c09`) and into this code: the 14 MB float dumps are byte-identical.
  - **Bounces and exports.** Everything builds through `buildEngineRisers`, so nothing else changed. Radio's transition risers exist only in Discover's preview project, so they reach live Discover and **the phone loop** (`remoteLoopRenderer` renders that project through the engine; `phoneLoopFingerprint` includes the risers' JSON, so a character change re-renders it). **DAW exports and `risers.wav`:** only the timeline's hand-drawn risers are there, and they never carry a character, so both are unchanged. (Decision, following what exists: `risers.wav` is rendered by the engine in both modes with the project's room, so if a timeline riser ever carried a send, its wet would be baked into that file in bake **and** automation mode, with the file's tail cut at the riser's sounding end; no path produces one today.)
  - **Tests.** Native 391 (was 379): `NoiseRiserTests` +11 -- the normalisation (exact at Q 2, clamps, explicit defaults render as absent ones, white never warms up); RMS within 0.5 dB of Q 2 at Q 1/4/6 at three cutoffs (~320 Hz to ~2.5 kHz; higher it is logged: Q 1 is −0.57 dB at ~5 kHz and −0.77 dB at ~10 kHz, the TPT band's warping near Nyquist); the peak at each Q, logged and bounded (see below); the pink match against the web's constants, pink as loud as white at 6 kHz (within 0.5 dB) and >10 dB up at ~300 Hz; the pink slope (Welch, measured −3.02 dB/oct, each octave within ±1); the seek (filter < 1e-12, voice < 1e-6, wide and mono), two fresh renders and all block sizes bit-identical with one warm-up each; one warm-up per start (a jump back warms again) and the cost log; mono L == R for white and pink; the send rings both rooms and the wet scales with the send (within 1e-5), nothing of the cavern before its 30 ms pre-delay (FFT round-off < 1e-9); send 0 builds neither room and equals the no-`sound` render to the bit, a send builds the room it sends to; a sending riser at blocks 1/64/512/4096 and random sizes equals `renderProjectToBuffer` to the bit. `EngineProjectTests` +1 (parse, clamps, junk). The 13 existing riser tests are untouched. Vitest: `buildEngineProject` (no character, the old keys exactly; defaults omitted; differing fields sent; clamps and junk), `radioTransition` (off is today's exactly; on, the character in the fields and the 17-point sweep, which `riserCutoffAt` follows; same id same character, ids vary it; `RISER_BEFORE` keeps today's fields).
  - **Level above Q 2, measured.** Over a whole default sweep, white peaks at 0.71 / 0.88 / 1.03 / 1.11 × level at Q 1 / 2 / 4 / 6, pink at 0.54 / 0.64 / 0.80 / 0.86. Documented on `riserGainNormalisation`; the limiter is the backstop, and radio's draw caps the level at 0.62.
  - **Review follow-up (2026-10-02): the riser is keyed by its arming, not by the rebuild.** Discover mints a fresh `groupId` (the riser's channel) on every `syncPreviewToEngine` (toggle, mute, solo, slot resolve, manual change, master filter, tempo, prune, drop), so `radio-riser-${channelId}` changed on any rebuild during the armed lap: a new character, a new engine voice (keyed by riser id) and new noise mid-sweep, and the variety came from the random UUID by accident. Now:
    - `RadioGesture.armId` (required), minted by `newArmId()` (`crypto.randomUUID()`) at every site that arms a gesture (all nine: radio's leading and arrival gestures, the manual change's leading gesture, staged arrivals, drop-outs, the arc exit); the lap countdown's `{ ...g, lapsLeft }` carries it.
    - `buildTransitionRiser(..., { variety, armId })`: with variety on and an `armId`, the id is `radio-riser-${armId}`, which seeds the character and the noise and keys the voice, so all three carry across re-syncs; the channel is still the preview's `groupId`. With variety **off** the id stays `radio-riser-${channelId}` (the wire is identical to before, as is the old per-rebuild voice); with no or an empty `armId` it falls back to the same. Nothing else reads the id's format (`radio-riser-` appears only in `buildTransitionRiser` and tests).
    - Tests: vitest +2 (two syncs of one arming with different groupIds give the same id and the same riser, channel aside; 200 armings give >190 distinct Qs; variety off ignores the arming and is today's exactly; no/empty armId falls back to the channel id). Native 392 (+1): a re-sync mid-riser (`setProject` with the riser on a new channel, same id, mid-block) is bit-identical to a render with no re-sync, pink with a cavern send; with a new id it differs (the old behaviour).
    - Pre-existing, now slower: `PlaybackEngine::riserVoices` is never pruned. It used to grow by one voice per rebuild during a riser lap; it now grows by one per riser arming (with variety off, still per rebuild). Each voice is a few hundred bytes. **Fixed in the next follow-up.**
  - **Review follow-up 2 (2026-10-02): riser voices are built and pruned on the message thread.** Pre-existing, and hit once per arming after the follow-up above: `renderBlock` did `riserVoices[id]` + `make_unique<RiserVoice>()` on the audio thread for every new riser id, the first sounding block's `StateVariableTPTFilter::prepare` sized its state there too, and the map was never pruned. Now:
    - `PlaybackEngine::riserVoicePool` (message thread only, `shared_ptr<RiserVoice>` by id). `buildSnapshot` (so `setProject` and `stageProject`) finds or creates each riser's voice and, for a new one, seeds and prepares it at `masterRate` (`RiserVoice::prepare(riser, rate)`, now public), so its filter state is allocated off the audio thread. The snapshot stores `{riser, voice}` pairs in `riserGroups` plus `riserVoiceRefs` (shared ownership), so `renderBlock` does no map work and creates nothing. The same id keeps the same voice across snapshots (the re-sync test stays bit-identical).
    - `drainRetiredProject` → `pruneRiserVoices()` drops every pool id that is in neither the published nor the staged snapshot. Dropping the pool's reference never frees a voice a snapshot can still reach: the snapshot's own reference keeps it alive, and it goes with that snapshot. (As for every snapshot, the last reference can occasionally be the audio thread's own `snap` after a `setProject` swap, so a pruned voice can be freed there in that case -- the existing snapshot rule, not a new one.)
    - **Rate changes:** `prepareMaster` does not touch pooled voices. A voice the audio thread may be rendering cannot safely be prepared from the message thread, and it doesn't need to be: `render` re-prepares at a new rate itself, which allocates nothing (the SVF's two state vectors are already sized for two channels; the pink match is arithmetic).
    - Tidy-ups from the review: the sending-riser branch is `PlaybackEngine::renderSendingRiser`, with a comment that its per-block stack `ParamSmoother` is deliberate (constant send, settled at reset, no state to carry, no allocation); `RiserVoice::pinkWarmUpCount` (and a new `preparedRate`) sit in the public section; `buildTransitionRiser` warns once per session (`console.warn`, as the rest of `src/shared` does; it has no dev flag) when variety is on without an `armId`, since that silently brings the re-sync problem back.
    - Output unchanged: the temporary dump (above) against the pre-Task-6 engine is still byte-identical; the existing riser tests, the re-sync test and live == export are untouched and green.
    - Tests: native 394 (+2): a riser's voice is in the pool and prepared at the engine's rate before any `renderBlock`, 300 blocks create none and keep the same voice, a re-sync keeps it, a staged id is kept until promoted and the old one pruned after; 2,000 armings (a new id each, sending and not, rendered and drained) never hold more than one pooled voice, and an empty project leaves none. Vitest: the warn-once (a fresh module copy).
  - **Review follow-up 3 (2026-10-02): the prune loads `staged` before `published`.** Published first let the audio thread promote the staged snapshot between the two loads (old published, then a null staged), so a newly armed riser's id -- only in the promoted snapshot -- was pruned: memory-safe, but the next re-sync built a fresh voice mid-riser (a bandpass reset and a pink warm-up). Staged first, a staged snapshot's ids are covered whether or not it is promoted meanwhile, and a null one cannot be promoted behind the drain (only the message thread stages). Commented in `pruneRiserVoices`; the interleaving itself is not deterministic enough to test. Also: the warn-once flag sits above `buildTransitionRiser`'s doc comment. Tests: native 410 at this commit (Task 7 landed in between; +2 here): a staged project replaced before its loop top gives up its voice and the replacement keeps its own; a voice prepared at 44.1 kHz and rendered at 48 kHz re-prepares to 48 kHz and renders bit for bit what a voice prepared at 48 kHz from the start does.
  - **Not covered / for Elling:**
    - Live: the character and the send are static per riser (no smoothing); a variety switch mid-riser steps at the swap.
    - A sending riser keeps the room running (and its ~1% of a core for the cavern) for as long as it is in the project, as a sending clip does.

**Elling listens:**
- varied risers: whistly, full, narrow;
- about +3 dB;
- they bloom into the room;
- variety off restores today's riser.
- **added 2026-10-02:** a resonant (Q 4–6) riser can peak a little over its level (≈ +1 dB at Q 6): listen for it poking out before the limiter catches it;
- pink against white at the top of the sweep (matched at 6 kHz): does pink sound as loud as it should, or thin up top?
- a riser while you swap or mute another row mid-lap: it should now carry on unbroken (variety on); with variety off it restarts its noise as before.
- **debug builds only:** a seek into a pink riser may glitch in an unoptimised (local `cmake -B build`) engine -- its warm-up takes ~0.7 ms there (0.07 ms in a Release build);
- in Discover the riser's tail, and its send into the room, are cut at the wrap: the staged project that lands there carries no riser (the room's own ring-out continues). Is that cut audible?

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
- [x] Whole-stage golden: the radio repo renders a seeded mix through its Faust chain (convolver off), and native matches within 1e-5.
- [x] Glue below the knee is unity; +10 dB over the threshold comes out about +5 dB over.
- [x] Width leaves L + R unchanged to 1e-6.
- [x] The shelves are within ±0.1 dB of the RBJ formulas.
- [x] Each switch off removes exactly its stage.
- [x] Block-split invariance.

**Risk:** port the web's **Faust-path** chain, not its fallback trims (`GLUE_TRIM_DB` exists only for the `DynamicsCompressorNode`).

- **As landed (2026-10-02):**
  - **Checked against the web.** `masterChain.ts`'s Faust path is, after the headroom trim and the (parked-open) master filter: HP 25 Hz at `biquadQ(0)` → saturation → `glue.dsp` (no trim: `useStage('glue')` unhooks the `DynamicsCompressorNode` *and* `GLUE_TRIM_DB`) → width (`buildWidth`: mid/side, the side through a `highshelf` 250 Hz +2 dB) → `lowshelf` 100 Hz +1 dB → `highshelf` 10 kHz +1 dB → `truepeak.dsp`. Order, frequencies, gains and Q all agree with the plan; nothing to correct. The shelves have no Q (Web Audio's shelves ignore it; slope 1). `loadFaust` sets no glue parameter, so the glue runs at `glue.dsp`'s defaults (−14 dB, 2:1, knee 6), which is `FAUST_DEFAULTS.glue` and the wire's default; `MASTERING.glue` (−11, knee 0) is the fallback's only.
  - **`MasterTone.{h,cpp}`:** `WebBiquad`, Web Audio's `BiquadFilterNode` as Chromium runs it: the spec's RBJ coefficients in double from the float AudioParam values, normalised by a0, Direct Form I in double with the **state kept in double** and each output rounded to float (a first version fed back the float output and was 1e-4 off Chrome at 25 Hz; measured against Chrome's own nodes one at a time, the double version is within one float ulp), and Chromium's subnormal guard (applied per sample, so block-size invariant). `MasterTone` holds the HP (L/R), the width's side shelf and the two shelves (L/R); `width()` does the web's GainNode arithmetic in float (`M = ½L + ½R`, `S = ½L − ½R`, `L' = M + S'`, `R' = M − S'`), so a mono input passes bit for bit and L + R is unchanged to float rounding. `MasterTone.cpp` is compiled `-ffp-contract=off`, like the Faust code, so no FMA moves a bit between machines.
  - **`MasterStage`:** `MasterStage::Settings { mastering, glue?, tone? }` (`settingsFor(sound)`; a commented saturation slot for Task 8) is what `processMaster` passes now (`PlaybackEngine::masterSettingsSeen`, still copied from the snapshot by `renderBlock`, still trivially copyable). Per 512-sample chunk: trim → HP → *(saturation slot: a comment where Task 8 goes)* → glue (`FaustStage` `glue`, built in the `Instance` on the message thread beside the limiter) → width and shelves → limiter. The Task 3 overload `process(const Mastering*, …)` stays (glue and tone off), plus a `nullptr_t` one so `process(nullptr, …)` stays unambiguous; Task 3's tests are untouched. No latency added (glue 0, biquads 0): `currentLatencySamples` is still 75 or 0.
  - **Switches and amounts mid-play (conservative, Task 3's conventions).** Glue and tone each have a 20 ms crossfade (`StageFade`) between the stage's input and its output, starting the stage from a cleared state when it comes on; tone's two places (the HP before the glue, width and shelves after it) share one set of weights. A stage fully off is not run at all. When mastering engages, glue and tone engage with it at once, inside mastering's own fade (or immediately, for a fresh stage, as an export starts), so the first block of a play is the same live and exported. A tone amount change glides both shelves' gains linearly in dB over 20 ms, coefficients recomputed per sample (no trig: w0's sin/cos are cached). A glue amount change is set at once: `glue.dsp` takes its reduction through its own attack/release one-poles (30 ms at the fastest), so the gain cannot step; ratio and knee likewise.
  - **The golden (whole stage, from the web).** `native-engine/test/golden/master-chain.{out.f32,json}`, written by sssketch's **`scripts/golden-master-chain.mjs`**: it serves the radio repo through the radio's own vite config and dev server (`../ell.ing/radio`, or `RADIO_DIR=…`), and headless Chrome (`CHROME=…` to override) runs the radio's own `buildMasterChain(ctx, dest, { saturate: false })` with its Faust glue and limiter (`createFaustNode`, the committed `.wasm` through `faustProcessor.js` as an AudioWorklet), every parameter at its default, in an `OfflineAudioContext` at 48 kHz, on the Faust goldens' `programme.f32` (2 s of seeded bursts, −36..+6 dBFS). So it covers the web's real chain: Chrome's own BiquadFilterNodes and summing junctions, not a reference implementation; saturation is out (Task 8) and there is no reverb (the input goes straight into the chain). Deterministic run to run (Chrome 154). Nothing was added to or changed in the radio repo. Regenerate (`node scripts/golden-master-chain.mjs`) after changing `masterChain.ts`, `MASTERING`/`FAUST_DEFAULTS`, or `glue.dsp`/`truepeak.dsp` (after the radio's `build-faust.mjs` and `golden-vectors.mjs`). **Native matches it within 3.0e-7** (max abs, 128-sample blocks; the same at Release `-O3`) against the 1e-5 asked for; the glue and limiter are the web's to the bit, the residue is the biquads' last ulp. Not measured: the stage's CPU (Task 14's dense-mix profile covers it).
  - **Off is today, checked outside the suite.** A temporary test dumping `MasterStage` with mastering only, through Task 3's schedule of on/off switches, headroom ramps and a ceiling change, at blocks of 512, 300 and 1 (and, in the new build, through both the old overload and `Settings` with glue and tone off), was built into the pre-Task-7 code (a scratch worktree at `a9d9b40`) and into this code: the 2.9 MB float dumps are byte-identical.
  - **Tests.** Native 408 (was 394): `MasterGlueToneTests` 13 -- the golden (3.0e-7); each switch removes exactly its stage (all on, glue only, tone only and neither each equal the parts run by hand -- trim, `MasterTone`, `FaustStage` glue, `FaustStage` truepeak -- to the bit at 44.1 and 48 kHz, neither equals Task 3's overload, latency 75); the glue unity below the knee (bit-identical to glue off at −20 dBFS) and +10 dB over coming out +5.000 dB over (a square wave, whose level the detector sees as constant); width keeps L + R to 1e-6 at three rates, lifts the side by 1–2 dB and passes mono exactly; every filter (HP, side shelf, both shelves at four tilts through `MasterTone`) within 0.1 dB of independently written RBJ formulas at 12 frequencies and three rates (measured worst: under 0.00001 dB); the HP's −3.01 dB at 25 Hz; the tone's tail goes to exact zero after the input stops; all on at blocks 1/64/128/441/513/4096/random bit-identical; a schedule of glue/tone on/off (and back mid-fade), a tilt, a glue amount and mastering off/on, bit-identical across splits; glue switched on mid-play is the glue started clean at the switch, to the bit, once the fade is done, and off is exactly the dry stage, with no step; tone the same (it converges on the clean tone, within 3e-4 after the fade and exactly 100 ms on, since the shelves remember the half-faded HP output a few ms); a tilt glides (half way it is in between, no step) and lands on the formulas; mastering switched on mid-play brings glue and tone in inside its one crossfade, then equals the fresh stage by hand to the bit. `TransportTests` +1: glue and tone on, live (300-sample and random blocks) equals the export to the bit, and differs from mastering alone. No TS change: the wire has carried glue and tone since Task 2.
  - **Review follow-up (2026-10-02):**
    - **A seek clears the master stage's state.** The reposition hold (Task 3) hid the limiter's line, but `glue.dsp`'s 1.5 s release carried over a jump: a seek from a dense passage into a quiet one started 1-3 dB down and swelled back. `MasterStage::clearDynamics()` (via `PlaybackEngine::clearMasterDynamics`) clears the limiter's line and envelope, the glue's envelopes and the tone's filters -- and nothing else: the switches, their fades, the trim and the "has sounded" flag stay, so a later switch still crossfades. Transport calls it at the jump, under the fade's silence; the hold is unchanged (the line now plays zeros through it). Audio-thread safe (Faust's `instanceClear`, zeroed biquads). Export never seeks, and with the stage off it touches no sample. Tested: after a seek from a loud half into a quiet half, with glue and tone on, the output once the fade-in is done equals a fresh play from that bar to the bit (without the call it is up to 0.025 off).
    - **The golden script** (`scripts/golden-master-chain.mjs`) refuses a dirty radio checkout (`git status --porcelain`; `GOLDEN_ALLOW_DIRTY=1` overrides) and records `git describe --always --dirty`; every exit (success, a page error, Chrome failing to start or exiting early, a vite error, the timeout, a signal) kills Chrome, waits for it, closes vite and removes the temp profile; the page URL is built from vite's `config.base` rather than a hardcoded `/radio/`. Re-run: the golden is byte-identical.
    - The glue's crossfade now uses `mixWet` in `MasterTone.cpp` (the `-ffp-contract=off` TU), the tone's mix, so every stage fade rounds the same; `static_assert` that `MasterStage::Settings` is trivially copyable; the tone switch test checks both channels against the tone run on through the fade-out; comments fixed.
    - **Tests:** native 412 (410 at `3823bb7`): `TransportTests` +2 -- the seek above; a stop with glue and tone on resets them, so the first 4,096 samples of the next play equal the export's.
  - **Not covered / for Elling:**
    - **Where the master filter sits.** On the web the master strip's filter runs after the headroom trim, inside the chain; natively it is the last thing `renderBlock` does, before the user's master plugin slots and the master stage. With no plugins and the filter parked open (its usual state) the two agree; with the filter in use the order differs (pre-existing since Task 3, not changed here).
    - **Overs during a switch.** While a glue or tone switch is fading (20 ms) the limiter still runs after it, so the ceiling holds; only mastering's own fade is unlimited (Task 3).
    - The tone's width can only widen what already differs between L and R: a mono mix (one stem, centred) is untouched by it, as on the web.

**Elling listens:** layers sit together; about 1–3 dB of gain reduction on a dense mix; nothing breathes; the glue amount slider; tone off.
- **added 2026-10-02:** the glue amount and the tone tilt moved while playing (they glide; listen for a zipper or a jump); glue or tone switched off and on mid-play (a 20 ms crossfade each);
- the glue at amount 1 (−20 dB threshold) on a dense mix: does it breathe? (the web only ever ran −14);
- the tilt at its ends: warmer (+2.5 dB at 100 Hz, −0.5 dB at 10 kHz) and brighter (the reverse).

---

### Task 8: tape saturation (item 5)

**Where:** `MasterStage`'s saturation slot, after the HP and before the glue. Faust `saturate`: drive from the settings (`saturationDrive(amount)`, 0.9 by default, D7), bias 0.1, makeup `0.5 × (drive/1.8)²` dB (inside the `.dsp`), DC blocker at 5 Hz. The drive is smoothed over ~20 ms in the `.dsp`, and drive 0 is an exact pass-through.

**Native tests:**
- [x] Golden vector.
- [x] A −40 dBFS sine comes out at unity ± 0.01 dB. *(Corrected, the `.dsp` wins: unity **plus the makeup**, +0.125 dB at 0.9; see below.)*
- [x] THD of a −14 dBFS sine at the default drive 0.9 is 0.83% ± 0.2% (the web's measured figure). At drive 1.8 (amount 1) it is 1.8% ± 0.3%.
- [x] Drive 0 is bit-identical to the stage switched off, latency included.
- [x] No DC.
- [x] A dense mix level-matches within 0.3 dB.
- [x] Switched off, the stage is absent.

**Risk:** aliasing. The web's Faust stage is not oversampled, and native matches it. Add 2× oversampling only if Elling hears grit.

- **As landed (2026-10-02):**
  - **`saturate.dsp` read against the plan.** Makeup inside the `.dsp`: yes, `pow(10, 0.5·(drive/1.8)²/20)`, so the wire carries only `{ drive }` (Task 2) and no TS change was needed. Smoothing: a one-pole on the drive with a 20 ms time constant (`c = exp(−1/(0.02·SR))`), not a 20 ms ramp: 63% in 20 ms, under 0.001 from 0.9 after ~136 ms. Its state starts at **0**, so a fresh or cleared DSP glides its drive up from 0 (the web's freshly loaded worklet does the same; the Chrome golden confirms it). Drive 0: `select2(DRIVE < 0.001, shape : dcblock, x)` on the **glided** drive, so below 0.001 each channel is the input itself, **DC blocker bypassed**. So "drive 0 is bit-identical to off, latency included" holds (latency 0 either way): from a fresh or cleared stage at once, and ~136 ms after the drive is taken to 0 mid-play (until then it glides down through the curve). **One plan claim corrected:** a −40 dBFS sine does not come out at unity ± 0.01 dB but at unity **plus the makeup** (+0.031/+0.125/+0.500 dB at drives 0.45/0.9/1.8): the makeup multiplies everything, small signals included. Measured within 0.003 dB of that; the test pins `makeup ± 0.01`.
  - **`MasterStage`:** `Settings::saturation` (`std::optional<SoundSettings::Saturation>`, default-initialised to off so Task 7's three-field initialisers still mean "no saturation"); `settingsFor` passes `sound.saturation`. The `Instance` holds a third `FaustStage` (`saturate`), built on the message thread with the limiter and glue, and its own `StageFade` and weight scratch. Per chunk: trim → HP → **saturate** → glue → width/shelves → limiter, the slot Task 7 reserved. Task 7's conventions throughout: switching it on or off mid-play crossfades the stage's input against its output over 20 ms through `mixWet` (the `-ffp-contract=off` TU), starting it cleared (DC blocker empty, drive glide from 0); it engages with mastering, inside mastering's own fade; fully off it is not run at all. A drive change is set on the DSP at once (only when the float changes) and glides inside the `.dsp`, the web's `setParam` way: the stage equals `saturate.dsp` told at the same sample, to the bit. No latency (`latency_samples 0`): `currentLatencySamples` is still 75 or 0. No oversampling, as the web.
  - **Seek (`clearDynamics`) clears it too** (Faust `instanceClear`: DC blocker and drive glide). Decided because a seek should equal a fresh play from the new bar, as Task 7 set for glue and tone: without the clear the seek test (now with saturation at drive 1.8) differs from a fresh play by up to 0.0104 after the fade-in; with it, to the bit. The cost: right after a seek (as after any play from a stop, and on the web at load) the drive glides up from 0 over ~20 ms, so the first transient is a little less saturated. Also checked that `MasterSaturationTests` fails without the clear.
  - **The golden.** `scripts/golden-master-chain.mjs` now renders the web's chain twice in one page: `master-chain.out.f32` as before (`saturate: false`; re-rendered byte-identical, its `.json` unchanged) and **`master-chain-saturate.out.f32`/`.json`**: `buildMasterChain(…, { saturate: true })` with the Faust saturate put in and its drive set as `Engine.loadFaust` does (`saturationDrive(DEFAULT_SATURATION)` = 0.9), glue and limiter at their defaults. Deterministic run to run (Chrome 154, radio `5262ed5`, clean). **Native matches it within 4.5e-7** (max abs, 128-sample blocks) against 1e-5; the saturation's own effect on the web's output is up to 0.14, so the golden does see it. The `.dsp` alone was already bit-exact against the web's wasm (`FaustStageTests`, Task 1).
  - **Measured** (the web's method, `spike/engine-check` `thd`: 997 Hz, 48 kHz, Hann 65536 from 0.5 s, harmonics 2–10): THD **0.830%** at drive 0.9 and **1.817%** at 1.8 (web: 0.83%, 1.8%); 0 at drive 0, output equal to input. A dense mix after the −4 dB trim: RMS −0.007 dB / +0.040 dB, peaks −0.30 dB / −1.21 dB, at drives 0.9 / 1.8. DC: a −3 dBFS 100 Hz sine at drive 1.8, whose bare curve averages −0.026, comes out with a mean of 5e-8.
  - **Off is today, checked outside the suite.** A temporary dump test (Task 7's schedule of mastering/glue/tone switches, headroom and ceiling changes, both `process` overloads, `clearDynamics` every 4,096 samples, `currentLatencySamples` per block; 44.1 and 48 kHz; blocks 512, 300, 1) built at `70be67c` and with this change: the 11 MB dumps are byte-identical. Removed before the commit.
  - **Tests.** Native 424 (was 412): `MasterSaturationTests` 11 -- the Chrome golden (4.5e-7); THD at 0.9/1.8/0 by the web's method; −40 dBFS at the makeup ± 0.01 dB (0.45, 0.9, 1.8); drive 0 bit-identical to off (mastering alone and the whole chain, blocks 512/1/333, latency equal and 75; switched on at drive 0 mid-play and off again; a drive taken to 0 exact 200 ms later, and gliding before that); no DC; dense-mix level; every combination of saturation, glue and tone equals its parts run by hand to the bit at 44.1 and 48 kHz (and on differs from off); switched on mid-play is the saturation started clean at the switch, to the bit, after the fade, and off is exactly dry, no step either way; a drive change equals the `.dsp` told at that sample, with no jump; `clearDynamics` leaves a fresh stage's output, to the bit; a schedule of saturation switches (back on mid-fade), drives 0.9/1.8/0, mastering off/on and a `clearDynamics` bit-identical across splits 1/77/300/4096/random. `TransportTests` +1: saturation on, live (300 and random blocks) equals the export to the bit, differs from saturation off, and drive 0 equals saturation off; the Task 7 seek test now has the saturation on (drive 1.8). The shared signals and the by-hand stage (now with the saturation) moved from `MasterGlueToneTests.cpp` into `MasterStageTestUtil.h`. No TS change.
  - **Not covered / for Elling:**
    - **Aliasing**, as the plan says: not oversampled, the web's way. At drive 0.9 the harmonics are small (0.83% THD at −14 dBFS); at 1.8 on bright, hot material listen for grit. 2× oversampling would make native differ from the web (and from the golden).
    - **The drive glide restarts from 0** on every play from a stop, seek, export start and switch-on (the `.dsp`'s smoother state, as the web at load): the first ~20–50 ms after each are a touch cleaner. Expected to be too short to notice; listen to a seek onto a big hit.
    - **DC:** with the saturation on, any DC in the mix is removed too (the 5 Hz blocker); with it off or at drive 0 it passes, as today.

**Elling listens:** peaks rounded, nothing gritty; the drive slider.
- **added 2026-10-02:** the drive moved while playing (it glides in the `.dsp`; listen for a zipper); saturation switched off and on mid-play (a 20 ms crossfade); amount 1 (drive 1.8) on a bright, dense mix: grit? (no oversampling, as the web); amount 0 should sound exactly like saturation off.

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
- [x] Golden vector.
- [x] No key: bit-identical.
- [x] A 60 Hz kick at −10 dBFS ducks a pad by `depthDb` ± 0.3, reaching 90% in about 7 ms and recovering about 63% in 200 ms. *(Corrected, the `.dsp` wins: 92% of the depth at −10 dBFS, the full depth at −7 dBFS; 90% in 10–11 ms; ~55% back after 200 ms. See below.)*
- [x] 8 kHz hats duck it by under 0.5 dB.
- [x] Drums and bass are untouched.
- [x] The send is not pumped.
- [x] Block-split invariance.
- [x] **TS:** both role maps; pump off emits no `pumpRole`. *(Changed by the review: an off pump still sends the roles, with no depth, so the engine can release a duck in progress; no roles with no sound settings, with every stage off, or for auditions. See the review follow-up below.)*

**Risk:** a new routing shape in `renderBlock`. Keep it to routing pointers and one post-loop pass.

- **As landed (2026-10-02):**
  - **Checked against the web.** `pump.dsp` has 4 inputs (program L, R, key L, R) and 2 outputs, `depth` (dB, default 4) and `release` (s, default 0.2) sliders, the 3 ms attack fixed, a `duck` meter; the key is the louder side low-passed at 150 Hz twice and followed 1 ms up / 30 ms down, and the duck runs from 0 at −30 dB of key to the full depth at −10 dB. On the web (`engine.ts`, `rowVoice.ts`) every row's chain is filter → gesture → **mute** → pan, and the pan feeds the dry bus, the send and the dub send separately: a pumped row's pan goes to `pumpBus` instead of the dry bus, a drums row's pan to the dry bus **and** `keyBus`. So the send is unpumped, a muted row keys nothing (the mute is upstream of the key tap), the key is post-pan, risers (`master.riserInput`) are not pumped, and the depth is `PUMP_MAX_DB` (4) × the listener's amount, which the settings carry as `depthDb` 0..8. The plan agrees.
  - **Where it runs.** `renderBlock` was already two passes: the channel loop sums each channel's stems and risers, then a second loop runs each channel's plugin chain and adds it into the master. So the pump needed no restructuring: it is one call between those two loops, by which point every key stem on every channel has been rendered, and before any channel plugin chain. Routing: a stem with a role takes its own buffer (as a toolkit or a pan does), and after its filter → volume → pan → send (`finishStem`) a **pumped** stem is added into its channel's pumped buffer (cleared lazily by its first pumped stem with samples in the block) instead of the channel; a **key** stem is added into the channel as before and into the project-wide key buffer. Then `DrumPump::process` ducks each pumped buffer and adds it into its channel. It multiplies the stems' own gains (duck curves, volume curves and mutes still work).
  - **One duck for the whole project (`DrumPump.{h,cpp}`).** `pump.dsp`'s gain depends on the key alone (`pl * g, pr * g`), and the key is project-wide, so N per-channel instances would compute N identical gains. One Faust instance runs per block with its program inputs held at exactly 1.0f, so its outputs are `g` itself, and each channel's pumped buffer is multiplied by it in a TU compiled `-ffp-contract=off` -- the generated code's own float multiply (`input * fTemp10`). `DrumPumpTests` pins it: the golden programme through `DrumPump`, keyed by the golden key, equals `pump.out.f32` (the web's wasm) to the bit, at blocks 1/64/128/512/513/4096 and random; three targets in one call are each their input times one gain, to the bit. The cost is one instance whatever the channel count: 0.4% of a core for 8 pumped channels at 48 kHz in the unoptimised local build (logged, not asserted).
  - **Trigger and narrowing.** `EngineStem::pumpRole` (`EngineProject.h`; parse: only the strings `"key"`/`"pumped"` count, absent/`"none"`/junk is none). `buildSnapshot` makes the pump active only with `sound.pump` **and** a key stem **and** a pumped stem (muted ones count, so a mute does not reroute); otherwise every role is narrowed to none there, so `renderBlock` routes as before the pump existed: no own buffer for a role, no key buffer, no pass (`drumPump.idle()`). Depth from `sound.pump.depthDb`, set on the DSP at a block's start when it changes; it scales the duck before its 3 ms / 200 ms follower, so a depth change glides. Release 0.2 s, the `.dsp`'s default (set explicitly).
  - **State and threading.** The envelope lives in `PlaybackEngine::drumPump`, not the snapshot, so a re-sync (live drags, Discover's staged swaps, a depth change) keeps it (tested: two mid-duck `setProject`s are bit-identical to none). The instance is MasterStage's pattern: built on the message thread (`buildSnapshot` when the pump is active, at `masterRate`; rebuilt by `prepareMaster` at a new rate if one exists), parked in `pending`, promoted by the audio thread, the old one freed by `drainRetiredProject`. A block at a rate with no instance passes the pumped rows through unducked and is counted (`pumpRateMismatchCount`). No allocation on the audio thread beyond today's precedent (the key and pumped scratch resize when `numSamples` changes, as the channel scratch does; `pumpTargets` is reserved to the channel count).
  - **Clearing (decided, as Task 7's `clearDynamics`).** The envelope is cleared when the pump engages after a block without it (switched on; a fresh engine), and by `PlaybackEngine::clearPump()`, which Transport calls at a seek's jump (beside `clearMasterDynamics`), when a stop or pause has faded out and at a device start (beside `resetMaster`). Reason: a seek and a play should equal a fresh play / an export from that bar, as the master stage's now do; without it the old kick's 200 ms release would carry over the jump. Tested: after a seek out of a kick into a gap, the output once the fade-in is done equals a fresh play from there to the bit (0.11 off without the call); a stop then a play from the top renders the first pass again (fails without the call).
  - **Exports (the D1/D2 ruling).** The pump's mix is a master-bus stage, so: **the mixdown pumps** (`nativeExport` → `RenderExport`, same `renderBlock`; live equals the export to the bit, tested through Transport at 300-sample and random blocks), and so does **the phone loop** (`remoteLoopRenderer` renders Discover's project, roles included). **Per-stem renders do not:** toolkit bakes, stem/bus exports and the DAW sessions' baked stems go through `soloState` → `stemExportSound`, which already switched `pump.on` off (Task 2), so they carry neither a depth nor a role (TS-tested). **DAW automation mode** keeps the audio dry and has no pump (neither DAW's session gets one). **The phone's per-stem files** are transcodes, unpumped. `risers.wav` has no stems.
  - **Auditions are unpumped (conservative addition).** `stemPreviewOverrides` (Tidy Up / Auto Arrange) and `useThrowawayStemPreview` (the library audition) switch `pump.on` off beside `panning.on`: an audition is the file, and one auditioned stem ducking another is not.
  - **Wire (TS).** `EngineStem.pumpRole?: 'key' | 'pumped'`, present only for a row with a part while the pump is on (absence is load-bearing, like `pan`). `timelineStemPumpRoles(state)`: `pumpRoleForSoundType` per stem of every placed rifff, muted included. `buildEngineProject`'s options gained `stemPumpRoles`, which replaces the timeline rule (Discover) and is ignored while the pump is off. Discover: `discoverStemPumpRoles(slots, memberSlotIds, groupId)` in `radioPump.ts` maps each member row's stem key to `pumpRoleFor(slot.kinds)` (a member whose slot is unknown has none), passed beside `stemPans`.
  - **Measured, and the plan's numbers corrected (the `.dsp` wins; it is the web's to the bit).** A 60 Hz sine kick at −10 dBFS ducks the pad by **3.68 dB at depth 4** (7.36 at 8, 1.84 at 2: 92% of the depth): the key's two 150 Hz low-passes take 1.3 dB off a 60 Hz kick and its 30 ms follower ripples ~2.4 dB, so the key sits near −12 dB, under the −10 dB "full depth" point. A kick 3 dB hotter (−7 dBFS) reaches the depth exactly (4.000 / 8.000 / 2.000). 90% of the duck arrives **10–11 ms** after the kick starts (the 3 ms attack follows the key's own rise: the sine's first quarter cycle, the low-passes, the 1 ms follower), and 200 ms after the kick ends **~55%** has come back (the 200 ms release only starts as the key's 30 ms follower falls through −30 dB). Pinned: −10 dBFS at 0.92 × depth ± 0.3, −7 dBFS at depth ± 0.3, attack 8–13 ms, recovery 50–62%. 8 kHz hats at −10 dBFS: 0.0000 dB.
  - **Off is today, checked outside the suite.** A temporary dump test (four stems on two channels, panned, a toolkit send and filter, then the cavern room with mastering, then a sending riser; blocks 512, 300, 1; through `renderBlock` and `processMaster`) built into the pre-Task-9 code (a scratch worktree at `ce6c5b3`) and into this code: the 16.9 MB float dumps are byte-identical. Removed before the commit.
  - **Tests.** Native 442 (was 424): `DrumPumpTests` 17 -- the golden; block sizes; three targets, depth 0 is the input exactly, depth 8 differs; `clear()` and `idle()` give a fresh pump (and without either the envelope carries); no instance / the wrong rate passes through, counted; the cost log; in the engine: absent, roles without a pump, a pump without a key and a pump with nothing pumped are all today's to the bit; the duck at three depths and two kick levels, with the kick and bass rendered as today's to the bit; hats; the key is project-wide (a kick on a later channel ducks a pad on an earlier one, as one channel does, within 1e-6) and a muted kick keys nothing (the mix is the unpumped one: to the bit with one pumped row alone on its channel, rounding-close in general -- within 1e-7 with two pumped rows and a bass on one channel, since the pumped rows join their channel after its other rows); the send is not pumped (with a zita send, once the dry rows end the room is the same samples with the pump on and off); split invariance (512 / mixed / random blocks, with a cavern send); a re-sync keeps the envelope; the instance is built only for a pumping project and follows `prepareMaster`; through Transport, live equals the export to the bit and the export pumps; a seek and a stop clear the duck. `EngineProjectTests` +1 (the role's parse). Vitest: `buildEngineProject` (the timeline roles by SoundType, `depthDb` on the wire, a muted stem keeps its role, pump off / no sound / `stemExportSound` emit no role and no depth, Discover's map replaces the rule and its `'none'` is omitted, `timelineStemPumpRoles` over placed rifffs only), `radioPump` (`discoverStemPumpRoles`), `store` (an audition is unpumped).
  - **Not covered / found on the way:**
    - ~~Switching the pump off mid-play steps~~ -- fixed by the review follow-up below (it releases).
    - **A zita send is not block-split invariant, pump or no pump** (found here, pre-existing): a pad with a static zita send rendered at 512-sample blocks and at 4096-then-mixed blocks differs by up to 0.04, identically with the pump on and off. The split test uses the cavern room. Not chased; worth its own look beside Task 5's `ChannelFilter::prepare` note.
    - **Transport's loop-seam anchor** (`renderBlock(loopStart, …, 1, …)`) advances the pump's envelope by one sample of the loop's first sample per seam block, as it already does the toolkit's filters and the reverb (pre-existing shape, inaudible: one sample of key through two 150 Hz low-passes).
    - A key stem now renders through its own buffer: if two tiles of one stem overlap within a block (a stem whose native length runs past its bar), its two segments are summed before joining the channel rather than one after the other, a rounding difference only, and only with the pump active.
    - ~~The meter reads the Faust bargraph directly~~ -- now an atomic published once per block (review follow-up).
  - **Review follow-up (2026-10-02):**
    - **Switching the pump off mid-duck releases instead of stepping** (the web's `setPump(0)`: the depth is applied before the 200 ms follower). The wire: `buildEngineProject` now sends the roles while the pump is **off** too (no `sound.pump`, so no depth), whenever the project has sound settings and sends a `sound` block. The engine: a snapshot with pumped stems that is not pumping (pump off, or no key) keeps its roles as `pumpReleasing`, and `renderBlock` routes them through `DrumPump` **at depth 0** only while `DrumPump::isDucking()` -- the last block ended with a gain other than exactly 1.0f. The duck then lets go through `pump.dsp`'s own release; routing stops at the first block that ends at a gain of exactly 1.0f (about 2.6e-7 dB, ~2.6 s after a 4 dB duck), so the last ducked sample is already at unity and the hand-over moves only the summation order; from the next block on the rows are routed exactly as with no pump, so the output **is** the never-pumped render. Measured (4 dB, switched off 0.35 s into a hot kick): 2.00 dB left 139 ms later, unity after 2.61 s, the largest per-sample change of the pad's gain 3.3e-5 (a 4 dB step is 0.37), and the output identical to the never-pumped render, to the bit, from 3.66 s on. The same for a pump left on whose key stem goes away. Switching on was already clean; a depth change glides.
    - **Never pumping stays today's, to the bit.** A fresh engine never ducks, so an off project's roles route nothing: every export (each `RenderExport` builds a fresh engine, so a per-stem export's `stemExportSound` can never release) renders exactly as without roles (tested). Checked outside the suite again: the temporary dump test (above), run with roles on every stem and the pump off, and without roles, built into the Task 9 commit (`28f482c`, a scratch worktree) and into this code -- all four dumps byte-identical to each other, and the no-roles dump byte-identical to the pre-Task-9 one from `ce6c5b3`.
    - **No roles where a release must not reach:** auditions load into the live engine, so `buildEngineProject` gained `pumpRelease: false` (no roles while the pump is off; ignored while it is on), passed by the library audition (`useThrowawayStemPreview`) and by Tidy Up / Auto Arrange (`useStemPreviewPlayback` → `flushEngineSyncNow`, which gained an optional third argument, the build options). With **every stage off** (no `sound` block) no roles are sent either, so that wire stays byte-identical to a pre-plan project's (Task 2's rule, still pinned) -- the one case where switching the pump off still steps: when it was the only stage left on.
    - **Smaller:** `drumPump.idle()` on `renderBlock`'s early returns (no snapshot, no tempo, no content), so "engages after a block without it ⇒ cleared" holds there too; the duck meter (`pumpDuckDb`, for Task 13) is an atomic written once per block by the rendering thread (0 after `idle()` / `clear()`); the pumped/key tail of `finishStem` is two small helpers, `routeToPumped` and `addToKey` (Task 10 adds the dub send beside them).
    - **Tests:** native 445 (was 442), `DrumPumpTests` +3: switching off (and losing the key) mid-duck -- no step, a monotone rise, half the duck back ~139 ms later, then the never-pumped samples exactly, with the meter back at 0; a muted key with two pumped rows and a bass on one channel within 1e-7 of the unpumped mix; a fresh render with roles and the pump off equals the render without roles, to the bit. Vitest: the off pump sends roles and no depth; no roles with no settings, every stage off, or `pumpRelease: false`; `pumpRelease` ignored while on; `timelineStemPumpRoles` maps the roles on or off.

**Elling listens:** a breath on pads with each kick, in Discover and on the timeline; drums and bass untouched; the depth slider.
- **added 2026-10-02:** on the timeline the key is **project-wide**: a drums stem in any rifff, on any channel, ducks every non-drums, non-bass stem in the arrangement, including another rifff's pads. Is that wanted, or should a rifff only pump its own rows?
- on the timeline the role comes from the stem's SoundType: one-shots and imported samples typed anything but `drums` (e.g. an imported kick typed `fx`) are **pumped and never key**. Should a one-shot kick key the pump?
- a softer kick ducks less than the full depth (92% of it at −10 dBFS); a hot kick reaches it. Is 4 dB enough on quiet drum stems?
- switching the pump off mid-duck (it now lets go over ~200 ms, as the web's slider at 0 does) and moving the depth while playing (it glides); switching it off when it is the only stage left on still steps;
- a seek or a play just after a kick: it now starts unducked, as an export from there does;
- Tidy Up / library auditions are now unpumped (and centred).

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
- [ ] **Cavern per-callback cost at 96/192 kHz:** measure the worst callback at small buffers (64, 128) at 96 and 192 kHz on Elling's interface. Task 5's review spread the partitions over the frame (worst 0.08 ms at 96 kHz/64, Release); if 192 kHz still does not fit, spread the FFTs too, or use a two-size partition scheme.
- [ ] The full native suite and `npx vitest run` are green. Hand Elling the walkthrough below.

**Ruling:** the per-stem/master split in DAW and stem exports is confirmed by Elling (see the decisions section).

---

## What Elling needs to listen to

Do this in `npm run dev`, after a **full Cmd+Q and relaunch** once the engine is rebuilt. A/B against `ell.ing/radio` at the same tempo where possible.

1. **Web re-pin (T1):** if the golden diff in Task 1 Step 2 was not clean, A/B the web before and after the faustwasm re-pin.
2. **Limiter (T3):** loud stacks don't crackle; the level drop on an old timeline project; mastering off restores today's sound.
3. **Pan (T4):** centred drums and bass, the rest gently spread, in Discover and on the timeline; the width setting.
4. **Reverb (T5):** cavernous and darkening; a send of 0.5 against the web; zita still available; old timeline projects' sends now go to the cavern (longer, darker) -- keep that, or default old projects to zita?
5. **Risers (T6):** varied, about +3 dB, blooming into the room; variety off restores today's.
6. **Glue and tone (T7):** layers sit together, nothing breathes; the amount setting; tone off; the amount and tilt moved while playing (no zipper); glue at amount 1 on a dense mix.
7. **Saturation (T8):** peaks rounded, no grit; the drive setting, moved while playing (no zipper); amount 1 on a bright, dense mix (grit? no oversampling, as the web); amount 0 is exactly saturation off.
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
| CPU | T5–T9 | measured in T14; the convolver's partitions are spread over each frame (T5 review); a two-size partition scheme if it is still heavy |
| Matching web quirks rather than intent | T5, T7, T10 | match what Elling heard (convolver normalisation, decibel Q, StereoPanner law); each listed in code comments and offered as web fixes |
| Known differences from the web (cavern) | T5 | below ~34.1 kHz the pre-delay (round(0.03 × rate)) is shorter than the convolver's 1024-sample partition, so the room arrives 1024 − pre samples late (`CavernIr::extraLatency`; 0 at 44.1 kHz and above); the normalisation uses the spec's 0.00125 where Chromium writes −58 dB (+0.06 dB); after a stop zita (not the cavern) rings on from where it froze |
| `renderBlock` routing (pan, pump, dub) | T4, T9, T10 | pointer routing only; separate post-loop passes; heavy tests |
| DiscoverPanel plumbing | T11 | gated on `radioOnRef` and the setting; pure helpers extracted and tested |
| Per-stem vs master split in DAW and stem exports | T14 | confirmed by Elling, 2026-10-01 |
| The riser's "level means level" contract | T6 | becomes a power match, documented; the limiter backstops it |
