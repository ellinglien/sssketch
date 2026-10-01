# Discover artist mode: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Discover can play another Endlesss user's stems, picked with a search box. Radio and every roll path draw only from that artist. Their stems are listen only: keep, star, shelf, timeline and fetch hearts are all off. `me` behaves exactly as it does today.

**Architecture:**
- **Shared rules.** A pure module, `src/shared/discoverArtist.ts`, holds the rules: the mode, the listen-only action list, the notice copy, the roll filter, search suggestions, the jammed-with order and the course-change row order.
- **Main process: candidates.** It gains an artist stem set. It is read from the archive's `Stems_IndexUser` index, paged, and cached against the `Stems` table signal. `getDiscoverCandidates` uses it as a filter applied *before* its bounded sample.
- **Main process: search index.** A search index lists usernames with stem counts, the jammed-with list and the analysed %.
- **Main process: guards.** A session mirror of the chosen artist lets the main-process IPC handlers refuse keep, star and fetch hearts while the mode is `other`.
- **Renderer.** It adds an `artist:` field and a picker popover to Discover's header, and threads the artist into the five roll call sites. It dims the listen-only controls and turns the rows over one per loop top when the artist changes mid-radio.
- **Analyse overnight.** A persisted queue in the own db feeds Discover's existing whole-library scan, with a download step for queued stems only.

**Tech stack:** TypeScript, Electron main, better-sqlite3, React, vitest.

**Spec:** `docs/superpowers/specs/2026-10-01-discover-artist-mode-design.md` (commit `bf92720`). Its "Out of scope" list is the boundary: no web radio, no multi-artist blends, no keep or export of other artists' work.


**Decisions after planning (Elling, 2026-10-01):**
- **Jammed-with is saved to disk.** It's computed once by the background scan and saved in the own db. Stem counts and analysed % stay as planned. This replaces the spec's "in memory per session" for this list only.
  - *Revised in the Task 3 review:* what's saved is each **source db's** distinct `(jam, user)` pairs: `DiscoverJamUserPairs(SourceDbKey, JamCID, User)` and `DiscoverJamUserPairsMeta(SourceDbKey PK, StemCount, MaxRowid, ComputedAt)`.
  - The final list isn't saved. It's rebuilt from the pairs in JS, which takes milliseconds.
  - On launch, a db whose saved count and MAX(rowid) still match isn't walked at all. Only a db that has moved is re-walked. This matters because the own db is a source and moves with every riff sync, so saving only the list would rarely have saved the ~15 s archive walk.
- **Other artists' audio is stored on the USB drive** in LORE's folder, where `resolveStemPath` already writes for archive jams (`cache/common/stem_v2/<jam>/…`). This is the plan's existing behaviour, now confirmed.

---

## READ THIS BEFORE TASK 1

### 1. `me` must stay bit-for-bit what it is today

Every change in this plan is **additive and optional**: a new optional parameter, a new IPC argument left `undefined`, or a branch taken only when `artistMode(...) === 'other'`.

The gate is the existing suite. Run `npm test` after **every** task, and every test that passed before must still pass. The key files are:
- `src/main/discoverCandidates.test.ts`, which covers every pool and the existing `onlyOwnStems` paths at lines 353, 1109, 1124, 1188 and 1276;
- `src/shared/discoverSlotModifier.test.ts`;
- `src/shared/radioSlotFlags.test.ts`;
- `src/shared/radioHearts.test.ts`.

If an existing test needs editing to pass, stop and report. That means `me` changed.

### 2. Why "the same path as `mine`" is not enough on its own (found while planning)

The spec says to generalise `onlyOwnStems`/`targetUser`. The main process **already** takes any `targetUser`: `index.ts:1254-1305`, and `discoverCandidates.ts:1236, 1495, 1611`. But both the mask pool and the trait pool draw a random sample of `MAX_CANDIDATE_RESOLUTION_POOL = 1000` **before** the creator check runs:
- mask pool: `discoverCandidates.ts:1145`, then the check at `:1236`;
- trait pool: `sampleTraitStems`, `:1323`, then the check at `:1495`.

The share of the sample that survives the check is the artist's share of the archive:

| artist | stems | share of 781,509 | expected survivors per 1000 |
|---|---|---|---|
| elling (today's `mine`) | 66,534 | 8.5% | ~85 |
| bananepoep | 31,398 | 4.0% | ~40 |
| an artist with 300 stems | 300 | 0.04% | **~0.4** |

So the mode is unusable for most of the 5,921 users without a change. Task 2 adds an optional `artistStemCIDs` set that filters **before** sampling. It is passed **only** in artist mode, so `me` (including `mine`) still takes today's exact path.

### 3. Measured on Elling's archive (read-only, 2026-10-01)

The archive is `/Volumes/Elling-Lien/ENDLESSS/cache/common/warehouse.db3`: 1.19 GB on USB/ExFAT. It holds 781,509 stems, 900,041 riffs and 5,056 `Jams` rows. Only **79** distinct `OwnerJamCID`s hold stems, and Elling has stems in all 79.

| query | plan | cold | warm |
|---|---|---|---|
| `SELECT CreatorUserName, COUNT(*) FROM Stems GROUP BY CreatorUserName` | `SCAN Stems USING COVERING INDEX Stems_IndexUser` | 2.86 s | 0.09 s |
| one artist's `StemCID, OwnerJamCID` (31,398 rows) | `SEARCH Stems USING INDEX Stems_IndexUser (CreatorUserName=?)` + row lookups | 1.63 s | 0.03 s |
| same, paged: `... AND rowid > ? ORDER BY rowid LIMIT 2000` | `SEARCH ... USING INDEX Stems_IndexUser (CreatorUserName=? AND rowid>?)` | 2000 rows in 9 ms | — |
| jammed-with, naive `OwnerJamCID IN (SELECT ... WHERE CreatorUserName=?)` | scans `Stems_IndexUser` + 781k row lookups | **69 s** | **60 s** |
| jammed-with, jams first (CTE + `CROSS JOIN`) | `SEARCH s USING INDEX Stems_IndexOwnerSlice` | 25 s | — |
| every distinct `(OwnerJamCID, CreatorUserName)`, sequential `NOT INDEXED` | full table read | 15.2 s | 15.5 s |

There are 13,014 distinct (jam, user) pairs. The table does not stay in the page cache, which is why the warm run is no faster.

**Consequences, all built into the tasks:**
- **Counts.** Paged by username so no single slice blocks main.
- **Jammed-with.** Built from a **background, paged, yielding** rowid walk (~15 s, once per session per archive change). The picker works from the counts until it lands.
- **The artist set.** Paged by rowid inside the user index.
- **The own db.** `~/Music/sssketch/library/cache/common/warehouse.db3` (81,814 stems, 909 users) has **no** `CreatorUserName` index. Its queries are full scans of a small table on the internal SSD (tens of ms). Do not add an index there; it is out of scope.

### 4. Main-process SQLite rules (from real crashes; see `docs/superpowers/plans/2026-09-28-discover-candidate-pool.md`)

- **Never `.iterate()` across an `await`.** Use `.all()` per page.
- **Batch by db connection, never one query per jam.**
- **Yield between pages** (`setImmediate`), as `discoverLibraryStems.ts` does.
- **The external archive is opened read-only, so nothing may write to it.** Every new table goes in the **own** db.

### 5. `vitest.config.ts`: the CI exclusion list

Every **new** main-process test file that opens better-sqlite3 **must** be added to the `process.env.CI` exclusion list in `vitest.config.ts:47-79`. A stale list once silently broke six weeks of releases. This plan adds three such files, each with a numbered step:
- `src/main/discoverArtistStems.test.ts` (Task 2);
- `src/main/discoverArtistIndex.test.ts` (Task 3);
- `src/main/discoverArtistScanQueue.test.ts` (Task 8).

`src/shared/discoverArtist.test.ts` and `src/main/discoverArtistSession.test.ts` open no database and must **not** be added.

### 6. React components are not unit-tested here

Per CLAUDE.md's testing conventions, components are verified by typecheck, lint, the pure logic's own tests and Elling's walkthrough (Task 9). No agent can hear or see the app. Say so; never claim a UI change was "tested".

### 7. No `native-engine/` changes. No changes to the web radio.

---

## Spec ambiguities resolved in this plan

| spec text | resolution | why |
|---|---|---|
| "duplicate-to-arrange", "drag-out" (§2) | No Discover entry point for either exists. The row's `duplicate` (`DiscoverPanel.tsx:4741`) copies a row *within* Discover's listening mix, so it **stays on**. Drag-out exists only from the Shelf and the timeline, which artist stems cannot reach once add-to-shelf and add-to-timeline are off. Both names stay in `LISTEN_ONLY_ACTIONS` so the list matches the spec and a future entry point has to consult it. | Grepped `DiscoverPanel.tsx`: no `draggable`, no arrange-duplicate. |
| "any stem or bounce export started from Discover" (§2), "export" handlers (§3) | No Discover-started export exists. The project exports (`export-mix`, `export-mix-native`, `export-stems-native`, `export-als`) are **not** guarded. | They export the whole project. Elling's timelines legitimately hold collaborators' stems from his own jams, so a creator guard there would break today's exports, and `me` must not change. Artist stems cannot reach the project at all once shelf and timeline are off. |
| §3: guards refuse "a stem whose creator isn't the user"; §2: "already-owned stems … artist mode is still listen-only" | While the mode is `other`, the main guards refuse the **action outright**, whatever the creator. | This is a superset of §3 that also satisfies §2. Per-stem creator lookups would add a cross-db query per call for no gain. |
| 👍 in listen-only (§2: "still holds the row longer, but stars nothing") | 👍 is **not** dimmed. It always takes the "would star" branch of `likeRadioSlot` (hold on) and never calls `toggleStemFavourite`. Its tooltip reads `hold · listening only, nothing is starred`. | It still does something, so dimming it would be wrong. |
| No own username set (§2) | `artistMode(null, '') === 'own'`: `me` is today's unfiltered Discover. Any named artist is `other`. | "Every artist counts as other" refers to named artists. `me` with no identity is today's behaviour. |
| Picking your own name in search | It normalises to `me` (`null`). | There is one `me`. |
| Changing artist with radio **off** | No automatic re-roll. The next roll of any kind uses the new artist. The dice (similar all) re-rolls everything. | The spec only defines the radio case. |
| Course change: a row whose kinds have nothing by the new artist | It keeps its current stem and leaves the turnover set after one try. | Otherwise radio would retry the same row at every loop top forever. |
| "re-picks each row from the new artist" when switching **to** `me` | The rows to turn over are rows whose creator ≠ the new target (the own username, or every row if none is set). | One rule both ways. |
| `my sounds` toggle in artist mode | Dimmed, tooltip `artist mode picks <user>'s stems`. | The artist overrides it. |
| "the picker shows `analysed: N%` for the artist" | Shown in the picker footer for the current artist, with the `analyse overnight` button beside it. | The footer has room for both. |
| "existing overnight scan" | This is `DiscoverLibraryScan.tsx`, the renderer-side whole-library scan gated on analysis consent and `backgroundScanGate` idle time. It only ever analyses audio **already on disk** (`discoverLibraryStems.ts:110-118`). The priority queue adds a download step **for queued stems only**. The queue lives in the own db so it survives a restart. The button needs analysis consent. | The spec says "audio downloads only when the scan reaches each stem". |
| "remembered for the session" | App-level React state (`App.tsx`, beside `discoverSlots`). It survives Discover's unmount on tab switch and the library modal closing, and starts as `null` (`me`) on launch. Main keeps a mirror for the guards, which is reset on every renderer load. | It has the same lifetime as `discoverSlots`. A renderer reload must never leave main thinking `other` while the UI shows `me`. |
| "cached … refreshed when the archive changes" | Counts, pairs and artist sets are validated with `tableChangeSignal.ts` on `Stems`. The analysed % is keyed on `StemFeatureCache`'s row count. | These are the existing invalidation mechanisms. |
| Rows rolled under an artist, after switching back to `me` | Keep, shelf and timeline re-enable for them. | `me` already rolls every stem in the archive, and all of it comes from Elling's own 79 jams, so this grants nothing new. It is noted in the risks. |

---

## File map

| file | change | responsibility |
|---|---|---|
| `src/shared/discoverArtist.ts` | **create** | `artistMode`, `listenOnlyActions`, the notice, tooltip and field copy, `normalizeArtistPick`, `rollFilterForArtist`, `creatorAllowed`, turnover helpers (Task 1). Search: `mergeArtistCounts`, `jammedWithFromPairs`, `suggestArtists`, `suggestionLabel`, `analysedLabel` (Task 3). |
| `src/shared/discoverArtist.test.ts` | **create** | Unit tests for all of the above. Not in the CI exclusion list. |
| `src/main/discoverArtistStems.ts` | **create** | Paged read of one artist's `(StemCID, OwnerJamCID)` rows per db, cached per db and artist against the `Stems` signal. |
| `src/main/discoverArtistStems.test.ts` | **create** | Paging, merge across dbs, cache refresh. **CI-excluded.** |
| `src/main/discoverCandidates.ts` | modify | Optional `artistStemCIDs` through `getDiscoverCandidates`, then `getMaskDiscoverCandidates` and `getTraitPoolCandidates`/`sampleTraitStems`. |
| `src/main/discoverCandidates.test.ts` | modify (append only) | Artist pre-filter tests. Already CI-excluded. |
| `src/main/discoverAdjacency.ts` | modify | Optional `creator` on `getAdjacentDiscoverCandidates`. |
| `src/main/discoverArtistIndex.ts` | **create** | Paged counts, the background pairs walk, the analysed %. |
| `src/main/discoverArtistIndex.test.ts` | **create** | Fixture-db tests. **CI-excluded.** |
| `src/main/discoverArtistSession.ts` | **create** | The main mirror of the chosen artist, plus `refusesListenOnly`. No electron, no sqlite. |
| `src/main/discoverArtistSession.test.ts` | **create** | Guard decisions. Runs in CI. |
| `src/main/discoverArtistScanQueue.ts` | **create** | The `DiscoverArtistScanQueue` table in the own db: queue, peek, remove, size. |
| `src/main/discoverArtistScanQueue.test.ts` | **create** | **CI-excluded.** |
| `src/main/riffLibraryStore.ts` | modify | Export `downloadStemForAnalysis(jamCID, stemCID)`, a one-stem wrapper over the existing private `downloadOneStem` (`:911`). |
| `src/main/index.ts` | modify | New IPC handlers. `artist`/`creator` args on the three candidate handlers. Guards on `save-discovered-rifff` (`:768`), `fetch-radio-hearts` (`:777`) and `toggle-stem-favourite` (`:1824`). Session reset on `did-finish-load` (`createWindow`, `:408`). |
| `src/shared/radioHearts.ts` | modify | `'listening only'` added to `RadioHeartsFailure` (`:248`). |
| `src/preload/index.ts` | modify | Matching `rifffApi` entries. `RifffApi = typeof api` (`:800`), so the types follow. |
| `vitest.config.ts` | modify | Three CI exclusions. |
| `src/renderer/src/components/DiscoverArtistPicker.tsx` | **create** | The search popover: input, suggestions, analysed %, analyse overnight. |
| `src/renderer/src/components/DiscoverPanel.tsx` | modify | Props, `artistRef`, roll call sites, header field and notice, dimming, 👍, course change. Insertion points are given per task. |
| `src/renderer/src/components/DiscoverNearbyPopover.tsx` | modify | Pass `creator` (`:209`). |
| `src/renderer/src/components/LibraryBrowser.tsx` | modify | Pass-through props (`:177-236`, `:2451-2470`). |
| `src/renderer/src/App.tsx` | modify | `discoverArtist` state (beside `:1499`), passed at `:2771`. |
| `src/renderer/src/audio/DiscoverLibraryScan.tsx` | modify | The priority queue batch before local work, and an idle poll after the local walk ends. |

---

### Task 1: the shared artist rules (`src/shared/discoverArtist.ts`)

**Files:**
- Create: `src/shared/discoverArtist.ts`
- Test: `src/shared/discoverArtist.test.ts`

- [x] **Step 1: Write the failing test**

```ts
// src/shared/discoverArtist.test.ts
import { describe, expect, it } from 'vitest'
import {
  LISTEN_ONLY_ACTIONS,
  artistFieldLabel,
  artistMode,
  artistNotice,
  artistTurnoverIds,
  creatorAllowed,
  listenOnlyActions,
  listenOnlyTooltip,
  nextTurnoverSlotId,
  normalizeArtistPick,
  rollFilterForArtist
} from './discoverArtist'

describe('artistMode', () => {
  it('is own for me (null), with or without a username', () => {
    expect(artistMode(null, 'elling')).toBe('own')
    expect(artistMode(null, '')).toBe('own')
  })
  it('is own when the artist is the own username', () => {
    expect(artistMode('elling', 'elling')).toBe('own')
    expect(artistMode(' elling ', 'elling ')).toBe('own')
  })
  it('is other for anyone else', () => {
    expect(artistMode('bananepoep', 'elling')).toBe('other')
  })
  it('counts every named artist as other when no own username is set', () => {
    expect(artistMode('elling', '')).toBe('other')
    expect(artistMode('bananepoep', '   ')).toBe('other')
  })
})

describe('listenOnlyActions', () => {
  it('disables nothing in own mode', () => {
    expect([...listenOnlyActions('own')]).toEqual([])
  })
  it('disables the whole spec list in other mode', () => {
    expect([...listenOnlyActions('other')].sort()).toEqual(
      [
        'addToShelf',
        'addToTimeline',
        'dragOut',
        'duplicateToArrange',
        'export',
        'fetchHearts',
        'keep',
        'star'
      ].sort()
    )
    expect(LISTEN_ONLY_ACTIONS).toHaveLength(8)
  })
})

describe('copy', () => {
  it('has the notice, the tooltip and the field label, lowercase', () => {
    expect(artistNotice('seasickcookie')).toBe(
      "listening to seasickcookie's stems. to use them in your own work, ask them first."
    )
    expect(listenOnlyTooltip('seasickcookie')).toBe("listening only: these are seasickcookie's stems")
    expect(artistFieldLabel(null, 'elling')).toBe('artist: elling')
    expect(artistFieldLabel(null, '')).toBe('artist: me')
    expect(artistFieldLabel('bananepoep', 'elling')).toBe('artist: bananepoep')
  })
})

describe('normalizeArtistPick', () => {
  it('turns blank and the own name into me (null)', () => {
    expect(normalizeArtistPick('', 'elling')).toBeNull()
    expect(normalizeArtistPick('  elling ', 'elling')).toBeNull()
    expect(normalizeArtistPick(null, 'elling')).toBeNull()
  })
  it('keeps anyone else, trimmed', () => {
    expect(normalizeArtistPick(' tpj ', 'elling')).toBe('tpj')
    expect(normalizeArtistPick('elling', '')).toBe('elling')
  })
})

describe('rollFilterForArtist', () => {
  it('in own mode passes today\'s values through and no artist', () => {
    expect(rollFilterForArtist(null, 'elling', false)).toEqual({
      onlyOwnStems: false,
      targetUser: 'elling',
      artist: undefined
    })
    expect(rollFilterForArtist(null, 'elling', true)).toEqual({
      onlyOwnStems: true,
      targetUser: 'elling',
      artist: undefined
    })
  })
  it('in other mode forces the creator filter to the artist', () => {
    expect(rollFilterForArtist('honeydisco', 'elling', false)).toEqual({
      onlyOwnStems: true,
      targetUser: 'honeydisco',
      artist: 'honeydisco'
    })
  })
})

describe('creatorAllowed', () => {
  it('allows everything with no artist', () => {
    expect(creatorAllowed('anyone', undefined)).toBe(true)
    expect(creatorAllowed(null, undefined)).toBe(true)
  })
  it('allows only the artist otherwise', () => {
    expect(creatorAllowed('tpj', 'tpj')).toBe(true)
    expect(creatorAllowed('elling', 'tpj')).toBe(false)
    expect(creatorAllowed(null, 'tpj')).toBe(false)
  })
})

describe('artist turnover (course change on switch)', () => {
  const slots = [
    { id: 'a', creator: 'elling' },
    { id: 'b', creator: 'tpj' },
    { id: 'c', creator: null },
    { id: 'd', creator: 'bananepoep' }
  ]
  it('marks every row with a stem not by the new artist', () => {
    expect([...artistTurnoverIds(slots, 'tpj', 'elling')].sort()).toEqual(['a', 'd'])
  })
  it('switching to me targets the own username', () => {
    expect([...artistTurnoverIds(slots, null, 'elling')].sort()).toEqual(['b', 'd'])
  })
  it('switching to me with no username turns over every row with a stem', () => {
    expect([...artistTurnoverIds(slots, null, '')].sort()).toEqual(['a', 'b', 'd'])
  })
  it('picks the first eligible pending row, in row order', () => {
    expect(nextTurnoverSlotId(['b', 'd', 'a'], new Set(['a', 'd']))).toBe('d')
    expect(nextTurnoverSlotId(['b'], new Set(['a']))).toBeNull()
    expect(nextTurnoverSlotId([], new Set())).toBeNull()
  })
})
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/shared/discoverArtist.test.ts`
Expected: FAIL with `Failed to resolve import "./discoverArtist"`.

- [x] **Step 3: Write the implementation**

```ts
// src/shared/discoverArtist.ts
//
// Discover artist mode (docs/superpowers/specs/2026-10-01-discover-artist-
// mode-design.md): Discover plays another Endlesss user's stems, listen
// only. Every rule the renderer and main both need lives here, so the
// dimmed buttons and the main-process guards read ONE list.

export type ArtistMode = 'own' | 'other'

/** `artist` null is `me`. With no own username, `me` is still today's
 * unfiltered Discover ('own'); any NAMED artist is then 'other' (spec §2). */
export function artistMode(artist: string | null, ownUsername: string): ArtistMode {
  if (artist === null) return 'own'
  const own = ownUsername.trim()
  return own !== '' && artist.trim() === own ? 'own' : 'other'
}

/** Everything listen-only switches off (spec §2). 'dragOut' and
 * 'duplicateToArrange' have no Discover entry point today; they stay listed
 * so a future one has to consult this list. */
export type ListenOnlyAction =
  | 'keep'
  | 'star'
  | 'addToTimeline'
  | 'addToShelf'
  | 'dragOut'
  | 'duplicateToArrange'
  | 'export'
  | 'fetchHearts'

export const LISTEN_ONLY_ACTIONS: readonly ListenOnlyAction[] = Object.freeze([
  'keep',
  'star',
  'addToTimeline',
  'addToShelf',
  'dragOut',
  'duplicateToArrange',
  'export',
  'fetchHearts'
])

const NONE: ReadonlySet<ListenOnlyAction> = new Set()
const ALL: ReadonlySet<ListenOnlyAction> = new Set(LISTEN_ONLY_ACTIONS)

/** The one list the UI dims and main refuses. */
export function listenOnlyActions(mode: ArtistMode): ReadonlySet<ListenOnlyAction> {
  return mode === 'other' ? ALL : NONE
}

export function artistNotice(user: string): string {
  return `listening to ${user}'s stems. to use them in your own work, ask them first.`
}

