# Call with Ben, 2026-10-08: triage

Elling and Ben went through sssketch together on a call on 2026-10-08, with Ben on 1.5.0. Since
then 1.6.0 has shipped, with Ben's `codex/phase-cache` branch merged (Cross, phase lineage, the
three mute layers, the mixer rail) and a batch of fixes.

This note lists every bug, request and stumble from the call, and checks each one against master
at `ee28be79` (1.6.0). Timestamps are `h:mm` into the recording. Quotes are lightly cleaned up.

Status words:
- **fixed**: done on master, with a pointer.
- **partly done**: some of it is done; the rest is spelled out.
- **not done**: nothing on master yet.
- **unclear**: needs a repro, a log or a decision before it can be called.

Sizes are rough: **small** (an afternoon or less), **medium** (a day or two), **large** (a design
doc first).

Nothing here was clicked through in the app. Every status comes from reading the code and git
history.

**Updated 2026-10-09:** B1 paths 1 to 3 and F6 are fixed on master, and F7 has a note. Those fixes
are covered by unit tests, typecheck and lint only; nobody has heard them in the app yet.

**Updated 2026-10-09, after review of 2dd7c781..459cd8d5:** the review's findings on B1 paths 1
and 2 and on F6 are fixed (72fa76ff, 012d8d12, 54346754, 2282438f, ae2c065e, 2af444aa); each
item below says what changed. One question for Elling is open under F6 (Keep and solo). Same
caveat: unit tests, typecheck and lint only.

---

## Bugs

### B1. Rotation doesn't stick: stems go out of sync with themselves

**What happened.** There were two repros.

- **0:42 to 0:49.** Ben re-oned two riffs in a 190 bpm project. One sounded "slightly off still".
- **1:17 to 1:21.** The first full repro. Ben: "I found a riff in the import view and began to bring
  it into the project. It gave me the set start position window, I adjusted it and brought it into
  the project. Then from the sketch window I dragged it down, and in the inspector I clicked... and
  now it's out of sync with itself." It looked like "only some of the stems have been rotated":
  the harp wasn't. Deleting it and dragging it back in from the shelf gave the same result, and so
  did Arrange. Another riff was fine and a third was off. Ben: "the rotation isn't sticky." At
  1:40 Elling guessed "it could have been a timing thing where you dragged it too soon", before
  the processing had finished.
- **2:35 to 2:41.** The second repro. In Sketch, Ben opened Discover from a riff several times,
  muted and unmuted rows, deleted some stems, skipped around, used Discover's undo a couple of
  times, and added results to the shelf. Afterwards "the melodic thing is in a different phase
  position to the rhythmic thing". The problem also showed up on Discover-made riffs he had never
  used undo on. Elling: "it might be the same error in both places."

**Status: mostly fixed by Ben's phase lineage. Paths 1 to 3 below were fixed on 2026-10-09; path 4
is still open.**

**Why 1.5.0 broke.** Three things in 1.5.0 fit both repros. Each was checked with
`git show v1.5.0:...`.

1. **A re-bake overwrote its file in place.** `bakedPathFor()` in 1.5.0's `bakeOffset.ts` mapped
   `x.wav` to `x.baked.wav`, and a `.baked.wav` to itself. So a second re-one of a riff rewrote the
   same file.
   - Endlesss riffs in one jam reuse layers, so many riffs, and every riff built from them in
     Discover, named that same file.
   - Re-oning one riff therefore rotated those layers inside every other riff that used them.
     Each of those riffs' own layers stayed where they were.
   - That is "melodic out of phase with rhythmic" on riffs Ben never touched.
   - It also broke undo: undo put the old path back, but the file at that path already held the
     newer rotation.
2. **`APPLY_BAKE` matched riffs by shared file path.** In 1.5.0 it used
   `groupIdsSharingStemPaths()`, so a bake repointed matching stems in every riff that contained
   them, shelf riffs included.
   - A riff that shared two of its five layers with the riff being re-oned got only those two
     rotated.
   - It also accepted a partial batch: some stems repointed, the rest left on the runtime offset.
3. **The pick was applied first and baked afterwards.** 1.5.0's `applyOffset` dispatched
   `SET_OFFSET_STEPS` straight away, then baked in the background.
   - Until the bake landed, or if it failed for some stems, the riff's phase lived partly in
     `off` and partly in the files.
   - 1.5.0's Discover seed (`openRiffLibraryWithDiscoverSeed`) used `rifff.stems` paths and
     ignored `off` entirely. So a riff whose rotation was still a runtime offset, wholly or in
     part, went into Discover unrotated, and came back to the shelf that way.
   - That fits Elling's "dragged it too soon" theory, and the riff staying wrong after
     delete-and-redrag.

