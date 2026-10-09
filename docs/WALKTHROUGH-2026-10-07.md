# sssketch walkthrough before sharing (2026-10-07)

One list in place of the separate "what to check" notes left by each feature and fix since
2026-10-04. Work top to bottom. Tick each box when what you see matches. If it doesn't, write a
line under the item and carry on.

No agent has clicked, seen or heard any of this. Every item below has only been checked in code
and tests.

- **Part A:** your own Mac, the dev app, your real library.
- **Part B:** a fresh macOS user account with a packaged build: what a stranger gets.
- **Part C:** the web radio on your phone.

Known limitations and open decisions are at the end. Read them first so you don't report them as
new bugs.

---

## A. On your own machine (dev, after a Cmd+Q relaunch)

### Before you start

- [ ] Fully quit the dev app (Cmd+Q, not a reload) and run `npm run dev` again. The engine is already
  rebuilt, so there's nothing else to build. **You should see:** the app opens normally. Keep the
  terminal visible: a few checks below read it.

### Startup and loading numbers

- [ ] Watch the opening screen while it loads. **You should see:** real numbers, not just
  "loading library…". For example: `loading library · 412,000 of 761,929 stems · step 1 of 4`, then
  `about 20 s left` once it has a speed. The line should stay on one task and not flip back and
  forth between "loading library" and "indexing library".
- [ ] Time how long until you can use the app. **You should see:**
  - normal launches: usable in about 3 seconds (it used to take 4-8);
  - the first launch on this version, and the first after a LORE sync: one full rebuild of the
    library index. The app is still usable in about 10-12 seconds, and rolls of your own stems work
    soon after. The bottom-right corner shows
    `indexing library · … riffs · about 3 min left` for a couple of minutes (slow USB, see the
    limitations).
- [ ] During that first minute, type, open menus and roll a few Discover rows. **You should see:**
  nothing freezes, and rolls don't hang.
- [ ] Cmd+Q and relaunch again. **You should see:** usable in about 3 seconds, and no long
  "indexing library" this time. The full rebuild happens once.
- [ ] After a library sync (Endlesss or LORE), relaunch. **You should see:** no long "warming
  library" wait, and "jammed with" fills in quickly.
- [ ] Optional, for the record: copy about one minute of the `[work main]` lines from the terminal.
  Also copy the `[work renderer]` lines: View → Toggle Developer Tools → Console, filter `[work`.
  Paste both into a chat with an agent, which will check the numbers against what was measured.

### Login (email and username)

- [ ] Log out of Endlesss, then log back in with your **email address**. **You should see:**
  - "logged in as" shows the email;
  - "me" is still your username: "only my jams" shows your jams, and Discover's `mine` finds
    your stems;
  - the jam list has **one** "Shared Feed", not two.
- [ ] Log out, then log in with your username typed with a capital letter. **You should see:** the
  same as above, with one shared feed (no second capitalised copy).
- [ ] After either login, **you should see:**
  - no "sync your jams now?" question: your install already counts as a yes;
  - syncing carries on as before;
  - the username box shows only what you typed yourself (empty is fine).

### Library: your own jams with LORE, the drive, the sync repair

- [ ] Open import (the library browser) and scroll the jam list. **You should see:** the jams
  sssketch synced itself that your LORE archive doesn't have, listed **once each** with their
  riffs. There are 16, for example "TC 24 Hour Jammageddon", "GRINDCORE" and "Amen Breaks R Us".
  Before this fix they were invisible.
- [ ] Roll Discover a few times and run radio for a while. **You should see:**
  - stems from those 16 jams turn up;
  - the artist picker's counts look sane: a stem that's both in LORE and in sssketch's own library
    is counted once, not twice.
- [ ] With the app open and LORE on the USB drive, eject and unplug the drive. **You should see:**
  - within a second or two, the jam list still shows your own synced jams;
  - Discover keeps rolling from them;
  - no error dialog.

  Plug the drive back in. **You should see:** the archive's jams come back and play, with no
  relaunch.
- [ ] Quit, unplug the drive, launch, then plug the drive in. **You should see:** the archive's
  jams come back and play from the drive. This is the case that used to send stems to the wrong
  place.
- [ ] Sync a private jam that had empty riffs (Jazztronics had 98 of them). **You should see:**
  - this first sync on the new version fetches about 160 riffs across 19 jams once more;
  - afterwards those riffs show their stems instead of being empty;
  - a second sync of the same jam is quick.
