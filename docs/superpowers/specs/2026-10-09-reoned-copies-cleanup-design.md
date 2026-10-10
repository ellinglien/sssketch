# Re-oned stem copies: reuse, rebuild, clean up

Elling, 2026-10-09. Follows the merge of Rowan's (Ben's) `codex/phase-cache` (phase lineage), where every
re-one writes new files to `<library root>/.bakes/` and nothing ever deletes them.

## Words

**Re-oned stem copies** are the files in `.bakes/`. When a riff is re-oned (its downbeat moved),
sssketch writes a rotated copy of each stem so bar 1 lands on the one. Projects that use the riff
play and export from these copies. They are never the user's rifffs, stems or original audio:
those are never touched. Use this name in the UI and docs.

## The problem

- Every re-one, and every Cross or Discover-seed audition of a riff with an unbaked offset,
  writes a full new set of copies, each under a random name (`<uuid>.baked.wav`).
- Nothing reuses or deletes them, so the folder only grows. It lives in the project library,
  often on a USB drive.
- A saved project names specific copies. Deleting one it uses would cost that project its audio,
  and projects can live outside the library where the app can't always find them.

## The design

Three parts. Together they make `.bakes/` a rebuildable cache, so cleaning it can't lose anything.

### 1. Rebuild if missing

Each copy is already reproducible. Its stem records the original file (`phaseSourcePath`) and the
total rotation (`phaseBars`).

- When a project is opened, and before the engine loads it or an export renders it, every stem
  whose `path` is a missing copy is rebuilt.
  - The rebuild uses `phaseSourcePath` plus the rotation that `phaseBars` gives in seconds.
  - It goes through the same baker as a re-one (`bakeOffset`), as one all-or-nothing batch per
    riff.
  - The stem's `path` is set to the rebuilt copy.
- This is a repair, not an edit. It doesn't mark the project unsaved unless the path changed. Part
  2 keeps the path the same in the usual case.
- If the original is unreachable (an unplugged LORE drive, a deleted file), the stem shows as
  missing:
  - Wording: "re-oned copy missing · rebuilds when its original is back".
  - It's retried on the next open, or when the library reconnects.
  - Nothing else changes.

### 2. Reuse instead of duplicating

- A new copy is named by its recipe, not a random id: `<hash>.baked.wav`.
- The hash covers:
  - the original file's identity (path, size, modification time; cheap, no reading the audio);
  - the rotation, in samples;
  - a baker version, bumped if the baker's output ever changes.
- Re-oning to the same spot again, or Cross and Discover auditioning a riff already baked, finds
  the existing file and writes nothing.
- A rebuild (part 1) lands on the same name, so the project's saved `path` stays valid and nothing
  needs re-saving.
- Old random-named copies keep working. They're just never reused, and cleanup handles them like
  any other copy.
- The write stays atomic: render to a temp name, then rename. If two bakes race to the same name,
  both write identical bytes, so the second rename is harmless.

### 3. Clean up unused copies

**What counts as used:** any copy named by
- a `.sssketchproj` in the project library, its backups, or the autosave/recovery file;
- the open project in memory, including its undo history;
- a Cross or Discover session that's open;
- any project outside the library that the app has opened or saved (main keeps a short list of
  those paths).

**Unused** means not named by any of those, and older than a day. The day of grace keeps an
in-progress audition or bake from being cleared out from under it.

**The launch popup.** At launch, after startup, a background pass sizes the unused copies.
- It reads the projects' JSON paths only, in slices, never blocking the main thread.
- At 200 MB or more, a small notice shows:

  > about 1.2 GB of re-oned stem copies aren't used by any project. your rifffs, stems and
  > projects aren't touched, and anything needed later is rebuilt automatically.
  > · clean up · not now

- "not now" stays quiet for 7 days.

**The button.** In the gear menu, "clean up re-oned stem copies…" opens the same message with
the current size, even under 200 MB, so it can be run any time.

**Clean up** deletes the unused files outright. Part 1 makes a wrong guess recoverable, so there's
no Trash step. It reports what it freed: "cleared 1.2 GB".

**Not behind the advanced switch.** Re-one is a basic feature.

## Edge cases

- **Library on an unplugged drive:** no pass, no popup, the button is greyed.
- **A copy shared by several projects:** used if any of them names it.
- **A project moved by hand outside the library, never opened since:** its copies may be cleaned.
  On next open they're rebuilt (part 1), provided the originals are reachable.
- **The old `.sssketch-bakes` folders beside imported WAVs (the pre-lineage baker):** out of
  scope. The new baker no longer writes there.

## Tests

- **The recipe name:** stable for the same inputs, different for a different source, rotation or
  baker version.
- **Reuse:** re-oning twice to the same spot writes one file.
- **Rebuild:**
  - a missing copy is rebuilt to the same name and the project isn't marked unsaved;
  - an unreachable original leaves the stem marked missing, with no crash and no partial batch.
- **What counts as used:** library projects, backups, autosave, the in-memory project and undo,
  open Cross/Discover sessions, and remembered outside projects, each one keeping a copy.
- **The grace day:** a fresh unused copy isn't cleaned.
- **Popup threshold and "not now".**
- **Cleanup:** deletes only unused files and reports the freed size.

## Out of scope

- Cleaning the samples cache or other caches.
- Moving copies off the library drive.
- Content hashing of originals (path, size and modification time is enough).
