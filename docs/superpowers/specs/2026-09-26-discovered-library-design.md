# The discovered library, and the phone in the other room

Date: 2026-09-26 (drafted overnight 2026-09-25/26)
Status: decided in chat with Elling, then grounded against the real code; awaiting his walkthrough

Two connected pieces. **Part 1 ships first and stands alone** — it is useful with no phone
anywhere near it. Part 2 is a second way to drive the same thing from the sofa, and it is worth
nothing until part 1 exists.

Elling's governing instruction for both, verbatim: *"keep it simple to start bit functional...
minimum lovable product."* Every section below has a **not now** counterpart at the end. If
something is not named as in, it is out.

---

# Part 1 — the discovered library

## What he asked for

> "keep building rifffs / collections of stems like we have now, exactly like this process.. and
> have it just able to save these groups of stems to a 'discovered' library, which is a
> collection of stems that sound good together"

> "a rifff is a saved group, stored in a new directory called discovered (like the other jam
> rooms in import maybe?)"

Three decisions came out of that conversation and are not re-opened here:

1. **A saved group IS a rifff.** Not a "recipe", not a new entity. The arranger, auto-arrange,
   the arrangement map and every export already understand a rifff, and he wants to drop these
   onto a timeline.
2. **It lives in a `discovered` room**, alongside his jams in Browse's own left sidebar.
3. **Stems are COPIED, not referenced.** He chose this knowing the cost. The reason is specific
   to this feature: Discover is the only thing in the app that deliberately mixes stems across
   jams, so a group whose source jam is later removed from sync — or whose stems live in an
   external, read-only LORE archive he might repoint — would otherwise rot. Endlesss stems are
   seconds long.

## Does `discovered` fit the existing library model? Yes, with three one-line branches

Plainly: **it is a real room, not a shim.** A room in this codebase is a `Jams` row
(`JamCID`, `PublicName`, `SyncComplete` — `riffLibrarySchema.ts`), and everything in Browse is
already driven off that. The whole read path works untouched: `listJams` fills the sidebar,
`listRiffs` lists the rifffs, `resolveRiff`/`buildResolvedRiff` resolves one for preview, and
`buildImportedRifff` (`audio/importResolvedRiff.ts`) imports it to the shelf.

What it costs is three branches, all in `riffLibraryStore.ts`, all mirroring what the Shared
Feed's `shared:` prefix already does:

- **`dbForJam`** — the discovered room always lives in sssketch's own writable db
  (`openOwnRiffLibraryDb`), never in an external archive, exactly like `shared:`.
- **`listJams`** — its own-db row must be merged in when the configured browse root is an
  external archive, exactly like `shared:`. (Elling browses a real external LORE archive with
  372k riffs; without this the room is invisible on his own machine, which is the only machine
  that matters tonight.)
- **`resolveStemPath`** — a new FIRST branch, before the existing own-root check:

  ```
  <ownRiffLibraryRoot()>/cache/common/stem_v2/discovered/<first-hex-char>/<StemCID>
  ```

  That is literally the layout the existing else-branch already builds for a real jam room —
  "like the other jam rooms," which is what he asked for — just always under the own root
  regardless of where browsing currently points.

One shared constant, `DISCOVERED_JAM_CID = 'discovered'`, in a new `src/shared/discoveredRoom.ts`
so the renderer can name the room too (it needs to, see "how it appears in browse").

### The copies keep their StemCID, and that is the whole trick

`stemCIDForPath` (`stemCategoriesStore.ts`) is blunt about the convention: **`basename(path)` of
a real library stem IS its StemCID.** Copying to `.../discovered/<shard>/<StemCID>` — same
basename, no extension, same as everywhere else — means every cache keyed on StemCID keeps
hitting at the new path, for free:

`StemCategories` (a role he confirmed by hand in Tidy Up), `StemFeatureCache`, `StemPeaksCache`
(instant waveform, no re-decode), `StemEmbeddingCache`, `StemAutoCategory`, `StemFavourite`.

So a saved group opens instantly, already classified, already starred where it was starred. Any
other naming scheme — `<groupname>/1-kick.wav`, say — throws all of that away and forces a
re-analysis of material the app has already analysed. That is the argument that settled the
layout, over Finder-browsability, which he did not ask for.

