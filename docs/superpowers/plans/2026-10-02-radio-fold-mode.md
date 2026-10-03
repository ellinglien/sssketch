# Radio Fold Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An Autechre-inspired `fold` mode on both radios (sssketch's Discover radio and ell.ing/radio): one anchor row at full length, one or two short rhythmic rows looping at odd cycles (3.5, 5, 5.5, 7, 9 beats) that drift against the loop and realign every 30–120 s, alternating with straight stretches, steered by two faders (`fold`, `clash`) and a replayable seed, with slow parameter drift and a timbral clash.

**Architecture:** One pure, seeded state machine, `sssketch/src/shared/radioFold.ts`, is tested in sssketch and imported by the web radio through `@shared`. It decides each lap **one lap ahead**: per row a cycle (length, phase, cycle id), realignment marks, the stretch, and the drift. `radioClash.ts` puts the `clash` fader into the shared ranking, and `radioFoldLanes.ts` turns a step into what a runtime needs. Each radio plays the decisions its own way:
- **sssketch:** a folded row's cycle does **not** go through `barLength`/`durationSec` (the spec's §3 idea), because the transport restarts every stem at every loop top and a polymeter has to run on across it (spec point 1). Instead the native engine gains a **lap clock** (bars played since the last move, kept by Transport) and a **cycle table**: the renderer stages the next lap's cycles a lap ahead (`stage-cycles`), the audio thread takes them at the loop top, and `renderBlock` loops a named row's first `bars` on the lap clock with a 10 ms seam fade. The first task still proves the spec's crop on the tile path, as asked.
- **ell.ing/radio:** a row's timeline assignment carries the cycle; `planVoices` plays one voice per cycle on the cycle's own running grid, with a 10 ms `seam` edge; drift and the clash low-pass get their own per-row nodes.

**Tech Stack:** TypeScript, vitest, React 19 (sssketch renderer), Electron IPC, JUCE/C++ (native engine, `--test` UnitTestRunner), Web Audio (ell.ing/radio), headless-Chrome offline render checks (`spike/engine-check`).

**Spec:** `docs/superpowers/specs/2026-10-02-radio-fold-mode-design.md`. Read it fully first.

**How this plan was checked:** every code block below was compiled and tested before it was written down, in scratch copies of both repos at sssketch `9bf9b80` and ell.ing/radio `b1a5e96`: sssketch `npm run typecheck`, `npx eslint` on the touched files, `npx vitest run` (the whole suite; only two tests that need a bridge binary or an idle machine failed, and both pass in isolation), the native engine's whole `--test` suite on a fresh build, and on the web radio `npm run typecheck`, `npm test`, `npm run build` and every `spike/engine-check` check (`foldCycle` included). Nothing was listened to.

---

## Two repos, and how to work in them

| repo | path | verify |
|---|---|---|
| sssketch | `/Users/nickel/Claudecode/sssketch` | `npm run typecheck`; `npx vitest run <files>`; `npx eslint <files>`; `npm run lint` (no new errors or warnings); `npm test` |
| sssketch native engine | `/Users/nickel/Claudecode/sssketch/native-engine` | `cmake --build build` (a CMakeLists change reconfigures by itself); `build/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine --test <Suite>`; the whole suite with no name |
| ell.ing/radio | `/Users/nickel/Claudecode/ell.ing/radio` | `npm run typecheck` (four tsconfigs); `npm test` (`vitest run`); `npx vitest run <files>`; `npm run build`; `node spike/engine-check/run.mjs <check>` (headless Chrome, offline renders; set `ENGINE_CHECK_PORT` if another run holds 5199). **It has no lint script.** |

- The web radio compiles sssketch's `src/shared` files directly (`tsconfig.json` `paths`: `@shared/* -> ../../sssketch/src/shared/*`), with `noUnusedLocals`/`noUnusedParameters`. **A change to a shared type can break the radio's typecheck**, so every task that changes a shared type runs the radio's `npm run typecheck`, and Task 4 changes both repos in one go.
- **The native engine.** Read sssketch's `CLAUDE.md` "Running it" section. The engine is a separate build: after any change under `native-engine/Source/`, rebuild at once (`cd native-engine && cmake --build build`). A plain `cmake -B build` is an unoptimised local build, which is fine for the tests; nothing here adds `-ffast-math`/`-Ofast`, and the Faust sources keep `-ffp-contract=off` (no Faust file is touched). **Elling must fully quit sssketch (Cmd+Q) and relaunch after the engine tasks**: the engine subprocess is spawned once and a renderer reload does not restart it. An out-of-tree build needs `SSSKETCH_GOLDEN_DIR=<repo>/native-engine/test/golden` for `FaustStageTests`.
- Formatting: sssketch is prettier-formatted (`singleQuote`, no semis, `printWidth: 100`, no trailing commas). Run `npx prettier --write <the files you created or edited>` before `npx eslint`, **except** `DiscoverPanel.tsx` and `DiscoverRadioMenu.tsx`, which are never prettier'd as a whole: the hunks below are already formatted. The radio repo has no prettier config; match its style (single quotes, no semis, wide lines).
- **Commits.** Other agents work in both repos. `cd` into the repo, `git add` the exact paths the task lists, **never** `git add -A` or `git add .`. Every commit message ends with these two lines:

  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz
  ```

- No agent can hear either radio, see the UI, click through the app or hold a phone. Never claim a sound or UI change was "tested": say it was typechecked, unit-tested, engine-tested and (web) checked by offline render, and leave the listening to Elling (Task 21).

## Sequencing (read before starting)

**The radio turn-button plan (`docs/superpowers/plans/2026-10-02-radio-turn-button.md`) is built first.** At the time of writing it had landed through its Task 8 and review fixes in sssketch (`9bf9b80`) and its Task 4 and review fixes on the web (`b1a5e96`); its Task 9 is verification only. Files both plans touch:

| file | turn plan | this plan |
|---|---|---|
| `src/renderer/src/components/DiscoverPanel.tsx` | turn button, chips, `t`, the phrase-end roll split into turn/phrase paths, the remote's turn | Tasks 12, 14 |
| `src/renderer/src/components/DiscoverRadioMenu.tsx` | (none so far) | Task 13 |
| `src/shared/remoteState.ts`, `src/main/remoteServer.ts`, `src/main/remotePage.ts` (+ tests) | `turn` state, `POST /api/turn`, turn chips | Task 14 |
| ell.ing/radio `src/radio/step.ts`, `controller.ts` (+ tests) | `turn` event/action, `turnRequest` state | Tasks 18, 19 |
| ell.ing/radio `src/ui/full.ts`, `src/main.ts` | turn button and chips beside the turnaround toggles | Task 20 |
| `RadioSettings` (`radioSchedule.ts`) | untouched | Task 4 |

**How to read the edits.** Within a file, apply the edits in the order given (they are in file order). Each "Find:" block is replaced by its "Replace with:" block; each "After:" block stays and its "Insert:" block goes right after it. Each one is unique in the file at the moment you apply it, which matters where the same line occurs more than once (the interval draws in Task 12, the `renderBlock` calls in Task 10): the first remaining occurrence is the one meant, and the task's own summary says what all of them come to.

So **every edit to those files is anchored by quoting the code it changes, never by a line number**: "Find:" blocks are exact text to replace, "After:" blocks are exact text to insert after. Each was checked to occur exactly once at the commits named above. If one no longer matches (someone edited around it), find the same statement by its quoted text and make the same change; do not skip it. Two edits are written to tolerate the turn plan's shape on purpose:
- Task 12's wrap call adds a separate `if (step.wrapped) radioFoldAtWrap(loopBars)` line before the turnaround's, so it works whatever follows that line.
- Task 12 changes the `rate:` of **the phrase end's** `rollTurnaround` call only (the one passing `lastPhrase: radioTurnaroundMemoryRef.current`); the turn's forced rolls ignore `rate`.

Order: Tasks 1–6 shared rules and the engine proof; 7–11 engine and IPC; 12–14 sssketch integration; 15–20 the web radio; 21 verification and Elling's walkthrough. Every commit leaves both repos typechecking and their tests green.

## Spec points this plan had to resolve

1. **The loop top restarts every stem, in both runtimes.** sssketch's Discover preview is one rifff whose transport wraps to bar 0 at every loop top, and `renderBlock` tiles each stem from the rifff's start; the web's `planVoices` re-anchors every row at every lap top (`rowOffset`, "Discover's model"). A stem cropped by `barLength`/`durationSec` (spec §3) therefore plays 7+7+2 beats in every 16-beat lap and realigns **every lap** — no phasing, and walkthrough step 1 could never happen. So:
   - **Task 1 is the proof the spec asked for** (a cropped stem loops its first 7 beats at tempo, phase-shifted by `offsetSteps`). It passes on the tile path as it stands; it is kept as a regression test of the tile math, and its comment says why fold mode does not use it.
   - **The engine gets a lap clock and a cycle table** (Tasks 7, 9, 10): Transport keeps `lapBaseBars` (the bars of the laps completed since the last play/seek/snap) and an epoch; a stem whose `cycleRow` names a live row loops its first `bars` on `lapBaseBars + positionBars`, from the cycle's origin (the top of the lap it went live on). The renderer stages each lap's table a lap ahead; the audio thread takes it in the wrap's split, exactly where it takes a staged project, so a length change is sample-exact on the top without a staged project swap (which would collide with radio's change stages).
   - **The web** keeps the cycle on the row's timeline assignment (`CycleSpec`, origin = the top it started on), and `planVoices` cuts one voice per cycle on the cycle's running grid.
2. **Why not scale `durationSec`.** `StemBufferCache` is keyed by path and sews a stem's tail toward its head **at the `durationSec` it is first loaded with**. A stem first loaded folded would be sewn mid-buffer (a 128-sample blip inside the stem whenever it later played whole). The cycle path keeps the stem's real `barLength`/`durationSec` and only reads less of it.
3. **The seam fade** is 10 ms at both ends of every cycle (fade out into the seam, fade in out of it), `kCycleSeamFadeSec` natively and `SEAM_FADE_SEC` (= `FOLD_SEAM_FADE_SEC`) on the web. It dips to silence at the seam for those 20 ms; that is the price of a click-free crop, and Elling judges it (walkthrough step 2). Where a cycle runs on across a loop top, nothing is faded: the web crossfades it as any seamless restart, and the native path never restarts it.
4. **A lap ahead.** `stepRadioFold`, called at the top of lap k, decides lap k+1. sssketch stages that lap's cycles at once (`engineStageCycles(rows, false)`) and keeps two refs: the lap playing (`radioFoldNowRef`, whose drift the live pushes carry) and the next (`radioFoldNextRef`, which a staged project carries, and which the turnaround roll reads). The web sends a `fold` action for `t.nextWrap`.
5. **Anchor and loop.** The anchor is the longest audible drums/bass row (else the longest audible row) and never folds. Realignment is computed against **the loop** the clock wraps on, which is the anchor's length whenever the anchor is the longest row (the usual case). A fold never changes the loop length: the loop is computed from the rows' full lengths on both sides.
6. **The 11-against-13 example.** By the spec's own rule 11 against 13 realigns every 143 beats, 71.5 s at 120 bpm, which is inside the window. The rule is applied as written, and only to the spec's menu (3, 3.5, 5, 5.5, 7, 9), so 11 and 13 never arise.
7. **The fader's menus.** `fold` below 50: 7 or 9 beats, no phase offset, one row. 50–74: 5, 7 or 9, offsets 0 or a 1/16. 75 and up: every menu length, offsets 0, a 1/16, a 1/8 triplet or a half beat (§1's three plus §2's "half-beat offsets"). Two rows only at `fold` 60 or more. A row folds only to a menu length inside the window and shorter than itself, so at a low `fold` a 1-bar row does not fold (nothing of 7 or 9 fits under it).
8. **Stretch lengths** are this plan's numbers, to tune by ear: a folded stretch is 16 bars at `fold` 0 rising to 96 at 100, a straight one 96 falling to 24, each ±25 % drawn and rounded to whole laps. **The first stretch is folded** (turning the mode on should do something). A straight stretch starts counting only once every fold has walked back, so it is always heard straight. `fold` 0 never folds.
9. **"Prefers" a realignment top.**
   - A change's interval is drawn from 16–64 bars and moved later to the first marked top within two laps of it (`radioFoldIntervalBars`).
   - A phrase end on a marked top rolls its turnaround at `often`'s chance; `off` stays off (`radioFoldTurnaroundRate`).
   - A settled fold unfolds on its own realignment top, waiting at most 8 laps; a second fold joins only on a marked top, half the time.
10. **Each curve step restarts the cycle** on its top (a new cycle id); a stem change on a folded row ends its fold (the new layer arrives straight, and does not refold on the same top); a muted, hooked or now-anchor row leaves the fold at once; a loop-length change restarts every cycle on that top.
11. **Drift ranges** (spec §1 gives the sweep length only): cutoff 1 → 0.62 at most (about 1.4 kHz; "never closed"), an **extra** reverb send 0–0.15 on top of the row's own (sends never dip below the listener's), and a dub-echo send 0–0.18. Each sweep is a straight ramp per lap; sssketch pushes the preview at every wrap for it. In sssketch a gesture's or turnaround's filter on a stem wins that lap (no drift cutoff there), sends take the max, and the dub sends ride `dubThrows`: a throw keeps its row, and with no throw armed they open into `FOLD_DRIFT_ECHO` (a dotted eighth, feedback 0.35) — always under the listener's throws switch and level. On the web drift does **not** go through the rows' existing gesture nodes (spec §3 says "the existing automation"): a filter in, a dip and a bloom write those same params and would cancel each other, so each row gets its own drift low-pass, drift send and drift echo send (neutral while the mode is off), written with the existing `AudioParam` ramps and scaled by the listener's echo. While the web radio is held, folds and drift hold.
12. **Clash.** The spec's "inverts its match" is two terms in `rankCandidates`: a requested `rhythmic`/`bright` trait turns toward its other end by the amount, and distance from **the bed** (the mean percentile of the other heard rows) on those two traits scores. `bassHeavy` and `warm` are untouched and key is never considered. sssketch's candidates only carry the slot's own trait percentiles, so `getDiscoverCandidates` gains `alsoTraits` and the clash asks for `rhythmic` and `bright` on every roll while radio runs in fold mode. "A clashing pair" is the most mismatched pair by brightness among the heard rows, at least 0.4 apart; the brighter gets the static low-pass (0.5) and no drift cutoff. The master lean is `0.15 × (clash − 50) / 50` above 50, added to the listener's glue and saturation amounts and capped at 1.
13. **Seeds.** Six characters of `abcdefghjkmnpqrstuvwxyz23456789` (no 0/o/1/l/i), default `autech`; a typed or pasted seed is lowercased and cleaned, and anything that does not leave six characters is ignored. A new seed starts a new machine at the next wrap. **Replay is exact for the rules given the same rows**: the stems radio picks are not seeded (sssketch draws with `Math.random`; the web with the controller's random), so a replay folds the same way only as far as the rows look the same (kinds, lengths). The tooltip says the stems can differ.
14. **Mode off, radio off, course change.** Mode off while running: an empty table is staged for the next top (an effect on `foldMode`), and the drift and lean leave with the next wrap's push. Radio off and a course change: `resetRadioFold()` empties the table at once (`now`), which lands at the next block — a seam within a few milliseconds of the click, not on a top. The web unfolds at the next top.
15. **Percussive.** sssketch: the resolved stem's sound type is `drums`; web: the record's instrument mask maps to drums.
16. **The phone.** The remote has no radio settings today; the turn plan added a `turn` view. This plan adds `fold: boolean | null` to `RemoteState` (null while radio is off), `{ kind: 'fold'; on }` to `RemoteCommand`, and `POST /api/fold { on }` (400 for a non-boolean, 409 `radio off`), and the page's `fold` chips (off/on) in the loop block, shown only while radio runs.
17. **The seeded generator** is the existing `src/shared/seededRandom.ts` (`seededRandom`, mulberry32 over a string hash), not a second copy: every draw is ``seededRandom(`${seed}#${counter}`)()`` with the counter in the machine's state, so a draw depends only on the seed and how many came before it.
18. **Interplay with turns and turnarounds.** Nothing changes for them: they land on the loop top as before, a folded row counts as an ordinary row for their guards, and a turn's forced roll ignores the rate.

---

## File map

### sssketch

| file | | responsibility |
|---|---|---|
| `src/shared/radioFold.ts` | create | the seeded fold machine: settings helpers, realignment window, anchor and eligibility, curves, stretches, drift, marks, the interval and rate preferences |
| `src/shared/radioFold.test.ts` | create | arithmetic, eligibility, paths, settings helpers |
| `src/shared/radioFoldStep.test.ts` | create | the machine over many wraps |
| `src/shared/radioClash.ts` (+ `.test.ts`) | create | the clash: trait and bed terms, the low-pass row, the master lean |
| `src/shared/radioFoldLanes.ts` (+ `.test.ts`) | create | a step as engine rows, which stems name their row, drift lanes, the drift echo, the leaned sound |
| `src/shared/radioFoldSettings.test.ts` | create | `RadioSettings` fold fields and `radioPaceWindowOf` |
| `src/shared/radioSchedule.ts` (+ `.test.ts`) | modify | `foldMode`, `fold`, `clash`, `foldSeed`; `radioPaceWindowOf` |
| `src/shared/discoverRanking.ts` | modify | `rankCandidates({ clash })` |
| `src/shared/buildEngineProject.ts` (+ `.test.ts`) | modify | `EngineStem.cycleRow`, `stemCycleRows` option |
| `src/main/discoverCandidates.ts` (+ `.test.ts`) | modify | `alsoTraits` |
| `src/main/index.ts`, `src/preload/index.ts` | modify | `engine-stage-cycles`; `getDiscoverCandidates(..., alsoTraits)` |
| `src/main/discoverSettingsStore.test.ts` | modify | the round trip carries the fold fields |
| `src/renderer/src/components/DiscoverPanel.tsx` | modify | the machine at every wrap, intervals, rate, cycle rows, drift lanes, clash low-pass and lean, clash picks, the phone's switch |
| `src/renderer/src/components/DiscoverRadioMenu.tsx` | modify | the `fold` section |
| `src/shared/remoteState.ts`, `src/main/remoteServer.ts`, `src/main/remotePage.ts` (+ tests) | modify | the phone's fold switch |
| `native-engine/Source/CycleTable.h/.cpp`, `CycleTableTests.cpp` | create | `LapClock`, `cycleKeyOf`, the staged/live cycle table |
| `native-engine/CMakeLists.txt` | modify | the new sources |
| `native-engine/Source/EngineProject.h/.cpp`, `EngineProjectTests.cpp` | modify | `EngineStem::cycleRow` / `cycleRowKey` |
| `native-engine/Source/PlaybackEngine.h/.cpp`, `PlaybackEngineTests.cpp` | modify | the proof; `renderBlock(..., lapClock)`, the cycle path, `stageCycles`/`applyStagedCycles` |
| `native-engine/Source/Transport.h/.cpp`, `TransportTests.cpp` | modify | the lap clock; cycles applied at the top |
| `native-engine/Source/IpcServer.cpp` | modify | `stage-cycles` |

### ell.ing/radio

| file | | responsibility |
|---|---|---|
| `src/radio/settings.ts` (+ `.test.ts`) | modify | the fold fields in `WEB_RADIO_DEFAULTS` |
| `src/audio/schedule.ts` (+ `.test.ts`) | modify | `CycleSpec`, `assignmentAt`, cycle voices, the `seam` edge |
| `src/audio/timeline.ts` (+ `.test.ts`) | modify | `setCycles` |
| `src/audio/rowVoice.ts`, `src/audio/engine.ts` | modify | drift nodes; `setCycles`, `setDrift`, `setFoldLean` |
| `spike/engine-check/check.ts` | modify | `foldCycle`: a folded row repeats every 7 beats, runs on across the top, fades its seam |
| `src/radio/pick.ts` (+ `.test.ts`) | modify | the clash in `pickStem` |
| `src/radio/step.ts` (+ `.test.ts`) | modify | the machine at every wrap, `fold`/`foldLean` actions, `foldControls`, intervals, rate, clash on arms |
| `src/radio/controller.ts` (+ `.test.ts`) | modify | carrying out `fold`/`foldLean`; `setFoldControls`; the clash to the picker |
| `src/ui/foldPrefs.ts` (+ `.test.ts`) | create | `radio.fold` per visitor |
| `src/ui/full.ts`, `src/main.ts` | modify | the fold controls beside the turn |

---

## Task 1: The engine proof — a cropped stem loops its first N beats (sssketch native engine)

The spec's first task. It passes on the current engine: it is the proof, and the regression test of the tile math with a fractional `barLength` (`ef966ab`). If it **fails**, stop and report: the tile path is not what this plan assumes.

**Files:**
- Modify: `native-engine/Source/PlaybackEngineTests.cpp`

- [ ] **Step 1: Write the test**

In `native-engine/Source/PlaybackEngineTests.cpp`:

After:

```cpp
                for (float s : l2) expectEquals(s, 0.0f);
                halfBar.deleteFile();
```

Insert:

```cpp
            }

            // RADIO FOLD MODE, the proof the spec asked for first (spec 2026-10-02-radio-fold-mode
            // section 3): a stem cropped by scaling barLength and durationSec together loops just
            // its first N beats, at tempo, and offsetSteps moves the cycle's phase. 60 bpm: a beat
            // is 1 s, a bar 4 s. A 16 s (4-bar) ramp cropped to 7 beats: every tile plays the
            // ramp's first 7 s, 0 .. 7/16. This passes on the tile path as it stands; what it
            // cannot do is keep the cycle running across a loop top or fade its seam, which is
            // why fold mode plays through the cycle table instead (the tests after this one).
            beginTest("a cropped stem (barLength and durationSec scaled together) loops its first 7 beats at tempo, offset by offsetSteps");
            {
                auto ramp = writeRampFixtureWav("sssketch_pe_crop7_ramp.wav", 16 * 44100);
                EngineProject project;
                project.bpm = 60.0;
                project.snapDiv = 16.0;
                EngineRifff rifff;
                rifff.startBar = 0.0;
                rifff.barLength = 4.0;
                EngineStem stem;
                stem.resolvedPath = ramp.getFullPathName();
                stem.barLength = 7.0 / 4.0;
                stem.durationSec = 16.0 * (7.0 / 16.0); // scaled with it: 7 s
                stem.offsetSteps = 4.0; // one beat (16 steps a bar)
                rifff.stems.push_back(stem);
                project.rifffs.push_back(rifff);

                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains;
                engine.setProject(project);
                const auto at = [&](double sec) {
                    float l = 0.0f, r = 0.0f;
                    engine.renderBlock(sec / 4.0, 44100.0, 1, &l, &r, channelChains);
                    return l;
                };
                // tiles at 1 s, 8 s and 15 s, each the ramp's first 7 s
                expectWithinAbsoluteError(at(0.5), 0.0f, 1.0e-6f); // before the offset: nothing
                expectWithinAbsoluteError(at(1.5), 0.5f / 16.0f, 0.002f);
                expectWithinAbsoluteError(at(7.9), 6.9f / 16.0f, 0.002f);
                expectWithinAbsoluteError(at(8.5), 0.5f / 16.0f, 0.002f); // restarted at 8 s
                expectWithinAbsoluteError(at(14.5), 6.5f / 16.0f, 0.002f);
                expectWithinAbsoluteError(at(15.5), 0.5f / 16.0f, 0.002f);
                ramp.deleteFile();
```

- [ ] **Step 2: Build and run it**

```bash
cd /Users/nickel/Claudecode/sssketch/native-engine && cmake --build build && build/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine --test PlaybackEngine
```

Expected: `All unit tests passed.`, with `a cropped stem (barLength and durationSec scaled together) loops its first 7 beats at tempo, offset by offsetSteps` among the completed tests.

- [ ] **Step 3: Commit**

```bash
cd /Users/nickel/Claudecode/sssketch
git add native-engine/Source/PlaybackEngineTests.cpp
git commit -m "$(cat <<'EOF'
engine: the fold mode proof -- a cropped stem loops its first 7 beats at tempo, offset by offsetSteps

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz
EOF
)"
```

## Task 2: The fold rules' foundations (sssketch, shared)

**Files:**
- Create: `src/shared/radioFold.ts`
- Test: `src/shared/radioFold.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/shared/radioFold.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FOLD_SEED,
  FOLD_SEED_ALPHABET,
  newFoldSeed,
  normalizeFoldAmount,
  normalizeFoldSeed,
  radioFoldAllowedCycles,
  radioFoldAnchor,
  radioFoldCanFold,
  radioFoldPath,
  radioFoldRealignBeats,
  type RadioFoldRow
} from './radioFold'

const row = (id: string, over: Partial<RadioFoldRow> = {}): RadioFoldRow => ({
  id,
  stemId: `${id}-stem`,
  kinds: ['rhythmic'],
  barLength: 2,
  hooked: false,
  audible: true,
  percussive: false,
  ...over
})

describe('the realignment window', () => {
  it('realigns on a half-beat grid: 7 vs 16, 3.5 vs 16, 5 vs 8, 9 vs 16', () => {
    expect(radioFoldRealignBeats(7, 16)).toBe(112)
    expect(radioFoldRealignBeats(3.5, 16)).toBe(112)
    expect(radioFoldRealignBeats(5, 8)).toBe(40)
    expect(radioFoldRealignBeats(9, 16)).toBe(144)
  })

  it('allows 7 against 16 at 120 bpm (56 s) and refuses 3 (24 s)', () => {
    expect(radioFoldAllowedCycles(16, 120)).toEqual([3.5, 5, 5.5, 7, 9])
  })

  it('refuses everything outside 30-120 s: 9 against 32 at 120 bpm is 144 s', () => {
    expect(radioFoldAllowedCycles(32, 120)).not.toContain(9)
    expect(radioFoldAllowedCycles(32, 120)).toContain(7)
  })

  it('every allowed cycle is inside the window at a range of tempos and loops', () => {
    for (const bpm of [70, 96, 120, 140, 174]) {
      for (const loopBeats of [4, 8, 16, 24, 32]) {
        for (const c of radioFoldAllowedCycles(loopBeats, bpm)) {
          const sec = (radioFoldRealignBeats(c, loopBeats) * 60) / bpm
          expect(sec).toBeGreaterThanOrEqual(30 - 1e-9)
          expect(sec).toBeLessThanOrEqual(120 + 1e-9)
        }
      }
    }
  })

  it('has nothing for no tempo or no loop', () => {
    expect(radioFoldAllowedCycles(16, 0)).toEqual([])
    expect(radioFoldAllowedCycles(0, 120)).toEqual([])
  })
})

describe('the anchor and what may fold', () => {
  it('the anchor is the longest audible drums or bass row', () => {
    const rows = [
      row('a', { kinds: ['lead'], barLength: 8 }),
      row('b', { kinds: ['drums'], barLength: 2 }),
      row('c', { kinds: ['bass'], barLength: 4 })
    ]
    expect(radioFoldAnchor(rows)).toBe('c')
  })

  it('with no drums or bass row, the longest audible row', () => {
    expect(
      radioFoldAnchor([
        row('a', { kinds: ['lead'], barLength: 4 }),
        row('b', { barLength: 8, audible: false }),
        row('c', { barLength: 2 })
      ])
    ).toBe('a')
    expect(radioFoldAnchor([])).toBeNull()
  })

  it('never folds the anchor, a melodic, hooked, long, silent or empty row', () => {
    expect(radioFoldCanFold(row('a'), 'a')).toBe(false)
    expect(radioFoldCanFold(row('a', { kinds: ['lead'] }), null)).toBe(false)
    expect(radioFoldCanFold(row('a', { kinds: ['rhythmic', 'bass'] }), null)).toBe(false)
    expect(radioFoldCanFold(row('a', { hooked: true }), null)).toBe(false)
    expect(radioFoldCanFold(row('a', { barLength: 8 }), null)).toBe(false)
    expect(radioFoldCanFold(row('a', { audible: false }), null)).toBe(false)
    expect(radioFoldCanFold(row('a', { stemId: null }), null)).toBe(false)
  })

  it('folds a short drums, rhythmic or bright row, or a percussive warm one', () => {
    expect(radioFoldCanFold(row('a', { kinds: ['drums'] }), 'z')).toBe(true)
    expect(radioFoldCanFold(row('a', { kinds: ['bright'], barLength: 4 }), 'z')).toBe(true)
    expect(radioFoldCanFold(row('a', { kinds: ['warm'] }), 'z')).toBe(false)
    expect(radioFoldCanFold(row('a', { kinds: ['warm'], percussive: true }), 'z')).toBe(true)
  })
})

describe('radioFoldPath', () => {
  it('steps toward the target on the half-beat grid and lands on it', () => {
    expect(radioFoldPath(16, 7, 3)).toEqual([13, 10, 7])
    expect(radioFoldPath(16, 7, 2)).toEqual([11.5, 7])
    expect(radioFoldPath(7, 16, 4)).toEqual([9.5, 11.5, 14, 16])
  })

  it('drops a repeated length', () => {
    expect(radioFoldPath(8, 7, 4)).toEqual([7.5, 7])
  })
})

describe('fold settings', () => {
  it('amounts clamp to 0..100 and junk takes the fallback', () => {
    expect(normalizeFoldAmount(140, 40)).toBe(100)
    expect(normalizeFoldAmount(-3, 40)).toBe(0)
    expect(normalizeFoldAmount(33.6, 40)).toBe(34)
    expect(normalizeFoldAmount('50', 40)).toBe(40)
    expect(normalizeFoldAmount(Number.NaN, 25)).toBe(25)
  })

  it('a seed is six characters of the alphabet; a pasted one is cleaned', () => {
    expect(normalizeFoldSeed('k3x9pq')).toBe('k3x9pq')
    expect(normalizeFoldSeed(' K3X-9PQ ')).toBe('k3x9pq')
    expect(normalizeFoldSeed('abc')).toBe(DEFAULT_FOLD_SEED)
    expect(normalizeFoldSeed('k3x9pq0')).toBe('k3x9pq') // 0 is not in the alphabet
    expect(normalizeFoldSeed(42)).toBe(DEFAULT_FOLD_SEED)
  })

  it('new draws six characters from the alphabet', () => {
    let i = 0
    const seed = newFoldSeed(() => (i++ % 10) / 10)
    expect(seed).toHaveLength(6)
    for (const ch of seed) expect(FOLD_SEED_ALPHABET).toContain(ch)
    expect(newFoldSeed(() => 0.9999999)).toBe('999999')
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /Users/nickel/Claudecode/sssketch && npx vitest run src/shared/radioFold.test.ts`
Expected: FAIL — `Failed to resolve import "./radioFold"`.

- [ ] **Step 3: Write the module**

Create `src/shared/radioFold.ts`:

```ts
// src/shared/radioFold.ts
//
// RADIO FOLD MODE -- docs/superpowers/specs/2026-10-02-radio-fold-mode-design.md. Autechre's
// "folding time": one anchor row stays at full length and sets the loop top, and one or two
// short rhythmic rows loop at odd cycles (3.5, 5, 7, 9 beats...) against it, drifting out of
// phase and back. A pure, seeded state machine shared by both radios (sssketch's Discover radio
// and ell.ing/radio); each runtime plays its decisions its own way.
//
// What it promises its callers:
//   - RULES, NOT DICE (spec section 0). Every draw is seededRandom(`${seed}#${counter}`): the same
//     seed and the same sequence of steps (rows, loop, tempo, fader) give the same decisions.
//     Nothing here reads Math.random.
//   - One step per LOOP TOP, one lap AHEAD: stepRadioFold, called at the top of lap k, decides
//     lap k+1 (`lap` in its result). That lap of lead is what lets a runtime schedule a length
//     change exactly on the top it belongs to, and lets the turnaround roll (made at the top of a
//     phrase's last lap) know whether the phrase's closing top is a realignment.
//   - A cycle is in BEATS, its phase offset in beats, and it restarts at the top of the lap whose
//     `cycleId` first names it: a new id is a new phase origin, an unchanged id keeps running.
//
// It must not import radioSchedule: radioSchedule imports it.