export function listenOnlyTooltip(user: string): string {
  return `listening only: these are ${user}'s stems`
}

/** The header field. `me` reads as the own username when there is one. */
export function artistFieldLabel(artist: string | null, ownUsername: string): string {
  if (artist !== null) return `artist: ${artist}`
  const own = ownUsername.trim()
  return `artist: ${own !== '' ? own : 'me'}`
}

/** A pick from the search box, as stored: blank or the own name is `me`. */
export function normalizeArtistPick(picked: string | null, ownUsername: string): string | null {
  const name = (picked ?? '').trim()
  if (name === '') return null
  const own = ownUsername.trim()
  return own !== '' && name === own ? null : name
}

export interface ArtistRollFilter {
  onlyOwnStems: boolean
  targetUser: string
  /** Set only in artist mode -- main then pre-filters every pool to this
   * artist's stems BEFORE its bounded sample (discoverArtistStems.ts). */
  artist: string | undefined
}

/** What a roll sends to main. Own mode passes today's values through
 * untouched, so `me` stays exactly today's path. */
export function rollFilterForArtist(
  artist: string | null,
  ownUsername: string,
  onlyOwnStems: boolean
): ArtistRollFilter {
  if (artistMode(artist, ownUsername) === 'own') {
    return { onlyOwnStems, targetUser: ownUsername, artist: undefined }
  }
  const name = (artist as string).trim()
  return { onlyOwnStems: true, targetUser: name, artist: name }
}

/** The nearby-jam filter: no artist allows everything. */
export function creatorAllowed(
  creator: string | null | undefined,
  artist: string | undefined
): boolean {
  return artist === undefined || creator === artist
}

/** Rows a mid-radio artist change turns over: every row holding a stem
 * not by the new target (the artist, or the own username for `me` -- or
 * every row when there is no own username). */
export function artistTurnoverIds(
  slots: readonly { id: string; creator: string | null }[],
  artist: string | null,
  ownUsername: string
): Set<string> {
  const target = artist ?? ownUsername.trim()
  return new Set(
    slots
      .filter((s) => s.creator !== null && (target === '' || s.creator !== target))
      .map((s) => s.id)
  )
}

/** The next row to turn over: the first ELIGIBLE row still pending, in
 * eligible order. Null when none is (all done, or the rest are locked or
 * muted -- radio never changes those). */
export function nextTurnoverSlotId(
  eligible: readonly string[],
  pending: ReadonlySet<string>
): string | null {
  return eligible.find((id) => pending.has(id)) ?? null
}
```

- [x] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/shared/discoverArtist.test.ts`
Expected: PASS, all tests.

- [x] **Step 5: Gate**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all green. Nothing imports the module yet.

- [x] **Step 6: Commit**

```bash
git add src/shared/discoverArtist.ts src/shared/discoverArtist.test.ts
git commit -m "discover artist: shared rules (mode, listen-only list, copy, roll filter, turnover)"
```

**As landed:** code and tests exactly as above, except prettier reflowed two lines of the test (the `listenOnlyTooltip` expectation wrapped; one test name switched to double quotes) so lint stays at the 4 pre-existing warnings. Step 2's failure read `Cannot find module './discoverArtist'` rather than `Failed to resolve import`. 17 tests; full suite 231 files / 3772 tests green.

---

### Task 2: the artist parameter through candidates (`me` unchanged)

**Files:**
- Create: `src/main/discoverArtistStems.ts`, `src/main/discoverArtistStems.test.ts`
- Modify: `src/main/discoverCandidates.ts`:
  - `getDiscoverCandidates` signature `:855-870`;
  - its two pool calls `:879-887` and `:895-903`;
  - `getMaskDiscoverCandidates` `:1078-1092`, eligible filter `:1138-1142`;
  - `sampleTraitStems` `:1323-1326`;
  - `getTraitPoolCandidates` `:1418-1432`.
- Modify: `src/main/discoverAdjacency.ts` `:114-125`, matchRole loop `:168-173`
- Modify: `src/main/index.ts` `:1254-1315`
- Modify: `src/preload/index.ts` `:334-359`
- Modify: `vitest.config.ts` `:47-79`
- Test: `src/main/discoverCandidates.test.ts` (append)

- [x] **Step 1: Write the failing test for the artist stem reader**

```ts
// src/main/discoverArtistStems.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import {
  getArtistStemCIDs,
  getArtistStemRows,
  readArtistStemRows
} from './discoverArtistStems'

function archive(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE Stems (StemCID TEXT PRIMARY KEY, OwnerJamCID TEXT NOT NULL,
    CreatorUserName TEXT);
    CREATE INDEX Stems_IndexUser ON Stems (CreatorUserName);`)
  return db
}
function seed(db: Database.Database, stemCID: string, jam: string, user: string | null): void {
  db.prepare(`INSERT INTO Stems (StemCID, OwnerJamCID, CreatorUserName) VALUES (?, ?, ?)`).run(
    stemCID,
    jam,
    user
  )
}

afterEach(() => vi.useRealTimers())

describe('readArtistStemRows', () => {
  it('reads every row for the artist across several pages', async () => {
    const db = archive()
    for (let i = 0; i < 25; i++) seed(db, `t${i}`, 'jam1', 'tpj')
    seed(db, 'e1', 'jam1', 'elling')
    const rows = await readArtistStemRows(db, 'tpj', 10)
    expect(rows.map((r) => r.stemCID).sort()).toEqual(
      Array.from({ length: 25 }, (_, i) => `t${i}`).sort()
    )
    expect(rows.every((r) => r.jamCID === 'jam1')).toBe(true)
  })

  it('returns [] for a db with no Stems table rather than throwing', async () => {
    expect(await readArtistStemRows(new Database(':memory:'), 'tpj')).toEqual([])
  })
})

describe('getArtistStemRows', () => {
  it('merges dbs, first db wins a duplicate StemCID', async () => {
    const a = archive()
    const b = archive()
    seed(a, 's1', 'jamA', 'tpj')
    seed(b, 's1', 'jamB', 'tpj')
    seed(b, 's2', 'jamB', 'tpj')
    const rows = await getArtistStemRows([a, b], 'tpj')
    expect(rows).toEqual([
      { stemCID: 's1', jamCID: 'jamA' },
      { stemCID: 's2', jamCID: 'jamB' }
    ])
  })

  it('serves the cache, then refreshes once the Stems table moves', async () => {
    // Date only -- readArtistStemRows yields through setImmediate.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-01T12:00:00Z'))
    const db = archive()
    seed(db, 's1', 'jam1', 'tpj')
    expect([...(await getArtistStemCIDs([db], 'tpj'))]).toEqual(['s1'])
    seed(db, 's2', 'jam1', 'tpj')
    // Inside the signal check interval: still the cached answer.
    expect([...(await getArtistStemCIDs([db], 'tpj'))]).toEqual(['s1'])
    vi.setSystemTime(new Date('2026-10-01T12:01:00Z'))
    expect([...(await getArtistStemCIDs([db], 'tpj'))].sort()).toEqual(['s1', 's2'])
  })
})
```

- [x] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/main/discoverArtistStems.test.ts`
Expected: FAIL, module not found.

- [x] **Step 3: Implement `src/main/discoverArtistStems.ts`**

```ts
// src/main/discoverArtistStems.ts
//
// One artist's stems, for Discover artist mode. Read from the archive's
// Stems_IndexUser index, paged by rowid INSIDE that index (measured
// 2026-10-01 on Elling's 1.19 GB USB archive: 31,398 rows in 1.63 s cold as
// one statement, 2,000 rows in 9 ms per page) so no single slice blocks the
// main process. The own db has no CreatorUserName index; its pages are
// rowid-range scans of a small SSD table, which is cheap.
import type Database from 'better-sqlite3'
import { countWork } from './workCounters'
import {
  isScanCacheCurrent,
  newScanCacheState,
  readTableSignal,
  type ScanCacheState
} from './tableChangeSignal'

export interface ArtistStemRow {
  stemCID: string
  jamCID: string
}

const ARTIST_PAGE = 2000
/** Per db. 31k rows is ~3 MB; a handful of artists per session is plenty. */
const MAX_CACHED_ARTISTS = 8

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

export async function readArtistStemRows(
  db: Database.Database,
  artist: string,
  pageSize = ARTIST_PAGE
): Promise<ArtistStemRow[]> {
  let stmt: Database.Statement
  try {
    stmt = db.prepare(
      `SELECT rowid AS rid, StemCID, OwnerJamCID FROM Stems
       WHERE CreatorUserName = ? AND rowid > ? ORDER BY rowid LIMIT ?`
    )
  } catch {
    return [] // an external db missing the table -- same tolerance as everywhere
  }
  const out: ArtistStemRow[] = []
  let after = 0
  for (;;) {
    countWork('sql:discover.artist-stems-page')
    const page = stmt.all(artist, after, pageSize) as {
      rid: number
      StemCID: string
      OwnerJamCID: string
    }[]
    for (const row of page) out.push({ stemCID: row.StemCID, jamCID: row.OwnerJamCID })
    if (page.length < pageSize) break
    after = page[page.length - 1].rid
    await yieldToEventLoop()
  }
  return out
}

interface Entry {
  rows: ArtistStemRow[]
  state: ScanCacheState
}
const cache = new WeakMap<Database.Database, Map<string, Entry>>()

async function rowsForDb(db: Database.Database, artist: string): Promise<ArtistStemRow[]> {
  let perDb = cache.get(db)
  if (!perDb) {
    perDb = new Map()
    cache.set(db, perDb)
  }
  const hit = perDb.get(artist)
  if (hit && isScanCacheCurrent(db, 'Stems', hit.state)) {
    // Re-insert: Map order is the LRU order.
    perDb.delete(artist)
    perDb.set(artist, hit)
    return hit.rows
  }
  // Signal read BEFORE the walk: a write landing mid-walk reads as stale next time.
  const state = newScanCacheState(readTableSignal(db, 'Stems'))
  const rows = await readArtistStemRows(db, artist)
  perDb.delete(artist)
  perDb.set(artist, { rows, state })
  while (perDb.size > MAX_CACHED_ARTISTS) perDb.delete(perDb.keys().next().value as string)
  return rows
}

/** Every db's rows, merged; the FIRST db listing a StemCID decides its jam. */
export async function getArtistStemRows(
  dbs: readonly Database.Database[],
  artist: string
): Promise<ArtistStemRow[]> {
  const seen = new Set<string>()
  const out: ArtistStemRow[] = []
  for (const db of dbs) {
    for (const row of await rowsForDb(db, artist)) {
      if (seen.has(row.stemCID)) continue
      seen.add(row.stemCID)
      out.push(row)
    }
  }
  return out
}

/** The per-db rows are cached above; building a 31k-entry Set per roll is
 * ~2 ms, so no second cache layer here. */
export async function getArtistStemCIDs(
  dbs: readonly Database.Database[],
  artist: string
): Promise<ReadonlySet<string>> {
  return new Set((await getArtistStemRows(dbs, artist)).map((r) => r.stemCID))
}
```

