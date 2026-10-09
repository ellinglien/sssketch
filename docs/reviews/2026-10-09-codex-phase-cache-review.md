# Review: `codex/phase-cache`

2026-10-09. For Rowan, from Elling's side.

Thanks for this branch. There's a lot of real work in it, and several of the fixes close holes
we hadn't found ourselves. This note covers what's coming onto master now, what's held until it's
fixed, what needs Elling's call, and a few process notes for next time. Line numbers are
approximate (`~`), against the branch as pushed.

## What's great

- **The safety fixes.** Quit-save, export isolation, backup restore, the pairing lockout and
  transport ordering are all real bugs, properly fixed.
- **Good pure-module tests.** The logic you pulled out into pure modules is well covered and
  easy to read.
- **The engine side is RT-safe.** No locks, allocation or logging on the audio thread, which is
  the rule that matters most there.

## Coming onto master now

The safety fixes are being brought onto master now, and they're yours: credit goes to you.
Thank you, they make 1.5.x safer for everyone.

## Held until fixed

### Critical

- **Dismissing the recovery welcome disables crash autosave for the rest of the session.**
  `App.tsx` ~1857, with the autosave setup at ~1680. Someone who closes that welcome and then
  works for an hour has no crash protection. The recovery file must stay live whenever work is
  unsaved, whatever happens to the dialog.

### Important

- **Cross fails on mixed LORE/WAV sources.** `crossFromSketch.ts` ~33 matches results to inputs
  by position, but `bakeOffset.ts` ~196 can return them in a different order when LORE and WAV
  sources are mixed. Match by an id or path, not by index.
- **`.bakes/` grows forever.** `projectLibrary.ts` ~104 writes baked files and nothing ever
  removes them. Every generated file needs a cleanup story: when it's deleted, and a bound.
- **The single-instance lock doesn't guard `whenReady`.** `index.ts` ~790. A second launch still
  runs the startup work before it quits. The lock check has to come first and return early.
- **The stop handshake rejects after 2 s when the device is idle.** Those rejections go uncaught
  at `LibraryBrowser.tsx` ~1388 and `LoopFolderPane.tsx` ~195. Separately, `engineClient` doesn't
  remove a waiter when it times out, so waiters pile up.

### Minor

- **Cross's tempo changes the real project tempo.** It should be a preview, not an edit.
- **A Discover seed bakes and dirties the project.** Auditioning shouldn't mark work unsaved.
- **`handleSave` from the quit prompt fails silently.** If the save fails, the person needs to
  know before the app quits.
- **The metronome default gain of 1.5** is louder than before, and it isn't re-sent after an
  engine restart, so the restarted engine plays at its own default.
- **Backup restore isn't atomic.** Write to a temp file and rename, so a failure mid-restore
  can't leave a half-written project.

## Needs Elling's decision

These change behaviour he has chosen before, so they wait for him. Not wrong to propose, just
not ours to decide in a PR.

- **Solo is blue** (`--ra-solo-on`). That's colour on chrome. The house rule keeps solo,
  selection and highlights monochrome.
- **Row `m` is now a temporary mute.** It isn't saved and isn't in exports, and risers can't be
  unmuted. Today mute is saved with the project and affects exports.
- **StartupGate gets a ×.** The gate blocking until the library is usable was his decision.
- **The mixer strip.** A new surface; he'll want to look at it as a feature on its own.
- **CHANGELOG.md / TO-DO.md in the repo.** That convention isn't decided yet. Release notes are
  written by hand at release time.

## Design-system slips

Small, easy fixes:

- A `#000` drop shadow at `App.tsx` ~3118. Use `--ra-shadow-popover` or no shadow.
- `#1d1d1d` baked into `riff-selection-crosshatch.svg`. Take the colour from CSS
  (`currentColor` or a token).
- A red label on Cross's selected column when nothing is playing. Red means mute/danger or the
  playhead; selection stays monochrome.
- Sentence-case `aria-label`s. UI copy is lowercase, including labels screen readers read.

## Process

None of this is a knock on the code. It's what makes a branch reviewable.

- **No spec or plan.** Each feature gets a design doc in `docs/superpowers/specs/` and a plan in
  `docs/superpowers/plans/` before the code.
- **CLAUDE.md wasn't updated** for Cross, `phaseLinkId`, `transport-stopped` or the
  single-instance lock. New subsystems, protocol messages and conventions need a line there.
- **A 703-line mixed commit.** Hard to review and impossible to cherry-pick in parts. One
  concern per commit.
- **Commit noise.** Many small tweak commits, and a commit/revert pair (the shelf-preview
  change). Squash before the PR.
- **One big branch.** The safety fixes, Cross, the phase cache and the mixer strip would each
  have been an easy review as separate PRs.

## Next time

There's now an `AGENTS.md` at the repo root. Codex reads it automatically. It has the house
rules in short form: the design system, one feature per PR, commit style, the tests to run
before pushing, and the shipped behaviours that must not regress. `CLAUDE.md` has the depth.

Once the held items are fixed, splitting what's left into a few small PRs (Cross, the phase
cache, then the decision items as proposals) would be the fastest way to get it all merged.
Thanks again.