import type { DiscoverSlotKind } from './discoverSlotKind'
import { seededRandom } from './seededRandom'

/** The cycle lengths a folded row may take, in beats (spec section 1). */
export const FOLD_CYCLE_BEATS: readonly number[] = [3, 3.5, 5, 5.5, 7, 9]
/** A cycle is allowed only if it realigns with the loop this often, at the tempo. */
export const FOLD_REALIGN_MIN_SEC = 30
export const FOLD_REALIGN_MAX_SEC = 120
/** At most this many rows fold at once, never the anchor. */
export const FOLD_MAX_ROWS = 2
/** A row longer than this is a phrase, not a pattern: it never folds. */
export const FOLD_MAX_ROW_BARS = 4
/** The micro-fade at every cycle seam, both runtimes (spec section 1). */
export const FOLD_SEAM_FADE_SEC = 0.01
/** The pace window while the mode is on (spec section 1): it replaces the user's. */
export const FOLD_PACE_BARS: Readonly<{ min: number; max: number }> = Object.freeze({
  min: 16,
  max: 64
})
/** A change prefers a realignment top at most this many laps past its drawn interval. */
export const FOLD_PREFER_WAIT_LAPS = 2
/** A settled row asked to unfold waits for its own realignment top, but no longer than this. */
export const FOLD_UNFOLD_MAX_WAIT_LAPS = 8
/** Folded stretches: this many bars at `fold` 0 .. 100 (then +-25%, drawn). */
export const FOLD_FOLDED_STRETCH_BARS: Readonly<{ atNone: number; atFull: number }> = Object.freeze(
  { atNone: 16, atFull: 96 }
)
/** Straight stretches, the same way: long at a low `fold`, short at a high one. */
export const FOLD_STRAIGHT_STRETCH_BARS: Readonly<{ atNone: number; atFull: number }> =
  Object.freeze({ atNone: 96, atFull: 24 })

export const DEFAULT_RADIO_FOLD = 40
export const DEFAULT_RADIO_CLASH = 25
/** Lowercase letters and digits without the lookalikes (0/o, 1/l/i): a code read off a screen
 * and typed back has to survive the trip. */
export const FOLD_SEED_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
export const FOLD_SEED_LENGTH = 6
export const DEFAULT_FOLD_SEED = 'autech'

/** A 0..100 fader value, rounded; anything that is not a finite number is `fallback`. */
export function normalizeFoldAmount(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(100, Math.max(0, Math.round(value)))
}

/** A typed or pasted seed: lowercased, everything outside the alphabet dropped. Exactly six
 * characters must remain, or it is the default. */
export function normalizeFoldSeed(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_FOLD_SEED
  const kept = [...value.trim().toLowerCase()].filter((ch) => FOLD_SEED_ALPHABET.includes(ch))
  return kept.length === FOLD_SEED_LENGTH ? kept.join('') : DEFAULT_FOLD_SEED
}

/** The `new` button: six characters drawn from the alphabet. */
export function newFoldSeed(random: () => number = Math.random): string {
  const n = FOLD_SEED_ALPHABET.length
  let out = ''
  for (let i = 0; i < FOLD_SEED_LENGTH; i++) {
    out += FOLD_SEED_ALPHABET[Math.min(n - 1, Math.floor(random() * n))]
  }
  return out
}

const halves = (beats: number): number => Math.round(beats * 2)

function gcd(a: number, b: number): number {
  let x = a
  let y = b
  while (y !== 0) [x, y] = [y, x % y]
  return x
}

/** Beats until a cycle and the loop line up again: their lowest common multiple on a half-beat
 * grid. 7 against 16 is 112; 3.5 against 16 is 112; 5 against 8 is 40. */
export function radioFoldRealignBeats(cycleBeats: number, loopBeats: number): number {
  const a = halves(cycleBeats)
  const b = halves(loopBeats)
  if (!(a > 0) || !(b > 0)) return Number.POSITIVE_INFINITY
  return ((a / gcd(a, b)) * b) / 2
}

/** The cycles (FOLD_CYCLE_BEATS) whose realignment with a loop of `loopBeats` falls inside
 * FOLD_REALIGN_MIN_SEC..FOLD_REALIGN_MAX_SEC at `bpm`. At 120 bpm on a 16-beat loop: 3.5, 5,
 * 5.5, 7 and 9 (3 realigns every 24 s: too often to hear as phasing). */
export function radioFoldAllowedCycles(loopBeats: number, bpm: number): number[] {
  if (!(bpm > 0) || !(loopBeats > 0)) return []
  return FOLD_CYCLE_BEATS.filter((c) => {
    const sec = (radioFoldRealignBeats(c, loopBeats) * 60) / bpm
    return sec >= FOLD_REALIGN_MIN_SEC - 1e-9 && sec <= FOLD_REALIGN_MAX_SEC + 1e-9
  })
}

/** One row as the machine sees it. `id` is opaque (a radio slot, a web row). */
export interface RadioFoldRow {
  id: string
  /** What the row is playing; null while it has nothing. A fold belongs to one stem. */
  stemId: string | null
  kinds: readonly DiscoverSlotKind[]
  /** Its own loop, in bars, at full length. */
  barLength: number
  hooked: boolean
  /** Heard right now. */
  audible: boolean
  /** The stem's own type is percussive (sssketch: a drums sound type; web: a drums mask). */
  percussive: boolean
}

const FOLDABLE_KINDS: readonly DiscoverSlotKind[] = ['drums', 'rhythmic', 'bright']
const NEVER_FOLDS: readonly DiscoverSlotKind[] = ['lead', 'bass']

/** The anchor: the longest audible drums or bass row, or, with none, the longest audible row.
 * Ties go to the first in `rows`' order. */
export function radioFoldAnchor(rows: readonly RadioFoldRow[]): string | null {
  const audible = rows.filter((r) => r.audible && r.barLength > 0)
  const low = audible.filter((r) => r.kinds.includes('drums') || r.kinds.includes('bass'))
  let best: RadioFoldRow | null = null
  for (const r of low.length > 0 ? low : audible) {
    if (best === null || r.barLength > best.barLength) best = r
  }
  return best?.id ?? null
}

/** Whether a row may fold: audible, playing a stem, not the anchor, not hooked, at most
 * FOLD_MAX_ROW_BARS long, never lead or bass, and short and rhythmic (a drums, rhythmic or
 * bright kind, or a percussive stem). */
export function radioFoldCanFold(row: RadioFoldRow, anchorId: string | null): boolean {
  if (!row.audible || row.hooked || row.id === anchorId || row.stemId === null) return false
  if (!(row.barLength > 0) || row.barLength > FOLD_MAX_ROW_BARS) return false
  if (row.kinds.some((k) => NEVER_FOLDS.includes(k))) return false
  return row.percussive || row.kinds.some((k) => FOLDABLE_KINDS.includes(k))
}

/** The lengths a fold steps through from `fromBeats` to `toBeats` in `steps` loop tops, on the
 * half-beat grid, the last exactly `toBeats`; a repeated length is dropped. 16 to 7 in three:
 * 13, 10, 7. */
export function radioFoldPath(fromBeats: number, toBeats: number, steps: number): number[] {
  const n = Math.max(1, Math.floor(steps))
  const out: number[] = []
  for (let i = 1; i <= n; i++) {
    const v = i === n ? toBeats : Math.round((fromBeats + ((toBeats - fromBeats) * i) / n) * 2) / 2
    const last = out.length > 0 ? out[out.length - 1] : fromBeats
    if (v !== last) out.push(v)
  }
  return out
}
```

- [ ] **Step 4: Run it to see it pass, and check both repos still typecheck**

```bash
cd /Users/nickel/Claudecode/sssketch && npx vitest run src/shared/radioFold.test.ts && npx prettier --write src/shared/radioFold.ts src/shared/radioFold.test.ts && npx eslint src/shared/radioFold.ts src/shared/radioFold.test.ts && npm run typecheck
cd /Users/nickel/Claudecode/ell.ing/radio && npm run typecheck
```

Expected: 14 tests pass; no lint output; both typechecks clean.

- [ ] **Step 5: Commit**

```bash
cd /Users/nickel/Claudecode/sssketch
git add src/shared/radioFold.ts src/shared/radioFold.test.ts
git commit -m "$(cat <<'EOF'
radio fold: the rules' foundations -- the realignment window, the anchor, what may fold, the curves, the seed

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz
EOF
)"
```

## Task 3: The fold machine — stretches, curves, drift, marks (sssketch, shared)

**Files:**
- Modify: `src/shared/radioFold.ts`
- Test: `src/shared/radioFoldStep.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/shared/radioFoldStep.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  FOLD_DRIFT_RANGE,
  FOLD_MAX_ROWS,
  createRadioFold,
  radioFoldAllowedCycles,
  radioFoldIntervalBars,
  radioFoldMarkedBarsAhead,
  radioFoldTurnaroundRate,
  stepRadioFold,
  type RadioFoldInput,
  type RadioFoldRow,
  type RadioFoldState,
  type RadioFoldStep
} from './radioFold'

const row = (id: string, over: Partial<RadioFoldRow> = {}): RadioFoldRow => ({
  id,
  stemId: `${id}-stem`,
  kinds: ['rhythmic'],
  barLength: 2,
  hooked: false,
  audible: true,
  percussive: false,
  ...over
})

/** A band: a 4-bar drums anchor, two short rhythmic rows, a lead and a warm pad. */
const BAND: RadioFoldRow[] = [
  row('drums', { kinds: ['drums'], barLength: 4 }),
  row('hats', { kinds: ['drums'], barLength: 1 }),
  row('perc', { kinds: ['rhythmic'], barLength: 2 }),
  row('lead', { kinds: ['lead'], barLength: 4 }),
  row('pad', { kinds: ['warm'], barLength: 4 })
]

const input = (fold: number, rows: RadioFoldRow[] = BAND): RadioFoldInput => ({
  rows,
  loopBars: 4,
  bpm: 120,
  fold
})

function run(
  seed: string,
  wraps: number,
  at: (wrap: number) => RadioFoldInput,
  start: RadioFoldState = createRadioFold(seed)
): RadioFoldStep[] {
  const out: RadioFoldStep[] = []
  let s = start
  for (let i = 0; i < wraps; i++) {
    const step = stepRadioFold(s, at(i))
    out.push(step)
    s = step.state
  }
  return out
}

describe('stepRadioFold: replay', () => {
  it('the same seed and the same steps give the same decisions, over many wraps', () => {
    const a = run('k3x9pq', 300, () => input(70))
    const b = run('k3x9pq', 300, () => input(70))
    expect(b).toEqual(a)
  })

  it('a different seed gives different decisions', () => {
    const a = run('k3x9pq', 300, () => input(70)).map((s) => s.cycles)
    const b = run('autech', 300, () => input(70)).map((s) => s.cycles)
    expect(b).not.toEqual(a)
  })

  it('is pure: the state it was given is untouched', () => {
    const s = createRadioFold('k3x9pq')
    const copy = structuredClone(s)
    stepRadioFold(s, input(70))
    expect(s).toEqual(copy)
  })

  it('decides one lap ahead: the first step is lap 0', () => {
    expect(stepRadioFold(createRadioFold('k3x9pq'), input(40)).lap).toBe(0)
  })
})

describe('stepRadioFold: which rows fold, and how', () => {
  const steps = run('k3x9pq', 400, () => input(90))

  it('never folds the anchor, a melodic row, a warm pad or a long row; at most two at once', () => {
    for (const s of steps) {
      expect(s.cycles.length).toBeLessThanOrEqual(FOLD_MAX_ROWS)
      for (const c of s.cycles) {
        expect(['hats', 'perc']).toContain(c.rowId)
        expect(c.rowId).not.toBe(s.anchorId)
      }
      expect(s.anchorId).toBe('drums')
    }
  })

  it('folds at all, and reaches two rows at a high fold', () => {
    expect(steps.some((s) => s.cycles.length === 2)).toBe(true)
  })

  it('every target is inside the realignment window and shorter than the row', () => {
    const allowed = radioFoldAllowedCycles(16, 120)
    for (const s of steps) {
      for (const r of s.state.rows) {
        if (r.mode === 'unfolding') continue
        expect(allowed).toContain(r.targetBeats)
        expect(r.targetBeats).toBeLessThan(r.fullBeats)
      }
    }
  })

  it('never folds a hooked row', () => {
    const hooked = BAND.map((r) => (r.id === 'perc' ? { ...r, hooked: true } : r))
    for (const s of run('k3x9pq', 200, () => input(90, hooked))) {
      expect(s.cycles.map((c) => c.rowId)).not.toContain('perc')
    }
  })

  it('a low fold keeps to mild lengths (7 or 9) and no phase offset', () => {
    for (const s of run('k3x9pq', 300, () => input(40))) {
      for (const r of s.state.rows) {
        if (r.mode !== 'unfolding') expect([7, 9]).toContain(r.targetBeats)
        expect(r.phaseBeats).toBe(0)
      }
      expect(s.cycles.length).toBeLessThanOrEqual(1)
    }
  })
})

describe('stepRadioFold: curves land on loop tops', () => {
  it('a fold steps from full length toward its target, one length per top, in 2 to 4 steps', () => {
    const steps = run('k3x9pq', 400, () => input(40))
    // follow every run of one row's fold, from its first folded lap
    let i = 0
    let checked = 0
    while (i < steps.length) {
      const first = steps[i].state.rows.find((r) => r.mode === 'folding')
      if (!first || steps[i].lap !== first.originLap || first.path.length + 1 > 3) {
        i++
        continue
      }
      const lengths: number[] = []
      let j = i
      for (; j < steps.length; j++) {
        const r = steps[j].state.rows.find((x) => x.rowId === first.rowId)
        if (!r) break
        if (lengths.length === 0 || lengths[lengths.length - 1] !== r.cycleBeats) {
          // each new length starts its cycle on that lap's own top
          expect(r.originLap).toBe(steps[j].lap)
          lengths.push(r.cycleBeats)
        }
        if (r.mode === 'settled') break
      }
      expect(lengths.length).toBeGreaterThanOrEqual(1)
      expect(lengths.length).toBeLessThanOrEqual(4)
      for (let k = 1; k < lengths.length; k++) expect(lengths[k]).toBeLessThan(lengths[k - 1])
      expect(lengths[lengths.length - 1]).toBe(first.targetBeats)
      checked++
      i = j + 1
    }
    expect(checked).toBeGreaterThan(0)
  })

  it('a cycle id stays while the cycle runs on, and changes when it restarts', () => {
    const steps = run('k3x9pq', 200, () => input(40))
    for (let i = 1; i < steps.length; i++) {
      for (const c of steps[i].cycles) {
        const before = steps[i - 1].cycles.find((x) => x.rowId === c.rowId)
        const r = steps[i].state.rows.find((x) => x.rowId === c.rowId)!
        if (before && r.originLap < steps[i].lap) expect(c.cycleId).toBe(before.cycleId)
        if (r.originLap === steps[i].lap) expect(c.cycleId).not.toBe(before?.cycleId)
      }
    }
  })
})

describe('stepRadioFold: straight and folded stretches', () => {
  it('fold 0 is always straight, and still drifts', () => {
    const steps = run('k3x9pq', 300, () => input(0))
    for (const s of steps) {
      expect(s.cycles).toEqual([])
      expect(s.stretch).toBe('straight')
    }
    expect(Object.keys(steps[10].drift).sort()).toEqual(['drums', 'hats', 'lead', 'pad', 'perc'])
  })

  it('stretches alternate, and a straight stretch empties the folds', () => {
    const steps = run('k3x9pq', 400, () => input(40))
    const kinds = steps.map((s) => s.stretch)
    const changes = kinds.filter((k, i) => i > 0 && k !== kinds[i - 1]).length
    expect(changes).toBeGreaterThanOrEqual(3)
    // somewhere inside a straight stretch, nothing is folded any more
    expect(steps.some((s, i) => i > 20 && s.stretch === 'straight' && s.cycles.length === 0)).toBe(
      true
    )
  })

  it('every straight stretch is heard straight: its laps are counted once the folds are gone', () => {
    for (const fold of [40, 90]) {
      const steps = run('k3x9pq', 600, () => input(fold))
      let runStart = -1
      for (let i = 0; i <= steps.length; i++) {
        const straight = i < steps.length && steps[i].stretch === 'straight'
        if (straight && runStart < 0) runStart = i
        if (!straight && runStart >= 0) {
          if (i < steps.length) {
            const run = steps.slice(runStart, i)
            expect(run.some((s) => s.cycles.length === 0)).toBe(true)
            // and it ends with nothing folded: the next folded stretch starts from straight
            expect(run[run.length - 1].cycles).toEqual([])
          }
          runStart = -1
        }
      }
    }
  })

  it('starts with a folded stretch when fold is above 0', () => {
    expect(run('k3x9pq', 1, () => input(40))[0].stretch).toBe('folded')
  })

  it('turning fold to 0 ends a folded stretch at once', () => {
    const steps = run('k3x9pq', 30, (w) => input(w < 10 ? 80 : 0))
    expect(steps[10].stretch).toBe('straight')
  })
})

describe('stepRadioFold: rows coming and going', () => {
  it('a folded row whose stem changes plays full length from that top', () => {
    const steps = run('k3x9pq', 60, () => input(40))
    const i = steps.findIndex((s) => s.cycles.length > 0)
    expect(i).toBeGreaterThanOrEqual(0)
    const folded = steps[i].cycles[0].rowId
    const changed = BAND.map((r) => (r.id === folded ? { ...r, stemId: 'another' } : r))
    const next = stepRadioFold(steps[i].state, input(40, changed))
    expect(next.cycles.map((c) => c.rowId)).not.toContain(folded)
  })

  it('a folded row that goes silent leaves the fold', () => {
    const steps = run('k3x9pq', 60, () => input(40))
    const i = steps.findIndex((s) => s.cycles.length > 0)
    const folded = steps[i].cycles[0].rowId
    const muted = BAND.map((r) => (r.id === folded ? { ...r, audible: false } : r))
    expect(
      stepRadioFold(steps[i].state, input(40, muted)).cycles.map((c) => c.rowId)
    ).not.toContain(folded)
  })
})

describe('realignment marks', () => {
  /** A state with one settled fold of `cycle` beats from lap 0, decided up to `lap`. */
  const settled = (cycle: number, loopBeats: number, lap: number): RadioFoldState => ({
    ...createRadioFold('k3x9pq'),
    lap,
    loopBeats,
    stretch: 'folded',
    stretchEndsLap: 1000,
    rows: [
      {
        rowId: 'perc',
        stemId: 'perc-stem',
        fullBeats: 8,
        targetBeats: cycle,
        cycleBeats: cycle,
        phaseBeats: 0,
        originLap: 0,
        path: [],
        mode: 'settled',
        unfoldSince: null,
        serial: 1
      }
    ]
  })

  it('7 against 16 realigns every 7 laps; 5 against 8 every 5; 3.5 against 16 every 7', () => {
    // Lap 0 is decided, so lap -1 is playing: lap L's top is (L + 1) loops from its top.
    expect(radioFoldMarkedBarsAhead(settled(7, 16, 0), 4, 14)).toEqual([8 * 4, 15 * 4])
    expect(radioFoldMarkedBarsAhead(settled(5, 8, 0), 2, 10)).toEqual([6 * 2, 11 * 2])
    expect(radioFoldMarkedBarsAhead(settled(3.5, 16, 0), 4, 14)).toEqual([8 * 4, 15 * 4])
  })

  it('a step marks the realignment top it decides', () => {
    const s = settled(7, 16, 6)
    const step = stepRadioFold(s, input(40))
    expect(step.lap).toBe(7)
    expect(step.marked).toBe(true)
    expect(stepRadioFold(settled(7, 16, 5), input(40)).marked).toBe(false)
  })

  it("a change's interval moves to a realignment top within two laps, never earlier", () => {
    const s = settled(7, 16, 0) // marks at 32 and 60 bars
    expect(radioFoldIntervalBars(s, 24, 4)).toBe(32)
    expect(radioFoldIntervalBars(s, 32, 4)).toBe(32)
    expect(radioFoldIntervalBars(s, 16, 4)).toBe(16) // 32 is four laps past 16
    expect(radioFoldIntervalBars(null, 24, 4)).toBe(24)
  })

  it('a phrase end on a realignment top rolls at often; off stays off', () => {
    expect(radioFoldTurnaroundRate('rare', true)).toBe('often')
    expect(radioFoldTurnaroundRate('rare', false)).toBe('rare')
    expect(radioFoldTurnaroundRate('off', true)).toBe('off')
  })
})