**What master does instead.** Each item points to code.

- **Copies are never rewritten.** A re-oned copy is named by its recipe: the original, the rotation
  in samples and `BAKER_VERSION` (`src/main/reonedRecipe.ts`). A different rotation is a different
  file. A re-one always bakes from the original by the total rotation (`phaseBars`,
  `phaseSourcePath`, `src/shared/reonedRotation.ts`). Undo and redo now restore the right audio,
  because the file an old step names still holds the same audio.
- **Re-ones are scoped explicitly.** `bakeTargetGroupIds()` in `src/shared/bakePropagation.ts`
  moves only riffs sharing the `phaseLinkId`. A shelf riff is never touched just because it shares
  a file.
- **A batch is all or nothing.** The `APPLY_BAKE` reducer (`state/store.ts`) adopts a batch only if
  it covers every stem of a target. `bakeStems()` (`components/BeatPicker.tsx`) refuses a short
  result.
- **Nothing changes until the bake is done.** `applyOffset()` no longer dispatches a runtime offset
  first; it commits only after every stem has its copy. A riff dragged in early is simply
  unrotated, and the bake lands on it later, because placing keeps the same `groupId`.
- **Discover and Cross seeds bake the phase you hear.** `rifffForSketchCross()`
  (`components/crossFromSketch.ts`) renders the riff's live offset, including per-stem offsets,
  without adopting it (e16fca98). Seed stems carry `phaseSourcePath` and `phaseBars` into Discover
  (`audio/discoverSeed.ts`) and back out through add to shelf or timeline (`resolveDiscoverRifff`
  in `DiscoverPanel.tsx`).
- **Mute is no longer an undo step.** Row `m` and `s` are temporary layers, pinned across undo
  (`history.ts`), so muting and unmuting can't interleave with phase edits in the undo history.

So both repros should not happen again in the form Ben hit them. The paths below can still give a
riff, or a Discover result, mixed phase.

**Paths that can still lose or mix rotation.**

1. **Discover and radio mix a re-oned seed with raw candidates.** Seed rows keep their rotation.
   Every rolled or radio-picked candidate comes from the library at its raw Endlesss phase, even
   one from the same jam (`buildSeedSlotsFromStems` says so on purpose).
   - The batch import treats riffs of one jam as sharing a clock phase (`pickerBatchGroupIds` in
     `App.tsx`). So a seed re-oned by anything other than whole loops is out of phase with its own
     jam-mates in Discover.
   - What you hear is what gets added, so this isn't the rotation being dropped, but it will sound
     exactly like the 2:37 complaint.
   - Ben's own pick at 0:42 was "one step of a beat" off a bar line, which is the bad case.
   - **Fix:** when a candidate comes from the seed's jam, bake it by the seed's `phaseBars` (or
     offer that as a toggle). Add a per-row nudge or re-one in Discover for everything else (see
     F7). **Medium.**
   - **Status: fixed** (b2f554ab, 0085afad). Seeding from a project riff looks up each seed
     original's jam (`riff-library-stem-jams`) and keeps the rotation per jam
     (`src/shared/discoverSeedPhase.ts`). A candidate from that jam, or one of the seed's own
     stems, resolves to a recipe-named copy at the seed's rotation, rendered without adopting
     (`alignCandidateStem`, `discoverCandidateStem.ts`). Rows, radio's warm-up and add share it,
     and add carries the lineage. Always on, no toggle: a same-jam candidate at the raw phase is
     never what the musician meant. A failed bake leaves the row unresolved rather than out of
     phase. Candidates from other jams keep their own phase; see F7 for why there's no nudge yet.
   - **Review follow-ups: fixed.**
     - *Double rotation through the discovered room* (72fa76ff). The discovered room and the
       Shared Feed's `shared:` jams collect stems from many jams, and a kept aligned candidate is
       a new StemCID whose audio is already rotated. A seed whose stems sat there rotated every
       candidate from the room again. Those jams never carry a rotation now (`isClockJam`).
     - *One jam notion on both sides* (72fa76ff). The seed read `Stems.OwnerJamCID` and
       candidates carry the riff index's jam; the seed now asks the riff index too
       (`findRiffForStemPath`, the lookup its rows already use).
     - *One engine per same-jam candidate* (54346754). Alignments are gathered into shared bakes
       (`createBakeBatcher`): those within 30 ms of each other, then everything that arrived while
       a batch baked. An engine takes about 0.4 s to spawn here (measured, 8 runs, 365 to 425 ms),
       so 8 same-jam LORE rows went from about 3.1 s of spawns to one or two (0.4 to 0.8 s). A
       failed batch is baked again one job at a time, so one bad stem fails only its row.
     - *A failed bake was silent* (54346754). It now shows "couldn't line up a stem from <jam> ·
       skipped", at most once a minute per jam.
     - *Seed phase lifetime* (ae2c065e). The phase holds only while a seed row is in Discover
       (`activeSeedPhase`) and comes back with one on undo. It is **not** reset when a project
       opens: Discover's rows, the seed's among them, stay through an open, and dropping the
       phase under them would put new same-jam candidates out of phase with them.
     - *Cache keying* has its own tests now (`discoverCandidateStem.test.ts`).
     - Noted in CLAUDE.md: an aligned candidate kept with Keep gets a new `discovered-` StemCID,
       so its analysis and categories don't carry over.
