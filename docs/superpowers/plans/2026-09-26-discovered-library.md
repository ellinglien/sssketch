# The discovered library, and the phone in the other room — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `keep` button in Discover that saves the current group of stems as a real rifff in a new `discovered` room in Browse — and, second, a phone page on the LAN that can roll, play and keep that same loop from the sofa.

**Architecture:** **Part 1** makes `discovered` a real `Jams` row in sssketch's own writable warehouse, reached through three one-line branches in `riffLibraryStore.ts` that mirror what the Shared Feed's `shared:` prefix already does. Stems are **copied** to `<ownRiffLibraryRoot()>/cache/common/stem_v2/discovered/<shard>/<StemCID>` under their own StemCID (the basename IS the StemCID — every analysis cache keeps hitting). The save reuses `writeRiffDetail` and, in the same transaction, appends its own rows to Discover's persisted candidate index so a keep does not force a rebuild on the next roll. **Part 2** adds an opt-in `node:http` server on port 7373 serving one hand-written HTML string; the renderer pushes a path-free state snapshot to main, the phone polls it, and commands come back as a `remote-command` event the renderer executes by calling the exact functions its own buttons call.

**Part 1 is independently shippable.** After Task 9 the app is strictly better and complete on its own: keep, browse, preview, import, seed-discover-from, forget. If the night runs out there, nothing is half-built and nothing in Part 2 has been started.

**Tech Stack:** TypeScript, React 19, Electron main/preload/renderer, better-sqlite3, `node:http`, vitest.

**Spec:** `docs/superpowers/specs/2026-09-26-discovered-library-design.md` (2026-09-26). Its three settled decisions are not re-opened here: **a saved group IS a rifff**; **it lives in a `discovered` room**; **stems are COPIED, not referenced**. Its "not now" lists are the scope boundary — if something is not named as in, it is out.

**Elling's governing instruction, verbatim:** *"keep it simple to start bit functional... minimum lovable product."*

**Baseline (verified on `master`, 2026-09-25, commit `71364c7`):**

```
Test Files  177 passed (177)
     Tests  2699 passed (2699)
```

`npm run typecheck` — 0 errors. `npm run lint` — 0 errors + **4 pre-existing prettier warnings in unrelated files**. Any *new* warning is yours.

**NO NATIVE-ENGINE CHANGES.** Nothing in this plan reaches `native-engine/`. The phone is a controller, not an audio client — audio stays on the Mac, played by the engine preview `DiscoverPanel` already owns. `EngineProject` / `buildEngineProject.ts` are a hand-synced pair (CLAUDE.md) and **this plan changes neither**. If you conclude a native-engine change is needed, **STOP and report it rather than planning one.**

---

## Findings that shaped this plan — read these before Task 1

1. **The latent bug is real and it is exactly three lines.** Verified on disk today. `buildResolvedRiff` (`src/main/riffLibraryStore.ts:486-526`) SELECTs `FileEndpoint, FileBucket, FileKey`, uses them to build `downloadUrl`, and **does not put them on the object it returns** — even though `RiffLibraryResolvedStem`'s own doc comment (`src/shared/riffLibraryTypes.ts`) says they are "kept separately … so a SQLite warehouse writer can persist them as their own FileEndpoint/FileBucket/FileKey columns". Meanwhile `writeRiffDetail`'s `updateStemDetail` (`src/main/riffLibraryWriter.ts:89-95`) runs `SET … FileEndpoint = @fileEndpoint, FileBucket = @fileBucket, FileKey = @fileKey` **unconditionally**, from `stem.fileEndpoint ?? null`. So feeding a `buildResolvedRiff` result to `writeRiffDetail` nulls out a real synced stem's download columns. Task 1 fixes it first, with its own regression test.

2. **`basename(path)` IS the StemCID.** `stemCIDForPath` (`src/main/stemCategoriesStore.ts:46-58`) is blunt about it: `const candidate = basename(path)`, then validated against a real `Stems` row. Copying to `.../discovered/<shard>/<StemCID>` — same basename, **no extension** — is what keeps `StemCategories`, `StemFeatureCache`, `StemPeaksCache`, `StemEmbeddingCache`, `StemAutoCategory` and `StemFavourite` all hitting at the new path. **Do not invent a friendlier on-disk layout.** A human-browsable `discovered/<name>/<slot>-<stem>.wav` was considered and rejected in the spec: `resolveStemPath` cannot compute it from `(jamCID, stemCID)` alone and every cache above misses.

3. **The discovered stem path is NOT what `resolveStemPath`'s own-root branch builds.** Read that function (`src/main/riffLibraryStore.ts:191-206`) before editing it. Its *own-root / `shared:`* branch returns `app.getPath('userData')/endlesss-cache/stems/<shard>/<StemCID>`. Its *external-archive* branch returns `<root>/cache/common/stem_v2/<JamCID>/<shard>/<StemCID>`. The discovered branch is the **second** shape, but always under `ownRiffLibraryRoot()` rather than the configured `root` — that is what "like the other jam rooms" means here, and it is why it has to be a new FIRST branch rather than a tweak to either existing one.

4. **Every save invalidates Discover's index, and there are TWO caches, not one.**
   - **Persisted** (`DiscoverRiffIndexCache` / `DiscoverInstrumentRowsCache` in the own db, plus their `*Meta` tables). Freshness = the stored `RiffCount` / `StemCount` vs a live `COUNT(*)` (`getCachedRiffCount` / `getCachedStemCount`, `src/main/discoverIndexCache.ts`; compared in `prewarmDiscoverCandidateCaches`, `src/main/discoverCandidates.ts:518-573`). Consulted **at app startup**. A keep moves both counts, so without an append the next launch re-scans.
   - **In-memory** (`riffIndexCache` / `instrumentRowsCache`, plain `WeakMap`s keyed by the live `Database` object, `src/main/discoverCandidates.ts:344` and `:620`). Freshness = `isScanCacheCurrent`, which re-reads a `TableSignal` (count + `MAX(rowid)` + `total_changes()` + `data_version`) at most every `CACHE_CHANGE_CHECK_INTERVAL_MS` = 30s. **This is the one that kills the sofa loop**: within 30 seconds of a keep, a roll rebuilds the own db's whole index in memory. Task 4 handles both. Fixing only the persisted half would look right and feel wrong.
   - `sourceDbKey` is `db.name` (the file path). The external archive's key is different and is never touched. Good.
   - Both cache tables are `PRIMARY KEY (SourceDbKey, StemCID)`, and `buildRiffIndex` is first-seen-wins for a stem in more than one riff. So every append is `ON CONFLICT DO NOTHING` and the in-memory append uses `if (!index.has(stemCID))`. Do not "fix" that into an overwrite.

5. **The in-memory append must run AFTER the transaction commits.** It refreshes `state.signal` by calling `readTableSignal`, which must see the post-commit counts. Appending inside the transaction would store a stale signal and the very next check would invalidate anyway.

6. **Eight `stemCIDForPath` calls per save is fine.** CLAUDE.md's "never one query per stem on a batch path" is about batch paths — this is one explicit, human-initiated button press with at most 8 slots. Everything that IS per-stem inside the save (the writes) goes through **one transaction**. `writeRiffDetail` opens its own `db.transaction`; better-sqlite3 nests that as a SAVEPOINT, so calling it inside an outer transaction is correct and is what this plan does.

7. **`resolveDiscoverRifff()` is reused verbatim** (`src/renderer/src/components/DiscoverPanel.tsx:1855`), the same helper `addToTimeline` and `addToShelf` already share. One inherited behaviour matters and is kept deliberately: a slot **muted** in Discover's preview mix is placed at **gain 0, not dropped** (`gain: previewingSlotIds.has(id) ? gain : 0`). A muted stem is saved as silence, still there, still un-muteable later.

8. **`resolveDiscoverRifff()` returns paths, not CIDs.** `DiscoverRifffAssembly` (`src/renderer/src/audio/discoverRifffAssembly.ts`) is `{ rifff: Rifff; vol: Record<string, number> }`, and `Rifff.stems` are `Stem`s (`path`, `name`, `author`, `type`, `durationSec`, `barLength`, `slot`) — no `stemCID`. **Main recovers identity from the path** via `stemCIDForPath`. That is the design, not a gap.

9. **A member whose path resolves to no StemCID still saves.** A shelf-seeded slot, a wav dropped on the panel, an in-app recording: mint `discovered-<uuid>` and write a real `Stems` row of its own. Save is total — it never refuses and never silently drops a slot. Cost: cold caches for that stem, and re-saving the same dropped wav makes a second copy. Accepted in the spec.

10. **Identity is the set of StemCIDs, unordered, ignoring gain.** Checked with ONE query — `SELECT RiffCID, StemCID_1..8 FROM Riffs WHERE OwnerJamCID = 'discovered'` — compared as sets in JS. No per-stem lookup. A duplicate is **a no-op that says so**: `already kept` for 500ms, nothing written, no second row, no timestamp bump. A group containing a freshly-minted CID can never be a duplicate, by construction.