**Considered and rejected:** a human-browsable `discovered/<name>/<slot>-<stem>.wav` folder. It
reads better in Finder and it is dead on arrival everywhere else — `resolveStemPath` cannot
compute it from `(jamCID, stemCID)` alone, and every cache above misses. If he ever wants the
wavs, the app already exports stems.

## Saving: one action, called `keep`

One button in Discover's own toolbar, beside `add to shelf` and `add to timeline`
(`DiscoverPanel.tsx`, the row at the top of the panel). Label: **`keep`**, and `✓ kept` for
500ms after, matching `justAddedToShelf`'s existing pulse exactly. Tooltip, per the house rule
that every tooltip is two or three words: **`keep this group`**.

`keep` is not `add to shelf`. Shelf is "I am using this now"; keep is "I found this, do not lose
it." Both can be true, and both buttons stay.

It reuses `resolveDiscoverRifff()` verbatim — the same helper `addToTimeline` and `addToShelf`
already share. That matters for one non-obvious inherited behaviour worth keeping: a slot muted
in Discover's preview mix is placed at **gain 0, not dropped**. So a muted stem is saved as
silence, still there, still un-muteable later. That is what mute means everywhere else in this
app and it should mean the same here.

### What main actually receives

`resolveDiscoverRifff()` returns a `DiscoverRifffAssembly` of `ResolvedCandidateStem`s, which
carry `path` but have already thrown away `stemCID`/`riffCID`. That is fine and we do not change
it: **main recovers identity from the path itself** via `stemCIDForPath`, the same function every
cache read already uses. So the IPC is:

```
save-discovered-rifff(members: { path, gain, name, author, barLength, durationSec }[], bpm, barLength)
  -> { riffCID, name, duplicate: boolean } | null
```

Eight `stemCIDForPath` calls per save is eight point lookups on an explicit, human-initiated
action — not a batch path, and not what CLAUDE.md's "never one query per stem" rule is about.
Everything inside the save that IS per-stem (the writes) goes through one transaction.

A member whose path resolves to **no** StemCID — a shelf-seeded slot, a wav dropped on the panel,
an in-app recording — gets a freshly minted `discovered-<uuid>` StemCID and a real `Stems` row of
its own. Save is therefore total: it never refuses, never silently drops a slot. The cost is that
such a stem loses its old analysis (new id, cold caches) and re-saving the same dropped wav makes
a second copy. Accepted; those slots are rare in the sofa loop.

### The writer already exists

`writeRiffDetail(db, jamCID, meta, resolved)` (`riffLibraryWriter.ts`) writes exactly this shape
— Riffs row, `GainsJSON`, `Stems` skeletons with `ON CONFLICT DO NOTHING`, all in one
transaction. Use it. Pair it with `upsertJam(db, 'discovered', 'discovered')`, called lazily on
the first save so there is no empty room to explain before he has kept anything.

**One real hazard, found while reading it:** `writeRiffDetail`'s `updateStemDetail` unconditionally
overwrites `FileEndpoint`/`FileBucket`/`FileKey`, and `buildResolvedRiff` does not populate those
on the object it returns (it reads them, uses them for `downloadUrl`, and drops them — see
`RiffLibraryResolvedStem`'s own doc comment, which says a warehouse writer needs them kept
separately). Saving as-is would **null out the download columns of a real synced stem's row**.
Fix by carrying the three fields through `buildResolvedRiff`, which is the contract that comment
already describes. Do this first; it is three lines and it is load-bearing.

### What a saved group carries

| | |
|---|---|
| bpm | yes — Discover's own project bpm, `BPMrnd` |
| bar length | yes — the assembly's longest member, `BarLength`, so the existing tiling machinery loops the short stems for free |
| gains | yes — `GainsJSON`, per slot. `importResolvedRiff` already re-applies them with `SET_VOLUME` on import, so the balance he set with the waveform drag survives the round trip to the shelf |
| creation time | the moment he kept it, not the source riffs' — Browse groups by day, and "today" is the true answer for a thing discovered today |
| key (Root/Scale) | **null**, deliberately. A collage of stems from different jams has no honest key. The Inspector already handles an absent key |
| UserName | `'discovered'` |
| the slot kinds | **no** — see below |

