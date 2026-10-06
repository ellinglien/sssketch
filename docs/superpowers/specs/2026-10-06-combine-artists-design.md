# Combine artists in Discover and radio

2026-10-06. Elling, 2026-10-05: "after this i'd like to have it possible to COMBINE users in radio
and discovery.. so multiple select".

**Decided with Elling:** picks are shared **evenly** across the chosen artists, so each gets roughly
equal turns. It is not one pooled list, where an artist with 30,000 stems would drown out one with
300.

Builds on Discover artist mode (`specs/2026-10-01-discover-artist-mode-design.md`, as amended
2026-10-02, when the listen-only restrictions were lifted). The plan is
`plans/2026-10-06-combine-artists.md`.

## Decisions taken without Elling (revisit)

He was asleep, so these are defaults. Each can be changed independently.

1. **`me` can be combined.** "me + bananepoep" is allowed.
   - In a combination, `me` means **the stems you made** (`CreatorUserName` = your username): the
     `my sounds` path, whatever the toggle says.
   - Alone, `me` stays today's `me`: your whole library, collaborators included, with `my sounds`
     deciding.
   - Why: the share is about people. An unfiltered `me` would hand collaborators' stems, which may
     include the other chosen artists, out as "me" turns.
   - With no own username, `me` can't be combined (its `+` is greyed).
2. **At most 6 artists**, `me` included. The per-db stem cache holds 8 artists, so a whole
   selection stays cached.
3. **Session-only, as today.** Discover opens on `me` at launch.
   - The single artist was never persisted (`App.tsx`, `discoverArtist` state), so there is no
     saved value to migrate.
   - The IPC and the main-process mirror still accept the old single value (`string | null`), so
     an older caller is read exactly as before.
4. **The picker keeps today's gesture for one artist.** A click or Enter on a name means "only
   this artist" and closes the picker, exactly as now.
   - Combining is additive: a `+` button on every row, Shift+click, or Shift+Enter adds or removes
     that artist and keeps the picker open.
   - `+` adds to whatever is shown. From the default `me`, `+ bananepoep` gives "me + bananepoep".
     To get "bananepoep + seasickcookie", click bananepoep, then `+ seasickcookie`.
5. **A turn is a fresh pick landing on a row.**
   - Hook returns and arc rests coming back are not turns.
   - A duplicate is a turn, because that artist now holds another row.
   - Undo and redo are not turns.
6. **The debt cap is 2 turns.** An artist that couldn't use its turns (no bass, say, on a radio of
   bass rows) is owed at most 2. When rows it fits come back, it gets at most 3 picks in a row,
   not a burst.
7. **Ties break randomly**, never in plain rotation, so a roll-all doesn't always lay out A, B, A,
   B down the rows.
8. **Adding an artist mid-radio turns nothing over.** The share brings the new artist in at radio's
   next pick, starting level with the least-served artist.
   - Removing an artist turns its rows over, one per loop top, like today's artist change.
   - Switching from one single artist to another single artist is exactly today.
9. **Dig's near draw spans the whole combination.** Dig's neighbours come from any chosen artist;
   the ledger charges whoever lands, and the share corrects itself within the debt cap. Otherwise
   dig would almost never find neighbours on another artist's turn.
10. **The faves dial acts on `me`'s turns** in a combination with `me`, and isn't dimmed there.
    Without `me` it is dimmed, as in artist mode today.
11. **The phone gets nothing new.**
    - Its reroll, random and adjacent verbs run through the Mac's pick, so the share applies to
      them.
    - No usernames go over the wire: today's boundary is "a boolean names no user".
    - Showing whose stem on the phone would widen that boundary. That's for Elling to decide.
12. **In simple view the artist control stays in advanced only.**
    - It is in the picks column, which simple hides, and in the header while radio is off.
    - Simple's row plates already name each row's artist (`bass · warm — bananepoep`).
    - Moving `artist` onto simple's live bar is the obvious revisit.
13. **A skipped turn is never silent.**
    - While radio runs, the row flashes `no <name> fits` (like `no fave fits`).
    - The console logs `[artist-share]` either way.
14. **"Analyse overnight" queues every chosen artist** except `me`, one after another.

## Context: what exists (read 2026-10-06, master at dc6450dd)

- **Selection:** `App.tsx` holds `discoverArtist: string | null` (null is `me`). It is session-only
  and passed through `LibraryBrowser` to `DiscoverPanel` (`artist`, `onArtistChange`).