11. **`friendlyRiffName(riffCID, 'library')` IS the name** (`src/shared/friendlyRiffName.ts:102`) — `"misty kestrel 1a2b3c4d library"`, deterministic from the riffCID. Nothing new is written or invented. **No rename UI** (spec's "not now").

12. **No new browse UI.** `listJams` fills the sidebar, `listRiffs` lists the rifffs, `resolveRiff`/`buildResolvedRiff` resolves one for preview, `RiffCircle` renders it, `import` puts it on the shelf, and `seed discover with this` (`LibraryBrowser.tsx:2172`) already lets a kept group be evolved further. All of that works untouched once `discovered` is a real `Jams` row. Task 8 is only: pin it to the top, hide the two controls that mean nothing for it, and add `forget this`.

13. **Right-click on a `RiffCircle` currently toggles favourite** (`LibraryBrowser.tsx:2067-2070`). In the discovered room it must open a menu with `forget this` instead. Everywhere else it keeps toggling favourite.

14. **React components are NOT unit-tested in this codebase** (CLAUDE.md). Tasks 7, 8, 15 and 16 have **no component tests**, deliberately. They are verified by `npm run typecheck` + `npm run lint` + the pure logic's own tests, then by Elling's manual walkthrough. **This environment has no GUI, audio, phone or browser tooling — do not claim any UI change was tested, do not claim anything about how it sounds, and do not claim the phone page was opened.**

15. **ANY NEW MAIN-PROCESS TEST FILE THAT OPENS better-sqlite3 MUST BE ADDED TO THE CI EXCLUSION LIST IN `vitest.config.ts`.** This is not housekeeping. 21 files were added to that list on 2026-09-25 (commit `db302ba`) because they crash their vitest worker on GitHub's macOS runners — the v1.2.0 release build failed on both legs with 22 `Worker exited unexpectedly` errors and **zero failed tests**. A new one blocks the next release exactly the same way. This plan creates **one** such file, `src/main/discoveredLibrary.test.ts`, and adding it to the list is an explicit numbered step inside Task 5. Files already on the list that this plan edits (`riffLibraryStore.test.ts`, `riffLibraryWriter.test.ts`, `discoverIndexCache.test.ts`, `discoverCandidates.test.ts`) need nothing.

16. **Main-process tests use a real DB, not mocks.** The convention (`stemCategoriesStore.test.ts`, `riffLibraryStore.test.ts`): `new Database(':memory:')` or a real fixture directory, `vi.mock('electron', () => ({ app: { getPath: () => tmpDir } }))` and nothing else mocked, plus `setRiffLibraryRootForTests(root)` for anything that reads the configured root. Do not mock the `electron` module wholesale.

17. **The phone page is NOT Vite-bundled.** It is a string constant in `src/main/remotePage.ts` served by `node:http`. This codebase has already paid for the alternative once: commit `25ab55d` (2026-09-25) found that Vite inlined both Silkscreen woff2 faces as `data:` URIs and the renderer's `default-src 'self'` CSP refused them — **in every packaged build ever shipped**. So the page ships the font as a base64 constant *and* sends its own CSP that permits `font-src data:`. `Silkscreen-Regular.woff2` is 3768 bytes.

18. **Design tokens are the law** (`src/renderer/src/styles/tokens.css`, the single source of truth): near-black monochrome shell, Silkscreen, **no `border-radius` anywhere**, lowercase copy, **no emoji, no exclamation marks**, colour only on things carrying audio information. **Every tooltip is two or three words.** Tooltips are one attribute, `data-tooltip="…"`, never alongside `title` on the same node. `typeColorVar(soundType)` is the one sanctioned colour source; the phone page hand-copies the eight `--ra-type-*` hexes with a comment saying tokens.css is the source of truth and this is a copy.

19. **Lint rules that will bite.** This repo **errors** on a synchronous `setState` inside a React effect (`react-hooks/set-state-in-effect` — the established workaround is deferring through `void Promise.resolve().then(...)`), on render-time impurity (`react-hooks/purity`), and requires an **explicit return type on every function**, inline ones included. Prettier: `singleQuote: true`, `semi: false`, `printWidth: 100`, `trailingComma: none`.

20. **`src/renderer/src/styles/css.test.ts` parses every stylesheet.** **Never write a CSS comment containing a star-slash.** No task here adds a stylesheet, but Task 12 writes CSS inside a TypeScript string — keep its comments free of star-slash too.

21. **Security posture for Part 2 is part of the feature, not a follow-up.** Off by default; opt-in per session from the gear menu; never persisted; stops on quit. Fixed port 7373 bound to `0.0.0.0` (it has to be, or the phone cannot reach it). A 4-character pairing code, fresh each start. Five wrong codes ends pairing for the session. A Host-header check. **No route takes or returns a filesystem path and no route reads the library.** A paired attacker can roll dice and save a rifff — that is the entire blast radius, and it is a design constraint, not an accident.

22. **The discovered room will feed Discover's own rolls**, automatically — `listJamsWithDb` returns every `Jams` row. Left on deliberately (turning it off is a special case). It is the first thing to look at if rolls start feeling repetitive.

## Known limits, accepted on purpose

- **`forget this` does not update either Discover cache.** Deleting a `Riffs` row moves the count, so within 30s the own db's in-memory index invalidates and the following roll rebuilds it. Forgetting is not in the roll/keep loop, and a symmetric delete would have to decide what to do about a stem the index maps to the forgotten riff but that other riffs also contain — a correctness risk for no MLP benefit. If it ever bites, that is the question to answer first.
- **A kept group has `Root`/`Scale` NULL.** Deliberate: a collage of stems from different jams has no honest key. The Inspector already handles an absent key.
- **Slot kinds are not stored.** `drummy`/`chonky`/`sparkly` are Discover's matching vocabulary — a filter used to FIND a stem, not a property the stem then has. Storing them would be a second source of truth that drifts the first time a stem is reclassified from the match meter.
- **The phone page's colour literals will drift from tokens.css** and nothing will notice. Cheaper tonight than any sharing mechanism.
- **Re-keeping after editing one slot** saves a separate group; the original stays. That will fill the room with near-identical circles and there is no answer for it in this plan.

## File map

### Part 1

| File | Change |
|---|---|
| `src/main/riffLibraryStore.ts` | `buildResolvedRiff` carries `fileEndpoint`/`fileBucket`/`fileKey`; `resolveStemPath` gains a discovered first branch; `dbForJam` and `listJams` learn the room; **new export** `discoveredStemPath` |
| `src/main/riffLibraryStore.test.ts` | three new cases (already CI-excluded) |
| `src/shared/discoveredRoom.ts` | **NEW** — `DISCOVERED_JAM_CID`, `DISCOVERED_USER_NAME`, `discoveredGroupKey`, `findDuplicateDiscoveredGroup` |
| `src/shared/discoveredRoom.test.ts` | **NEW** — full TDD |
| `src/main/discoverIndexCache.ts` | **NEW exports** `appendRiffIndexRows`, `appendInstrumentRows` |
| `src/main/discoverIndexCache.test.ts` | TDD for both (already CI-excluded) |
| `src/main/discoverCandidates.ts` | **NEW export** `appendToInMemoryDiscoverCaches` |
| `src/main/discoverCandidates.test.ts` | TDD for it (already CI-excluded) |
| `src/main/discoveredLibrary.ts` | **NEW** — `saveDiscoveredRifff`, `listDiscoveredGroups`, `forgetDiscoveredRifff` |
| `src/main/discoveredLibrary.test.ts` | **NEW** — full TDD, **and added to `vitest.config.ts`'s CI exclusion list** |
| `vitest.config.ts` | one line: `src/main/discoveredLibrary.test.ts` |
| `src/main/index.ts` | `save-discovered-rifff`, `forget-discovered-rifff` handlers |
| `src/preload/index.ts` | `saveDiscoveredRifff`, `forgetDiscoveredRifff` |
| `src/renderer/src/components/DiscoverPanel.tsx` | the `keep` button |
| `src/renderer/src/components/LibraryBrowser.tsx` | pin `discovered`; suppress sync + remove-from-sync; `forget this` |

### Part 2

| File | Change |
|---|---|
| `src/shared/remoteAuth.ts` | **NEW** — `REMOTE_PORT`, `newPairingCode`, `codesMatch`, `isAllowedHost`, `recordPairAttempt` |
| `src/shared/remoteAuth.test.ts` | **NEW** — full TDD |
| `src/shared/remoteState.ts` | **NEW** — `RemoteState`, `RemoteCommand`, `remoteStateFromSlots` |
| `src/shared/remoteState.test.ts` | **NEW** — full TDD |
| `src/main/remoteFont.ts` | **NEW, generated** — `SILKSCREEN_REGULAR_WOFF2_BASE64` |
| `src/main/remotePage.ts` | **NEW** — `REMOTE_PAGE_HTML`, `REMOTE_PAGE_CSP` |
| `src/main/remoteServer.ts` | **NEW** — `startRemoteServer`, `lanIPv4Address` |
| `src/main/index.ts` | remote lifecycle + 4 handlers + the `remote-command` send |
| `src/preload/index.ts` | `startPhoneRemote`, `stopPhoneRemote`, `getPhoneRemoteStatus`, `setRemoteState`, `onRemoteCommand`, `onPhoneRemoteStatus` |
| `src/renderer/src/components/TransportBar.tsx` | `phone remote…` gear entry + the URL/code info rows |
| `src/renderer/src/components/DiscoverPanel.tsx` | push the snapshot, run the commands, count kept/rolled |

**Nothing else is touched. No file is deleted.**

## Commands (run from `/Users/nickel/Claudecode/sssketch`)

```bash
npx vitest run src/shared/discoveredRoom.test.ts   # one file
npm test                                            # full suite
npm run typecheck
npm run lint
```

---

# PART 1 — the discovered library

## Task 1: Carry the download columns through `buildResolvedRiff`

The load-bearing three-line fix. Do it before anything writes a rifff.

**Files:**
- Modify: `src/main/riffLibraryStore.ts:511-525`
- Test: `src/main/riffLibraryStore.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/main/riffLibraryStore.test.ts`. It already has `createFixtureWarehouse(root)`, the `electron` mock and `setRiffLibraryRootForTests`; add `writeRiffDetail` to the imports at the top of the file:

```ts
import { writeRiffDetail } from './riffLibraryWriter'
```

Then append these two cases inside the top-level `describe('riffLibraryStore', …)`:

```ts
  it('resolveRiff carries FileEndpoint/FileBucket/FileKey through onto each stem', () => {
    root = mkdtempSync(join(tmpdir(), 'sssketch-lore-root-test-'))
    createFixtureWarehouse(root)
    setRiffLibraryRootForTests(root)
    const db = new Database(join(root, 'cache', 'common', 'warehouse.db3'))
    db.prepare(`INSERT INTO Jams (JamCID, PublicName) VALUES ('jam_1', 'jam one')`).run()
    db.prepare(
      `INSERT INTO Riffs (RiffCID, OwnerJamCID, CreationTime, BPMrnd, BarLength, UserName, StemCID_1)
       VALUES ('riff_1', 'jam_1', 100, 120, 4, 'elling', 'abc123')`
    ).run()
    db.prepare(
      `INSERT INTO Stems (StemCID, OwnerJamCID, CreatorUserName, PresetName, Instrument,
                          BPMrnd, Length16s, FileEndpoint, FileBucket, FileKey)
       VALUES ('abc123', 'jam_1', 'elling', 'thud', 1, 120, 64,
               'ams3.digitaloceanspaces.com', 'endlesss', 'attachments/abc123.ogg')`
    ).run()
    db.close()

    const resolved = resolveRiff('riff_1')
    expect(resolved?.stems[0].fileEndpoint).toBe('ams3.digitaloceanspaces.com')
    expect(resolved?.stems[0].fileBucket).toBe('endlesss')
    expect(resolved?.stems[0].fileKey).toBe('attachments/abc123.ogg')
  })

  it('writing a resolveRiff result back does not null out a synced stem download columns', () => {
    root = mkdtempSync(join(tmpdir(), 'sssketch-lore-root-test-'))
    createFixtureWarehouse(root)
    setRiffLibraryRootForTests(root)
    const dbPath = join(root, 'cache', 'common', 'warehouse.db3')
    const seed = new Database(dbPath)
    seed.exec(`ALTER TABLE Riffs ADD COLUMN AppVersion INTEGER;`)
    seed.exec(`ALTER TABLE Stems ADD COLUMN CreationTime INTEGER;`)
    seed.prepare(`INSERT INTO Jams (JamCID, PublicName) VALUES ('jam_1', 'jam one')`).run()
    seed
      .prepare(
        `INSERT INTO Riffs (RiffCID, OwnerJamCID, CreationTime, BPMrnd, BarLength, UserName, StemCID_1)
         VALUES ('riff_1', 'jam_1', 100, 120, 4, 'elling', 'abc123')`
      )
      .run()
    seed
      .prepare(
        `INSERT INTO Stems (StemCID, OwnerJamCID, CreatorUserName, PresetName, Instrument,
                            BPMrnd, Length16s, FileEndpoint, FileBucket, FileKey)
         VALUES ('abc123', 'jam_1', 'elling', 'thud', 1, 120, 64,
                 'ams3.digitaloceanspaces.com', 'endlesss', 'attachments/abc123.ogg')`
      )
      .run()
    seed.close()

    const resolved = resolveRiff('riff_1')
    expect(resolved).not.toBeNull()

    const writable = new Database(dbPath)
    writeRiffDetail(writable, 'discovered', { creationTime: 200, userName: 'discovered' }, {
      ...resolved!,
      riffCID: 'kept_1'
    })
    const row = writable
      .prepare(`SELECT FileEndpoint, FileBucket, FileKey FROM Stems WHERE StemCID = 'abc123'`)
      .get() as { FileEndpoint: string | null; FileBucket: string | null; FileKey: string | null }
    writable.close()

    expect(row.FileEndpoint).toBe('ams3.digitaloceanspaces.com')
    expect(row.FileBucket).toBe('endlesss')
    expect(row.FileKey).toBe('attachments/abc123.ogg')
  })
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run src/main/riffLibraryStore.test.ts -t 'download columns'`
Expected: FAIL — `expected undefined to be 'ams3.digitaloceanspaces.com'` on the first, and `expected null to be 'ams3.digitaloceanspaces.com'` on the second.

- [ ] **Step 3: Make the fix**

In `src/main/riffLibraryStore.ts`, inside `buildResolvedRiff`'s returned stem object, add three properties immediately after `barLength: stemBarLength,` and before `downloadUrl:`:

```ts
      // Kept on the returned object, not just consumed for downloadUrl below
      // -- RiffLibraryResolvedStem's own doc comment says a warehouse writer
      // needs these as their own columns, and writeRiffDetail's
      // updateStemDetail overwrites FileEndpoint/FileBucket/FileKey
      // unconditionally from exactly these fields. Dropping them here meant
      // writing a resolved riff back nulled out a real synced stem's
      // download columns.
      fileEndpoint: stemRow?.FileEndpoint ?? undefined,
      fileBucket: stemRow?.FileBucket ?? undefined,
      fileKey: stemRow?.FileKey ?? undefined,
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run src/main/riffLibraryStore.test.ts`
Expected: PASS, whole file.

- [ ] **Step 5: Commit**

```bash
git add src/main/riffLibraryStore.ts src/main/riffLibraryStore.test.ts
git commit -m "A resolved stem keeps the three columns a writer needs

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

---

## Task 2: The shared vocabulary of the room

**Files:**
- Create: `src/shared/discoveredRoom.ts`
- Test: `src/shared/discoveredRoom.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/shared/discoveredRoom.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  DISCOVERED_JAM_CID,
  DISCOVERED_USER_NAME,
  discoveredGroupKey,
  findDuplicateDiscoveredGroup
} from './discoveredRoom'