2. **Late stems merge into an already re-oned riff unrotated.** `buildImportedRifff()`
   (`audio/importResolvedRiff.ts`) appends stems that finished downloading after the first import
   onto the same riff, at raw phase. Nothing re-bakes them by the riff's `phaseBars`.
   - Import only takes stems that are already cached. So: import with some stems still
     downloading, re-one it, then "import to project" again in the same session. The result is
     "only some stems rotated".
   - That is very close to the harp at 1:17, which came right after a re-sync for a missing harp
     at 1:10.
   - **Fix:** in `importResolvedRiff` (`LibraryBrowser.tsx`), when the existing riff's stems carry
     a lineage, bake the new stems by the same total `phaseBars` before `ADD_TO_SHELF`, as one
     batch. Or refuse the merge and import a fresh riff. **Small.**
   - **Status: fixed** (4ff42723). The merge bakes the joining stems to the riff's rotation
     (`sharedPhaseBars`, the rotation most of its stems carry) through the re-oned copies path
     (`bakeToPhaseJob`, recipe-named), all or nothing (`rotateJoiningStems`,
     `audio/importResolvedRiff.ts`). If the bake fails the new stems aren't added, and a notice
     says "couldn't re-one 1 new stem of … · not added · import it again".
   - **Review follow-ups: fixed.**
     - *Stems the rotation wraps to whole loops* (012d8d12). A 1-bar stem joining a riff re-oned
       by whole bars joins as it is, with no lineage, and `sharedPhaseBars` counted it as
       unrotated: three of them outvoted the riff's one 4-bar copy, so the next 4-bar stem came in
       raw. Rotations are now compared within each stem's own loop, so such a stem agrees with
       the riff's rotation. Chosen over giving it a lineage, which `phaseLineage` ignores on
       anything but a copy. Tested with a 1-bar re-one taking 1-bar and 4-bar stems, on the
       import and the Discover side.
     - *Mixed rotations* (012d8d12). Compared wrapped to each stem's loop; a tie goes to a
       rotation a copy carries, then to the earlier stem; stems that disagree get one console
       line.
     - *Merge race* (2282438f). After the bake, the merge re-reads the riff: one deleted meanwhile
       isn't brought back, and one re-oned meanwhile has the stems baked again to its new rotation
       (two bakes in all, then the usual notice).
3. **A sibling's bake in a batch import fails silently.** `onBaked` in `App.tsx` fires
   `void bakeStems(...)` for each sibling and ignores a `null` result. A sibling whose bake fails
   stays wholly unrotated, with only a console line.
   - That matches "this riff is perfect, this other one's off" at 1:20.
   - **Fix:** collect the sibling results and show "couldn't re-one 2 of 5 riffs · try again", as
     the picker's own `applyError` does. **Small.**
   - **Status: fixed** (2dd7c781). The sibling bakes are collected (`reoneSiblings`,
     `src/shared/reoneNotices.ts`), and a failure shows a persistent pill
     (`components/ReoneNotice.tsx`): "couldn't re-one 2 of 5 riffs: … · they're at their original
     phase · re-one them from the inspector".
