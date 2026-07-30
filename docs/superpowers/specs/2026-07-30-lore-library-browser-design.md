# LORE Library Browser — Design

**Goal:** Let Elling browse and import riffs directly from his large local Endlesss archive — synced via OUROVEON's LORE tool to `/Volumes/Elling-Lien/ENDLESSS` — instead of manually locating and drag-dropping exported folders one at a time. This is the app's core purpose (quick arranging of Endlesss loops), not scope creep: it makes getting a riff *into* the arranger faster and easier across a much larger library than drag-and-drop alone can practically reach.

**Not in scope for this pass:**
- Writing to the warehouse (tags, favorites, notes) — read-only.
- Downloading/syncing stems that aren't already cached locally — that's LORE's own job; riffs with missing stems are shown but not importable.
- Replicating LORE's own configurable multi-mode heatmap coloring, Jam Tags browser, or Shared Riffs feed.
- Any change to the existing drag-and-drop import path (`importRifff.ts`) — this is a new, parallel import path, not a replacement.

---

## Background: the warehouse format

`/Volumes/Elling-Lien/ENDLESSS/cache/common/warehouse.db3` is a SQLite3 database LORE maintains, read-only from ssstitch's perspective. Verified directly against Elling's real data (5,056 jams, 222,911 riffs, 219,034 cataloged stems, ~34,900 of which — ~16% — are actually downloaded to the local `stem_v2/` cache; the DB catalogs far more than is currently on disk). LORE's own documentation describes this format as intentionally "easy-to-read sqlite3 ... trivially accessible or extended by other 3rd party tools" — this is a sanctioned integration point, not a reverse-engineering hack.

Relevant tables:
- **Jams**(`JamCID`, `PublicName`) — a jam has a name; individual riffs do not.
- **Riffs**(`RiffCID`, `OwnerJamCID`, `CreationTime`, `BPMrnd`, `BarLength`, `UserName`, `StemCID_1..8`, `GainsJSON`, ...) — up to 8 stem slots per riff, each an anonymous snapshot in time.
- **Stems**(`StemCID`, `OwnerJamCID`, `CreationTime`, `FileMIME`, `Instrument`, `PresetName`, `CreatorUserName`, `SampleRate`, `BPMrnd`, `BarLength`, ...).

Stem audio lives at `cache/common/stem_v2/<JamCID>/<first-hex-char-of-StemCID>/<StemCID>` (no file extension). Confirmed via `file` to be Ogg Vorbis, 48kHz stereo. JUCE's `juce_audio_formats` (pulled in transitively via `juce_audio_utils`, already linked by the native engine) includes Ogg Vorbis decoding by default with no extra config — first implementation task should empirically confirm this against a real cached file before building on it.

**The `Instrument` bitmask.** Traced directly from OUROVEON's own source (`toolkit.warehouse.cpp`), not guessed: bit 1 = drum, bit 2 = note, bit 3 = bass, bit 4 = mic, no bits set = other; if multiple bits are set, drum takes priority, then note, then bass, then mic (matching OUROVEON's own resolution order). Spot-checked against real rows (a "Pianabot" preset → note bit; a "Microphone" preset → mic bit) and it holds.

---

## Architecture

