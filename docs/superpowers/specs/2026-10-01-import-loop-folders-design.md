# Import: loop folders — design

2026-10-01. Agreed with Elling.

> "is there a way i can drag folders of loops into a directory and have those included in the
> IMPORT section somehow? non endlesss rifffs"
>
> The example was `~/Downloads/Amen Breaks Compilation`. On the model: "each one should be treated
> like a stem". On location: "added from wherever the folder lives". On scope: "only in import for
> now.. discover and radio are another ball of wax". On tempo: "guess based on the length of the
> sample and other things".

## What it is

IMPORT (the Library Browser's browse mode) can **link folders of loops** that live anywhere on disk.
A linked folder appears beside the jams.

- Its subfolders are groups for browsing.
- **Each audio file is a stem.**

Each loop can be previewed, multi-selected and imported. Importing puts it on the shelf as a
one-stem rifff, exactly as `+ sample` does today. Nothing is copied: the files stay where they are.

### Out of scope

- Discover and radio do not see these loops.
- No live file watching (rescan on open instead).
- No REX2 or other closed formats.
- No editing or tagging of the loops beyond tempo correction.

## The example pack, and what it implies

`Amen Breaks Compilation` (93 MB) contains three volumes. Each volume has a `WAV/` and a `REX2/`
folder holding the **same** 80 breaks. Tempo is in every filename (`Creek Break 160.wav`,
`cw_amen08_165.wav`), mostly 160–175 bpm. From that:

- **A folder is never a rifff.** A rifff's stems play together, and a pack's loops are
  alternatives, not layers.
- **Format-only folders are skipped as a browsing level.** A folder named `WAV`, `AIFF`, `MP3`,
  `FLAC`, `OGG`, `REX`, `REX2` or `Audio` (case-insensitive) is flattened into its parent.
- **Only playable formats are listed:** `.wav`, `.aif`, `.aiff`, `.flac`, `.mp3`, `.ogg`. The
  `REX2/` copies, `.txt`, `.DS_Store` and the rest are hidden.

## Behaviour

### Linking

- A `+ folder` button in IMPORT opens a folder picker. The path is remembered. Any number of folders
  can be linked, and each can be unlinked from the same place.
- Linking does not touch the files.
- If the folder's volume is not mounted, for example an unplugged USB drive, the pack shows as
  **unavailable** (greyed, not removed) until it is back.

### Browsing

- A linked folder is a top-level entry beside the jams, titled with the folder's name.
- Subfolders nest as groups, with format-only folders flattened as above.
- A loop row shows:
  - its name (the filename without the extension);
  - its tempo, with a guessed tempo visibly marked as a guess;
  - its bar count;
  - its waveform, from the existing `peakCache`.
- **Preview:** a click previews the loop, using the same preview path every stem in IMPORT uses.
- **Selection:** multi-select works as it does for rifffs today.

### Importing

**import to project** puts each selected loop on the shelf as a one-stem rifff, built the same way
`importOneShot.ts` builds `+ sample`'s rifff today. Reuse that path rather than writing a second
one.

### Tempo: the guess

Tempo is worked out in this order. Only the first is certain; the rest are marked as guesses.

1. **The filename.** `guessBpmFromFilename` (`src/shared/guessBpmFromFilename.ts`). It already
   handles `cw_amen08_165.wav` → 165 and `Creek Break 160.wav` → 160, and returns null for
   `Halftime Dnb Drums 1.wav`.
2. **The folder.** If the filename has no tempo:
   - the folder name's tempo, through the same parser;
   - otherwise the **most common filename tempo among the loop's siblings** in that folder. A pack
     folder usually shares one tempo.
3. **The length.** The bar count from `LOOP_BAR_CANDIDATES` (1, 2, 4, 8, 16, 32) whose implied tempo
   (`bpmForLoopBars`) is closest, in log-space, to the folder tempo from step 2, or to the
   project's tempo if step 2 found nothing. Ties go to the candidate inside 70–180 bpm. This is
   `guessLoopBars`, plus that prior and that tiebreak.

**Bar count.** Once the tempo is known, the bar count is the nearest whole power-of-two number of
bars that fits the length at that tempo. A loop whose length fits no candidate within 3% is marked
**irregular**: it is still importable, and is imported exactly as `+ sample` imports a file today.

**Correction.** The user can correct the tempo on any loop. The correction is stored and survives
rescans. A corrected tempo is no longer marked as a guess.

The decision logic is pure and lives in a new `src/shared/loopFolderTempo.ts`, built test-first.
Its inputs are a loop's filename, its folder's name, its siblings' filenames, its duration and the
project tempo. Its output is `{ bpm, bars, source: 'filename' | 'folder' | 'siblings' | 'length',
irregular }`.

### Staying current

Each linked folder is rescanned when IMPORT opens, and on a manual `rescan`.

- **Cost:** a rescan stats files and only reads the audio metadata (duration) of new or changed
  files, matched by path, size and mtime.
- **The scan is cached** in sssketch's own library database:
  - a `LoopFolders` table holding the linked roots;
  - a `LoopFiles` table keyed by path, holding size, mtime, duration, the tempo result and any user
    override.

  The tables are created with `CREATE TABLE IF NOT EXISTS`, the same as the other own-library
  tables in `riffLibrarySchema.ts`.
- **Removed files** disappear from the browser on the next rescan. An override for a file that
  comes back is kept.
- **Main-process rules:** follow the established SQLite rules. Never `.iterate()` across an await,
  and batch writes in one transaction. Large folders must yield to the event loop in time-budgeted
  slices, not count-based ones (see `listLibraryScanTargets`). The USB/ExFAT notes in memory apply:
  `readdir` and `stat` are slow there.

### Visuals

The look and layout are the existing IMPORT browser's. The new elements are the `+ folder` and
`rescan` buttons, the unavailable state, and the guess mark. They follow `tokens.css`:
- monochrome;
- lowercase;
- buttons of at most two words;
- no new colour, the guess mark included (dimmer text and a `~` prefix, not a hue).

## Testing

- **`loopFolderTempo.ts`:** unit-tested, test-first, against real names from the Amen pack and
  synthetic cases for each step: siblings, folder name, length-only, an irregular length, and the
  tie-break.
- **The format-folder flattening and file filtering:** a pure function, unit-tested.
- **The scan and cache:** tested against a temporary directory and a temporary database, following
  the existing main-process test patterns.
- **The UI:** verified by Elling. No agent can click through it.

## Open, deliberately

- Discover and radio support: a later decision ("another ball of wax").
- Beat or onset detection for tempo: not built. The length-based guess plus correction is the
  agreed approach.