4. **Projects saved by 1.5.0 keep their damage.** A riff that was already mixed stays mixed. A
   re-pick bakes every stem by the same delta, so it keeps the error.
   - The repair is a dev script (`scripts/recoverLegacyPhaseProject.ts`), not something a user can
     run.
   - **Fix:** either say so in the release notes (re-import affected riffs), or add an inspector
     action: "reset this riff's phase to its original files", which rebuilds every stem from
     `phaseSourcePath` at one chosen rotation. **Small for the note, medium for the action.**

A smaller case, for completeness: radio's fold and turn run phase shifts at play time. Adding to
the shelf during a fold captures the plain stems, not the folded pattern. That's probably
intended, but it's another way "what I added isn't what I heard" can happen.

### B2. "sssketch-engine quit unexpectedly" on Ben's machine

**What happened.** At 0:23, opening an existing project: "it's a sketch engine quit unexpectedly".
It happened again at 1:15 while working, "but the app is still working". Both were on 1.5.0, and
both times Ben was on a video call.

**Status: unclear.** A crashed playback engine respawns silently (`playbackEngineLifecycle.ts`).
The same binary also runs short jobs: plugin scan probes, and the bakes for re-one, Cross and
Discover seeds. If one of those dies, macOS shows the same dialog while the app carries on. That
fits "the app is still working". Related hardening since the call: ec228236, eacc0a4c, abb1ab02
and 620494d8 (the stop handshake and the engine client).

**Fix.**
- Ask Ben for `~/Library/Logs/DiagnosticReports/sssketch-engine-*.ips`.
- Log which mode the engine binary was in when it died.
- Show a quiet "audio engine restarted" notice when the playback engine respawns.

**Small**, once there's a crash report.

### B3. Short cutouts in a 190 bpm project

**What happened.** At 0:44 to 0:48: "it's full, but then it goes do-do-do-do and before the do it
cuts out." The cutout sat right on a line in the clip. The stems were about 190.49 bpm, stretched
to 190. Elling: "that could be the loop point and it might be doing something funny there."

**Status: unclear.**
- Nothing since the call targets stretch or loop seams.
- One cause that sounds like this is fixed: two app copies running two engines a few ms apart
  (2da23ae2, the single-instance lock).
- Still plausible: a stretched file that doesn't land exactly on the bar grid, so the loop
  restarts early or late; or the switch from the unstretched file to the stretched one on first
  play.

**Fix.**
- Get the engine log's `Transport: audio health xruns=` lines from a session where it happens.
- Add a test that a stretched stem's length equals bars × 240 / bpm, to the sample.

**Small to medium.**

### B4. Imported riff missing a stem (the harp)

**What happened.** At 1:10 Ben noticed a harp missing from a riff he remembered. He re-synced the
jam (1:11), and at 1:13 had "all the things".

**Status: partly done.**
- 13c581a9 repairs private-jam riffs whose stem records lacked a download key. Before, those stems
  stayed silent at "0 cached".
- But import still brings in only stems that are already downloaded (`importResolvedRiff`), with
  no warning that some are missing. Stems past slot 12 are dropped with only a log line
  (`riffLibraryWriter.ts`).
- This also feeds B1, path 2.

**Fix.** Show "imported 4 of 5 stems · the rest are still downloading" on import, and re-bake late
arrivals as in B1, path 2. **Small.** The re-bake of late arrivals is done (4ff42723); the import
notice isn't.

### B5. The "categorized" count looked stuck

**What happened.** At 0:26 and 0:40 the settings count sat at 678 of 715 after more syncs, and
again at 1:11. Ben: "I wonder if I need to do something to get that to update."

**Status: partly done.** 7a5aa5fd counts stems the classifier tried and couldn't place as done.
That was the likely reason it stuck below the total. The label now reads "processed X / Y stems ·
N categorized · ...". It is still fetched only when the gear menu opens, and newly synced stems
appear only once the analysis scan reaches them.

**Fix.** Call it "analysed stems" and refresh it while the menu is open. **Small.**

### B6. Loop length detected as 64 steps

**What happened.** At 0:11: "it detects the loop point is at sixty-four for some reason. It's
normally like 16 or 24." Elling fixed it by right-click-dragging the step count.

**Status: not done.** Bars come from file length × bpm (`barsForDuration`). A long file holding a
short repeating pattern reads as long. Nothing has changed since the call.

**Fix.** Check whether the decoded audio repeats: compare the halves and keep halving while they
match. Suggest the shorter length; don't force it. **Medium.**

### B7. Muting a grouped riff wiped its stems' own mutes