describe('drift', () => {
  it('moves slowly inside its ranges, from rest, and never closes the filter', () => {
    const steps = run('k3x9pq', 200, () => input(40))
    expect(steps[0].drift.perc.cutoff[0]).toBe(FOLD_DRIFT_RANGE.cutoff.rest)
    for (const s of steps) {
      for (const d of Object.values(s.drift)) {
        for (const p of ['cutoff', 'send', 'dub'] as const) {
          const [a, b] = d[p]
          expect(Math.min(a, b)).toBeGreaterThanOrEqual(
            Math.min(FOLD_DRIFT_RANGE[p].min, FOLD_DRIFT_RANGE[p].rest) - 1e-12
          )
          expect(Math.max(a, b)).toBeLessThanOrEqual(FOLD_DRIFT_RANGE[p].max + 1e-12)
          // a sweep is 32 bars at the least: on a 4-bar loop, under a ninth of the range a lap
          expect(Math.abs(b - a)).toBeLessThanOrEqual(
            (FOLD_DRIFT_RANGE[p].max - FOLD_DRIFT_RANGE[p].min) / 8 + 1e-12
          )
        }
      }
    }
  })

  it('is continuous from lap to lap', () => {
    const steps = run('k3x9pq', 100, () => input(40))
    for (let i = 1; i < steps.length; i++) {
      for (const p of ['cutoff', 'send', 'dub'] as const) {
        expect(steps[i].drift.perc[p][0]).toBeCloseTo(steps[i - 1].drift.perc[p][1], 12)
      }
    }
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /Users/nickel/Claudecode/sssketch && npx vitest run src/shared/radioFoldStep.test.ts`
Expected: FAIL — `createRadioFold` (and the others) are not exported by `./radioFold`.

- [ ] **Step 3: Add the machine**

In `src/shared/radioFold.ts`:

After:

```ts
import type { DiscoverSlotKind } from './discoverSlotKind'
```

Insert:

```ts
import type { RadioTurnarounds } from './radioTurnaround'
```

After:

```ts
    const last = out.length > 0 ? out[out.length - 1] : fromBeats
    if (v !== last) out.push(v)
  }
  return out
}
```

Insert:

```ts

/** The parameters drift moves (spec section 1). `cutoff` is the row's own low-pass (1 open),
 * `send` an extra reverb send over the row's own, `dub` its send into the dub echo. */
export type FoldDriftParam = 'cutoff' | 'send' | 'dub'
export const FOLD_DRIFT_PARAMS: readonly FoldDriftParam[] = ['cutoff', 'send', 'dub']
/** Where drift may go, and where it rests. The cutoff never closes (0.62 is about 1.4 kHz). */
export const FOLD_DRIFT_RANGE: Readonly<
  Record<FoldDriftParam, { min: number; max: number; rest: number }>
> = Object.freeze({
  cutoff: { min: 0.62, max: 1, rest: 1 },
  send: { min: 0, max: 0.15, rest: 0 },
  dub: { min: 0, max: 0.18, rest: 0 }
})
/** One sweep's length, drawn (spec section 1). */
export const FOLD_DRIFT_SWEEP_BARS: Readonly<{ min: number; max: number }> = Object.freeze({
  min: 32,
  max: 128
})

interface FoldSweep {
  from: number
  to: number
  startLap: number
  laps: number
}
type RowDrift = Record<FoldDriftParam, FoldSweep>
/** A parameter's value at the start and at the end of the decided lap (a straight ramp). */
export type FoldDriftLap = Record<FoldDriftParam, readonly [number, number]>

export interface RadioFoldRowState {
  rowId: string
  stemId: string
  fullBeats: number
  targetBeats: number
  /** The cycle the row plays in the decided lap. */
  cycleBeats: number
  phaseBeats: number
  /** The lap whose top this cycle started on. */
  originLap: number
  /** Lengths still to step through, one per loop top, in order. */
  path: number[]
  mode: 'folding' | 'settled' | 'unfolding'
  /** The lap it was asked to unfold on (the stretch ended), or null. */
  unfoldSince: number | null
  serial: number
}

export interface RadioFoldState {
  seed: string
  /** Draws made so far: the counter every draw is seeded from. */
  draws: number
  /** The lap the last step decided; -1 before the first. */
  lap: number
  loopBeats: number
  stretch: 'straight' | 'folded'
  /** The lap the current stretch gives way on. */
  stretchEndsLap: number
  rows: RadioFoldRowState[]
  drift: Record<string, RowDrift>
  serial: number
  /** The decided lap's top is a realignment (radioFoldMarkedBarsAhead reads it). */
  marked: boolean
}

export function createRadioFold(seed: string): RadioFoldState {
  return {
    seed: normalizeFoldSeed(seed),
    draws: 0,
    lap: -1,
    loopBeats: 0,
    stretch: 'straight',
    stretchEndsLap: -1,
    rows: [],
    drift: {},
    serial: 0,
    marked: false
  }
}

export interface RadioFoldInput {
  /** In a stable order (the panel's slot order): new folds draw from it by index. */
  rows: readonly RadioFoldRow[]
  loopBars: number
  bpm: number
  /** The `fold` fader, 0..100. */
  fold: number
}

/** What one row plays in the decided lap. Absent from `cycles`: full length. */
export interface RadioFoldCycle {
  rowId: string
  /** The stem the fold was decided for: a runtime folds the row only while it plays this one. */
  stemId: string
  /** Changes whenever the cycle restarts; while unchanged the cycle runs on across tops. */
  cycleId: string
  cycleBeats: number
  phaseBeats: number
}

export interface RadioFoldStep {
  state: RadioFoldState
  /** The lap these decisions are for: the one starting at the NEXT loop top. */
  lap: number
  anchorId: string | null
  cycles: RadioFoldCycle[]
  /** That lap's top is a realignment: a settled fold lines up with the loop there. */
  marked: boolean
  stretch: 'straight' | 'folded'
  /** Every audible row's drift over that lap. */
  drift: Record<string, FoldDriftLap>
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

function stretchLaps(bars: number, loopBars: number): number {
  return Math.max(1, Math.round(bars / Math.max(loopBars, 1e-9)))
}

function cycleMenu(f: number): readonly number[] {
  return f < 0.5 ? [7, 9] : f < 0.75 ? [5, 7, 9] : FOLD_CYCLE_BEATS
}

function phaseMenu(f: number): readonly number[] {
  return f < 0.5 ? [0] : f < 0.75 ? [0, 0.25] : [0, 0.25, 1 / 3, 0.5]
}

function maxRows(f: number): number {
  return f >= 0.6 ? FOLD_MAX_ROWS : 1
}

/** The cycles `row` may fold to: the fader's menu, inside the allowed window, shorter than the
 * row. Empty means the row does not fold at this `fold` (a 1-bar row has no 7 or 9 below it). */
function foldTargets(row: RadioFoldRow, loopBeats: number, bpm: number, f: number): number[] {
  const full = row.barLength * 4
  const allowed = radioFoldAllowedCycles(loopBeats, bpm)
  return cycleMenu(f).filter((c) => c < full && allowed.includes(c))
}

/** Whether a row's cycle lines up with the loop at the top of `lap`. */
function realignsAt(r: RadioFoldRowState, lap: number, loopBeats: number): boolean {
  if (lap <= r.originLap) return false
  return ((lap - r.originLap) * halves(loopBeats)) % halves(r.cycleBeats) === 0
}

function pickFrom<T>(items: readonly T[], r: number): T {
  return items[Math.min(items.length - 1, Math.floor(r * items.length))]
}

function restingDrift(lap: number): RowDrift {
  const rest = (p: FoldDriftParam): FoldSweep => ({
    from: FOLD_DRIFT_RANGE[p].rest,
    to: FOLD_DRIFT_RANGE[p].rest,
    startLap: lap,
    laps: 0
  })
  return { cutoff: rest('cutoff'), send: rest('send'), dub: rest('dub') }
}

function sweepAt(sw: FoldSweep, lap: number): readonly [number, number] {
  const at = (l: number): number =>
    sw.laps <= 0
      ? sw.to
      : lerp(sw.from, sw.to, Math.min(1, Math.max(0, (l - sw.startLap) / sw.laps)))
  return [at(lap), at(lap + 1)]
}

/** One loop top: decides the NEXT lap (see the top of this file). Pure: `prev` is untouched. */
export function stepRadioFold(prev: RadioFoldState, input: RadioFoldInput): RadioFoldStep {
  const s: RadioFoldState = {
    ...prev,
    rows: prev.rows.map((r) => ({ ...r, path: [...r.path] })),
    drift: { ...prev.drift }
  }
  const draw = (): number => seededRandom(`${s.seed}#${s.draws++}`)()
  const lap = s.lap + 1
  s.lap = lap
  const f = normalizeFoldAmount(input.fold, DEFAULT_RADIO_FOLD) / 100
  const loopBeats = input.loopBars * 4
  const loopChanged = prev.lap >= 0 && s.loopBeats !== loopBeats
  s.loopBeats = loopBeats
  const anchorId = radioFoldAnchor(input.rows)
  const byId = new Map(input.rows.map((r) => [r.id, r]))
  const restart = (r: RadioFoldRowState): void => {
    r.originLap = lap
    r.serial = ++s.serial
  }

  // 1. Rows already folded keep their fold only while they still may and still play the stem it
  //    was decided for; a changed stem leaves the fold (the new layer arrives straight). A changed
  //    loop restarts every cycle at this top, since the realignment arithmetic has changed.
  //    A row that leaves here does not start a new fold on the same top.
  const left = new Set<string>()
  s.rows = s.rows.filter((r) => {
    const row = byId.get(r.rowId)
    const keep = row !== undefined && row.stemId === r.stemId && radioFoldCanFold(row, anchorId)
    if (!keep) left.add(r.rowId)
    return keep
  })
  if (loopChanged) for (const r of s.rows) restart(r)
  const marked = s.rows.some((r) => r.mode === 'settled' && realignsAt(r, lap, loopBeats))

  // 2. Stretches. `fold` 0 ends a folded stretch at once and keeps it straight. A straight
  //    stretch only counts its laps once every fold has walked back: it is meant to be heard.
  if (f === 0 && s.stretch === 'folded') s.stretchEndsLap = lap
  if (s.stretch === 'straight' && s.rows.length > 0) s.stretchEndsLap += 1
  if (lap >= s.stretchEndsLap) {
    if (s.stretch === 'folded' || f === 0) {
      s.stretch = 'straight'
      const bars =
        lerp(FOLD_STRAIGHT_STRETCH_BARS.atNone, FOLD_STRAIGHT_STRETCH_BARS.atFull, f) *
        (0.75 + 0.5 * draw())
      s.stretchEndsLap = lap + stretchLaps(bars, input.loopBars)
      for (const r of s.rows) if (r.unfoldSince === null) r.unfoldSince = lap
    } else {
      s.stretch = 'folded'
      const bars =
        lerp(FOLD_FOLDED_STRETCH_BARS.atNone, FOLD_FOLDED_STRETCH_BARS.atFull, f) *
        (0.75 + 0.5 * draw())
      s.stretchEndsLap = lap + stretchLaps(bars, input.loopBars)
    }
  }

  // 3. Unfolding starts: at once while still folding, else on the row's own realignment top (or
  //    after FOLD_UNFOLD_MAX_WAIT_LAPS), walking back the way it came, in 2 to 4 steps.
  for (const r of s.rows) {
    if (r.unfoldSince === null || r.mode === 'unfolding') continue
    const due =
      r.mode === 'folding' ||
      realignsAt(r, lap, loopBeats) ||
      lap - r.unfoldSince >= FOLD_UNFOLD_MAX_WAIT_LAPS
    if (!due) continue
    r.mode = 'unfolding'
    r.targetBeats = r.fullBeats
    r.path = radioFoldPath(r.cycleBeats, r.fullBeats, 2 + Math.floor(draw() * 3))
    r.cycleBeats = r.path.shift() ?? r.fullBeats
    restart(r)
  }

  // 4. Curves step on, one length per loop top. A fold that reaches its target settles.
  for (const r of s.rows) {
    if (r.mode === 'settled' || r.originLap === lap) continue
    const next = r.path.shift()
    if (next === undefined) {
      if (r.mode === 'folding') r.mode = 'settled'
      continue
    }
    r.cycleBeats = next
    restart(r)
    if (r.path.length === 0 && r.mode === 'folding') r.mode = 'settled'
  }
  s.rows = s.rows.filter((r) => r.cycleBeats < r.fullBeats)

  // 5. New folds, only in a folded stretch: one at once when none is folding, a second (high
  //    `fold` only) on a realignment top, half the time.
  if (s.stretch === 'folded' && f > 0) {
    const active = s.rows.filter((r) => r.unfoldSince === null).length
    const may = active === 0 || (active < maxRows(f) && marked && draw() < 0.5)
    if (may) {
      const taken = new Set(s.rows.map((r) => r.rowId))
      const candidates = input.rows.filter(
        (row) =>
          !taken.has(row.id) &&
          !left.has(row.id) &&
          radioFoldCanFold(row, anchorId) &&
          foldTargets(row, loopBeats, input.bpm, f).length > 0
      )
      if (candidates.length > 0) {
        const row = pickFrom(candidates, draw())
        const target = pickFrom(foldTargets(row, loopBeats, input.bpm, f), draw())
        const phase = pickFrom(phaseMenu(f), draw())
        const full = row.barLength * 4
        const path = radioFoldPath(full, target, 2 + Math.floor(draw() * 3))
        const first = path.shift() ?? target
        s.rows.push({
          rowId: row.id,
          stemId: row.stemId!,
          fullBeats: full,
          targetBeats: target,
          cycleBeats: first,
          phaseBeats: phase,
          originLap: lap,
          path,
          mode: path.length === 0 ? 'settled' : 'folding',
          unfoldSince: null,
          serial: ++s.serial
        })
      }
    }
  }

  // 6. Drift: every audible row, by id so the draws do not depend on the rows' order.
  const drift: Record<string, FoldDriftLap> = {}
  const nextDrift: Record<string, RowDrift> = {}
  const audible = input.rows
    .filter((r) => r.audible)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  for (const row of audible) {
    const d: RowDrift = { ...(s.drift[row.id] ?? restingDrift(lap)) }
    for (const p of FOLD_DRIFT_PARAMS) {
      if (lap >= d[p].startLap + d[p].laps) {
        const range = FOLD_DRIFT_RANGE[p]
        const bars = lerp(FOLD_DRIFT_SWEEP_BARS.min, FOLD_DRIFT_SWEEP_BARS.max, draw())
        d[p] = {
          from: d[p].to,
          to: lerp(range.min, range.max, draw()),
          startLap: lap,
          laps: stretchLaps(bars, input.loopBars)
        }
      }
    }
    nextDrift[row.id] = d
    drift[row.id] = {
      cutoff: sweepAt(d.cutoff, lap),
      send: sweepAt(d.send, lap),
      dub: sweepAt(d.dub, lap)
    }
  }
  s.drift = nextDrift
  s.marked = marked

  return {
    state: s,
    lap,
    anchorId,
    cycles: s.rows.map((r) => ({
      rowId: r.rowId,
      stemId: r.stemId,
      cycleId: `${r.rowId}~${r.serial}`,
      cycleBeats: r.cycleBeats,
      phaseBeats: r.phaseBeats
    })),
    marked,
    stretch: s.stretch,
    drift
  }
}

/** The tops ahead that are realignments if nothing changes, in bars from the top of the lap
 * playing now (the one before the decided lap): the decided lap's own top is `loopBars`. */
export function radioFoldMarkedBarsAhead(
  state: RadioFoldState,
  loopBars: number,
  horizonLaps: number
): number[] {
  const out: number[] = []
  if (state.lap < 0) return out
  if (state.marked) out.push(loopBars)
  const loopBeats = loopBars * 4
  for (let k = 1; k <= horizonLaps; k++) {
    const lap = state.lap + k
    if (
      state.rows.some(
        (r) => r.mode === 'settled' && r.unfoldSince === null && realignsAt(r, lap, loopBeats)
      )
    ) {
      out.push((k + 1) * loopBars)
    }
  }
  return out
}

/** A change's interval under the mode: the drawn bars, moved later to a realignment top when one
 * comes within FOLD_PREFER_WAIT_LAPS laps of it (spec section 1: the next change prefers it). */
export function radioFoldIntervalBars(
  state: RadioFoldState | null,
  drawnBars: number,
  loopBars: number
): number {
  if (state === null || !(loopBars > 0)) return drawnBars
  const limit = drawnBars + FOLD_PREFER_WAIT_LAPS * loopBars
  const horizon = Math.ceil(limit / loopBars)
  let best: number | null = null
  for (const m of radioFoldMarkedBarsAhead(state, loopBars, horizon)) {
    if (m >= drawnBars && m <= limit && (best === null || m < best)) best = m
  }
  return best ?? drawnBars
}

/** A phrase end that is also a realignment top rolls its turnaround at `often`'s chance (spec
 * section 1: the next turnaround prefers it); `off` stays off. */
export function radioFoldTurnaroundRate(
  rate: RadioTurnarounds,
  markedTop: boolean
): RadioTurnarounds {
  return markedTop && rate !== 'off' ? 'often' : rate
}
```

- [ ] **Step 4: Run both test files, lint, and typecheck both repos**

```bash
cd /Users/nickel/Claudecode/sssketch && npx vitest run src/shared/radioFold.test.ts src/shared/radioFoldStep.test.ts && npx prettier --write src/shared/radioFold.ts src/shared/radioFoldStep.test.ts && npx eslint src/shared/radioFold.ts src/shared/radioFoldStep.test.ts && npm run typecheck
cd /Users/nickel/Claudecode/ell.ing/radio && npm run typecheck
```

Expected: 38 tests pass (14 + 24); clean.

- [ ] **Step 5: Commit**

```bash
cd /Users/nickel/Claudecode/sssketch
git add src/shared/radioFold.ts src/shared/radioFoldStep.test.ts
git commit -m "$(cat <<'EOF'
radio fold: the seeded machine -- a lap ahead, straight and folded stretches, curves on the tops, realignment marks, drift

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz
EOF
)"
```

## Task 4: `RadioSettings` gets fold mode, with defaults (sssketch and ell.ing/radio)

`RadioSettings` gains four required fields, so the web radio's `WEB_RADIO_DEFAULTS` literal must gain them in the same task or its typecheck fails.

**Files:**
- Modify: `src/shared/radioSchedule.ts`, `src/shared/radioSchedule.test.ts`, `src/main/discoverSettingsStore.test.ts`
- Create: `src/shared/radioFoldSettings.test.ts`
- Modify (ell.ing/radio): `src/radio/settings.ts`, `src/radio/settings.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/shared/radioFoldSettings.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RADIO_SETTINGS,
  RADIO_PACE_BARS,
  normalizeRadioSettings,
  radioPaceWindowOf
} from './radioSchedule'

describe('RadioSettings fold fields', () => {
  it('default to off, fold 40, clash 25 and the default seed', () => {
    expect(DEFAULT_RADIO_SETTINGS.foldMode).toBe(false)
    expect(DEFAULT_RADIO_SETTINGS.fold).toBe(40)
    expect(DEFAULT_RADIO_SETTINGS.clash).toBe(25)
    expect(DEFAULT_RADIO_SETTINGS.foldSeed).toBe('autech')
  })

  it('a settings file from before fold mode gets the defaults', () => {
    const s = normalizeRadioSettings({ pace: 'fast' })
    expect(s.foldMode).toBe(false)
    expect(s.fold).toBe(40)
    expect(s.clash).toBe(25)
    expect(s.foldSeed).toBe('autech')
  })

  it('normalises: only true is on, faders clamp, a seed is cleaned', () => {
    const s = normalizeRadioSettings({ foldMode: 'yes', fold: 130, clash: -5, foldSeed: 'K3X9PQ' })
    expect(s.foldMode).toBe(false)
    expect(s.fold).toBe(100)
    expect(s.clash).toBe(0)
    expect(s.foldSeed).toBe('k3x9pq')
    expect(normalizeRadioSettings({ foldMode: true }).foldMode).toBe(true)
  })

  it('fold mode replaces the pace window with 16-64 bars, and gives the pace window back off', () => {
    const on = normalizeRadioSettings({ pace: 'fast', foldMode: true })
    expect(radioPaceWindowOf(on)).toEqual({ min: 16, max: 64 })
    expect(on.paceBars).toEqual(RADIO_PACE_BARS.fast)
    expect(radioPaceWindowOf({ ...on, foldMode: false })).toEqual(RADIO_PACE_BARS.fast)
  })
})
```

In `src/shared/radioSchedule.test.ts`:

After:

```ts
      turnaroundMoves: ['drops', 'wash', 'filters', 'riser'],
      turnaroundDepth: 'bold',
      turnover: 'even',
```

Insert:

```ts
      foldMode: false,
      fold: 40,
      clash: 25,
      foldSeed: 'autech',
```

In `src/main/discoverSettingsStore.test.ts`:

After:

```ts
        turnaroundDepth: 'subtle',
        turnover: 'random',
```

Insert:

```ts
        foldMode: true,
        fold: 70,
        clash: 60,
        foldSeed: 'k3x9pq',
```

After:

```ts
      turnaroundDepth: 'subtle',
      turnover: 'random',
```

Insert:

```ts
      foldMode: true,
      fold: 70,
      clash: 60,
      foldSeed: 'k3x9pq',
```

In ell.ing/radio `src/radio/settings.test.ts`:

After:

```ts
      turnover: 'even', // no row in the menu: sssketch's default
```

Insert:

```ts
      foldMode: false, // fold mode: off until the listener turns it on (full mode)
      fold: 40, // the spec's default
      clash: 25, // the spec's default
      foldSeed: 'autech', // DEFAULT_FOLD_SEED
```

- [ ] **Step 2: Run them to see them fail**

```bash
cd /Users/nickel/Claudecode/sssketch && npx vitest run src/shared/radioFoldSettings.test.ts src/shared/radioSchedule.test.ts
```

Expected: FAIL — `radioPaceWindowOf` is not exported, and the defaults have no `foldMode`.

- [ ] **Step 3: Add the fields**

In `src/shared/radioSchedule.ts`:

After:

```ts
  type TurnaroundFamily
} from './radioTurnaround'
```

Insert:

```ts
import {
  DEFAULT_FOLD_SEED,
  DEFAULT_RADIO_CLASH,
  DEFAULT_RADIO_FOLD,
  FOLD_PACE_BARS,
  normalizeFoldAmount,
  normalizeFoldSeed
} from './radioFold'
```

After:

```ts
  turnaroundDepth: TurnaroundDepth
  turnover: RadioTurnover
```

Insert:

```ts
  /** Fold mode (radioFold.ts, spec 2026-10-02-radio-fold-mode-design.md): off by default, and
   * normal radio is untouched while it is off. */
  foldMode: boolean
  /** "how folded", 0..100 (DEFAULT_RADIO_FOLD 40). */
  fold: number
  /** "how mismatched", 0..100 (DEFAULT_RADIO_CLASH 25). */
  clash: number
  /** Six characters of FOLD_SEED_ALPHABET: the same seed replays the same rules. */
  foldSeed: string
```

Find:

```ts
  turnover: DEFAULT_RADIO_TURNOVER,
  density: DEFAULT_RADIO_DENSITY
```

Replace with:

```ts
  turnover: DEFAULT_RADIO_TURNOVER,
  foldMode: false,
  fold: DEFAULT_RADIO_FOLD,
  clash: DEFAULT_RADIO_CLASH,
  foldSeed: DEFAULT_FOLD_SEED,
  density: DEFAULT_RADIO_DENSITY
}

/** The window the clock draws a change's interval from: fold mode's own (FOLD_PACE_BARS, 16-64
 * bars) while it is on, the user's pace window otherwise -- which comes back untouched when the
 * mode goes off, since this never writes it. */
export function radioPaceWindowOf(settings: RadioSettings): RadioPaceWindow {
  return settings.foldMode ? { ...FOLD_PACE_BARS } : settings.paceBars
```

After:

```ts
    turnover: normalizeRadioTurnover(raw.turnover),
```

Insert:

```ts
    foldMode: raw.foldMode === true,
    fold: normalizeFoldAmount(raw.fold, DEFAULT_RADIO_FOLD),
    clash: normalizeFoldAmount(raw.clash, DEFAULT_RADIO_CLASH),
    foldSeed: normalizeFoldSeed(raw.foldSeed),
```

In ell.ing/radio `src/radio/settings.ts`:

After:

```ts
import { TURNAROUND_FAMILIES } from '@shared/radioTurnaround'
```

Insert:

```ts
import { DEFAULT_FOLD_SEED, DEFAULT_RADIO_CLASH, DEFAULT_RADIO_FOLD } from '@shared/radioFold'
```

After:

```ts
  transitions: 'bold',
  turnover: DEFAULT_RADIO_TURNOVER,
```

Insert:

```ts
  // fold mode (@shared/radioFold): off until the listener turns it on (full mode, radio.fold)
  foldMode: false,
  fold: DEFAULT_RADIO_FOLD,
  clash: DEFAULT_RADIO_CLASH,
  foldSeed: DEFAULT_FOLD_SEED,
```

- [ ] **Step 4: Run, lint, typecheck both repos**

```bash
cd /Users/nickel/Claudecode/sssketch && npx vitest run src/shared/radioFoldSettings.test.ts src/shared/radioSchedule.test.ts src/shared/radioTurnaroundSettings.test.ts src/main/discoverSettingsStore.test.ts && npx prettier --write src/shared/radioSchedule.ts src/shared/radioSchedule.test.ts src/shared/radioFoldSettings.test.ts src/main/discoverSettingsStore.test.ts && npx eslint src/shared/radioSchedule.ts src/shared/radioSchedule.test.ts src/shared/radioFoldSettings.test.ts src/main/discoverSettingsStore.test.ts && npm run typecheck
cd /Users/nickel/Claudecode/ell.ing/radio && npm run typecheck && npx vitest run src/radio/settings.test.ts && npm test
```

Expected: all pass; clean.

- [ ] **Step 5: Commit both repos**

```bash
cd /Users/nickel/Claudecode/sssketch
git add src/shared/radioSchedule.ts src/shared/radioSchedule.test.ts src/shared/radioFoldSettings.test.ts src/main/discoverSettingsStore.test.ts
git commit -m "$(cat <<'EOF'
radio fold: RadioSettings gets foldMode, fold, clash and foldSeed (off, 40, 25, autech); fold mode's pace window

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz
EOF
)"
cd /Users/nickel/Claudecode/ell.ing/radio
git add src/radio/settings.ts src/radio/settings.test.ts
git commit -m "$(cat <<'EOF'
radio: fold mode's settings in WEB_RADIO_DEFAULTS -- off until the listener turns it on

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz
EOF
)"
```

## Task 5: The clash in the shared ranking (sssketch, shared)

**Files:**
- Create: `src/shared/radioClash.ts`
- Modify: `src/shared/discoverRanking.ts`
- Test: `src/shared/radioClash.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/shared/radioClash.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { rankCandidates } from './discoverRanking'
import type { DiscoverCandidate } from './discoverCandidate'
import {
  CLASH_LEAN_MAX,
  radioClashAmount,
  radioClashBed,
  radioClashBedScore,
  radioClashLean,
  radioClashLeaned,
  radioClashLowpassRow,
  radioClashTraitScore
} from './radioClash'

function candidate(overrides: Partial<DiscoverCandidate>): DiscoverCandidate {
  return {
    stemCID: 's1',
    jamCID: 'jam1',
    riffCID: 'r1',
    presetName: 'test',
    creatorUserName: 'elling',
    slotKinds: ['drums'],
    traitValues: {},
    traitPercentiles: {},
    kindSources: {},
    riffCreationTime: null,
    drumSubRole: null,
    riffBpm: 120,
    ...overrides
  }
}

describe('radioClash helpers', () => {
  it('the amount is 0..1, and 0 with the mode off', () => {
    expect(radioClashAmount(true, 25)).toBe(0.25)
    expect(radioClashAmount(true, 140)).toBe(1)
    expect(radioClashAmount(false, 80)).toBe(0)
  })

  it('the bed is the mean of the known percentiles per clash trait', () => {
    expect(radioClashBed([{ bright: 0.2, rhythmic: 0.9 }, { bright: 0.6 }, { warm: 0.5 }])).toEqual(
      {
        bright: 0.4,
        rhythmic: 0.9
      }
    )
    expect(radioClashBed([])).toEqual({})
  })

  it('turns a requested rhythmic or bright target round, and leaves bassHeavy and warm alone', () => {
    expect(radioClashTraitScore('bright', 0.9, 1)).toBeCloseTo(0.1)
    expect(radioClashTraitScore('rhythmic', 0.9, 0.5)).toBeCloseTo(0.5)
    expect(radioClashTraitScore('bassHeavy', 0.9, 1)).toBe(0.9)
    expect(radioClashTraitScore('warm', 0.9, 1)).toBe(0.9)
    expect(radioClashTraitScore('bright', 0.9, 0)).toBe(0.9)
  })

  it('rewards distance from the bed on rhythm and brightness only', () => {
    const clash = { amount: 1, bed: { bright: 0.2, rhythmic: 0.5 } }
    expect(radioClashBedScore({ bright: 0.9, rhythmic: 0.5, bassHeavy: 0.1 }, clash)).toBeCloseTo(
      0.7
    )
    expect(radioClashBedScore({ bassHeavy: 0.9, warm: 0.1 }, clash)).toBe(0)
    expect(radioClashBedScore({ bright: 0.9 }, { ...clash, amount: 0 })).toBe(0)
  })

  it('low-passes the brighter of the most mismatched pair, only past the gap', () => {
    expect(
      radioClashLowpassRow(
        [
          { id: 'a', bright: 0.2 },
          { id: 'b', bright: 0.9 },
          { id: 'c', bright: null }
        ],
        0.5
      )
    ).toBe('b')
    expect(
      radioClashLowpassRow(
        [
          { id: 'a', bright: 0.5 },
          { id: 'b', bright: 0.7 }
        ],
        1
      )
    ).toBeNull()
    expect(
      radioClashLowpassRow(
        [
          { id: 'a', bright: 0.1 },
          { id: 'b', bright: 0.9 }
        ],
        0
      )
    ).toBeNull()
  })

  it('leans the master in only above 50, by at most 0.15, never past 1', () => {
    expect(radioClashLean(true, 50)).toBe(0)
    expect(radioClashLean(true, 75)).toBeCloseTo(CLASH_LEAN_MAX / 2)
    expect(radioClashLean(true, 100)).toBeCloseTo(CLASH_LEAN_MAX)
    expect(radioClashLean(false, 100)).toBe(0)
    expect(radioClashLeaned(0.5, 0.15)).toBeCloseTo(0.65)
    expect(radioClashLeaned(0.95, 0.15)).toBe(1)
  })
})

describe('rankCandidates with a clash', () => {
  const bed = { bright: 0.2, rhythmic: 0.3 }

  it('no clash ranks exactly as before', () => {
    const pool = [
      candidate({ stemCID: 'a', traitPercentiles: { bright: 0.9 } }),
      candidate({ stemCID: 'b', traitPercentiles: { bright: 0.3 } })
    ]
    const plain = rankCandidates(pool, { targetBpm: 120, targetTraits: ['bright'] })
    const zero = rankCandidates(pool, {
      targetBpm: 120,
      targetTraits: ['bright'],
      clash: { amount: 0, bed }
    })
    expect(zero).toEqual(plain)
  })

  it('a clash prefers the stem furthest from the bed on brightness and rhythm', () => {
    const near = candidate({ stemCID: 'near', traitPercentiles: { bright: 0.25, rhythmic: 0.3 } })
    const far = candidate({ stemCID: 'far', traitPercentiles: { bright: 0.95, rhythmic: 0.9 } })
    expect(rankCandidates([far, near], { targetBpm: 120 })[0].score).toBe(
      rankCandidates([far, near], { targetBpm: 120 })[1].score
    )
    const ranked = rankCandidates([near, far], { targetBpm: 120, clash: { amount: 0.8, bed } })
    expect(ranked[0].candidate.stemCID).toBe('far')
  })

  it('bass energy and warmth stay matched: a clash does not move them', () => {
    const heavy = candidate({ stemCID: 'heavy', traitPercentiles: { bassHeavy: 0.9 } })
    const light = candidate({ stemCID: 'light', traitPercentiles: { bassHeavy: 0.2 } })
    const ranked = rankCandidates([light, heavy], {
      targetBpm: 120,
      targetTraits: ['bassHeavy'],
      clash: { amount: 1, bed }
    })
    expect(ranked[0].candidate.stemCID).toBe('heavy')
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /Users/nickel/Claudecode/sssketch && npx vitest run src/shared/radioClash.test.ts`
Expected: FAIL — `Failed to resolve import "./radioClash"`.

- [ ] **Step 3: Write the module and wire it into `rankCandidates`**

Create `src/shared/radioClash.ts`:

```ts
// src/shared/radioClash.ts
//
// Fold mode's `clash` fader (docs/superpowers/specs/2026-10-02-radio-fold-mode-design.md, section
// 2): how mismatched the picks are. The clash lives in TIME and TIMBRE -- rhythmic strength and
// brightness -- and never in key: with no pitch control a key clash reads as a mistake, so bass
// energy and harmonic content (bassHeavy, warm) are left exactly as the picker always ranks them.
// The pair a clash makes is then held together by shared processing: a static low-pass on the
// brighter of the two, and, above 50, a little more master glue and saturation.
//
// Pure, shared by both radios' pickers (discoverRanking's rankCandidates) and their mixes.

import type { TraitPercentiles } from './traitQuantiles'

/** The traits a clash turns round. */
export type ClashTrait = 'rhythmic' | 'bright'
export const CLASH_TRAITS: readonly ClashTrait[] = ['rhythmic', 'bright']
/** Weight of the distance-from-the-bed term, per trait, at a full clash: as much as one trait
 * term, so a mismatch can outrank a close tempo but not a favourite (rankCandidates). */
export const CLASH_BED_WEIGHT = 1
/** The static low-pass on the brighter of a clashing pair (the toolkit's 0..1 cutoff; 0.5 is
 * about 630 Hz). */
export const CLASH_LOWPASS_CUTOFF = 0.5
/** Two rows clash when their brightness percentiles are at least this far apart. */
export const CLASH_PAIR_MIN_GAP = 0.4
/** The most the master glue and saturation lean in, over the listener's own amounts. */
export const CLASH_LEAN_MAX = 0.15

/** What rankCandidates needs: how much (0..1), and the bed's mean percentile per clash trait. */
export interface RankClash {
  amount: number
  bed: Partial<Record<ClashTrait, number>>
}

/** The clash as rankCandidates takes it: 0..1 while fold mode is on, 0 otherwise. */
export function radioClashAmount(foldMode: boolean, clash: number): number {
  if (!foldMode || !Number.isFinite(clash)) return 0
  return Math.min(1, Math.max(0, clash / 100))
}

/** The bed: the mean percentile of each clash trait over the rows playing (those that have one). */
export function radioClashBed(
  rows: readonly TraitPercentiles[]
): Partial<Record<ClashTrait, number>> {
  const out: Partial<Record<ClashTrait, number>> = {}
  for (const trait of CLASH_TRAITS) {
    const values = rows
      .map((r) => r[trait])
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    if (values.length > 0) out[trait] = values.reduce((a, b) => a + b, 0) / values.length
  }
  return out
}

/** A requested trait's term under the clash: a clash trait turns toward its other end
 * ((1 - a) * t + a * (1 - t)); every other trait is untouched. At amount 0 this is `t`. */
export function radioClashTraitScore(kind: string, t: number, amount: number): number {
  if (!(amount > 0) || !CLASH_TRAITS.includes(kind as ClashTrait)) return t
  return (1 - amount) * t + amount * (1 - t)
}

/** The mismatch term: how far a candidate sits from the bed on each clash trait both know,
 * times the amount. 0 at amount 0, with no bed, or with no percentiles. */
export function radioClashBedScore(percentiles: TraitPercentiles, clash: RankClash): number {
  if (!(clash.amount > 0)) return 0
  let score = 0
  for (const trait of CLASH_TRAITS) {
    const p = percentiles[trait]
    const b = clash.bed[trait]
    if (typeof p === 'number' && Number.isFinite(p) && typeof b === 'number') {
      score += Math.abs(p - b)
    }
  }
  return clash.amount * CLASH_BED_WEIGHT * score
}

/** The row that takes the clash low-pass: the brighter of the most mismatched pair, when they are
 * at least CLASH_PAIR_MIN_GAP apart and the clash is on. One row at most. */
export function radioClashLowpassRow(
  rows: readonly { id: string; bright: number | null | undefined }[],
  amount: number
): string | null {
  if (!(amount > 0)) return null
  const known = rows.filter(
    (r): r is { id: string; bright: number } =>
      typeof r.bright === 'number' && Number.isFinite(r.bright)
  )
  if (known.length < 2) return null
  let lo = known[0]
  let hi = known[0]
  for (const r of known) {
    if (r.bright < lo.bright) lo = r
    if (r.bright > hi.bright) hi = r
  }
  return hi.bright - lo.bright >= CLASH_PAIR_MIN_GAP ? hi.id : null
}

/** How far the master glue and saturation lean in: nothing up to `clash` 50, then up to
 * CLASH_LEAN_MAX at 100. Nothing while the mode is off. */
export function radioClashLean(foldMode: boolean, clash: number): number {
  if (!foldMode || !(clash > 50)) return 0
  return (CLASH_LEAN_MAX * (Math.min(100, clash) - 50)) / 50
}

/** A listener amount (0..1) with the lean on top, never past 1. */
export function radioClashLeaned(own: number, lean: number): number {
  return Math.min(1, own + Math.max(0, lean))
}
```

In `src/shared/discoverRanking.ts`:

After:

```ts
import type { DiscoverTraitKind } from './discoverSlotKind'
```

Insert:

```ts
import { radioClashBedScore, radioClashTraitScore, type RankClash } from './radioClash'
```

Find:

```ts
    favouriteStemCIDs,
    favouriteWeight,
    targetTraits = []
```

Replace with:

```ts
    favouriteStemCIDs,
    favouriteWeight,
    targetTraits = [],
    clash
```

After:

```ts
    targetTraits?: readonly DiscoverTraitKind[]
```

Insert:

```ts
    /** Radio fold mode's `clash` (@shared/radioClash): a requested rhythmic or bright trait
     * turns toward its other end, and distance from the bed on those two traits scores. Absent
     * or amount 0: exactly the ranking without it. */
    clash?: RankClash
```

Find:

```ts
                ranges.get(kind)
              )
        score += trait * TRAIT_SCORE_WEIGHT
      }
```

Replace with:

```ts
                ranges.get(kind)
              )
        score += radioClashTraitScore(kind, trait, clash?.amount ?? 0) * TRAIT_SCORE_WEIGHT
      }
      if (clash) score += radioClashBedScore(candidate.traitPercentiles ?? {}, clash)
```

- [ ] **Step 4: Run, lint, typecheck both repos**

```bash
cd /Users/nickel/Claudecode/sssketch && npx vitest run src/shared/radioClash.test.ts src/shared/discoverRanking.test.ts && npx prettier --write src/shared/radioClash.ts src/shared/radioClash.test.ts src/shared/discoverRanking.ts && npx eslint src/shared/radioClash.ts src/shared/radioClash.test.ts src/shared/discoverRanking.ts && npm run typecheck
cd /Users/nickel/Claudecode/ell.ing/radio && npm run typecheck && npx vitest run src/radio/pick.test.ts
```

Expected: pass; clean. (`discoverRanking.test.ts` is untouched and still passes: no clash ranks exactly as before.)

- [ ] **Step 5: Commit**

```bash
cd /Users/nickel/Claudecode/sssketch
git add src/shared/radioClash.ts src/shared/radioClash.test.ts src/shared/discoverRanking.ts
git commit -m "$(cat <<'EOF'
radio fold: the clash -- rhythm and brightness turned round and measured against the bed, bass and warmth left matched

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz
EOF
)"
```

## Task 6: A step as a runtime needs it (sssketch, shared)

**Files:**
- Create: `src/shared/radioFoldLanes.ts`
- Test: `src/shared/radioFoldLanes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/shared/radioFoldLanes.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createRadioFold, stepRadioFold, type RadioFoldStep } from './radioFold'
import {
  radioFoldCycleRows,
  radioFoldDriftCurves,
  radioFoldEngineRows,
  radioFoldSound
} from './radioFoldLanes'
import { normalizeSoundSettings } from './radioSound'

const step = (cycles: RadioFoldStep['cycles']): RadioFoldStep => ({
  ...stepRadioFold(createRadioFold('k3x9pq'), { rows: [], loopBars: 4, bpm: 120, fold: 0 }),
  cycles
})
const perc = { rowId: 'perc', stemId: 'p1', cycleId: 'perc~3', cycleBeats: 7, phaseBeats: 0.25 }

describe('radioFoldEngineRows', () => {
  it('turns beats into bars, row and cycle ids kept', () => {
    expect(radioFoldEngineRows(step([perc]))).toEqual([
      { row: 'perc', id: 'perc~3', bars: 1.75, phaseBars: 0.0625 }
    ])
    expect(radioFoldEngineRows(null)).toEqual([])
  })
})

describe('radioFoldCycleRows', () => {
  it('names a row only while it plays the stem its fold was decided for', () => {
    const members = [
      { id: 'perc', stemId: 'p1' },
      { id: 'hats', stemId: 'h1' }
    ]
    expect([...radioFoldCycleRows([step([perc])], members)]).toEqual(['perc'])
    expect([...radioFoldCycleRows([step([perc])], [{ id: 'perc', stemId: 'p2' }])]).toEqual([])
    expect([...radioFoldCycleRows([null, step([perc])], members)]).toEqual(['perc'])
  })

  it('never names a row whose stem a staged swap is replacing', () => {
    expect([
      ...radioFoldCycleRows([step([perc])], [{ id: 'perc', stemId: 'p1' }], new Set(['perc']))
    ]).toEqual([])
  })
})

describe('radioFoldDriftCurves', () => {
  it("ramps each parameter across the lap; the send sits on the row's own, never past 1", () => {
    const c = radioFoldDriftCurves({ cutoff: [1, 0.9], send: [0, 0.1], dub: [0.05, 0.1] }, 4, 0.95)
    expect(c.cutoff).toEqual([
      { bar: 0, value: 1 },
      { bar: 4, value: 0.9 }
    ])
    expect(c.send).toEqual([
      { bar: 0, value: 0.95 },
      { bar: 4, value: 1 }
    ])
    expect(c.dub[1]).toEqual({ bar: 4, value: 0.1 })
  })
})