A new main-process module (`src/main/loreWarehouse.ts`) opens `warehouse.db3` read-only via `better-sqlite3` (new dependency — the only SQLite binding with a synchronous API, matching this codebase's existing IPC-handler style) with a busy-timeout, so a moment of LORE writing concurrently degrades gracefully rather than hanging. All querying and file-existence checking happens here — nothing in this module touches the native engine or the renderer's audio pipeline directly.

Four new IPC calls, mirroring the existing `engine-*`/`import-rifff` naming convention:

- **`lore-warehouse-available(): boolean`** — checked once when the browser panel opens. If the drive isn't mounted or the DB can't be opened, the panel shows "library not available — is the drive mounted?" instead of a broken/empty browser.
- **`lore-list-jams(filterText: string): LoreJam[]`** — free-text filter on `PublicName`, sorted by each jam's most recent riff timestamp (`MAX(CreationTime)` per `OwnerJamCID`, via the existing `Riff_IndexOwner2Time` index).
- **`lore-list-riffs(jamCID: string, filters): LoreRiffSummary[]`** — filters: date range, BPM, username, "only fully cached." Capped at 200 most-recent-matching per query (a "load more" button re-queries with an older cutoff, rather than true infinite pagination — even a huge jam's full riff list as one flat array is wasteful when filters are how you're expected to narrow down anyway). Uses `Riff_IndexOwner2Time`/`Riff_IndexBPM`/`Riff_IndexUser`.
- **`lore-resolve-riff(riffCID: string): LoreResolvedRiff | null`** — looks up all populated `StemCID_1..8` slots, computes each one's local sharded path, and reports which exist on disk (`fs.existsSync`, not a DB concern). Used for both preview and actual import — the single source of truth for "what does importing this riff actually get you."

On the renderer side, a new overlay panel (`src/renderer/src/components/LoreLibraryBrowser.tsx`) is opened via a new button next to the Shelf's existing "rifff library" label — same conceptual home as today's import affordance. It calls the three list/resolve IPC methods and, on import, builds a `Rifff` object directly (no `buildRifff.ts`/WAV-header involvement — the warehouse already has BPM and bar length) with stem paths pointing straight at the LORE cache (reference in place, not copied — chosen over copying so import is instant and doesn't duplicate LORE's own cache; the tradeoff, accepted, is that a `.rifffproj` referencing LORE-imported stems needs that drive mounted to reopen).

Per-stem gain (`Riffs.GainsJSON`) needs no new plumbing: `Stem`/`Rifff` don't carry volume themselves (it lives in `AppState.vol`, keyed by `stemKey`), and there's already a precedent for pairing a freshly-built `Rifff` with initial per-stem values — `PASTE_RIFFF` bundles a `rifff` alongside a `vol: Record<string, number>` map. The LORE importer dispatches the existing `ADD_TO_SHELF` action with the built `Rifff`, then one existing `SET_VOLUME` dispatch per stem whose `GainsJSON` value differs from the default (1.0) — both actions already exist today, so no reducer changes are needed for this at all. `ADD_TO_SHELF` is the same action today's drag-and-drop import already uses, so the arranger, playback engine, and export pipeline don't need to know or care where a `Rifff` came from.

---

## Data model

```ts
// src/shared/loreLibrary.ts (new, shared between main and renderer)

export interface LoreJam {
  jamCID: string
  name: string
  lastRiffTime: number // unix seconds
}

export interface LoreRiffSummary {
  riffCID: string
  creationTime: number
  bpm: number
  barLength: number
  userName: string
  stemCount: number        // populated slots, 1-8
  cachedStemCount: number  // of those, how many are on disk right now
  ownerFraction: number    // 0-1, fraction of populated slots created by "elling"
}

export interface LoreResolvedStem {
  stemCID: string
  slot: number             // 1-8
  path: string | null      // local file path, or null if not cached
  gain: number              // from the riff's GainsJSON, default 1.0
  creatorUserName: string
  presetName: string
  instrumentMask: number
}

export interface LoreResolvedRiff {
  riffCID: string
  bpm: number
  barLength: number
  stems: LoreResolvedStem[]
}
```

`ownerFraction` is precomputed in `lore-list-riffs` (needs each riff's stems' `CreatorUserName` anyway to compute it, so it's free to include in the summary rather than requiring a second round-trip per row).

The Endlesss username to match against ("elling") is a plain constant in `src/shared/loreLibrary.ts` — this is a single-user app with no existing settings/config system, and building one just for a value that will essentially never change would be its own unjustified scope creep.

---

## UI

**Browser panel.** Two-pane overlay: jam list (left, free-text filtered, sorted by recent activity) and, once a jam is selected, a **grid of small filled circles** (right) — one circle per riff, replacing what would otherwise be a plain scrollable text list. Filter controls (date range, BPM, username, "only fully cached" toggle) sit above the grid and re-query `lore-list-riffs`.

**Circle coloring** — a single brightness ramp, no separate accent hue (matches the app's existing "color spent only on things that carry information" design language):
- `ownerFraction` maps linearly from dark gray (0%, no "elling" stems) to white (100%, all "elling" stems).
- A riff where `cachedStemCount < stemCount` renders flat black instead, regardless of `ownerFraction` — it can't be previewed or imported yet, so ownership doesn't matter until it's actually usable.

Circles are plain solid fills, not real decoded waveform shapes — the round shape borrows `PolarGlyph`'s visual motif, but nothing here triggers audio decoding just to render the grid (that stays reserved for whatever's actually selected, see below).

**Selection & preview.** Clicking a circle selects it, shows its metadata (BPM, date, username, cached/total stem count) in a detail line, and immediately starts looping its available stems' mixed preview via Web Audio — reusing the exact decode-and-loop mechanism `BeatPicker.tsx` already implements, just pointed at `lore-resolve-riff`'s resolved paths instead of an already-imported rifff's stems. Since preview requires decoding the audio anyway, the selected circle can show a real `PolarGlyph` for that data essentially for free — no separate "analyze for waveform" step.

**Import.** A button on the detail line builds and dispatches the `Rifff` (see Architecture) and marks that circle as "already imported" (a small persistent indicator) so browsing many riffs from one jam doesn't lose track of what's already been grabbed. The panel stays open after import — closes via an explicit close button or Esc, matching a browsing session where you're likely pulling several riffs from the same jam.

**Inspector: per-stem author.** The `Stem` type already has an `author` field (populated today from Endlesss's own export filename convention, but never actually displayed anywhere in the UI). Adds it as a small text label beside each stem's name in the Inspector's existing per-stem row — for LORE-imported stems, populated from `CreatorUserName`; unchanged for drag-and-drop imports, which already populate `author` from the filename parse today.

---

## Error handling

- Warehouse unavailable (drive unmounted, DB unreadable): caught by `lore-warehouse-available()` before the panel ever opens; shows a clear message instead of a broken/empty browser.
- DB locked (LORE writing concurrently): opened with a busy-timeout; a query that still times out surfaces as a one-line error in the panel, not a hang.
- A referenced stem file goes missing after import (drive unmounted mid-session, or the LORE cache is later pruned): falls through the *existing* "missing buffer → skip silently" path `StemBufferCache`/`AudioEngine` already have for any stem — no new handling needed, this is exactly the scenario that resilience already covers.
- Corrupt/unreadable Ogg file: same existing per-stem try/catch pattern the current importer and playback path already use.

---

## Testing

- **Unit:** `Instrument` bitmask → `SoundType` mapping (pure function, verified against the traced bit values); `ownerFraction` computation (pure function of stems + creator names); the riff-summary/stem-resolution builders, tested against a small fixture SQLite DB (not the real 322MB warehouse) — same spirit as the existing fixture-WAV convention in the native tests.
- **Manual, end-to-end:** open the browser against the real warehouse; confirm a known riff previews and imports correctly; confirm ownership coloring reads correctly against a jam with known contribution levels; confirm a riff with missing stems renders black and is not importable; confirm the Inspector shows per-stem author for both a LORE import and an existing drag-and-drop import.