**What happened.** At 0:30 Ben asked: with some stems in a grouped riff muted, then the whole
channel muted and unmuted, "does it survive? No."

**Status: fixed.** In 1.5.0, `SET_CHANNEL_MUTE` overwrote the per-stem mutes. Now row `m` writes
only the temporary Mute layer (`mixerMute`), and a stem's Disable is untouched (d538ab8c;
`mixerMute.test.ts`). One thing to know: row `m` is no longer saved with the project. That was
Elling's decision in the merge.

---

## Feature requests

### F1. Stop a riff preview in the import view

**What happened.** At 0:04, 0:15, 0:51 and 1:30. Ben: "I don't have any way of stopping it once it
starts playing." He was stopping it by pressing play and then stop on the transport. Elling, for
the notes: "we need a way to stop and start the riffs that we're previewing... click to start and
click to stop." Ben at 1:30: "it's killing me not to be able to stop this guy."

**Status: mostly fixed.** Clicking the playing riff again stops it (7a5aa5fd,
`libraryPreviewToggle.ts`, `handleRiffClick` in `LibraryBrowser.tsx`). What's left: the detail row
has no visible stop button, so the gesture is invisible.

**Fix.** Add a "stop" button beside "import to project" while a preview plays. **Small.**

### F2. A monitoring volume knob in the import view

**What happened.** At 1:24 Ben: "it would be cool to have a monitoring volume knob... so when we're
on calls we could reduce it slightly and chat over top of it."

**Status: not done.** Import previews (`audio/previewLoop.ts`) and the re-one picker's previews
(`BeatPicker.tsx`) connect straight to the speakers. There's no shared gain and no setting.

**Fix.** Route all Web Audio previews through one shared gain node (a new
`audio/previewOutput.ts`). Add a small slider in the import header, remembered in localStorage.
**Small to medium.**

### F3. Remember the selected jam in the import view

**What happened.** At 1:25: "if I go into the main view and then go back into import, it would be
cool if it remembered which jam I had selected."

**Status: fixed.** 13c581a9 added `components/libraryBrowserSelection.ts`, which saves the jam in
localStorage. It survives a restart too. The selected riff, scroll position and filters still
reset, which is worth doing only if it's asked for.

### F4. Merging riffs (A and B into a new riff X)

**What happened.** At 1:52 to 1:58 Ben described it: "riff one on the left, riff two on the right,
blank in the middle, and you drag elements from one to the other to create a new riff with
elements from both, without having to do anything in the arrangement." It's the way to make
transitions, "in-betweening", and "it's more fun to stay in the sketch view". At 2:40: "we can't
merge them yet."

**Status: fixed.** Cross (`components/CrossPanel.tsx`, `src/shared/cross.ts`) opens from two
selected riffs in Sketch, Arrange, Map or the Shelf. A follow-up worth considering is Ben's "try
to automate it as a starting point" (1:55), for example a "fill the middle" that proposes stems.
Cross's "generate matching stems" may already cover it.

### F5. Go back to a previous radio state

**What happened.** At 2:10: "can I go back if it went past something that I liked?" Ben, for the
notes: "add a way to go back to the previous state of the radio." At 2:34 they found Discover's
undo button: "oh, there's undo... we just discovered a feature."

**Status: partly done.**
- Undo and redo exist in the radio and Discover headers. They cover hand edits, skips and a turn
  still waiting.
- Radio's own automatic changes push no undo point, on purpose (`DiscoverPanel.tsx`: "a radio
  change is not undoable"). So the thing Ben actually asked for, getting back what radio itself
  just changed, doesn't exist.
- Also, Cmd+Z while Discover is open runs the project's undo (`App.tsx`). That can silently undo
  arrangement edits nobody is looking at.

**Fix.**
- Route Cmd+Z and Shift+Cmd+Z to Discover's undo while it's open. **Small.**
- A "back" that restores the slots from before radio's last automatic change, as a short ring of
  snapshots kept apart from the hand-edit undo. **Medium.** Elling decides whether radio changes
  should be undoable at all.

### F6. Keep mute and solo when adding from Discover or radio

**What happened.** At 2:22 Elling: "it doesn't save the mute state... I wish it did, for adding to
shelf or adding to timeline. If it remembered the state of the mute. Or solo."