**Slot kinds are not stored, and this is a decision, not an omission.** `drummy`/`chonky`/
`sparkly` are Discover's matching vocabulary — a filter and a ranking used to FIND a stem, not a
property the stem then has. The stems themselves already carry their real identity (the Endlesss
instrument mask, plus any role confirmed in Tidy Up), and that identity is what every consumer
downstream actually reads. Storing the kinds would be a second source of truth that starts
drifting the first time he reclassifies a stem from the match meter.

### Duplicate saves

**Identity is the set of StemCIDs, unordered, ignoring gain.** The same five stems balanced
differently are the same discovery.

A duplicate save is **a no-op that says so**: the button reads `already kept` for 500ms and
nothing is written. Not a second row, and not a silent bump of the original's timestamp — he
should be able to trust that keeping twice does not litter the room, and he should be told, not
left guessing whether it worked.

The check is one query, no per-stem lookup:
`SELECT RiffCID, StemCID_1..8 FROM Riffs WHERE OwnerJamCID = 'discovered'`, compared as sets in
JS. At a realistic few hundred saved groups this is free.

### The invalidation trap, which must be handled

Discover's own candidate index is cached in `DiscoverRiffIndexCache` / `DiscoverInstrumentRowsCache`
and its freshness check is **a row count per source db** (`getCachedRiffCount` vs a live
`COUNT(*)`, `discoverCandidates.ts`). Every save adds a Riffs row to the own db, which changes
that count, which invalidates the index, which means **the next roll pays a full rebuild.**

In the sofa loop — roll, keep, roll again — that is the difference between a game and a
progress bar. So the save must, inside the same transaction, **append its own rows to both
caches and bump the stored counts**: two new functions in `src/main/discoverIndexCache.ts`
(`appendRiffIndexRows`, `appendInstrumentRows`), ~8 inserts each. `DiscoverInstrumentRowsCache`
needs it too, because a stem from an external archive gets a genuinely new `Stems` row in the own
db and moves that count as well.

This is required, not an optimisation. If the append turns out fiddly in practice, measure the
rebuild on his real library before accepting it as a fallback — do not assume it is cheap.

The external archive's own index is keyed by a different `SourceDbKey` and is not touched. Good.

### How it appears in browse

**No new browse UI.** This is the happy consequence of it being a real room:

- A sidebar row labelled `discovered`, **pinned to the top** of `sidebarJams` — it is the room
  he will open most, and it has no `lastRiffTime` story worth sorting on.
- Its rifffs render as the usual `RiffCircle` grid, grouped by day then by tempo, with the
  existing hover title (`120 BPM · 4 stems (4 cached)`).
- Click previews it. `import` puts it on the shelf, named by `friendlyRiffName(riffCID,
  'library')` — **"misty kestrel"**, deterministic from the riffCID, already this app's own
  idiom for an imported riff. That IS the default name; nothing new is written or invented.
- `seed discover from this riff` already exists in Browse, so a kept group can be dropped back
  into Discover and evolved further. Free, and probably the nicest thing about the whole
  feature.

Two suppressions on that sidebar row: no sync button, and no `remove from sync` in its context
menu. Neither means anything for a room the app built itself, and the second would delete his
finds.

### Deleting a kept group

In, because he will keep junk from a phone at 1am and want it gone. Right-click a circle →
`forget this`. It deletes the Riffs row and any stem file no *other* discovered riff still
references (computed from the one query above, in JS — no per-stem query). It never deletes a
`Stems` row and never touches `StemCategories`/`StemFeatureCache`: those are keyed by StemCID and
are still true about the stem, wherever else it lives.

## Part 1 — not now

- Renaming a kept group. `Tags.Note` is free, nullable, and untouched by the favourites code
  (`toggleWarehouseFavourite` only ever writes `Favour`) — that is where a name goes when it is
  time. Until then the derived friendly name is enough.
- Notes, tags, ratings, colours on a kept group.
- A dedicated "discovered" screen separate from Browse.
- Any UI for the copies on disk (a size readout, a "reclaim space" pass).
- Deduping the copy of a stem that already sits in the endlesss-cache. It is a duplicate on
  purpose: the cache is a cache, `discovered/` is the durable thing.