describe('discoveredRoom', () => {
  it('names the room and its author', () => {
    expect(DISCOVERED_JAM_CID).toBe('discovered')
    expect(DISCOVERED_USER_NAME).toBe('discovered')
  })

  it('gives the same key regardless of order', () => {
    expect(discoveredGroupKey(['c', 'a', 'b'])).toBe(discoveredGroupKey(['a', 'b', 'c']))
  })

  it('collapses a repeated stem, so the same stem twice is one member', () => {
    expect(discoveredGroupKey(['a', 'a', 'b'])).toBe(discoveredGroupKey(['b', 'a']))
  })

  it('gives different keys to different sets', () => {
    expect(discoveredGroupKey(['a', 'b'])).not.toBe(discoveredGroupKey(['a', 'b', 'c']))
  })

  it('finds an existing group with the same stems in a different order', () => {
    const existing = [
      { riffCID: 'r1', stemCIDs: ['a', 'b', 'c'] },
      { riffCID: 'r2', stemCIDs: ['d'] }
    ]
    expect(findDuplicateDiscoveredGroup(existing, ['c', 'b', 'a'])).toBe('r1')
  })

  it('returns null when nothing matches', () => {
    const existing = [{ riffCID: 'r1', stemCIDs: ['a', 'b'] }]
    expect(findDuplicateDiscoveredGroup(existing, ['a', 'b', 'c'])).toBe(null)
  })

  it('returns null for an empty set of stems', () => {
    expect(findDuplicateDiscoveredGroup([{ riffCID: 'r1', stemCIDs: [] }], [])).toBe(null)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/shared/discoveredRoom.test.ts`
Expected: FAIL — `Failed to resolve import "./discoveredRoom"`.

- [ ] **Step 3: Write the implementation**

Create `src/shared/discoveredRoom.ts`:

```ts
// src/shared/discoveredRoom.ts

/** The one jamCID for sssketch's own "groups of stems that sound good
 * together" room. A real Jams row in sssketch's OWN writable warehouse,
 * never in an external LORE archive -- exactly the same routing the Shared
 * Feed's "shared:" prefix already gets (see riffLibraryStore.ts's dbForJam
 * and listJams). Shared, rather than a main-process constant, because the
 * renderer has to name the room too: LibraryBrowser pins it to the top of
 * the sidebar and suppresses the two controls that mean nothing for a room
 * the app built itself. */
export const DISCOVERED_JAM_CID = 'discovered'

/** Riffs.UserName for a kept group. Not a real Endlesss account -- the room
 * has no author but the app itself. */
export const DISCOVERED_USER_NAME = 'discovered'

/** A kept group's identity: the SET of its StemCIDs, unordered, ignoring
 * gain. The same five stems balanced differently are the same discovery,
 * so keeping twice must not litter the room. Duplicates within one group
 * collapse -- the same stem in two slots is still one member of the set. */
export function discoveredGroupKey(stemCIDs: readonly string[]): string {
  return [...new Set(stemCIDs)].sort().join('|')
}

/** The riffCID of an already-kept group with this exact stem set, or null.
 * `existing` comes from ONE query over the whole room (see
 * discoveredLibrary.ts's listDiscoveredGroups) -- never a per-stem lookup.
 * An empty candidate set never matches anything: there is nothing to keep. */
export function findDuplicateDiscoveredGroup(
  existing: readonly { riffCID: string; stemCIDs: readonly string[] }[],
  stemCIDs: readonly string[]
): string | null {
  if (stemCIDs.length === 0) return null
  const key = discoveredGroupKey(stemCIDs)
  for (const group of existing) {
    if (group.stemCIDs.length > 0 && discoveredGroupKey(group.stemCIDs) === key) {
      return group.riffCID
    }
  }
  return null
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/shared/discoveredRoom.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/shared/discoveredRoom.ts src/shared/discoveredRoom.test.ts
git commit -m "A name for the room, and what makes two finds the same find

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

---

## Task 3: Three branches that make `discovered` a real room

**Files:**
- Modify: `src/main/riffLibraryStore.ts` (`resolveStemPath` ~191-206, `dbForJam` ~215-217, `listJams` ~232-246)
- Test: `src/main/riffLibraryStore.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to the imports at the top of `src/main/riffLibraryStore.test.ts`:

```ts
import { discoveredStemPath } from './riffLibraryStore'
import { DISCOVERED_JAM_CID } from '@shared/discoveredRoom'
import { ownRiffLibraryRoot } from './riffLibrarySchema'
```

(Fold `discoveredStemPath` into the existing `from './riffLibraryStore'` import rather than adding a second one.)

Then append these cases:

```ts
  it('resolves a discovered stem under the OWN root, not the configured browse root', () => {
    root = mkdtempSync(join(tmpdir(), 'sssketch-lore-root-test-'))
    createFixtureWarehouse(root)
    setRiffLibraryRootForTests(root)
    const path = resolveStemPath(DISCOVERED_JAM_CID, 'abc123')
    expect(path).toBe(
      join(ownRiffLibraryRoot(), 'cache', 'common', 'stem_v2', 'discovered', 'a', 'abc123')
    )
    expect(path.startsWith(root)).toBe(false)
  })

  it('discoveredStemPath is the same path, by the same rule', () => {
    root = mkdtempSync(join(tmpdir(), 'sssketch-lore-root-test-'))
    createFixtureWarehouse(root)
    setRiffLibraryRootForTests(root)
    expect(discoveredStemPath('abc123')).toBe(resolveStemPath(DISCOVERED_JAM_CID, 'abc123'))
  })
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/main/riffLibraryStore.test.ts -t 'discovered'`
Expected: FAIL — the first returns the `endlesss-cache/stems/...` path (`resolveStemPath` has no discovered branch yet); the second fails to import `discoveredStemPath`.

- [ ] **Step 3: Add the three branches and the helper**

In `src/main/riffLibraryStore.ts`, add to the imports at the top:

```ts
import { DISCOVERED_JAM_CID } from '@shared/discoveredRoom'
```

**3a.** In `resolveStemPath`, insert a new FIRST branch immediately after `const root = riffLibraryRootPath()` and before the existing `if (jamCID.startsWith('shared:') || root === ownRiffLibraryRoot())`:

```ts
  // sssketch's own "discovered" room (see @shared/discoveredRoom): the
  // jam-sharded stem_v2 layout every external LORE jam room already uses,
  // but always under the OWN root regardless of where browsing currently
  // points -- these are copies the app made itself and they must not go
  // missing when the user repoints at a different archive. Same basename-
  // is-the-StemCID convention as everywhere else (stemCIDForPath), which
  // is what keeps StemCategories/StemFeatureCache/StemPeaksCache/
  // StemEmbeddingCache/StemAutoCategory/StemFavourite all hitting at the
  // copied path for free. Checked BEFORE the own-root branch below, which
  // would otherwise send it to the content-addressed endlesss-cache.
  if (jamCID === DISCOVERED_JAM_CID) {
    return join(
      ownRiffLibraryRoot(),
      'cache',
      'common',
      'stem_v2',
      DISCOVERED_JAM_CID,
      shard,
      stemCID
    )
  }
```

**3b.** Immediately below `resolveStemPath`, add:

```ts
/** Where a kept group's copy of `stemCID` lives. One definition, shared by
 * the save path (which writes the copy) and every reader (which resolves
 * it through resolveStemPath) -- delegated rather than re-derived so the
 * two can never drift. */
export function discoveredStemPath(stemCID: string): string {
  return resolveStemPath(DISCOVERED_JAM_CID, stemCID)
}
```

**3c.** Replace `dbForJam`'s body:

```ts
function dbForJam(jamCID: string): Database.Database | null {
  return jamCID.startsWith('shared:') || jamCID === DISCOVERED_JAM_CID
    ? openOwnRiffLibraryDb()
    : getRiffLibraryDb()
}
```

**3d.** In `listJams`, widen the own-db merge filter:

```ts
  const ownRows = queryJamsFromDb(openOwnRiffLibraryDb(), filterText).filter(
    (j) => j.jamCID.startsWith('shared:') || j.jamCID === DISCOVERED_JAM_CID
  )
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run src/main/riffLibraryStore.test.ts`
Expected: PASS, whole file.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/main/riffLibraryStore.ts src/main/riffLibraryStore.test.ts
git commit -m "The discovered room routes like the shared feed already does

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

---

## Task 4: Appending to Discover's index instead of invalidating it

Required, not an optimisation — see Finding 4. Both caches.

**Files:**
- Modify: `src/main/discoverIndexCache.ts`
- Modify: `src/main/discoverCandidates.ts`
- Test: `src/main/discoverIndexCache.test.ts`
- Test: `src/main/discoverCandidates.test.ts`

- [ ] **Step 1: Write the failing test for the persisted half**

Append to `src/main/discoverIndexCache.test.ts` (read its existing `freshDb()`/setup helper first and reuse it verbatim — do not invent a second one):

```ts
  describe('appendRiffIndexRows', () => {
    it('adds a row and bumps the stored RiffCount', async () => {
      const db = freshDb()
      saveRiffIndexCache(
        db,
        'key1',
        new Map([['s1', { riffCID: 'r1', ownerJamCID: 'j1', bpmRnd: 120, creationTime: 10 }]]),
        1
      )
      appendRiffIndexRows(
        db,
        'key1',
        [{ stemCID: 's2', riffCID: 'r2', ownerJamCID: 'discovered', bpmRnd: 140, creationTime: 20 }],
        1
      )
      expect(getCachedRiffCount(db, 'key1')).toBe(2)
      const loaded = await loadCachedRiffIndex(db, 'key1')
      expect(loaded.get('s2')).toEqual({
        riffCID: 'r2',
        ownerJamCID: 'discovered',
        bpmRnd: 140,
        creationTime: 20
      })
    })

    it('leaves an already-indexed stem pointing at the riff it was first seen in', async () => {
      const db = freshDb()
      saveRiffIndexCache(
        db,
        'key1',
        new Map([['s1', { riffCID: 'r1', ownerJamCID: 'j1', bpmRnd: 120, creationTime: 10 }]]),
        1
      )
      appendRiffIndexRows(
        db,
        'key1',
        [{ stemCID: 's1', riffCID: 'r2', ownerJamCID: 'discovered', bpmRnd: 140, creationTime: 20 }],
        1
      )
      const loaded = await loadCachedRiffIndex(db, 'key1')
      expect(loaded.get('s1')?.riffCID).toBe('r1')
      expect(getCachedRiffCount(db, 'key1')).toBe(2)
    })

    it('does nothing at all for a key that has never been cached', () => {
      const db = freshDb()
      appendRiffIndexRows(
        db,
        'never',
        [{ stemCID: 's1', riffCID: 'r1', ownerJamCID: 'j1', bpmRnd: 120, creationTime: 1 }],
        1
      )
      expect(getCachedRiffCount(db, 'never')).toBe(null)
    })
  })

  describe('appendInstrumentRows', () => {
    it('adds a row and bumps the stored StemCount', async () => {
      const db = freshDb()
      saveInstrumentRowsCache(
        db,
        'key1',
        [{ StemCID: 's1', Instrument: 1, OwnerJamCID: 'j1' }],
        1
      )
      appendInstrumentRows(
        db,
        'key1',
        [{ StemCID: 's2', Instrument: 4, OwnerJamCID: 'discovered' }],
        1
      )
      expect(getCachedStemCount(db, 'key1')).toBe(2)
      const rows = await loadCachedInstrumentRows(db, 'key1')
      expect(rows.map((r) => r.StemCID).sort()).toEqual(['s1', 's2'])
    })

    it('does nothing at all for a key that has never been cached', () => {
      const db = freshDb()
      appendInstrumentRows(db, 'never', [{ StemCID: 's1', Instrument: 1, OwnerJamCID: 'j' }], 1)
      expect(getCachedStemCount(db, 'never')).toBe(null)
    })
  })
```

Add `appendRiffIndexRows` and `appendInstrumentRows` to that file's existing import from `./discoverIndexCache`.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/main/discoverIndexCache.test.ts`
Expected: FAIL — `appendRiffIndexRows is not a function`.

- [ ] **Step 3: Implement the persisted half**

Append to `src/main/discoverIndexCache.ts`:

```ts
/** One kept group's rows, appended to an ALREADY-SAVED riff index rather
 * than invalidating it.
 *
 * Why this exists: the freshness check for this cache is a per-db row
 * count (getCachedRiffCount vs a live COUNT(*) FROM Riffs, compared in
 * discoverCandidates.ts's prewarmDiscoverCandidateCaches). Saving a
 * discovered group adds a Riffs row to the own db, which moves that count,
 * which means the next launch pays a FULL rebuild. In the roll/keep/roll
 * loop this feature is built around, that is the difference between a game
 * and a progress bar.
 *
 * NO TRANSACTION OF ITS OWN, deliberately: the caller
 * (discoveredLibrary.ts's saveDiscoveredRifff) wraps this, writeRiffDetail
 * and everything else in ONE transaction, so a save is all-or-nothing
 * across the real rows and the cache rows alike.
 *
 * ON CONFLICT DO NOTHING matches buildRiffIndex's own first-seen-wins rule
 * for a stem that appears in more than one riff -- this table is
 * PRIMARY KEY (SourceDbKey, StemCID), one row per stem, not per riff.
 *
 * A key with no meta row has never been cached at all, and half a cache is
 * worse than none: appending to it would make a partial index look
 * complete. Returns without writing anything in that case. */
export function appendRiffIndexRows(
  ownDb: Database.Database,
  sourceDbKey: string,
  rows: readonly {
    stemCID: string
    riffCID: string
    ownerJamCID: string
    bpmRnd: number
    creationTime: number | null
  }[],
  riffCountDelta: number
): void {
  const existing = getCachedRiffCount(ownDb, sourceDbKey)
  if (existing === null) return
  const insert = ownDb.prepare(
    `INSERT INTO DiscoverRiffIndexCache (SourceDbKey, StemCID, RiffCID, OwnerJamCID, BPMrnd, CreationTime)
     VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(SourceDbKey, StemCID) DO NOTHING`
  )
  for (const row of rows) {
    insert.run(sourceDbKey, row.stemCID, row.riffCID, row.ownerJamCID, row.bpmRnd, row.creationTime)
  }
  ownDb
    .prepare(
      `UPDATE DiscoverRiffIndexCacheMeta SET RiffCount = ?, ComputedAt = ? WHERE SourceDbKey = ?`
    )
    .run(existing + riffCountDelta, Date.now(), sourceDbKey)
}

/** Same shape and the same reasoning as appendRiffIndexRows above, for
 * getInstrumentRowsForDb's own cache. Needed too, not just the riff index:
 * a stem from an external archive gets a genuinely NEW Stems row in the
 * own db when a group referencing it is kept, which moves the Stems count
 * this cache is checked against. */
export function appendInstrumentRows(
  ownDb: Database.Database,
  sourceDbKey: string,
  rows: readonly CachedInstrumentRow[],
  stemCountDelta: number
): void {
  const existing = getCachedStemCount(ownDb, sourceDbKey)
  if (existing === null) return
  const insert = ownDb.prepare(
    `INSERT INTO DiscoverInstrumentRowsCache (SourceDbKey, StemCID, Instrument, OwnerJamCID)
     VALUES (?, ?, ?, ?) ON CONFLICT(SourceDbKey, StemCID) DO NOTHING`
  )
  for (const row of rows) insert.run(sourceDbKey, row.StemCID, row.Instrument, row.OwnerJamCID)
  ownDb
    .prepare(
      `UPDATE DiscoverInstrumentRowsCacheMeta SET StemCount = ?, ComputedAt = ? WHERE SourceDbKey = ?`
    )
    .run(existing + stemCountDelta, Date.now(), sourceDbKey)
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/main/discoverIndexCache.test.ts`
Expected: PASS, whole file.

- [ ] **Step 5: Write the failing test for the in-memory half**

Append to `src/main/discoverCandidates.test.ts` (reuse its existing db-fixture helper; the one below assumes a `Database` import and a helper that creates `Riffs`/`Stems` tables — read the file and match what is there):

```ts
  describe('appendToInMemoryDiscoverCaches', () => {
    it('adds a stem to an already-built riff index without rebuilding it', async () => {
      const db = new Database(':memory:')
      db.exec(`
        CREATE TABLE Riffs (
          RiffCID TEXT PRIMARY KEY, OwnerJamCID TEXT, BPMrnd REAL, CreationTime INTEGER,
          StemCID_1 TEXT, StemCID_2 TEXT, StemCID_3 TEXT, StemCID_4 TEXT,
          StemCID_5 TEXT, StemCID_6 TEXT, StemCID_7 TEXT, StemCID_8 TEXT
        );
        CREATE TABLE Stems (StemCID TEXT PRIMARY KEY, Instrument INTEGER, OwnerJamCID TEXT);
      `)
      db.prepare(
        `INSERT INTO Riffs (RiffCID, OwnerJamCID, BPMrnd, CreationTime, StemCID_1)
         VALUES ('r1', 'j1', 120, 10, 's1')`
      ).run()
      const first = await getRiffIndexForDb(db)
      expect(first.size).toBe(1)

      db.prepare(
        `INSERT INTO Riffs (RiffCID, OwnerJamCID, BPMrnd, CreationTime, StemCID_1)
         VALUES ('r2', 'discovered', 140, 20, 's2')`
      ).run()
      appendToInMemoryDiscoverCaches(
        db,
        [
          {
            stemCID: 's2',
            entry: { riffCID: 'r2', ownerJamCID: 'discovered', bpmRnd: 140, creationTime: 20 }
          }
        ],
        []
      )
      const second = await getRiffIndexForDb(db)
      expect(second).toBe(first)
      expect(second.get('s2')?.riffCID).toBe('r2')
      db.close()
    })

    it('is a no-op for a db whose caches were never built', () => {
      const db = new Database(':memory:')
      db.exec(`CREATE TABLE Riffs (RiffCID TEXT PRIMARY KEY); CREATE TABLE Stems (StemCID TEXT);`)
      expect(() =>
        appendToInMemoryDiscoverCaches(
          db,
          [{ stemCID: 's1', entry: { riffCID: 'r', ownerJamCID: 'j', bpmRnd: 1, creationTime: 1 } }],
          []
        )
      ).not.toThrow()
      db.close()
    })
  })
```

Add `appendToInMemoryDiscoverCaches` (and `getRiffIndexForDb`, if not already imported) to that file's import from `./discoverCandidates`.

- [ ] **Step 6: Run it and watch it fail**

Run: `npx vitest run src/main/discoverCandidates.test.ts -t 'appendToInMemoryDiscoverCaches'`
Expected: FAIL — `appendToInMemoryDiscoverCaches is not a function`.

- [ ] **Step 7: Implement the in-memory half**

Append to `src/main/discoverCandidates.ts` (anywhere after `instrumentRowsCache`'s declaration, since it reads both WeakMaps):

```ts
/** Folds one just-committed riff into the IN-MEMORY caches, instead of
 * letting the write invalidate them.
 *
 * discoverIndexCache.ts's appendRiffIndexRows/appendInstrumentRows handle
 * the persisted half (read at startup). This is the half that matters
 * during a session: riffIndexCache/instrumentRowsCache are re-validated by
 * isScanCacheCurrent against a live TableSignal at most every
 * CACHE_CHANGE_CHECK_INTERVAL_MS (30s), so without this a keep makes the
 * next roll within half a minute pay a full rebuild of the own db's index
 * -- exactly the roll/keep/roll loop this is for.
 *
 * MUST BE CALLED AFTER THE TRANSACTION COMMITS. It refreshes each cache's
 * stored signal by re-reading the table, which has to see the new counts;
 * called inside the transaction it would record a stale signal and the
 * very next check would invalidate anyway.
 *
 * A stem already in the index keeps whichever riff it was first seen in --
 * the same first-seen-wins rule buildRiffIndex uses. `instrumentRows`
 * should carry ONLY stems that genuinely got a new Stems row (the caller
 * knows which; this does no dedup of its own, deliberately, so a keep
 * never scans a 367k-row array). A db whose caches were never built is
 * left alone: there is nothing to keep current. */
export function appendToInMemoryDiscoverCaches(
  db: Database.Database,
  riffEntries: readonly { stemCID: string; entry: RiffIndexEntry }[],
  instrumentRows: readonly { StemCID: string; Instrument: number | null; OwnerJamCID: string }[]
): void {
  const now = Date.now()
  const riffCached = riffIndexCache.get(db)
  if (riffCached) {
    for (const { stemCID, entry } of riffEntries) {
      if (!riffCached.index.has(stemCID)) riffCached.index.set(stemCID, entry)
    }
    riffCached.state.signal = readTableSignal(db, 'Riffs')
    riffCached.state.checkedAt = now
  }
  const stemCached = instrumentRowsCache.get(db)
  if (stemCached) {
    for (const row of instrumentRows) stemCached.rows.push(row)
    stemCached.state.signal = readTableSignal(db, 'Stems')
    stemCached.state.checkedAt = now
  }
}
```

- [ ] **Step 8: Run it and watch it pass**

Run: `npx vitest run src/main/discoverCandidates.test.ts src/main/discoverIndexCache.test.ts`
Expected: PASS, both files.

- [ ] **Step 9: Commit**

```bash
npm run typecheck
git add src/main/discoverIndexCache.ts src/main/discoverIndexCache.test.ts src/main/discoverCandidates.ts src/main/discoverCandidates.test.ts
git commit -m "A keep adds to the index instead of throwing it away

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

---

## Task 5: The save itself

**Files:**
- Create: `src/main/discoveredLibrary.ts`
- Test: `src/main/discoveredLibrary.test.ts`
- Modify: `vitest.config.ts`

- [ ] **Step 1: Write the failing test**

Create `src/main/discoveredLibrary.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let userDataDir: string

vi.mock('electron', () => ({
  app: {
    getPath: () => userDataDir
  }
}))

/** The subset of riffLibrarySchema.ts's SCHEMA_SQL these tests actually
 * touch -- same convention as riffLibraryWriter.test.ts, which duplicates
 * the DDL rather than opening the real db. */
function freshOwnDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE Jams (JamCID TEXT PRIMARY KEY, PublicName TEXT NOT NULL, SyncComplete INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE Riffs (
      RiffCID TEXT PRIMARY KEY, OwnerJamCID TEXT NOT NULL, CreationTime INTEGER,
      Root INTEGER, Scale INTEGER, BPMrnd REAL, BarLength INTEGER, UserName TEXT,
      StemCID_1 TEXT, StemCID_2 TEXT, StemCID_3 TEXT, StemCID_4 TEXT,
      StemCID_5 TEXT, StemCID_6 TEXT, StemCID_7 TEXT, StemCID_8 TEXT,
      GainsJSON TEXT, AppVersion INTEGER
    );
    CREATE TABLE Stems (
      StemCID TEXT PRIMARY KEY, OwnerJamCID TEXT NOT NULL, CreationTime INTEGER,
      FileEndpoint TEXT, FileBucket TEXT, FileKey TEXT, BPMrnd REAL, Instrument INTEGER,
      Length16s REAL, PresetName TEXT, CreatorUserName TEXT
    );
    CREATE TABLE DiscoverRiffIndexCache (
      SourceDbKey TEXT NOT NULL, StemCID TEXT NOT NULL, RiffCID TEXT NOT NULL,
      OwnerJamCID TEXT NOT NULL, BPMrnd REAL NOT NULL, CreationTime INTEGER,
      PRIMARY KEY (SourceDbKey, StemCID)
    );
    CREATE TABLE DiscoverRiffIndexCacheMeta (
      SourceDbKey TEXT PRIMARY KEY, RiffCount INTEGER NOT NULL, ComputedAt INTEGER NOT NULL
    );
    CREATE TABLE DiscoverInstrumentRowsCache (
      SourceDbKey TEXT NOT NULL, StemCID TEXT NOT NULL, Instrument INTEGER,
      OwnerJamCID TEXT NOT NULL, PRIMARY KEY (SourceDbKey, StemCID)
    );
    CREATE TABLE DiscoverInstrumentRowsCacheMeta (
      SourceDbKey TEXT PRIMARY KEY, StemCount INTEGER NOT NULL, ComputedAt INTEGER NOT NULL
    );
  `)
  return db
}

/** A real cached stem file whose basename IS its StemCID, the convention
 * stemCIDForPath depends on. */
function seedStemOnDisk(stemCID: string): string {
  const dir = join(userDataDir, 'source-stems')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, stemCID)
  writeFileSync(path, Buffer.from([1, 2, 3, 4]))
  return path
}

describe('discoveredLibrary', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'sssketch-discovered-test-'))
  })

  afterEach(async () => {
    const { setRiffLibraryRootForTests } = await import('./riffLibraryStore')
    setRiffLibraryRootForTests(null)
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('writes a Riffs row in the discovered room, with the jam created lazily', async () => {
    const { saveDiscoveredRifff } = await import('./discoveredLibrary')
    const db = freshOwnDb()
    db.prepare(
      `INSERT INTO Stems (StemCID, OwnerJamCID, Instrument, PresetName, CreatorUserName, BPMrnd, Length16s,
                          FileEndpoint, FileBucket, FileKey)
       VALUES ('aaa111', 'j1', 1, 'thud', 'elling', 120, 64, 'ep', 'bk', 'ky')`
    ).run()
    const path = seedStemOnDisk('aaa111')

    const result = saveDiscoveredRifff(db, [], {
      members: [
        { path, gain: 0.8, name: 'thud', author: 'elling', barLength: 1, durationSec: 2 }
      ],
      bpm: 140,
      barLength: 2,
      creationTime: 5000
    })

    expect(result?.duplicate).toBe(false)
    expect(result?.name).toContain(' library')
    const jam = db.prepare(`SELECT PublicName FROM Jams WHERE JamCID = 'discovered'`).get()
    expect(jam).toEqual({ PublicName: 'discovered' })
    const riff = db
      .prepare(
        `SELECT OwnerJamCID, BPMrnd, BarLength, UserName, Root, Scale, CreationTime, GainsJSON, StemCID_1
         FROM Riffs WHERE RiffCID = ?`
      )
      .get(result!.riffCID) as Record<string, unknown>
    expect(riff.OwnerJamCID).toBe('discovered')
    expect(riff.BPMrnd).toBe(140)
    expect(riff.BarLength).toBe(2)
    expect(riff.UserName).toBe('discovered')
    expect(riff.Root).toBe(null)
    expect(riff.Scale).toBe(null)
    expect(riff.CreationTime).toBe(5000)
    expect(riff.GainsJSON).toBe('{"1":0.8}')
    expect(riff.StemCID_1).toBe('aaa111')
    db.close()
  })

  it('copies the stem to the discovered path, keeping the StemCID as the basename', async () => {
    const { saveDiscoveredRifff } = await import('./discoveredLibrary')
    const { discoveredStemPath } = await import('./riffLibraryStore')
    const db = freshOwnDb()
    db.prepare(`INSERT INTO Stems (StemCID, OwnerJamCID) VALUES ('bbb222', 'j1')`).run()
    const path = seedStemOnDisk('bbb222')

    saveDiscoveredRifff(db, [], {
      members: [{ path, gain: 1, name: 'n', author: 'a', barLength: 1, durationSec: 1 }],
      bpm: 120,
      barLength: 1,
      creationTime: 1
    })

    expect(existsSync(discoveredStemPath('bbb222'))).toBe(true)
    db.close()
  })

  it('does not null out a real synced stem download columns', async () => {
    const { saveDiscoveredRifff } = await import('./discoveredLibrary')
    const db = freshOwnDb()
    db.prepare(
      `INSERT INTO Stems (StemCID, OwnerJamCID, FileEndpoint, FileBucket, FileKey)
       VALUES ('ccc333', 'j1', 'ams3.example', 'endlesss', 'attachments/ccc333.ogg')`
    ).run()
    const path = seedStemOnDisk('ccc333')

    saveDiscoveredRifff(db, [], {
      members: [{ path, gain: 1, name: 'n', author: 'a', barLength: 1, durationSec: 1 }],
      bpm: 120,
      barLength: 1,
      creationTime: 1
    })

    const row = db
      .prepare(`SELECT FileEndpoint, FileBucket, FileKey FROM Stems WHERE StemCID = 'ccc333'`)
      .get()
    expect(row).toEqual({
      FileEndpoint: 'ams3.example',
      FileBucket: 'endlesss',
      FileKey: 'attachments/ccc333.ogg'
    })
    db.close()
  })

  it('reports a duplicate without writing a second row', async () => {
    const { saveDiscoveredRifff } = await import('./discoveredLibrary')
    const db = freshOwnDb()
    db.prepare(`INSERT INTO Stems (StemCID, OwnerJamCID) VALUES ('d1', 'j1')`).run()
    db.prepare(`INSERT INTO Stems (StemCID, OwnerJamCID) VALUES ('d2', 'j1')`).run()
    const p1 = seedStemOnDisk('d1')
    const p2 = seedStemOnDisk('d2')
    const input = (order: string[]): Parameters<typeof saveDiscoveredRifff>[2] => ({
      members: order.map((p, i) => ({
        path: p,
        gain: i === 0 ? 0.3 : 0.9,
        name: 'n',
        author: 'a',
        barLength: 1,
        durationSec: 1
      })),
      bpm: 120,
      barLength: 1,
      creationTime: 1
    })

    const first = saveDiscoveredRifff(db, [], input([p1, p2]))
    const second = saveDiscoveredRifff(db, [], input([p2, p1]))

    expect(second?.duplicate).toBe(true)
    expect(second?.riffCID).toBe(first!.riffCID)
    const { n } = db
      .prepare(`SELECT COUNT(*) AS n FROM Riffs WHERE OwnerJamCID = 'discovered'`)
      .get() as { n: number }
    expect(n).toBe(1)
    db.close()
  })

  it('mints a StemCID and a real Stems row for a path with no library stem behind it', async () => {
    const { saveDiscoveredRifff } = await import('./discoveredLibrary')
    const db = freshOwnDb()
    const dir = join(userDataDir, 'dropped')
    mkdirSync(dir, { recursive: true })
    const path = join(dir, 'my-loop.wav')
    writeFileSync(path, Buffer.from([9, 9]))

    const result = saveDiscoveredRifff(db, [], {
      members: [{ path, gain: 1, name: 'my loop', author: 'me', barLength: 1, durationSec: 1 }],
      bpm: 120,
      barLength: 1,
      creationTime: 1
    })

    const riff = db
      .prepare(`SELECT StemCID_1 FROM Riffs WHERE RiffCID = ?`)
      .get(result!.riffCID) as { StemCID_1: string }
    expect(riff.StemCID_1.startsWith('discovered-')).toBe(true)
    const stem = db.prepare(`SELECT OwnerJamCID FROM Stems WHERE StemCID = ?`).get(riff.StemCID_1)
    expect(stem).toEqual({ OwnerJamCID: 'discovered' })
    db.close()
  })

  it('appends to the persisted discover caches instead of moving them out of date', async () => {
    const { saveDiscoveredRifff } = await import('./discoveredLibrary')
    const { getCachedRiffCount, getCachedStemCount } = await import('./discoverIndexCache')
    const db = freshOwnDb()
    db.prepare(`INSERT INTO Stems (StemCID, OwnerJamCID, Instrument) VALUES ('e1', 'j1', 1)`).run()
    const path = seedStemOnDisk('e1')
    db.prepare(
      `INSERT INTO DiscoverRiffIndexCacheMeta (SourceDbKey, RiffCount, ComputedAt) VALUES (?, 0, 1)`
    ).run(db.name)
    db.prepare(
      `INSERT INTO DiscoverInstrumentRowsCacheMeta (SourceDbKey, StemCount, ComputedAt) VALUES (?, 1, 1)`
    ).run(db.name)

    const result = saveDiscoveredRifff(db, [], {
      members: [{ path, gain: 1, name: 'n', author: 'a', barLength: 1, durationSec: 1 }],
      bpm: 120,
      barLength: 1,
      creationTime: 1
    })

    expect(getCachedRiffCount(db, db.name)).toBe(1)
    expect(getCachedStemCount(db, db.name)).toBe(1)
    const cached = db
      .prepare(`SELECT RiffCID FROM DiscoverRiffIndexCache WHERE StemCID = 'e1'`)
      .get() as { RiffCID: string }
    expect(cached.RiffCID).toBe(result!.riffCID)
    db.close()
  })

  it('reports the rows the caller must fold into the in-memory caches', async () => {
    const { saveDiscoveredRifff } = await import('./discoveredLibrary')
    const db = freshOwnDb()
    db.prepare(`INSERT INTO Stems (StemCID, OwnerJamCID, Instrument) VALUES ('h1', 'j1', 2)`).run()
    const path = seedStemOnDisk('h1')
    const result = saveDiscoveredRifff(db, [], {
      members: [{ path, gain: 1, name: 'n', author: 'a', barLength: 1, durationSec: 1 }],
      bpm: 120,
      barLength: 1,
      creationTime: 7
    })
    expect(result?.indexRows).toEqual([
      {
        stemCID: 'h1',
        entry: { riffCID: result!.riffCID, ownerJamCID: 'discovered', bpmRnd: 120, creationTime: 7 }
      }
    ])
    // h1 already had a Stems row in the own db, so it is NOT a new
    // instrument row -- that is the point of this assertion.
    expect(result?.newInstrumentRows).toEqual([])
    db.close()
  })

  it('forget deletes the riff row and the copy no other kept group still uses', async () => {
    const { saveDiscoveredRifff, forgetDiscoveredRifff } = await import('./discoveredLibrary')
    const { discoveredStemPath } = await import('./riffLibraryStore')
    const db = freshOwnDb()
    db.prepare(`INSERT INTO Stems (StemCID, OwnerJamCID) VALUES ('f1', 'j1')`).run()
    db.prepare(`INSERT INTO Stems (StemCID, OwnerJamCID) VALUES ('f2', 'j1')`).run()
    const p1 = seedStemOnDisk('f1')
    const p2 = seedStemOnDisk('f2')
    const a = saveDiscoveredRifff(db, [], {
      members: [{ path: p1, gain: 1, name: 'n', author: 'a', barLength: 1, durationSec: 1 }],
      bpm: 120,
      barLength: 1,
      creationTime: 1
    })
    saveDiscoveredRifff(db, [], {
      members: [
        { path: p1, gain: 1, name: 'n', author: 'a', barLength: 1, durationSec: 1 },
        { path: p2, gain: 1, name: 'n', author: 'a', barLength: 1, durationSec: 1 }
      ],
      bpm: 120,
      barLength: 1,
      creationTime: 2
    })

    forgetDiscoveredRifff(db, a!.riffCID)

    expect(db.prepare(`SELECT 1 FROM Riffs WHERE RiffCID = ?`).get(a!.riffCID)).toBe(undefined)
    expect(existsSync(discoveredStemPath('f1'))).toBe(true)
    expect(db.prepare(`SELECT 1 FROM Stems WHERE StemCID = 'f1'`).get()).toEqual({ 1: 1 })
    db.close()
  })

  it('forget removes a copy nothing else references', async () => {
    const { saveDiscoveredRifff, forgetDiscoveredRifff } = await import('./discoveredLibrary')
    const { discoveredStemPath } = await import('./riffLibraryStore')
    const db = freshOwnDb()
    db.prepare(`INSERT INTO Stems (StemCID, OwnerJamCID) VALUES ('g1', 'j1')`).run()
    const path = seedStemOnDisk('g1')
    const a = saveDiscoveredRifff(db, [], {
      members: [{ path, gain: 1, name: 'n', author: 'a', barLength: 1, durationSec: 1 }],
      bpm: 120,
      barLength: 1,
      creationTime: 1
    })

    forgetDiscoveredRifff(db, a!.riffCID)

    expect(existsSync(discoveredStemPath('g1'))).toBe(false)
    db.close()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/main/discoveredLibrary.test.ts`
Expected: FAIL — `Failed to resolve import "./discoveredLibrary"`.

- [ ] **Step 3: Write the implementation**

Create `src/main/discoveredLibrary.ts`:

```ts
// src/main/discoveredLibrary.ts
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { RiffLibraryResolvedRiff, RiffLibraryResolvedStem } from '@shared/riffLibraryTypes'
import {
  DISCOVERED_JAM_CID,
  DISCOVERED_USER_NAME,
  findDuplicateDiscoveredGroup
} from '@shared/discoveredRoom'
import { friendlyRiffName } from '@shared/friendlyRiffName'
import { discoveredStemPath } from './riffLibraryStore'
import { stemCIDForPath } from './stemCategoriesStore'
import { upsertJam, writeRiffDetail } from './riffLibraryWriter'
import { appendInstrumentRows, appendRiffIndexRows } from './discoverIndexCache'

/** One slot as the renderer sends it. Paths only -- resolveDiscoverRifff's
 * own ResolvedCandidateStems have already thrown away stemCID/riffCID, and
 * that is fine: main recovers identity from the path via stemCIDForPath,
 * the same function every cache read already uses. */
export interface DiscoveredMemberInput {
  path: string
  /** 0-1, already forced to 0 for a slot muted in Discover's preview mix --
   * a muted stem is saved as SILENCE, still there, still un-muteable later. */
  gain: number
  name: string
  author: string
  barLength: number
  durationSec: number
}

export interface SaveDiscoveredInput {
  members: DiscoveredMemberInput[]
  bpm: number
  barLength: number
  /** Unix seconds -- when he KEPT it, not the source riffs' own times.
   * Browse groups by day, and "today" is the true answer for a thing
   * discovered today. */
  creationTime: number
}

export interface SaveDiscoveredResult {
  riffCID: string
  name: string
  duplicate: boolean
  /** Everything the CALLER needs to fold this save into
   * discoverCandidates.ts's IN-MEMORY caches once the transaction has
   * committed. Returned rather than applied here because
   * appendToInMemoryDiscoverCaches re-reads the tables' change signals and
   * has to see post-commit counts. Both empty for a duplicate, which wrote
   * nothing. */
  indexRows: {
    stemCID: string
    entry: { riffCID: string; ownerJamCID: string; bpmRnd: number; creationTime: number | null }
  }[]
  newInstrumentRows: { StemCID: string; Instrument: number | null; OwnerJamCID: string }[]
}

interface SourceStemRow {
  StemCID: string
  CreatorUserName: string | null
  PresetName: string | null
  Instrument: number | null
  BPMrnd: number | null
  Length16s: number | null
  FileEndpoint: string | null
  FileBucket: string | null
  FileKey: string | null
}

const STEM_SLOT_COLUMNS = Array.from({ length: 8 }, (_, i) => `StemCID_${i + 1}`)

/** Every kept group in the room, as {riffCID, stemCIDs} -- ONE query over
 * the whole room, never a per-stem lookup. Both the duplicate check and
 * forget's "is this copy still needed" test read this same list. At a
 * realistic few hundred saved groups it is free. */
export function listDiscoveredGroups(
  ownDb: Database.Database
): { riffCID: string; stemCIDs: string[] }[] {
  const rows = ownDb
    .prepare(
      `SELECT RiffCID, ${STEM_SLOT_COLUMNS.join(', ')} FROM Riffs WHERE OwnerJamCID = ?`
    )
    .all(DISCOVERED_JAM_CID) as Record<string, string | null>[]
  return rows.map((row) => ({
    riffCID: row.RiffCID as string,
    stemCIDs: STEM_SLOT_COLUMNS.map((c) => row[c]).filter((c): c is string => Boolean(c))
  }))
}

function findSourceStemRow(
  dbs: Database.Database[],
  stemCID: string
): SourceStemRow | undefined {
  for (const db of dbs) {
    const row = db
      .prepare(
        `SELECT StemCID, CreatorUserName, PresetName, Instrument, BPMrnd, Length16s,
                FileEndpoint, FileBucket, FileKey
         FROM Stems WHERE StemCID = ?`
      )
      .get(stemCID) as SourceStemRow | undefined
    if (row) return row
  }
  return undefined
}

/** Saves whatever loop Discover currently has as a real rifff in the
 * `discovered` room.
 *
 * `ownDb` is sssketch's own WRITABLE warehouse (openOwnRiffLibraryDb); it
 * is also where the Stems rows and the Discover cache tables live.
 * `browseDbs` are the extra databases a stem's row might live in instead
 * (candidateDbsForRiff -- typically an external LORE archive), checked
 * after ownDb, read-only.
 *
 * Returns null only when there is nothing placeable to save.
 *
 * A duplicate -- the same SET of StemCIDs, unordered, ignoring gain -- is a
 * no-op that says so: nothing is written, not a second row and not a
 * silent bump of the original's timestamp, and the caller is told.
 *
 * Files are copied BEFORE the transaction, on purpose: the filesystem is
 * not transactional, and an orphaned copy is harmless where a Riffs row
 * pointing at a missing file renders as a permanently uncached circle.
 *
 * Everything that writes is inside ONE ownDb.transaction -- the Jams
 * upsert, writeRiffDetail (whose own db.transaction nests as a SAVEPOINT),
 * and both Discover index-cache appends. The in-memory cache append is
 * deliberately left to the caller AFTER this returns, because it has to
 * read post-commit table signals (see appendToInMemoryDiscoverCaches). */
export function saveDiscoveredRifff(
  ownDb: Database.Database,
  browseDbs: Database.Database[],
  input: SaveDiscoveredInput
): SaveDiscoveredResult | null {
  if (input.members.length === 0) return null

  // Eight point lookups on an explicit, human-initiated action -- not a
  // batch path. A path with no real Stems row behind it (a shelf-seeded
  // slot, a wav dropped on the panel, an in-app recording) gets a freshly
  // minted StemCID and a real Stems row of its own, so save is TOTAL: it
  // never refuses and never silently drops a slot. Such a stem loses its
  // old analysis (new id, cold caches) and re-saving the same dropped wav
  // makes a second copy -- accepted; those slots are rare in the loop this
  // is for.
  const resolved = input.members.map((member) => {
    const stemCID = stemCIDForPath(ownDb, member.path, browseDbs)
    return {
      member,
      stemCID: stemCID ?? `discovered-${randomUUID()}`,
      minted: stemCID === null
    }
  })

  const duplicateOf = findDuplicateDiscoveredGroup(
    listDiscoveredGroups(ownDb),
    resolved.map((r) => r.stemCID)
  )
  if (duplicateOf !== null) {
    return {
      riffCID: duplicateOf,
      name: friendlyRiffName(duplicateOf, 'library'),
      duplicate: true,
      indexRows: [],
      newInstrumentRows: []
    }
  }

  const riffCID = `discovered-${randomUUID()}`

  for (const { member, stemCID } of resolved) {
    const destination = discoveredStemPath(stemCID)
    if (existsSync(destination)) continue
    mkdirSync(dirname(destination), { recursive: true })
    copyFileSync(member.path, destination)
  }

  const knownStemCIDs = new Set(
    (
      ownDb
        .prepare(
          `SELECT StemCID FROM Stems WHERE StemCID IN (${resolved.map(() => '?').join(',')})`
        )
        .all(...resolved.map((r) => r.stemCID)) as { StemCID: string }[]
    ).map((r) => r.StemCID)
  )

  const stems: RiffLibraryResolvedStem[] = resolved.map(({ member, stemCID }, index) => {
    const source = findSourceStemRow([ownDb, ...browseDbs], stemCID)
    return {
      stemCID,
      slot: index + 1,
      path: discoveredStemPath(stemCID),
      gain: member.gain,
      creatorUserName: source?.CreatorUserName ?? member.author,
      presetName: source?.PresetName ?? member.name,
      instrumentMask: source?.Instrument ?? 0,
      durationSec: member.durationSec,
      barLength: member.barLength,
      bpm: source?.BPMrnd ?? input.bpm,
      // Carried through so writeRiffDetail's unconditional
      // UPDATE Stems SET FileEndpoint/FileBucket/FileKey does not null out
      // a real synced stem's download columns -- see riffLibraryStore.ts's
      // buildResolvedRiff, fixed for the same reason.
      fileEndpoint: source?.FileEndpoint ?? undefined,
      fileBucket: source?.FileBucket ?? undefined,
      fileKey: source?.FileKey ?? undefined,
      downloadUrl: null
    }
  })

  // Root/Scale stay NULL, deliberately: a collage of stems from different
  // jams has no honest key, and the Inspector already handles an absent one.
  const riff: RiffLibraryResolvedRiff = {
    riffCID,
    bpm: input.bpm,
    barLength: input.barLength,
    creationTime: input.creationTime,
    stems
  }

  const sourceDbKey = ownDb.name
  const newStemRows = resolved.filter((r) => !knownStemCIDs.has(r.stemCID))
  const indexRows = stems.map((stem) => ({
    stemCID: stem.stemCID,
    entry: {
      riffCID,
      ownerJamCID: DISCOVERED_JAM_CID,
      bpmRnd: input.bpm,
      creationTime: input.creationTime as number | null
    }
  }))
  const newInstrumentRows = newStemRows.map(({ stemCID }) => ({
    StemCID: stemCID,
    Instrument: stems.find((s) => s.stemCID === stemCID)?.instrumentMask ?? null,
    OwnerJamCID: DISCOVERED_JAM_CID
  }))

  ownDb.transaction(() => {
    upsertJam(ownDb, DISCOVERED_JAM_CID, DISCOVERED_JAM_CID)
    writeRiffDetail(
      ownDb,
      DISCOVERED_JAM_CID,
      { creationTime: input.creationTime, userName: DISCOVERED_USER_NAME },
      riff
    )
    appendRiffIndexRows(
      ownDb,
      sourceDbKey,
      indexRows.map((row) => ({ stemCID: row.stemCID, ...row.entry })),
      1
    )
    appendInstrumentRows(ownDb, sourceDbKey, newInstrumentRows, newInstrumentRows.length)
  })()

  return {
    riffCID,
    name: friendlyRiffName(riffCID, 'library'),
    duplicate: false,
    indexRows,
    newInstrumentRows
  }
}

/** Deletes one kept group: its Riffs row, plus any copied stem file that no
 * OTHER kept group still references (computed in JS from
 * listDiscoveredGroups' single query -- no per-stem query).
 *
 * Never deletes a Stems row and never touches StemCategories /
 * StemFeatureCache / StemPeaksCache / StemEmbeddingCache / StemAutoCategory
 * / StemFavourite: those are keyed by StemCID and are still true about the
 * stem, wherever else it lives.
 *
 * Deliberately does NOT touch the Discover index caches. Deleting a Riffs
 * row moves the count they are validated against, so within
 * CACHE_CHANGE_CHECK_INTERVAL_MS the own db's in-memory index rebuilds
 * once. Forgetting is not in the roll/keep loop, and a symmetric delete
 * would have to decide what to do about a stem the index maps to this riff
 * but that other riffs also contain -- a correctness risk for no benefit
 * here. */
export function forgetDiscoveredRifff(ownDb: Database.Database, riffCID: string): void {
  const groups = listDiscoveredGroups(ownDb)
  const target = groups.find((g) => g.riffCID === riffCID)
  if (!target) return
  const stillUsed = new Set<string>()
  for (const group of groups) {
    if (group.riffCID === riffCID) continue
    for (const stemCID of group.stemCIDs) stillUsed.add(stemCID)
  }

  ownDb.transaction(() => {
    ownDb.prepare(`DELETE FROM Riffs WHERE RiffCID = ? AND OwnerJamCID = ?`).run(
      riffCID,
      DISCOVERED_JAM_CID
    )
    ownDb.prepare(`DELETE FROM Tags WHERE RiffCID = ?`).run(riffCID)
  })()

  for (const stemCID of target.stemCIDs) {
    if (stillUsed.has(stemCID)) continue
    rmSync(discoveredStemPath(stemCID), { force: true })
  }
}
```

**Note on the `Tags` delete:** the test schema above has no `Tags` table. Either add `CREATE TABLE Tags (RiffCID TEXT PRIMARY KEY, OwnerJamCID TEXT, Favour INTEGER, Note TEXT);` to `freshOwnDb()` (preferred — it matches the real schema) or drop that line from `forgetDiscoveredRifff`. Add the table; a kept group can be favourited today via the existing `Tags.Favour` path and its row should go with it.

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/main/discoveredLibrary.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: ADD THE NEW TEST FILE TO THE CI EXCLUSION LIST**

**Do not skip this and do not leave it to the end.** `src/main/discoveredLibrary.test.ts` opens better-sqlite3, and on GitHub's macOS runners that crashes the vitest worker before a single test runs — a non-zero exit with zero failed tests, which is exactly what made v1.2.0 unshippable (see `vitest.config.ts`'s own comment and commit `db302ba`).

In `vitest.config.ts`, add one line to the `exclude` array, keeping it alphabetical among its neighbours — between `'src/main/discoverCandidates.test.ts',` and `'src/main/discoverIndexCache.test.ts',`:

```ts
          'src/main/discoveredLibrary.test.ts',
```

Verify it is actually excluded:

```bash
CI=1 npx vitest run src/main/discoveredLibrary.test.ts
```

Expected: `No test files found` / a pass with 0 files (the config sets `passWithNoTests: true`), NOT 9 passing tests.

- [ ] **Step 6: Commit**

```bash
npm run typecheck
git add src/main/discoveredLibrary.ts src/main/discoveredLibrary.test.ts vitest.config.ts
git commit -m "Keeping a group writes a rifff, copies its stems, and keeps the index warm

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

---

## Task 6: The IPC surface

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`

No tests: this layer is two thin pass-throughs over already-tested functions, and this codebase does not test `ipcMain.handle` wiring directly.

- [ ] **Step 1: Add the main-process handlers**

In `src/main/index.ts`, add to the imports:

```ts
import {
  forgetDiscoveredRifff,
  saveDiscoveredRifff,
  type DiscoveredMemberInput
} from './discoveredLibrary'
import { appendToInMemoryDiscoverCaches } from './discoverCandidates'
```

(`openOwnRiffLibraryDb` and `candidateDbsForRiff` are already imported — check before adding.)

Add these handlers immediately after the existing `ipcMain.handle('riff-library-download-missing-stems', …)` block:

```ts
  // One explicit, human-initiated save. Eight stemCIDForPath point lookups
  // is not what CLAUDE.md's "never one query per stem" rule is about;
  // everything that WRITES inside saveDiscoveredRifff is one transaction.
  ipcMain.handle(
    'save-discovered-rifff',
    (_event, members: DiscoveredMemberInput[], bpm: number, barLength: number) => {
      const ownDb = openOwnRiffLibraryDb()
      const result = saveDiscoveredRifff(ownDb, candidateDbsForRiff(), {
        members,
        bpm,
        barLength,
        creationTime: Math.floor(Date.now() / 1000)
      })
      // AFTER the commit, never inside it -- appendToInMemoryDiscoverCaches
      // re-reads the table signals the in-memory caches are validated
      // against, and those have to see the new counts. saveDiscoveredRifff
      // hands back exactly the rows to fold in (indexRows /
      // newInstrumentRows) rather than this handler re-deriving StemCIDs it
      // does not have.
      if (result && !result.duplicate) {
        appendToInMemoryDiscoverCaches(ownDb, result.indexRows, result.newInstrumentRows)
      }
      return result
    }
  )

  ipcMain.handle('forget-discovered-rifff', (_event, riffCID: string) =>
    forgetDiscoveredRifff(openOwnRiffLibraryDb(), riffCID)
  )
```

`DISCOVERED_JAM_CID` is imported here for Task 8's renderer work only if `index.ts` needs it — it does not; drop that import from the list above if nothing in `index.ts` references it, rather than leaving an unused import for lint to catch.

- [ ] **Step 2: Add the preload bridge**

In `src/preload/index.ts`, add immediately after `riffLibraryDownloadMissingStems`:

```ts
  saveDiscoveredRifff: (
    members: {
      path: string
      gain: number
      name: string
      author: string
      barLength: number
      durationSec: number
    }[],
    bpm: number,
    barLength: number
  ): Promise<{ riffCID: string; name: string; duplicate: boolean } | null> =>
    ipcRenderer.invoke('save-discovered-rifff', members, bpm, barLength),
  forgetDiscoveredRifff: (riffCID: string): Promise<void> =>
    ipcRenderer.invoke('forget-discovered-rifff', riffCID),
```

The renderer never needs `indexRows`/`newInstrumentRows`; the narrower preload return type is deliberate.

- [ ] **Step 3: Verify**

```bash
npx vitest run src/main/discoveredLibrary.test.ts
npm run typecheck
npm run lint
```

Expected: 9 tests still pass, 0 typecheck errors, 0 lint errors + the 4 pre-existing prettier warnings.

- [ ] **Step 4: Commit**

```bash
git add src/main/index.ts src/preload/index.ts
git commit -m "Two channels: keep a group, forget a group

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

---

## Task 7: The `keep` button

**No component test** — React components are not unit-tested in this codebase (Finding 14). Verified by typecheck + lint, then by Elling.

**Files:**
- Modify: `src/renderer/src/components/DiscoverPanel.tsx`

- [ ] **Step 1: Add the state**

Beside the existing `const [justAddedToShelf, setJustAddedToShelf] = useState(false)` (~line 1111):

```ts
  // `keep` is not `add to shelf`. Shelf is "I am using this now"; keep is
  // "I found this, do not lose it." Both can be true, and both buttons
  // stay. One label covers both outcomes: a duplicate save is a no-op that
  // SAYS so rather than leaving him guessing whether it worked.
  const [keeping, setKeeping] = useState(false)
  const [keptLabel, setKeptLabel] = useState<string | null>(null)
```

- [ ] **Step 2: Add the action**

Immediately after the existing `addToShelf` function (~line 2085), add:

```ts
  // Reuses resolveDiscoverRifff() verbatim -- the same helper addToTimeline
  // and addToShelf already share, which is what carries one non-obvious
  // inherited behaviour worth keeping: a slot muted in the preview mix is
  // placed at gain 0, not dropped, so a muted stem is saved as silence,
  // still there, still un-muteable later.
  async function keepGroup(): Promise<void> {
    setKeeping(true)
    try {
      const assembly = await resolveDiscoverRifff()
      if (!assembly) return
      const { rifff, vol } = assembly
      const members = rifff.stems.map((stem) => ({
        path: stem.path,
        gain: vol[stemKey(rifff.groupId, stem.slot)] ?? 1,
        name: stem.name,
        author: stem.author,
        barLength: stem.barLength,
        durationSec: stem.durationSec
      }))
      const saved = await window.rifffApi.saveDiscoveredRifff(members, bpm, rifff.barLength)
      if (!saved) return
      setKeptLabel(saved.duplicate ? 'already kept' : '✓ kept')
      window.setTimeout(() => setKeptLabel(null), 500)
    } finally {
      setKeeping(false)
    }
  }
```

`stemKey` comes from `@shared/types` — add it to the existing import from that module at the top of the file if it is not already there.

- [ ] **Step 3: Add the button**

In the actions row, immediately BEFORE the `add to shelf` button (~line 2412), add:

```tsx
        <button
          onClick={() => void keepGroup()}
          disabled={keeping}
          data-tooltip="keep this group"
          style={{
            fontFamily: 'inherit',
            fontSize: 10,
            padding: '6px 14px',
            background: 'transparent',
            border: '1px solid var(--ra-border-strong)',
            color: keeping ? 'var(--ra-text-4)' : 'var(--ra-text)',
            cursor: keeping ? 'default' : 'pointer',
            animation: keptLabel !== null ? 'discover-add-pulse 500ms ease-out' : undefined
          }}
        >
          {keeping ? 'keeping…' : (keptLabel ?? 'keep')}
        </button>
```

Tooltip is three words, lowercase, no emoji, no exclamation mark, `data-tooltip` only (never alongside `title`), no `border-radius`, and it reuses the existing `discover-add-pulse` animation rather than inventing a second one.

- [ ] **Step 4: Verify**

```bash
npm run typecheck
npm run lint
```

Expected: 0 errors, 0 new warnings.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/DiscoverPanel.tsx
git commit -m "A button that says do not lose this one

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

---

## Task 8: The room in Browse

**No component test.** Three suppressions and one menu.

**Files:**
- Modify: `src/renderer/src/components/LibraryBrowser.tsx`

- [ ] **Step 1: Import the constant**

Add to the imports at the top:

```ts
import { DISCOVERED_JAM_CID } from '@shared/discoveredRoom'
```

- [ ] **Step 2: Pin the room to the very top of the sidebar**

Replace the body of the `sidebarJams` `useMemo` (~line 527):

```ts
  const sidebarJams = useMemo(() => {
    // The discovered room goes above everything, including a jam that is
    // actively syncing -- it is the room he opens most, and it has no
    // lastRiffTime story worth sorting on.
    const discovered: RiffLibraryJam[] = []
    const syncing: RiffLibraryJam[] = []
    const pinned: RiffLibraryJam[] = []
    const rest: RiffLibraryJam[] = []
    for (const jam of visibleJams) {
      if (jam.jamCID === DISCOVERED_JAM_CID) discovered.push(jam)
      else if (syncingKeys.has(syncKeyFor(jam.jamCID))) syncing.push(jam)
      else if (jam.jamCID.startsWith('shared:') || jam.jamCID === ownJam?.jamCID) pinned.push(jam)
      else rest.push(jam)
    }
    return [...discovered, ...syncing, ...pinned, ...rest]
  }, [visibleJams, syncingKeys, ownJam])
```

- [ ] **Step 3: Suppress `remove from sync` on the room's sidebar row**

In the sidebar row's `onContextMenu` (~line 1672), guard the open:

```tsx
                        onContextMenu={(e) => {
                          e.preventDefault()
                          // Nothing to remove from sync for a room the app
                          // built itself, and choosing it would delete his
                          // finds.
                          if (jam.jamCID === DISCOVERED_JAM_CID) return
                          setJamContextMenu({
                            x: e.clientX,
                            y: e.clientY,
                            jamCID: jam.jamCID,
                            jamName: jam.name
                          })
                        }}
```

- [ ] **Step 4: Suppress the sync button in the detail header**

At ~line 1739, change:

```tsx
                        {authStatus.loggedIn && (
```

to:

```tsx
                        {/* No sync control for the discovered room -- there is
                            no upstream to sync it with. */}
                        {authStatus.loggedIn && selectedJamCID !== DISCOVERED_JAM_CID && (
```

- [ ] **Step 5: Add `forget this`**

Add the state, beside `jamContextMenu`'s declaration (~line 248):

```ts
  // Right-click on a kept group's circle. Only ever opened in the
  // discovered room -- everywhere else right-click keeps toggling
  // favourite, as it always has.
  const [discoveredRiffMenu, setDiscoveredRiffMenu] = useState<{
    x: number
    y: number
    riffCID: string
  } | null>(null)
```

Add the handler, beside `handleRemoveJamSync` (~line 779):

```ts
  /** Right-click "forget this" on a kept group. Deletes the Riffs row and
   * any copied stem file no OTHER kept group still references; never a
   * Stems row, never StemCategories/StemFeatureCache -- those are keyed by
   * StemCID and are still true about the stem wherever else it lives. */
  async function handleForgetDiscovered(riffCID: string): Promise<void> {
    await window.rifffApi.forgetDiscoveredRifff(riffCID)
    setRiffRefreshToken((n) => n + 1)
  }
```

Change the `RiffCircle`'s `onContextMenu` (~line 2067):

```tsx
                                        onContextMenu={(e) => {
                                          e.preventDefault()
                                          if (selectedJamCID === DISCOVERED_JAM_CID) {
                                            setDiscoveredRiffMenu({
                                              x: e.clientX,
                                              y: e.clientY,
                                              riffCID: riff.riffCID
                                            })
                                            return
                                          }
                                          toggleRiffFavourite(riff.riffCID)
                                        }}
```

And render the menu beside the existing `{jamContextMenu && …}` block at the bottom of the component — inside the same stacking context, for the reason that block's own comment gives:

```tsx
      {discoveredRiffMenu && (
        <ContextMenu
          x={discoveredRiffMenu.x}
          y={discoveredRiffMenu.y}
          onClose={() => setDiscoveredRiffMenu(null)}
          items={[
            {
              label: 'forget this',
              danger: true,
              onClick: () => void handleForgetDiscovered(discoveredRiffMenu.riffCID)
            }
          ]}
        />
      )}
```

- [ ] **Step 6: Verify**

```bash
npm run typecheck
npm run lint
```

Expected: 0 errors, 0 new warnings.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/LibraryBrowser.tsx
git commit -m "The discovered room sits at the top and can be tidied

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

---

## Task 9: Part 1 gate — full verification

**This is the shippable point.** If the night ends here, the app is complete and better.

- [ ] **Step 1: Run everything**

```bash
npm test
npm run typecheck
npm run lint
```

Expected: **179 test files** locally (177 baseline + `src/shared/discoveredRoom.test.ts` + `src/main/discoveredLibrary.test.ts`), **2699 + your new tests** passing (roughly 2725), 0 typecheck errors, 0 lint errors and exactly the 4 pre-existing prettier warnings in unrelated files.

- [ ] **Step 2: Confirm the CI exclusion actually took**

```bash
CI=1 npm test 2>&1 | tail -20
```

Expected: a green run with a file count 27 lower than the local one (the 26 already-excluded files plus `discoveredLibrary`), and **no** `Worker exited unexpectedly`. If any worker dies, the file that killed it goes on the exclusion list before anything else happens.

- [ ] **Step 3: Confirm nothing reached the native engine**

```bash
git diff --stat 71364c7..HEAD -- native-engine/
```

Expected: empty output.

- [ ] **Step 4: Write down what only Elling can check**

State plainly, in the handoff, that the following were NOT verified and cannot be from here: whether `keep` is enjoyable; whether roll → keep → roll stays fast on the real 372k-riff library (the one performance claim in the spec that is a prediction, not a measurement); and whether the copies really survive removing a source jam from sync, which needs a real delete of real material and is the whole justification for copying.

---

# PART 2 — the phone remote, a side quest

Nothing below this line is required for Part 1 to ship.

## Task 10: Pairing, attempts, and the Host guard — as pure functions

**Files:**
- Create: `src/shared/remoteAuth.ts`
- Test: `src/shared/remoteAuth.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/shared/remoteAuth.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  REMOTE_MAX_PAIR_ATTEMPTS,
  REMOTE_PORT,
  codesMatch,
  isAllowedHost,
  newPairingCode,
  recordPairAttempt
} from './remoteAuth'

describe('remoteAuth', () => {
  it('uses the fixed port', () => {
    expect(REMOTE_PORT).toBe(7373)
  })

  it('generates a four-character code from an unambiguous alphabet', () => {
    const code = newPairingCode(() => 0)
    expect(code).toHaveLength(4)
    expect(code).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/)
  })

  it('generates different codes for different randomness', () => {
    expect(newPairingCode(() => 0)).not.toBe(newPairingCode(() => 0.99))
  })

  it('matches a code case-insensitively and ignoring surrounding space', () => {
    expect(codesMatch(' k7fd ', 'K7FD')).toBe(true)
    expect(codesMatch('k7fe', 'K7FD')).toBe(false)
  })

  it('never matches an empty entry against an empty expectation', () => {
    expect(codesMatch('', '')).toBe(false)
  })

  it('allows the expected host and nothing else', () => {
    expect(isAllowedHost('192.168.1.40:7373', '192.168.1.40:7373')).toBe(true)
    expect(isAllowedHost('evil.example.com', '192.168.1.40:7373')).toBe(false)
    expect(isAllowedHost(undefined, '192.168.1.40:7373')).toBe(false)
  })

  it('allows localhost on the same port, for the desktop own check', () => {
    expect(isAllowedHost('localhost:7373', '192.168.1.40:7373')).toBe(true)
    expect(isAllowedHost('127.0.0.1:7373', '192.168.1.40:7373')).toBe(true)
  })

  it('counts a wrong attempt and locks out on the fifth', () => {
    let gate = { attemptsUsed: 0, lockedOut: false }
    for (let i = 0; i < REMOTE_MAX_PAIR_ATTEMPTS - 1; i++) gate = recordPairAttempt(gate, false)
    expect(gate.lockedOut).toBe(false)
    gate = recordPairAttempt(gate, false)
    expect(gate.attemptsUsed).toBe(REMOTE_MAX_PAIR_ATTEMPTS)
    expect(gate.lockedOut).toBe(true)
  })

  it('a correct attempt resets the count and never locks out', () => {
    const gate = recordPairAttempt({ attemptsUsed: 3, lockedOut: false }, true)
    expect(gate).toEqual({ attemptsUsed: 0, lockedOut: false })
  })

  it('stays locked out once locked out, even on a correct code', () => {
    expect(recordPairAttempt({ attemptsUsed: 5, lockedOut: true }, true).lockedOut).toBe(true)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/shared/remoteAuth.test.ts`
Expected: FAIL — `Failed to resolve import "./remoteAuth"`.

- [ ] **Step 3: Write the implementation**

Create `src/shared/remoteAuth.ts`:

```ts
// src/shared/remoteAuth.ts

/** Fixed, so the URL he types once stays the URL forever. Bound to
 * 0.0.0.0 by the server -- it has to be, or the phone cannot reach it. */
export const REMOTE_PORT = 7373

/** Five wrong codes ends pairing for the session, and the desktop says so.
 * A 4-character code out of 32^4 is not brute-forceable in five tries, and
 * he will notice. */
export const REMOTE_MAX_PAIR_ATTEMPTS = 5

/** No 0/O/1/I/L -- this gets read off a screen across a room and typed on a
 * phone. 32 symbols, 4 characters, 1,048,576 codes. */
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'

/** A fresh pairing code, generated each time the server starts and shown on
 * the desktop. `random` is injected (not Math.random directly) so this is
 * testable without a seam in the caller. */
export function newPairingCode(random: () => number): string {
  let code = ''
  for (let i = 0; i < 4; i++) {
    code += CODE_ALPHABET[Math.min(CODE_ALPHABET.length - 1, Math.floor(random() * CODE_ALPHABET.length))]
  }
  return code
}

/** Case-insensitive and trimmed, because he is typing it on a phone. An
 * empty expectation never matches anything -- that state means "no code
 * has been generated", and it must not read as "everything is correct". */
export function codesMatch(entered: string, expected: string): boolean {
  const a = entered.trim().toUpperCase()
  const b = expected.trim().toUpperCase()
  return a.length > 0 && a === b
}

/** Rejects a request whose Host header is not the address this server is
 * actually reachable at -- three lines that close DNS rebinding from a
 * browser tab elsewhere on the network. Loopback on the same port is also
 * allowed, so the desktop can check its own server is up without the guard
 * refusing it. */
export function isAllowedHost(hostHeader: string | undefined, expectedHost: string): boolean {
  if (!hostHeader) return false
  const host = hostHeader.trim().toLowerCase()
  if (host === expectedHost.trim().toLowerCase()) return true
  const port = expectedHost.split(':')[1] ?? String(REMOTE_PORT)
  return host === `localhost:${port}` || host === `127.0.0.1:${port}`
}

export interface PairingGate {
  attemptsUsed: number
  lockedOut: boolean
}

/** The attempt limiter, as a pure transition so the server holds no logic
 * of its own. Once locked out, always locked out for this session -- a
 * correct code afterwards must not reopen it, or the limit means nothing. */
export function recordPairAttempt(gate: PairingGate, correct: boolean): PairingGate {
  if (gate.lockedOut) return gate
  if (correct) return { attemptsUsed: 0, lockedOut: false }
  const attemptsUsed = gate.attemptsUsed + 1
  return { attemptsUsed, lockedOut: attemptsUsed >= REMOTE_MAX_PAIR_ATTEMPTS }
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/shared/remoteAuth.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/shared/remoteAuth.ts src/shared/remoteAuth.test.ts
git commit -m "A four-character code, five tries, and one allowed host

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

---

## Task 11: The state the phone is allowed to see

**Files:**
- Create: `src/shared/remoteState.ts`
- Test: `src/shared/remoteState.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/shared/remoteState.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { CoachSlotSnapshot } from './coachClimax'
import { remoteStateFromSlots } from './remoteState'

function slot(overrides: Partial<CoachSlotSnapshot> = {}): CoachSlotSnapshot {
  return {
    id: 's1',
    kinds: ['drummy'],
    stem: {
      path: '/Users/nickel/Music/secret/abc123',
      name: 'wooden thud',
      author: 'elling',
      type: 'drums',
      durationSec: 2,
      barLength: 1
    },
    gain: 1,
    audible: true,
    rolling: false,
    ...overrides
  } as CoachSlotSnapshot
}

describe('remoteStateFromSlots', () => {
  it('carries the slot id, a kind label, the stem name and its sound type', () => {
    const state = remoteStateFromSlots([slot()], {
      discoverOpen: true,
      playing: false,
      kept: 3,
      rolled: 11,
      lastKeptName: null
    })
    expect(state.slots).toEqual([
      { id: 's1', kindLabel: 'drummy', stemName: 'wooden thud', soundType: 'drums' }
    ])
  })

  it('NEVER carries a filesystem path', () => {
    const state = remoteStateFromSlots([slot()], {
      discoverOpen: true,
      playing: true,
      kept: 0,
      rolled: 0,
      lastKeptName: null
    })
    expect(JSON.stringify(state)).not.toContain('/Users/')
    expect(JSON.stringify(state)).not.toContain('abc123')
  })

  it('reads an unresolved slot as empty rather than dropping the row', () => {
    const state = remoteStateFromSlots([slot({ stem: null })], {
      discoverOpen: true,
      playing: false,
      kept: 0,
      rolled: 0,
      lastKeptName: null
    })
    expect(state.slots).toEqual([
      { id: 's1', kindLabel: 'drummy', stemName: '', soundType: null }
    ])
  })

  it('labels a combination slot with both kinds', () => {
    const state = remoteStateFromSlots([slot({ kinds: ['drummy', 'chonky'] })], {
      discoverOpen: true,
      playing: false,
      kept: 0,
      rolled: 0,
      lastKeptName: null
    })
    expect(state.slots[0].kindLabel).toContain('drummy')
    expect(state.slots[0].kindLabel).toContain('chonky')
  })

  it('passes the counters and the open/playing flags straight through', () => {
    const state = remoteStateFromSlots([], {
      discoverOpen: false,
      playing: true,
      kept: 3,
      rolled: 11,
      lastKeptName: 'misty kestrel'
    })
    expect(state).toEqual({
      discoverOpen: false,
      playing: true,
      kept: 3,
      rolled: 11,
      lastKeptName: 'misty kestrel',
      slots: []
    })
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/shared/remoteState.test.ts`
Expected: FAIL — `Failed to resolve import "./remoteState"`.

- [ ] **Step 3: Write the implementation**

Create `src/shared/remoteState.ts`:

```ts
// src/shared/remoteState.ts
import type { SoundType } from './types'
import type { CoachSlotSnapshot } from './coachClimax'
import { slotKindsLabel } from './discoverSlotKind'

/** One row on the phone. `id` is Discover's own slot id -- needed so a tap
 * can reroll THAT slot, and not a filesystem path. There is deliberately
 * nothing else here: no path, no CID, no bpm, nothing about the library. */
export interface RemoteSlotView {
  id: string
  kindLabel: string
  stemName: string
  soundType: SoundType | null
}

export interface RemoteState {
  /** False when Discover is not open on the Mac -- the page then says
   * "open discover on the mac" and offers nothing else. It does not
   * navigate the desktop app there; screen-driving was considered and
   * rejected by Elling in the arrangement-map work. */
  discoverOpen: boolean
  playing: boolean
  /** A run is a session. Both reset when the server does. No points, no
   * badges, no streaks. */
  kept: number
  rolled: number
  /** Flashed once under the counters as `kept · misty kestrel`. */
  lastKeptName: string | null
  slots: RemoteSlotView[]
}

export interface RemoteStateMeta {
  discoverOpen: boolean
  playing: boolean
  kept: number
  rolled: number
  lastKeptName: string | null
}

/** The whole privacy boundary of Part 2, in one pure function: whatever
 * Discover's renderer knows, only these fields leave the Mac. An
 * unresolved slot keeps its row (with an empty name) rather than
 * disappearing -- the phone should show the shape of the loop he left on
 * screen, mid-roll included. */
export function remoteStateFromSlots(
  slots: readonly CoachSlotSnapshot[],
  meta: RemoteStateMeta
): RemoteState {
  return {
    discoverOpen: meta.discoverOpen,
    playing: meta.playing,
    kept: meta.kept,
    rolled: meta.rolled,
    lastKeptName: meta.lastKeptName,
    slots: slots.map((slot) => ({
      id: slot.id,
      kindLabel: slotKindsLabel(slot.kinds),
      stemName: slot.stem?.name ?? '',
      soundType: slot.stem?.type ?? null
    }))
  }
}

/** Everything the phone can ask the Mac to do. Four verbs, and nothing
 * else: no arranging, no timeline, no slot add/remove, no kind picker, no
 * gain, no settings, no library browsing. The Mac sets the shape of the
 * loop; the phone rolls it. */
export type RemoteCommand =
  | { kind: 'roll-slot'; slotId: string }
  | { kind: 'roll-all' }
  | { kind: 'transport'; play: boolean }
  | { kind: 'keep' }
```

If `CoachSlotSnapshot.kinds` is typed as `DiscoverSlotKind[]`, `slotKindsLabel` accepts it directly — confirm against `src/shared/coachClimax.ts` before writing, and adapt the call rather than casting.

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/shared/remoteState.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/shared/remoteState.ts src/shared/remoteState.test.ts
git commit -m "The only things about Discover that leave the Mac

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

---

## Task 12: The page, as a string, with the font inside it

**Files:**
- Create (generated): `src/main/remoteFont.ts`
- Create: `src/main/remotePage.ts`

No test: this is a static string. Its correctness is "does it render on his phone", which only Elling can check.

- [ ] **Step 1: Generate the font constant**

```bash
node -e "
const fs = require('node:fs')
const b64 = fs.readFileSync('src/renderer/src/assets/fonts/Silkscreen-Regular.woff2').toString('base64')
const header = [
  '// src/main/remoteFont.ts',
  '// GENERATED from src/renderer/src/assets/fonts/Silkscreen-Regular.woff2 (3768 bytes).',
  '// Regenerate with the one-liner in',
  '// docs/superpowers/plans/2026-09-26-discovered-library.md Task 12.',
  '//',
  '// The phone page is served by node:http and is NOT bundled by Vite, so there',
  '// is no asset pipeline to fetch this from -- it ships inside the page. This is',
  '// also why the page sends its own CSP with font-src data: (commit 25ab55d: the',
  '// renderer had default-src self with no font-src and silently refused these',
  '// exact bytes in every packaged build ever shipped).',
  ''
].join('\n')
fs.writeFileSync(
  'src/main/remoteFont.ts',
  header + 'export const SILKSCREEN_REGULAR_WOFF2_BASE64 =\n  \'' + b64 + '\'\n'
)
console.log('wrote', b64.length, 'base64 chars')
"
```

Expected: `wrote 5024 base64 chars` (approximately — the exact number depends on the file, which is 3768 bytes).

- [ ] **Step 2: Write the page**

Create `src/main/remotePage.ts`:

```ts
// src/main/remotePage.ts
import { SILKSCREEN_REGULAR_WOFF2_BASE64 } from './remoteFont'

/** The page's own Content-Security-Policy, sent as a header by
 * remoteServer.ts. Everything the page needs and nothing it does not:
 * inline style and script (there is no bundler here and no second file to
 * fetch), data: fonts (the Silkscreen face is embedded -- see remoteFont.ts
 * and commit 25ab55d for why that combination has to be spelled out), and
 * same-origin fetch for the five API routes. No images, no frames, no
 * forms, no base tag. */
export const REMOTE_PAGE_CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "script-src 'unsafe-inline'",
  'font-src data:',
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ')

// Hand-copied literals from src/renderer/src/styles/tokens.css, which is
// the single source of truth for this app's design tokens. This is a COPY
// and it will drift; that is cheaper tonight than any sharing mechanism
// between a Vite-bundled stylesheet and a main-process string. Colour is
// spent only on the slot rows, which carry a stem's own sound type -- the
// one thing on this page that carries audio information. Everything else
// is monochrome, sharp-cornered, lowercase.
const TYPE_COLORS: Record<string, string> = {
  drums: '#d98b4e',
  notes: '#c9a24a',
  bass: '#7fb0d8',
  extInst: '#c07fb8',
  sampler: '#9a8fd8',
  fx: '#5ec8b5',
  extFx: '#7fc98a',
  audioIn: '#c56164'
}

/** The whole phone remote, as one string. NOT bundled by Vite and not part
 * of the renderer build: no asset-copying config, no hashed-filename lookup
 * from main, nothing that can work in `npm run dev` and be missing from a
 * packaged build. */
export const REMOTE_PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>sssketch · side quest</title>
<style>
@font-face {
  font-family: 'Silkscreen';
  src: url(data:font/woff2;base64,${SILKSCREEN_REGULAR_WOFF2_BASE64}) format('woff2');
  font-weight: 400;
  font-display: block;
}
* { box-sizing: border-box; border-radius: 0; }
body {
  margin: 0;
  padding: env(safe-area-inset-top, 0px) 16px env(safe-area-inset-bottom, 0px);
  background: #050505;
  color: #ededed;
  font-family: 'Silkscreen', ui-monospace, monospace;
  font-size: 13px;
  line-height: 1.6;
  -webkit-text-size-adjust: 100%;
}
.wrap { max-width: 420px; margin: 0 auto; padding: 24px 0 32px; }
.eyebrow { font-size: 10px; color: #6a6a6a; letter-spacing: 0.08em; }
h1 { font-size: 15px; font-weight: 400; margin: 0 0 2px; }
.kept-name { font-size: 10px; color: #8f8f8f; min-height: 16px; }
.rows { margin: 20px 0; }
.row {
  display: flex;
  gap: 10px;
  align-items: baseline;
  width: 100%;
  text-align: left;
  padding: 14px 10px;
  margin-bottom: 6px;
  background: #0a0a0a;
  border: 1px solid #222222;
  color: #ededed;
  font: inherit;
}
.row:active { background: #161616; }
.row .kind { width: 84px; flex: none; font-size: 11px; }
.row .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.actions { display: flex; gap: 8px; }
button.big {
  flex: 1;
  padding: 18px 8px;
  background: transparent;
  border: 1px solid #3a3a3a;
  color: #ededed;
  font: inherit;
  font-size: 12px;
}
button.big:active { background: #161616; }
button.big.on { background: #ededed; color: #050505; }
input {
  width: 100%;
  padding: 16px 10px;
  background: #0a0a0a;
  border: 1px solid #3a3a3a;
  color: #ededed;
  font: inherit;
  font-size: 22px;
  letter-spacing: 0.3em;
  text-align: center;
  text-transform: uppercase;
}
.msg { font-size: 11px; color: #8f8f8f; min-height: 18px; margin-top: 10px; }
[hidden] { display: none; }
</style>
</head>
<body>
<div class="wrap">

  <div id="pair">
    <div class="eyebrow">sssketch</div>
    <h1>side quest</h1>
    <div class="msg">enter the code shown on the mac</div>
    <input id="code" inputmode="text" autocapitalize="characters" autocomplete="off" maxlength="4">
    <div class="actions" style="margin-top:10px">
      <button class="big" id="pair-go">pair</button>
    </div>
    <div class="msg" id="pair-msg"></div>
  </div>

  <div id="app" hidden>
    <div class="eyebrow">sssketch</div>
    <h1>side quest</h1>
    <div class="eyebrow" id="counts">kept 0 · rolled 0</div>
    <div class="kept-name" id="kept-name"></div>
    <div class="rows" id="rows"></div>
    <div class="actions">
      <button class="big" id="roll-all">roll all</button>
      <button class="big" id="play">play</button>
      <button class="big" id="keep">keep</button>
    </div>
    <div class="msg" id="msg"></div>
  </div>

</div>
<script>
(function () {
  var TYPE_COLORS = ${JSON.stringify(TYPE_COLORS)}
  var token = null
  try { token = localStorage.getItem('sssketch-remote-token') } catch (e) { token = null }

  var pairEl = document.getElementById('pair')
  var appEl = document.getElementById('app')
  var rowsEl = document.getElementById('rows')
  var countsEl = document.getElementById('counts')
  var keptNameEl = document.getElementById('kept-name')
  var msgEl = document.getElementById('msg')
  var pairMsgEl = document.getElementById('pair-msg')
  var playEl = document.getElementById('play')

  function show(paired) {
    pairEl.hidden = paired
    appEl.hidden = !paired
  }
  show(!!token)

  function api(path, body) {
    return fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
      body: JSON.stringify(body || {})
    })
  }

  document.getElementById('pair-go').addEventListener('click', function () {
    var code = document.getElementById('code').value
    fetch('/api/pair', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: code })
    })
      .then(function (r) { return r.ok ? r.json() : r.json().then(function (j) { throw j }) })
      .then(function (j) {
        token = j.token
        try { localStorage.setItem('sssketch-remote-token', token) } catch (e) {}
        pairMsgEl.textContent = ''
        show(true)
        poll()
      })
      .catch(function (j) {
        pairMsgEl.textContent = j && j.lockedOut ? 'too many tries, restart it on the mac' : 'wrong code'
      })
  })

  function render(state) {
    if (!state.discoverOpen) {
      rowsEl.innerHTML = ''
      msgEl.textContent = 'open discover on the mac'
      return
    }
    msgEl.textContent = ''
    countsEl.textContent = 'kept ' + state.kept + ' · rolled ' + state.rolled
    keptNameEl.textContent = state.lastKeptName ? 'kept · ' + state.lastKeptName : ''
    playEl.textContent = state.playing ? 'stop' : 'play'
    playEl.className = state.playing ? 'big on' : 'big'

    rowsEl.innerHTML = ''
    state.slots.forEach(function (slot) {
      var b = document.createElement('button')
      b.className = 'row'
      var kind = document.createElement('span')
      kind.className = 'kind'
      kind.textContent = slot.kindLabel
      kind.style.color = TYPE_COLORS[slot.soundType] || '#8f8f8f'
      var name = document.createElement('span')
      name.className = 'name'
      name.textContent = slot.stemName || '…'
      b.appendChild(kind)
      b.appendChild(name)
      b.addEventListener('click', function () {
        api('/api/roll', { slotId: slot.id })
      })
      rowsEl.appendChild(b)
    })
  }

  document.getElementById('roll-all').addEventListener('click', function () { api('/api/roll', {}) })
  playEl.addEventListener('click', function () {
    api('/api/transport', { play: playEl.textContent === 'play' })
  })
  document.getElementById('keep').addEventListener('click', function () { api('/api/keep', {}) })

  function poll() {
    if (!token) return
    fetch('/api/state', { headers: { authorization: 'Bearer ' + token } })
      .then(function (r) {
        if (r.status === 401) { token = null; show(false); throw new Error('unpaired') }
        return r.json()
      })
      .then(render)
      .catch(function () {})
  }
  setInterval(poll, 700)
  poll()
})()
</script>
</body>
</html>`
```

Lowercase throughout, no emoji, no exclamation marks, no `border-radius` (reset to 0 globally), colour only on the slot-row kind label, which carries the stem's own sound type.

- [ ] **Step 3: Verify it compiles and lints**

```bash
npm run typecheck
npm run lint
```

Expected: 0 errors. If prettier objects to the generated base64 line, leave it — a single unbreakable string literal produces no diff; if it *does* produce a warning, that is a **new** warning and must be resolved (wrap the constant assignment differently, do not add an eslint-disable).

- [ ] **Step 4: Commit**

```bash
git add src/main/remoteFont.ts src/main/remotePage.ts
git commit -m "One page, one font inside it, no bundler in the way

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

---

## Task 13: The server

**Files:**
- Create: `src/main/remoteServer.ts`

No test file: opening a real listening socket in vitest is exactly the kind of thing this codebase does not do, and the logic worth testing (pairing, attempts, host guard, state shaping) is already pure and tested in Tasks 10 and 11. Say so rather than inventing a socket test.

- [ ] **Step 1: Write it**

Create `src/main/remoteServer.ts`:

```ts
// src/main/remoteServer.ts
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { networkInterfaces } from 'node:os'
import { randomBytes } from 'node:crypto'
import {
  REMOTE_PORT,
  codesMatch,
  isAllowedHost,
  newPairingCode,
  recordPairAttempt,
  type PairingGate
} from '@shared/remoteAuth'
import type { RemoteCommand, RemoteState } from '@shared/remoteState'
import { REMOTE_PAGE_CSP, REMOTE_PAGE_HTML } from './remotePage'

/** The first non-internal IPv4 address on this machine -- what the desktop
 * shows him to type into the phone. Null when there is no LAN at all, in
 * which case the feature cannot work and the UI says so rather than
 * starting a server nothing can reach. */
export function lanIPv4Address(): string | null {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) return address.address
    }
  }
  return null
}

export interface RemoteServerHandle {
  url: string
  pairingCode: string
  stop(): void
}

export interface RemoteServerOptions {
  /** The last state the renderer pushed. Answered verbatim by GET
   * /api/state -- the server holds no model of Discover at all. */
  getState: () => RemoteState
  onCommand: (command: RemoteCommand) => void
  /** Called on every failed pairing attempt, so the desktop can say "two
   * tries left" and, on the fifth, that pairing is over for this session. */
  onPairingChanged: (gate: PairingGate) => void
  lanAddress: string
}

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
      // A controller sends a few dozen bytes. Anything larger is not this
      // app's phone page and is dropped rather than buffered.
      if (raw.length > 4096) raw = ''
    })
    req.on('end', () => {
      try {
        resolve(raw ? (JSON.parse(raw) as Record<string, unknown>) : {})
      } catch {
        resolve({})
      }
    })
  })
}

/** Starts the phone remote.
 *
 * Off by default and per-session: nothing here auto-starts, nothing is
 * persisted, and the handle's stop() is called on quit and whenever he
 * turns it off.
 *
 * Bound to 0.0.0.0 -- it has to be, or the phone cannot reach it. The
 * residual risk, stated plainly: anyone on his LAN can load the pairing
 * screen while this is on. That is the price of the phone reaching it at
 * all, and it is why this is off by default.
 *
 * Five routes, and no route takes or returns a filesystem path or reads
 * the library. A paired attacker can roll dice and save a rifff. That is
 * the entire blast radius, by design rather than by accident.
 *
 * BEFORE PAIRING THE SERVER SERVES THE PAIRING SCREEN AND NOTHING ELSE:
 * every unauthenticated request other than GET / and POST /api/pair gets
 * 401 with an empty object -- including a path that does not exist, so
 * nothing reveals which routes are real. */
export function startRemoteServer(options: RemoteServerOptions): RemoteServerHandle {
  const expectedHost = `${options.lanAddress}:${REMOTE_PORT}`
  const pairingCode = newPairingCode(Math.random)
  let gate: PairingGate = { attemptsUsed: 0, lockedOut: false }
  const tokens = new Set<string>()

  function deny(res: ServerResponse, status: number, body: unknown = {}): void {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }

  function authorized(req: IncomingMessage): boolean {
    const header = req.headers.authorization
    if (!header || !header.startsWith('Bearer ')) return false
    return tokens.has(header.slice('Bearer '.length))
  }

  const server: Server = createServer((req, res) => {
    void (async (): Promise<void> => {
      if (!isAllowedHost(req.headers.host, expectedHost)) return deny(res, 403)
      const url = (req.url ?? '/').split('?')[0]

      if (req.method === 'GET' && url === '/') {
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'content-security-policy': REMOTE_PAGE_CSP,
          'cache-control': 'no-store'
        })
        res.end(REMOTE_PAGE_HTML)
        return
      }

      if (req.method === 'POST' && url === '/api/pair') {
        if (gate.lockedOut) return deny(res, 403, { lockedOut: true })
        const body = await readJsonBody(req)
        const correct = codesMatch(String(body.code ?? ''), pairingCode)
        gate = recordPairAttempt(gate, correct)
        options.onPairingChanged(gate)
        if (!correct) return deny(res, 401, { lockedOut: gate.lockedOut })
        const token = randomBytes(32).toString('hex')
        tokens.add(token)
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ token }))
        return
      }

      if (!authorized(req)) return deny(res, 401)

      if (req.method === 'GET' && url === '/api/state') {
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        res.end(JSON.stringify(options.getState()))
        return
      }

      if (req.method === 'POST' && url === '/api/roll') {
        const body = await readJsonBody(req)
        const slotId = typeof body.slotId === 'string' ? body.slotId : null
        options.onCommand(slotId === null ? { kind: 'roll-all' } : { kind: 'roll-slot', slotId })
        return deny(res, 200)
      }

      if (req.method === 'POST' && url === '/api/transport') {
        const body = await readJsonBody(req)
        options.onCommand({ kind: 'transport', play: body.play === true })
        return deny(res, 200)
      }

      if (req.method === 'POST' && url === '/api/keep') {
        options.onCommand({ kind: 'keep' })
        return deny(res, 200)
      }

      // Anything else, authenticated or not, answers exactly like an
      // unauthenticated request -- no 404 that reveals a route exists.
      deny(res, 401)
    })()
  })

  server.listen(REMOTE_PORT, '0.0.0.0')

  return {
    url: `http://${expectedHost}`,
    pairingCode,
    stop: (): void => {
      tokens.clear()
      server.close()
    }
  }
}
```

- [ ] **Step 2: Verify**

```bash
npm run typecheck
npm run lint
```

Expected: 0 errors, 0 new warnings.

- [ ] **Step 3: Commit**

```bash
git add src/main/remoteServer.ts
git commit -m "Five routes, one host, and nothing that names a file

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

---

## Task 14: Wiring the remote into main and preload

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`

- [ ] **Step 1: Add the lifecycle and handlers to main**

In `src/main/index.ts`, add the imports:

```ts
import { lanIPv4Address, startRemoteServer, type RemoteServerHandle } from './remoteServer'
import type { RemoteCommand, RemoteState } from '@shared/remoteState'
import type { PairingGate } from '@shared/remoteAuth'
```

Add module-scope state near the other module-scope lifecycle variables:

```ts
// The phone remote is OFF BY DEFAULT and per-session -- never auto-started,
// never persisted, stopped on quit. Both of these are the whole of its
// state; there is no settings file and no accounts.
let remoteServer: RemoteServerHandle | null = null
let lastRemoteState: RemoteState = {
  discoverOpen: false,
  playing: false,
  kept: 0,
  rolled: 0,
  lastKeptName: null,
  slots: []
}
let remotePairingGate: PairingGate = { attemptsUsed: 0, lockedOut: false }

interface PhoneRemoteStatus {
  running: boolean
  url: string | null
  pairingCode: string | null
  attemptsUsed: number
  lockedOut: boolean
  /** Null when this machine has no non-internal IPv4 address -- the phone
   * could not reach it, so the UI says so instead of starting a server. */
  lanAddress: string | null
}

function phoneRemoteStatus(): PhoneRemoteStatus {
  return {
    running: remoteServer !== null,
    url: remoteServer?.url ?? null,
    pairingCode: remoteServer?.pairingCode ?? null,
    attemptsUsed: remotePairingGate.attemptsUsed,
    lockedOut: remotePairingGate.lockedOut,
    lanAddress: lanIPv4Address()
  }
}

function stopPhoneRemote(): void {
  remoteServer?.stop()
  remoteServer = null
  remotePairingGate = { attemptsUsed: 0, lockedOut: false }
}
```

Add the handlers beside the other `ipcMain.handle` registrations:

```ts
  ipcMain.handle('get-phone-remote-status', () => phoneRemoteStatus())

  ipcMain.handle('start-phone-remote', () => {
    if (remoteServer) return phoneRemoteStatus()
    const lanAddress = lanIPv4Address()
    if (lanAddress === null) return phoneRemoteStatus()
    remotePairingGate = { attemptsUsed: 0, lockedOut: false }
    remoteServer = startRemoteServer({
      lanAddress,
      getState: () => lastRemoteState,
      onCommand: (command: RemoteCommand) => {
        // Commands are performed by the RENDERER, by calling the exact
        // functions its own buttons call. There is no second
        // implementation of anything.
        mainWindow?.webContents.send('remote-command', command)
      },
      onPairingChanged: (gate) => {
        remotePairingGate = gate
        mainWindow?.webContents.send('phone-remote-status', phoneRemoteStatus())
      }
    })
    return phoneRemoteStatus()
  })

  ipcMain.handle('stop-phone-remote', () => {
    stopPhoneRemote()
    return phoneRemoteStatus()
  })

  ipcMain.handle('set-remote-state', (_event, state: RemoteState) => {
    lastRemoteState = state
  })
```

And stop it on quit, beside the existing engine shutdown in the `before-quit` / `window-all-closed` path:

```ts
  stopPhoneRemote()
```

- [ ] **Step 2: Add the preload bridge**

In `src/preload/index.ts`, add:

```ts
  getPhoneRemoteStatus: (): Promise<{
    running: boolean
    url: string | null
    pairingCode: string | null
    attemptsUsed: number
    lockedOut: boolean
    lanAddress: string | null
  }> => ipcRenderer.invoke('get-phone-remote-status'),
  startPhoneRemote: (): Promise<{
    running: boolean
    url: string | null
    pairingCode: string | null
    attemptsUsed: number
    lockedOut: boolean
    lanAddress: string | null
  }> => ipcRenderer.invoke('start-phone-remote'),
  stopPhoneRemote: (): Promise<{
    running: boolean
    url: string | null
    pairingCode: string | null
    attemptsUsed: number
    lockedOut: boolean
    lanAddress: string | null
  }> => ipcRenderer.invoke('stop-phone-remote'),
  setRemoteState: (state: RemoteState): Promise<void> =>
    ipcRenderer.invoke('set-remote-state', state),
  onRemoteCommand: (callback: (command: RemoteCommand) => void): (() => void) => {
    const listener = (_event: unknown, command: RemoteCommand): void => callback(command)
    ipcRenderer.on('remote-command', listener)
    return () => ipcRenderer.removeListener('remote-command', listener)
  },
  onPhoneRemoteStatus: (
    callback: (status: {
      running: boolean
      url: string | null
      pairingCode: string | null
      attemptsUsed: number
      lockedOut: boolean
      lanAddress: string | null
    }) => void
  ): (() => void) => {
    const listener = (_event: unknown, status: Parameters<typeof callback>[0]): void =>
      callback(status)
    ipcRenderer.on('phone-remote-status', listener)
    return () => ipcRenderer.removeListener('phone-remote-status', listener)
  },
```

with `import type { RemoteCommand, RemoteState } from '@shared/remoteState'` added to the preload's type imports. Extract the repeated status shape into a local `interface PhoneRemoteStatus` in the preload rather than writing it four times.

- [ ] **Step 3: Verify and commit**

```bash
npm run typecheck
npm run lint
git add src/main/index.ts src/preload/index.ts
git commit -m "Main can hold the server, and the renderer can hear it

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

---

## Task 15: The gear entry

**No component test.**

**Files:**
- Modify: `src/renderer/src/components/TransportBar.tsx`

- [ ] **Step 1: Add the state and the toggle**

Near the component's other settings state:

```ts
  // Off by default, per-session, never persisted -- see remoteServer.ts.
  const [phoneRemote, setPhoneRemote] = useState<{
    running: boolean
    url: string | null
    pairingCode: string | null
    attemptsUsed: number
    lockedOut: boolean
    lanAddress: string | null
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    window.rifffApi
      .getPhoneRemoteStatus()
      .then((status) => {
        if (!cancelled) setPhoneRemote(status)
      })
      .catch((err) => {
        console.error('TransportBar: getPhoneRemoteStatus() failed:', err)
      })
    const off = window.rifffApi.onPhoneRemoteStatus((status) => setPhoneRemote(status))
    return () => {
      cancelled = true
      off()
    }
  }, [])

  async function togglePhoneRemote(): Promise<void> {
    const next = phoneRemote?.running
      ? await window.rifffApi.stopPhoneRemote()
      : await window.rifffApi.startPhoneRemote()
    setPhoneRemote(next)
  }
```

- [ ] **Step 2: Add the menu entries**

In the settings `ContextMenu`'s `items` array, after the `change riff archive location…` entry:

```tsx
            {
              label: phoneRemote?.running ? 'turn off phone remote' : 'phone remote…',
              onClick: () => void togglePhoneRemote(),
              disabled: phoneRemote !== null && phoneRemote.lanAddress === null,
              title:
                phoneRemote !== null && phoneRemote.lanAddress === null
                  ? 'no network found'
                  : undefined
            },
            ...(phoneRemote?.running && phoneRemote.url
              ? [
                  { label: phoneRemote.url, onClick: (): void => {}, disabled: true },
                  {
                    label: `code ${phoneRemote.pairingCode ?? ''}`,
                    onClick: (): void => {},
                    disabled: true
                  },
                  ...(phoneRemote.lockedOut
                    ? [
                        {
                          label: 'pairing closed for this session',
                          onClick: (): void => {},
                          disabled: true
                        }
                      ]
                    : phoneRemote.attemptsUsed > 0
                      ? [
                          {
                            label: `${5 - phoneRemote.attemptsUsed} tries left`,
                            onClick: (): void => {},
                            disabled: true
                          }
                        ]
                      : [])
                ]
              : []),
```

The disabled-info-row pattern (label + `disabled: true` + an explanatory `title`) is the same one the discover classify-scan rows already use a few lines below. Copy is lowercase, no emoji, no exclamation marks.

- [ ] **Step 3: Verify and commit**

```bash
npm run typecheck
npm run lint
git add src/renderer/src/components/TransportBar.tsx
git commit -m "The gear turns the phone on, and says where and with what code

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

---

## Task 16: Discover pushes its state and runs the commands

**No component test.**

**Files:**
- Modify: `src/renderer/src/components/DiscoverPanel.tsx`

- [ ] **Step 1: Extract the snapshot builder**

The effect at ~line 1273 already builds exactly the `CoachSlotSnapshot[]` the remote needs. Hoist its body into a `useCallback` immediately above that effect, and have the effect call it, so there is one snapshot construction rather than two:

```ts
  const buildSlotSnapshots = useCallback((): CoachSlotSnapshot[] => {
    return slots.map((slot) => {
      const stem = resolvedStemsRef.current.get(slot.id) ?? slot.seedStem ?? null
      return {
        id: slot.id,
        kinds: normalizeSlotKinds(slot.kinds),
        stem:
          stem === null
            ? null
            : {
                path: stem.path,
                name: stem.name,
                author: stem.author,
                type: stem.type,
                durationSec: stem.durationSec,
                barLength: stem.barLength
              },
        gain: slot.gain,
        audible: previewingSlotIds.has(slot.id),
        rolling: rerollingSlotIds.has(slot.id)
      }
    })
  }, [slots, previewingSlotIds, rerollingSlotIds])
```

and the existing effect becomes:

```ts
  useEffect(() => {
    if (!onCoachSlotsChange) return
    onCoachSlotsChange(buildSlotSnapshots())
  }, [buildSlotSnapshots, resolvedBarLengths, onCoachSlotsChange])
```

- [ ] **Step 2: Add the counters**

Beside the `keeping`/`keptLabel` state from Task 7:

```ts
  // A run is a session -- these live with the panel and reset when it
  // unmounts or the app restarts. No points, no badges, no streaks.
  const [rolledCount, setRolledCount] = useState(0)
  const [keptCount, setKeptCount] = useState(0)
  const [lastKeptName, setLastKeptName] = useState<string | null>(null)
```

Increment `rolledCount` at the top of `rollForSlot` (`setRolledCount((n) => n + 1)`), and in `keepGroup`'s success branch add, beside the existing `setKeptLabel`:

```ts
      if (!saved.duplicate) {
        setKeptCount((n) => n + 1)
        setLastKeptName(saved.name.replace(/ \w{8} library$/, ''))
      }
```

(`friendlyRiffName` returns `"misty kestrel 1a2b3c4d library"`; the phone's eyebrow shows just the pair, which is what the spec's mockup says.)

- [ ] **Step 3: Push the state**

```ts
  // The renderer PUSHES; main only ever answers GET /api/state with the
  // last thing pushed. What he sees on the Mac and what he sees on the
  // phone are the same state because there is only one.
  useEffect(() => {
    void window.rifffApi.setRemoteState(
      remoteStateFromSlots(buildSlotSnapshots(), {
        discoverOpen: true,
        playing,
        kept: keptCount,
        rolled: rolledCount,
        lastKeptName
      })
    )
  }, [buildSlotSnapshots, playing, keptCount, rolledCount, lastKeptName])

  // Discover is closed the moment this panel unmounts -- the page then
  // says "open discover on the mac" and offers nothing else.
  useEffect(() => {
    return () => {
      void window.rifffApi.setRemoteState({
        discoverOpen: false,
        playing: false,
        kept: 0,
        rolled: 0,
        lastKeptName: null,
        slots: []
      })
    }
  }, [])
```

Import `remoteStateFromSlots` and `type RemoteCommand` from `@shared/remoteState`.

- [ ] **Step 4: Run the commands**

The handler must not capture stale functions, so keep it in a ref — the same stale-closure discipline this file already applies to `slotsRef`:

```ts
  // Commands are performed by calling the EXACT functions this panel's own
  // buttons call. keep is keep. There is no second implementation.
  const remoteCommandRef = useRef<(command: RemoteCommand) => void>(() => {})
  remoteCommandRef.current = (command: RemoteCommand): void => {
    if (command.kind === 'roll-all') void rerollAll()
    else if (command.kind === 'roll-slot') void rerollSlot(command.slotId)
    else if (command.kind === 'transport') dispatch({ type: command.play ? 'PLAY' : 'PAUSE' })
    else if (command.kind === 'keep') void keepGroup()
  }

  useEffect(() => {
    return window.rifffApi.onRemoteCommand((command) => remoteCommandRef.current(command))
  }, [])
```

Assigning `remoteCommandRef.current` during render is a write to a ref, not a `setState`, but if `react-hooks/purity` objects, move the assignment into its own `useEffect` with no dependency array and the same body.

- [ ] **Step 5: Verify**

```bash
npm run typecheck
npm run lint
npm test
```

Expected: 0 errors, 0 new warnings, everything green.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/DiscoverPanel.tsx
git commit -m "The phone rolls the loop the Mac is already holding

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

---

## Task 17: Final gate

- [ ] **Step 1: Everything, locally**

```bash
npm test
npm run typecheck
npm run lint
```

Expected: **181 test files** locally — 177 baseline plus `discoveredRoom`, `discoveredLibrary`, `remoteAuth` and `remoteState` — all passing, 0 typecheck errors, 0 lint errors and exactly the 4 pre-existing prettier warnings.

- [ ] **Step 2: Everything, as CI would run it**

```bash
CI=1 npm test 2>&1 | tail -20
```

Expected: green, with `discoveredLibrary.test.ts` excluded and **no** `Worker exited unexpectedly`.

- [ ] **Step 3: Confirm the engine is untouched**

```bash
git diff --stat 71364c7..HEAD -- native-engine/
```

Expected: empty.

- [ ] **Step 4: Hand off honestly**

Report, in these words or close to them, that the following were **not** verified and cannot be from this environment:

- whether `keep` from the sofa is actually enjoyable, which is the only real requirement
- whether the phone page is readable and tappable on his actual phone, at arm's length, in a dark room
- whether the pairing flow makes sense to someone who did not design it
- whether roll → keep → roll stays fast on his real 372k-riff library after the index-append work — the one performance claim in the spec that is a prediction rather than a measurement
- whether the copies really do survive removing a source jam from sync, which needs a real delete of real material and is the whole justification for copying
- whether Bluetooth latency between tapping `roll all` and hearing it is bearable

Nothing in a build log covers any of those.