**Status: fixed** (ad5a3673), by Elling's decision: what you hear is what you get.
- Adding to the shelf or timeline Disables every row that wasn't heard
  (`discoverRowDisabledOnAdd`, `audio/discoverRifffAssembly.ts`): the muted rows, or, while a row
  is soloed, every row but that one. A soloed row comes in even if it was muted underneath.
- Levels carry as they are; a muted row keeps its real gain instead of 0.
- Disable (`state.mute`) is the saved layer, so those rows stay silent in the arrangement after a
  save. The temporary mixer Mute would have been dropped by the save. `ADD_TO_SHELF` and
  `PLACE_LOOP_ON_TIMELINE` take the Disables as an optional `mute`.
- Keep is unchanged: it ignores solo and saves a muted row at gain 0, since the library has no
  Disable.
- **Review follow-ups: fixed** (2af444aa). Discover and Cross share one rule for what's heard
  (`src/shared/heard.ts`). Cross's add now does the same as Discover's: a muted center row arrives
  Disabled at its own level instead of at gain 0, and the center solo counts. It fits Cross's
  model, where a row's mute is the draft's choice and solo the temporary layer over it.
- **Open question for Elling: Keep and solo.** Keep still saves every row, muted ones at gain 0,
  whatever is soloed, so a kept group can sound different from what was playing when it was kept.
  Should Keep follow solo too (keep only the soloed row, or keep all with the others at gain 0)?
  Left as it is until he decides.

### F7. Re-one or nudge rows inside Discover

**What happened.** At 1:46 Ben: "other jams could be out of sync with this, right?" Elling: "there's
no re-oning here... it is what it is."

**Status: not done, on purpose for now.** Candidates from the seed's own jam now follow the seed's
rotation (B1, path 1, fixed). That covers the case that sounds broken: stems that shared a clock
in Endlesss playing out of phase. A per-row nudge wasn't added with it, because:
- A candidate from another jam has no phase relation to the seed. Its raw bar 1 is as good a guess
  as any, and a nudge there is taste, not a fix.
- It's new UI on a crowded row (radio, hooks, solo, kinds), and what it means for radio's
  turnover (does a nudge survive a reroll?) is a product decision.
- The pipeline is ready when it's wanted: `bakeToPhaseJob` plus `alignCandidateStem` bake a row to
  any rotation, recipe-named, and add already carries `phaseBars`.

**Fix.** A per-row shift by beat or bar, baked through the same `.bakes` pipeline the seed uses and
carried into add as `phaseBars`. **Medium.** Elling decides whether it's wanted.

### F8. Zoom the timeline

**What happened.** At 0:43 to 0:44 Ben tried pinching, then the View menu: "is there a way to
stretch out the view?" Elling: "I don't think there is actually."

**Status: partly done.**
- Arrange zooms with Cmd+scroll, and Cmd+0 resets it (`handleTimelineWheel`).
- A trackpad pinch arrives as a wheel event with Ctrl held, and the handler checks only Cmd, so
  pinch does nothing.
- View > Zoom is Electron's whole-window zoom.
- Sketch has no zoom.

**Fix.** Accept Ctrl-flagged wheel events (pinch) and add timeline zoom in and out to the View menu
with shortcuts. **Small.**

### F9. Select a beat without it playing

**What happened.** At 0:54, in the re-one picker: "oh, it needs to be playing, I guess. You could
have a select state which was different from the playback state... then you can stop it playing,
but it's still selected." At 0:56 he found the same in Sketch, where clicking a riff again didn't
stop it.

**Status: partly done.**
- Sketch now separates the two: the round glyph plays and stops, and the square corners only
  select (CHANGELOG, Unreleased).
- In the re-one picker, clicking a beat stages it and plays it, and clicking it again stops the
  sound but keeps the pick. There's a stop/play button too.
- A pick that never starts playback isn't possible.

**Fix.** Option-click to pick silently. **Small**, and low priority.

### F10. Show which riff variations in a jam are really different ("checkpoints")

**What happened.** At 1:04 to 1:06 Ben: "if I ended up with 30 riffs on a jam, it might be that
only 15 of them actually had something happen." Favourites help. He suggested that analysis could
flag "a dramatic change there", and rule out riffs where only an effect moved.

**Status: not done.**

**Fix.** Consecutive riffs in a jam share stem IDs. A cheap first step is a badge on each import
dot: stems added, removed and changed against the previous riff, plus a "gain only" marker when
only `GainsJSON` moved. Dimming near-duplicates is a second step. **Medium.** Spec it first.

---

## UX polish

### U1. "save a copy" and "save a copy elsewhere…" read like a rename, not a fork