- [x] **Step 4: Add the CI exclusion (non-optional)**

In `vitest.config.ts`, inside the `process.env.CI` array (`:48-78`), add `'src/main/discoverArtistStems.test.ts',` after `'src/main/discoverLibraryStems.test.ts',`.

- [x] **Step 5: Run it**

Run: `npx vitest run src/main/discoverArtistStems.test.ts`
Expected: PASS.

- [x] **Step 6: Write the failing candidate tests (append to `src/main/discoverCandidates.test.ts`)**

```ts
describe('artist mode: artistStemCIDs filters before the bounded sample', () => {
  // 1,200 of Elling's drums stems swamp a 1,000-stem sample; the 3 by
  // `tiny` must still all come back. Without the pre-filter, each would
  // survive only ~1000/1203 of the time -- this test would flake, not pass.
  function seedSwamp(own: Database.Database): void {
    for (let i = 0; i < 1200; i++) {
      seedRiff(own, `re${i}`, 'jam1', 128, [`e${i}`])
      seedStem(own, `e${i}`, 'jam1', { creatorUserName: 'elling' })
      seedCategory(own, `e${i}`, { arrangeRole: 'drums', busId: 'drums' })
    }
    for (const id of ['t1', 't2', 't3']) {
      seedRiff(own, `r-${id}`, 'jam1', 128, [id])
      seedStem(own, id, 'jam1', { creatorUserName: 'tiny' })
      seedCategory(own, id, { arrangeRole: 'drums', busId: 'drums' })
    }
  }

  it('mask kinds: returns exactly the artist\'s stems', async () => {
    const own = freshDb()
    seedSwamp(own)
    const candidates = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      kinds: ['drums'],
      onlyOwnStems: true,
      targetUser: 'tiny',
      artistStemCIDs: new Set(['t1', 't2', 't3'])
    })
    expect(candidates.map((c) => c.stemCID).sort()).toEqual(['t1', 't2', 't3'])
  })

  it('trait kinds: samples only the artist\'s analysed stems (SQL fallback, no value table)', async () => {
    const own = freshDb()
    for (let i = 0; i < 1200; i++) {
      seedRiff(own, `re${i}`, 'jam1', 128, [`e${i}`])
      seedStem(own, `e${i}`, 'jam1', { creatorUserName: 'elling' })
      seedFeatures(own, `e${i}`, featuresJSON({ zcrBrightness: 0.5 }))
    }
    for (const id of ['t1', 't2']) {
      seedRiff(own, `r-${id}`, 'jam1', 128, [id])
      seedStem(own, id, 'jam1', { creatorUserName: 'tiny' })
      seedFeatures(own, id, featuresJSON({ zcrBrightness: 0.5 }))
    }
    seedRiff(own, 'r-t3', 'jam1', 128, ['t3'])
    seedStem(own, 't3', 'jam1', { creatorUserName: 'tiny' }) // not analysed
    const candidates = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      kinds: ['bright'],
      onlyOwnStems: true,
      targetUser: 'tiny',
      artistStemCIDs: new Set(['t1', 't2', 't3'])
    })
    expect(candidates.map((c) => c.stemCID).sort()).toEqual(['t1', 't2'])
  })

  it('an empty artist set yields nothing, not everything', async () => {
    const own = freshDb()
    seedSwamp(own)
    const candidates = await getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      kinds: ['drums'],
      onlyOwnStems: true,
      targetUser: 'nobody',
      artistStemCIDs: new Set()
    })
    expect(candidates).toEqual([])
  })
})
```

- [x] **Step 7: Run them to verify they fail**

Run: `npx vitest run src/main/discoverCandidates.test.ts -t "artist mode"`
Expected: FAIL. TypeScript/vitest reports `artistStemCIDs` as an unknown property, or the mask test returns fewer than 3 or flakes.

- [x] **Step 8: Implement in `src/main/discoverCandidates.ts`**

8a. In `getDiscoverCandidates` (`:855-870`), add the parameter to both the destructuring and the type:

```ts
  soundSource = { endlesss: true, audioIn: true },
  artistStemCIDs
}: {
  ...
  soundSource?: DiscoverSoundSourceFilter
  /** Discover artist mode (2026-10-01): ONLY these stems may enter any
   * pool, applied BEFORE each pool's bounded random sample -- see
   * docs/superpowers/plans/2026-10-01-discover-artist-mode.md, "READ THIS"
   * §2. Undefined (every `me` roll) takes today's path untouched. */
  artistStemCIDs?: ReadonlySet<string>
}): Promise<DiscoverCandidate[]> {
```

Pass `artistStemCIDs` in both inner calls: the `getTraitPoolCandidates({...})` object at `:879-887` and the `getMaskDiscoverCandidates({...})` object at `:895-903`.

8b. In `getMaskDiscoverCandidates` (`:1078-1092`), add `artistStemCIDs` to its destructuring and as `artistStemCIDs?: ReadonlySet<string>` in its type. Replace the eligible filter at `:1138-1142` with:

```ts
  const eligibleStemCIDs = [...categoryByStemCID.keys()].filter(
    (stemCID) =>
      (artistStemCIDs === undefined || artistStemCIDs.has(stemCID)) &&
      soundSourceMatchesFilter(maskByStemCID.get(stemCID)?.instrument, soundSource) &&
      stemIsUsable(stemCID, unavailable)
  )
```

8c. In `getTraitPoolCandidates` (`:1418-1431`), add `artistStemCIDs` to the destructuring and as `artistStemCIDs?: ReadonlySet<string>` in its type. Change `:1432` to:

```ts
  const allSampled = await sampleTraitStems(ownDb, traitKinds, artistStemCIDs)
```

8d. Change `sampleTraitStems` (`:1323`) to take the set and branch first:

```ts
async function sampleTraitStems(
  ownDb: Database.Database,
  traitKinds: readonly DiscoverTraitKind[],
  artistStemCIDs?: ReadonlySet<string>
): Promise<TraitSampledStem[]> {
  if (artistStemCIDs !== undefined) {
    return sampleArtistTraitStems(ownDb, traitKinds, artistStemCIDs)
  }
  const table = getTraitValueTable(ownDb)
  // ... the rest exactly as it is today
```

Then add the new function directly below `sampleTraitStems`:

```ts
/** Artist mode's trait sample: the artist's ANALYSED stems only (most other
 * artists are a few % analysed -- spec "Context"), at most
 * MAX_CANDIDATE_RESOLUTION_POOL of them, uniformly random. From the
 * in-memory value table when it is current (Map lookups, no SQL);
 * otherwise chunked primary-key lookups on StemFeatureCache over a
 * shuffled id list, stopping once the bound is reached. */
async function sampleArtistTraitStems(
  ownDb: Database.Database,
  traitKinds: readonly DiscoverTraitKind[],
  artistStemCIDs: ReadonlySet<string>
): Promise<TraitSampledStem[]> {
  if (artistStemCIDs.size === 0) return []
  const table = getTraitValueTable(ownDb)
  if (table) {
    const rows: number[] = []
    for (const stemCID of artistStemCIDs) {
      const row = table.rowOf(stemCID)
      if (row !== undefined) rows.push(row)
    }
    const picked = sampleDistinctIndices(
      rows.length,
      Math.min(rows.length, MAX_CANDIDATE_RESOLUTION_POOL)
    )
    return picked.map((i) => {
      const features = table.features(rows[i])
      return {
        stemCID: table.stemCIDAt(rows[i]),
        traitValues: traitValuesFromFeatures(features, traitKinds),
        traitFieldValues: traitFieldValuesFromFeatures(features, traitKinds)
      }
    })
  }

  const ids = [...artistStemCIDs]
  const shuffled = sampleDistinctIndices(ids.length, ids.length).map((i) => ids[i])
  const sampled: TraitSampledStem[] = []
  for (const idChunk of chunk(shuffled, CANDIDATE_QUERY_CHUNK_SIZE)) {
    if (sampled.length >= MAX_CANDIDATE_RESOLUTION_POOL) break
    let rows: FeatureCandidateRow[]
    try {
      countWork('sql:discover.artist-trait-page')
      rows = ownDb
        .prepare(
          `SELECT StemCID, FeaturesJSON FROM StemFeatureCache
           WHERE StemCID IN (${idChunk.map(() => '?').join(', ')})`
        )
        .all(...idChunk) as FeatureCandidateRow[]
    } catch {
      return sampled
    }
    for (const row of rows) {
      try {
        const features = JSON.parse(row.FeaturesJSON) as StemFeatures
        sampled.push({
          stemCID: row.StemCID,
          traitValues: traitValuesFromFeatures(features, traitKinds),
          traitFieldValues: traitFieldValuesFromFeatures(features, traitKinds)
        })
      } catch {
        // malformed row -- not a candidate
      }
    }
    await yieldToEventLoop()
  }
  return sampled.slice(0, MAX_CANDIDATE_RESOLUTION_POOL)
}
```

`chunk`, `yieldToEventLoop`, `CANDIDATE_QUERY_CHUNK_SIZE`, `FeatureCandidateRow`, `sampleDistinctIndices`, `getTraitValueTable` and the trait helpers already exist in this file (`:571`, `:577`, `:165`, `:1271`, `:1286`, and the imports).

- [x] **Step 9: Run the candidate tests**

Run: `npx vitest run src/main/discoverCandidates.test.ts`
Expected: PASS. Every pre-existing test is unchanged and green, and the 3 new ones pass.

- [x] **Step 10: The nearby-jam filter, `src/main/discoverAdjacency.ts`**

Add a fourth parameter to `getAdjacentDiscoverCandidates` (`:114-125`), after `soundSource`:

```ts
  soundSource: DiscoverSoundSourceFilter = { endlesss: true, audioIn: true },
  /** Discover artist mode: only this creator's stems (creatorAllowed). */
  creator?: string
```

In `matchRole`'s `for (const stem of resolved.stems)` loop (`:168`), make this the first statement:

```ts
      if (!creatorAllowed(stem.creatorUserName, creator)) continue
```

Add `import { creatorAllowed } from '@shared/discoverArtist'` to the file's imports.

- [x] **Step 11: The IPC arguments, `src/main/index.ts`**

Add `import { getArtistStemCIDs } from './discoverArtistStems'` next to the other `./discover*` imports.

In `get-discover-candidates` (`:1254-1286`), add a 5th handler parameter `artist?: string`. Before the `getDiscoverCandidates` call, add:

```ts
      // Artist mode only. `me` never sends `artist`, so this stays undefined
      // and getDiscoverCandidates takes today's path.
      const artistStemCIDs = artist
        ? await getArtistStemCIDs([...new Set(jams.map((j) => j.dbForJam))], artist)
        : undefined
```

Pass `artistStemCIDs` in the options object.

`get-random-discover-candidate` (`:1288-1305`) needs no change. With `onlyOwnStems: true, targetUser: artist` it already takes `getRandomOwnStemCandidate`'s `WHERE CreatorUserName = ?` path (`discoverCandidates.ts:1611`), which works for any user.

In `get-adjacent-discover-candidates` (`:1307-1315`), add `creator?: string` and pass it as the 4th argument.

- [x] **Step 12: Preload, `src/preload/index.ts:334-359`**

```ts
  getDiscoverCandidates: (
    kinds: DiscoverSlotKind[],
    onlyOwnStems: boolean,
    targetUser?: string,
    soundSource?: DiscoverSoundSourceFilter,
    artist?: string
  ): Promise<DiscoverCandidate[]> =>
    ipcRenderer.invoke('get-discover-candidates', kinds, onlyOwnStems, targetUser, soundSource, artist),
  ...
  getAdjacentDiscoverCandidates: (
    centerRiffCID: string,
    kinds: DiscoverSlotKind[],
    soundSource?: DiscoverSoundSourceFilter,
    creator?: string
  ): Promise<{ newer: AdjacentDiscoverCandidate[]; older: AdjacentDiscoverCandidate[] }> =>
    ipcRenderer.invoke('get-adjacent-discover-candidates', centerRiffCID, kinds, soundSource, creator),
```

- [x] **Step 13: Gate**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all green. No renderer call site passes the new arguments yet, so the app behaves exactly as before.

- [x] **Step 14: Commit**

```bash
git add src/main/discoverArtistStems.ts src/main/discoverArtistStems.test.ts \
  src/main/discoverCandidates.ts src/main/discoverCandidates.test.ts \
  src/main/discoverAdjacency.ts src/main/index.ts src/preload/index.ts vitest.config.ts
git commit -m "discover artist: artist stem set filters every pool before its sample; me unchanged"
```

**As landed:** code exactly as above. Prettier reformatted only the test's import onto one line and the two preload `ipcRenderer.invoke(...)` calls onto one argument per line. Step 7: the mask and trait tests failed as expected. "An empty artist set yields nothing" already passed before the change, because `targetUser: 'nobody'` filters everything anyway; it now pins the empty-set early return. In adjacency, an unknown creator comes through as `''` (`riffLibraryStore.ts:771`), not null, and `creatorAllowed` rejects it correctly. The value-table branch of `sampleArtistTraitStems` has no direct test (the trait test covers the SQL fallback). Gates: typecheck clean, lint at the 4 pre-existing warnings, 232 files / 3,784 tests green, and `CI=1` skips `discoverArtistStems.test.ts`.

**Task 2 review fixes (separate commit):**
- `discoverArtistStems.ts` now holds one Stems signal per db, shared by every cached artist, so one change drops them all.
- It also has an in-flight promise map per db and artist (set before the first await, deleted in a `finally`), plus a generation counter so a walk that started before an invalidation never repopulates the cache.
- Comments now say ~4.6 MB per 31k rows and ~250 ms per cold page.
- `sampleArtistTraitStems` prepares at most two chunk statements per call.
- Both IPC handlers and `getAdjacentDiscoverCandidates` normalise with `?.trim() || undefined`.
- New tests: concurrent calls share one 3-page walk; one signal check refreshes two artists; and the trait value-table fast path (after `prewarmTraitQuantileTables`, `{t1,t2,t3}` gives `[t1,t2]` and never counts `sql:discover.artist-trait-page`).
- Both test files use a pass-through `vi.mock('./workCounters')` spy.

**Task 1 review follow-up (commit `e455ab2`):** `artistTurnoverIds` trims `artist`, and a blank one targets the own username. `rollFilterForArtist` treats a blank `artist` as own. New tests cover "the artist wins over `onlyOwnStems=true`" and pin case-sensitive matching.