- Favouriting a kept group (`Tags.Favour` would work today; it is one more concept than the
  room needs).

---

# Part 2 — the phone remote, a side quest

> "i'd like it to be streamlined to just collecting cool discover rifffs and saving them as
> favorites .. maybe a side quest (playing on parlance influenced by the silkscreen classic
> video game vibe)"

Audio stays on the Mac — he wears Bluetooth headphones connected to the computer. **The phone is
a controller, not an audio client.** There is no stream and therefore no sync problem, and
**no native-engine change is needed anywhere in this design.** Playback is the engine preview
DiscoverPanel already owns.

## The loop, and nothing else

roll · listen · reroll the one you don't like · keep. Four verbs:

- **tap a slot row** → reroll that slot
- **roll all**
- **play / stop**
- **keep**

No arranging, no timeline, no slot add/remove, no kind picker, no gain, no settings, no
library browsing. **The Mac sets the shape of the loop; the phone rolls it.** Whatever slots he
left on screen are what he gets.

Per-slot reroll is deliberately doing the job a lock would do — tap only the slots you want to
change and the good ones stay. That is one concept instead of two.

## The page

```
  side quest
  kept 3 · rolled 11

  drummy     wooden thud
  bassish    late sub
  sparkly    glass bell
  buttery    long pad

  [ roll all ]   [ play ]   [ keep ]
```

Lowercase, no emoji, no exclamation marks, sharp corners, near-black, Silkscreen. Colour only
where it carries audio information — the slot rows take `typeColorVar(soundType)` for the stem's
own type and nothing else on the page is coloured. The counter is the whole arcade gesture:
two numbers in the eyebrow style, and the kept name flashing once under them (`kept · misty
kestrel`). A run is a session; the counters reset when the server does. No points, no badges, no
streaks.

The tab title is `sssketch · side quest`.

When Discover is not open on the Mac, the page says `open discover on the mac` and offers
nothing else. It does not navigate the desktop app there. (Screen-driving was considered and
rejected by Elling in the arrangement-map work; the same answer applies.)

## How it is built and served

**The page is a single string constant in a main-process module** (`src/main/remotePage.ts`),
served by `node:http`. It is NOT bundled by Vite and is not part of the renderer build.

That is the whole point: no asset-copying config, no hashed-filename lookup from main, nothing
that can work in `npm run dev` and be missing from a packaged build. This codebase has already
paid for exactly that mistake once — the Silkscreen faces were inlined by Vite as `data:` URIs
and then blocked by the renderer's CSP in *every build ever shipped* (commit 25ab55d). The
Silkscreen woff2 is 3768 bytes; it goes into the same module as a base64 constant and ships
inside the page. If that fights, the cheap out is the `ui-monospace` fallback stack and a note
that it looks wrong on the phone.

The handful of colours the page needs are hand-copied literals from
`src/renderer/src/styles/tokens.css` with a comment saying tokens.css is the source of truth and
this is a copy. They will drift eventually. That is cheaper tonight than any sharing mechanism.

## How the phone reaches Discover's state

Discover's slots live in renderer state (`DiscoverPanel`'s own `slots`), and the server lives in
main. So:

- The renderer **pushes** a small snapshot to main whenever its slots change
  (`set-remote-state`): per slot `{ kindLabel, stemName, soundType }`, plus
  `{ playing, discoverOpen, kept, rolled }`. No paths, no CIDs, no bpm, nothing about the
  library.
- `GET /api/state` answers from that last-pushed snapshot. The phone polls it every 700ms.
- Commands go main → renderer as a `remote-command` event; the renderer performs them by calling
  the exact functions its own buttons call. `keep` is `keep`. There is no second implementation
  of anything.

Polling, not websockets or SSE: the payload is a few hundred bytes and a poll loop is about
fifteen lines. What he sees on the Mac and what he sees on the phone are the same state because
there is only one.

## Security

This opens a listening socket on his home network. Taking that seriously is part of the
feature, not a follow-up.

- **Off by default. Opt-in per session.** A `phone remote…` entry in the gear menu
  (`TransportBar.tsx`, where `change riff archive location…` lives). Never auto-starts, never
  persisted, stops when the app quits or he clicks off.