- **Picker:** `DiscoverArtistPicker.tsx` is a single-select combobox popover.
  - It suggests from `suggestArtists`, polls `discoverArtistIndex`, and shows the analysed share and
    `analyse overnight`.
  - It opens from the header's artist button (radio off) or the strip's `artist` button in the
    picks column (radio on).
- **Every pick funnels through two functions:** `pickForSlot` (ranked; radio, similar, roll-all,
  add, the phone, sized builds' spares) and `rollRandomForSlot` (random).
  - Both read **one** filter, `rollFilter()` = `rollFilterForArtist(artistRef.current, …)`, and tag
    results with `tagPickedUnderArtist`.
  - Main's `get-discover-candidates` turns `artist` into `artistStemCIDs` through
    `getArtistStemCIDs`. That is a `Stems_IndexUser` page walk per artist per db, LRU-cached (8) and
    invalidated by the Stems signal. The set gates every pool **before** its bounded sample.
- **Neighbour lookups** (the nearby popover, one-tap adjacent, dig's near draw) pass one `creator`
  string to `get-adjacent-discover-candidates`, which uses `creatorAllowed`.
- **Course change:** `changeArtist` sets `artistTurnoverRef` from `artistTurnoverIds` and calls
  `skipRadio`.
  - `commitSlotPick` (the one place a layer's stem is replaced) clears a row from the turnover once
    `pickMatchesSelection`.
- **Main's mirror:** `discoverArtistSession.ts`, pushed by `discover-set-artist`, decides the mode
  for the (now empty) listen-only refusals and the phone's `listenOnly`.
- **Labels:** radio's row plates already end in `— <creator>` (`radioRowLabel`). Discover rows with
  radio off show the creator nowhere; the waveform's tooltip is the date.
- **Phone:** `remoteState.ts` carries no usernames by design.
- **Web radio** (`ell.ing/radio`) has **no artist mode**: its index is Elling's own stems only
  (`pick.ts`, `INDEX_CREATOR = 'elling'`). **The web is out of scope.** The artist-mode spec already
  ruled out other artists on the public site, for audio-hosting and permission reasons.

## 1. Picking several artists

The picker stays one popover, in today's shape and position. It is monochrome chrome: lowercase,
sharp corners, `--ra-*` tokens, no colour. It changes in four ways.

- **Chips.** While two or more artists are chosen, a row of chips sits above the search field, in
  selection order.
  - Each chip reads `name ×`. `me` reads as your username, or `me` without one.
  - Each is a 1px-bordered button: clicking it, or Enter/Space on it, removes that artist.
  - With one artist there is no chip row, and the picker looks as it does today.
- **A `+` on every suggestion.** Each option row is the name button, then an 18px square button
  with a 1px border on the right.
  - It reads `+` for an artist not chosen, `−` for one already in.
  - Its aria-label is `add <name>` or `remove <name>`.
  - At the cap, or for `me` without a username, it is greyed (`--ra-text-4`), with the tooltip
    `six at most` or `set your endlesss username to combine me`.
  - A chosen artist's name reads `--ra-text`; the others read `--ra-text-2`, as today.
- **Keyboard.** The search field keeps focus; ArrowUp and ArrowDown move the highlight, as today.
  - **Enter:** only the highlighted artist. Closes, returns focus to the field button. Today's
    pick.
  - **Shift+Enter:** add or remove the highlighted artist. Stays open, clears the query, keeps the
    highlight.
  - **Backspace** on an empty query while combined: removes the last chip.
  - **Escape:** closes, as today (capture phase, propagation stopped).
  - The mouse twins: click is only, Shift+click is add/remove, `+`/`−` is add/remove.
- **ARIA.** The listbox gains `aria-multiselectable="true"`.
  - An option's `aria-selected` now means "chosen", where today it means "highlighted".
  - The highlight stays on `aria-activedescendant` and the background.
- **Footer:**
  - **One artist:** today's `analysed: N%` and `analyse overnight`, unchanged.
  - **Combined:**
    - `analysed:` lists each named artist (`analysed: bananepoep 3% · tpj <1%`);
    - `analyse overnight` queues them all;
    - a `turns:` line shows the share this session (`turns: bananepoep 6 · elling 5 · tpj 6`), so
      the evenness is visible and checkable.
- **The field label** (the header button with radio off, the strip's `artist` button with radio on):
  - one artist: today's `artist: name`;
  - two: `artist: a + b`;
  - three or more: `artist: a + 2 more`.
  - The tooltip names everyone: `picks shared evenly: a, b, c`.
- **The notice line** under the field:
  - one other artist: today's sentence, word for word;
  - combined: it names the others, never `me` ("listening to a's and b's stems. to use them in
    your own work, ask them first.").

## 2. What a selection is

- `ArtistSelection = readonly (string | null)[]`. `null` is `me`. It is never empty (`[null]` is
  `me`), has no duplicates and is ordered as added.
- **`normalizeArtistSelection(value, own)`** is the only constructor, and the one place every rule
  lives:
  - it reads the legacy single value and arrays alike;
  - it trims names;
  - a blank or the own username becomes `me`;
  - it drops repeats (keeping the first) and junk;
  - it caps at 6;
  - empty becomes `me`;
  - with no own username, it drops `me` from any combination.
- **Mode:** `own` only for `[me]`. Any combination is `other`. Blocks are empty since 2026-10-02,
  so mode now only decides notices, dimming and the phone's `listenOnly`, all as today.
- **Lingering** (other artists' stems still playing in `me`) is computed only for `[me]`, as
  today.

## 3. The even share

Pure, in `src/shared/artistShare.ts`, with a seeded `random`. The selection's derived values are in
`src/shared/artistSelection.ts`.

- **Ledger:** turns `landed` per member and picks `inFlight` per member, for current members only.
  It is session-only and lives in a ref in `DiscoverPanel`.
- **Order of asking:** a pick asks members by `landed + inFlight`, lowest first. Ties are shuffled
  by `random`, which is drawn **only** where there is a tie.
  - Counting in-flight picks spreads a roll-all at once: four rows, two artists → two each.
- **Plan of a pick:** `artistPickAttempts(selection, ledger, random, own, onlyOwnStems, skip)` gives
  the members in that order, each with the filter its turn sends main (`rollFilterForMember`).
  - A named member's filter is today's artist-mode filter.
  - `me`'s is the own-stems filter (decision 1).
- **Each turn is today's single-artist roll.** It uses the same IPC and the same main path, so
  per-row kinds, the source dial, the trait bar, the ranking and the dedupe all apply within that
  artist's stems.
- **Passing the turn on.** When the asked member's pool, after the source dial's own fallback, has
  nothing new for the row:
  - the next member is asked;
  - the row flashes `no <name> fits` while radio runs, and the console logs it;
  - a member whose pool was **empty** (no candidate at all, not merely all in use) is remembered as
    empty for that row's kinds for 5 minutes and skipped meanwhile.
  - The memo is never allowed to leave a row unpicked: if everyone is in it, everyone is asked.
  - If every member has nothing new, the first non-empty pool is used whole (duplicates beat
    nothing, as today). If all are empty, it is today's "no match".
- **Landing.** `landArtistTurn` counts the member the stem was picked under (`memberOfPick`: the
  tag, or `me` for an untagged pick when `me` is a member).
  - It runs in `commitSlotPick` (skipping hook and arc landings) and in the two direct slot writes
    (one-tap adjacent and random with radio off).
  - After each landing, every member is raised to within **2** of the leader: the debt cap.
- **Selection changes** (`reconcileArtistShare`): kept members keep their counts; a joining member
  starts level with the least-served kept one; members gone are dropped; a disjoint selection
  starts from zero.
- **Bookkeeping:** `beginArtistTurn` runs before a pick's first await, `endArtistTurn` in its
  `finally`. Moving to the next member ends one and begins the next. A path that returns early still
  ends its turn, because both sit in the same try/finally.

Measured on the pure model (seeded, `artistShare.test.ts`):
- three artists who all fit: exactly 100/100/100 over 300 picks, never more than one apart;
- 30,000 stems against 300: 100/100;
- an artist with no bass, on bass rows: the other two share 150/150; when drums come back, its
  longest run is ≤ 3.

## 4. Radio

- **Course change.**
  - **One member to one member:** today's `changeArtist` exactly (`artistTurnoverIds`, then
    `skipRadio`).
  - **Combined:**
    - the turnover is every row by nobody chosen (`selectionTurnoverIds`; `me` as the own
      username);
    - `skipRadio` runs only when that set is non-empty, so adding an artist doesn't skip a row.
  - A row turns over once a pick under the current selection lands (`pickMatchesArtistSelection`).
- **What applies within each turn:**
  - the source dial, the matching dial, fold's clash, the intensity arc's lean and band, and sized
    builds: all unchanged;
  - the faves draw, only on `me`'s turns (decision 10).
- **Sized builds' spares** fit while the selection and `my sounds` are unchanged
  (`artistSelectionKey`), not while one member's filter is.
  - A spare is a pick, so it begins and ends a turn. Its landing counts only if it lands.
- **Dig:**
  - **One member:** today's near draw.
  - **Combined:** the creator filter is the whole selection, results are tagged by creator
    (`tagByCreator`), and the ledger charges whoever lands (decision 9).
- **Hooks:** holding, bringing back and away substitutes are unchanged. A hook's return isn't a
  turn; a substitute pick is.
- **Plates** already read `kind · trait — creator`, so each row says whose stem it is. Nothing new
  is drawn.
- **Strip:**
  - the `artist` button shows the selection label, with the full list as its tooltip;
  - `faves` is dimmed only when `me` isn't a member (`RadioStripContext.artistsIncludeMe`);
  - `my sounds` is greyed in any combination: `me` there is already your own stems.

## 5. Discover with radio off

- **similar, roll-all, add:** through `pickForSlot`, so they share like radio.
- **random:** the same order, falling back to the next member on no candidate.
- **One-tap adjacent and the nearby popover:** creator list = the whole selection; candidates are
  tagged by creator.
- **Rows:** when combined, a row's waveform tooltip adds `by <creator>` after the date. With one
  artist, the tooltip is today's.
- **Keep, star, shelf, timeline and export:** as today (blocks are empty).

## 6. Main process and IPC

- **`get-discover-candidates`: unchanged.** Each turn is one call for one member, exactly today's
  call. There is no new SQL and no union pool, so no artist's sample can be swamped by another's.
- **`get-adjacent-discover-candidates`:** `creator` may be `string | string[]`. `creatorAllowed`
  accepts a list; a string behaves as today.
- **`discover-set-artist`** gains an optional 4th argument, `artists` (the whole selection). The
  mirror stores it (`getDiscoverArtistSelection`), and the mode comes from it. Without it, today's
  push is read as before.
- **New `discover-prewarm-artists(names)`:** on a selection change, main walks each new named
  member's stem rows **one artist after another**, through the existing cached `getArtistStemCIDs`.
  The first turn of a newly added artist is then not a cold 1.6 s index read on the USB archive.
  - Failures are logged and ignored.
  - It's a warm-up only: a pick still works without it.
- **Caches:** `MAX_CACHED_ARTISTS` (8) is exported, and a test pins `>= MAX_COMBINED_ARTISTS` (6).

## 7. Phone remote

Nothing changes on the wire (decision 11). The phone's verbs land on the Mac's rolls:
- `similar` → `rerollSlot`;
- `random` → `rollRandomForSlot`;
- `adjacent` → `pickAdjacentCandidate`.

So they share evenly. `listenOnly` keeps its meaning.

## 8. Web radio

**Out of scope.** `ell.ing/radio` has no artist mode at all: one creator, Elling's own index. The
artist-mode spec's reasons hold: other artists' audio would need hosting on Spaces, an index of
about 780k stems, and a stronger permission story for a public site.

## 9. One artist is today, byte for byte

Every derived function hands a one-member selection to the `@shared/discoverArtist` function it
replaces and returns that answer untouched. This covers:
- `selectionMode`, `artistSelectionLabel`, `artistSelectionNotice`, `rollFilterForMember`,
  `selectionCreatorFilter`, `selectionTurnoverIds` and `pickMatchesArtistSelection`;
- the tooltip.

`artistPickAttempts` for one member is a single attempt with `rollFilterForArtist`'s filter, and
**draws nothing from `random`**. The pick's other draws (the source dial, faves, `pickReroll`)
therefore consume `Math.random` exactly as today.

The panel takes one code path for both cases, so there is no "single" branch that could drift.
`artistSelection.test.ts` pins every function over a grid of 7 picks × 3 own usernames. The share's
single-member test pins zero random draws.

## 10. Performance

- **Per pick:** one `get-discover-candidates` call, as today. A pass-on costs one more call per
  member asked (at most 6, times the source dial's two), bounded by the empty memo.
- **Per artist:** one `Stems_IndexUser` page walk per db, cached. `getArtistStemCIDs` already
  dedupes the dbs (the memory `sssketch-jams-share-one-db`: one connection holds most jams), so
  nothing loops per jam.
- **Never per artist:**
  - no full `Stems` walk;
  - no `.iterate()` across an await (the existing walk uses `.all()` pages with
    `setImmediate` yields: the memory `sqlite-never-iterate-across-await`).
- **Memory:** about 4.6 MB per 31k-stem artist; at most 8 cached per db (about 37 MB worst case),
  as today.
- **Radio:** its lap-early decision hides a cold read, and the prewarm removes most of them.

## 11. Tests

- **`src/shared/artistSelection.test.ts`:**
  - the one-member equivalence grid;
  - normalize (legacy values, own name, repeats, cap, no username);
  - labels, notice, filters, creator list, tags, `memberOfPick`, turnover, keys;
  - the picker gestures; the skip word.
- **`src/shared/artistShare.test.ts` (seeded):**
  - one member: no random draws;
  - exact evenness; size doesn't matter;
  - tie randomness, reproducible per seed;
  - in-flight spreading;
  - pass-on; the debt cap (longest run ≤ 3); a row nobody fits;
  - the empty memo and its expiry; never skip everyone;
  - reconcile.
- **`src/shared/discoverArtist.test.ts`:** `creatorAllowed` with a list.
- **`src/main/discoverArtistSession.test.ts`:** a combined push, a legacy push, reset.
- **`src/shared/radioStripModel.test.ts`:** faves live with `me` combined; `my sounds` greyed.
- **`src/main/discoverArtistStems.test.ts`** (local only, on the CI exclude list): the cache size
  pin.
- **Renderer:** by convention there are no component tests. typecheck and lint, plus Elling's
  walkthrough. No agent can hear or see the app.

## 12. Risks

- **`DiscoverPanel.tsx` is about 13,600 lines** with several agents in it. Edits must anchor on
  function names (`pickForSlot`, `rollRandomForSlot`, `commitSlotPick`, `changeArtist`,
  `radioSpareFits`), never on line numbers.
  - The React Compiler has rejected the whole component over a helper call before (`keepGroup`'s
    note). Inline where the existing code inlines.
- **Matching quality.** A forced turn picks the best of that artist's stems, which may be a worse
  match than another artist's. This is inherent to "even" (Elling's choice). `matching` still acts
  within each turn.
- **Low analysis coverage.** Other artists are about 3.6% analysed, so trait-only rows often have
  nothing for them, which means frequent `no <name> fits` flashes and pass-ons.
  - The memo bounds the cost; `analyse overnight` is the cure.
  - If the flashes feel noisy, flash only the first pass-on per row per minute.
- **USB latency.** A pass-on chain on cold artists is several index reads. The prewarm and memo
  mitigate it; watch `[artist-share]` and `sql:discover.artist-stems-page`.
- **`me` means two things:** your library alone, your stems in a combination (decision 1). Going
  from `me` to `me + a` turns over rows holding collaborators' stems.
- **In-flight leaks** would bias the share. Begin and end must sit in the same try/finally, and
  pass-on must end before it begins.
- **The cache can churn:** flipping through many artists evicts selected ones (LRU 8). A selection
  of 6 still fits.

## 13. Sequencing and file overlaps

This builds **after** the radio simple/advanced view (`specs/2026-10-05-radio-simple-view-design.md`)
and the move visuals (`specs/2026-10-05-radio-move-visuals-design.md`). Shared files:

| file | simple view | move visuals | here |
|---|---|---|---|
| `DiscoverPanel.tsx` | strip/row props | row style | state, picks, landings, picker, notices |
| `RadioStrip.tsx` | visibility prop | — | artist tooltip prop |
| `radioStripModel.ts` | view helper | — | `artistsIncludeMe` |
| `DiscoverSlotRow.tsx` | visibility | waveform cell style | tooltip `by`, creator type |
| `DiscoverArtistPicker.tsx` | — | — | multi-select |

The shared modules (Tasks 1-2) and main (Tasks 3-4) can land any time. They are inert until the
panel uses them.

## Walkthrough for Elling

1. **Radio off, one artist:**
   - pick one artist as today (click). Nothing new shows.
   - Roll a few rows: the same as yesterday.
2. **Combine two:** click bananepoep, then `+ seasickcookie`.
   - The field reads `artist: bananepoep + seasickcookie`.
   - Roll all on 4 rows: two of each. Hover a waveform: `by …`.
3. **Radio, combined:**
   - over 10 minutes, the picker's `turns:` line stays within a couple;
   - the plates' `— name` alternate;
   - a `no <name> fits` flash shows when one has no stem for a row, and the row still changes.
4. **Changing the selection mid-radio:**
   - add a third artist: nothing jumps, and they appear within the next few changes;
   - remove one: their rows turn over, one per loop top.
5. **`me` + an artist:**
   - your stems and theirs alternate;
   - the faves dial is live;
   - `my sounds` is greyed.
6. **Phone:** reroll a row a few times. The rows still alternate between artists.

## As built (2026-10-06)

Plan `docs/superpowers/plans/2026-10-06-combine-artists.md`, on **master** (not the plan's
`combine-artists` branch: other agents share this working tree, and switching branches under them
would move their files), unpushed:

- `da4cf0a4` Task 1, `@shared/artistSelection` (the scratch copy's file, verbatim; 38 tests, the
  7 × 3 one-member grid among them).
- `9c2911ed` Task 2, `@shared/artistShare` (verbatim; 14 seeded tests, no re-pinned seeds).
- `fc1e63f1` Task 3, main's mirror holds the selection; `creatorAllowed` takes a list; the
  `discover-set-artist` 4th argument.
- `67a1c3e8` Task 4, the adjacency creator list, `discover-prewarm-artists`, the cache-size pin.
- `7c2214c3` Task 5, `artistsIncludeMe` in the strip model.
- `1676e16e` Task 6, the panel holds a selection; labels, notices, `changeArtists`, the mirror.
- `bba70921` Task 7, the share in every pick; landings; spares by `artistSelectionKey`.
- `e2de6bf9` Task 8, neighbour lookups span the selection.
- `18663ed4` Task 9, the multi-select picker.
- `2ad862e8` Task 10, `by <creator>` in a combined row's tooltip.
- `e49d2a10` review fixes (below).

**Deviations from the plan:**
- **Branch:** master, as above.
- **The one-tap adjacent write moved:** `rollAdjacentForSlot` now lands through
  `swapSlotFromNearby`, so the radio-off landing is counted there. The nearby popover lands
  through it too, so its picks count as turns.
- **Duplicates count:** `duplicateSlot`'s instant copy (radio off, or Cmd on a row with a stem)
  calls `noteArtistLanding`, per decision 5. The plan listed only `commitSlotPick` and two direct
  writes.
- **A hook exit's substitute counts:** it lands with `hookLanding`, so the plan's rule missed it.
  §4 says a substitute pick is a turn. The hook's return, a resting exit and the arc's landings
  (rest and return, renewals included) are not turns.
- **The `turns:` line reads state:** `artistTurnsShown` mirrors the ledger's `landed` at each
  landing or change. The plan's `artistShareTick` + ref read would read a ref during render, which
  react-hooks rejects.
- **`fetchPool(only, ff = f)` with `f` a const:** the pass-on passes
  `attempts[attempt].filter` explicitly, rather than reassigning a `let f` that closures capture.
- **Prewarm only for a combination:** me → X or X → Y makes no extra IPC call, so §9 holds
  literally.

**Review (code-reviewer agent).** §9 holds on every pick path. Begin/end pair on every return
path, and no landing is counted twice. One important finding, fixed in `e49d2a10`:
- **While radio runs, a roll-all didn't spread.** `rerollAllOnTheTop` picks one after another and
  queues everything for the loop top. Each pick's in-flight count had ended before the next pick
  began, and nothing had landed yet, so an artist one turn behind got all four rows.
- **The fix:** the share's order now takes `pending`, which counts picks waiting to land: queued
  manual changes, minus hook and arc landings, plus the batch not yet queued. It's empty for one
  artist. A seeded test covers pick → queue → land at the top.

Minor findings fixed in the same commit:
- `random`'s pass-on now flashes `no <name> fits`;
- the empty memo is keyed by kinds plus the sources the dial allows;
- the picker's `+`/`−` and chips keep focus in the search field;
- an empty creator list allows nobody in main.

**Left as is:**
- **The ledger lives in `DiscoverPanel`,** as §3 says. It starts over when the library modal is
  reopened, while the selection, held in `App.tsx`, stays. Move it to `App.tsx` if `turns:`
  should last the whole app session.
- **Spares and radio's own armed pick are not in `pending`.** Each lands before the next pick of
  its kind is made.

**Checks:**
- **typecheck:** clean.
- **lint:** no errors. The only warnings are prettier warnings in another agent's uncommitted
  `radioIntensityArc.test.ts`.
- **`npx vitest run`:** 320 files, 5356 tests, all green.
- **`CI=1 npx vitest run`:** green apart from one run of `remoteStemRenderer.test.ts`, which
  passed 3/3 on rerun and in the full run, and touches nothing here.

**Unseen by any agent:** nothing here has been clicked, looked at or heard. The walkthrough above
is Elling's.