---

### Task 3: artist search, jammed-with and analysed %

**Files:**
- Modify: `src/shared/discoverArtist.ts`, `src/shared/discoverArtist.test.ts`
- Create: `src/main/discoverArtistIndex.ts`, `src/main/discoverArtistIndex.test.ts`
- Modify: `src/main/index.ts` (new handlers next to `get-discover-candidates`), `src/preload/index.ts`, `vitest.config.ts`

- [x] **Step 1: Write the failing shared tests (append to `src/shared/discoverArtist.test.ts`)**

```ts
import {
  analysedLabel,
  jammedWithFromPairs,
  mergeArtistCounts,
  suggestArtists,
  suggestionLabel,
  type ArtistIndex
} from './discoverArtist'

describe('mergeArtistCounts', () => {
  it('sums a user across dbs', () => {
    expect(
      mergeArtistCounts([
        [{ user: 'tpj', stems: 10 }, { user: 'elling', stems: 5 }],
        [{ user: 'tpj', stems: 2 }]
      ])
    ).toEqual([
      { user: 'tpj', stems: 12 },
      { user: 'elling', stems: 5 }
    ])
  })
})

describe('jammedWithFromPairs', () => {
  const pairs: [string, string][] = [
    ['j1', 'elling'], ['j1', 'tpj'], ['j1', 'bananepoep'],
    ['j2', 'elling'], ['j2', 'tpj'],
    ['j3', 'honeydisco'], // a jam elling is not in
    ['shared:feed', 'elling'], ['shared:feed', 'stranger'], // not a jam
    ['discovered', 'elling'], ['discovered', 'keptfrom'] // kept groups, not a jam
  ]
  it('orders users by shared jams, then name, excluding self and non-jams', () => {
    expect(jammedWithFromPairs(pairs, 'elling')).toEqual([
      { user: 'tpj', sharedJams: 2 },
      { user: 'bananepoep', sharedJams: 1 }
    ])
  })
  it('is empty with no own username', () => {
    expect(jammedWithFromPairs(pairs, '')).toEqual([])
  })
})

describe('suggestArtists', () => {
  const index: ArtistIndex = {
    counts: [
      { user: 'elling', stems: 66534 },
      { user: 'seasickcookie', stems: 26828 },
      { user: 'bananepoep', stems: 31398 },
      { user: 'seaweed', stems: 12 },
      { user: 'oversea', stems: 400 }
    ],
    jammedWith: [
      { user: 'seaweed', sharedJams: 9 },
      { user: 'bananepoep', sharedJams: 4 }
    ],
    jammedWithPending: false
  }
  it('before typing: me, then people you have jammed with, in that order', () => {
    expect(suggestArtists(index, '', 'elling')).toEqual([
      { kind: 'me' },
      { kind: 'user', user: 'seaweed', stems: 12, sharedJams: 9 },
      { kind: 'user', user: 'bananepoep', stems: 31398, sharedJams: 4 }
    ])
  })
  it('before typing, while jammed-with is still being built: by stem count', () => {
    const pending = { ...index, jammedWith: null, jammedWithPending: true }
    expect(suggestArtists(pending, '', 'elling', 2)).toEqual([
      { kind: 'me' },
      { kind: 'user', user: 'bananepoep', stems: 31398, sharedJams: null },
      { kind: 'user', user: 'seasickcookie', stems: 26828, sharedJams: null }
    ])
  })
  it('typing: prefix matches first, then substring, each by stem count; never self', () => {
    expect(suggestArtists(index, 'SEA', 'elling').map((s) => (s.kind === 'me' ? 'me' : s.user)))
      .toEqual(['seasickcookie', 'seaweed', 'oversea'])
  })
  it('typing "me" or part of the own name offers me first', () => {
    expect(suggestArtists(index, 'me', 'elling')[0]).toEqual({ kind: 'me' })
    expect(suggestArtists(index, 'ell', 'elling')[0]).toEqual({ kind: 'me' })
  })
})

describe('labels', () => {
  it('formats suggestions and the analysed share', () => {
    expect(
      suggestionLabel({ kind: 'user', user: 'seasickcookie', stems: 26828, sharedJams: null }, 'elling')
    ).toBe('seasickcookie · 26,828')
    expect(suggestionLabel({ kind: 'me' }, 'elling')).toBe('me · elling')
    expect(suggestionLabel({ kind: 'me' }, '')).toBe('me')
    expect(analysedLabel(385, 31398)).toBe('analysed: 1%')
    expect(analysedLabel(1, 31398)).toBe('analysed: <1%')
    expect(analysedLabel(0, 31398)).toBe('analysed: 0%')
    expect(analysedLabel(0, 0)).toBe('analysed: 0%')
    expect(analysedLabel(65357, 66534)).toBe('analysed: 98%')
  })
})
```

- [x] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/shared/discoverArtist.test.ts`
Expected: FAIL, missing exports.

- [x] **Step 3: Implement the shared half (append to `src/shared/discoverArtist.ts`)**

```ts
import { DISCOVERED_JAM_CID } from './discoveredRoom'

export interface ArtistCount {
  user: string
  stems: number
}
export interface JammedWith {
  user: string
  sharedJams: number
}
/** What the picker gets from main. `jammedWith` is null until main's
 * background pairs walk finishes (~15 s on the USB archive, once per
 * archive change); `jammedWithPending` says whether one is running. */
export interface ArtistIndex {
  counts: ArtistCount[]
  jammedWith: JammedWith[] | null
  jammedWithPending: boolean
}

export function mergeArtistCounts(lists: readonly (readonly ArtistCount[])[]): ArtistCount[] {
  const total = new Map<string, number>()
  for (const list of lists) {
    for (const { user, stems } of list) total.set(user, (total.get(user) ?? 0) + stems)
  }
  return [...total].map(([user, stems]) => ({ user, stems }))
}

/** Not jams: the Shared Feed's synthetic jams and kept groups. */
function isRealJam(jamCID: string): boolean {
  return !jamCID.startsWith('shared:') && jamCID !== DISCOVERED_JAM_CID
}

/** "People you've jammed with" (spec §1): users with stems in jams where
 * the own user also has stems, by number of shared jams, then name. */
export function jammedWithFromPairs(
  pairs: Iterable<readonly [jamCID: string, user: string]>,
  ownUsername: string
): JammedWith[] {
  const own = ownUsername.trim()
  if (own === '') return []
  const usersByJam = new Map<string, Set<string>>()
  for (const [jam, user] of pairs) {
    if (!isRealJam(jam)) continue
    let users = usersByJam.get(jam)
    if (!users) {
      users = new Set()
      usersByJam.set(jam, users)
    }
    users.add(user)
  }
  const shared = new Map<string, number>()
  for (const users of usersByJam.values()) {
    if (!users.has(own)) continue
    for (const user of users) if (user !== own) shared.set(user, (shared.get(user) ?? 0) + 1)
  }
  return [...shared]
    .map(([user, sharedJams]) => ({ user, sharedJams }))
    .sort((a, b) => b.sharedJams - a.sharedJams || a.user.localeCompare(b.user))
}

export type ArtistSuggestion =
  | { kind: 'me' }
  | { kind: 'user'; user: string; stems: number; sharedJams: number | null }

const SUGGESTION_LIMIT = 12

export function suggestArtists(
  index: ArtistIndex,
  query: string,
  ownUsername: string,
  limit = SUGGESTION_LIMIT
): ArtistSuggestion[] {
  const q = query.trim().toLowerCase()
  const own = ownUsername.trim()
  const stemsOf = new Map(index.counts.map((c) => [c.user, c.stems]))
  const sharedOf = new Map((index.jammedWith ?? []).map((j) => [j.user, j.sharedJams]))
  const toSuggestion = (user: string): ArtistSuggestion => ({
    kind: 'user',
    user,
    stems: stemsOf.get(user) ?? 0,
    sharedJams: sharedOf.get(user) ?? null
  })
  const me: ArtistSuggestion = { kind: 'me' }
  if (q === '') {
    const ordered =
      index.jammedWith !== null
        ? index.jammedWith.map((j) => j.user)
        : [...index.counts]
            .sort((a, b) => b.stems - a.stems || a.user.localeCompare(b.user))
            .map((c) => c.user)
    return [me, ...ordered.filter((u) => u !== own).slice(0, limit).map(toSuggestion)]
  }
  const matches = index.counts.filter(
    (c) => c.user !== own && c.user.toLowerCase().includes(q)
  )
  const rank = (user: string): number => (user.toLowerCase().startsWith(q) ? 0 : 1)
  matches.sort(
    (a, b) => rank(a.user) - rank(b.user) || b.stems - a.stems || a.user.localeCompare(b.user)
  )
  const users = matches.slice(0, limit).map((c) => toSuggestion(c.user))
  const offersMe = 'me'.startsWith(q) || (own !== '' && own.toLowerCase().includes(q))
  return offersMe ? [me, ...users] : users
}

export function suggestionLabel(s: ArtistSuggestion, ownUsername: string): string {
  if (s.kind === 'me') {
    const own = ownUsername.trim()
    return own !== '' ? `me · ${own}` : 'me'
  }
  return `${s.user} · ${s.stems.toLocaleString('en-US')}`
}

export function analysedLabel(analysed: number, total: number): string {
  if (total <= 0 || analysed <= 0) return 'analysed: 0%'
  const pct = (analysed / total) * 100
  return pct < 1 ? 'analysed: <1%' : `analysed: ${Math.floor(pct)}%`
}
```

Move the `import` to the top of the file.

`Math.floor` is used so that 98.2% never rounds up to a misleading 100%. For bananepoep, 385/31,398 is 1.2%, which reads as `analysed: 1%`.

- [x] **Step 4: Run the shared tests**

Run: `npx vitest run src/shared/discoverArtist.test.ts`
Expected: PASS.

- [x] **Step 5: Write the failing main tests**

```ts
// src/main/discoverArtistIndex.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import {
  getArtistAnalysed,
  getArtistIndex,
  readArtistCounts,
  readJamUserPairs,
  resetArtistIndexForTests
} from './discoverArtistIndex'

function archive(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE Stems (StemCID TEXT PRIMARY KEY, OwnerJamCID TEXT NOT NULL,
    CreatorUserName TEXT);
    CREATE INDEX Stems_IndexUser ON Stems (CreatorUserName);`)
  return db
}
function ownDb(): Database.Database {
  const db = archive()
  db.exec(`CREATE TABLE StemFeatureCache (StemCID TEXT PRIMARY KEY, FeaturesJSON TEXT NOT NULL,
    ExtractedAt INTEGER NOT NULL);`)
  return db
}
function seed(db: Database.Database, stemCID: string, jam: string, user: string | null): void {
  db.prepare(`INSERT INTO Stems VALUES (?, ?, ?)`).run(stemCID, jam, user)
}

afterEach(() => {
  resetArtistIndexForTests()
  vi.useRealTimers()
})

describe('readArtistCounts', () => {
  it('counts per user across pages, skipping NULL and empty names', async () => {
    const db = archive()
    for (let i = 0; i < 7; i++) seed(db, `a${i}`, 'j', `user${i}`)
    seed(db, 'a7', 'j', 'user0')
    seed(db, 'n1', 'j', null)
    seed(db, 'n2', 'j', '')
    const counts = await readArtistCounts(db, 3)
    expect(counts.find((c) => c.user === 'user0')).toEqual({ user: 'user0', stems: 2 })
    expect(counts).toHaveLength(7)
  })
})

describe('readJamUserPairs', () => {
  it('returns each distinct (jam, user) pair once, across pages', async () => {
    const db = archive()
    seed(db, 's1', 'j1', 'elling')
    seed(db, 's2', 'j1', 'elling')
    seed(db, 's3', 'j1', 'tpj')
    seed(db, 's4', 'j2', 'tpj')
    seed(db, 's5', 'j2', null)
    expect((await readJamUserPairs(db, 2)).sort()).toEqual([
      ['j1', 'elling'],
      ['j1', 'tpj'],
      ['j2', 'tpj']
    ])
  })
})

describe('getArtistIndex', () => {
  it('returns counts at once and fills jammedWith after the background walk', async () => {
    const db = archive()
    seed(db, 's1', 'j1', 'elling')
    seed(db, 's2', 'j1', 'tpj')
    seed(db, 's3', 'j2', 'bananepoep')
    const first = await getArtistIndex([db], 'elling')
    expect(first.counts).toHaveLength(3)
    expect(first.jammedWith).toBeNull()
    expect(first.jammedWithPending).toBe(true)
    await vi.waitFor(async () => {
      const next = await getArtistIndex([db], 'elling')
      expect(next.jammedWith).toEqual([{ user: 'tpj', sharedJams: 1 }])
      expect(next.jammedWithPending).toBe(false)
    })
  })
})

describe('getArtistAnalysed', () => {
  it('is the share of the artist\'s stems with a StemFeatureCache row', async () => {
    const own = ownDb()
    const db = archive()
    for (let i = 0; i < 10; i++) seed(db, `t${i}`, 'j1', 'tpj')
    own.prepare(`INSERT INTO StemFeatureCache VALUES ('t0', '{}', 1), ('t1', '{}', 1)`).run()
    expect(await getArtistAnalysed(own, [db], 'tpj')).toEqual({ analysed: 2, total: 10 })
  })

  it('refreshes when StemFeatureCache grows', async () => {
    const own = ownDb()
    const db = archive()
    seed(db, 't0', 'j1', 'tpj')
    expect(await getArtistAnalysed(own, [db], 'tpj')).toEqual({ analysed: 0, total: 1 })
    own.prepare(`INSERT INTO StemFeatureCache VALUES ('t0', '{}', 1)`).run()
    expect(await getArtistAnalysed(own, [db], 'tpj')).toEqual({ analysed: 1, total: 1 })
  })
})
```

- [x] **Step 6: Add the CI exclusion (non-optional)**

In `vitest.config.ts`, add `'src/main/discoverArtistIndex.test.ts',` after `'src/main/discoverArtistStems.test.ts',`.

- [x] **Step 7: Run it to verify it fails**

Run: `npx vitest run src/main/discoverArtistIndex.test.ts`
Expected: FAIL, module not found.

- [x] **Step 8: Implement `src/main/discoverArtistIndex.ts`**

```ts
// src/main/discoverArtistIndex.ts
//
// The artist picker's data (spec §1, §3). Measured 2026-10-01 against
// Elling's archive (781,509 stems, 5,921 users, 1.19 GB on USB/ExFAT):
//   counts: GROUP BY over the covering Stems_IndexUser -- 2.86 s cold,
//           0.09 s warm. Paged by username so no slice blocks main.
//   pairs:  every distinct (OwnerJamCID, CreatorUserName) needs the whole
//           table -- 15 s even warm (the table does not stay in the page
//           cache). The obvious IN-subquery form took 60-69 s. So pairs are
//           built by a BACKGROUND rowid walk, paged and yielding, and the
//           picker works from the counts until it lands.
// All in memory, per session, re-validated against the Stems table signal.
import type Database from 'better-sqlite3'
import { countWork } from './workCounters'
import {
  isScanCacheCurrent,
  newScanCacheState,
  readTableSignal,
  type ScanCacheState
} from './tableChangeSignal'
import {
  jammedWithFromPairs,
  mergeArtistCounts,
  type ArtistCount,
  type ArtistIndex
} from '@shared/discoverArtist'
import { getArtistStemCIDs } from './discoverArtistStems'

const USER_PAGE = 500
const PAIR_PAGE = 20_000
const FEATURE_CHUNK = 500

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

export async function readArtistCounts(
  db: Database.Database,
  pageSize = USER_PAGE
): Promise<ArtistCount[]> {
  let stmt: Database.Statement
  try {
    stmt = db.prepare(
      `SELECT CreatorUserName AS user, COUNT(*) AS stems FROM Stems
       WHERE CreatorUserName > ? GROUP BY CreatorUserName
       ORDER BY CreatorUserName LIMIT ?`
    )
  } catch {
    return []
  }
  const out: ArtistCount[] = []
  // '' as the first bound skips NULL and empty names in one go.
  let after = ''
  for (;;) {
    countWork('sql:discover.artist-counts-page')
    const page = stmt.all(after, pageSize) as ArtistCount[]
    out.push(...page)
    if (page.length < pageSize) break
    after = page[page.length - 1].user
    await yieldToEventLoop()
  }
  return out
}

export async function readJamUserPairs(
  db: Database.Database,
  pageSize = PAIR_PAGE
): Promise<[string, string][]> {
  let stmt: Database.Statement
  try {
    stmt = db.prepare(
      `SELECT rowid AS rid, OwnerJamCID AS jam, CreatorUserName AS user FROM Stems
       WHERE rowid > ? ORDER BY rowid LIMIT ?`
    )
  } catch {
    return []
  }
  const seen = new Set<string>()
  const out: [string, string][] = []
  let after = 0
  for (;;) {
    countWork('sql:discover.artist-pairs-page')
    const page = stmt.all(after, pageSize) as { rid: number; jam: string; user: string | null }[]
    for (const { jam, user } of page) {
      if (!user) continue
      const key = `${jam}\u0000${user}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push([jam, user])
    }
    if (page.length < pageSize) break
    after = page[page.length - 1].rid
    await yieldToEventLoop()
  }
  return out
}