describe('radioFoldSound', () => {
  it('leans glue and saturation in above clash 50, mode on only', () => {
    const s = normalizeSoundSettings(undefined)
    expect(radioFoldSound(s, true, 40)).toBe(s)
    expect(radioFoldSound(s, false, 100)).toBe(s)
    const leaned = radioFoldSound(s, true, 100)
    expect(leaned.glue.amount).toBeCloseTo(s.glue.amount + 0.15)
    expect(leaned.saturation.amount).toBeCloseTo(s.saturation.amount + 0.15)
    expect(leaned.glue.on).toBe(s.glue.on)
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /Users/nickel/Claudecode/sssketch && npx vitest run src/shared/radioFoldLanes.test.ts`
Expected: FAIL — `Failed to resolve import "./radioFoldLanes"`.

- [ ] **Step 3: Write the module**

Create `src/shared/radioFoldLanes.ts`:

```ts
// src/shared/radioFoldLanes.ts
//
// What a runtime does with a fold step (@shared/radioFold) besides the cycles themselves: the
// engine's cycle rows, which rows' stems name their row, the drift as lane curves over one lap,
// the echo a drift's dub send opens into, and the clash's lean on the master. Pure, and shared by
// sssketch's Discover panel and the web radio, so the two cannot read a step differently.

import type { AutomationPoint } from './toolkit'
import type { RadioFoldStep, FoldDriftLap } from './radioFold'
import { radioClashLean, radioClashLeaned } from './radioClash'
import type { SoundSettings } from './radioSound'
import type { ThrowTiming } from './radioThrows'

/** One row of the engine's cycle table (native `stage-cycles`; CycleTable.h), in bars. */
export interface RadioFoldEngineRow {
  row: string
  id: string
  bars: number
  phaseBars: number
}

/** A step's cycles as the engine takes them; none for no step. */
export function radioFoldEngineRows(step: RadioFoldStep | null): RadioFoldEngineRow[] {
  return (step?.cycles ?? []).map((c) => ({
    row: c.rowId,
    id: c.cycleId,
    bars: c.cycleBeats / 4,
    phaseBars: c.phaseBeats / 4
  }))
}

/** The rows whose stems should name their row (EngineStem.cycleRow): every member whose stem is
 * the one a fold in any of `steps` was decided for. A row in `changing` (its stem is about to be
 * replaced by a staged swap) never does: a fold decided for the old stem must not fold the new. */
export function radioFoldCycleRows(
  steps: readonly (RadioFoldStep | null)[],
  members: readonly { id: string; stemId: string | null }[],
  changing: ReadonlySet<string> = new Set()
): Set<string> {
  const out = new Set<string>()
  for (const m of members) {
    if (m.stemId === null || changing.has(m.id)) continue
    if (steps.some((s) => s?.cycles.some((c) => c.rowId === m.id && c.stemId === m.stemId))) {
      out.add(m.id)
    }
  }
  return out
}

/** One row's drift over one lap as lane curves (clip-relative bars, 0 .. loopBars): the cutoff as
 * is, the reverb send as the row's own send plus the drift (never past 1), the dub send as is. */
export function radioFoldDriftCurves(
  lap: FoldDriftLap,
  loopBars: number,
  ownSend: number
): { cutoff: AutomationPoint[]; send: AutomationPoint[]; dub: AutomationPoint[] } {
  const ramp = ([a, b]: readonly [number, number], f: (v: number) => number): AutomationPoint[] => [
    { bar: 0, value: f(a) },
    { bar: loopBars, value: f(b) }
  ]
  return {
    cutoff: ramp(lap.cutoff, (v) => v),
    send: ramp(lap.send, (v) => Math.min(1, ownSend + v)),
    dub: ramp(lap.dub, (v) => v)
  }
}

/** The echo a drift's dub send opens into when no throw has set one: a dotted eighth, a short
 * tail -- the throws' own gentlest draw (radioThrows' ranges). */
export const FOLD_DRIFT_ECHO: Readonly<{ timing: ThrowTiming; feedback: number }> = Object.freeze({
  timing: 'dotted-eighth',
  feedback: 0.35
})

/** The listener's sound with the clash's lean on the master glue and saturation (radioClashLean):
 * the same object when there is no lean. */
export function radioFoldSound(
  sound: SoundSettings,
  foldMode: boolean,
  clash: number
): SoundSettings {
  const lean = radioClashLean(foldMode, clash)
  if (!(lean > 0)) return sound
  return {
    ...sound,
    glue: { ...sound.glue, amount: radioClashLeaned(sound.glue.amount, lean) },
    saturation: { ...sound.saturation, amount: radioClashLeaned(sound.saturation.amount, lean) }
  }
}
```

- [ ] **Step 4: Run, lint, typecheck both repos**

```bash
cd /Users/nickel/Claudecode/sssketch && npx vitest run src/shared/radioFoldLanes.test.ts && npx prettier --write src/shared/radioFoldLanes.ts src/shared/radioFoldLanes.test.ts && npx eslint src/shared/radioFoldLanes.ts src/shared/radioFoldLanes.test.ts && npm run typecheck
cd /Users/nickel/Claudecode/ell.ing/radio && npm run typecheck
```

Expected: 5 tests pass; clean.

- [ ] **Step 5: Commit**

```bash
cd /Users/nickel/Claudecode/sssketch
git add src/shared/radioFoldLanes.ts src/shared/radioFoldLanes.test.ts
git commit -m "$(cat <<'EOF'
radio fold: a step as the runtimes take it -- engine rows, which stems name their row, drift lanes, the drift echo, the lean

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz
EOF
)"
```

## Task 7: The cycle table and the lap clock's type (sssketch native engine)

**Files:**
- Create: `native-engine/Source/CycleTable.h`, `native-engine/Source/CycleTable.cpp`
- Test: `native-engine/Source/CycleTableTests.cpp`
- Modify: `native-engine/CMakeLists.txt`

- [ ] **Step 1: Write the failing test, and add both new sources to the build**

Create `native-engine/Source/CycleTableTests.cpp`:

```cpp
// native-engine/Source/CycleTableTests.cpp
#include "CycleTable.h"
#include <juce_core/juce_core.h>
#include <limits>

namespace sssketch
{
    class CycleTableTests : public juce::UnitTest
    {
    public:
        CycleTableTests() : juce::UnitTest("CycleTable") {}

        void runTest() override
        {
            const auto row = [](const char* rowId, const char* cycleId, double bars, double phase = 0.0) {
                CycleRow r;
                r.rowKey = cycleKeyOf(rowId);
                r.idKey = cycleKeyOf(cycleId);
                r.bars = bars;
                r.phaseBars = phase;
                return r;
            };

            beginTest("an empty id is no key; any other id is a key, never 0");
            {
                expect(cycleKeyOf("") == 0);
                expect(cycleKeyOf("slot-3") != 0);
                expect(cycleKeyOf("slot-3") == cycleKeyOf(juce::String("slot-3")));
                expect(cycleKeyOf("slot-3") != cycleKeyOf("slot-4"));
            }

            beginTest("a staged table waits for the loop top, then is live");
            {
                CycleTable t;
                t.stage({ row("perc", "perc~1", 1.75) }, false);
                expect(! t.apply(false));
                expect(t.find(cycleKeyOf("perc")) == nullptr);
                expect(t.apply(true));
                auto* live = t.find(cycleKeyOf("perc"));
                expect(live != nullptr);
                expectWithinAbsoluteError(live->row.bars, 1.75, 1e-12);
                expect(t.applyCount() == 1);
                expect(! t.apply(true)); // nothing waiting any more
            }

            beginTest("a `now` stage applies at the next block, loop top or not");
            {
                CycleTable t;
                t.stage({ row("perc", "perc~1", 1.75) }, false);
                expect(t.apply(true));
                t.stage({}, true);
                expect(t.apply(false));
                expect(t.liveCount() == 0);
            }

            beginTest("rows with no key, or no positive finite length, are dropped; at most eight");
            {
                CycleTable t;
                std::vector<CycleRow> rows { row("", "x", 1.0), row("a", "a~1", 0.0), row("b", "b~1", -1.0),
                                             row("c", "c~1", std::numeric_limits<double>::quiet_NaN()) };
                for (int i = 0; i < 12; ++i)
                    rows.push_back(row(juce::String("r" + juce::String(i)).toRawUTF8(), "id", 1.0));
                t.stage(rows, true);
                expect(t.apply(false));
                expect(t.liveCount() == kMaxCycleRows);
                expect(t.find(cycleKeyOf("a")) == nullptr);
            }

            beginTest("the origin is the base of the lap first rendered, and survives a re-stage of the same cycle");
            {
                CycleTable t;
                t.stage({ row("perc", "perc~1", 1.75) }, true);
                t.apply(false);
                auto* live = t.find(cycleKeyOf("perc"));
                expectWithinAbsoluteError(CycleTable::originFor(*live, { 8.0, 3 }), 8.0, 1e-12);
                expectWithinAbsoluteError(CycleTable::originFor(*live, { 12.0, 3 }), 8.0, 1e-12);

                // the same row and cycle id staged again (every lap does this): the origin stays
                t.stage({ row("perc", "perc~1", 1.75) }, false);
                t.apply(true);
                live = t.find(cycleKeyOf("perc"));
                expectWithinAbsoluteError(CycleTable::originFor(*live, { 16.0, 3 }), 8.0, 1e-12);

                // a new cycle id is a new origin: the top of the lap it is first rendered in
                t.stage({ row("perc", "perc~2", 1.5) }, false);
                t.apply(true);
                live = t.find(cycleKeyOf("perc"));
                expectWithinAbsoluteError(CycleTable::originFor(*live, { 20.0, 3 }), 20.0, 1e-12);
            }

            beginTest("a new epoch (a seek, a play) restarts the origin");
            {
                CycleTable t;
                t.stage({ row("perc", "perc~1", 1.75) }, true);
                t.apply(false);
                auto* live = t.find(cycleKeyOf("perc"));
                CycleTable::originFor(*live, { 40.0, 1 });
                expectWithinAbsoluteError(CycleTable::originFor(*live, { 0.0, 2 }), 0.0, 1e-12);
            }

            beginTest("an apply that cannot take the lock retries at the next block");
            {
                CycleTable t;
                t.stage({ row("perc", "perc~1", 1.75) }, false);
                // the message thread is mid-stage at the loop top
                {
                    juce::SpinLock::ScopedLockType hold(t.stagedLockForTest());
                    expect(! t.apply(true));
                }
                expect(t.apply(false)); // the retry, a block later
            }
        }
    };

    static CycleTableTests cycleTableTests;
}
```

In `native-engine/CMakeLists.txt`:

After:

```cmake
  Source/DubDelay.cpp
  Source/DubDelayBusTests.cpp
```

Insert:

```cmake
  Source/CycleTable.cpp
  Source/CycleTableTests.cpp
```

- [ ] **Step 2: Build to see it fail**

Run: `cd /Users/nickel/Claudecode/sssketch/native-engine && cmake --build build`
Expected: FAIL — `'CycleTable.h' file not found` (and `CycleTable.cpp` missing).

- [ ] **Step 3: Write the table**

Create `native-engine/Source/CycleTable.h`:

```cpp
// native-engine/Source/CycleTable.h
#pragma once
#include <juce_core/juce_core.h>
#include <array>
#include <atomic>
#include <cstdint>
#include <vector>

namespace sssketch
{
    /** The transport's lap clock: how many bars the completed laps since the last reposition
     * add up to, and which reposition that was. renderBlock's `positionBars` restarts at every
     * loop top; `baseBars + positionBars` does not, so a stem can keep a cycle running across the
     * top (radio fold mode, CycleTable below). Transport adds the lap's length at each wrap and
     * starts a new epoch (base 0) on every play, seek or snap. An export or a test that passes
     * nothing gets {0, 0}: one lap, epoch 0. */
    struct LapClock
    {
        double baseBars = 0.0;
        uint32_t epoch = 0;
    };

    /** The micro-fade at both ends of every cycle of a folded stem (radio fold mode, spec
     * 2026-10-02-radio-fold-mode-design.md section 1): a cropped loop's seam is a jump in the
     * audio, so each cycle fades in and out over this long. */
    constexpr double kCycleSeamFadeSec = 0.010;

    /** At most this many rows fold at once. Radio folds two; the rest is headroom. */
    constexpr int kMaxCycleRows = 8;

    /** A row or cycle id from the wire, as the audio thread compares it: a 64-bit hash, 0 for an
     * empty id (a stem with no `cycleRow`), and never 0 otherwise. */
    uint64_t cycleKeyOf(const juce::String& text);

    /** One folded row: which row (EngineStem::cycleRow), which cycle (the renderer's id: the
     * same id keeps its phase origin, a new one starts on the next top), its length and its
     * phase offset, both in bars. */
    struct CycleRow
    {
        uint64_t rowKey = 0;
        uint64_t idKey = 0;
        double bars = 0.0;
        double phaseBars = 0.0;
    };

    /** Radio fold mode's per-row cycle lengths, held apart from the project so a fold can change
     * EXACTLY on a loop top without a staged project swap: the renderer stages the next lap's
     * table a lap ahead (`stage-cycles`), and the audio thread takes it at the wrap, the way
     * Transport takes a staged loop length. A stem whose `cycleRow` names a row in the live table
     * loops only the first `bars` of its content, on the lap clock, from the cycle's origin (see
     * PlaybackEngine::renderBlock). A row not in the table plays exactly as before.
     *
     * Fixed capacity and no allocation: `stage` writes under a spin lock on the message thread,
     * and `apply` only TRIES that lock on the audio thread -- if the message thread holds it,
     * the apply is retried at the next block top (late by a block rather than a lap, as
     * Transport's staged-project retry). The live table and its origins belong to the audio
     * thread alone. */
    class CycleTable
    {
    public:
        struct Live
        {
            CycleRow row;
            double originBars = 0.0;
            uint32_t originEpoch = 0;
            bool hasOrigin = false;
        };

        /** MESSAGE THREAD. Replaces whatever is staged: applied at the next loop top, or at the
         * next block when `now` (radio stopping, the mode going off). Rows with no row key or no
         * positive, finite length are dropped, and only the first kMaxCycleRows are kept. */
        void stage(const std::vector<CycleRow>& rows, bool now);

        /** AUDIO THREAD, from a point with no renderBlock in flight: takes the staged table if
         * there is one and it is due -- at a loop top (`atWrap`), or anywhere for a `now` stage or
         * a retry. A row whose row key and cycle id were live before keeps its origin. Returns
         * whether it applied. */
        bool apply(bool atWrap);

        /** AUDIO THREAD. The live entry for a row, or null. */
        Live* find(uint64_t rowKey);

        /** AUDIO THREAD. The cycle's origin on the lap clock: the first time it is asked in an
         * epoch, the base of the lap being rendered -- the top of the lap it was applied on. */
        static double originFor(Live& live, const LapClock& clock);

        /** Any thread: how many times `apply` has applied. */
        unsigned long long applyCount() const { return applies.load(std::memory_order_acquire); }

        /** AUDIO THREAD (or a test with none running): how many rows are live. */
        int liveCount() const { return numLive; }

        /** For tests: the lock `stage` holds, so a test can hold it across an `apply`. */
        juce::SpinLock& stagedLockForTest() { return stagedLock; }

    private:
        juce::SpinLock stagedLock;
        std::array<CycleRow, kMaxCycleRows> staged {};
        int numStaged = 0;
        // 0: nothing waiting; 1: at the next loop top; 2: at the next block.
        std::atomic<int> pending { 0 };
        bool retryDue = false;
        std::array<Live, kMaxCycleRows> live {};
        int numLive = 0;
        std::atomic<unsigned long long> applies { 0 };
    };
}
```

Create `native-engine/Source/CycleTable.cpp`:

```cpp
// native-engine/Source/CycleTable.cpp
#include "CycleTable.h"
#include <cmath>

namespace sssketch
{
    uint64_t cycleKeyOf(const juce::String& text)
    {
        if (text.isEmpty())
            return 0;
        const auto h = (uint64_t) text.hashCode64();
        return h == 0 ? 1 : h;
    }

    void CycleTable::stage(const std::vector<CycleRow>& rows, bool now)
    {
        const juce::SpinLock::ScopedLockType lock(stagedLock);
        numStaged = 0;
        for (const auto& r : rows)
        {
            if (numStaged >= kMaxCycleRows)
                break;
            if (r.rowKey == 0 || !std::isfinite(r.bars) || !(r.bars > 0.0) || !std::isfinite(r.phaseBars))
                continue;
            staged[(size_t) numStaged++] = r;
        }
        pending.store(now ? 2 : 1, std::memory_order_release);
    }

    bool CycleTable::apply(bool atWrap)
    {
        const int want = pending.load(std::memory_order_acquire);
        if (want == 0)
        {
            retryDue = false;
            return false;
        }
        if (want == 1 && ! atWrap && ! retryDue)
            return false;
        const juce::SpinLock::ScopedTryLockType lock(stagedLock);
        if (! lock.isLocked())
        {
            retryDue = true;
            return false;
        }
        std::array<Live, kMaxCycleRows> next {};
        int n = 0;
        for (int i = 0; i < numStaged; ++i)
        {
            Live l;
            l.row = staged[(size_t) i];
            for (int j = 0; j < numLive; ++j)
            {
                const auto& was = live[(size_t) j];
                if (was.row.rowKey == l.row.rowKey && was.row.idKey == l.row.idKey)
                {
                    l.originBars = was.originBars;
                    l.originEpoch = was.originEpoch;
                    l.hasOrigin = was.hasOrigin;
                    break;
                }
            }
            next[(size_t) n++] = l;
        }
        live = next;
        numLive = n;
        pending.store(0, std::memory_order_release);
        retryDue = false;
        applies.fetch_add(1, std::memory_order_acq_rel);
        return true;
    }

    CycleTable::Live* CycleTable::find(uint64_t rowKey)
    {
        if (rowKey == 0)
            return nullptr;
        for (int i = 0; i < numLive; ++i)
            if (live[(size_t) i].row.rowKey == rowKey)
                return &live[(size_t) i];
        return nullptr;
    }

    double CycleTable::originFor(Live& l, const LapClock& clock)
    {
        if (! l.hasOrigin || l.originEpoch != clock.epoch)
        {
            l.originBars = clock.baseBars;
            l.originEpoch = clock.epoch;
            l.hasOrigin = true;
        }
        return l.originBars;
    }
}
```

- [ ] **Step 4: Build and run the suite**

```bash
cd /Users/nickel/Claudecode/sssketch/native-engine && cmake --build build && build/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine --test CycleTable
```

Expected: `All unit tests passed.` (7 tests in `CycleTable`).

- [ ] **Step 5: Commit**

```bash
cd /Users/nickel/Claudecode/sssketch
git add native-engine/Source/CycleTable.h native-engine/Source/CycleTable.cpp native-engine/Source/CycleTableTests.cpp native-engine/CMakeLists.txt
git commit -m "$(cat <<'EOF'
engine: the cycle table -- radio fold mode's per-row cycles, staged a lap ahead and taken at the top, origins kept by cycle id

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz
EOF
)"
```

## Task 8: `cycleRow` on the wire, both twins (sssketch native engine and shared)

The hand-synced pair (sssketch `CLAUDE.md`, "Wire format twins"): `EngineStem::cycleRow` and `EngineStem.cycleRow` change together. Absent is today's wire, byte for byte.

**Files:**
- Modify: `native-engine/Source/EngineProject.h`, `native-engine/Source/EngineProject.cpp`, `native-engine/Source/EngineProjectTests.cpp`
- Modify: `src/shared/buildEngineProject.ts`, `src/shared/buildEngineProject.test.ts`

- [ ] **Step 1: Write the failing tests**

In `native-engine/Source/EngineProjectTests.cpp`:

Find:

```cpp
#include "EngineProject.h"
#include <juce_core/juce_core.h>
```

Replace with:

```cpp
#include "EngineProject.h"
#include "CycleTable.h"
#include <juce_core/juce_core.h>
```

After:

```cpp
                    expect(stems[i].pumpRole == expected[i], stems[i].stemKey);
                expect(! stems[1].hasToolkit);
            }
```

Insert:

```cpp

            beginTest("a stem's cycleRow parses with its key; absent is empty and key 0");
            {
                EngineProject project;
                juce::String error;
                expect(parseEngineProject(
                    R"({"bpm":120.0,"rifffs":[{"groupId":"g","stems":[
                         {"stemKey":"absent"},
                         {"stemKey":"folded","cycleRow":"slot-3"}
                       ]}]})",
                    project, error), error);
                const auto& stems = project.rifffs[0].stems;
                expect(stems[0].cycleRow.isEmpty());
                expect(stems[0].cycleRowKey == 0);
                expectEquals(stems[1].cycleRow, juce::String("slot-3"));
                expect(stems[1].cycleRowKey == cycleKeyOf("slot-3"));
            }
```

In `src/shared/buildEngineProject.test.ts`:

After:

```ts
    expect(isDubOnlyToolkit(beside.rifffs[0].stems[0].toolkit!)).toBe(false)
  })
})
```

Insert:

```ts

describe('radio fold mode on the wire: cycleRow', () => {
  const twoStems: Rifff = {
    ...rifff,
    stems: [
      { ...rifff.stems[0], slot: 1, type: 'drums', path: '/k.wav' },
      { ...rifff.stems[0], slot: 2, type: 'drums', path: '/h.wav' }
    ]
  }

  it('names the row only for the stems the map names', async () => {
    const project = await buildEngineProject(
      stateWith({ bpm: 150, rifffs: { r1: twoStems } }),
      vi.fn(),
      emptyCatalog,
      {},
      { stemCycleRows: new Map([[stemKey('r1', 2), 'slot-7']]) }
    )
    expect(project.rifffs[0].stems.map((s) => s.cycleRow)).toEqual([undefined, 'slot-7'])
    expect('cycleRow' in project.rifffs[0].stems[0]).toBe(false)
  })

  it('with no map, no stem has a cycleRow key at all (the wire is what it was)', async () => {
    const project = await buildEngineProject(
      stateWith({ bpm: 150, rifffs: { r1: twoStems } }),
      vi.fn(),
      emptyCatalog
    )
    expect(project.rifffs[0].stems.some((s) => 'cycleRow' in s)).toBe(false)
  })
})
```

- [ ] **Step 2: Run them to see them fail**

```bash
cd /Users/nickel/Claudecode/sssketch/native-engine && cmake --build build
cd /Users/nickel/Claudecode/sssketch && npx vitest run src/shared/buildEngineProject.test.ts
```

Expected: the engine build FAILS (`no member named 'cycleRow' in 'sssketch::EngineStem'`); the vitest run FAILS (`stemCycleRows` is not an option; the stem has no `cycleRow`).

- [ ] **Step 3: Add the field on both sides**

In `native-engine/Source/EngineProject.h`:

After:

```cpp
            pumped
        };
        PumpRole pumpRole = PumpRole::none;
```

Insert:

```cpp

        /** Radio fold mode (CycleTable.h): the row this stem plays for, so a cycle staged for
         * that row can fold it. Absent on the wire -- every project but a folding radio's -- is
         * empty, and an empty row plays exactly as before. Twin of EngineStem.cycleRow in
         * src/shared/buildEngineProject.ts. */
        juce::String cycleRow;
        /** NOT ON THE WIRE: cycleKeyOf(cycleRow), computed once by the parser so the audio
         * thread compares two integers. 0 for no row. */
        uint64_t cycleRowKey = 0;
```

In `native-engine/Source/EngineProject.cpp`:

Find:

```cpp
#include "EngineProject.h"
#include <algorithm>
```

Replace with:

```cpp
#include "EngineProject.h"
#include "CycleTable.h"
#include <algorithm>
```

After:

```cpp
                                    stem.pumpRole = EngineStem::PumpRole::pumped;
                            }
                        }

```

Insert:

```cpp
                        // Radio fold mode's row (CycleTable.h). Absent is empty: no fold.
                        stem.cycleRow = stemVar.getProperty("cycleRow", "").toString();
                        stem.cycleRowKey = cycleKeyOf(stem.cycleRow);

```

In `src/shared/buildEngineProject.ts`:

After:

```ts
   * EngineStem::pumpRole in native-engine/Source/EngineProject.h. */
  pumpRole?: 'key' | 'pumped'
```

Insert:

```ts
  /** Radio fold mode (@shared/radioFold; native-engine/Source/CycleTable.h): the Discover row
   * this stem plays for, so the cycle the renderer stages for that row (engineStageCycles) can
   * fold it. ABSENT for every stem but a folding radio's, and that absence is load-bearing, the
   * same rule as `pan`: such a stem sends the JSON it sent before. Twin of EngineStem::cycleRow
   * in native-engine/Source/EngineProject.h. */
  cycleRow?: string
```

After:

```ts
   * setPump(0)) rather than stepping. Ignored while the pump is on. */
  pumpRelease?: boolean
```

Insert:

```ts
  /** Radio fold mode: the Discover row (slot id) each stem plays for, by stem key, while the
   * mode is on (DiscoverPanel's syncPreviewToEngine). Each named stem carries it as
   * EngineStem.cycleRow; nothing else changes. */
  stemCycleRows?: ReadonlyMap<string, string>
```

After:

```ts
      const pumpRole = pumpRoles?.get(key) ?? 'none'
```

Insert:

```ts
      const cycleRow = options.stemCycleRows?.get(key)
```

Find:

```ts
        // And again: a row with no part in the pump (or the pump off) has no `pumpRole` key.
        ...(pumpRole !== 'none' ? { pumpRole } : {})
```

Replace with:

```ts
        // And again: a row with no part in the pump (or the pump off) has no `pumpRole` key.
        ...(pumpRole !== 'none' ? { pumpRole } : {}),
        // And again: only a folding radio's stems name their row.
        ...(cycleRow ? { cycleRow } : {})
```

- [ ] **Step 4: Build, run, lint, typecheck**

```bash
cd /Users/nickel/Claudecode/sssketch/native-engine && cmake --build build && build/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine --test EngineProject
cd /Users/nickel/Claudecode/sssketch && npx vitest run src/shared/buildEngineProject.test.ts && npx prettier --write src/shared/buildEngineProject.ts src/shared/buildEngineProject.test.ts && npx eslint src/shared/buildEngineProject.ts src/shared/buildEngineProject.test.ts && npm run typecheck
cd /Users/nickel/Claudecode/ell.ing/radio && npm run typecheck
```

Expected: all pass; clean.

- [ ] **Step 5: Commit**

```bash
cd /Users/nickel/Claudecode/sssketch
git add native-engine/Source/EngineProject.h native-engine/Source/EngineProject.cpp native-engine/Source/EngineProjectTests.cpp src/shared/buildEngineProject.ts src/shared/buildEngineProject.test.ts
git commit -m "$(cat <<'EOF'
engine wire: a stem names its Discover row (cycleRow) only for a folding radio; absent is today's wire

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz
EOF
)"
```

## Task 9: `renderBlock` plays a folded row on the lap clock (sssketch native engine)

**Files:**
- Modify: `native-engine/Source/PlaybackEngine.h`, `native-engine/Source/PlaybackEngine.cpp`
- Test: `native-engine/Source/PlaybackEngineTests.cpp`

- [ ] **Step 1: Write the failing tests**

In `native-engine/Source/PlaybackEngineTests.cpp` (after Task 1's proof):

After:

```cpp
                expectWithinAbsoluteError(at(15.5), 0.5f / 16.0f, 0.002f);
```

Insert:

```cpp
                ramp.deleteFile();
            }

            // The cycle table (CycleTable.h): a stem whose row is folded loops its first `bars`
            // at the stem's own full barLength/durationSec (so the buffer cache sews the stem's
            // real end, never the crop point), on the lap clock, with a seam fade.
            const auto foldProject = [](const juce::File& file, const juce::String& row) {
                EngineProject project;
                project.bpm = 60.0; // a beat is 1 s, a bar 4 s
                project.snapDiv = 16.0;
                EngineRifff rifff;
                rifff.startBar = 0.0;
                rifff.barLength = 4.0; // a 16 s loop
                EngineStem stem;
                stem.stemKey = "fold:1";
                stem.resolvedPath = file.getFullPathName();
                stem.barLength = 4.0;
                stem.durationSec = 16.0;
                stem.cycleRow = row;
                stem.cycleRowKey = cycleKeyOf(row);
                rifff.stems.push_back(stem);
                project.rifffs.push_back(rifff);
                return project;
            };
            const auto foldRow = [](double bars, double phaseBars, const char* id = "perc~1") {
                CycleRow r;
                r.rowKey = cycleKeyOf("perc");
                r.idKey = cycleKeyOf(id);
                r.bars = bars;
                r.phaseBars = phaseBars;
                return std::vector<CycleRow> { r };
            };

            beginTest("a folded row loops its first 7 beats; the cycle runs on across the loop top");
            {
                auto ramp = writeRampFixtureWav("sssketch_pe_fold_ramp.wav", 16 * 44100);
                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains;
                engine.setProject(foldProject(ramp, "perc"));
                engine.stageCycles(foldRow(7.0 / 4.0, 0.0), true);
                expect(engine.applyStagedCycles(false));
                const auto at = [&](double lapSec, double baseBars) {
                    float l = 0.0f, r = 0.0f;
                    engine.renderBlock(lapSec / 4.0, 44100.0, 1, &l, &r, channelChains, LapClock { baseBars, 1 });
                    return l;
                };
                // lap 0 (base 0): tiles at 0, 7 and 14 s
                expectWithinAbsoluteError(at(0.5, 0.0), 0.5f / 16.0f, 0.002f);
                expectWithinAbsoluteError(at(6.5, 0.0), 6.5f / 16.0f, 0.002f);
                expectWithinAbsoluteError(at(7.5, 0.0), 0.5f / 16.0f, 0.002f);
                expectWithinAbsoluteError(at(15.5, 0.0), 1.5f / 16.0f, 0.002f);
                // lap 1 (base 4 bars): 16.5 s on the cycle grid is 2.5 s into a tile -- it did
                // NOT restart with the loop (that would read 0.5 / 16)
                expectWithinAbsoluteError(at(0.5, 4.0), 2.5f / 16.0f, 0.002f);
                // 112 beats in (lap 7 starts at 112 s): the cycle and the loop line up again
                expectWithinAbsoluteError(at(0.5, 28.0), 0.5f / 16.0f, 0.002f);
                ramp.deleteFile();
            }

            beginTest("a folded row's phase offset starts each cycle that much later");
            {
                auto ramp = writeRampFixtureWav("sssketch_pe_fold_phase_ramp.wav", 16 * 44100);
                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains;
                engine.setProject(foldProject(ramp, "perc"));
                engine.stageCycles(foldRow(7.0 / 4.0, 0.25), true); // a beat late
                engine.applyStagedCycles(false);
                const auto at = [&](double lapSec) {
                    float l = 0.0f, r = 0.0f;
                    engine.renderBlock(lapSec / 4.0, 44100.0, 1, &l, &r, channelChains, LapClock { 0.0, 1 });
                    return l;
                };
                expectWithinAbsoluteError(at(1.5), 0.5f / 16.0f, 0.002f);
                expectWithinAbsoluteError(at(0.5), 6.5f / 16.0f, 0.002f); // the tail of the cycle before
                expectWithinAbsoluteError(at(8.5), 0.5f / 16.0f, 0.002f);
                ramp.deleteFile();
            }

            beginTest("a folded row's cycle seam fades over 10 ms: no step above threshold, a dip at the seam");
            {
                auto ramp = writeRampFixtureWav("sssketch_pe_fold_seam_ramp.wav", 16 * 44100);
                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains;
                engine.setProject(foldProject(ramp, "perc"));
                engine.stageCycles(foldRow(7.0 / 4.0, 0.0), true);
                engine.applyStagedCycles(false);
                // 50 ms either side of the seam at 7 s, in one block
                const int n = (int) (0.1 * 44100.0);
                std::vector<float> l((size_t) n, 0.0f), r((size_t) n, 0.0f);
                engine.renderBlock((7.0 - 0.05) / 4.0, 44100.0, n, l.data(), r.data(), channelChains, LapClock { 0.0, 1 });
                float worst = 0.0f;
                float lowest = 1.0f;
                for (int i = 1; i < n; ++i)
                {
                    worst = std::max(worst, std::abs(l[(size_t) i] - l[(size_t) i - 1]));
                    lowest = std::min(lowest, std::abs(l[(size_t) i]));
                }
                // unfaded, the seam is a 7/16 = 0.44 jump; faded over 441 samples, each step is
                // about 0.44 / 441 = 0.001
                expect(worst < 0.002f, "largest step at the seam " + juce::String(worst));
                expect(lowest < 0.001f, "the seam dips to silence, got " + juce::String(lowest));
                ramp.deleteFile();
            }

            beginTest("a row the cycle table does not name plays exactly as a stem with no row");
            {
                auto ramp = writeRampFixtureWav("sssketch_pe_fold_none_ramp.wav", 16 * 44100);
                StemBufferCache cache;
                PlaybackEngine withRow(cache);
                PlaybackEngine plain(cache);
                ChannelChainRegistry channelChains;
                withRow.setProject(foldProject(ramp, "lead")); // the table folds "perc" only
                withRow.stageCycles(foldRow(7.0 / 4.0, 0.0), true);
                withRow.applyStagedCycles(false);
                plain.setProject(foldProject(ramp, ""));
                std::vector<float> a(4096, 0.0f), ar(4096, 0.0f), b(4096, 0.0f), br(4096, 0.0f);
                withRow.renderBlock(1.9, 44100.0, 4096, a.data(), ar.data(), channelChains, LapClock { 4.0, 1 });
                plain.renderBlock(1.9, 44100.0, 4096, b.data(), br.data(), channelChains);
                for (size_t i = 0; i < a.size(); ++i)
                    expectEquals(a[i], b[i]);
```

- [ ] **Step 2: Build to see it fail**

Run: `cd /Users/nickel/Claudecode/sssketch/native-engine && cmake --build build`
Expected: FAIL — `no member named 'stageCycles' in 'sssketch::PlaybackEngine'` (and `applyStagedCycles`, the `LapClock` argument).

- [ ] **Step 3: Add the cycle path**

In `native-engine/Source/PlaybackEngine.h`:

After:

```cpp
#include "StemBufferCache.h"
#include "ChannelChainRegistry.h"
```

Insert:

```cpp
#include "CycleTable.h"
```

After:

```cpp
         * guarantee true exactly where it was true before. */
```

Insert:

```cpp
        /** `lapClock` (CycleTable.h) is the transport's lap clock, which only a stem folded by
         * the cycle table reads: Transport passes it, and everything else (an export, a test)
         * gets {0, 0}. */
```

Find:

```cpp
            ChannelChainRegistry& channelChains) const;