- **Fixed port 7373**, bound to `0.0.0.0` (it has to be, or the phone cannot reach it). The
  desktop shows the URL: `http://192.168.x.x:7373`. Typed once; the phone remembers it.
- **A 4-character pairing code**, freshly generated each time the server starts and shown on the
  desktop. The phone's first screen asks for it; a correct code returns a 32-byte random token
  the page keeps in `localStorage` and sends on every call. **Before pairing, the server serves
  the pairing screen and nothing else** — no state, no names, no 404 that reveals a route exists.
- **Five wrong codes ends pairing for the session**, and the desktop says so. A 4-character code
  is not brute-forceable in five tries, and he will notice.
- **A Host-header check** rejects requests whose `Host` is not the expected `ip:7373` — three
  lines, and it closes DNS rebinding from a browser tab elsewhere on the network.
- **The surface leaks nothing even fully authenticated.** Five routes: `POST /api/pair`,
  `GET /api/state`, `POST /api/roll`, `POST /api/keep`, `POST /api/transport`. No route takes or
  returns a filesystem path, and there is no route that reads the library. A paired attacker can
  roll dice and save a rifff. That is the entire blast radius, and it is a deliberate design
  constraint rather than an accident of what got built first.
- **No accounts.** Explicitly not designed. A code and a session token is the whole model.

Residual risk, stated plainly: anyone on his LAN can load the pairing screen while the server is
on. That is the price of the phone being able to reach it at all, and it is why the thing is off
by default and per-session.

## Part 2 — not now

- A QR code for the URL. It is the one thing that would clearly improve the setup, and it needs
  an encoder. He types the URL once.
- Remembering a pairing across sessions.
- Adding/removing slots, picking kinds, per-slot gain, locks, waveforms, anything with a scroll.
- Seeing the discovered library from the phone.
- SSE/websockets, more than one phone at a time, HTTPS, a settings screen of any kind.

---

## Could not settle

- **Whether the discovered room should feed Discover's own rolls.** It will, automatically —
  `listJamsWithDb` returns every Jams row, so kept stems become candidates like anything else.
  That might be lovely (your good stems come back around) or mildly annoying (the same kick
  forever). Leaving it on because turning it off is a special case, but it is the first thing to
  look at if rolls start feeling repetitive.
- **Whether `keep` should also add to the shelf.** Two buttons that both "save" is a small
  confusion; one button that does both is a bigger one. Left as two, watch it.
- **Whether a kept group should be re-keepable after editing one slot.** Today that is a
  different StemCID set, so it saves as a separate group and the original stays. Probably right.
  It will also fill the room with near-identical circles, and there is no answer in this spec
  for that.
- **The colour literals copied into the phone page.** They will drift from tokens.css and
  nothing will notice.
- **Whether 4 characters is the right pairing code length.** It is a judgement call about how
  annoying it is to type versus how much the attempt limit is really carrying.

## Testing

Pure logic in `src/shared/` and the testable seams in main, TDD'd as ever:

- the discovered-group identity key and the duplicate check (unordered StemCID sets)
- the discovered stem path builder, including that it ignores the configured browse root
- `buildResolvedRiff` carrying `fileEndpoint`/`fileBucket`/`fileKey` through — specifically a
  regression test that a save does not null out a real synced stem's download columns
- the pairing-code check, the attempt limiter, and the Host-header guard, all written as pure
  functions so they are testable without a live socket
- the save path against a fixture warehouse, using the existing `setRiffLibraryRootForTests`
  seam — no mocking of the `electron` module, per this codebase's convention

React components are not unit-tested here, and the phone page is a string served to a real
mobile browser that no agent in this environment can open, tap, or hear. So all of the
following are Elling's alone to verify, and nothing in a build log should be read as covering
them:

- whether `keep` from the sofa is actually enjoyable, which is the only real requirement
- whether the phone page is readable and tappable on his actual phone, at arm's length, in a
  dark room
- whether the pairing flow makes sense to someone who did not design it
- whether roll → keep → roll stays fast on his real 372k-riff library after the index-append
  work, which is the one performance claim in this spec that is a prediction rather than a
  measurement
- whether the copies really do survive removing a source jam from sync — that needs a real
  delete of real material, and it is the whole justification for copying in the first place
- whether Bluetooth latency between tapping `roll all` and hearing it is bearable