interface Cached<T> {
  value: T
  state: ScanCacheState
}
let countsCache = new WeakMap<Database.Database, Cached<ArtistCount[]>>()
let pairsCache = new WeakMap<Database.Database, Cached<[string, string][]>>()
let pairsInFlight = new WeakMap<Database.Database, Promise<void>>()

async function countsFor(db: Database.Database): Promise<ArtistCount[]> {
  const hit = countsCache.get(db)
  if (hit && isScanCacheCurrent(db, 'Stems', hit.state)) return hit.value
  const state = newScanCacheState(readTableSignal(db, 'Stems'))
  const value = await readArtistCounts(db)
  countsCache.set(db, { value, state })
  return value
}

/** Current pairs, or null -- and starts the background walk when missing
 * or stale. Never awaited by a caller: the picker polls instead. */
function pairsFor(db: Database.Database): { pairs: [string, string][] | null; pending: boolean } {
  const hit = pairsCache.get(db)
  if (hit && isScanCacheCurrent(db, 'Stems', hit.state)) return { pairs: hit.value, pending: false }
  if (!pairsInFlight.has(db)) {
    const state = newScanCacheState(readTableSignal(db, 'Stems'))
    const run = readJamUserPairs(db)
      .then((value) => {
        pairsCache.set(db, { value, state })
      })
      .catch((err: unknown) => console.error('discoverArtistIndex: pairs walk failed:', err))
      .finally(() => pairsInFlight.delete(db))
    pairsInFlight.set(db, run)
  }
  // A stale-but-present answer is still shown while the refresh runs.
  return { pairs: hit?.value ?? null, pending: true }
}

export async function getArtistIndex(
  dbs: readonly Database.Database[],
  ownUsername: string
): Promise<ArtistIndex> {
  const counts = mergeArtistCounts(await Promise.all(dbs.map((db) => countsFor(db))))
  const perDb = dbs.map((db) => pairsFor(db))
  const pending = perDb.some((p) => p.pending)
  const ready = perDb.every((p) => p.pairs !== null)
  return {
    counts,
    jammedWith: ready
      ? jammedWithFromPairs(perDb.flatMap((p) => p.pairs as [string, string][]), ownUsername)
      : null,
    jammedWithPending: pending
  }
}

let analysedCache = new Map<string, { featureRows: number; analysed: number; total: number }>()

export async function getArtistAnalysed(
  ownDb: Database.Database,
  dbs: readonly Database.Database[],
  artist: string
): Promise<{ analysed: number; total: number }> {
  const ids = [...(await getArtistStemCIDs(dbs, artist))]
  let featureRows = 0
  try {
    featureRows = (
      ownDb.prepare(`SELECT COUNT(*) AS n FROM StemFeatureCache`).get() as { n: number }
    ).n
  } catch {
    return { analysed: 0, total: ids.length }
  }
  const hit = analysedCache.get(artist)
  if (hit && hit.featureRows === featureRows && hit.total === ids.length) {
    return { analysed: hit.analysed, total: hit.total }
  }
  let analysed = 0
  for (let i = 0; i < ids.length; i += FEATURE_CHUNK) {
    const idChunk = ids.slice(i, i + FEATURE_CHUNK)
    countWork('sql:discover.artist-analysed-chunk')
    analysed += (
      ownDb
        .prepare(
          `SELECT COUNT(*) AS n FROM StemFeatureCache
           WHERE StemCID IN (${idChunk.map(() => '?').join(', ')})`
        )
        .get(...idChunk) as { n: number }
    ).n
    if ((i / FEATURE_CHUNK) % 10 === 9) await yieldToEventLoop()
  }
  analysedCache.set(artist, { featureRows, analysed, total: ids.length })
  return { analysed, total: ids.length }
}

export function resetArtistIndexForTests(): void {
  countsCache = new WeakMap()
  pairsCache = new WeakMap()
  pairsInFlight = new WeakMap()
  analysedCache = new Map()
}
```

- [x] **Step 9: Run the main tests**

Run: `npx vitest run src/main/discoverArtistIndex.test.ts`
Expected: PASS.

- [x] **Step 10: IPC handlers, `src/main/index.ts`**

Add the handlers directly after `get-adjacent-discover-candidates` (`:1315`), and import `getArtistIndex, getArtistAnalysed` from `./discoverArtistIndex`.

```ts
  // Discover artist mode (2026-10-01): the picker's data. The dbs are the
  // ones Discover rolls from -- the same distinct set get-discover-candidates
  // derives from listJamsWithDb.
  function discoverSourceDbs(): Database.Database[] {
    return [...new Set(listJamsWithDb().map(({ db }) => db))]
  }

  ipcMain.handle('discover-artist-index', (_event, ownUsername: string) =>
    getArtistIndex(discoverSourceDbs(), ownUsername)
  )

  ipcMain.handle('discover-artist-analysed', (_event, artist: string) =>
    getArtistAnalysed(openOwnRiffLibraryDb(), discoverSourceDbs(), artist)
  )
```

If `Database` is not already imported as a type in `index.ts`, add `import type Database from 'better-sqlite3'`.

- [x] **Step 11: Preload, `src/preload/index.ts` (after `getAdjacentDiscoverCandidates`)**

```ts
  discoverArtistIndex: (ownUsername: string): Promise<ArtistIndex> =>
    ipcRenderer.invoke('discover-artist-index', ownUsername),
  discoverArtistAnalysed: (artist: string): Promise<{ analysed: number; total: number }> =>
    ipcRenderer.invoke('discover-artist-analysed', artist),
```

Add `import type { ArtistIndex } from '@shared/discoverArtist'`.

- [x] **Step 12: Gate and commit**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all green.

```bash
git add src/shared/discoverArtist.ts src/shared/discoverArtist.test.ts \
  src/main/discoverArtistIndex.ts src/main/discoverArtistIndex.test.ts \
  src/main/index.ts src/preload/index.ts vitest.config.ts
git commit -m "discover artist: search counts, background jammed-with walk, analysed share"
```

**As landed:**
- **Shared half:** exactly as above. The test's mid-file `import` was merged into the file's top import, and `DISCOVERED_JAM_CID`'s import sits at the top of `discoverArtist.ts`.
- **Jammed-with saved to disk** (the "Decisions after planning" item, which the code above predates), in its revised form (Task 3 review commit):
  - **Store:** `src/main/discoverJamUserPairsStore.ts` saves each source db's `(jam, user)` pairs plus a meta row, keyed by `db.name` like `DiscoverRiffIndexCacheMeta`.
    - Only count and MAX(rowid) persist. `writes` is per process and `data_version` per connection.
    - The store's header documents the gap: an in-place UPDATE between launches isn't seen.
    - Tables are created lazily on first use, like Task 8's queue, **not** in `riffLibrarySchema.ts`, whose test lists every own-db table exactly.
    - The DDL drops the first commit's unreleased `DiscoverJammedWith*` tables.
  - **`getArtistIndex(ownDb, dbs, ownUsername)`** (gains `ownDb`):
    - Per db, it uses in-memory pairs while they're current.
    - Otherwise, on the first look this session, it uses the saved pairs if that db's count and MAX(rowid) still match.
    - Otherwise it walks that db in the background, saves the result, and meanwhile shows the old pairs.
    - Pairs are independent of the user, so a different own username gets its list at once.
    - The list is memoised per (pairs, own username).
  - **Walk:**
    - Pair pages are 2,000 rows, the measured ~250 ms cold-page size.
    - A failed walk backs off 60 s (`jammedWithPending: false` meanwhile) instead of retrying on every poll.
    - `abortArtistIndexWork()` (wired to `will-quit`) stops walks at their next page and starts no new ones.
  - **Signal and counts:**
    - The Stems signal is read at most once per db per call, shared by the counts check, the pairs check and new cache states.
    - Concurrent `countsFor` calls share one read.
  - **IPC:** `discover-artist-index` type-checks `ownUsername`.
- **Same review, other files:**
  - `suggestArtists` falls back to stem order when `jammedWith` is empty, not only when it's null, and builds its lookup maps once per index object.
  - `discoverArtistStems.ts` clears in-flight walks on invalidation (a stale walk only removes its own entry). It reads the shared Stems signal into the per-db state before the first walk starts, so concurrent walks for two artists read it once.
- **`getArtistAnalysed`:** prepares its chunk statement once per placeholder count, the same as Task 2's review fix. The `discover-artist-analysed` handler trims the artist and returns `{analysed: 0, total: 0}` when it's blank.
- **Tests:** the plan's test calls pass a fixture own db. New tests cover:
  - the list is written once the walk lands;
  - a relaunch serves it with zero pair pages;
  - a moved archive shows the stale list, recomputes and re-saves;
  - another own username or another source-db set is never served;
  - the tables are created lazily.
  - The file uses the same pass-through `workCounters` spy. Source dbs are temp files, because pairs are keyed by `db.name`.
  - The review commit replaced the list-on-disk tests with: per-db pairs saved; a relaunch walks nothing; a moved own-db source is the only db re-walked; another username is served at once; lazy tables; 60 s back-off; abort on quit; concurrent counts share one read. Mutating the back-off, abort and disk-load lines each fails a test.
- **Gates:** typecheck clean, lint at the 4 pre-existing warnings, 233 files / 3,807 tests green, and `CI=1` skips `discoverArtistIndex.test.ts`. `radioDropOut.test.ts` failed once under full-suite load, then passed 6/6 alone and in a full rerun. It's unrelated.

---

### Task 4: the IPC guards

**Files:**
- Create: `src/main/discoverArtistSession.ts`, `src/main/discoverArtistSession.test.ts`
- Modify: `src/shared/radioHearts.ts:248-257`, `src/main/index.ts` (`:408` createWindow, `:768-788`, `:1824-1826`), `src/preload/index.ts`

- [x] **Step 1: Write the failing test**

```ts
// src/main/discoverArtistSession.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  currentArtistMode,
  getDiscoverArtistSession,
  refusesListenOnly,
  resetDiscoverArtistSession,
  setDiscoverArtistSession
} from './discoverArtistSession'
import { heartFetchLabel } from '@shared/radioHearts'

afterEach(() => resetDiscoverArtistSession())

describe('discover artist session', () => {
  it('starts on me, own mode, refusing nothing', () => {
    expect(getDiscoverArtistSession()).toEqual({ artist: null, ownUsername: '' })
    expect(currentArtistMode()).toBe('own')
    expect(refusesListenOnly('keep')).toBe(false)
    expect(refusesListenOnly('star')).toBe(false)
    expect(refusesListenOnly('fetchHearts')).toBe(false)
  })

  it('refuses keep, star and fetch hearts while another artist is chosen', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(setDiscoverArtistSession({ artist: 'bananepoep', ownUsername: 'elling' })).toBe('other')
    expect(refusesListenOnly('keep')).toBe(true)
    expect(refusesListenOnly('star')).toBe(true)
    expect(refusesListenOnly('fetchHearts')).toBe(true)
    expect(warn).toHaveBeenCalledTimes(3)
  })

  it('choosing your own name is own mode', () => {
    expect(setDiscoverArtistSession({ artist: ' elling ', ownUsername: 'elling' })).toBe('own')
    expect(refusesListenOnly('keep')).toBe(false)
  })

  it('with no own username, a named artist is other', () => {
    setDiscoverArtistSession({ artist: 'elling', ownUsername: '' })
    expect(currentArtistMode()).toBe('other')
  })

  it('reset (a renderer reload) goes back to me', () => {
    setDiscoverArtistSession({ artist: 'tpj', ownUsername: 'elling' })
    resetDiscoverArtistSession()
    expect(currentArtistMode()).toBe('own')
  })

  it('the refused fetch reads as a label', () => {
    expect(heartFetchLabel({ ok: false, reason: 'listening only' })).toBe('listening only')
  })
})
```

- [x] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/main/discoverArtistSession.test.ts`
Expected: FAIL, module not found. Once the module exists, a type error remains for `'listening only'`.

- [x] **Step 3: Implement**

```ts
// src/main/discoverArtistSession.ts
//
// Main's mirror of Discover's chosen artist (spec §3 "Enforcement"). The
// renderer pushes every change (discover-set-artist); a renderer load
// resets it to `me` (index.ts createWindow), so a reload can never leave
// main refusing keep while the UI shows `me`. No electron, no sqlite --
// unit-tested in CI.
import {
  artistMode,
  listenOnlyActions,
  type ArtistMode,
  type ListenOnlyAction
} from '@shared/discoverArtist'

export interface DiscoverArtistSession {
  artist: string | null
  ownUsername: string
}

const ME: DiscoverArtistSession = Object.freeze({ artist: null, ownUsername: '' })
let session: DiscoverArtistSession = ME

export function setDiscoverArtistSession(next: DiscoverArtistSession): ArtistMode {
  const artist = next.artist === null ? null : next.artist.trim() || null
  session = { artist, ownUsername: next.ownUsername.trim() }
  return currentArtistMode()
}

export function getDiscoverArtistSession(): DiscoverArtistSession {
  return session
}

export function currentArtistMode(): ArtistMode {
  return artistMode(session.artist, session.ownUsername)
}

/** True when `action` must be refused now. While the mode is `other`, the
 * action is refused outright, whatever the stem's creator: spec §2 keeps
 * even already-owned stems listen-only in artist mode, which is a superset
 * of §3's per-creator rule. */
export function refusesListenOnly(action: ListenOnlyAction): boolean {
  const refused = listenOnlyActions(currentArtistMode()).has(action)
  if (refused) {
    console.warn(`discover: refused ${action} -- listening only to ${session.artist}'s stems`)
  }
  return refused
}

export function resetDiscoverArtistSession(): void {
  session = ME
}
```

In `src/shared/radioHearts.ts`, add a member to `RadioHeartsFailure` (`:248-257`), before `'import failed'`:

```ts
  /** Discover is in artist mode (another user's stems, listen only). */
  | 'listening only'
```

`heartFetchLabel`'s `default` branch already returns the reason verbatim, so no label change is needed.

- [x] **Step 4: Wire the guards, `src/main/index.ts`**

Import `refusesListenOnly`, `resetDiscoverArtistSession` and `setDiscoverArtistSession` from `./discoverArtistSession`.

`save-discovered-rifff` (`:768-772`). This covers the keep button **and** the phone's keep, both of which go through `keepGroup`:

```ts
  ipcMain.handle(
    'save-discovered-rifff',
    (_event, members: DiscoveredMemberInput[], bpm: number, barLength: number) =>
      refusesListenOnly('keep') ? null : keepDiscovered(members, bpm, barLength)
  )
```

`fetch-radio-hearts` (`:777`). Make this the first line of the handler body:

```ts
    if (refusesListenOnly('fetchHearts')) return { ok: false, reason: 'listening only' } as const
```

`toggle-stem-favourite` (`:1824-1826`):

```ts
  ipcMain.handle('toggle-stem-favourite', (_event, stemCID: string) =>
    refusesListenOnly('star')
      ? listStemFavourites(openOwnRiffLibraryDb())
      : toggleStemFavourite(openOwnRiffLibraryDb(), stemCID)
  )