```

Replace with:

```cpp
            ChannelChainRegistry& channelChains,
            const LapClock& lapClock = {}) const;

        /** MESSAGE THREAD. Radio fold mode's cycles for the next loop top, or for the next block
         * when `now` (CycleTable::stage). */
        void stageCycles(const std::vector<CycleRow>& rows, bool now) { cycleTable.stage(rows, now); }

        /** AUDIO THREAD, at a point with no renderBlock in flight: Transport calls it at every
         * block top (`atWrap` false: a `now` stage, or a retry) and at every loop top (`atWrap`
         * true). See CycleTable::apply. */
        bool applyStagedCycles(bool atWrap) { return cycleTable.apply(atWrap); }

        /** Any thread: how many cycle tables have gone live (for tests). */
        unsigned long long cycleApplyCount() const { return cycleTable.applyCount(); }
```

After:

```cpp
        std::map<juce::String, std::shared_ptr<RiserVoice>> riserVoicePool;

```

Insert:

```cpp
        /** Radio fold mode's per-row cycles (CycleTable.h). `mutable` for the same reason as the
         * snapshot's scratch: renderBlock is const and keeps each live cycle's origin here, and
         * only the rendering thread touches the live table. */
        mutable CycleTable cycleTable;

```

In `native-engine/Source/PlaybackEngine.cpp`:

Find:

```cpp
        ChannelChainRegistry& channelChains) const
```

Replace with:

```cpp
        ChannelChainRegistry& channelChains,
        const LapClock& lapClock) const
```

After:

```cpp
                    continue; // handled -- skip the tile-loop path below entirely
```

Insert:

```cpp
                }

                // RADIO FOLD MODE (CycleTable.h): a row the live cycle table names loops only the
                // first `bars` of its content, on the LAP clock -- positionBars restarts at every
                // loop top, lapClock.baseBars + positionBars does not -- so a 7-beat cycle in a
                // 16-beat loop drifts against the top and realigns every 112 beats, instead of
                // restarting with the loop. Tile k starts at origin + phase + k * bars; each tile
                // reads the stem's first `bars` of audio at its native rate (durationSec /
                // barLength, the same rate the tile path below uses, so a stretched stem plays at
                // tempo), and fades in and out over kCycleSeamFadeSec, because the cut is a jump
                // in the audio that nothing else smooths (the buffer cache sews only the stem's
                // own end). The rifff's window and fades do not apply: a folded row plays the
                // whole lap, every lap. Everything after -- gain, mute regions, toolkit, pan,
                // sends, pump -- is the same as for any stem.
                if (stem.cycleRowKey != 0)
                {
                    if (auto* cycle = cycleTable.find(stem.cycleRowKey))
                    {
                        if (! std::isfinite(stem.barLength) || stem.barLength < kMinStemBarLength
                            || ! (stem.durationSec > 0.0))
                            continue;
                        const double cycleBars = std::min(cycle->row.bars, stem.barLength);
                        if (! (cycleBars >= kMinStemBarLength))
                            continue;
                        const double originBars = CycleTable::originFor(*cycle, lapClock);
                        const double secPerBarNative = stem.durationSec / stem.barLength;
                        const double contentSec = cycleBars * secPerBarNative;
                        const double tileSec = cycleBars * spb;
                        const double fadeSec = std::min(kCycleSeamFadeSec, contentSec / 2.0);
                        // seconds into the cycle grid at this block's first sample
                        const double gridStartSec =
                            (lapClock.baseBars + positionBars - originBars - cycle->row.phaseBars) * spb;
                        const int numCh = entry.buffer->getNumChannels();
                        const int bufferSamples = entry.buffer->getNumSamples();
                        prepareStemBuffer();
                        for (int i2 = 0; i2 < numSamples; ++i2)
                        {
                            double inTile = std::fmod(gridStartSec + (double) i2 / sampleRate, tileSec);
                            if (inTile < 0.0)
                                inTile += tileSec;
                            if (inTile >= contentSec)
                                continue; // a stem slower than the project leaves a gap, as a tile does
                            const int srcSample = (int) std::llround(inTile * entry.sampleRate);
                            if (srcSample < 0 || srcSample >= bufferSamples)
                                continue;
                            const double seam = fadeSec > 0.0
                                ? std::min({ 1.0, inTile / fadeSec, (contentSec - inTile) / fadeSec })
                                : 1.0;
                            const double sampleTimeSec = blockStartSec + (double) i2 / sampleRate;
                            const double gain = seam * effectiveVolume
                                * muteRegionGainAt(sampleTimeSec, spb, stem.muteRegions);
                            const float l = entry.buffer->getSample(0, srcSample);
                            const float r = numCh > 1 ? entry.buffer->getSample(1, srcSample) : l;
                            stemOutL[i2] += (float) (l * gain);
                            stemOutR[i2] += (float) (r * gain);
                        }
                        finishStem();
                        continue;
                    }
```

- [ ] **Step 4: Build and run the engine's suites**

```bash
cd /Users/nickel/Claudecode/sssketch/native-engine && cmake --build build && build/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine --test PlaybackEngine && build/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine --test BounceParity
```

Expected: `All unit tests passed.` for both — including `a folded row loops its first 7 beats; the cycle runs on across the loop top`, `a folded row's phase offset starts each cycle that much later`, `a folded row's cycle seam fades over 10 ms: no step above threshold, a dip at the seam` and `a row the cycle table does not name plays exactly as a stem with no row`, and every pre-existing render test unchanged (no stem carries a `cycleRow` there).

- [ ] **Step 5: Commit**

```bash
cd /Users/nickel/Claudecode/sssketch
git add native-engine/Source/PlaybackEngine.h native-engine/Source/PlaybackEngine.cpp native-engine/Source/PlaybackEngineTests.cpp
git commit -m "$(cat <<'EOF'
engine: a folded row loops its first bars on the lap clock -- it runs on across the loop top, phase-offset, a 10 ms fade at each seam

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz
EOF
)"
```

## Task 10: Transport keeps the lap clock and takes cycles at the top; `stage-cycles` (sssketch native engine)

**Files:**
- Modify: `native-engine/Source/Transport.h`, `native-engine/Source/Transport.cpp`, `native-engine/Source/IpcServer.cpp`
- Test: `native-engine/Source/TransportTests.cpp`

- [ ] **Step 1: Write the failing test**

In `native-engine/Source/TransportTests.cpp`:

After:

```cpp
                    engine.drainRetiredProject();
                    tone4.deleteFile();
```

Insert:

```cpp
                }

                // Radio fold mode (CycleTable.h): the lap clock runs on across loop tops, and a
                // cycle table staged for "the next top" goes live in the wrapping block, between
                // the outgoing lap's last sample and the incoming lap's first.
                beginTest("the lap clock adds each lap at its wrap, a move starts a new one, and cycles "
                          "staged for the top go live exactly there");
                {
                    StemBufferCache cache;
                    PlaybackEngine engine(cache);
                    engine.setProject(makeProject(kLoopBars));
                    PluginChain masterChain(kNumMasterChainSlots);
                    ChannelChainRegistry channelChains;
                    Transport transport(engine, masterChain, channelChains);
                    transport.setBpm(kBpm);
                    transport.setLoopLengthBars(kLoopBars);
                    transport.play(0.0);

                    std::vector<float> l((size_t) kBlock), r((size_t) kBlock);
                    float* channels[2] = { l.data(), r.data() };
                    transport.audioDeviceIOCallbackWithContext(nullptr, 0, channels, 2, kBlock, {});
                    const LapClock first = transport.lapClockForTest();
                    expectWithinAbsoluteError(first.baseBars, 0.0, 1.0e-12);

                    CycleRow row;
                    row.rowKey = cycleKeyOf("perc");
                    row.idKey = cycleKeyOf("perc~1");
                    row.bars = 0.1;
                    engine.stageCycles({ row }, false);

                    double posBeforeApplyBlock = -1.0;
                    for (int i = 0; i < 200 && engine.cycleApplyCount() == 0; ++i)
                    {
                        posBeforeApplyBlock = transport.currentPositionBars();
                        transport.audioDeviceIOCallbackWithContext(nullptr, 0, channels, 2, kBlock, {});
                    }
                    expect(engine.cycleApplyCount() == 1);
                    // in the block the loop end falls inside, not before it
                    expect(posBeforeApplyBlock < kLoopBars);
                    expect(posBeforeApplyBlock + blockBars >= kLoopBars);
                    expectWithinAbsoluteError(transport.lapClockForTest().baseBars, kLoopBars, 1.0e-9);
                    expect(transport.lapClockForTest().epoch == first.epoch);

                    // another lap (21.5 blocks of 512): one more loop on the clock
                    for (int i = 0; i < 25; ++i)
                        transport.audioDeviceIOCallbackWithContext(nullptr, 0, channels, 2, kBlock, {});
                    expectWithinAbsoluteError(transport.lapClockForTest().baseBars, 2.0 * kLoopBars, 1.0e-9);

                    // a seek is a move: a new lap clock
                    transport.setPosition(0.1);
                    for (int i = 0; i < 40; ++i)
                        transport.audioDeviceIOCallbackWithContext(nullptr, 0, channels, 2, kBlock, {});
                    expect(transport.lapClockForTest().epoch > first.epoch);
```

- [ ] **Step 2: Build to see it fail**

Run: `cd /Users/nickel/Claudecode/sssketch/native-engine && cmake --build build`
Expected: FAIL — `no member named 'lapClockForTest' in 'sssketch::Transport'`.

- [ ] **Step 3: Keep the lap clock, pass it to every render, apply cycles at the tops; add the IPC message**

In short: Transport keeps `lapBaseBars`/`lapEpoch` (reset to a new epoch by a play, seek or snap, never by a tempo change), adds the lap's length in the wrap's split right after `applyStagedProjectAtWrap(loopStart)` and applies the staged cycles there (and at the snap), applies a `now` stage at every block top, passes `lapClock()` as the last argument of **every** `engine.renderBlock(` call in `renderLoopAware` — except the seam anchor's, which renders the next lap's first sample on the next lap's clock — and exposes `lapClockForTest()`. In file order:

In `native-engine/Source/Transport.h`:

After:

```cpp
        double currentPositionBars() const { return positionBars.load(); }
```

Insert:

```cpp
        /** The audio thread's lap clock, for tests that drive the callback themselves (read it
         * between callbacks, never while one runs). */
        LapClock lapClockForTest() const { return lapClock(); }
```

After:

```cpp
        double lastReturnedPositionBars = -1.0; // what renderLoopAware last returned
        bool anchorValid = false;
```

Insert:

```cpp
        // The lap clock (CycleTable.h's LapClock): the bars of the laps completed since the last
        // play, seek or snap, and which of those it was. Audio thread only; passed to every
        // renderBlock in renderLoopAware, where only a folded stem reads it.
        double lapBaseBars = 0.0;
        uint32_t lapEpoch = 0;
        LapClock lapClock() const { return { lapBaseBars, lapEpoch }; }
```

In `native-engine/Source/Transport.cpp`:

Find:

```cpp
            || deviceSampleRate != anchorSampleRate)
            reanchor(pos, 0, spb);
```

Replace with:

```cpp
            || deviceSampleRate != anchorSampleRate)
        {
            // Only a MOVE starts a new lap clock (a play, a seek, a stop's landing): a tempo or
            // device-rate change re-anchors the sample clock but the laps played stay played.
            if (! anchorValid || pos != lastReturnedPositionBars)
            {
                lapBaseBars = 0.0;
                ++lapEpoch;
            }
            reanchor(pos, 0, spb);
        }

        // Radio fold mode's cycles (CycleTable.h): a `now` stage, or a loop top's apply that
        // could not take the lock, lands here -- the top of a block, no renderBlock in flight.
        engine.applyStagedCycles(false);
```

Find:

```cpp
        if (loopBars <= 0.0)
        {
            engine.renderBlock(pos, deviceSampleRate, numSamples, outL, outR, channelChains);
```

Replace with:

```cpp
        if (loopBars <= 0.0)
        {
            engine.renderBlock(pos, deviceSampleRate, numSamples, outL, outR, channelChains, lapClock());
```

Find:

```cpp
        {
            engine.renderBlock(pos, deviceSampleRate, numSamples, outL, outR, channelChains);
```

Replace with:

```cpp
        {
            engine.renderBlock(pos, deviceSampleRate, numSamples, outL, outR, channelChains, lapClock());
```

After:

```cpp
            pos = loopStart;
            reanchor(loopStart, 0, spb);
```

Insert:

```cpp
            // A snap is a jump, not a lap played through: a new lap clock, and the cycles
            // staged for "the next top" take this one.
            lapBaseBars = 0.0;
            ++lapEpoch;
            engine.applyStagedCycles(true);
```

After:

```cpp
            applyStagedProjectAtWrap(pos, true);
        }

        const double distToEnd = loopEnd - pos;
```

Insert:

```cpp
        bool wrappedThisBlock = false;
```

Find:

```cpp
                    engine.renderBlock(pos, deviceSampleRate, splitIndex, outL, outR, channelChains);
```

Replace with:

```cpp
                    engine.renderBlock(pos, deviceSampleRate, splitIndex, outL, outR, channelChains, lapClock());
```

Find:

```cpp
                                       numSamples - splitIndex, outL + splitIndex,
                                       outR + splitIndex, channelChains);
```

Replace with:

```cpp
                                       numSamples - splitIndex, outL + splitIndex,
                                       outR + splitIndex, channelChains, lapClock());
```

Find:

```cpp
                engine.renderBlock(pos, deviceSampleRate, numSamples, outL, outR, channelChains);
```

Replace with:

```cpp
                engine.renderBlock(pos, deviceSampleRate, numSamples, outL, outR, channelChains, lapClock());
```

Find:

```cpp
                engine.renderBlock(pos, deviceSampleRate, splitIndex, outL, outR, channelChains);
```

Replace with:

```cpp
                engine.renderBlock(pos, deviceSampleRate, splitIndex, outL, outR, channelChains, lapClock());
```

After:

```cpp
            // pulled toward whatever actually follows it.
            applyStagedProjectAtWrap(loopStart);
```

Insert:

```cpp
            // The lap just played joins the lap clock, and the cycles staged for this top go
            // live, in the same gap as the project: the incoming lap's first sample is the first
            // one rendered with them.
            lapBaseBars += loopBars;
            wrappedThisBlock = true;
            engine.applyStagedCycles(true);
```

Find:

```cpp
                                    outL + splitIndex, outR + splitIndex, channelChains);
```

Replace with:

```cpp
                                    outL + splitIndex, outR + splitIndex, channelChains, lapClock());
```

Find:

```cpp
            engine.renderBlock(loopStart, deviceSampleRate, 1, &anchorL, &anchorR, channelChains);
```

Replace with:

```cpp
            // The anchor is the NEXT lap's first sample, on the next lap's clock.
            const LapClock anchorClock { wrappedThisBlock ? lapBaseBars : lapBaseBars + loopBars, lapEpoch };
            engine.renderBlock(loopStart, deviceSampleRate, 1, &anchorL, &anchorR, channelChains, anchorClock);
```

In `native-engine/Source/IpcServer.cpp`:

After:

```cpp
            const double durationSec = (double) payload.getProperty("durationSec", -1.0);
            engine.preloadStem(path, durationSec);
        }
```

Insert:

```cpp
        else if (type == "stage-cycles")
        {
            // Radio fold mode (CycleTable.h): the per-row cycles for the next loop top, or for the
            // next block with `now`. Fire-and-forget, like preload-stem: the renderer stages the
            // next lap's table every lap, and a lost one is corrected by the next. An empty
            // `rows` unfolds everything.
            if (!payload.isObject())
                return;
            std::vector<CycleRow> rows;
            if (const auto* list = payload.getProperty("rows", juce::var()).getArray())
            {
                for (const auto& item : *list)
                {
                    CycleRow row;
                    row.rowKey = cycleKeyOf(item.getProperty("row", "").toString());
                    row.idKey = cycleKeyOf(item.getProperty("id", "").toString());
                    row.bars = (double) item.getProperty("bars", 0.0);
                    row.phaseBars = (double) item.getProperty("phaseBars", 0.0);
                    rows.push_back(row);
                }
            }
            engine.stageCycles(rows, (bool) payload.getProperty("now", false));
        }
```

- [ ] **Step 4: Build and run the whole engine suite**

```bash
cd /Users/nickel/Claudecode/sssketch/native-engine && cmake --build build && SSSKETCH_GOLDEN_DIR=$PWD/test/golden build/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine --test
```

Expected: `All unit tests passed.` (The `!!! BridgeClient` / `!!! ChannelChainRegistry` lines are the existing leak-path tests' own logging.)

- [ ] **Step 5: Commit**

```bash
cd /Users/nickel/Claudecode/sssketch
git add native-engine/Source/Transport.h native-engine/Source/Transport.cpp native-engine/Source/IpcServer.cpp native-engine/Source/TransportTests.cpp
git commit -m "$(cat <<'EOF'
engine: the transport's lap clock, the cycles taken in the wrap's split, and stage-cycles over IPC

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz
EOF
)"
```

## Task 11: The main process — `engine-stage-cycles` and `alsoTraits` (sssketch)

**Files:**
- Modify: `src/main/discoverCandidates.ts`, `src/main/index.ts`, `src/preload/index.ts`
- Test: `src/main/discoverCandidates.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/main/discoverCandidates.test.ts`:

After:

```ts
    expect(c.traitPercentiles).toEqual({})
  })

```

Insert:

```ts
  it('alsoTraits (fold mode clash): a mask-only roll gets percentiles for the asked traits, nothing else changes', async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['d'])
    seedStem(own, 'd', 'jam1', { instrument: DRUM })
    seedFeatures(own, 'd', featuresJSON({ transientDensity: 0.5, spectralCentroidHz: 4000 }))
    seedFeatures(own, 'lib', featuresJSON({ transientDensity: 1, spectralCentroidHz: 400 }))

    const [c] = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      kinds: ['drums'],
      alsoTraits: ['rhythmic', 'bright']
    })
    expect(c.slotKinds).toEqual(['drums'])
    expect(Object.keys(c.traitPercentiles).sort()).toEqual(['bright', 'rhythmic'])
    expect(c.traitPercentiles.bright).toBeCloseTo(1)
  })

  it("alsoTraits on a trait-only roll adds to the slot's own kinds", async () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['s1'])
    seedStem(own, 's1', 'jam1')
    seedFeatures(own, 's1', featuresJSON({ transientDensity: 0.6, spectralCentroidHz: 900 }))

    const [c] = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      kinds: ['warm'],
      alsoTraits: ['rhythmic', 'bright']
    })
    expect(c.slotKinds).toEqual(['warm'])
    expect(c.traitValues).toEqual({ warm: 900, rhythmic: 0.6, bright: 900 })
  })

```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /Users/nickel/Claudecode/sssketch && npx vitest run src/main/discoverCandidates.test.ts`
Expected: FAIL — the two `alsoTraits` tests (the percentiles are `{}` / the values only `warm`).

- [ ] **Step 3: Attach the extra traits, and add the IPC**

In `src/main/discoverCandidates.ts`:

Find:

```ts
  onlyOwnStems = false,
  targetUser,
  soundSource = { endlesss: true, audioIn: true },
  artistStemCIDs
```

Replace with:

```ts
  onlyOwnStems = false,
  targetUser,
  soundSource = { endlesss: true, audioIn: true },
  artistStemCIDs,
  alsoTraits = []
```

After:

```ts
  ownDb: Database.Database
  jams: JamDbPair[]
  kinds: readonly DiscoverSlotKind[]
  onlyOwnStems?: boolean
  targetUser?: string
  soundSource?: DiscoverSoundSourceFilter
```

Insert:

```ts
  /** Radio fold mode's clash (@shared/radioClash): trait kinds to attach values and library
   * percentiles for even though the slot does not ask for them, so the clash can measure every
   * candidate against the bed. They never filter and never change `slotKinds`; empty (every
   * other roll) takes today's path untouched. */
  alsoTraits?: readonly DiscoverTraitKind[]
```

After:

```ts
  const traitKinds = normalized.filter(isTraitSlotKind)
```

Insert:

```ts
  // The slot's own trait kinds, then any the clash asks for on top (deduplicated, in order).
  const valueKinds = [...traitKinds, ...alsoTraits.filter((k) => !traitKinds.includes(k))]
```

After:

```ts
  if (maskKinds.length === 0) {
    if (traitKinds.length === 0) return []
```

Insert:

```ts
    const traitPool = await getTraitPoolCandidates({
      ownDb,
      jams,
      traitKinds,
      onlyOwnStems,
      targetUser,
      soundSource,
      artistStemCIDs
    })
```

Find:

```ts
      await getTraitPoolCandidates({
        ownDb,
        jams,
        traitKinds,
        onlyOwnStems,
        targetUser,
        soundSource,
        artistStemCIDs
      })
```

Replace with:

```ts
      valueKinds.length > traitKinds.length
        ? attachTraitValues(ownDb, traitPool, valueKinds)
        : traitPool
```

Find:

```ts
  return traitKinds.length > 0
    ? attachTraitPercentiles(ownDb, attachTraitValues(ownDb, pool, traitKinds))
```

Replace with:

```ts
  return valueKinds.length > 0
    ? attachTraitPercentiles(ownDb, attachTraitValues(ownDb, pool, valueKinds))
```

In `src/main/index.ts`:

Find:

```ts
import type { DiscoverSlotKind } from '@shared/discoverSlotKind'
```

Replace with:

```ts
import type { DiscoverSlotKind, DiscoverTraitKind } from '@shared/discoverSlotKind'
```

After:

```ts
    playbackEngine?.sendCancelStagedProject(token)
  })

```

Insert:

```ts
  // Radio fold mode (@shared/radioFold; native-engine/Source/CycleTable.h): the per-row cycles
  // for the next loop top, or for the next block with `now`. Fire-and-forget, like play/stop.
  ipcMain.handle(
    'engine-stage-cycles',
    (
      _event,
      rows: { row: string; id: string; bars: number; phaseBars: number }[],
      now: boolean
    ) => {
      playbackEngine?.client.send('stage-cycles', { rows, now })
    }
  )

```

Find:

```ts
      soundSource?: DiscoverSoundSourceFilter,
      artist?: string
```

Replace with:

```ts
      soundSource?: DiscoverSoundSourceFilter,
      artist?: string,
      alsoTraits?: DiscoverTraitKind[]
```

Find:

```ts
        onlyOwnStems,
        targetUser,
        soundSource,
        artistStemCIDs
```

Replace with:

```ts
        onlyOwnStems,
        targetUser,
        soundSource,
        artistStemCIDs,
        // Fold mode's clash (radioClash): the renderer only ever sends 'rhythmic' and 'bright'.
        alsoTraits: (alsoTraits ?? []).filter((k) => k === 'rhythmic' || k === 'bright')
```

In `src/preload/index.ts`:

Find:

```ts
import type { DiscoverSlotKind } from '@shared/discoverSlotKind'
```

Replace with:

```ts
import type { DiscoverSlotKind, DiscoverTraitKind } from '@shared/discoverSlotKind'
```

After:

```ts
    ipcRenderer.invoke('engine-cancel-staged-project', token),
```

Insert:

```ts
  /** Radio fold mode: the cycles each folded row plays from the next loop top (or the next block,
   * `now`); a row not named plays full length. `row` is the Discover slot id each stem carries
   * as its cycleRow, `id` the cycle's id (the same id keeps its phase), lengths in bars. */
  engineStageCycles: (
    rows: { row: string; id: string; bars: number; phaseBars: number }[],
    now: boolean
  ): Promise<void> => ipcRenderer.invoke('engine-stage-cycles', rows, now),
```

Find:

```ts
    soundSource?: DiscoverSoundSourceFilter,
    artist?: string
```

Replace with:

```ts
    soundSource?: DiscoverSoundSourceFilter,
    artist?: string,
    /** Radio fold mode's clash: trait percentiles to attach on top of the slot's own. */
    alsoTraits?: DiscoverTraitKind[]
```

Find:

```ts
      onlyOwnStems,
      targetUser,
      soundSource,
      artist
```

Replace with:

```ts
      onlyOwnStems,
      targetUser,
      soundSource,
      artist,
      alsoTraits
```

- [ ] **Step 4: Run, lint, typecheck**

```bash
cd /Users/nickel/Claudecode/sssketch && npx vitest run src/main/discoverCandidates.test.ts && npx prettier --write src/main/discoverCandidates.ts src/main/discoverCandidates.test.ts src/main/index.ts src/preload/index.ts && npx eslint src/main/discoverCandidates.ts src/main/discoverCandidates.test.ts src/main/index.ts src/preload/index.ts && npm run typecheck
```

Expected: 113 tests pass; clean.

- [ ] **Step 5: Commit**

```bash
cd /Users/nickel/Claudecode/sssketch
git add src/main/discoverCandidates.ts src/main/discoverCandidates.test.ts src/main/index.ts src/preload/index.ts
git commit -m "$(cat <<'EOF'
radio fold: engine-stage-cycles over IPC, and candidates carry rhythm and brightness percentiles for the clash

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz
EOF
)"
```

## Task 12: Discover radio folds (sssketch, `DiscoverPanel.tsx`)

React components are untested directly in this codebase (sssketch `CLAUDE.md`): this task is verified by typecheck, lint and the shared logic's own tests, and by Elling (Task 21). **Do not prettier the file**; the hunks are formatted.

What it does, in order of the edits: imports; the machine's refs and functions (`radioFoldRowsNow`, `radioFoldAtWrap`, `resetRadioFold`, `radioNextIntervalBars`, the mode-off effect), placed before `clearRadioTurnaround`; the wrap calls `radioFoldAtWrap` before the turnaround; every interval drawn in the clock effect goes through `radioNextIntervalBars`, and `startRadio`/the course change draw from the fold window while the mode is on; radio off and a course change reset the fold; the phrase end's roll prefers realignment tops; the preview build names folded rows, lays the drift lanes, the clash low-pass and the drift's dub sends, and leans the sound; a roll while radio runs in fold mode asks for the clash traits and ranks with the clash.

The four `nextRadioIntervalBarsInWindow(radioSettings.paceBars)` draws inside the radio clock effect all become `radioNextIntervalBars(loopBars)` (`loopBars` is in scope in each), and the two `nextRadioIntervalBarsInWindow(RADIO_PACE_BARS[pace])` draws in `startRadio` and `armRadioCourseChange` take `FOLD_PACE_BARS` while the mode is on.

**Files:**
- Modify: `src/renderer/src/components/DiscoverPanel.tsx`

- [ ] **Step 1: Make the edits**

In `src/renderer/src/components/DiscoverPanel.tsx`:

After:

```tsx
  isRadioEligibleSlot,
  nextRadioIntervalBarsInWindow,
```

Insert:

```tsx
  radioPaceWindowOf,
```

After:

```tsx
import { buildEngineProject, withoutDubThrows } from '@shared/buildEngineProject'
```

Insert:

```tsx
import {
  FOLD_PACE_BARS,
  createRadioFold,
  radioFoldIntervalBars,
  radioFoldTurnaroundRate,
  stepRadioFold,
  type RadioFoldRow,
  type RadioFoldState,
  type RadioFoldStep
} from '@shared/radioFold'
import {
  FOLD_DRIFT_ECHO,
  radioFoldCycleRows,
  radioFoldDriftCurves,
  radioFoldEngineRows,
  radioFoldSound
} from '@shared/radioFoldLanes'
import {
  CLASH_LOWPASS_CUTOFF,
  CLASH_TRAITS,
  radioClashAmount,
  radioClashBed,
  radioClashLowpassRow
} from '@shared/radioClash'
```

After:

```tsx
      stemAutomation[key] = { ...stemAutomation[key], volume: underMaster(key, shape) }
    }

```

Insert:

```tsx
    // RADIO FOLD MODE (@shared/radioFold): which stems name their row for the engine's cycle
    // table (a fold decided for one stem never folds another, and a row a stage is replacing is
    // never named), the drift's lanes over the lap, and the clash's low-pass. A stage lands on the
    // next top, so it carries the next lap's drift. After every gesture and turnaround above: a
    // filter already on a stem keeps it (no drift cutoff there), and sends take the max.
    const foldOn = radioOnRef.current && radioSettings.foldMode
    const foldStep = !foldOn ? null : stage ? radioFoldNextRef.current : radioFoldNowRef.current
    const stemCycleRows = new Map<string, string>()
    const foldDubSends = new Map<string, AutomationPoint[]>()
    if (foldOn) {
      const slotById = new Map(slotsRef.current.map((s) => [s.id, s]))
      const named = radioFoldCycleRows(
        [radioFoldNowRef.current, radioFoldNextRef.current],
        members.map((m) => ({ id: m.id, stemId: slotById.get(m.id)?.candidate?.stemCID ?? null })),
        new Set(stage?.changes.map((c) => c.slotId) ?? [])
      )
      const clashRow = radioClashLowpassRow(
        members.map((m) => ({
          id: m.id,
          bright: slotById.get(m.id)?.candidate?.traitPercentiles?.bright
        })),
        radioClashAmount(true, radioSettings.clash)
      )
      const ownSend = masterSendRef.current / 100
      members.forEach((m, i) => {
        const key = stemKey(rifff.groupId, i + 1)
        if (named.has(m.id)) stemCycleRows.set(key, m.id)
        const filtered =
          stemFilters[key] !== undefined || (stemAutomation[key]?.filterCutoff ?? []).length > 0
        if (m.id === clashRow && !filtered) {
          stemFilters[key] = { mode: 'lowpass', cutoff: CLASH_LOWPASS_CUTOFF, resonance: 0 }
        }
        const lap = foldStep?.drift[m.id]
        if (!lap || maxBarLength === undefined || !(maxBarLength > 0)) return
        const curves = radioFoldDriftCurves(lap, maxBarLength, ownSend)
        if (m.id !== clashRow && !filtered) {
          stemAutomation[key] = { ...stemAutomation[key], filterCutoff: curves.cutoff }
        }
        stemAutomation[key] = {
          ...stemAutomation[key],
          reverbSend: combineRadioCurves(
            stemAutomation[key]?.reverbSend ?? [],
            curves.send,
            'reverbSend'
          )
        }
        foldDubSends.set(key, curves.dub)
      })
    }

```