**What happened.** At 2:00 to 2:01 Ben used "save a copy", got a file with a "2" in it, and wasn't
sure the original had been saved. "The normal thing, save as... it's not like git, it didn't save
the state of the first one before you went on to create a new one. It's more like you change the
name of the thing you're in."

**Status: not done.** Nothing has changed since 1.5.0.
- "save a copy" (`handleDuplicateAsNewVersion` in `App.tsx`) writes the live project, unsaved
  edits included, as a new numbered version. It switches the window to that version and never
  writes the original. That really is a fork, but the unsaved work goes with the copy.
- "save a copy elsewhere…" (`handleSaveCopyElsewhere`) writes a file via a dialog and stays on the
  original, which is also unsaved. Neither one confirms what happened.

**Fix.**
- Rename the two items, for example "save as new version" and "export a copy to…".
- After each, show one line, for example "now editing <copy> · <original> kept as last saved", or
  "copy written · still editing <name>".
- Decide whether "save as new version" should save the original first. That's Elling's call.

**Small.**

### U2. The shelf doesn't clearly show what Sketch is playing

**What happened.** At 2:38 to 2:39 Ben wanted "a little more contrast up here, or a stronger
highlight, to show the connection" between the riff playing in Sketch and its shelf tile. Elling:
"it's already doing it... the highlight is not prominent enough."

**Status: not done.** Shelf tiles mark selection, hover and the shelf's own preview (a 1px
playhead-coloured edge, 9548d6f0). A riff already on the timeline is dimmed to 0.4. No "sounding
in Sketch" state reaches `Shelf.tsx`. The 10-08 selection commits made the selection quieter, not
louder.

**Fix.** In App, work out which placed riff is under the playhead and pass it to the Shelf. Give
that tile full opacity and the playhead edge (2px). Playhead colour is audio information, so it's
allowed. **Small.**

### U3. Arrange's per-row controls sit at the far end of the timeline

**What happened.** At 0:12 to 0:14 Ben couldn't find a row's mute, solo and volume. "Could you
scroll all the way to the right? Oh, that's where they're hidden." He had assumed the inspector
had replaced them.

**Status: probably not fixed. Check it in dev with a long arrangement.**
- cbb2b3d6, f8af3f08 and 853f758e restyled the controls and added a "mix" rail at the right edge of
  the viewport. But that rail is decoration only (`pointerEvents: none`).
- The real buttons are still inside a `position: sticky; right: 0` box in each row
  (`ChannelRow.tsx`). The row is as wide as the whole timeline, so the box can't stick, and the
  buttons sit at the timeline's end.
- A short project fits on screen, which hides the problem.

**Fix.** Pin the controls in a non-scrolling overlay aligned to the rail, or anchor them with a
zero-width sticky element. **Small.**

### U4. Shelf riffs "multiply"

**What happened.** At 0:09 to 0:11 Ben: "there's four, but did you bring in four riffs? They seem
to multiply." Elling: duplicating on the arrangement makes a new riff "and it doesn't do it very
intelligently." Ben: "I'll just accept that it's going to make some new stuff up there sometimes."

**Status: not done, by construction.** The shelf lists every riff in the project (`Shelf.tsx`), and
paste, duplicate and ungroup each make a new riff.

**Fix.** Record `copyOf` on paste and duplicate, and show one tile per source with a ×N count.
**Medium.** Elling decides whether a duplicate belongs on the shelf at all.

### U5. Import multi-select isn't discoverable

**What happened.** At 0:07 to 0:08 and 1:36: shift-click for a range, cmd-click for single riffs.
Even Elling had to try a few keys.

**Status: not done.** It works, but nothing says so. `src/shared/keyGestures.ts` has no import
section.

**Fix.** Add an import section to the gestures list, and a one-line hint by "import to project".
**Small.**

### U6. Radio controls don't explain themselves

**What happened.** At 2:02 Ben hovered "turn": "it doesn't explain it." At 2:05: "what does like
do?" At 2:07: "what does keep mean?", next to add to shelf and add to timeline.

**Status: not done.** The tooltips are "turn at the top", "like" and "keep this group". The add
buttons have none. The radio guide (`src/shared/radioGuide.ts`) already has better sentences, for
example keep = "save the rows playing now to your library".

**Fix.** Use the guide's sentences as the tooltips. Give the add buttons "into this project".
**Small.**

### U7. Discover's source dial was confusing