- [ ] If a sync stops short, look beside that jam's sync button. **You should see:** why it
  stopped, either `log in to sync` (with the login form right there) or `endlesss asked to slow
  down — try again in N min`. The minutes count down, and the note goes once the wait is over.

### Background work: the classifier and the loudness backfill

- [ ] Watch the bottom-right corner after launch. **You should see:** `categorizing stems` run one
  pass and then go quiet. Cmd+Q and relaunch: it should **not** redo the whole leftover pile
  again (before, that took about 10 minutes of CPU on every launch).
- [ ] Keep watching the bottom-right corner. **You should see:**
  - `analysing stems · N left` picks up the newly visible stems from the 16 jams: about 15,600
    in all, ~1,700 needing only the loudness pass and ~14,000 the full analysis;
  - it works through them for a good while (likely an hour or more) without making the app laggy;
  - it no longer stops at about 98%.
- [ ] Turn the Discover library-scan consent off. **You should see:** the library scan stops, but
  stems you place on the timeline are still analysed. Turn it back on afterwards.
- [ ] Open a project, close it, and open it again. **You should see:**
  - stem glyphs and pitch lines look the same as before;
  - the second open is quicker, because nothing is analysed again.

### Discover: full window and "mine"

- [ ] Open Discover. **You should see:**
  - the library browser fills the whole window, not a framed card;
  - more radio rows fit;
  - the close button and Escape still close it.
- [ ] Turn on "only my stems" (`mine`) and roll all rows a few times. **You should see:**
  - every kind of row fills with your own stems, not the same handful repeating;
  - the first `mine` roll after a launch can take a few seconds, and later ones are quick.
- [ ] Look at the `source` dial. **You should see:**
  - it's still where you had it (95 for an existing install);
  - a change you make survives a Cmd+Q relaunch;
  - double-clicking it resets it to 50.

### Radio: simple and advanced

- [ ] Start radio. **You should see:** it opens in `simple`.
  - Top line: play/stop, `radio` with its interval line, the status line, the ruler, `keep`, the
    `simple / advanced` switch, undo, redo and `?`.
  - Each row: m, s, skip, 👍, 👎, hook, dig, the coloured kind label and its plates.
  - Live bar: tempo, pace, skip, new bed, turn and level.
  - No settings columns and no move chips.
- [ ] With a loop playing and a change on its way, switch to advanced and back a few times.
  **You should see:**
  - no audible restart or dropout;
  - no waveform blinking, and the playhead keeps running;
  - the waiting change lands when it would have.
- [ ] Leave it on advanced, Cmd+Q, relaunch, start radio. **You should see:** advanced. Switch to
  simple, relaunch: simple.
- [ ] Lock a row in advanced, then switch to simple. **You should see:** a padlock mark that does
  nothing when clicked; its tooltip says `locked · unlock in advanced`. Unlock it in advanced and
  the mark goes.
- [ ] In advanced, turn fold on, set turnarounds to `often` and change the turnover, then switch to
  simple. **You should see:** fold's readout still on the rows, turnarounds still marking phrase
  ends, and `t` / `turn` still turning.
- [ ] In advanced, set density to `intensity`, then switch to simple. **You should see:**
  - `build` and `drop` after `turn`, and `energy` and `drama` before `level`;
  - a value dragged in simple shows the same in advanced, and double-click resets each dial;
  - with density back on `arc`, simple shows none of the four (hidden, not greyed, as you decided).
- [ ] Open popovers and use the keyboard. **You should see:**
  - a row's kind menu, its nearby popover and the artist picker each close when you click `simple`;
  - Tab reaches the switch, and Enter or Space flips it;
  - each view's tooltip says what the other adds or leaves out.
- [ ] Resize the window to about 945 × 614, then about 1440 wide. **You should see:** no sideways
  scroll, and simple fits more rows than advanced.
- [ ] Stop radio. **You should see:** Discover looks exactly as before.

### Radio: intensity (build, breakdown, drop)

Desktop density stays on `arc` until you change it, so set density to `intensity` first.