After:

```tsx
            rifff.groupId,
            maxBarLength,
            (4 * 60) / bpm
          )
        : undefined
```

Insert:

```tsx
    // A drift's dub sends join the throw's, on its echo; with no throw armed they open into
    // FOLD_DRIFT_ECHO. A throwing row keeps its throw.
    const dubSent =
      foldDubSends.size === 0
        ? dubThrows
        : {
            echo: dubThrows?.echo ?? FOLD_DRIFT_ECHO,
            sends: new Map([...foldDubSends, ...(dubThrows?.sends ?? [])])
          }
```

Find:

```tsx
      // explicit: initialState has none (absent is today's sound)
      sound: sound ?? appSoundDefaultsNow(),
```

Replace with:

```tsx
      // explicit: initialState has none (absent is today's sound)
      // fold mode's clash leans the master glue and saturation in (radioFoldSound)
      sound: radioFoldSound(sound ?? appSoundDefaultsNow(), foldOn, radioSettings.clash),
```

Find:

```tsx
        undefined,
        { stemPans, stemPumpRoles, dubThrows }
```

Replace with:

```tsx
        undefined,
        { stemPans, stemPumpRoles, dubThrows: dubSent, stemCycleRows }
```

Find:

```tsx
        dubThrows !== undefined ? withoutDubThrows(project) : project,
```

Replace with:

```tsx
        dubSent !== undefined ? withoutDubThrows(project) : project,
```

Find:

```tsx
      ...input,
      rate: radioSettings.turnarounds,
```

Replace with:

```tsx
      ...input,
      // a phrase ending on a fold's realignment top prefers a turnaround
      rate: radioFoldTurnaroundRate(
        radioSettings.turnarounds,
        radioSettings.foldMode && radioFoldNextRef.current?.marked === true
      ),
```

After:

```tsx
      radioTurnaroundRollPendingRef.current,
      radioTurnaroundRef.current !== null
    )
  }
```

Insert:

```tsx
  /** RADIO FOLD MODE (@shared/radioFold): the machine's state, and its decisions for the lap
   * playing now and for the next one -- it decides a lap ahead, at every wrap, so the engine can
   * take each lap's cycles exactly on its top (engineStageCycles; CycleTable.h). */
  const radioFoldRef = useRef<RadioFoldState | null>(null)
  const radioFoldNowRef = useRef<RadioFoldStep | null>(null)
  const radioFoldNextRef = useRef<RadioFoldStep | null>(null)
  /** The rows as fold mode sees them: every slot, in panel order (new folds draw by index). */
  function radioFoldRowsNow(): RadioFoldRow[] {
    const previewing = previewingSlotIdsRef.current
    return slotsRef.current.map((s) => ({
      id: s.id,
      stemId: s.candidate?.stemCID ?? null,
      kinds: s.kinds,
      barLength: resolvedBarLengthsRef.current.get(s.id) ?? 0,
      hooked: radioSlotFlagsRef.current[s.id] === 'hook',
      audible: previewing.has(s.id) && resolvedBarLengthsRef.current.has(s.id),
      percussive: resolvedStemsRef.current.get(s.id)?.type === 'drums'
    }))
  }
  /** Every wrap while radio runs: the lap starting now plays what was decided a lap ago, the
   * machine decides the next lap, and the engine gets that lap's cycles to take at its top. With
   * the mode or radio off, a fold still around is put away. A new seed starts a new machine. */
  function radioFoldAtWrap(loopBars: number): void {
    if (!radioOnRef.current || !radioSettings.foldMode) {
      if (radioFoldRef.current !== null || radioFoldNowRef.current !== null) resetRadioFold()
      return
    }
    radioFoldNowRef.current = radioFoldNextRef.current
    const was = radioFoldRef.current
    const state =
      was !== null && was.seed === radioSettings.foldSeed
        ? was
        : createRadioFold(radioSettings.foldSeed)
    const step = stepRadioFold(state, {
      rows: radioFoldRowsNow(),
      loopBars,
      bpm,
      fold: radioSettings.fold
    })
    radioFoldRef.current = step.state
    radioFoldNextRef.current = step
    void window.rifffApi.engineStageCycles(radioFoldEngineRows(step), false)
    // the lap now playing has its own drift lanes
    scheduleSyncPreviewToEngine(previewingSlotIdsRef.current)
  }
  /** Fold mode put away at once: every row full length from the next block, no drift, no lean. */
  function resetRadioFold(): void {
    const had = radioFoldRef.current !== null || radioFoldNowRef.current !== null
    radioFoldRef.current = null
    radioFoldNowRef.current = null
    radioFoldNextRef.current = null
    void window.rifffApi.engineStageCycles([], true)
    if (had) scheduleSyncPreviewToEngine(previewingSlotIdsRef.current)
  }
  /** A change's interval: fold mode's window, moved to a realignment top when one is near, while
   * the mode is on (radioPaceWindowOf, radioFoldIntervalBars); the pace window otherwise. */
  function radioNextIntervalBars(loopBars: number): number {
    const drawn = nextRadioIntervalBarsInWindow(radioPaceWindowOf(radioSettings))
    return radioSettings.foldMode
      ? radioFoldIntervalBars(radioFoldRef.current, drawn, loopBars)
      : drawn
  }
  // The mode going off while radio runs: every row back to full length at the next loop top
  // (an empty table staged for it); the drift and the lean leave with the wrap's push.
  useEffect(() => {
    if (radioSettings.foldMode || radioFoldRef.current === null) return
    radioFoldRef.current = null
    radioFoldNextRef.current = null
    void window.rifffApi.engineStageCycles([], false)
  }, [radioSettings.foldMode])
```

After:

```tsx
    // stem is given up once its move could no longer reach the engine in time.
```

Insert:

```tsx
    // Fold mode decides the next lap first: the roll reads whether its phrase ends on a
    // realignment top (radioFoldTurnaroundRate).
    if (step.wrapped) radioFoldAtWrap(loopBars)
```

Find:

```tsx
            step.clock,
            nextRadioIntervalBarsInWindow(radioSettings.paceBars),
```

Replace with:

```tsx
            step.clock,
            radioNextIntervalBars(loopBars),
```

Find:

```tsx
            nextRadioIntervalBarsInWindow(radioSettings.paceBars),
```

Replace with:

```tsx
            radioNextIntervalBars(loopBars),
```

Find:

```tsx
        nextRadioIntervalBarsInWindow(radioSettings.paceBars),
```

Replace with:

```tsx
        radioNextIntervalBars(loopBars),
```

Find:

```tsx
      nextRadioIntervalBarsInWindow(radioSettings.paceBars),
```

Replace with:

```tsx
      radioNextIntervalBars(loopBars),
```

After:

```tsx
      // source has fresh stems to offer.
      const draw = drawSoundSource(sourceLeanRef.current)
```

Insert:

```tsx
      // Fold mode's clash (@shared/radioClash), while radio runs: every candidate carries its
      // rhythm and brightness percentiles, and the ranking turns away from the bed's.
      const clashAmount = radioOnRef.current
        ? radioClashAmount(radioSettings.foldMode, radioSettings.clash)
        : 0
      const alsoTraits = clashAmount > 0 ? [...CLASH_TRAITS] : undefined
```

Find:

```tsx
          f.onlyOwnStems,
          f.targetUser,
          draw.first,
          f.artist
```

Replace with:

```tsx
          f.onlyOwnStems,
          f.targetUser,
          draw.first,
          f.artist,
          alsoTraits
```

Find:

```tsx
            f.onlyOwnStems,
            f.targetUser,
            draw.fallback,
            f.artist
```

Replace with:

```tsx
            f.onlyOwnStems,
            f.targetUser,
            draw.fallback,
            f.artist,
            alsoTraits
```

Find:

```tsx
        // now adds its library percentile (rankCandidates).
        targetTraits
```

Replace with:

```tsx
        // now adds its library percentile (rankCandidates).
        targetTraits,
        ...(clashAmount > 0
          ? {
              clash: {
                amount: clashAmount,
                bed: radioClashBed(
                  slotsRef.current
                    .filter((s) => s.id !== id && previewingSlotIdsRef.current.has(s.id))
                    .map((s) => s.candidate?.traitPercentiles ?? {})
                )
              }
            }
          : {})
```

After:

```tsx
    cancelStagedSwap('radio-off')
    clearRadioGesture()
    clearRadioTurnaround()
```

Insert:

```tsx
    resetRadioFold()
```

Find:

```tsx
    // there is no absolute bar 0 to count from.
    radioClockRef.current = createRadioClock(
      nextRadioIntervalBarsInWindow(RADIO_PACE_BARS[pace]),
```

Replace with:

```tsx
    // there is no absolute bar 0 to count from.
    radioClockRef.current = createRadioClock(
      nextRadioIntervalBarsInWindow(
        radioSettings.foldMode ? FOLD_PACE_BARS : RADIO_PACE_BARS[pace]
      ),
```

Find:

```tsx
      nextRadioIntervalBarsInWindow(RADIO_PACE_BARS[pace]),
```

Replace with:

```tsx
      nextRadioIntervalBarsInWindow(
        radioSettings.foldMode ? FOLD_PACE_BARS : RADIO_PACE_BARS[pace]
      ),
```

After:

```tsx
    cancelStagedSwap('course-change')
    clearRadioGesture()
    clearRadioTurnaround()
```

Insert:

```tsx
    resetRadioFold()
```

- [ ] **Step 2: Typecheck, lint, run the radio suites**

```bash
cd /Users/nickel/Claudecode/sssketch && npm run typecheck && npx eslint src/renderer/src/components/DiscoverPanel.tsx && npx vitest run src/shared
```

Expected: typecheck clean; eslint prints only the `[BABEL] Note: ... deoptimised the styling` line (the file is over 500 KB; it always does); the shared suites pass.

- [ ] **Step 3: Commit**

```bash
cd /Users/nickel/Claudecode/sssketch
git add src/renderer/src/components/DiscoverPanel.tsx
git commit -m "$(cat <<'EOF'
radio fold: Discover's radio folds -- the machine at every wrap, cycles staged for the top, fold-mode pace, drift lanes, the clash

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz
EOF
)"
```

## Task 13: The radio menu's `fold` section (sssketch, `DiscoverRadioMenu.tsx`)

A `fold` row (off/on) while radio runs; with it on, `how folded` and `clash` sliders (committed when the drag or key press ends, so a drag does not write the settings file every step) and the `seed` field with `new`. All copy lowercase. **Do not prettier the file.**

**Files:**
- Modify: `src/renderer/src/components/DiscoverRadioMenu.tsx`

- [ ] **Step 1: Make the edits**

In `src/renderer/src/components/DiscoverRadioMenu.tsx`:

After:

```tsx
import { RADIO_TRANSITIONS_OPTIONS } from '@shared/radioTransition'
```

Insert:

```tsx
import { FOLD_SEED_ALPHABET, FOLD_SEED_LENGTH, newFoldSeed } from '@shared/radioFold'

/** A fold fader, 0..100. Local while dragging, and committed (persisted) only when the drag or
 * key press ends: every step of a drag would otherwise write the settings file. */
function FoldSlider({
  label,
  value,
  onCommit
}: {
  label: string
  value: number
  onCommit: (v: number) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState<number | null>(null)
  const commit = (): void => {
    if (draft !== null && draft !== value) onCommit(draft)
    setDraft(null)
  }
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        aria-label={label}
        value={draft ?? value}
        onChange={(e) => setDraft(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
        style={{ width: 96, accentColor: 'var(--ra-text)' }}
      />
      <span style={{ fontSize: 9, minWidth: 20, textAlign: 'right', color: 'var(--ra-text)' }}>
        {draft ?? value}
      </span>
    </span>
  )
}

/** The fold seed: six characters, typed or pasted, committed on enter or when focus leaves.
 * Anything that does not clean up to six characters of the alphabet goes back to the seed in use. */
function FoldSeedInput({
  value,
  onCommit
}: {
  value: string
  onCommit: (seed: string) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = (): void => {
    if (draft !== null) {
      // the same cleaning as normalizeFoldSeed, but nothing falls back to the default here
      const kept = [...draft.trim().toLowerCase()]
        .filter((ch) => FOLD_SEED_ALPHABET.includes(ch))
        .join('')
      if (kept.length === FOLD_SEED_LENGTH && kept !== value) onCommit(kept)
    }
    setDraft(null)
  }
  return (
    <input
      key="seed"
      aria-label="fold seed"
      value={draft ?? value}
      maxLength={FOLD_SEED_LENGTH + 4}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
      }}
      onBlur={commit}
      style={{
        fontFamily: 'inherit',
        fontSize: 9,
        width: 56,
        padding: 'var(--ra-s-0) 4px',
        background: 'transparent',
        border: '1px solid var(--ra-border)',
        color: 'var(--ra-text)'
      }}
    />
  )
}
```

After:

```tsx
            chip(t, settings.transitions === t, () => onChange({ transitions: t }))
          )
        )}
```

Insert:

```tsx
      {/* Fold mode (@shared/radioFold): one anchor at full length, one or two short rhythmic
          rows looping at odd lengths against it and realigning every 30-120 s; seeded rules, so
          a seed replays them. Only meaningful while radio runs, so only shown then. */}
      {mode === 'running' &&
        row(
          'fold',
          [
            chip('off', !settings.foldMode, () => onChange({ foldMode: false })),
            chip('on', settings.foldMode, () => onChange({ foldMode: true }))
          ],
          'layers in other time signatures'
        )}
      {mode === 'running' &&
        settings.foldMode &&
        row(
          'how folded',
          [
            <FoldSlider
              key="fold"
              label="how folded"
              value={settings.fold}
              onCommit={(v) => onChange({ fold: v })}
            />
          ],
          '0 is always straight'
        )}
      {mode === 'running' &&
        settings.foldMode &&
        row(
          'clash',
          [
            <FoldSlider
              key="clash"
              label="how mismatched"
              value={settings.clash}
              onCommit={(v) => onChange({ clash: v })}
            />
          ],
          'how mismatched'
        )}
      {mode === 'running' &&
        settings.foldMode &&
        row(
          'seed',
          [
            <FoldSeedInput
              key="seed"
              value={settings.foldSeed}
              onCommit={(seed) => onChange({ foldSeed: seed })}
            />,
            chip('new', false, () => onChange({ foldSeed: newFoldSeed() }))
          ],
          'the same seed replays the same rules. the stems also depend on the library, so a changed library can pick different ones'
        )}
```

Find:

```tsx
          : 'a new pace restarts the loop, keeping these stems. a layer longer than loop end changes at the top of the loop, a shorter one on its own cycle. phrase holds every change back to a 16 or 32 bar boundary, counted from where radio started. transitions decide how a layer arrives, and a hole or a riser holds its change to the top of the loop. density arc grows the rows to four or five and thins them to two or three, only ever removing rows radio added. turnarounds mark the end of each phrase'}
```

Replace with:

```tsx
          : 'a new pace restarts the loop, keeping these stems. a layer longer than loop end changes at the top of the loop, a shorter one on its own cycle. phrase holds every change back to a 16 or 32 bar boundary, counted from where radio started. transitions decide how a layer arrives, and a hole or a riser holds its change to the top of the loop. density arc grows the rows to four or five and thins them to two or three, only ever removing rows radio added. turnarounds mark the end of each phrase. fold loops one or two short layers at odd lengths against the beat, and changes come every 16 to 64 bars while it is on'}
```

- [ ] **Step 2: Typecheck and lint**

```bash
cd /Users/nickel/Claudecode/sssketch && npm run typecheck && npx eslint src/renderer/src/components/DiscoverRadioMenu.tsx
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
cd /Users/nickel/Claudecode/sssketch
git add src/renderer/src/components/DiscoverRadioMenu.tsx
git commit -m "$(cat <<'EOF'
radio menu: the fold section -- the switch, how folded, clash, and the seed with new

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz
EOF
)"
```

## Task 14: The phone's fold switch (sssketch)

**Files:**
- Modify: `src/shared/remoteState.ts`, `src/main/remoteServer.ts`, `src/main/remotePage.ts`, `src/renderer/src/components/DiscoverPanel.tsx`
- Test: `src/shared/remoteState.test.ts`, `src/main/remoteServer.test.ts`, `src/main/remotePage.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/shared/remoteState.test.ts`:

After:

```ts
  parseRemoteSlotAction,
  parseRemoteSlotKinds,
```

Insert:

```ts
  parseRemoteFold,
```

After:

```ts
      lastKeptName: 'misty kestrel',
      loopBars: 8,
      radio: null,
```

Insert:

```ts
      fold: null,
```

After:

```ts
    expect(remoteTurnAnswer({ ...turn, canTurn: false }, null)).toBe('nothing to turn')
  })
})
```

Insert:

```ts

describe('the fold switch in the remote state', () => {
  const meta = {
    discoverOpen: true,
    playing: true,
    kept: 0,
    rolled: 0,
    lastKeptName: null,
    loopBars: 8
  }

  it('passes the switch through while radio runs, and null otherwise', () => {
    expect(remoteStateFromSlots([], { ...meta, fold: true }).fold).toBe(true)
    expect(remoteStateFromSlots([], { ...meta, fold: false }).fold).toBe(false)
    expect(remoteStateFromSlots([], { ...meta, fold: null }).fold).toBeNull()
    expect(remoteStateFromSlots([], meta).fold).toBeNull()
  })

  it('parseRemoteFold takes only a boolean', () => {
    expect(parseRemoteFold(true)).toBe(true)
    expect(parseRemoteFold(false)).toBe(false)
    for (const v of ['true', 1, null, undefined, {}]) expect(parseRemoteFold(v)).toBeNull()
  })
})
```

In `src/main/remoteServer.test.ts`:

After:

```ts
      '{}'
    )
    expect(res.status).toBe(401)
    expect(commands).toEqual([])
  })
})
```

Insert:

```ts

describe('the fold route', () => {
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
  async function fold(port: number, token: string, body: unknown): Promise<RawResponse> {
    return send(
      port,
      '/api/fold',
      {
        host: `192.168.1.40:${port}`,
        'content-type': 'application/json',
        authorization: `Bearer ${token}`
      },
      'POST',
      JSON.stringify(body)
    )
  }
  const radioOn =
    (on: boolean): RemoteServerOptions['getState'] =>
    () => ({
      discoverOpen: true,
      playing: true,
      kept: 0,
      rolled: 0,
      lastKeptName: null,
      loopBars: 8,
      radio: null,
      fold: on,
      slots: [],
      loopId: null
    })

  it('forwards on and off while radio runs', async () => {
    const { port, pairingCode } = await start({ getState: radioOn(false) })
    const token = await pairedToken(port, pairingCode)
    const on = await fold(port, token, { on: true })
    expect(on.status).toBe(200)
    expect(JSON.parse(on.body)).toEqual({ answer: 'fold on' })
    expect((await fold(port, token, { on: false })).status).toBe(200)
    expect(commands).toEqual([
      { kind: 'fold', on: true },
      { kind: 'fold', on: false }
    ])
  })

  it('answers 409 radio off with radio off, and forwards nothing', async () => {
    const { port, pairingCode } = await start()
    const res = await fold(port, await pairedToken(port, pairingCode), { on: true })
    expect(res.status).toBe(409)
    expect(JSON.parse(res.body)).toEqual({ answer: 'radio off' })
    expect(commands).toEqual([])
  })

  it('refuses anything but a boolean, and forwards nothing', async () => {
    const { port, pairingCode } = await start({ getState: radioOn(false) })
    const token = await pairedToken(port, pairingCode)
    for (const on of ['true', 1, null]) expect((await fold(port, token, { on })).status).toBe(400)
    expect((await fold(port, token, {})).status).toBe(400)
    expect(commands).toEqual([])
  })

  it('tells an unpaired caller nothing about the route existing', async () => {
    const { port } = await start({ getState: radioOn(true) })
    const res = await send(
      port,
      '/api/fold',
      { host: `192.168.1.40:${port}`, 'content-type': 'application/json' },
      'POST',
      '{}'
    )
    expect(res.status).toBe(401)
    expect(commands).toEqual([])
  })
})
```

In `src/main/remotePage.test.ts`:

After:

```ts
    expect(posts.sort()).toEqual([
      "api('/api/add-slot'",
```

Insert:

```ts
      "api('/api/fold'",
```

After:

```ts
    expect(REMOTE_PAGE_HTML).toContain('paintTurn(state.turn)')
  })
})
```

Insert:

```ts

describe('the fold switch', () => {
  it('sits in the loop block under the handover chips, hidden until radio runs', () => {
    const loopBlock = (/<div id="loop" hidden>[\s\S]*?<\/div>\s*<div class="eyebrow foot"/.exec(
      REMOTE_PAGE_HTML
    ) ?? [''])[0]
    expect(loopBlock).toContain('<div class="swapgrid" id="fold-row" hidden>')
    expect(loopBlock.indexOf('id="chips-xfade"')).toBeLessThan(loopBlock.indexOf('id="chips-fold"'))
  })

  it('paints from the state, a boolean or nothing, and posts only a change', () => {
    expect(REMOTE_PAGE_HTML).toContain(
      "foldState = typeof state.fold === 'boolean' ? state.fold : null"
    )
    expect(REMOTE_PAGE_HTML).toContain("api('/api/fold', { on: on })")
    expect(REMOTE_PAGE_HTML).toContain('if (foldState === null || foldState === on) return')
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /Users/nickel/Claudecode/sssketch && npx vitest run src/shared/remoteState.test.ts src/main/remoteServer.test.ts src/main/remotePage.test.ts`
Expected: FAIL — `parseRemoteFold` is not exported, the state has no `fold`, `/api/fold` answers 401, the page has no `fold-row`.

- [ ] **Step 3: The state, the route, the page, and the panel's half**

In `src/shared/remoteState.ts`:

After:

```ts
   * has nothing armed says. The phone marks no row at all for null. */
  radio: RemoteRadioView | null
```

Insert:

```ts
  /** Radio fold mode's switch (@shared/radioFold): on or off while radio runs; null or absent
   * while radio is off (an older Mac never sends it). The phone shows the switch only then, and
   * POST /api/fold answers from it. A boolean names nothing, so the boundary is unchanged. */
  fold?: boolean | null
```

After:

```ts
   * what leaves is always drawable. */
  radio?: RemoteRadioView | null
```

Insert:

```ts
  /** Fold mode's switch while radio runs; absent or null while it is off. */
  fold?: boolean | null
```

After:

```ts
    radio: normalizeRemoteRadio(meta.radio ?? null, slots),
```

Insert:

```ts
    fold: typeof meta.fold === 'boolean' ? meta.fold : null,
```

After:

```ts
  | { kind: 'slot-action'; slotId: string; action: RemoteSlotAction }
```

Insert:

```ts
  /** Radio fold mode on or off (2026-10-02). Forwarded only while radio runs. */
  | { kind: 'fold'; on: boolean }
```

After:

```ts
   * (2026-10-02). Forwarded only when remoteTurnAnswer says `turning`. */
  | { kind: 'turn'; move?: TurnaroundMove }
```

Insert:

```ts

/** The fold switch's body (`{ on }`): only a boolean is an answer; anything else is null, and the
 * route refuses the request (the same rule as parseRemoteSlotKinds). */
export function parseRemoteFold(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}
```

In `src/main/remoteServer.ts`:

After:

```ts
  parseRemoteSlotAction,
  parseRemoteSlotKinds,
```

Insert:

```ts
  parseRemoteFold,
```

Find:

```ts
 * Ten api routes, plus GET / itself, and no route takes or returns a
 * filesystem path or reads the library. (The count in this comment was
 * already one behind before /api/stem: a596b39's /api/slot-action made
 * seven into eight, /api/stem makes it nine, and /api/turn ten.)
```

Replace with:

```ts
 * Eleven api routes, plus GET / itself, and no route takes or returns a
 * filesystem path or reads the library. (The count in this comment was
 * already one behind before /api/stem: a596b39's /api/slot-action made
 * seven into eight, /api/stem makes it nine, /api/turn ten, and /api/fold eleven.)
```

After:

```ts
      // move is a 400, as an unknown kind is on /api/add-slot.
```

Insert:

```ts
      // Radio fold mode's switch (2026-10-02): `{ on }`, a boolean or a 400. 409 with radio off,
      // the switch then not being there to throw; otherwise forwarded.
      if (req.method === 'POST' && url === '/api/fold') {
        const on = parseRemoteFold((await readJsonBody(req)).on)
        if (on === null) return respond(res, 400)
        const fold = options.getState().fold
        if (fold === null || fold === undefined) return respond(res, 409, { answer: 'radio off' })
        options.onCommand({ kind: 'fold', on })
        return respond(res, 200, { answer: on ? 'fold on' : 'fold off' })
      }

```

In `src/main/remotePage.ts` (the page is one template literal: no backticks in the added script):

After:

```ts
        <div class="chips grid" id="chips-xfade"></div>
```

Insert:

```ts
      </div>
      <!-- Radio fold mode's switch (2026-10-02): the one radio setting the phone has, shown only
           while radio runs on the mac. -->
      <div class="swapgrid" id="fold-row" hidden>
        <div class="eyebrow">fold</div>
        <div class="chips grid" id="chips-fold"></div>
```

After:

```ts
    xfadeChipsEl.appendChild(chip)
  })
  paintXfadeChips()

```

Insert:

```ts
  // --- radio fold mode's switch -------------------------------------------
  // Two chips, off and on, shown only while radio runs on the mac (the state's
  // fold field is a boolean then, null otherwise). A tap posts /api/fold; the next
  // poll paints what the mac says, so a lost tap never shows as taken.
  var foldRowEl = document.getElementById('fold-row')
  var foldChipsEl = document.getElementById('chips-fold')
  var foldState = null
  var foldChipEls = []

  function paintFold() {
    foldRowEl.hidden = foldState === null
    foldChipEls[0].className = foldState === false ? 'chip on' : 'chip'
    foldChipEls[1].className = foldState === true ? 'chip on' : 'chip'
  }

  ;[false, true].forEach(function (on) {
    var chip = document.createElement('button')
    chip.className = 'chip'
    chip.textContent = on ? 'on' : 'off'
    chip.addEventListener('click', function () {
      if (foldState === null || foldState === on) return
      api('/api/fold', { on: on })
    })
    foldChipEls.push(chip)
    foldChipsEl.appendChild(chip)
  })
  paintFold()

```

After:

```ts
    // that has never heard of it, which is the same no-mark either way.
    radioAhead = state.radio || null
```

Insert:

```ts
    // Fold mode's switch: a boolean while radio runs, null (hidden) otherwise -- and from an
    // older mac, which never sends it.
    foldState = typeof state.fold === 'boolean' ? state.fold : null
    paintFold()
```

In `src/renderer/src/components/DiscoverPanel.tsx` (do not prettier it):

After:

```tsx
          lastKeptName,
          loopBars,
          radio: radioRemote,
```

Insert:

```tsx
          // fold mode's switch, while radio runs (the phone's one radio setting)
          fold: radioOn ? radioSettings.foldMode : null,
```

After:

```tsx
    lastKeptName,
    remotePeaksTick,
    radioRemote,
```

Insert:

```tsx
    radioOn,
    radioSettings.foldMode,
```

After:

```tsx
      else if (command.kind === 'slot-action') runSlotAction(command.slotId, command.action)
```

Insert:

```tsx
      // Fold mode's switch (2026-10-02): the same setter the radio menu's chips call.
      else if (command.kind === 'fold') void onRadioSettingsChange({ foldMode: command.on })
```

- [ ] **Step 4: Run, lint, typecheck**

```bash
cd /Users/nickel/Claudecode/sssketch && npx vitest run src/shared/remoteState.test.ts src/main/remoteServer.test.ts src/main/remotePage.test.ts && npx prettier --write src/shared/remoteState.ts src/shared/remoteState.test.ts src/main/remoteServer.ts src/main/remoteServer.test.ts src/main/remotePage.ts src/main/remotePage.test.ts && npx eslint src/shared/remoteState.ts src/shared/remoteState.test.ts src/main/remoteServer.ts src/main/remoteServer.test.ts src/main/remotePage.ts src/main/remotePage.test.ts src/renderer/src/components/DiscoverPanel.tsx && npm run typecheck
```

Expected: all pass; clean (bar the BABEL note).

- [ ] **Step 5: Commit**

```bash
cd /Users/nickel/Claudecode/sssketch
git add src/shared/remoteState.ts src/shared/remoteState.test.ts src/main/remoteServer.ts src/main/remoteServer.test.ts src/main/remotePage.ts src/main/remotePage.test.ts src/renderer/src/components/DiscoverPanel.tsx
git commit -m "$(cat <<'EOF'
phone: radio fold mode's switch -- shown while radio runs, POST /api/fold, the panel's own setter

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz
EOF
)"
```

## Task 15: The web timeline folds a row (ell.ing/radio, pure)

**Files:**
- Modify: `src/audio/schedule.ts`, `src/audio/timeline.ts`
- Test: `src/audio/schedule.test.ts`, `src/audio/timeline.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/audio/schedule.test.ts`:

After:

```ts
  it('exports the native anti-click length, 3 ms (FadeGain.cpp:17)', () => {
    expect(ANTI_CLICK_SEC).toBe(0.003)
  })
})
```

Insert:

```ts

describe('planVoices: a folded row (radio fold mode)', () => {
  // 120 bpm: a bar is 2 s, a beat 0.5 s; a 4-bar loop is 8 s. A 7-beat cycle is 3.5 s.
  const clocks: LoopClockState[] = [{ startTime: S, loopBars: 4, bpm: BPM }]
  const a = stem(2)
  const fold = (phaseBars = 0): Assignment<typeof a>[] => [
    { from: S, stem: a, cycle: { id: 'perc~1', bars: 7 / 4, phaseBars, origin: S } }
  ]

  it('plays one voice per cycle, each from the cycle start, fading over the seam', () => {
    const v = planVoices(clocks, fold(), S, S + 8)
    expect(v.map((x) => [x.start - S, x.end - S, x.offset])).toEqual([
      [0, 3.5, 0],
      [3.5, 7, 0],
      [7, 8, 0]
    ])
    expect(v[0].fadeIn).toBe('seam')
    expect(v[0].fadeOut).toBe('seam')
    expect(v[1].fadeIn).toBe('seam')
    expect(v[0].cycle?.id).toBe('perc~1')
  })

  it('runs on across the loop top instead of restarting with it', () => {
    const v = planVoices(clocks, fold(), S, S + 12)
    const atTop = v.find((x) => Math.abs(x.start - (S + 8)) < 1e-9)!
    expect(atTop.offset).toBeCloseTo(1) // 8 s into a 3.5 s grid
    expect(atTop.end - S).toBeCloseTo(10.5)
    // the voice before the top hands over without a cut: the audio carries on
    const before = v.find((x) => Math.abs(x.end - (S + 8)) < 1e-9)!
    expect(before.fadeOut).toBe('xfade')
    expect(atTop.fadeIn).toBe('xfade')
  })

  it('a phase offset starts every cycle that much later', () => {
    const v = planVoices(clocks, fold(0.25), S, S + 4) // a beat: 0.5 s
    expect(v[0].offset).toBeCloseTo(3) // the tail of the cycle before
    expect(v[0].end - S).toBeCloseTo(0.5)
    expect(v[1].start - S).toBeCloseTo(0.5)
    expect(v[1].offset).toBe(0)
  })

  it('an unfolded row is exactly as before', () => {
    const plain: Assignment<typeof a>[] = [{ from: S, stem: a }]
    const v = planVoices(clocks, plain, S, S + 8)
    expect(v.every((x) => x.cycle === undefined && x.fadeIn !== 'seam' && x.fadeOut !== 'seam')).toBe(true)
  })
})
```