**What happened.** At 1:45 Elling explained that the dial "gives fifty percent microphone input",
and Ben: "but wouldn't it just ignore it anyway?"

**Status: not done.** The ends are labelled "endlesss / other", with the tooltip "other clockwise".
"Other" means recorded audio-in stems.

**Fix.** Relabel the ends "instruments / recorded", with a tooltip saying what each end pulls from.
**Small.**

### U8. What the re-one screen is for

**What happened.** At 0:05 Ben wasn't sure whether the screen was "finding the beginning of the
phrase or selecting how much of the clip to import". At 0:42 he asked "what is this blue line?"
It was the pitch line.

**Status: fixed.**
- The header reads "re-one — find the beginning of the loop".
- The spectrogram and pitch line were replaced with waveforms in each stem's colour (3fde84f6).

### U9. Smaller things noticed

- **Map seemed to do nothing** (0:32: "it should be on or off, but it doesn't seem to be working").
  Map is the third view in the arrange, sketch, map cycle, and it works on any arrangement. That's
  likely confusion, not a bug. **Status: unclear.** **Fix:** a tooltip per view. **Small.**
- **Notices appear in different places** (0:26: "it pops up in a bunch of different places...
  slightly different location for the notification"). **Status: not done.** Worth an audit of where
  progress and notices live; not a quick fix.
- **Background sync** (0:25: "does it continue in the background if I close the sync window?").
  Yes. The bottom-right "syncing library · N riffs" indicator already shows it
  (`BackgroundWorkIndicator.tsx`). It's easy to miss, but nothing needs doing.
- **The inspector's stems list looks like controls** (0:29). Ben thought it might be a control
  surface, but it's read-only apart from "ungroup". **Status: not done.** It's minor; a heading
  like "stems in this riff" would do.
- **Import preview sounds different from the project** (0:55). This is expected: previews are Web
  Audio at an estimated gain, and the project goes through the engine and master chain. Nothing to
  fix unless it bothers people.
- **Discover's solo "isn't doing a lot"** (1:44). Solo is a single-row audition. It's probably fine;
  revisit if it comes up again.

---

## Ideas and observations (not bugs)

- **The loop mindset** (2:13 to 2:16). Ben: "I have these loops and I want to cut across them, but I
  don't know how... it feels like chunk A, chunk B, chunk C... the opposite of a jam." Elling: "in my
  head that's just transitions." Ben: "maybe riff A, riff B, and riff X in the middle is how you do
  that." Cross is the first answer. A next step could be Cross making a short transitional riff of
  a different length, or a "thin out / build up" between two riffs. Not a request yet.
- **Auto-arrange and sssketchy** (0:20 to 0:23). Elling: "I wouldn't mess with that. I actually
  don't use that at all... I don't really love this." It's still in the gear menu ("auto-arrange",
  "draw arrangement"), and `SssketchyCoach` is still mounted, not behind the advanced-features
  switch. Whether to hide it behind that switch, or retire it, is Elling's decision.
- **Low-information layers** (2:12). Ben builds beats from many subtle, repetitive stems. Discover's
  density and "eventfulness" traits may undervalue those. Worth bearing in mind when tuning
  matching.
- **Sketch is where the fun is** (1:57). Ben: "going into an arrangement view feels like work...
  this keeps everything free and agile." He would take jams "much further along in here" before
  Ableton. This argues for putting new arrangement tools in Sketch and Cross rather than Arrange.
- **Things that landed well**: the random baseball-style project names (0:50: "you don't have to
  think about what the file name is"), favourites that survive across projects (1:23), Discover
  (2:24: "it's really good"), radio autoplay (2:31), and the non-destructive re-one (0:46).

---

## Suggested order

1. ~~**B1, paths 2 and 3**~~: done 2026-10-09.
2. ~~**B1, path 1**~~: done 2026-10-09. **F7** (a per-row nudge) waits on Elling.
3. ~~**F6**~~: done 2026-10-09.
4. **U3**: confirm and fix Arrange's row controls on long arrangements. Small.
5. **F5 (Cmd+Z routing)**, **F1 (stop button)**, **U1 (save wording)**, **U2 (shelf highlight)**,
   **U5, U6, U7 (labels and hints)**: small, and good as one polish batch.
6. **F2**: preview volume. Small to medium.
7. **B2, B3**: need Ben's crash reports and engine logs first.
8. **B6, U4, F10, F5's radio "back"**: medium. Design first; decisions are Elling's.