- [ ] Leave the defaults and listen for about 5 minutes, then again with 16-bar loops.
  **You should hear:**
  - a build that starts lighter than the drop before it;
  - rows join and the drums get busier;
  - on a phrase start, the drums echo out and the bass goes while the pads carry;
  - 16-32 bars later, a riser and a gap bring everything back as the drop.
- [ ] Set drama to 10, then to 100. **You should hear:**
  - at 10: a swell with nothing dropped and no gap, though the heavy drums and bass still turn
    lighter at the top of the build;
  - at 100: full breakdowns.
- [ ] Set energy to 0, then to 100. **You should hear:**
  - at 0: long builds and two-phrase breakdowns;
  - at 100: short breakdowns and long rides.
- [ ] Leave it running for about 15 minutes. **You should hear:** a bigger peak, with five rows, a
  second drums layer and a deeper breakdown.
- [ ] Try the buttons. **You should hear:**
  - `build` during a ride: the build starts at the next loop top;
  - `drop` in a breakdown: the drop lands at the next top;
  - `drop` while building: a quick low drop, then back.
- [ ] Hook a drums row. **You should hear:** it rests through the breakdown and is back on the
  drop. A hook that's away comes back at the drop.
- [ ] Turn fold on. **You should hear:** more bend at the drop, less in the breakdown.
- [ ] Unmute a row that's resting. **You should hear:** it plays at once, and the drop still lands
  for the others.

### Radio: moves drawn on the rows

Set turnarounds on with depth `bold`, and keep density on `intensity`.

- [ ] Press the `drums out` chip, or `turn`. **You should see:**
  - the drums row dims within a beat of hearing them leave;
  - it's full again exactly on the one;
  - the move's word shows during the move and disappears quickly after.
- [ ] Press `lift`, then `dip`. **You should see:** lift thins the rows' lower halves as the filter
  rises; dip thins the upper halves. Both are back on the one.
- [ ] Press `wash`. **You should see:** the washed rows soften as the send grows, and clear on the
  one.
- [ ] Turn until a riser with `→ gap` shows on the ruler, or set drama 50+ and press `drop`.
  **You should see:**
  - the line under the ruler fills toward the one;
  - in the gap, every row dims except the one that keeps playing;
  - the one brings everything back at once.
- [ ] Wait for a breakdown, or press `drop` twice. **You should see:**
  - the drums and bass rows fade (not cut) at the breakdown's line, stay dim, and come back on
    the drop;
  - a drums echo leaves a faint trail ("ghost") into the rest.
- [ ] Watch a change land. **You should see:**
  - a hole dims the outgoing row;
  - a filter-in opens the new row's top;
  - a bloom washes it, then clears;
  - a duck dips the other rows for a beat;
  - a riser fills a line along its row.

  A longer stem landing at the top of a loop should still line up with what you hear.
- [ ] Hook a row and wait for `hook out`. **You should see:** it dims at its line and stays dim
  until it comes back. A row you muted yourself looks different: grey/faint, not tinted.
- [ ] After each move, look at the rows. **You should see:**
  - they return exactly to how they were;
  - with nothing happening, nothing on the rows moves.
- [ ] Turn on System Settings → Accessibility → Display → Reduce motion. **You should see:**
  - dims and filter thinning shown as steady states;
  - no blur, ghost or riser lines.

  Turn it back off afterwards.
- [ ] Repeat a couple of the above in simple view. **You should see:** the same moves drawn in
  both views.

### Radio: the `?` guide

- [ ] Click `?` (after redo). **You should see:** "how radio works" opens over radio. Radio keeps
  playing untouched.
- [ ] In the guide, press space and the arrow keys. **You should see:** the text scrolls; space
  doesn't close the guide or start/stop playback.
- [ ] Close it with Escape, then with the close button, then by clicking outside. **You should
  see:** all three close it, and focus returns to `?`.
- [ ] Read it through. **You should see:** control names match the real labels, and nothing reads
  as wrong.
- [ ] Drag a file onto the open guide. **You should see:** nothing is imported.

### Radio: build and drop on the phone remote

- [ ] Turn on the phone remote, pair your phone, and set radio's density to `intensity`. Press
  build and drop on the phone. **You should see:**
  - they act as they do on the Mac;
  - the phone's words (`building`, `dropping`, `not now`, `density not intensity`) fit on a narrow
    phone;
  - the remote works the same whether the Mac is in simple or advanced.

### Combine artists