In `src/audio/timeline.test.ts`:

After:

```ts
    expect(log.held()).toEqual([`${b.stemId}@120`])
  })
})
```

Insert:

```ts

describe('Timeline: setCycles (radio fold mode)', () => {
  it('folds a row from a loop top; the loop and its clocks do not change', () => {
    const { tl, a } = started()
    tl.setCycles(8.1, [{ rowId: 'a', id: 'a~1', bars: 1.75, phaseBars: 0, stemId: a.stemId }], 1, MIN)
    const row = tl.rows.get('a')!
    expect(row[row.length - 1]).toEqual({ from: 8.1, stem: a, cycle: { id: 'a~1', bars: 1.75, phaseBars: 0, origin: 8.1 } })
    expect(tl.clocks).toEqual([{ startTime: 0.1, loopBars: 4, bpm: BPM }])
  })

  it('the same cycle id carries on from its first top; a new id starts on the new top', () => {
    const { tl, a } = started()
    tl.setCycles(8.1, [{ rowId: 'a', id: 'a~1', bars: 1.75, phaseBars: 0 }], 1, MIN)
    tl.setCycles(16.1, [{ rowId: 'a', id: 'a~1', bars: 1.75, phaseBars: 0 }], 9, MIN)
    expect(tl.rows.get('a')!.filter((x) => x.cycle).map((x) => x.cycle!.origin)).toEqual([8.1])
    tl.setCycles(24.1, [{ rowId: 'a', id: 'a~2', bars: 1.5, phaseBars: 0 }], 17, MIN)
    expect(tl.rows.get('a')![tl.rows.get('a')!.length - 1].cycle).toEqual({ id: 'a~2', bars: 1.5, phaseBars: 0, origin: 24.1 })
    expect(tl.stemAt('a', 30)).toBe(a)
  })

  it('a row left out unfolds at that top; a fold decided for another stem is left out', () => {
    const { tl, a } = started()
    tl.setCycles(8.1, [{ rowId: 'a', id: 'a~1', bars: 1.75, phaseBars: 0 }], 1, MIN)
    tl.setCycles(16.1, [], 9, MIN)
    const last = tl.rows.get('a')![tl.rows.get('a')!.length - 1]
    expect(last).toEqual({ from: 16.1, stem: a })
    tl.setCycles(24.1, [{ rowId: 'a', id: 'a~3', bars: 1.75, phaseBars: 0, stemId: 'another' }], 17, MIN)
    expect(tl.rows.get('a')!.some((x) => x.from === 24.1)).toBe(false)
  })

  it('refuses a time that is not a loop top, and changes nothing', () => {
    const { tl } = started()
    const before = JSON.stringify([...tl.rows])
    expect(() => tl.setCycles(5, [{ rowId: 'a', id: 'a~1', bars: 1.75, phaseBars: 0 }], 1, MIN)).toThrow(RangeError)
    expect(JSON.stringify([...tl.rows])).toBe(before)
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /Users/nickel/Claudecode/ell.ing/radio && npx vitest run src/audio/schedule.test.ts src/audio/timeline.test.ts`
Expected: FAIL — one voice per lap where cycles are expected; `tl.setCycles is not a function`.

- [ ] **Step 3: Cycle voices and `setCycles`**

In `src/audio/schedule.ts`:

After:

```ts
//   between the old source's position and the new one's 0 cannot tick.
import {
  LOOP_CLOCK_EPSILON_SEC as EPS,
```

Insert:

```ts
  freeRunOffset,
```

After:

```ts
  secPerBar,
  type LoopClockState
} from './loopClock'
```

Insert:

```ts
import { FOLD_SEAM_FADE_SEC } from '@shared/radioFold'
```

After:

```ts
/** Overlap for a seamless lap-to-lap restart (see 'xfade' above). */
export const XFADE_SEC = 0.003
```

Insert:

```ts
/** A folded row's cycle seam (radio fold mode, @shared/radioFold): the cut back to the cycle's
 * start is a jump in the audio, so each cycle fades in and out over this long ('seam'). */
export const SEAM_FADE_SEC = FOLD_SEAM_FADE_SEC
```

Find:

```ts
/** A row plays `stem` from `from` (null: silent from then on). */
```

Replace with:

```ts
/** Radio fold mode: a row looping only the first `bars` of its stem, on a grid that started at
 * the loop top `origin` (plus `phaseBars`) and runs on across loop tops. `id` is the fold's cycle
 * id: the same id is the same running cycle. */
export interface CycleSpec {
  id: string
  bars: number
  phaseBars: number
  origin: number
}

/** A row plays `stem` from `from` (null: silent from then on), folded to `cycle` when it has one. */
```

Find:

```ts
  stem: S | null
}

export type Edge = 'fade' | 'xfade'
```

Replace with:

```ts
  stem: S | null
  cycle?: CycleSpec
}

export type Edge = 'fade' | 'xfade' | 'seam'
```

After:

```ts
   * XFADE_SEC past it ('xfade'). */
  end: number
  fadeIn: Edge
  fadeOut: Edge
```

Insert:

```ts
  /** The fold this voice plays one cycle (or part of one) of; absent for a whole-stem voice. */
  cycle?: CycleSpec
```

Find:

```ts
/** The stem a row plays at `t`, null before its first assignment or after a removal. */
export function stemAt<S>(assignments: readonly Assignment<S>[], t: number): S | null {
  let s: S | null = null
  for (const a of assignments) if (a.from <= t + EPS) s = a.stem
  return s
```

Replace with:

```ts
/** The assignment in force at `t`, null before the first. */
export function assignmentAt<S>(assignments: readonly Assignment<S>[], t: number): Assignment<S> | null {
  let found: Assignment<S> | null = null
  for (const a of assignments) if (a.from <= t + EPS) found = a
  return found
}

/** The stem a row plays at `t`, null before its first assignment or after a removal. */
export function stemAt<S>(assignments: readonly Assignment<S>[], t: number): S | null {
  return assignmentAt(assignments, t)?.stem ?? null
}

/** A cycle's length in seconds at `bpm`. */
export function cycleSec(cycle: CycleSpec, bpm: number): number {
  return cycle.bars * secPerBar(bpm)
}

/** Seconds into its cycle a folded row is at `t`: in [0, cycleSec). */
export function cycleOffset(t: number, cycle: CycleSpec, bpm: number): number {
  return freeRunOffset(t, cycle.origin + cycle.phaseBars * secPerBar(bpm), cycle.bars, bpm)
```

After:

```ts
  stem: S | null
  clock: LoopClockState
  offset: number
```

Insert:

```ts
  cycle?: CycleSpec
```

Find:

```ts
/** Does `n` carry on exactly where `p` leaves off (same buffer, same position)? */
```

Replace with:

```ts
/** The length a segment loops at: its cycle's, or its stem's. */
function loopSec<S extends StemLike>(seg: Segment<S>): number {
  return seg.cycle ? cycleSec(seg.cycle, seg.clock.bpm) : stemSec(seg)
}

/** Whether a folded segment runs to its cycle's seam. */
function endsAtSeam<S extends StemLike>(seg: Segment<S>): boolean {
  return !!seg.cycle && seg.offset + (seg.end - seg.start) >= loopSec(seg) - EPS
}

/** Does `n` carry on exactly where `p` leaves off (same buffer, same position)? A cycle's seam
 * never does: there the audio jumps back to the cycle's start. */
```

Find:

```ts
  if (Math.abs(p.end - n.start) > EPS) return false
  const len = stemSec(p)
```

Replace with:

```ts
  if (Math.abs(p.end - n.start) > EPS) return false
  if ((p.cycle?.id ?? null) !== (n.cycle?.id ?? null) || endsAtSeam(p)) return false
  const len = loopSec(p)
```

Find:

```ts
    const clock = clockAt(clocks, t)
    const stem = stemAt(assignments, t)
```

Replace with:

```ts
    const clock = clockAt(clocks, t)
    const assigned = assignmentAt(assignments, t)
    const stem = assigned?.stem ?? null
```

Find:

```ts
    const offset = stem ? rowOffset(t, clock.startTime, clock.loopBars, stem.stemBars, clock.bpm) : 0
    segs.push({ start: t, end, stem, clock, offset })
```

Replace with:

```ts
    const cycle = stem ? assigned?.cycle : undefined
    if (cycle) {
      // a folded row: one voice per cycle, cut at the seam, on the cycle's own running grid
      const offset = cycleOffset(t, cycle, clock.bpm)
      const seam = t + cycleSec(cycle, clock.bpm) - offset
      if (seam < end - EPS) end = seam
      segs.push({ start: t, end, stem, clock, offset, cycle })
    } else {
      const offset = stem ? rowOffset(t, clock.startTime, clock.loopBars, stem.stemBars, clock.bpm) : 0
      segs.push({ start: t, end, stem, clock, offset })
    }
```

Find:

```ts
      fadeIn: seamless(segs[i - 1], seg) ? 'xfade' : 'fade',
      fadeOut: seamless(seg, segs[i + 1]) ? 'xfade' : 'fade'
```

Replace with:

```ts
      fadeIn: seamless(segs[i - 1], seg) ? 'xfade' : seg.cycle && seg.offset <= EPS ? 'seam' : 'fade',
      fadeOut: seamless(seg, segs[i + 1]) ? 'xfade' : endsAtSeam(seg) ? 'seam' : 'fade',
      ...(seg.cycle ? { cycle: seg.cycle } : {})
```

In `src/audio/timeline.ts`:

Find:

```ts
import { clockAt, isWrap, loopBarsAt, rebuildClocks, stemAt, type Assignment, type StemLike } from './schedule'
```

Replace with:

```ts
import {
  assignmentAt,
  clockAt,
  isWrap,
  loopBarsAt,
  rebuildClocks,
  stemAt,
  type Assignment,
  type CycleSpec,
  type StemLike
} from './schedule'
```

After:

```ts
export interface TimelineStem extends StemLike {
  stemId?: string
  bpm?: number
```

Insert:

```ts
}

/** One folded row for setCycles (radio fold mode): its cycle id, length and phase in bars, and
 * the stem the fold was decided for (a row playing another stem then is left full length). */
export interface FoldCycle {
  rowId: string
  id: string
  bars: number
  phaseBars: number
  stemId?: string
```

After:

```ts
      d.boundaries = new Set([...d.boundaries].filter((b) => b <= atTime + EPS))
      d.boundaries.add(atTime)
    })
  }

```

Insert:

```ts
  /** Radio fold mode: from the loop top `atTime`, each row in `folds` plays its cycle, and every
   * other row plays its whole stem. A row already playing the same cycle id carries on (its
   * cycle keeps the origin it started on); a new id starts its cycle on `atTime`. A fold whose
   * stemId is not the row's stem at `atTime` (a change landing there) is left out. The loop's
   * length and the clocks never change: a fold is not a stem. Only the assignment AT `atTime` is
   * touched, so a change scheduled later stays. */
  setCycles(atTime: number, folds: readonly FoldCycle[], now: number, minLead: number): void {
    this.assertChangeAt(atTime, now, minLead)
    const want = new Map(folds.map((f) => [f.rowId, f]))
    this.commit((d) => {
      for (const [rowId, row] of [...d.rows]) {
        const cur = assignmentAt(row, atTime)
        if (!cur || !cur.stem) continue
        const f = want.get(rowId)
        const fits = f !== undefined && (f.stemId === undefined || cur.stem.stemId === undefined || f.stemId === cur.stem.stemId)
        if (fits) {
          if (cur.cycle?.id === f.id) continue
          setAt(d, rowId, atTime, cur.stem, { id: f.id, bars: f.bars, phaseBars: f.phaseBars, origin: atTime })
        } else if (cur.cycle) {
          setAt(d, rowId, atTime, cur.stem)
        }
      }
    })
  }

```

After:

```ts
    for (const a of this.pinned) if (!now.has(a)) this.pins?.unmark(a.stem!)
    this.pinned = now
  }
}

```

Insert:

```ts
/** Put `stem` (folded to `cycle`, if given) on a row of the draft at exactly `from`, replacing
 * only an assignment already there: later ones stay. */
function setAt<S>(d: State<S>, rowId: string, from: number, stem: S | null, cycle?: CycleSpec): void {
  const row = (d.rows.get(rowId) ?? []).filter((a) => Math.abs(a.from - from) > EPS)
  row.push(cycle ? { from, stem, cycle } : { from, stem })
  row.sort((a, b) => a.from - b.from)
  d.rows.set(rowId, row)
}

```

- [ ] **Step 4: Run and typecheck**

```bash
cd /Users/nickel/Claudecode/ell.ing/radio && npx vitest run src/audio/schedule.test.ts src/audio/timeline.test.ts && npm run typecheck
```

Expected: 21 and 19 tests pass; clean.

- [ ] **Step 5: Commit**

```bash
cd /Users/nickel/Claudecode/ell.ing/radio
git add src/audio/schedule.ts src/audio/schedule.test.ts src/audio/timeline.ts src/audio/timeline.test.ts
git commit -m "$(cat <<'EOF'
radio: a folded row's voices -- one per cycle on its own running grid, a 10 ms seam edge; Timeline.setCycles

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz
EOF
)"
```

## Task 16: The web engine folds, drifts and leans; checked by offline render (ell.ing/radio)

**Files:**
- Modify: `src/audio/rowVoice.ts`, `src/audio/engine.ts`
- Test: `spike/engine-check/check.ts`

- [ ] **Step 1: Write the failing check**

In `spike/engine-check/check.ts`:

After:

```ts
  out.stereoImage = { ...res, pass: a.sideMinusMidDb - narrowest < 1.5 }
}

```

Insert:

```ts
async function foldCycle() {
  // radio fold mode (@shared/radioFold): a 4-bar ramp (0 -> 1 over 8 s) folded to 7 beats (3.5 s)
  // from the first wrap W of a 4-bar (8 s) loop. Every cycle replays the ramp's first 3.5 s; the
  // cycle runs on across the next loop top instead of restarting with it; each seam fades.
  const W = START + 8
  const x = await render(
    30,
    (ctx, e) => {
      e.setRow('a', row(buf(ctx, 8, (i) => i / (8 * SR)), 4))
      e.setCycles(W, [{ rowId: 'a', id: 'a~1', bars: 7 / 4, phaseBars: 0 }])
    },
    { bypass: true }
  )
  const errs: number[] = []
  for (let k = 0; k < 5; k++) for (const d of [0.5, 1.5, 2.5]) errs.push(Math.abs(at(x, W + k * 3.5 + d) - d / 8))
  // 8.25 s into a 3.5 s grid is 1.25 s in; a cycle restarting with the loop would read 0.25 s
  const acrossTop = at(x, W + 8 + 0.25)
  let worst = 0
  const s0 = Math.round((W + 3.5 - 0.03) * SR) + dryDelay
  for (let i = s0; i < s0 + Math.round(0.06 * SR); i++) worst = Math.max(worst, Math.abs(x[i] - x[i - 1]))
  const before = at(x, START + 5)
  out.foldCycle = {
    maxErrOverFiveCycles: r6(Math.max(...errs)),
    acrossTop: r6(acrossTop),
    expectedAcrossTop: r6(1.25 / 8),
    restartWouldRead: r6(0.25 / 8),
    seamMaxStep: r6(worst),
    beforeTheFold: r6(before),
    pass:
      Math.max(...errs) < 0.002 &&
      Math.abs(acrossTop - 1.25 / 8) < 0.002 &&
      worst < 0.003 &&
      Math.abs(before - 5 / 8) < 0.002
  }
}

```

After:

```ts
  removeExit,
  turnaround,
  turnaroundUnderArrival,
```

Insert:

```ts
  foldCycle,
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /Users/nickel/Claudecode/ell.ing/radio && node spike/engine-check/run.mjs foldCycle`
Expected: FAIL — the check reports `"error": "TypeError: e.setCycles is not a function"` and the run ends `FAILED: foldCycle`. (Vite does not typecheck; `npm run typecheck` fails too until Step 3, since `check.ts` is in its program.)

- [ ] **Step 3: The drift nodes and the engine's fold API**

In `src/audio/rowVoice.ts`:

Find:

```ts
//   voice source -> voice gain --------------+-> filter -> high-pass -> gesture gain -> turnaround gain -> mute gain -> pan -> dry bus
//                                                                                                                       \-> send -> reverb
```

Replace with:

```ts
//   voice source -> voice gain --------------+-> filter -> high-pass -> drift low-pass -> gesture gain -> turnaround gain -> mute gain -> pan -> dry bus
//                                                                                                                                         \-> send -> reverb
//                                                                                                                                         \-> drift send -> reverb
//                                                                                                                                         \-> drift echo -> dub echo
//
// drift low-pass, drift send, drift echo: radio fold mode's slow drift (@shared/radioFold), and the
// clash's static low-pass. Their own nodes, so they never fight a gesture for the row's filter or
// send: neutral (Nyquist, 0, 0) while the mode is off.
```

Find:

```ts
import { ANTI_CLICK_SEC, XFADE_SEC, planVoices, type Assignment, type VoicePlan } from './schedule'
```

Replace with:

```ts
import { ANTI_CLICK_SEC, SEAM_FADE_SEC, XFADE_SEC, planVoices, type Assignment, type Edge, type VoicePlan } from './schedule'

/** How long an edge's ramp is. */
const edgeSec = (e: Edge): number => (e === 'xfade' ? XFADE_SEC : e === 'seam' ? SEAM_FADE_SEC : ANTI_CLICK_SEC)
```

After:

```ts
  /** A phrase turnaround's drop; 1 otherwise. */
  readonly turnaround: GainNode
```

Insert:

```ts
  /** Fold mode's drift low-pass (and the clash's); Nyquist otherwise. */
  readonly driftFilter: BiquadFilterNode
  /** Fold mode's drift: extra reverb send and dub echo send, 0 otherwise. */
  readonly driftSend: GainNode
  readonly driftDelay: GainNode
```

After:

```ts
    this.turnaround = new GainNode(ctx, { gain: 1 })
```

Insert:

```ts
    this.driftFilter = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: ctx.sampleRate / 2, Q: biquadQ(0) })
    this.driftSend = new GainNode(ctx, { gain: 0 })
    this.driftDelay = new GainNode(ctx, { gain: 0 })
```

Find:

```ts
    this.filter.connect(this.highpass).connect(this.gesture).connect(this.turnaround).connect(this.mute).connect(this.pan)
```

Replace with:

```ts
    this.filter.connect(this.highpass).connect(this.driftFilter).connect(this.gesture).connect(this.turnaround).connect(this.mute).connect(this.pan)
```

Find:

```ts
    this.delaySend = new GainNode(ctx, { gain: 0 })
    if (delayBus) this.pan.connect(this.delaySend).connect(delayBus)
```

Replace with:

```ts
    this.pan.connect(this.driftSend).connect(sendBus)
    this.delaySend = new GainNode(ctx, { gain: 0 })
    if (delayBus) {
      this.pan.connect(this.delaySend).connect(delayBus)
      this.pan.connect(this.driftDelay).connect(delayBus)
    }
```

Find:

```ts
    for (const n of [this.filter, this.highpass, this.gesture, this.turnaround, this.mute, this.pan, this.send, this.delaySend]) n.disconnect()
```

Replace with:

```ts
    for (const n of [this.filter, this.highpass, this.driftFilter, this.gesture, this.turnaround, this.mute, this.pan, this.send, this.driftSend, this.delaySend, this.driftDelay]) n.disconnect()
```

Find:

```ts
    const stemSec = p.stem.stemBars * secPerBar(p.clock.bpm)
```

Replace with:

```ts
    // a folded voice loops (and is cut at) its cycle, a whole one its stem
    const stemSec = (p.cycle ? p.cycle.bars : p.stem.stemBars) * secPerBar(p.clock.bpm)
```

Find:

```ts
    const fade = Math.min(fadeIn === 'xfade' ? XFADE_SEC : ANTI_CLICK_SEC, (p.end - startAt) / 2)
```

Replace with:

```ts
    const fade = Math.min(edgeSec(fadeIn), (p.end - startAt) / 2)
```

Find:

```ts
    const len = Math.min(xfade ? XFADE_SEC : ANTI_CLICK_SEC, Math.max(0, (p.end - v.startAt) / 2))
```

Replace with:

```ts
    const len = Math.min(edgeSec(p.fadeOut), Math.max(0, (p.end - v.startAt) / 2))
```

In `src/audio/engine.ts`:

After:

```ts
import type { TurnaroundPlan } from '@shared/radioTurnaround'
```

Insert:

```ts
import type { FoldDriftLap } from '@shared/radioFold'
import { CLASH_LEAN_MAX, CLASH_LOWPASS_CUTOFF, radioClashLeaned } from '@shared/radioClash'
import { glueThresholdDb } from '@shared/radioSound'
import { cutoffHz } from './automation'
import type { FoldCycle } from './timeline'
```

After:

```ts
  private readonly random: () => number
  private masterSend = DEFAULT_REVERB_SEND
```

Insert:

```ts
  /** Fold mode's clash leaning the saturation and glue in (setFoldLean); 0 otherwise. */
  private foldLean = 0
```

After:

```ts
    this.gestures.cancelTurnaround(atTime, this.masterSend)
  }

```

Insert:

```ts
  /** Radio fold mode (@shared/radioFold): from the loop top `atTime`, each row in `folds` loops
   * only the first `bars` of its stem on its own running grid, with a 10 ms fade at every seam;
   * every other row plays its whole stem. Timeline.setCycles has the rules (the same cycle id
   * runs on, a new one starts on `atTime`). A RangeError, and nothing changed, if `atTime` is not
   * a loop top at least MIN_LEAD_SEC ahead. */
  setCycles(atTime: number, folds: readonly FoldCycle[]): void {
    this.tl.setCycles(atTime, folds, this.now, MIN_LEAD_SEC)
    this.pump()
  }

  /** Radio fold mode's drift over the lap that starts at the loop top `atTime`: each row's drift
   * low-pass, extra reverb send and dub echo send ramp from the lap's first value to its last
   * (the clash's row holds the clash low-pass instead of a moving one); a row with no drift goes
   * back to neutral there. The lap's length is the clock's at `atTime`. */
  setDrift(atTime: number, drift: Readonly<Record<string, FoldDriftLap>>, clashRow: string | null): void {
    if (!this.tl.clocks.length) return
    const c = this.tl.clockAt(atTime)
    const at = Math.max(atTime, this.now)
    const end = at + c.loopBars * secPerBar(c.bpm)
    const ramp = (param: AudioParam, a: number, b: number) => {
      param.cancelScheduledValues(at)
      param.setValueAtTime(a, at)
      param.linearRampToValueAtTime(b, end)
    }
    for (const [id, row] of this.voices) {
      const d = drift[id]
      const f = row.driftFilter.frequency
      f.cancelScheduledValues(at)
      if (id === clashRow) f.setValueAtTime(cutoffHz(CLASH_LOWPASS_CUTOFF), at)
      else if (d) {
        f.setValueAtTime(cutoffHz(d.cutoff[0]), at)
        f.exponentialRampToValueAtTime(cutoffHz(d.cutoff[1]), end)
      } else f.setValueAtTime(this.ctx.sampleRate / 2, at)
      ramp(row.driftSend.gain, d?.send[0] ?? 0, d?.send[1] ?? 0)
      // into the echo only while the listener's echo is up, and scaled by it, as a throw is
      ramp(row.driftDelay.gain, (d?.dub[0] ?? 0) * this.fx.echo, (d?.dub[1] ?? 0) * this.fx.echo)
    }
  }

  /** Fold mode's clash leaning the master in (@shared/radioClash radioClashLean): the
   * saturation and the glue each `lean` above the listener's own, at most CLASH_LEAN_MAX; 0 is
   * the listener's own exactly. */
  setFoldLean(lean: number): void {
    this.foldLean = Math.min(CLASH_LEAN_MAX, Math.max(0, Number.isFinite(lean) ? lean : 0))
    this.setSaturation(this.fx.saturation)
    const threshold = glueThresholdDb(radioClashLeaned(0.5, this.foldLean))
    this.faustStages.glue?.setParam('/glue/threshold', threshold)
    glide(this.master.glue.threshold, threshold, this.now)
  }

```

Find:

```ts
    const drive = saturationDrive(this.fx.saturation)
```

Replace with:

```ts
    const drive = saturationDrive(radioClashLeaned(this.fx.saturation, this.foldLean))
```