```

Add the setter after `discover-artist-analysed`:

```ts
  ipcMain.handle('discover-set-artist', (_event, artist: string | null, ownUsername: string) =>
    setDiscoverArtistSession({ artist, ownUsername })
  )
```

In `createWindow` (`:408`), next to `win.webContents.on('before-input-event', ...)` (`:508`):

```ts
  // Discover artist mode: the renderer's chosen artist starts as `me` on
  // every load, so main's mirror must too.
  win.webContents.on('did-finish-load', () => resetDiscoverArtistSession())
```

- [x] **Step 5: Preload**

```ts
  discoverSetArtist: (artist: string | null, ownUsername: string): Promise<ArtistMode> =>
    ipcRenderer.invoke('discover-set-artist', artist, ownUsername),
```

Add `ArtistMode` to the `@shared/discoverArtist` type import.

- [x] **Step 6: Run and gate**

Run: `npx vitest run src/main/discoverArtistSession.test.ts && npm run typecheck && npm run lint && npm test`
Expected: all green.

Nothing sets the session yet, so it is always `me` and every guard is a no-op. `me` is unchanged.

- [x] **Step 7: Commit**

```bash
git add src/main/discoverArtistSession.ts src/main/discoverArtistSession.test.ts \
  src/shared/radioHearts.ts src/main/index.ts src/preload/index.ts
git commit -m "discover artist: main refuses keep, star and fetch hearts in artist mode"
```

**As landed:**
- **Code:** exactly as above, with one exception. `discover-set-artist` takes `unknown` arguments and coerces them: a non-string artist becomes `null` (`me`) and a non-string `ownUsername` becomes `''`. That's the same IPC type-checking the Task 3 review asked for, so a bad payload can't throw inside `setDiscoverArtistSession`'s `.trim()`.
- **Line numbers had drifted:**
  - `save-discovered-rifff` is at `:772`, `fetch-radio-hearts` at `:780` and `toggle-stem-favourite` at `:1859`;
  - `createWindow` is at `:411` and `before-input-event` at `:511`.
- **Return types:** the refused branches match the handlers' existing types. `keepDiscovered` already returns `SaveDiscoveredResult | null`, and both favourite functions return `string[]`.
- **Gates:** typecheck clean; 234 files / 3,819 tests green; `discoverArtistSession.test.ts` opens no db, so it's not CI-excluded.
- **Lint:** my files are clean. The full run showed 40 warnings, but 36 came from another agent's uncommitted edit to `src/shared/radioDropOut.test.ts` (left unstaged); the other 4 are the pre-existing ones.

**Tasks 3–4 review follow-up (one commit):**
- **Phone keep:**
  - `remotePage.ts` no longer flashes `kept` on tap. It flashes `keeping`, then `kept` once the polled `state.kept` passes its value at tap time, or `not kept` after 5 s.
  - `/api/keep` answers `409 {reason: 'listening only'}` without forwarding when the new `RemoteServerOptions.refusesKeep` says so. `index.ts` passes `() => refusesListenOnly('keep')`.
  - `RemoteStateResponse` gains an optional `listenOnly`. Main derives it from the session, like `loopId`, so the renderer push is unchanged and an older Mac reads as false.
  - The phone disables keep and labels it `listening only` (new `button.big:disabled` style).
- **Reset timing:** the session resets on a main-frame, cross-document `did-start-navigation`, not on `did-finish-load`.
- **Distinct refusal:** a refused keep returns `KEEP_REFUSED` (`{refused: 'listening only'}`, new in `@shared/discoverArtist`, with `isKeepRefused`). `null` and the kept-riff shape keep their meanings, and the preload type is the union. `keepGroup` shows `listening only` for it.
- **Quiet aborts:**
  - `countsFor` doesn't log when aborted.
  - `abortArtistIndexWork` also calls the new `abortArtistStemWalks`, which stops `readArtistStemRows` at its next page.
  - `getArtistAnalysed`'s chunk loop checks the flag too.

---

### Task 5: the artist picker and the notice (artist mode goes live)

**Files:**
- Create: `src/renderer/src/components/DiscoverArtistPicker.tsx`
- Modify: `src/renderer/src/App.tsx:1499, :2771`; `src/renderer/src/components/LibraryBrowser.tsx:177-236, :2451-2470`; `src/renderer/src/components/DiscoverPanel.tsx` (points below); `src/renderer/src/components/DiscoverNearbyPopover.tsx:209`

Between this task and Task 6, keep, star and the hearts fetch fail **quietly** in artist mode. Task 4's guards refuse them, but the buttons are not dimmed yet. Ship Task 6 next.

- [x] **Step 1: Lift the state**

`App.tsx`, directly below `const [discoverSlots, setDiscoverSlots] = useState<DiscoverSlot[]>([])` (`:1499`):

```tsx
  // Discover artist mode: the chosen artist, null = me. Session-only, the
  // same lifetime as discoverSlots -- Discover opens on `me` at launch.
  const [discoverArtist, setDiscoverArtist] = useState<string | null>(null)
```

Pass `discoverArtist={discoverArtist}` and `setDiscoverArtist={setDiscoverArtist}` to `<LibraryBrowser` (`:2771`).

In `LibraryBrowser.tsx`:
- Add both to the destructured props (`:177-190`) and to the props type (`:205-236`):

```tsx
  /** Discover artist mode -- App.tsx's own state, a pure pass-through like
   * discoverSlots. null = me. */
  discoverArtist: string | null
  setDiscoverArtist: (artist: string | null) => void
```

- Pass them to `<DiscoverPanel` (`:2451-2470`) as `artist={discoverArtist}` and `onArtistChange={setDiscoverArtist}`.

- [x] **Step 2: Create `DiscoverArtistPicker.tsx`**

```tsx
// src/renderer/src/components/DiscoverArtistPicker.tsx
//
// Discover artist mode's search (spec §1). A popover in DiscoverRadioMenu's
// shape: positioned at (x, y), clamped to the window, dismissed by Escape or
// a click outside (ignoreRef excepted). Monochrome -- this is chrome.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  analysedLabel,
  normalizeArtistPick,
  suggestArtists,
  suggestionLabel,
  type ArtistIndex,
  type ArtistSuggestion
} from '@shared/discoverArtist'

const JAMMED_WITH_POLL_MS = 2000

export function DiscoverArtistPicker({
  x,
  y,
  artist,
  ownUsername,
  onPick,
  onClose,
  ignoreRef,
  footerExtra
}: {
  x: number
  y: number
  artist: string | null
  ownUsername: string
  onPick: (artist: string | null) => void
  onClose: () => void
  ignoreRef: React.RefObject<HTMLElement | null>
  /** Task 8's analyse-overnight button, rendered beside the analysed share. */
  footerExtra?: React.ReactNode
}): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: x, top: y })
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState<ArtistIndex | null>(null)
  const [analysed, setAnalysed] = useState<{ analysed: number; total: number } | null>(null)

  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const margin = 8
    setPosition({
      left: Math.max(margin, Math.min(x, window.innerWidth - rect.width - margin)),
      top: Math.max(margin, Math.min(y, window.innerHeight - rect.height - margin))
    })
  }, [x, y])

  // Same dismissal as DiscoverRadioMenu.
  useEffect(() => {
    function handleDismiss(e: MouseEvent): void {
      if (menuRef.current?.contains(e.target as Node)) return
      if (ignoreRef.current?.contains(e.target as Node)) return
      onClose()
    }
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    const id = setTimeout(() => window.addEventListener('click', handleDismiss, true), 0)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      clearTimeout(id)
      window.removeEventListener('click', handleDismiss, true)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose, ignoreRef])

  // Counts come back at once; jammed-with lands later (main's background
  // walk, ~15 s cold), so poll only while it is pending and we are open.
  useEffect(() => {
    let cancelled = false
    let timer: number | undefined
    function load(): void {
      void window.rifffApi.discoverArtistIndex(ownUsername).then((next) => {
        if (cancelled) return
        setIndex(next)
        if (next.jammedWithPending) timer = window.setTimeout(load, JAMMED_WITH_POLL_MS)
      })
    }
    load()
    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [ownUsername])

  useEffect(() => {
    let cancelled = false
    if (artist === null) return
    void window.rifffApi.discoverArtistAnalysed(artist).then((a) => {
      if (!cancelled) setAnalysed(a)
    })
    return () => {
      cancelled = true
    }
  }, [artist])

  const suggestions = useMemo(
    () => (index ? suggestArtists(index, query, ownUsername) : []),
    [index, query, ownUsername]
  )

  function pick(s: ArtistSuggestion): void {
    onPick(s.kind === 'me' ? null : normalizeArtistPick(s.user, ownUsername))
    onClose()
  }

  return (
    <div
      ref={menuRef}
      role="dialog"
      aria-label="choose an artist"
      style={{
        position: 'fixed',
        left: position.left,
        top: position.top,
        zIndex: 1200, // DiscoverRadioMenu.tsx:267's own value
        width: 260,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: 8,
        background: 'var(--ra-bg-frame)',
        border: '1px solid var(--ra-border-strong)'
      }}
    >
      <input
        autoFocus
        value={query}
        placeholder="search users"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && suggestions.length > 0) pick(suggestions[0])
        }}
        style={{
          fontFamily: 'inherit',
          fontSize: 10,
          padding: '4px 6px',
          background: 'transparent',
          border: '1px solid var(--ra-border)',
          color: 'var(--ra-text)'
        }}
      />
      {query.trim() === '' && index?.jammedWith === null && (
        <span style={{ fontSize: 9, color: 'var(--ra-text-4)' }}>
          finding who you&apos;ve jammed with…
        </span>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 260, overflowY: 'auto' }}>
        {index === null && <span style={{ fontSize: 9, color: 'var(--ra-text-4)' }}>loading…</span>}
        {suggestions.map((s) => (
          <button
            key={s.kind === 'me' ? ':me' : s.user}
            onClick={() => pick(s)}
            style={{
              fontFamily: 'inherit',
              fontSize: 10,
              textAlign: 'left',
              padding: '3px 6px',
              background: 'transparent',
              border: 'none',
              color: 'var(--ra-text-2)',
              cursor: 'pointer'
            }}
          >
            {suggestionLabel(s, ownUsername)}
          </button>
        ))}
      </div>
      {artist !== null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 9 }}>
          <span style={{ color: 'var(--ra-text-3)' }}>
            {analysed ? analysedLabel(analysed.analysed, analysed.total) : 'analysed: …'}
          </span>
          {footerExtra}
        </div>
      )}
    </div>
  )
}
```

`zIndex: 1200` matches `DiscoverRadioMenu.tsx:267`.

- [x] **Step 3: Thread the artist through `DiscoverPanel.tsx`**

3a. **Props.** Add to the destructuring next to `currentUsername` (`:510`) and to the props type (after `currentUsername: string`, `:558`):

```tsx
  /** Discover artist mode (2026-10-01): null = me. App.tsx state. */
  artist: string | null
  onArtistChange: (artist: string | null) => void
```

3b. **The ref and the derived values.** Insert directly after `const globalRollOptions = slotRollOptions(globalModifiers, { hasUsername })` (`:699`):

```tsx
  // Artist mode. Mirrored into a ref for the same reason sourceLeanRef is:
  // radio's picks run from long-lived callbacks.
  const artistRef = useRef<string | null>(artist)
  artistRef.current = artist
  const mode = artistMode(artist, currentUsername)
  /** What every roll sends main -- today's values in own mode (rollFilterForArtist). */
  function rollFilter(): ArtistRollFilter {
    return rollFilterForArtist(artistRef.current, currentUsername, globalRollOptions.onlyOwnStems)
  }
  // Main's mirror, for the guards. Re-sent on the own username changing too.
  useEffect(() => {
    void window.rifffApi.discoverSetArtist(artist, currentUsername)
  }, [artist, currentUsername])
```

If the `react-hooks` lint rule rejects the ref write during render, use the `useEffect` mirror pattern instead. Check how `slotsRef` is kept current in this file (grep `slotsRef.current =`) and copy that pattern.

Imports: `artistMode`, `rollFilterForArtist`, `type ArtistRollFilter`, `artistFieldLabel`, `artistNotice`, `normalizeArtistPick` from `@shared/discoverArtist`, and `DiscoverArtistPicker` from `./DiscoverArtistPicker`.

3c. **The five roll call sites.** Replace the argument triples:
- `pickForSlot`, `:4997-5011`: replace `const rollOptions = globalRollOptions` (`:4969`) with `const f = rollFilter()`. Then each `getDiscoverCandidates(kinds, rollOptions.onlyOwnStems, currentUsername, draw.X)` becomes `getDiscoverCandidates(kinds, f.onlyOwnStems, f.targetUser, draw.X, f.artist)`.
- `rollRandomForSlot`, `:5268-5284`: the same replacement. Each `getRandomDiscoverCandidate(kinds, rollOptions.onlyOwnStems, currentUsername, draw.X)` becomes `getRandomDiscoverCandidate(kinds, f.onlyOwnStems, f.targetUser, draw.X)`. That handler needs no `artist`; see Task 2 Step 11.
- `rollAdjacentForSlot`, `:4881-4885`: add a 4th argument `rollFilter().artist`.

In own mode, `f` equals today's `{ onlyOwnStems: globalRollOptions.onlyOwnStems, targetUser: currentUsername }`, plus a trailing `undefined`. `me` is unchanged.

3d. **The nearby popover.** `DiscoverNearbyPopover.tsx:209`: add a prop `creator?: string` and pass it as the 4th argument of `getAdjacentDiscoverCandidates`. Find `<DiscoverNearbyPopover` in `DiscoverPanel.tsx` (grep) and pass `creator={rollFilter().artist}`.

3e. **The `my sounds` toggle** (`:7463-7475`):

```tsx
              const needsUsername = modifier === 'mine' && !hasUsername
              const overridden = modifier === 'mine' && mode === 'other'
              const disabled = needsUsername || overridden
              ...
                  tooltip={
                    overridden
                      ? `artist mode picks ${artist}'s stems`
                      : needsUsername
                        ? MY_SOUNDS_NEEDS_USERNAME
                        : undefined
                  }
```

3f. **The header field.** In the header row (`:6869`), insert directly **after** `<span style={{ marginLeft: 'auto' }} />` and before the radio column `<div>`:

```tsx
        <button
          ref={artistButtonRef}
          onClick={(e) => {
            if (artistMenu) {
              setArtistMenu(null)
              return
            }
            const rect = e.currentTarget.getBoundingClientRect()
            setArtistMenu({ x: rect.left, y: rect.bottom + 4 })
          }}
          aria-expanded={artistMenu !== null}
          data-tooltip="whose stems discover plays"
          style={{
            fontFamily: 'inherit',
            fontSize: 10,
            padding: '6px 10px',
            background: 'transparent',
            border: '1px solid var(--ra-border)',
            color: mode === 'other' ? 'var(--ra-text)' : 'var(--ra-text-2)',
            cursor: 'pointer'
          }}
        >
          {artistFieldLabel(artist, currentUsername)}
        </button>
        {artistMenu && (
          <DiscoverArtistPicker
            x={artistMenu.x}
            y={artistMenu.y}
            artist={artist}
            ownUsername={currentUsername}
            onPick={(next) => changeArtist(normalizeArtistPick(next, currentUsername))}
            onClose={() => setArtistMenu(null)}
            ignoreRef={artistButtonRef}
          />
        )}
```

State next to the radio menu state (grep `const [radioMenu, setRadioMenu]`):

```tsx
  const [artistMenu, setArtistMenu] = useState<{ x: number; y: number } | null>(null)
  const artistButtonRef = useRef<HTMLButtonElement>(null)
```

`changeArtist`, placed next to `startRadio` (`:6119`). Task 7 extends it.

```tsx
  /** The artist field's pick. Radio off: the next rolls just use it. */
  function changeArtist(next: string | null): void {
    if (next === artistRef.current) return
    artistRef.current = next
    onArtistChange(next)
  }