- [ ] With radio off, pick one artist as usual and roll a few rows. **You should see:** nothing
  new, and the same behaviour as before.
- [ ] Pick an artist you've jammed with, then add a second with `+`. **You should see:**
  - the field reads `artist: <first> + <second>`;
  - "roll all" on 4 rows gives two of each;
  - hovering a waveform shows `by <name>`.
- [ ] Run radio with the two combined for about 10 minutes. **You should see:**
  - the picker's `turns:` line stays within a couple of each other;
  - the row plates' `— name` alternate;
  - when one artist has nothing for a row, `no <name> fits` flashes and the row still changes.
- [ ] While radio runs, add a third artist, then remove one. **You should see:**
  - adding: nothing jumps, and the new artist shows up within the next few changes;
  - removing: that artist's rows turn over, one per loop top.
- [ ] Combine `me` with an artist. **You should see:**
  - your stems and theirs alternate;
  - the faves dial works;
  - `my sounds` is greyed out.
- [ ] With artists combined, reroll a row from the phone remote a few times. **You should see:**
  the rows still alternate between artists.

### Plugins and saving

Advanced features must be on (they should already be on for you, see the next section).

- [ ] Open a plugin editor, turn a knob, and close the editor. **You should see:**
  - the project shows as unsaved, and Cmd+Q asks to save;
  - after you save, quit and reopen, the knob is where you left it.
- [ ] Save, open a plugin editor, and close it without touching anything. **You should see:** the
  project stays saved. Opening an editor alone no longer counts as a change.
- [ ] Save, then turn a knob with the editor still open. **You should see:** "unsaved" comes back
  within about a second.
- [ ] Try a plugin that moves on its own: a compressor with a gain-reduction meter, or anything
  with an LFO. Play something through it, save, then leave its editor open for a minute without
  touching it. **You should see:** the project stays saved. Then turn one of its knobs. **You
  should see:** "unsaved" within about a second. Try two or three different plugins (VST3 and AU)
  if you can: a knob in a plugin that doesn't report it properly might be missed, and that's worth
  a line here.
- [ ] Save, then in a plugin that takes a file (a convolution reverb's IR, a sampler's sample),
  load a different file, or pick a preset from the plugin's own browser. Close the editor. **You
  should see:** "unsaved" within about a second. Do it again, but leave the editor open and press
  Cmd+Q. **You should see:** it asks to save. (The engine now compares the plugin's whole state
  when its editor opened with its state when it closes, and before a quit or an autosave.)
- [ ] Keep turning knobs in an open editor for about a minute, then force-quit the app (Activity
  Monitor → sssketch → Force Quit) and relaunch. **You should see:** the offer to recover unsaved
  work, with your knob settings in it. (The crash-recovery copy is now written at least every 30
  seconds while you keep editing; before, constant knob turns kept putting it off.)
- [ ] Save, wait 10 seconds, Cmd+Q and relaunch. **You should see:** no "recover unsaved work"
  offer. Do the same with a brand-new project's first save, and once after an edit you undid back
  to the saved state (wait the 10 seconds after the undo too: see the limitations).
- [ ] Save, make an edit, wait 10 seconds, then close the window with Cmd+W (the app keeps
  running). Click sssketch in the Dock. **You should see:** the offer to recover unsaved work.
  Don't answer it: press Cmd+Q, then relaunch. **You should see:** the same offer, with your edit
  in it. (Before this fix, that Cmd+Q deleted the only copy.)