- [ ] **Step 4: Typecheck, test, and run every engine check (the drift low-pass sits in every row's chain now)**

```bash
cd /Users/nickel/Claudecode/ell.ing/radio && npm run typecheck && npm test && node spike/engine-check/run.mjs foldCycle && node spike/engine-check/run.mjs
```

Expected: typecheck clean; tests pass; `foldCycle` prints `maxErrOverFiveCycles` 0, `acrossTop` 0.15625 (= `expectedAcrossTop`, not `restartWouldRead` 0.03125), `seamMaxStep` about 0.0009, `beforeTheFold` 0.625, `"pass": true`; the full run ends `all engine checks passed`.

- [ ] **Step 5: Commit**

```bash
cd /Users/nickel/Claudecode/ell.ing/radio
git add src/audio/rowVoice.ts src/audio/engine.ts spike/engine-check/check.ts
git commit -m "$(cat <<'EOF'
radio: the engine folds rows, drifts their low-pass and sends, and leans the master for the clash; checked by offline render

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz
EOF
)"
```

## Task 17: The web picker clashes (ell.ing/radio)

**Files:**
- Modify: `src/radio/pick.ts`
- Test: `src/radio/pick.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/radio/pick.test.ts`:

After:

```ts
    expect(p95).toBeLessThan(25)
    expect(mean).toBeLessThan(10)
  })
})
```

Insert:

```ts

describe('pickStem: fold mode clash', () => {
  // two drums stems, one near the bed's brightness and rhythm, one far from it
  const records = [
    rec('near', { traits: { bright: 0.25, rhythmic: 0.3 } }),
    rec('far', { traits: { bright: 0.95, rhythmic: 0.9 } })
  ]
  const index = buildPickIndex(records)
  const bed = { bright: 0.2, rhythmic: 0.3 }

  it('at chaos 0 a clash takes the stem furthest from the bed, whatever the draw', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const p = pickStem(index, base(['drums'], { chaos: 0, sourceLean: 0, clash: { amount: 1, bed }, random: seeded(seed) }))
      expect(p?.record.id).toBe('far')
    }
  })

  it('no clash, or a clash of 0, ranks as before', () => {
    for (const clash of [undefined, { amount: 0, bed }]) {
      const a = pickStem(index, base(['drums'], { chaos: 0, sourceLean: 0, clash, random: seeded(3) }))
      const b = pickStem(index, base(['drums'], { chaos: 0, sourceLean: 0, random: seeded(3) }))
      expect(a?.record.id).toBe(b?.record.id)
    }
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /Users/nickel/Claudecode/ell.ing/radio && npx vitest run src/radio/pick.test.ts`
Expected: FAIL — the first new test: vitest does not typecheck, `clash` is ignored, and `near` comes up for some seeds.

- [ ] **Step 3: Pass the clash through**

In `src/radio/pick.ts`:

After:

```ts
import { pickReroll, rankCandidates } from '@shared/discoverRanking'
```

Insert:

```ts
import type { RankClash } from '@shared/radioClash'
```

After:

```ts
   * is a favourite, as before. */
  loved?: (id: string) => number
```

Insert:

```ts
  /** Fold mode's clash (@shared/radioClash): passed to rankCandidates. Absent: as before. */
  clash?: RankClash
```

After:

```ts
    traitBar = DEFAULT_TRAIT_BAR,
    sourceLean = DEFAULT_SOURCE_LEAN,
    loved,
```

Insert:

```ts
    clash,
```

Find:

```ts
    targetTraits: traitKinds,
    favouriteWeight: loved
```

Replace with:

```ts
    targetTraits: traitKinds,
    favouriteWeight: loved,
    ...(clash ? { clash } : {})
```

- [ ] **Step 4: Run and typecheck**

```bash
cd /Users/nickel/Claudecode/ell.ing/radio && npx vitest run src/radio/pick.test.ts && npm run typecheck
```

Expected: 34 tests pass; clean.

- [ ] **Step 5: Commit**

```bash
cd /Users/nickel/Claudecode/ell.ing/radio
git add src/radio/pick.ts src/radio/pick.test.ts
git commit -m "$(cat <<'EOF'
radio: the picker takes fold mode's clash

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz
EOF
)"
```

## Task 18: The web radio's brain folds (ell.ing/radio, `step.ts`)

**Files:**
- Modify: `src/radio/step.ts`
- Test: `src/radio/step.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/radio/step.test.ts`:

After:

```ts
    expect(sim.s.lastTurnaround).toEqual(memory)
  })
})
```

Insert:

```ts

describe('fold mode (@shared/radioFold)', () => {
  // five rows: drums, bass, lead, warm and a second drums row -- the one row that can fold
  const FOLD: Partial<WebRadioSettings> = { channels: 5, foldMode: true, fold: 40, clash: 25 }

  it('off: nothing folds and nothing is handed to the engine', () => {
    const sim = new Sim({ channels: 5 })
    sim.send({ type: 'play' })
    sim.run(0, 80)
    expect(sim.of('fold')).toEqual([])
    expect(sim.s.fold).toBeNull()
  })

  it("on: every wrap hands the engine the next lap's cycles, for the next loop top", () => {
    const sim = new Sim(FOLD)
    sim.send({ type: 'play' })
    sim.run(0, 120)
    const folds = sim.of('fold')
    expect(folds.length).toBeGreaterThan(10)
    for (const f of folds) expect(f.time % LAP).toBeCloseTo(0, 6)
    // the second drums row folds; the anchor (the first drums row) never does
    const folded = new Set(folds.flatMap((f) => f.cycles.map((c) => c.rowId)))
    expect(folded.size).toBeGreaterThan(0)
    const anchor = sim.s.rows[0].id
    expect(folded.has(anchor)).toBe(false)
    // shorter than the 4-bar row, on the half-beat grid; a low fold settles on 7 or 9
    for (const f of folds) {
      for (const c of f.cycles) {
        expect(c.cycleBeats).toBeLessThan(16)
        expect(Number.isInteger(c.cycleBeats * 2)).toBe(true)
      }
    }
    for (const r of sim.s.fold!.rows) if (r.mode !== 'unfolding') expect([7, 9]).toContain(r.targetBeats)
  })

  it('replays: the same seed and the same events give the same folds', () => {
    const a = new Sim(FOLD, seeded(7))
    const b = new Sim(FOLD, seeded(7))
    for (const sim of [a, b]) {
      sim.send({ type: 'play' })
      sim.run(0, 160)
    }
    expect(b.of('fold')).toEqual(a.of('fold'))
  })

  it('changes come 16 to 64 bars apart while it is on', () => {
    const sim = new Sim(FOLD)
    sim.send({ type: 'play' })
    sim.run(0, 4)
    expect(sim.s.clock!.intervalBars).toBeGreaterThanOrEqual(16)
    expect(sim.s.clock!.intervalBars).toBeLessThanOrEqual(64 + 2 * 4)
  })

  it('turning it off puts the folds away at the next loop top', () => {
    const sim = new Sim(FOLD)
    sim.send({ type: 'play' })
    sim.run(0, 60)
    sim.send({ type: 'foldControls', foldMode: false, fold: 40, clash: 25, foldSeed: 'autech' })
    const before = sim.of('fold').length
    sim.run(60 + 1 / 30, 70)
    const after = sim.of('fold').slice(before)
    expect(after).toEqual([{ type: 'fold', time: 72, cycles: [], drift: {}, clashRow: null }])
    expect(sim.s.fold).toBeNull()
  })

  it("the controls set the settings, and the clash's lean follows at once", () => {
    const sim = new Sim()
    sim.send({ type: 'foldControls', foldMode: true, fold: 130, clash: 100, foldSeed: ' K3X9PQ ' })
    expect(sim.s.settings).toMatchObject({ foldMode: true, fold: 100, clash: 100, foldSeed: 'k3x9pq' })
    expect(sim.of('foldLean')).toEqual([{ type: 'foldLean', lean: expect.closeTo(0.15, 9) }])
  })

  it('a pick under the mode carries the clash: its amount, and the bed of the other rows', () => {
    const sim = new Sim({ ...FOLD, clash: 80 })
    sim.send({ type: 'play' })
    sim.run(0, 40)
    const arms = sim.of('arm').filter((a) => a.clash)
    expect(arms.length).toBeGreaterThan(0)
    for (const a of arms) expect(a.clash!.amount).toBeCloseTo(0.8)
    expect(new Sim({ channels: 5 }).of('arm').some((a) => a.clash)).toBe(false)
  })

  it('stop forgets the machine', () => {
    const sim = new Sim(FOLD)
    sim.send({ type: 'play' })
    sim.run(0, 30)
    sim.send({ type: 'stop' })
    expect(sim.s.fold).toBeNull()
    expect(sim.s.foldNext).toBeNull()
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /Users/nickel/Claudecode/ell.ing/radio && npx vitest run src/radio/step.test.ts`
Expected: FAIL — no `fold` actions are ever produced; `foldControls` is unknown; `s.fold` is undefined.

- [ ] **Step 3: Fold at every wrap**

In `src/radio/step.ts`:

After:

```ts
  isRadioEligibleSlot,
  nextRadioIntervalBarsInWindow,
```

Insert:

```ts
  radioPaceWindowOf,
```

After:

```ts
  type RadioTransitionKind
} from '@shared/radioTransition'
```

Insert:

```ts
import {
  createRadioFold,
  normalizeFoldAmount,
  normalizeFoldSeed,
  radioFoldIntervalBars,
  radioFoldTurnaroundRate,
  stepRadioFold,
  type FoldDriftLap,
  type RadioFoldCycle,
  type RadioFoldRow,
  type RadioFoldState,
  type RadioFoldStep
} from '@shared/radioFold'
import {
  radioClashAmount,
  radioClashBed,
  radioClashLean,
  radioClashLowpassRow,
  type RankClash
} from '@shared/radioClash'
import { instrumentMaskToSoundType } from '@shared/riffLibraryTypes'
```

After:

```ts
  /** When the last turn found nothing to turn (AudioContext time): full mode says so a while. */
  turnNothingAt: number | null
```

Insert:

```ts
  /** Fold mode (@shared/radioFold): the machine, and its decisions for the lap playing now and
   * for the next (it decides a lap ahead, at every wrap). Null with the mode off. */
  fold: RadioFoldState | null
  foldNow: RadioFoldStep | null
  foldNext: RadioFoldStep | null
```

After:

```ts
  | { type: 'turnaroundControls'; moves: readonly TurnaroundFamily[]; depth: TurnaroundDepth }
```

Insert:

```ts
  /** Full mode's fold controls (ui/foldPrefs.ts): the switch, the two faders, the seed. */
  | { type: 'foldControls'; foldMode: boolean; fold: number; clash: number; foldSeed: string }
```

Find:

```ts
  | { type: 'arm'; slot: string; token: number; kinds: DiscoverSlotKind[]; usedElsewhere: string[]; targetBpm: number }
```

Replace with:

```ts
  | {
      type: 'arm'
      slot: string
      token: number
      kinds: DiscoverSlotKind[]
      usedElsewhere: string[]
      targetBpm: number
      /** Fold mode's clash for this pick (@shared/radioClash); absent with the mode off. */
      clash?: RankClash
    }
```

After:

```ts
  /** Take back the turnaround ending on `time` (hold, a pace change). */
  | { type: 'cancelTurnaround'; time: number }
```

Insert:

```ts
  /** Fold mode: from the loop top `time`, these rows fold (every other row plays whole), with
   * that lap's drift and the clash's low-pass row (Engine.setCycles, Engine.setDrift). */
  | { type: 'fold'; time: number; cycles: RadioFoldCycle[]; drift: Record<string, FoldDriftLap>; clashRow: string | null }
  /** Fold mode's clash leaning the master in (Engine.setFoldLean). */
  | { type: 'foldLean'; lean: number }
```

Find:

```ts
    lastTurnaround: null,
    turnRequest: null,
    turnNothingAt: null
```

Replace with:

```ts
    lastTurnaround: null,
    turnRequest: null,
    turnNothingAt: null,
    fold: null,
    foldNow: null,
    foldNext: null
```

After:

```ts
        turnaroundDepth: normalizeTurnaroundDepth(event.depth)
      }
```

Insert:

```ts
      break
    case 'foldControls':
      // the listener's fold controls (full mode): the next wrap's step reads them, and the
      // clash's lean on the master follows at once
      s.settings = {
        ...s.settings,
        foldMode: event.foldMode === true,
        fold: normalizeFoldAmount(event.fold, s.settings.fold),
        clash: normalizeFoldAmount(event.clash, s.settings.clash),
        foldSeed: normalizeFoldSeed(event.foldSeed)
      }
      c.out.push({ type: 'foldLean', lean: radioClashLean(s.settings.foldMode, s.settings.clash) })
```

After:

```ts
    driftAtWrap(c, loopBars)
    densityAtWrap(c, loopBars)
```

Insert:

```ts
    // fold mode decides the next lap here, before the roll below reads whether its phrase ends
    // on a realignment top
    foldAtWrap(c, t)
```

Find:

```ts
  }
  const plan = rollTurnaround({
    rate: s.settings.turnarounds,
```

Replace with:

```ts
  }
  const plan = rollTurnaround({
    // a phrase ending on a fold's realignment top prefers a turnaround
    rate: radioFoldTurnaroundRate(s.settings.turnarounds, s.settings.foldMode && s.foldNext?.marked === true),
```

Find:

```ts
    targetBpm: s.tempoTarget ?? s.tempoLanding?.bpm ?? s.bpm
```

Replace with:

```ts
    targetBpm: s.tempoTarget ?? s.tempoLanding?.bpm ?? s.bpm,
    ...clashFor(s, slot)
```

After:

```ts
  s.lastTurnaround = null
  s.turnRequest = null
  s.turnNothingAt = null
```

Insert:

```ts
  // the engine is stopped with everything on it: the next play starts the machine again
  s.fold = null
  s.foldNow = null
  s.foldNext = null
}

// ---- fold mode (@shared/radioFold) ----

/** The rows as fold mode sees them, in row order. */
function foldRows(s: RadioState): RadioFoldRow[] {
  return s.rows.map((r) => ({
    id: r.id,
    stemId: r.record?.id ?? null,
    kinds: r.kinds,
    barLength: r.record?.bars ?? 0,
    hooked: s.flags[r.id] === 'hook',
    audible: !!r.record && heard(s, r),
    percussive: r.record?.mask != null && instrumentMaskToSoundType(r.record.mask) === 'drums'
  }))
}

/** The row the clash low-passes (radioClashLowpassRow), by the heard rows' brightness. */
function clashRowOf(s: RadioState): string | null {
  return radioClashLowpassRow(
    s.rows.filter((r) => r.record && heard(s, r)).map((r) => ({ id: r.id, bright: r.record!.traits?.bright })),
    radioClashAmount(s.settings.foldMode, s.settings.clash)
  )
}

/** Fold mode's clash for a pick on `slot`: how much, and the bed (the other rows heard now, by
 * their stems' trait percentiles). Nothing with the mode off. */
function clashFor(s: RadioState, slot: string): { clash?: RankClash } {
  const amount = radioClashAmount(s.settings.foldMode, s.settings.clash)
  if (!(amount > 0)) return {}
  const bed = radioClashBed(s.rows.filter((r) => r.id !== slot && r.record && heard(s, r)).map((r) => r.record!.traits ?? {}))
  return { clash: { amount, bed } }
}

/** At every wrap: the lap starting now plays what was decided a lap ago, the machine decides the
 * next lap, and the engine gets it for the next loop top. With the mode off, a fold still around
 * is put away at the next top. While held nothing changes: the folds and the drift hold where
 * they are. A new seed starts a new machine. */
function foldAtWrap(c: Ctx, t: RadioTickInfo): void {
  const { s } = c
  if (t.nextWrap === null) return
  if (!s.settings.foldMode) {
    if (s.fold || s.foldNow || s.foldNext) {
      s.fold = null
      s.foldNow = null
      s.foldNext = null
      c.out.push({ type: 'fold', time: t.nextWrap, cycles: [], drift: {}, clashRow: null })
    }
    return
  }
  if (s.held) return
  s.foldNow = s.foldNext
  const state = s.fold && s.fold.seed === s.settings.foldSeed ? s.fold : createRadioFold(s.settings.foldSeed)
  const next = stepRadioFold(state, { rows: foldRows(s), loopBars: t.loopBars, bpm: s.bpm, fold: s.settings.fold })
  s.fold = next.state
  s.foldNext = next
  c.out.push({ type: 'fold', time: t.nextWrap, cycles: next.cycles, drift: next.drift, clashRow: clashRowOf(s) })
```

Find:

```ts
  return nextRadioIntervalBarsInWindow(c.s.settings.paceBars, c.rnd)
```

Replace with:

```ts
  // fold mode's window (16-64 bars), moved to a realignment top when one is near
  const drawn = nextRadioIntervalBarsInWindow(radioPaceWindowOf(c.s.settings), c.rnd)
  return c.s.settings.foldMode ? radioFoldIntervalBars(c.s.fold, drawn, c.s.lastTick?.loopBars ?? 0) : drawn
```

- [ ] **Step 4: Run, the whole suite, and typecheck**

```bash
cd /Users/nickel/Claudecode/ell.ing/radio && npx vitest run src/radio/step.test.ts && npm test && npm run typecheck
```

Expected: all pass (the existing step and controller tests are unchanged: with the mode off nothing new happens, and no extra random draw is made); clean.

- [ ] **Step 5: Commit**

```bash
cd /Users/nickel/Claudecode/ell.ing/radio
git add src/radio/step.ts src/radio/step.test.ts
git commit -m "$(cat <<'EOF'
radio: fold mode in the brain -- the machine at every wrap for the next top, fold-mode pace, realignment preferences, clash on picks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz
EOF
)"
```

## Task 19: The controller carries fold out (ell.ing/radio)

**Files:**
- Modify: `src/radio/controller.ts`
- Test: `src/radio/controller.test.ts`

- [ ] **Step 1: Write the failing tests (and teach the fake engine the three new calls)**

In `src/radio/controller.test.ts`:

After:

```ts
import type { TurnaroundPlan } from '@shared/radioTurnaround'
```

Insert:

```ts
import type { FoldDriftLap } from '@shared/radioFold'
import type { FoldCycle } from '../audio/timeline'
```

After:

```ts
  | { op: 'turnaround'; plan: TurnaroundPlan; at: number; now: number }
  | { op: 'cancelTurnaround'; at: number }
```

Insert:

```ts
  | { op: 'fold'; at: number; folds: readonly FoldCycle[] }
  | { op: 'drift'; at: number; rows: string[]; clashRow: string | null }
  | { op: 'lean'; lean: number }
```

After:

```ts
    this.calls.push({ op: 'cancelTurnaround', at })
```

Insert:

```ts
  }
  setCycles(at: number, folds: readonly FoldCycle[]): void {
    if (!this.isWrap(at) || at < this.now + 0.05 - EPS) throw new RangeError(`not a loop top ahead: ${at}`)
    this.calls.push({ op: 'fold', at, folds })
  }
  setDrift(at: number, drift: Readonly<Record<string, FoldDriftLap>>, clashRow: string | null): void {
    this.calls.push({ op: 'drift', at, rows: Object.keys(drift).sort(), clashRow })
  }
  setFoldLean(lean: number): void {
    this.calls.push({ op: 'lean', lean })
```

After:

```ts
    expect(r.eng.turnarounds()).toHaveLength(1)
  })
})
```

Insert:

```ts

// ---- fold mode ----

describe('fold mode', () => {
  it('hands the engine each lap: the cycles at the next loop top, and the drift', async () => {
    const r = rig({ settings: { channels: 5, foldMode: true, fold: 40 } })
    await started(r)
    await r.run(r.eng.lap() * 6)
    const folds = r.eng.calls.filter((c): c is Extract<Call, { op: 'fold' }> => c.op === 'fold')
    const drifts = r.eng.calls.filter((c): c is Extract<Call, { op: 'drift' }> => c.op === 'drift')
    expect(folds.length).toBeGreaterThanOrEqual(5)
    expect(drifts.length).toBe(folds.length)
    for (const f of folds) expect(wrapAt(r, f.at)).toBe(true)
    // the fifth row (a second drums row) is the one that folds; lengths go over in bars
    const folded = folds.flatMap((f) => f.folds)
    expect(folded.length).toBeGreaterThan(0)
    for (const x of folded) {
      expect(x.rowId).toBe('r4')
      expect(x.bars).toBeLessThan(LOOP_BARS)
      expect(x.stemId).toBe(r.ctl.state.rows.find((row) => row.id === 'r4')!.record!.id)
    }
    expect(drifts[0].rows).toEqual(['r0', 'r1', 'r2', 'r3', 'r4'])
  })

  it('the fold controls reach the radio, and the lean the engine', async () => {
    const r = rig()
    r.ctl.setFoldControls({ on: true, fold: 70, clash: 100, seed: 'k3x9pq' })
    for (let i = 0; i < 3; i++) await flush()
    expect(r.ctl.state.settings).toMatchObject({ foldMode: true, fold: 70, clash: 100, foldSeed: 'k3x9pq' })
    const leans = r.eng.calls.filter((c): c is Extract<Call, { op: 'lean' }> => c.op === 'lean')
    expect(leans.map((l) => l.lean)).toEqual([expect.closeTo(0.15, 9)])
  })

  it('off: the engine is never asked to fold', async () => {
    const r = rig({ settings: { channels: 5 } })
    await started(r)
    await r.run(r.eng.lap() * 4)
    expect(r.eng.calls.some((c) => c.op === 'fold' || c.op === 'drift')).toBe(false)
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /Users/nickel/Claudecode/ell.ing/radio && npx vitest run src/radio/controller.test.ts`
Expected: FAIL — no `fold`/`drift` calls reach the fake engine; `ctl.setFoldControls is not a function`.

- [ ] **Step 3: The engine interface, the actions, the controls, the clash to the picker**

In `src/radio/controller.ts`:

After:

```ts
import { stretchRatioForStem } from '@shared/stretchRatio'
```

Insert:

```ts
import type { FoldDriftLap } from '@shared/radioFold'
import type { RankClash } from '@shared/radioClash'
import type { FoldCycle } from '../audio/timeline'
```

After:

```ts
  applyTurnaround(plan: TurnaroundPlan, atTime: number): void
  cancelTurnaround(atTime: number): void
```

Insert:

```ts
  setCycles(atTime: number, folds: readonly FoldCycle[]): void
  setDrift(atTime: number, drift: Readonly<Record<string, FoldDriftLap>>, clashRow: string | null): void
  setFoldLean(lean: number): void
```

Find:

```ts
  opts: { usedElsewhere: ReadonlySet<string>; targetBpm: number; loved?: (id: string) => number }
```

Replace with:

```ts
  opts: {
    usedElsewhere: ReadonlySet<string>
    targetBpm: number
    loved?: (id: string) => number
    /** Fold mode's clash for this pick (@shared/radioClash). */
    clash?: RankClash
  }
```

Find:

```ts
  return (kinds, { usedElsewhere, targetBpm, loved }) =>
    pickStem(index, { kinds, targetBpm, usedElsewhere, random, loved, chaos })?.record ?? null
```

Replace with:

```ts
  return (kinds, { usedElsewhere, targetBpm, loved, clash }) =>
    pickStem(index, { kinds, targetBpm, usedElsewhere, random, loved, chaos, clash })?.record ?? null
```

After:

```ts
    this.dispatch({ type: 'turnaroundControls', moves, depth })
```

Insert:

```ts
  }
  /** The listener's fold controls (full mode, ui/foldPrefs.ts): fold mode on or off, how folded,
   * how mismatched, and the seed. Taken at the next wrap; the clash's lean on the master at once. */
  setFoldControls(p: { on: boolean; fold: number; clash: number; seed: string }): void {
    this.dispatch({ type: 'foldControls', foldMode: p.on, fold: p.fold, clash: p.clash, foldSeed: p.seed })
```

Find:

```ts
            targetBpm: a.targetBpm,
            ...(this.loved ? { loved: this.loved } : {})
```

Replace with:

```ts
            targetBpm: a.targetBpm,
            ...(this.loved ? { loved: this.loved } : {}),
            ...(a.clash ? { clash: a.clash } : {})
```

After:

```ts
          this.log(`radio: could not take back the turnaround into ${a.time.toFixed(3)}`, err)
        }
```

Insert:

```ts
        return
      case 'fold':
        // the cycles and the drift each on their own: a refused fold still drifts
        try {
          e.setCycles(
            a.time,
            a.cycles.map((c) => ({ rowId: c.rowId, id: c.cycleId, bars: c.cycleBeats / 4, phaseBars: c.phaseBeats / 4, stemId: c.stemId }))
          )
        } catch (err) {
          this.log(`radio: fold at ${a.time.toFixed(3)} refused`, err)
        }
        try {
          e.setDrift(a.time, a.drift, a.clashRow)
        } catch (err) {
          this.log(`radio: drift at ${a.time.toFixed(3)} refused`, err)
        }
        return
      case 'foldLean':
        e.setFoldLean(a.lean)
```

- [ ] **Step 4: Run, the whole suite, typecheck**

```bash
cd /Users/nickel/Claudecode/ell.ing/radio && npx vitest run src/radio/controller.test.ts && npm test && npm run typecheck
```

Expected: all pass; clean.

- [ ] **Step 5: Commit**

```bash
cd /Users/nickel/Claudecode/ell.ing/radio
git add src/radio/controller.ts src/radio/controller.test.ts
git commit -m "$(cat <<'EOF'
radio: the controller lands each lap's folds and drift on the engine, leans the master, and hands the picker the clash

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz
EOF
)"
```

## Task 20: Full mode's fold controls, remembered per visitor (ell.ing/radio)

**Files:**
- Create: `src/ui/foldPrefs.ts`
- Test: `src/ui/foldPrefs.test.ts`
- Modify: `src/ui/full.ts`, `src/main.ts`

- [ ] **Step 1: Write the failing test**

Create `src/ui/foldPrefs.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { FOLD_KEY, loadFoldPrefs, saveFoldPrefs, type FoldPrefs } from './foldPrefs'

const D: FoldPrefs = { on: false, fold: 40, clash: 25, seed: 'autech' }
const memory = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init))
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }
}
const throwing = {
  getItem: () => {
    throw new Error('blocked')
  },
  setItem: () => {
    throw new Error('blocked')
  }
}

describe('the fold controls (radio.fold)', () => {
  it("the radio's defaults until set; a set value is remembered", () => {
    const s = memory()
    expect(loadFoldPrefs(s, D)).toEqual(D)
    saveFoldPrefs({ on: true, fold: 80, clash: 60, seed: 'k3x9pq' }, s)
    expect(JSON.parse(s.m.get(FOLD_KEY)!)).toEqual({ on: true, fold: 80, clash: 60, seed: 'k3x9pq' })
    expect(loadFoldPrefs(s, D)).toEqual({ on: true, fold: 80, clash: 60, seed: 'k3x9pq' })
  })

  it('missing or junk values fall back field by field', () => {
    expect(loadFoldPrefs(memory({ [FOLD_KEY]: JSON.stringify({ on: true }) }), D)).toEqual({ ...D, on: true })
    expect(loadFoldPrefs(memory({ [FOLD_KEY]: JSON.stringify({ on: 'yes', fold: 300, clash: 'x', seed: 'abc' }) }), D)).toEqual({
      on: false,
      fold: 100,
      clash: 25,
      seed: 'autech'
    })
    expect(loadFoldPrefs(memory({ [FOLD_KEY]: 'not json' }), D)).toEqual(D)
  })

  it('storage being off is the defaults, and nothing throws', () => {
    expect(loadFoldPrefs(throwing, D)).toEqual(D)
    expect(() => saveFoldPrefs(D, throwing)).not.toThrow()
    expect(loadFoldPrefs(null, D)).toEqual(D)
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /Users/nickel/Claudecode/ell.ing/radio && npx vitest run src/ui/foldPrefs.test.ts`
Expected: FAIL — `Failed to resolve import "./foldPrefs"`.

- [ ] **Step 3: The prefs, the strip's controls, and main's wiring**

Create `src/ui/foldPrefs.ts`:

```ts
// src/ui/foldPrefs.ts -- the listener's fold mode controls (full mode's strip: the switch, how
// folded, how mismatched, the seed; sssketch spec 2026-10-02-radio-fold-mode-design section 2),
// remembered per visitor in localStorage['radio.fold'] and given to the radio when it is made, and
// on every change. Anything missing or unreadable falls back to the radio's defaults, field by field.
import { normalizeFoldAmount, normalizeFoldSeed } from '@shared/radioFold'

export const FOLD_KEY = 'radio.fold'

export interface FoldPrefs {
  on: boolean
  /** 0..100, "how folded". */
  fold: number
  /** 0..100, "how mismatched". */
  clash: number
  /** six characters of the seed alphabet */
  seed: string
}

type PrefsStorage = Pick<Storage, 'getItem' | 'setItem'> | null

export function loadFoldPrefs(storage: PrefsStorage, defaults: FoldPrefs): FoldPrefs {
  try {
    const raw = storage?.getItem(FOLD_KEY)
    const v: unknown = raw ? JSON.parse(raw) : null
    const o = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
    return {
      on: typeof o.on === 'boolean' ? o.on : defaults.on,
      fold: normalizeFoldAmount(o.fold, defaults.fold),
      clash: normalizeFoldAmount(o.clash, defaults.clash),
      seed: typeof o.seed === 'string' ? normalizeFoldSeed(o.seed) : defaults.seed
    }
  } catch {
    return { ...defaults }
  }
}

export function saveFoldPrefs(prefs: FoldPrefs, storage: PrefsStorage): void {
  try {
    storage?.setItem(FOLD_KEY, JSON.stringify({ on: prefs.on, fold: prefs.fold, clash: prefs.clash, seed: prefs.seed }))
  } catch {
    // not remembered past this visit
  }
}
```

In `src/ui/full.ts`:

After:

```ts
import type { TurnaroundPrefs } from './turnaroundPrefs'
```

Insert:

```ts
import type { FoldPrefs } from './foldPrefs'
import { FOLD_SEED_ALPHABET, FOLD_SEED_LENGTH, newFoldSeed } from '@shared/radioFold'
```

After:

```ts
  readTurnarounds(): TurnaroundPrefs
  turnarounds(p: TurnaroundPrefs): void
```

Insert:

```ts
  /** The listener's fold mode controls (ui/foldPrefs.ts): read, and set. */
  readFold(): FoldPrefs
  fold(p: FoldPrefs): void
```

After:

```ts
    const b = button(TURNAROUND_MOVE_LABEL[move], `turn: ${TURNAROUND_MOVE_LABEL[move]}`, () => on.turn(move))
    turnGrp.append(b)
    return { move, b }
  })
```

Insert:

```ts
  // fold mode, beside the turn (ui/foldPrefs.ts): the switch (pressed = on), how folded, how
  // mismatched, and the seed -- typed or pasted (six characters), or `new`
  const foldGrp = h('div', 'knob')
  const foldBtn = button('fold', 'fold mode', () => {
    on.fold({ ...on.readFold(), on: !on.readFold().on })
    drawFold()
  })
  foldBtn.title = 'layers in other time signatures'
  const folded = range('folded', 'how folded', on.readFold().fold / 100, (v) => on.fold({ ...on.readFold(), fold: Math.round(v * 100) }))
  const clash = range('clash', 'how mismatched', on.readFold().clash / 100, (v) => on.fold({ ...on.readFold(), clash: Math.round(v * 100) }))
  const seed = h('input', 'w readout')
  seed.size = FOLD_SEED_LENGTH
  seed.spellcheck = false
  seed.setAttribute('aria-label', 'fold seed')
  seed.title = 'the same seed replays the same rules; the stems also depend on the library'
  seed.addEventListener('change', () => {
    const kept = [...seed.value.trim().toLowerCase()].filter((ch) => FOLD_SEED_ALPHABET.includes(ch)).join('')
    if (kept.length === FOLD_SEED_LENGTH) on.fold({ ...on.readFold(), seed: kept })
    drawFold()
  })
  const newSeed = button('new', 'new fold seed', () => {
    on.fold({ ...on.readFold(), seed: newFoldSeed() })
    drawFold()
  })
  foldGrp.append(foldBtn, folded.wrap, clash.wrap, seed, newSeed)
  const drawFold = () => {
    const p = on.readFold()
    pressed(foldBtn, p.on)
    seed.value = p.seed
    for (const el of [folded.wrap, clash.wrap, seed, newSeed]) el.hidden = !p.on
  }
  drawFold()
```

Find:

```ts
  masterGrp.append(level.wrap, reverb.wrap, ...fxRanges.map((r) => r.wrap), turns, turnGrp, ...(opts.dev ? [cutoff.wrap, res.wrap, bypass] : []), invert, visualsBtn, ...(opts.dev ? [reduction] : []))
```

Replace with:

```ts
  masterGrp.append(level.wrap, reverb.wrap, ...fxRanges.map((r) => r.wrap), turns, turnGrp, foldGrp, ...(opts.dev ? [cutoff.wrap, res.wrap, bypass] : []), invert, visualsBtn, ...(opts.dev ? [reduction] : []))
```

In `src/main.ts`:

After:

```ts
import { loadTurnaroundPrefs, saveTurnaroundPrefs, type TurnaroundPrefs } from './ui/turnaroundPrefs'
```

Insert:

```ts
import { loadFoldPrefs, saveFoldPrefs, type FoldPrefs } from './ui/foldPrefs'
import { radioClashLean } from '@shared/radioClash'
```

After:

```ts
  depth: WEB_RADIO_DEFAULTS.turnaroundDepth
})
```

Insert:

```ts
/** The listener's fold mode controls (full mode's strip), remembered per visitor; the radio's
 * defaults (off) until set. Given to the radio when it is made, and on every change. */
let fold: FoldPrefs = loadFoldPrefs(localStore(), {
  on: WEB_RADIO_DEFAULTS.foldMode,
  fold: WEB_RADIO_DEFAULTS.fold,
  clash: WEB_RADIO_DEFAULTS.clash,
  seed: WEB_RADIO_DEFAULTS.foldSeed
})
```

After:

```ts
    turn: (move) => radio?.turn(move ?? undefined),
```

Insert:

```ts
    readFold: () => fold,
    fold: (p) => {
      fold = p
      saveFoldPrefs(p, localStore())
      // the radio takes them at its next wrap (and leans the master in); with no radio yet, the
      // engine's lean is set here
      if (radio) radio.setFoldControls(p)
      else engine?.setFoldLean(radioClashLean(p.on, p.clash))
    },
```

After:

```ts
  applyFx(e, fx) // the listener's saturation, pump and echo
```

Insert:

```ts
  e.setFoldLean(radioClashLean(fold.on, fold.clash)) // fold mode's clash on the master
```

Find:

```ts
        settings: { turnaroundMoves: turnarounds.moves, turnaroundDepth: turnarounds.depth },
```

Replace with:

```ts
        settings: {
          turnaroundMoves: turnarounds.moves,
          turnaroundDepth: turnarounds.depth,
          // the listener's fold mode (full mode)
          foldMode: fold.on,
          fold: fold.fold,
          clash: fold.clash,
          foldSeed: fold.seed
        },
```

- [ ] **Step 4: Run, typecheck, build**

```bash
cd /Users/nickel/Claudecode/ell.ing/radio && npx vitest run src/ui/foldPrefs.test.ts && npm test && npm run typecheck && npm run build
```

Expected: all pass; the build ends `✓ built`.

- [ ] **Step 5: Commit**

```bash
cd /Users/nickel/Claudecode/ell.ing/radio
git add src/ui/foldPrefs.ts src/ui/foldPrefs.test.ts src/ui/full.ts src/main.ts
git commit -m "$(cat <<'EOF'
radio: full mode's fold controls beside the turn -- the switch, how folded, clash, the seed -- remembered per visitor (radio.fold)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz
EOF
)"
```

## Task 21: Full verification, and Elling's listening walkthrough

- [ ] **Step 1: sssketch, all of it**

```bash
cd /Users/nickel/Claudecode/sssketch && npm run typecheck && npm run lint && npm test
cd native-engine && cmake --build build && SSSKETCH_GOLDEN_DIR=$PWD/test/golden build/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine --test
```

Expected: typecheck clean; lint no errors and no new warnings; tests pass (an engine-spawning test can fail on a machine with a stuck coreaudiod: memory note `coreaudiod_thread_leak` — rerun it alone before treating it as a regression); the engine suite `All unit tests passed.`

- [ ] **Step 2: ell.ing/radio, all of it**

```bash
cd /Users/nickel/Claudecode/ell.ing/radio && npm run typecheck && npm test && npm run build && node spike/engine-check/run.mjs
```

Expected: clean, green, built, `all engine checks passed`.

- [ ] **Step 3: Tell Elling, plainly, what has and has not been checked**

Typechecked, unit-tested, engine-tested (sssketch) and checked by offline render (web): yes. Listened to, seen, clicked, or tried on a phone: no — no agent can. **He must fully quit sssketch (Cmd+Q) and relaunch it**, because the engine changed and the engine subprocess only restarts with the app. Then this walkthrough, on both radios where it applies:

1. **Fold on at `fold` 40** (sssketch: the radio menu's `fold` row; web: full mode's `fold` button; phone: the `fold` chips). Within a phrase or two one short layer (a second drums row or a rhythmic/bright one) drifts against the beat, and about every 30–120 s it audibly lands back on the one.
2. **Folding and unfolding are gradual** (a few loop tops of shorter or longer lengths), and the seams do not click. (Each seam has a 10 ms dip; say if it is audible as a gap.)
3. **Straight stretches return**: after a folded stretch the layers walk back and stay straight for a while.
4. **`clash` high** (80+): the picks feel mismatched in rhythm and brightness but never out of key; one bright layer is darkened, and the master leans in a little.
5. **Copy the seed, play a while, paste it back** (or `new` then the old one): the folding behaves the same way, as far as the rows are alike (the stems are still picked freely — the tooltip says so).
6. **Turnarounds and turns still land on the one**, folded or not; phrase ends on a realignment top get a turnaround more often.
7. **Turning the mode off** restores the normal pace (the `bars` window comes back) and every layer's full length at the next loop top; drift and lean go with it.
8. Also listen for: the drift (a slow filter and a little room and echo moving on each layer over half a minute to a few minutes) being too much or too little; changes every 16–64 bars feeling too slow.

- [ ] **Step 4: Record the outcome**

Note what he says in the radio's memory note for fold mode (create `fold_mode_shipped.md` under sssketch's auto-memory, as earlier radio features did) — numbers he wants moved go to their constants in `radioFold.ts` (stretch lengths, menus, drift ranges) and `radioClash.ts`.