```

3g. **The notice.** Spec §2 calls for a quiet line, not a modal. Insert directly after the header row's closing `</div>` (`:7096`, just before the `{/* The master strip ...` comment):

```tsx
      {mode === 'other' && artist !== null && (
        <div
          role="note"
          style={{ fontSize: 9, color: 'var(--ra-text-3)', marginTop: -6, marginBottom: 10 }}
        >
          {artistNotice(artist)}
        </div>
      )}
```

- [x] **Step 4: Gate**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all green.

- [x] **Step 5: Commit**

```bash
git add src/renderer/src/components/DiscoverArtistPicker.tsx \
  src/renderer/src/components/DiscoverPanel.tsx src/renderer/src/components/DiscoverNearbyPopover.tsx \
  src/renderer/src/components/LibraryBrowser.tsx src/renderer/src/App.tsx
git commit -m "discover artist: artist field, search picker, notice; rolls follow the artist"
```

**As landed:**
- **Steps 1, 2, 3e, 3f and 3g** are exactly as above.
- **3b: the artist ref follows this file's effect-mirror convention** (`slotsRef`), so it isn't written during render. `changeArtist` still writes it synchronously, so a pick is in force before the next render.
- **3c, `pickForSlot`: `rollOptions` is kept.** It's still read for `preferFavourites`, so `const f = rollFilter()` is added beside it instead of replacing it. In `rollRandomForSlot`, `rollOptions` had no other use and was replaced as written.
- **3d: the popover isn't rendered by `DiscoverPanel` itself but inside `DiscoverSlotRow`.**
  - The row gets a new prop `nearbyCreator`. Its value comes from props (`rollFilterForArtist(artist, currentUsername, false).artist`), not from `rollFilter()`, so render never reads the ref.
  - `DiscoverNearbyPopover` adds `creator` to its `resultKey` and effect deps, so a change of artist re-fetches.
- **`changeArtist`** sits beside the artist-menu state, not beside `startRadio`. Function declarations are hoisted, and Task 7 can extend it in place.
- **Gates:** typecheck clean, lint at the 4 pre-existing warnings, 234 files / 3,828 tests green.
- **Not run in the app:** no agent can see or hear it. Elling's walkthrough is Task 9.

---

### Task 6: listen-only dimming

**Files:** Modify `src/renderer/src/components/DiscoverPanel.tsx`

- [x] **Step 1: One derived set.** Below `const mode = artistMode(...)` (Task 5, 3b):

```tsx
  const listenOnly = listenOnlyActions(mode)
  const listenOnlyTip = artist !== null ? listenOnlyTooltip(artist) : undefined
```

Import `listenOnlyActions` and `listenOnlyTooltip`.

- [x] **Step 2: Guard the functions themselves**, so the phone's keep (`:4328`) and any shortcut obey too.
- First line of `keepGroup` (`:6522`): `if (listenOnly.has('keep')) return`.
- `addToShelf` (`:6503`): `if (listenOnly.has('addToShelf')) return`.
- `addToTimeline` (`:6369`): `if (listenOnly.has('addToTimeline')) return`.
- `fetchHearts` (`:6551`): `if (listenOnly.has('fetchHearts')) return`.

- [x] **Step 3: Dim the four header buttons** (`:7030-7095`). The pattern below is for keep; repeat it with `'fetchHearts'`, `'addToShelf'` and `'addToTimeline'`.

```tsx
        <button
          onClick={() => void keepGroup()}
          disabled={keeping || listenOnly.has('keep')}
          data-tooltip={listenOnly.has('keep') ? listenOnlyTip : 'keep this group'}
          style={{
            ...
            color: keeping || listenOnly.has('keep') ? 'var(--ra-text-4)' : 'var(--ra-text)',
            cursor: keeping || listenOnly.has('keep') ? 'default' : 'pointer',
```

For add to timeline, also swap the accent while dimmed: `border: listenOnly.has('addToTimeline') ? '1px solid var(--ra-border)' : '1px solid var(--ra-stretch-on)'`, and `background: listenOnly.has('addToTimeline') ? 'transparent' : 'var(--ra-stretch-on-bg)'`. Colour is only for audio information, and a dead button carries none.

Add-to-shelf and add-to-timeline have no `data-tooltip` today. Add `data-tooltip={listenOnly.has('addToShelf') ? listenOnlyTip : undefined}`, and the same with `'addToTimeline'`.

- [x] **Step 4: 👍 holds, never stars.** `likeSlot` (`:4712-4719`):

```tsx
  function likeSlot(id: string): void {
    const slot = slots.find((s) => s.id === id)
    if (!slot || slot.candidate === null) return
    const stemCID = slot.candidate.stemCID
    // Listen-only (spec §2): 👍 still holds the row longer, but stars
    // nothing -- always the "would star" branch, never toggleStemFavourite.
    const starring = listenOnly.has('star')
    const opts = {
      starred: starring ? false : stemFavourites.has(stemCID),
      canHold: radioOn && !slot.locked
    }
    setRadioSlotFlags((prev) => likeRadioSlot(prev, id, opts).flags)
    if (!starring) toggleStemFavourite(stemCID)
  }
```

In `DiscoverSlotRow`:
- Add a prop `listenOnlyStars: boolean` next to `onLike` (`:7858`, type `:7937-7939`), passed from `:7280` as `listenOnlyStars={listenOnly.has('star')}`.
- In the 👍 button (`:9133-9143`), make `data-tooltip` start with `listenOnlyStars ? (holding ? 'holding · listening only, nothing is starred' : 'hold · listening only, nothing is starred') : ...today's expression`.
- Leave the button **un-dimmed**: it still holds.

- [x] **Step 5: Gate and commit**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all green.

```bash
git add src/renderer/src/components/DiscoverPanel.tsx
git commit -m "discover artist: listen-only controls dimmed with the tooltip; thumbs-up holds without starring"
```

**As landed:**
- **Steps 1, 3 and 4** are as above.
- **Step 2:** the four functions (and `likeSlot`'s star check) test `refusesNow(action)`, not the render's `listenOnly` set. `refusesNow` is `listenOnlyActions(artistMode(artistRef.current, currentUsername))`. It reads the artist ref, which `changeArtist` writes synchronously, so the guard holds from the moment of a pick:
  - for the phone's keep, which arrives through `remoteCommandRef`;
  - for anything that fires before the dimming render lands.
  - That closes the window where main's mirror (updated by an effect after the render) and the panel disagree, in both directions.
- **Main's refusal is still the backstop.** `keepGroup` shows `listening only` for a `KEEP_REFUSED` answer (Tasks 3–4 review commit).
- **Gates:** typecheck clean, lint at the 4 pre-existing warnings, 234 files / 3,828 tests green.
- **Not run in the app:** no agent can see it. Elling's walkthrough is Task 9.

---

### Task 7: changing artist mid-radio is a course change

**Files:** Modify `src/renderer/src/components/DiscoverPanel.tsx` (`changeArtist`, `skipRadio` `:6002-6045`, `armRadioPick` `:5727-5783`, `commitSlotPick` `:5085`, `stopRadio` `:6046`)

Spec §1 says radio re-picks each row from the new artist, **one row per loop top**. Radio's skip (`skipRadio`) already means "pick one row as radio would and change it at the loop top". The turnover is therefore a queue of skips: one per landing, choosing turnover rows first.

- [ ] **Step 1: The pending set.** Next to `radioSkipPickingRef` (grep its `useRef`):

```tsx
  /** Rows still to turn over after a mid-radio artist change -- one per
   * loop top, through skipRadio (@shared/discoverArtist artistTurnoverIds). */
  const artistTurnoverRef = useRef<Set<string>>(new Set())
```

- [ ] **Step 2: `changeArtist` arms it** (extends Task 5's version):

```tsx
  function changeArtist(next: string | null): void {
    if (next === artistRef.current) return
    artistRef.current = next
    onArtistChange(next)
    if (!radioOnRef.current) return
    artistTurnoverRef.current = artistTurnoverIds(
      slotsRef.current.map((s) => ({ id: s.id, creator: s.candidate?.creatorUserName ?? null })),
      next,
      currentUsername
    )
    void skipRadio()
  }
```

- [ ] **Step 3: `skipRadio` prefers turnover rows.** Replace the `const slotId = pickRadioSlotId(eligible, ...)` statement (`:6006-6011`) with:

```tsx
    const turnoverId = nextTurnoverSlotId(eligible, artistTurnoverRef.current)
    const slotId =
      turnoverId ??
      pickRadioSlotId(eligible, radioLastSlotRef.current, {
        turnover: radioSettings.turnover,
        changedAt: radioChangedAtRef.current,
        turn: radioTurnRef.current,
        flags: radioSlotFlagsRef.current
      })
```

Then directly after `radioSkipPickingRef.current.delete(slotId)` (`:6031`):

```tsx
    // One try per row: a row whose kinds have nothing by the new artist keeps
    // its stem rather than being retried at every loop top.
    artistTurnoverRef.current.delete(slotId)
```

- [ ] **Step 4: Each landing triggers the next.** At the top of `armRadioPick`, after `if (radioSkipWaiting()) return` (`:5735`):

```tsx
    // Mid-radio artist change: keep turning rows over, one per loop top,
    // before radio's own picking resumes.
    if (
      nextTurnoverSlotId(
        radioEligibleSlotIds().filter((id) => !manualChangesRef.current.has(id)),
        artistTurnoverRef.current
      ) !== null
    ) {
      void skipRadio()
      return
    }
```

- [ ] **Step 5: Clean up.**
- At the top of `commitSlotPick` (`:5085`): `artistTurnoverRef.current.delete(id)`. A manual change on a row also counts as turned over.
- In `stopRadio` (`:6046`), next to `radioClockRef.current = null`: `artistTurnoverRef.current = new Set()`.

Import `artistTurnoverIds` and `nextTurnoverSlotId`.

- [ ] **Step 6: Gate and commit**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all green.

```bash
git add src/renderer/src/components/DiscoverPanel.tsx
git commit -m "discover artist: switching artist mid-radio turns rows over, one per loop top"
```

---

### Task 8: analyse overnight

**Queue-size check, done before building (spec §3).** Read-only on 2026-10-01, joining the archive to the own db's `StemFeatureCache`:

| artist | stems | already analysed | to queue | audio (`SUM(FileLength)`) | jams |
|---|---|---|---|---|---|
| bananepoep | 31,398 | 385 (1.2%) | **31,013** | **2.78 GB** (avg 91 KB) | 57 |
| seasickcookie | 26,828 | 333 | 26,495 | — | 33 |
| shapednoise | 21,225 | 372 | 20,853 | — | — |
| elling (reference) | 66,534 | 65,357 (98%) | — | — | 79 |

What this means for a 30k-stem artist:
- **Queue rows: ~31k**, stored in the own db: one indexed table, one transaction, well under a second. The renderer never holds the list; it takes 3 at a time.
- **Downloads: ~2.8 GB**, written where the existing downloader writes, which is `resolveStemPath`. For archive jams that is **the USB drive's** `cache/common/stem_v2/<jam>/…`. The audio stays as a cache, so a later listen is instant.
- **Time: hours of idle time.** The scan runs 3 stems per batch with a 500 ms gap, and only after 1.5 s without interaction (`backgroundScanGate`). At an *estimated* 1.5–2.5 s per batch including download, that is **about 4.5–7 h** for 31k. This is not measured; the decode and analysis cost per stem has not been timed here.
- **Unavailable stems** (`StemUnavailable`, the 403 bucket) are skipped at queue time and on a failed download, so they never loop.

**Decision:** build it as the spec says, with a persisted queue so a multi-night job survives restarts. Show the queued count, and nothing more elaborate.

**Files:**
- Create: `src/main/discoverArtistScanQueue.ts`, `src/main/discoverArtistScanQueue.test.ts`
- Modify: `src/main/riffLibraryStore.ts` (export after `downloadMissingStems`, `:974`), `src/main/index.ts`, `src/preload/index.ts`, `vitest.config.ts`, `src/renderer/src/audio/DiscoverLibraryScan.tsx`, `src/renderer/src/components/DiscoverPanel.tsx`

- [ ] **Step 1: Write the failing test**

```ts
// src/main/discoverArtistScanQueue.test.ts
import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import {
  artistScanQueueSize,
  peekArtistScanQueue,
  queueArtistStems,
  removeFromArtistScanQueue
} from './discoverArtistScanQueue'

function own(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE StemFeatureCache (StemCID TEXT PRIMARY KEY, FeaturesJSON TEXT NOT NULL,
      ExtractedAt INTEGER NOT NULL);
    CREATE TABLE StemUnavailable (StemCID TEXT PRIMARY KEY, Reason TEXT NOT NULL,
      CheckedAt INTEGER NOT NULL);`)
  return db
}

describe('artist scan queue', () => {
  it('queues only unanalysed, fetchable stems, once, in order', () => {
    const db = own()
    db.prepare(`INSERT INTO StemFeatureCache VALUES ('s2', '{}', 1)`).run()
    db.prepare(`INSERT INTO StemUnavailable VALUES ('s3', 'http 403', 1)`).run()
    const rows = ['s1', 's2', 's3', 's4'].map((stemCID) => ({ stemCID, jamCID: 'j1' }))
    expect(queueArtistStems(db, rows, 'tpj', 1000)).toBe(2)
    expect(queueArtistStems(db, rows, 'tpj', 2000)).toBe(0) // idempotent
    expect(artistScanQueueSize(db)).toBe(2)
    expect(peekArtistScanQueue(db, 1)).toEqual([{ stemCID: 's1', jamCID: 'j1', artist: 'tpj' }])
    removeFromArtistScanQueue(db, ['s1'])
    expect(peekArtistScanQueue(db, 5)).toEqual([{ stemCID: 's4', jamCID: 'j1', artist: 'tpj' }])
  })

  it('serves earlier queues first', () => {
    const db = own()
    queueArtistStems(db, [{ stemCID: 'b1', jamCID: 'j' }], 'b', 2000)
    queueArtistStems(db, [{ stemCID: 'a1', jamCID: 'j' }], 'a', 1000)
    expect(peekArtistScanQueue(db, 2).map((r) => r.stemCID)).toEqual(['a1', 'b1'])
  })
})
```

- [ ] **Step 2: Add the CI exclusion (non-optional).** In `vitest.config.ts`, add `'src/main/discoverArtistScanQueue.test.ts',` after `'src/main/discoverArtistIndex.test.ts',`.

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/main/discoverArtistScanQueue.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement**

```ts
// src/main/discoverArtistScanQueue.ts
//
// "analyse overnight" (spec §1, §3): an artist's unanalysed stems queued
// for Discover's existing whole-library scan (DiscoverLibraryScan.tsx),
// which serves this queue first. In the OWN db, so a multi-night job
// survives restarts; the external archive is read-only. The priority tag
// is the Artist column plus the queue's existence.
import type Database from 'better-sqlite3'
import { loadUnavailableStemCIDs } from './stemUnavailableStore'
import type { ArtistStemRow } from './discoverArtistStems'

const DDL = `CREATE TABLE IF NOT EXISTS DiscoverArtistScanQueue (
  StemCID TEXT PRIMARY KEY,
  JamCID TEXT NOT NULL,
  Artist TEXT NOT NULL,
  QueuedAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS DiscoverArtistScanQueue_Order
  ON DiscoverArtistScanQueue (QueuedAt, StemCID);`

const ensured = new WeakSet<Database.Database>()
function ensure(ownDb: Database.Database): void {
  if (ensured.has(ownDb)) return
  ownDb.exec(DDL)
  ensured.add(ownDb)
}

export interface QueuedStem {
  stemCID: string
  jamCID: string
  artist: string
}

/** Returns how many were newly queued. Skips analysed and unavailable stems. */
export function queueArtistStems(
  ownDb: Database.Database,
  rows: readonly ArtistStemRow[],
  artist: string,
  now = Date.now()
): number {
  ensure(ownDb)
  const unavailable = loadUnavailableStemCIDs(ownDb)
  const analysed = ownDb.prepare(`SELECT 1 FROM StemFeatureCache WHERE StemCID = ?`)
  const insert = ownDb.prepare(
    `INSERT OR IGNORE INTO DiscoverArtistScanQueue (StemCID, JamCID, Artist, QueuedAt)
     VALUES (?, ?, ?, ?)`
  )
  let queued = 0
  ownDb.transaction(() => {
    for (const { stemCID, jamCID } of rows) {
      if (unavailable.has(stemCID) || analysed.get(stemCID)) continue
      queued += insert.run(stemCID, jamCID, artist, now).changes
    }
  })()
  return queued
}

export function peekArtistScanQueue(ownDb: Database.Database, limit: number): QueuedStem[] {
  ensure(ownDb)
  return ownDb
    .prepare(
      `SELECT StemCID AS stemCID, JamCID AS jamCID, Artist AS artist
       FROM DiscoverArtistScanQueue ORDER BY QueuedAt, StemCID LIMIT ?`
    )
    .all(limit) as QueuedStem[]
}

export function removeFromArtistScanQueue(ownDb: Database.Database, stemCIDs: string[]): void {
  ensure(ownDb)
  const del = ownDb.prepare(`DELETE FROM DiscoverArtistScanQueue WHERE StemCID = ?`)
  ownDb.transaction(() => {
    for (const id of stemCIDs) del.run(id)
  })()
}

export function artistScanQueueSize(ownDb: Database.Database): number {
  ensure(ownDb)
  return (
    ownDb.prepare(`SELECT COUNT(*) AS n FROM DiscoverArtistScanQueue`).get() as { n: number }
  ).n
}
```

The test's `StemUnavailable` DDL matches `riffLibrarySchema.ts:233-237`.

- [ ] **Step 5: Run it**

Run: `npx vitest run src/main/discoverArtistScanQueue.test.ts`
Expected: PASS.

- [ ] **Step 6: The one-stem download, `src/main/riffLibraryStore.ts`** (after `downloadMissingStems`, `:974`)

```ts
/** One stem's audio for the artist analysis queue -- the SAME downloadOneStem
 * (local-first, StemUnavailable-aware, atomic rename) every riff download
 * uses, without resolving or downloading the rest of its riff. Returns the
 * local path, or null when it can't be fetched. */
export async function downloadStemForAnalysis(
  jamCID: string,
  stemCID: string
): Promise<string | null> {
  const path = resolveStemPath(jamCID, stemCID)
  if (existsSync(path)) return path
  for (const db of candidateDbsForRiff()) {
    const row = db
      .prepare(`SELECT FileEndpoint, FileBucket, FileKey FROM Stems WHERE StemCID = ?`)
      .get(stemCID) as
      | { FileEndpoint: string | null; FileBucket: string | null; FileKey: string | null }
      | undefined
    if (!row?.FileEndpoint || !row.FileKey) continue
    const url = stemDownloadUrl(row.FileEndpoint, row.FileBucket ?? '', row.FileKey)
    return (await downloadOneStem(jamCID, stemCID, url)) ? path : null
  }
  return null
}
```

- [ ] **Step 7: IPC, `src/main/index.ts`** (after `discover-set-artist`)

Import `getArtistStemRows` from `./discoverArtistStems`, the queue functions, and `downloadStemForAnalysis`.

```ts
  ipcMain.handle('discover-queue-artist-analysis', async (_event, artist: string) => {
    const rows = await getArtistStemRows(discoverSourceDbs(), artist)
    const queued = queueArtistStems(openOwnRiffLibraryDb(), rows, artist)
    return { queued, total: rows.length }
  })

  // The scan's priority batch: the next `limit` queued stems, downloaded
  // (in parallel -- limit is the scan's BATCH_SIZE, 3). path null = could
  // not be fetched; the renderer still finishes it so it never loops.
  ipcMain.handle('take-artist-scan-batch', async (_event, limit: number) => {
    const ownDb = openOwnRiffLibraryDb()
    const next = peekArtistScanQueue(ownDb, limit)
    const targets = await Promise.all(
      next.map(async ({ stemCID, jamCID }) => ({
        key: stemCID,
        path: await downloadStemForAnalysis(jamCID, stemCID)
      }))
    )
    return { targets, remaining: artistScanQueueSize(ownDb) }
  })

  ipcMain.handle('finish-artist-scan-batch', (_event, stemCIDs: string[]) =>
    removeFromArtistScanQueue(openOwnRiffLibraryDb(), stemCIDs)
  )
```

Preload:

```ts
  discoverQueueArtistAnalysis: (artist: string): Promise<{ queued: number; total: number }> =>
    ipcRenderer.invoke('discover-queue-artist-analysis', artist),
  takeArtistScanBatch: (
    limit: number
  ): Promise<{ targets: { key: string; path: string | null }[]; remaining: number }> =>
    ipcRenderer.invoke('take-artist-scan-batch', limit),
  finishArtistScanBatch: (stemCIDs: string[]): Promise<void> =>
    ipcRenderer.invoke('finish-artist-scan-batch', stemCIDs),
```

The `analyse overnight` button only reads audio for classification, so spec §2 allows it in listen-only mode. Do not guard it.

- [ ] **Step 8: The scan serves the queue first, `src/renderer/src/audio/DiscoverLibraryScan.tsx`**

8a. Add the constant `const PRIORITY_IDLE_POLL_MS = 30_000`, and a state `const [priorityLeft, setPriorityLeft] = useState(0)`.

8b. Inside the main `.then((targets) => { ... })`, before `function step()`, add:

```ts
        /** One priority batch (artist "analyse overnight"). True when it did work. */
        async function runPriorityBatch(): Promise<boolean> {
          const { targets: queued, remaining } = await window.rifffApi.takeArtistScanBatch(BATCH_SIZE)
          if (cancelled) return false
          setPriorityLeft(remaining)
          if (queued.length === 0) return false
          const ready = queued.filter((t): t is { key: string; path: string } => t.path !== null)
          const needs = ready.length > 0 ? await fetchStemAnalysisNeeds(ready.map((t) => t.path)) : []
          await Promise.allSettled(
            ready.map((t, i) =>
              needs[i] && needsAnyAnalysis(needs[i]) ? analyzeStemOnce(t.path, needs[i]) : undefined
            )
          )
          // Finished either way -- a failed download or analysis must not loop.
          await window.rifffApi.finishArtistScanBatch(queued.map((t) => t.key))
          return true
        }
```

8c. In `step()`, directly after the `backgroundScanGate.mayRun` check, run the priority batch first:

```ts
          void runPriorityBatch()
            .then((didWork) => {
              if (cancelled) return
              if (didWork) {
                window.setTimeout(step, BATCH_DELAY_MS)
                return
              }
              stepLocal()
            })
            .catch((err: unknown) => {
              console.error('DiscoverLibraryScan: priority batch failed:', err)
              if (!cancelled) stepLocal()
            })
```

Rename the rest of today's `step` body (from `if (workIndex >= work.length) {` to the end) into `function stepLocal(): void { ... }`. In `stepLocal`, the branch where `loadNextPage()` resolves `more === false` currently ends the scan. Change it to keep idling for the queue:

```ts
              .then((more) => {
                if (cancelled) return
                window.setTimeout(step, more ? BATCH_DELAY_MS : PRIORITY_IDLE_POLL_MS)
              })
```

8d. Include the queue in the background-work indicator. In the `backgroundWorkRegistry.report` effect, use `left: total - completed + priorityLeft`. Change its early-return condition to `total === null || stopped || (completed >= total && priorityLeft === 0)`, and add `priorityLeft` to the dependency array.

- [ ] **Step 9: The button, `DiscoverPanel.tsx`**

Pass `footerExtra` to `<DiscoverArtistPicker` (Task 5, 3f):

```tsx
            footerExtra={
              artist !== null ? (
                <button
                  disabled={!discoverConsented || analysisQueued !== null}
                  data-tooltip={
                    discoverConsented
                      ? "queue this artist's stems for the overnight scan"
                      : 'turn on library analysis first'
                  }
                  onClick={() => {
                    void window.rifffApi.discoverQueueArtistAnalysis(artist).then((r) => {
                      setAnalysisQueued(`queued ${r.queued.toLocaleString('en-US')}`)
                    })
                  }}
                  style={{
                    fontFamily: 'inherit',
                    fontSize: 9,
                    padding: '2px 6px',
                    background: 'transparent',
                    border: '1px solid var(--ra-border)',
                    color:
                      !discoverConsented || analysisQueued !== null
                        ? 'var(--ra-text-4)'
                        : 'var(--ra-text-2)',
                    cursor: !discoverConsented || analysisQueued !== null ? 'default' : 'pointer'
                  }}
                >
                  {analysisQueued ?? 'analyse overnight'}
                </button>
              ) : undefined
            }
```

Add the state `const [analysisQueued, setAnalysisQueued] = useState<string | null>(null)`, and reset it in `changeArtist` (`setAnalysisQueued(null)`). `discoverConsented` is already a prop (`:567`).

- [ ] **Step 10: Gate and commit**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all green. With an empty queue, the scan behaves as today except that it polls the empty queue every 30 s after finishing: one indexed `SELECT ... LIMIT 3` on the own db.

```bash
git add src/main/discoverArtistScanQueue.ts src/main/discoverArtistScanQueue.test.ts \
  src/main/riffLibraryStore.ts src/main/index.ts src/preload/index.ts vitest.config.ts \
  src/renderer/src/audio/DiscoverLibraryScan.tsx src/renderer/src/components/DiscoverPanel.tsx
git commit -m "discover artist: analyse overnight queues the artist's stems ahead of the library scan"
```

---

### Task 9: Elling's walkthrough

No agent can hear or see the app. This list is the check. Run `npm run dev` with the USB archive mounted.

**`me` is unchanged:**
- [ ] Discover opens on `artist: elling`. No notice shows.
- [ ] Rolls, radio, skip, 👍 (stars), keep, fetch hearts, add to shelf, add to timeline, `my sounds` and nearby jam all behave as before.

**Picking an artist:**
- [ ] Click `artist: elling` and the search opens. Before typing it shows `me · elling`, then (after up to ~15 s on a cold drive, with `finding who you've jammed with…` meanwhile) users by shared jams. The first names should be fancyspectacles, bananepoep and shapednoise.
- [ ] Type `sea`. `seasickcookie · 26,828` is near the top, with prefix matches first.
- [ ] Pick `bananepoep`. The field reads `artist: bananepoep`, and the quiet line appears: `listening to bananepoep's stems. to use them in your own work, ask them first.`
- [ ] The footer shows `analysed: 1%`.

**Listening:**
- [ ] `similar all`, a row's similar, random and nearby jam: every new stem's author is bananepoep.
- [ ] Note the time to first sound for a cold row. Expect a few seconds, since it downloads the riff.
- [ ] A trait-only row (bright, warm…) may say no match. That is expected with 1% analysed.
- [ ] Radio, skip, 👎, mute, solo, the density arc and the radio menu all still work.

**Listen-only:**
- [ ] keep, fetch hearts, add to shelf and add to timeline are dimmed, with the tooltip `listening only: these are bananepoep's stems`.
- [ ] `my sounds` is dimmed.
- [ ] 👍 holds the row while radio runs, but the star does not fill. Its tooltip says nothing is starred.
- [ ] Keep from the phone remote does nothing.

**Course change:**
- [ ] With radio running on `me`, pick `seasickcookie`. One row changes at each loop top until every unlocked, audible row is seasickcookie's.
- [ ] Locked and muted rows are untouched.
- [ ] Pick `me` again, and rows not by elling turn over the same way.

**Session:**
- [ ] Switch to the browse tab and back: still the artist.
- [ ] Close and reopen the library: still the artist.
- [ ] Quit and relaunch: Discover opens on `me`.

**Analyse overnight:**
- [ ] With analysis consent on, press `analyse overnight`. It reads `queued 31,013` (bananepoep).
- [ ] Leave the app idle. The background-work indicator's `analysing stems` count rises by about that much and falls.
- [ ] The USB drive's `stem_v2/<jam>/` gains files.
- [ ] Later, the `analysed:` share rises.
- [ ] With consent off, the button is dimmed: `turn on library analysis first`.

**Reload safety:**
- [ ] With an artist chosen, reload the renderer (View > Reload). Discover is on `me`, and keep works, because main reset its mirror.

---

## Risks

1. **`GROUP BY` over 781k rows on USB.** It uses the covering `Stems_IndexUser`: 2.86 s cold, 0.09 s warm. It is paged by username (500 per page) so no slice blocks main. Its first open on a cold drive still waits about 3 s for the list.
2. **Jammed-with costs ~15 s of sequential USB reads per session** (60–69 s for the naive query). It runs in the background, paged and yielding, but it **competes for the drive with radio's own stem reads and downloads**. That could delay a lap-early warm on a cold drive. It starts only when the picker first opens. If Elling notices, the follow-up is to persist the pairs in the own db, keyed by the `Stems` signal, like `scanTargetCache.ts`. That deviates from the spec's "in memory per session", so ask first.
3. **Time to first sound for a cold artist.**
   - The artist set takes ~1.6 s cold.
   - `resolveCandidateStem` downloads the **whole riff** (`downloadMissingStems`, up to 8 × ~91 KB) onto the USB drive.
   - The rubberband stretch comes on top.
   - Expect 2–5 s for the first row and longer for a full `similar all`. Radio's lap-early pick hides later changes, but the first bed is cold.
4. **Unavailable audio.** One Endlesss bucket 403s every anonymous GET (`stemUnavailableStore.ts`). Older artists may lose a large share of their stems to it, and those stems are skipped. An artist could look sparse for that reason alone.
5. **Trait slots for other artists** are mostly empty (bananepoep is 1.2% analysed). The spec accepts this, and analyse overnight is the remedy.
6. **The analyse-overnight scale:** about 31k downloads (~2.8 GB) onto the USB drive and an estimated 4.5–7 h of idle time per 30k-stem artist. The time is not measured.
7. **Memory.** Each cached artist set holds ~31k ids (~3 MB). The cache is capped at 8 artists per db. The pairs list is 13k entries.
8. **Rows rolled under an artist re-enable keep after switching to `me`.** This grants nothing new, because `me` already rolls every stem in the archive, all from Elling's own 79 jams. The tooltip and notice disappear as they should. Flag it to Elling in the walkthrough if he wants per-row taint.
9. **A renderer reload** resets main's mirror (`did-finish-load`). Discover's own effect re-sends the artist on mount.
10. **The own db has no `CreatorUserName` index.** Its artist and count queries are full scans of 81,814 rows on the SSD (tens of ms). Do not add an index in this plan.

## Self-review against the spec (done)

- **§1 field, search, suggestions and counts:** Tasks 3 and 5. **"jammed with" first:** Task 3, `jammedWithFromPairs` plus the background walk. **The `me` entry:** Task 3, `suggestArtists`.
- **§1 filtering of every pool** (mask, trait, random, nearby, radio's picks): Task 2 for main; Task 5 3c/3d for the five call sites. Radio's picks go through `pickForSlot`.
- **§1 course change, one row per loop top:** Task 7. **Session persistence and opening on `me` at launch:** Task 5 Step 1, Task 4 reset. **Audio on demand and skip on failure:** existing paths, unchanged. **`analysed: N%`:** Tasks 3 and 5. **Analyse overnight:** Task 8.
- **§2 mode rule:** Task 1 `artistMode`. **The off list:** Task 6 (UI) plus Task 4 (main); drag-out, duplicate-to-arrange and export are resolved in the table above. **Dimmed with the tooltip:** Task 6. **What stays on:** untouched. **The notice:** Task 5 3g. **Already-owned stems:** the guard refuses outright. **Analysis allowed:** Task 8, unguarded.
- **§3 `discoverArtist.ts`:** Tasks 1 and 3. **Candidate `artist` param, identical for own:** Task 2. **The search query and its cache:** Task 3. **Analyse overnight with the queue-size check:** Task 8, finding above. **Enforcement:** Task 4.
- **Testing section:** every bullet maps to a test file above; the walkthrough is Task 9.
- **Type names, checked across tasks:**
  - `ArtistMode`, `ListenOnlyAction`, `ArtistRollFilter` (`artist: string | undefined`);
  - `ArtistIndex` (`counts`, `jammedWith`, `jammedWithPending`), `ArtistSuggestion`;
  - `ArtistStemRow` (`stemCID`, `jamCID`), `QueuedStem`;
  - `getArtistStemCIDs`, `getArtistStemRows`, `refusesListenOnly`, `setDiscoverArtistSession`, `resetDiscoverArtistSession`;
  - preload `discoverArtistIndex`, `discoverArtistAnalysed`, `discoverSetArtist`, `discoverQueueArtistAnalysis`, `takeArtistScanBatch`, `finishArtistScanBatch`.