- [ ] Same again, but after Cmd+W press Cmd+Q straight away, without clicking the Dock. **You
  should see:** no save prompt; the app just quits. Relaunch. **You should see:** the offer to
  recover, with your edit in it. (Before this fix, the prompt's Save couldn't save from a closed
  window and told you to choose Don't Save, which deleted that copy.)
- [ ] With tweaked plugins loaded, run `pkill sssketch-engine` in a terminal, which forces the audio
  engine to restart. **You should see:**
  - the plugins reload with your tweaks;
  - a save afterwards keeps them.
- [ ] Open project A, which has plugin X tweaked, then project B, which has X at its defaults.
  **You should see:**
  - B's X stays at its defaults;
  - saving B doesn't write A's settings into it.
- [ ] Open a project with a plugin on a channel's insert, then open another project that has no
  plugin on that channel (or no plugins at all). Play. **You should hear:** no trace of the first
  project's plugin. Before this fix it kept playing in the second project.
- [ ] Make some unsaved edits, then use Duplicate. **You should see:** the new version has the
  edits, and the original is unchanged. (Before this fix, Duplicate damaged the original.)
- [ ] Use "save a copy" elsewhere, and rename an untitled project with plugins. **You should see:**
  both keep the plugin settings.
- [ ] Remove a tweaked plugin, then press Cmd+Z. **You should see:** it comes back with its tweaks.
  Do it again, pressing Cmd+Z straight after removing it (as fast as you can). **You should see:**
  the same: its tweaks, not its defaults.
- [ ] Remove a tweaked plugin, then pick the same plugin again from the slot's menu or "browse
  all...". **You should see:** it comes back at its defaults. Only Cmd+Z brings back the tweaks.
- [ ] Remove a tweaked plugin, wait a second, pick a **different** plugin in the same slot, then
  press Cmd+Z twice. **You should see:** the first plugin comes back with its tweaks, not at its
  defaults.
- [ ] Load a plugin that fails (or rename its file so it can't be found). **You should see:**
  - it stays in its slot and shows "failed to load" (or `not in your plugin list · scan for
    plugins`);
  - after a rescan it loads, with its settings.
- [ ] Open a project that has channel plugins. **You should see:** they load and you hear them.
  A slot that shows "failed to load" stays that way; it isn't retried over and over.
- [ ] Open a project with plugins and touch nothing. **You should see:** it does **not** show as
  unsaved, and Cmd+Q doesn't ask to save.
- [ ] If you have any plug-ins in your own `~/Library/Audio/Plug-Ins` folder, run "scan for
  plugins". **You should see:**
  - they appear in the list;
  - plugins already used in projects still load.

### The advanced features switch

- [ ] Open the gear menu. **You should see:** `advanced features: on`. Your install used plugins,
  so it started on.
- [ ] Turn it off. **You should see:**
  - these disappear: phone remote…, the record dot, add channel, the arm button, audio in, the `/`
    and `\` keys, the master chain button, channel fx, sound defaults…, radio hearts key… and fetch
    hearts;
  - the project's own `sound` button and the radio strip's sound column stay;
  - any open phone remote, master chain or sound defaults panel closes.
- [ ] With it off, open a project that uses plugins. **You should see:**
  - the note `this project uses plugins · turn on advanced features to hear them`;
  - playback without the plugins;
  - an export mix also without them, matching what you hear.
- [ ] Turn it back on. **You should see:**
  - the plugins load with their saved settings;
  - turning it off and quickly on again resets nothing.
- [ ] Turn it off, Cmd+Q, and relaunch. **You should see:** no orange microphone dot in the menu
  bar; sssketch no longer holds the mic.

  Turn it on and arm a channel. **You should see:** recording still works; the input opens when you
  arm.
- [ ] Check `fetch hearts`. **You should see:** it shows only with a hearts key set **and** the
  switch on.

### The codex/phase-cache branch (merged 2026-10-09)

Its features, plus the fixes made on top of them at the merge. Rebuild the engine and Cmd+Q
first: the engine changed.

- [ ] **Cross.** Select exactly two riffs in Sketch (or the Shelf). **You should see:** a `cross`
  action beside Discover in the inspector; with one or three riffs selected, it's gone.
  Open it. **You should see:**
  - the two riffs as columns, and a center column with one empty `drop stem here` slot;
  - dragging a stem (or using the inward buttons) into the center adds it, and a new empty slot
    appears below;
  - clicking a column's stem plays that column; the playhead and the playing column's indicator
    move;
  - `undo`, `redo`, `swap sides` and `clear` do what they say.
- [ ] In Cross, press the tempo `+` a few times while it plays. **You should hear:** the preview
  speed up. Close Cross. **You should see:** the project's tempo unchanged, the project not marked
  unsaved, and nothing new to undo.
- [ ] If you have one, re-one a riff whose stems mix LORE audio and a dragged-in WAV, so it has a downbeat offset
  that isn't baked yet, then open Cross with it. **You should hear:** every stem in time, each
  with its own sound (none swapped with another).
- [ ] Build a center, press `add to shelf`, then `add to timeline`. **You should see:**
  `✓ added to shelf` / `✓ added to timeline`, and the new riff in each place. Close Cross.
  **You should see:** your riff selection still highlighted, and reopening Cross starts a fresh
  draft.
- [ ] Re-one one of the Cross child's parents. **You should see:** the parent's arranged copies
  move with it, and the Cross child doesn't.
- [ ] **Discover seed.** Re-one a riff without baking (leave the offset live), save, then open
  Discover from it. **You should see:** Discover seeded with its stems, in time, and the project
  still saved (no unsaved mark, nothing new to undo).
- [ ] **Arrange mixer strip.** Open Arrange. **You should see:** each row's `m`, `s` and gain in a
  narrow rail beside the inspector, lined up with the rows, and the clips no longer covered by
  them.
- [ ] **Mute and solo layers.** Press a row's `m`. **You should hear:** it go silent. Save, close
  and reopen. **You should see:** it's unmuted again (the row `m` is temporary now). Export a mix
  with a row's `m` on. **You should hear:** that row in the export.
- [ ] Mute two rows with `m`, then solo a third with `s`. **You should see:** `s` lit blue, and
  only the soloed row sounds. Clear the solo. **You should see:** the same two rows still muted.
  Undo. **You should see:** mute and solo left alone (they aren't undo steps).
- [ ] Open an older project where you muted a riser's row before this version. **You should see:**
  that row's `m` lit and the riser silent. Press `m`. **You should hear:** the riser again, and
  the project is marked unsaved (it changes the saved project); Cmd+Z mutes it again.
- [ ] **Metronome volume.** Drag the metronome button up and down. **You should hear:** the click
  get louder and softer; a plain click still turns it on and off. The default is louder than
  before (1.5); say if that's too loud.
- [ ] Optional: with the metronome on at a non-default volume and the transport playing, run
  `pkill -x sssketch-engine` in a terminal. **You should hear:** after the engine restarts and you
  press play, the click at the same volume.
- [ ] **Import press-to-stop.** In import, click a riff to preview it, then click the same riff
  again. **You should hear:** it stop, with the riff still selected; a third click plays it again.
  Switch jams and come back. **You should see:** the jam you had selected.
- [ ] **Startup and welcome ×.** At launch, press the × on the loading screen. **You should see:**
  the app, usable as the library finishes loading.
- [ ] Make a recovery offer: edit a project, wait 10 seconds, then force-quit (Activity Monitor →
  the `Electron` process in dev → Force Quit). Relaunch and press the welcome's × (not recover or
  discard). Make some new edits and wait 10 seconds, then force-quit again. Relaunch. **You should see:** a recovery offer
  of the **new** edits. (Before the fix, there was none: closing the welcome had turned autosave
  off.)
- [ ] **Selection styling.** Select riffs in Sketch and the Shelf. **You should see:** the
  selection centred on the circle, a low-contrast texture, and selected and playing looking
  different.

---

## B. On a fresh macOS user account, with a packaged build

### Setup

- Use a packaged build made the way a release is (the next draft release is best: signed and
  notarized). A local `npm run build:mac` works too. For release-like speed, ask an agent to set
  the engine build to Release first. Gatekeeper behaves differently on an unsigned local build.
- Make a new standard user: System Settings → Users & Groups. Put the `.dmg` in `/Users/Shared`,
  then log into the new account.
- If macOS ever says a keychain can't be found, click **Cancel**. Never click "Reset To Defaults".

### Checks

- [ ] Check the download size. **You should see:**
  - the `.dmg` size is reasonable (write it down);
  - after installing, the app is roughly 400 MB in Finder's Get Info, about half of 1.4.0;
  - in Show Package Contents → Contents → Resources → `yamnet`, the file `yamnet.onnx` is
    there. That's Discover's similarity model, which every release up to now was missing.
- [ ] Install it and open it for the first time. **You should see:**
  - after the usual "downloaded from the internet" question (signed build), it opens;
  - **no microphone prompt** and no camera prompt at launch;
  - no orange mic dot in the menu bar.
- [ ] Take the tour, then drag a few stems in. **You should see:**
  - the tour plays its demo rifff (your two 2023 stems, kept on purpose);
  - dragged stems land on the timeline.
- [ ] Look for "elling" anywhere. **You should see:**
  - in import, the username box is empty with its placeholder, and one line says
    `log into endlesss or type your endlesss username to see your own jams first`;
  - "only my jams" isn't offered, and Discover's `mine` is disabled;
  - no `radio hearts key…` and no `fetch hearts`.

  Export an Ableton project and open it in Live. **You should see:** no track or clip named after
  one of your old clips ("8 - elling - Saturator…").
- [ ] Open Discover, and start radio, with the library still empty. **You should see:**
  - Discover: `your riff library is empty, so discover has nothing to roll yet.`;
  - the radio start prompt: `…so radio has nothing to play yet.`;
  - both followed by the ways to fill the library, and a line saying dragged stems go to the
    timeline;
  - no scan consent card yet.
- [ ] Open the gear menu. **You should see:** `advanced features: off`, and none of: phone remote,
  record, add channel, master chain, sound defaults, hearts key.

  Turn it on. **You should see:** they appear.
  - If you can, install one free plug-in into **this account's** `~/Library/Audio/Plug-Ins/VST3`,
    then "scan for plugins". **You should see:** it's found.
  - Arm recording. **You should see:** macOS asks for the microphone only now. Note the wording.
  - Optional: start the phone remote. **You should see:** macOS asks to allow incoming connections,
    and the phone pairs with the four-character code.
- [ ] Log into Endlesss (your own account is fine). **You should see:**
  - `sync your jams now? (about N riffs + your shared feed)` with `sync` / `not now`.
  - Press `not now`. Nothing downloads, and a quiet `sync my jams` appears beside log out.
  - Relaunch. It doesn't ask again.
  - Press `sync my jams`. The jams fill in, and within a few seconds the empty-library note in
    Discover goes and the scan consent card appears.
- [ ] Point at a LORE archive: plug in the LORE drive or a copy. It's opened read-only. Use gear →
  `change riff archive location…`. **You should see:**
  - picking the `common` folder (one level off) still finds the archive;
  - picking an unrelated folder changes nothing and says what to pick;
  - `use sssketch's own library` switches back.
- [ ] Look at Discover's `source` dial. **You should see:** it starts at 50 (half and half).
- [ ] Read the README's "What you need", "Discover and radio", "Advanced features", "Where your
  stuff lives" and "What goes over the network" sections. **You should see:**
  - each one matches what you just saw;
  - `~/Music/sssketch` and `~/Library/Application Support/sssketch` exist on this account, and
    the synced audio sits under the second, in `endlesss-cache`.
- [ ] If you can borrow an Intel Mac, do one pass there. Use the release notes' "which file do I
  download" guide, install the `-x64` file, then play the tour, run radio for a few minutes and
  export a mix. **You should see:** it all works as on Apple Silicon.

---

## C. The web radio on your phone

- [ ] Open ell.ing/radio on your phone in a private tab (so it starts at the defaults) and start it.
  **You should see:** density `intensity`, energy 50, drama 60, pace 60.
- [ ] Leave it playing for 10+ minutes. **You should hear:**
  - builds, breakdowns and drops within the first 5 minutes;
  - it keeps playing past the first breakdown (2-4 minutes in), which is where it used to stop.
- [ ] Lock the screen for a minute, then unlock. Also walk out of Wi-Fi range onto mobile data.
  **You should hear:** it carries on. A stem that fails to load is skipped, and the row keeps its
  old stem; nothing stops.
- [ ] In full mode, watch a breakdown and a drop. **You should see:** the moves drawn on the rows
  (dims, risers). Simple mode shows none of them, by design.
- [ ] Open `?`. **You should see:** it says the web radio starts at 60, and space scrolls the text.

---

## Known limitations (not bugs to report)

- **97 hidden stems.** 4 jams exist in both LORE and sssketch's own library. 97 stems that only
  sssketch's own copy has in those jams aren't reachable from Discover or radio.
- **Slow USB on the first full rebuild.** The first launch on this version, and the first after a
  LORE sync, rebuilds the library index from the USB drive. Your own stems roll after about 12
  seconds; all-stems rolls wait for the whole index, about 2.5 minutes. The first roll's stem
  lookup can also pause about 1 second when the drive is cold.
- **No username at all** (nothing typed, not logged in): on a full rebuild, nothing can roll for
  about 2.5 minutes.
- **The loudness backfill tops out at about 98%.** A few stems have no audio file anywhere and
  never get a level.
- **Plugins through the Intel bridge** aren't watched while their editor is open. Opening such a
  plugin's editor marks the project unsaved straight away, whether or not you then change anything.
- **A plugin that changes by itself, without telling the host it's a knob turn:** a few plugins
  never mark their knob turns (no "gesture"). For those, a change made on the app's main thread
  counts, unless it's a meter. An AU that shows its meters as ordinary parameters can still mark
  the project unsaved while its editor is open. Say which plugin if you see it.
- **Any VST3 "restart" counts as an edit.** When a VST3 plugin tells the host to refresh
  (restartComponent: its latency, its parameter list, its program changed), the engine can't tell
  which, so it counts as a change while the plugin's editor is open, even if you touched nothing.
- **The whole-state check** (an IR or sample loaded, a preset picked in the plugin's own browser)
  compares the plugin's state only while its editor is open: when it closes, at a save, an
  autosave or an export, and before a quit. So:
  - a plugin that keeps its window size or selected tab in its state marks the project unsaved
    when you resize its editor or switch tabs;
  - if you save with the editor open just after such a change, "unsaved" can come back right
    after the save (the save has the change; a second save clears it);
  - a plugin whose state is different every time it's read (a timestamp inside) is left out of
    this check, so a file loaded into it with no knob turned is still missed;
  - Intel-bridge plugins aren't checked (see above).
- **Quitting within a few seconds of undoing back to the saved state** can still offer to recover
  work at the next launch, although it's the same as what's saved. A clean quit now deletes the
  recovery copy only when a save came after the last time it was written: an extra offer is the
  safe side.
- **DAW exports of a project outside the library** (opened from a `.sssketchproj` file anywhere
  else) now go into a folder of their own, named after the project, next to the file:
  `Ableton/<name>/`, `Reaper/<name>/` and `Stems/<name>/`. Before, every project in that folder
  shared one `Ableton/`, `Reaper/` or `Stems/`, and a stems export emptied `Stems/` first, taking
  other projects' stems (and anything of yours in there) with it. Exports made before this version
  stay where they were, directly in `Ableton/`, `Reaper/` or `Stems/`; nothing moves or deletes
  them, so clear them out yourself when you no longer need them. Library projects' exports are
  unchanged.
- **"plugins still loaded" (top right)** appears only if you turn advanced features off and the
  plugins' settings can't be read back. It retries for about three minutes, then stops and says
  to turn advanced features back on. There's no way to force this on purpose.
- **Accepted, not fixed:**
  - Opening a project reloads every plugin, even one already loaded with the same plugin in the
    same slot. Expect a short gap in its sound and a little CPU. Reusing the loaded plugin and
    applying the new settings to it would be faster, but riskier.
  - The first-launch "advanced features" decision reads at most 300 library folders, taken by name
    from the end. Generated names start with the date, so that's roughly the newest 300. A library
    of hand-named folders could be read in a different order. That only affects whether advanced
    features start on.
- **Move visuals, for your eye:**
  - the echo-throw "ghost" is faint;
  - the throw's word ends before the echo stops ringing;
  - the desktop's dims step at about 30 per second;
  - the web may draw slightly ahead of the sound.

  Say if any of these bother you.
- **Combine artists:** the `turns:` tally starts over when the library window is reopened. The
  selection itself stays.
- **Don't use Tidy Up in the old packaged 1.4.0 while dev is running this version.** They share a
  database, and 1.4.0 can overwrite newer bus choices. A new packaged build is fine.
- **Faster startup in a packaged build** hasn't been tried. If a packaged build on your own account
  opens noticeably slower than dev, say so.
- **Endlesss session expiry** can't be forced on purpose. If it happens, the login form should
  appear instead of a stuck "log in to sync".

- **`.bakes` grows.** Every re-one, and every Cross or Discover opening from a riff with a live
  offset, writes new audio into `<your library>/.bakes`, and nothing deletes it yet. It's an open
  item in `TO-DO.md`; deleting it safely needs a check across every saved project first.

## Decisions still open

- With advanced features off, should the sound panel's "make this project's the default" hide too?
  Right now it stays.
- The codex/phase-cache branch left a few small design-system slips, not fixed at the merge: a `#000` drop shadow
  in `App.tsx`, a colour baked into `riff-selection-crosshatch.svg`, a red label on Cross's selected
  column when nothing plays, and some sentence-case `aria-label`s (`Decrease tempo`). Fix them as
  they are, or leave them?
