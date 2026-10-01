# Discover: listen to another artist's stems

2026-10-01. Brainstormed with Elling.

> "since we have analyzed so many stems from endlesss and there are lots of other users on there,
> could we do the radio thing for them as well? ... maybe a way to search for a username in the
> discover section. maybe a warning that if the user doesn't own the work they need the
> permission of the artist to use it (something simple)"

## Decisions

- Picking an artist plays **only their stems**: their own radio. A `me` shortcut switches back.
- Another artist's stems are **listen only**. Keep, starring, export and adding to the timeline are
  all off.
- Find an artist with **a search box and suggestions**.
- Build it by **generalising Discover's existing "mine" filter** from "my username" to "the chosen
  artist". This reuses every pool, the ranking and radio.
- The web radio is **not** part of this spec.

## Context (2026-10-01)

- **Archive size:** `Stems` holds 781,509 stems from 5,921 users. After Elling (66,534), the
  largest are bananepoep (31,398), seasickcookie (26,828) and shapednoise (21,225).
- **Analysis coverage:** Elling's stems are 98% analysed (`StemFeatureCache`). Everyone else's are
  3.6% (25,428 of 714,975).
  - Other artists are therefore matched mostly on the Endlesss instrument mask, which every stem
    has. Trait-only slots fall back the way Discover already does.
- **Audio:** most other users' audio isn't local. sssketch's downloader fetches it on demand, which
  works anonymously, and caches it.
- **The existing filter:** Discover's `mine` modifier already filters candidates by
  `CreatorUserName === targetUser` (`src/main/discoverCandidates.ts`, `onlyOwnStems`).

## 1. Picking an artist

- **The field:** Discover's header gets an artist field next to the radio controls. It reads
  `artist: <name>` and defaults to the user's own Endlesss username.
- **Search:** clicking it opens a search box.
  - It autocompletes from the archive's usernames, each with its stem count
    (`seasickcookie · 26,828`).
  - Before typing, it lists **people you've jammed with** first: users with stems in jams where the
    user also has stems, ordered by the number of shared jams.
  - A `me` entry switches back.
- **Filtering:** every candidate pool filters on `CreatorUserName = artist`, using the same path as
  `mine`. That covers mask kinds, trait kinds, random rolls, nearby-jam rolls and the radio's
  picks. Radio, skip, the density arc and the source lean all run unchanged on top.
- **Changing artist mid-radio** acts as a course change: radio re-picks each row from the new
  artist, one row per loop top.
- **Persistence:** the chosen artist is remembered for the session. On launch, Discover opens on
  `me`.
- **Audio:** other artists' stems download on demand through the existing downloader and are cached
  once played.
  - Radio's lap-early decision hides most of the download wait.
  - A stem that can't be fetched is skipped, as today.
- **Analysis:** the picker shows `analysed: N%` for the artist.
  - An optional `analyse overnight` button queues the artist's stems for the existing overnight
    scan, with a priority tag, so trait slots fill in. Audio downloads only when the scan reaches
    each stem.

## 2. Listen-only mode

- **When:** it applies when `artist !== ownUsername`. With no own username set, every artist counts
  as other.
- **Off for other artists:**
  - keep;
  - starring (👍 still holds the row longer, but stars nothing);
  - add to timeline, the shelf, and drag-out;
  - duplicate-to-arrange;
  - any stem or bounce export started from Discover;
  - fetch radio hearts.
- **Disabled controls:** they stay visible but dimmed, with the tooltip
  `listening only: these are <user>'s stems`.
- **Still on:** play, skip, 👎, mute, solo, the per-row skip, the density arc and every radio
  control.
- **The notice:** a quiet line under the artist field, shown whenever the artist isn't the user. It
  isn't a modal.
  > listening to <user>'s stems. to use them in your own work, ask them first.
- **Already-owned stems:** a stem may already be in the user's library from a shared jam. Artist
  mode is still listen-only. To use such a stem, switch back to `me`.
- **Analysis:** `analyse overnight` only reads audio for classification, so it's allowed.

## 3. Under the hood

- **New `src/shared/discoverArtist.ts`:**
  - `artistMode(artist, ownUsername): 'own' | 'other'`;
  - `listenOnlyActions(mode)`: the one list of disabled actions the UI checks;
  - the notice text.
- **Candidates:** `discoverCandidates.ts` takes an `artist` parameter that replaces the own username
  in `onlyOwnStems`, through every pool query that already filters on the username. With
  `artist = own`, behaviour is identical to today.
- **Artist search:** a main-process query against the archive, read-only:
  `SELECT CreatorUserName, COUNT(*) ... GROUP BY CreatorUserName`.
  - It's cached in memory per session and refreshed when the archive changes.
  - "Jammed with" comes from users present in the user's jams.
  - The analysed % comes from a join with the own library's `StemFeatureCache`, cached the same way.
- **Analyse overnight:** enqueues the artist's stems in the existing overnight scan with a priority
  tag. Check the queue size for an artist with 30k stems before building.
- **Enforcement:** besides the dimmed UI, the main-process IPC handlers for keep, star and export
  refuse a stem whose creator isn't the user while artist mode is `other`. A stray path or shortcut
  can't bypass it.

## Testing

- Unit tests for `artistMode` and `listenOnlyActions`.
- Candidate queries filtered by artist.
- The IPC guards refuse other artists' stems.
- Artist search, counts, the jammed-with order and the analysed %, against a fixture DB.
- `me` mode unchanged: every existing test stays green.
- No agent can hear or see the app. Elling's walkthrough is the check.

## Out of scope

- The web radio for other artists. It needs their audio on Spaces, an index of about 780k stems,
  and a stronger permission story for a public site.
- Mixing several artists, or "them + me" blends.
- Any keep or export of other artists' work.
