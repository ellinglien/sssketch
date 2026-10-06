# Combine Artists Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Discover and its radio play **several artists at once**. Choose them in the artist
picker (multi-select); picks are **shared evenly** between them, each artist getting roughly equal
turns (Elling, 2026-10-05). A one-artist selection stays **exactly** today's behaviour.

**Spec:** `docs/superpowers/specs/2026-10-06-combine-artists-design.md`. Read it first, especially
"Decisions taken without Elling (revisit)", §3 (the share) and §9 (one artist is today).

**Architecture:**
- **Two new pure modules, TDD, in `src/shared/`:**
  - `artistSelection.ts`: the selection type, its one constructor, and everything derived from it
    (mode, labels, notice, each member's roll filter, the creator list, tags, turnover, the picker
    gestures);
  - `artistShare.ts`: the even share. It covers the ledger, the order of asking, a pick's attempts,
    begin, end and land, the debt cap, reconcile and the empty memo.
- **One-member delegation:** for one member, every derived function returns the old
  `@shared/discoverArtist` function's answer.
- **Main changes very little:**
  - `get-discover-candidates` is untouched: each turn is today's single-artist call;
  - the session mirror takes the whole selection;
  - the adjacency lookup accepts a creator list;
  - a prewarm IPC warms new members' cached stem lists;
  - no new SQL.
- **The panel funnels every pick** through `artistPickAttempts`, one code path for one or many
  members. It counts landings in `commitSlotPick` and in the two direct slot writes.
- **The picker** gains chips, `+`/`−`, Shift+Enter and Backspace.

**Tech stack:** TypeScript, vitest, React, Electron.

**Repo:** sssketch only (`/Users/nickel/Claudecode/sssketch`). The web radio has no artist mode, so
it is out of scope (spec §8).

**Base:** `master` after the radio simple/advanced view and the move visuals have landed
(sequencing below). The shared and main tasks (1-5) were written against `dc6450dd` and are
independent of both.

**Branch:** `combine-artists` (`git switch -c combine-artists`).

**Commits:** every commit message ends with exactly these two lines, after a blank line:

```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz
```

Commit each task's own files only (`git commit --only <paths>`), never `git add -A`. Other agents
share this working tree.

**Before you start:**
- Run `git status --short`. Note other agents' files and leave them alone.
- Run `npm test` and `npm run typecheck`. The suite is green except the machine-dependent
  engine-spawn tests (the memory `coreaudiod_thread_leak`); without `native-engine/build`, those
  fail with "binary not found".
- **CI's exclude list.** `vitest.config.ts` excludes, under CI, test files that open better-sqlite3.
  - `discoverArtistStems.test.ts` is on the list already (Task 4 adds to it, nothing new).
  - `discoverArtistSession.test.ts` opens no database and runs in CI.
  - Add no new main test file that opens a database.
- **`DiscoverPanel.tsx` moves under you.** Anchor every edit on the quoted code and function names
  (`pickForSlot`, `rollRandomForSlot`, `commitSlotPick`, `changeArtist`, `radioSpareFits`,
  `rollAdjacentForSlot`, `keepGroup`), never on line numbers.

---

## How this plan's code was checked

Scratch copy:
`/private/tmp/claude-501/-Users-nickel-Claudecode-sssketch/16705ad5-406f-4f11-81e4-e91aab27bbc8/scratchpad/combine/`

It holds `src/shared` plus `src/main/discoverArtistSession*.ts` at `dc6450dd`, with node_modules
linked to the repo's. It has one git commit per task: T1 (both shared modules), T2 (Task 3's shared
and session parts), T3 (Task 5).

- **Every code block in Tasks 1, 2, 3 (shared and session parts) and 5 is the scratch copy's file
  or `git diff`, verbatim**, after `prettier --write`.
- **Tests:**
  - `npx vitest run` on the six touched test files: all pass;
  - `npx vitest run src/shared`: 176 files and 2851 tests pass. 3 files fail to load because the
    copy has no `src/renderer` (`buildEngineProject`, `exportToolkitChoice`, `timelineThrows`
    import `../renderer/src/state/store`), not because of this change.
- **Typecheck:** `tsc` with the repo's node config over the new modules and tests: clean.
- **Lint:** `eslint` on the new files: 0 problems. `prettier --check`: clean.
- **Not checked in scratch:**
  - Task 4's main and preload edits (they touch `index.ts` and better-sqlite3 code);
  - the renderer Tasks 6-10.
  - Their edits are specified precisely below, and verified by `npm run typecheck`, `npm run lint`
    and the named suites in the real tree.

## Decisions made in planning (beyond the spec's list)

1. **New modules, not more `discoverArtist.ts`.** It is already 364 lines of single-artist rules.
   The new modules delegate to it, which is how §9's guarantee is pinned function by function.
2. **The share counts landings, not asks.** A pick that is superseded or withdrawn doesn't count.
   Picks in flight count only as `inFlight`, which spreads concurrent picks (a roll-all) without
   charging anyone.
3. **The memo's clock is injected.** The React Compiler's purity rule rejects `Date.now()` inside
   a component-defined function (`pickForSlot`'s own comment). The panel calls a one-line
   module-level `wallClockMs()` in `src/renderer/src/audio/wallClock.ts`.
4. **`rollFilter()` goes away** once Task 7 lands. Its four callers move to the attempts (picks),
   the selection key (spares) and the creator filter (neighbours). Task 6 keeps a temporary
   `rollFilter()` that reads the first member, so every task in between typechecks and behaves.
5. **Main's mirror keeps its two-field shape** (`getDiscoverArtistSession`). An existing test pins
   it. The selection is a separate getter.

## File map

| file | task | change |
|---|---|---|
| `src/shared/artistSelection.ts` (+ test) | 1 | new |
| `src/shared/artistShare.ts` (+ test) | 2 | new |
| `src/shared/discoverArtist.ts` (+ test) | 3 | `creatorAllowed` takes a list |
| `src/main/discoverArtistSession.ts` (+ test) | 3 | selection mirror |
| `src/main/index.ts`, `src/preload/index.ts` | 3, 4 | `discover-set-artist` 4th arg; adjacency creator list; `discover-prewarm-artists` |
| `src/main/discoverAdjacency.ts` | 4 | `creator` type |
| `src/main/discoverArtistStems.ts` (+ test) | 4 | export `MAX_CACHED_ARTISTS`; size pin |
| `src/shared/radioStripModel.ts` (+ test) | 5 | `artistsIncludeMe` |
| `src/renderer/src/App.tsx`, `LibraryBrowser.tsx` | 6 | selection state, pass-through |
| `src/renderer/src/components/DiscoverPanel.tsx` | 6, 7, 8, 9, 10 | everything the panel does |
| `src/renderer/src/audio/wallClock.ts` | 7 | new, one line |
| `src/renderer/src/components/RadioStrip.tsx` | 6 | `artistTooltip` |
| `src/renderer/src/components/DiscoverNearbyPopover.tsx`, `DiscoverSlotRow.tsx` | 8, 10 | creator list; tooltip `by` |
| `src/renderer/src/components/DiscoverArtistPicker.tsx` | 9 | multi-select |

## Task graph

```
T1 artistSelection ──┬─> T2 artistShare ──┐
                     ├─> T3 session+IPC ──┤
                     ├─> T4 main adjacency/prewarm
                     └─> T5 strip model ──┤
                                          v
             T6 panel plumbing ─> T7 share in picks ─> T8 neighbours ─> T9 picker ─> T10 rows ─> T11
```

- **Parallel-safe:** T2, T3, T4 and T5 can run in parallel after T1.
- **Serial:** T6-T10 touch `DiscoverPanel.tsx` and run one after another.
- **Inert:** nothing the user can do creates a combination until T9 (the picker). T6-T8 change no
  behaviour for one artist.

## Sequencing and overlaps with other queued work

- **Build after** the radio simple/advanced view (spec `2026-10-05-radio-simple-view-design.md`,
  plan `2026-10-06-radio-simple-view.md`) and the move visuals (spec
  `2026-10-05-radio-move-visuals-design.md`). Both are ahead of this in Elling's queue, and they
  touch the same files:
  - **`DiscoverPanel.tsx`:**
    - simple view: strip and row props;
    - move visuals: row style;
    - here: state, picks, landings, picker, notices.
  - **`RadioStrip.tsx`:**
    - simple view: a visibility prop;
    - here: one new prop on the `artist` button (T6).
  - **`radioStripModel.ts`:**
    - simple view: a which-controls-show helper;
    - here: one optional context field (T5). They don't overlap textually.
  - **`DiscoverSlotRow.tsx`:**
    - simple view: hiding extras;
    - move visuals: the waveform cell's style;
    - here: the waveform tooltip (T10) and `nearbyCreator`'s type (T8).
- **Simple view hides the picks column**, and with it the strip's `artist` button (spec decision
  12). Don't add it to simple's live bar here: that is a revisit for Elling.
- **Rebase T6-T10** on whatever has landed, by function name.

---

## Phase 1: shared rules and main

### Task 1: The selection (`src/shared/artistSelection.ts`)

**Parallel-safe.** **Depends on:** nothing.

**Files:**
- Create: `src/shared/artistSelection.ts`, `src/shared/artistSelection.test.ts`

- [ ] **Step 1: Write the failing test.** Create `src/shared/artistSelection.test.ts`:

```ts
// src/shared/artistSelection.test.ts -- combine artists' selection (spec 2026-10-06-combine-
// artists-design §1, §2, §5). The first block is the guarantee: a one-member selection is today's
// single artist, function by function.
import { describe, expect, it } from 'vitest'
import {
  MAX_COMBINED_ARTISTS,
  ME_SELECTION,
  applyArtistPick,
  artistSelectionKey,
  artistSelectionLabel,
  artistSelectionNotice,
  artistSelectionTooltip,
  artistSkipWord,
  canAddMember,
  isCombined,
  memberOfPick,
  normalizeArtistSelection,
  pickMatchesArtistSelection,
  rollFilterForMember,
  selectionCreatorFilter,
  selectionHasMe,
  selectionMode,
  selectionOthers,
  selectionTurnoverIds,
  selectionsEqual,
  tagByCreator
} from './artistSelection'
import {
  artistFieldLabel,
  artistMode,
  artistNotice,
  artistTurnoverIds,
  normalizeArtistPick,
  pickMatchesSelection,
  rollFilterForArtist
} from './discoverArtist'

const OWNS = ['elling', '', ' elling ']
const PICKS: (string | null)[] = [
  null,
  '',
  '  ',
  'elling',
  ' elling',
  'bananepoep',
  ' seasickcookie '
]
const SLOTS = [
  { id: 'a', creator: 'elling' },
  { id: 'b', creator: 'bananepoep' },
  { id: 'c', creator: 'seasickcookie' },
  { id: 'd', creator: null },
  { id: 'e', creator: 'shapednoise' }
]
const CANDIDATES = [
  null,
  undefined,
  {},
  { pickedUnderArtist: 'bananepoep' },
  { pickedUnderArtist: 'seasickcookie' }
]

describe('one member is today, exactly', () => {
  for (const own of OWNS) {
    for (const pick of PICKS) {
      const sel = normalizeArtistSelection(pick, own)
      const artist = sel[0]
      const label = `pick ${JSON.stringify(pick)}, own ${JSON.stringify(own)}`
      it(label, () => {
        expect(sel).toHaveLength(1)
        expect(artist).toBe(normalizeArtistPick(pick, own))
        expect(isCombined(sel)).toBe(false)
        expect(selectionMode(sel, own)).toBe(artistMode(artist, own))
        expect(artistSelectionLabel(sel, own)).toBe(artistFieldLabel(artist, own))
        expect(artistSelectionTooltip(sel, own)).toBe('whose stems discover plays')
        expect(artistSelectionNotice(sel, own)).toBe(
          artistMode(artist, own) === 'other' && artist !== null ? artistNotice(artist) : null
        )
        for (const onlyOwn of [false, true]) {
          expect(rollFilterForMember(artist, sel, own, onlyOwn)).toEqual(
            rollFilterForArtist(artist, own, onlyOwn)
          )
        }
        expect(selectionCreatorFilter(sel, own)).toBe(
          rollFilterForArtist(artist, own, false).artist
        )
        expect(selectionTurnoverIds(SLOTS, sel, own)).toEqual(artistTurnoverIds(SLOTS, artist, own))
        for (const c of CANDIDATES) {
          expect(pickMatchesArtistSelection(c, sel)).toBe(pickMatchesSelection(c, artist))
        }
      })
    }
  }
})

describe('normalizeArtistSelection', () => {
  it('reads the legacy single value and arrays alike', () => {
    expect(normalizeArtistSelection(null, 'elling')).toEqual([null])
    expect(normalizeArtistSelection(undefined, 'elling')).toEqual([null])
    expect(normalizeArtistSelection('bananepoep', 'elling')).toEqual(['bananepoep'])
    expect(normalizeArtistSelection(['bananepoep', null], 'elling')).toEqual(['bananepoep', null])
    expect(normalizeArtistSelection(42, 'elling')).toBe(ME_SELECTION)
    expect(normalizeArtistSelection([], 'elling')).toBe(ME_SELECTION)
  })
  it('trims, maps the own name and blanks to me, drops repeats (first kept) and junk', () => {
    expect(normalizeArtistSelection([' a ', 'elling', 'a', '', 7, null, 'b'], 'elling')).toEqual([
      'a',
      null,
      'b'
    ])
  })
  it('caps at MAX_COMBINED_ARTISTS', () => {
    const many = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    expect(normalizeArtistSelection(many, 'elling')).toEqual(many.slice(0, MAX_COMBINED_ARTISTS))
  })
  it('without an own username, me cannot be combined but stays me alone', () => {
    expect(normalizeArtistSelection([null, 'a'], '')).toEqual(['a'])
    expect(normalizeArtistSelection([null], '')).toEqual([null])
    expect(normalizeArtistSelection(['', ''], '')).toEqual([null])
  })
})

describe('a combination', () => {
  const sel = normalizeArtistSelection(['bananepoep', null, 'seasickcookie'], 'elling')

  it('reads as other, with me and its others', () => {
    expect(isCombined(sel)).toBe(true)
    expect(selectionMode(sel, 'elling')).toBe('other')
    expect(selectionHasMe(sel)).toBe(true)
    expect(selectionOthers(sel)).toEqual(['bananepoep', 'seasickcookie'])
  })

  it('labels: two by name, more by count; the tooltip names everyone', () => {
    expect(artistSelectionLabel(sel.slice(0, 2), 'elling')).toBe('artist: bananepoep + elling')
    expect(artistSelectionLabel(sel, 'elling')).toBe('artist: bananepoep + 2 more')
    expect(artistSelectionLabel([null, 'a'], '')).toBe('artist: me + a')
    expect(artistSelectionTooltip(sel, 'elling')).toBe(
      'picks shared evenly: bananepoep, elling, seasickcookie'
    )
  })

  it('the notice names the others only', () => {
    expect(artistSelectionNotice(sel, 'elling')).toBe(
      "listening to bananepoep's and seasickcookie's stems. to use them in your own work, ask them first."
    )
    expect(artistSelectionNotice(['a', 'b', 'c'], 'elling')).toBe(
      "listening to a's, b's and c's stems. to use them in your own work, ask them first."
    )
    expect(artistSelectionNotice([null, 'a'], 'elling')).toBe(artistNotice('a'))
  })

  it('me is the stems you made, whatever my sounds says; others are artist mode', () => {
    for (const onlyOwn of [false, true]) {
      expect(rollFilterForMember(null, sel, 'elling', onlyOwn)).toEqual({
        onlyOwnStems: true,
        targetUser: 'elling',
        artist: undefined
      })
      expect(rollFilterForMember('bananepoep', sel, 'elling', onlyOwn)).toEqual(
        rollFilterForArtist('bananepoep', 'elling', onlyOwn)
      )
    }
  })

  it('neighbour lookups allow every member, me by name', () => {
    expect(selectionCreatorFilter(sel, 'elling')).toEqual(['bananepoep', 'elling', 'seasickcookie'])
  })

  it('tags neighbour candidates by creator', () => {
    const c = (creatorUserName: string | null): { creatorUserName: string | null } => ({
      creatorUserName
    })
    expect(tagByCreator(c('elling'), sel, 'elling')).toEqual(c('elling'))
    expect(tagByCreator(c('bananepoep'), sel, 'elling')).toEqual({
      creatorUserName: 'bananepoep',
      pickedUnderArtist: 'bananepoep'
    })
    expect(tagByCreator(c('stranger'), sel, 'elling')).toEqual(c('stranger'))
    expect(tagByCreator(c(null), sel, 'elling')).toEqual(c(null))
  })

  it('a landed pick counts for its member, or nobody', () => {
    expect(memberOfPick({}, sel)).toBe(null)
    expect(memberOfPick({ pickedUnderArtist: 'seasickcookie' }, sel)).toBe('seasickcookie')
    expect(memberOfPick({ pickedUnderArtist: 'stranger' }, sel)).toBeUndefined()
    expect(memberOfPick({}, ['a', 'b'])).toBeUndefined()
    expect(memberOfPick(null, sel)).toBeUndefined()
    expect(pickMatchesArtistSelection({}, sel)).toBe(true)
    expect(pickMatchesArtistSelection({}, ['a', 'b'])).toBe(false)
    expect(pickMatchesArtistSelection({ pickedUnderArtist: 'b' }, ['a', 'b'])).toBe(true)
  })

  it('turnover: adding an artist turns nothing over; rows by nobody chosen do', () => {
    expect([...selectionTurnoverIds(SLOTS, sel, 'elling')]).toEqual(['e'])
    expect([...selectionTurnoverIds(SLOTS, ['bananepoep', 'shapednoise'], 'elling')]).toEqual([
      'a',
      'c'
    ])
  })

  it('keys and equality', () => {
    expect(artistSelectionKey(['a', null], false)).not.toBe(artistSelectionKey(['a', null], true))
    expect(artistSelectionKey(['a', null], false)).not.toBe(artistSelectionKey([null, 'a'], false))
    expect(selectionsEqual(['a', null], ['a', null])).toBe(true)
    expect(selectionsEqual(['a', null], [null, 'a'])).toBe(false)
  })
})

describe('the picker gestures', () => {
  it('only replaces the selection (today’s pick)', () => {
    expect(applyArtistPick(['a', 'b'], 'c', 'only', 'elling')).toEqual(['c'])
    expect(applyArtistPick(['a', 'b'], 'elling', 'only', 'elling')).toEqual([null])
  })
  it('toggle adds to what is shown, removes, and leaves me when emptied', () => {
    expect(applyArtistPick([null], 'a', 'toggle', 'elling')).toEqual([null, 'a'])
    expect(applyArtistPick(['a'], 'b', 'toggle', 'elling')).toEqual(['a', 'b'])
    expect(applyArtistPick(['a', 'b'], 'a', 'toggle', 'elling')).toEqual(['b'])
    expect(applyArtistPick(['a'], 'a', 'toggle', 'elling')).toEqual([null])
  })
  it('a full selection, and me without a username, cannot take an add', () => {
    const full = ['a', 'b', 'c', 'd', 'e', 'f']
    expect(canAddMember(full, 'g', 'elling')).toBe(false)
    expect(canAddMember(full, 'a', 'elling')).toBe(true)
    expect(applyArtistPick(full, 'g', 'toggle', 'elling')).toBe(full)
    expect(canAddMember(['a'], null, '')).toBe(false)
    expect(applyArtistPick(['a'], null, 'toggle', '')).toEqual(['a'])
  })
})

describe('artistSkipWord', () => {
  it('names the artist, cut to the row', () => {
    expect(artistSkipWord('bananepoep', 'elling')).toBe('no bananepoep fits')
    expect(artistSkipWord('seasickcookie', 'elling')).toBe('no seasickco… fits')
    expect(artistSkipWord(null, 'elling')).toBe('no elling fits')
    expect(artistSkipWord(null, '')).toBe('no me fits')
  })
})
```

- [ ] **Step 2: Run it and see it fail.**
  - Run: `npx vitest run src/shared/artistSelection.test.ts`
  - Expected: FAIL, `Cannot find module './artistSelection'` (or "Failed to resolve import").

- [ ] **Step 3: Implement.** Create `src/shared/artistSelection.ts`:

```ts
// src/shared/artistSelection.ts
//
// Combine artists (docs/superpowers/specs/2026-10-06-combine-artists-design.md): Discover and its
// radio play several artists at once, the picks shared evenly between them (artistShare.ts). This
// module is the selection and everything the panel derives from it.
//
// THE ONE GUARANTEE: a one-member selection is today's single artist, exactly. Every function here
// hands a one-member selection straight to the @shared/discoverArtist function it replaces and
// returns that function's answer untouched (artistSelection.test.ts pins it, input by input).
import {
  artistFieldLabel,
  artistMode,
  artistNotice,
  artistTurnoverIds,
  pickMatchesSelection,
  rollFilterForArtist,
  type ArtistMode,
  type ArtistRollFilter
} from './discoverArtist'

/** One chosen artist: an Endlesss username, or null for `me`. */
export type ArtistMember = string | null

/** The chosen artists, in the order they were added. Never empty (`[null]` is `me`), no
 * duplicates, at most MAX_COMBINED_ARTISTS. Build one with normalizeArtistSelection. */
export type ArtistSelection = readonly ArtistMember[]

/** Six at most, `me` included. discoverArtistStems.ts caches 8 artists per db, so a whole
 * selection's stem lists stay cached while it plays (discoverArtistStems.test.ts pins 8 >= 6). */
export const MAX_COMBINED_ARTISTS = 6

export const ME_SELECTION: ArtistSelection = Object.freeze([null])

/** `me`'s key wherever members key a map: no Endlesss username starts with a colon. */
export const ME_MEMBER_KEY = ':me'

export function memberKey(member: ArtistMember): string {
  return member === null ? ME_MEMBER_KEY : member
}

/** A selection from anything: today's single value (`string | null`, the shape the IPC and any
 * older caller still send), an array of them, or junk. Names are trimmed; a blank or the own
 * username is `me`; a repeat is dropped (the first kept); the list is capped; empty is `me`.
 *
 * Without an own username, `me` cannot be combined: in a combination `me` means the stems you
 * made, and there is no name to match them by. It is dropped from any selection that has someone
 * else in it (the picker greys its `+`). Alone, it is today's `me`. */
export function normalizeArtistSelection(value: unknown, ownUsername: string): ArtistSelection {
  const own = ownUsername.trim()
  const raw: unknown[] = Array.isArray(value) ? value : [value]
  const out: ArtistMember[] = []
  const seen = new Set<string>()
  for (const v of raw) {
    if (v !== null && typeof v !== 'string') continue
    const name = (v ?? '').trim()
    const member: ArtistMember = name === '' || (own !== '' && name === own) ? null : name
    const key = memberKey(member)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(member)
    if (out.length === MAX_COMBINED_ARTISTS) break
  }
  const kept = own === '' && out.length > 1 ? out.filter((m) => m !== null) : out
  return kept.length === 0 ? ME_SELECTION : kept
}

export function isCombined(selection: ArtistSelection): boolean {
  return selection.length > 1
}

export function selectionHasMe(selection: ArtistSelection): boolean {
  return selection.includes(null)
}

/** The named members (everyone but `me`), in selection order. */
export function selectionOthers(selection: ArtistSelection): string[] {
  return selection.filter((m): m is string => m !== null)
}

/** 'own' only for `[me]` (or the own name, which normalizes to it); a combination always has
 * someone else in it. */
export function selectionMode(selection: ArtistSelection, ownUsername: string): ArtistMode {
  if (selection.length === 1) return artistMode(selection[0], ownUsername)
  return 'other'
}

function memberName(member: ArtistMember, ownUsername: string): string {
  if (member !== null) return member
  const own = ownUsername.trim()
  return own !== '' ? own : 'me'
}

/** The header's and the strip's field: today's `artist: name` for one; `artist: a + b` for two;
 * `artist: a + 2 more` beyond. */
export function artistSelectionLabel(selection: ArtistSelection, ownUsername: string): string {
  if (selection.length === 1) return artistFieldLabel(selection[0], ownUsername)
  const first = memberName(selection[0], ownUsername)
  if (selection.length === 2) return `artist: ${first} + ${memberName(selection[1], ownUsername)}`
  return `artist: ${first} + ${selection.length - 1} more`
}

export const ARTIST_FIELD_TOOLTIP = 'whose stems discover plays'

/** The field's tooltip: today's for one; every name, in order, for a combination. */
export function artistSelectionTooltip(selection: ArtistSelection, ownUsername: string): string {
  if (selection.length === 1) return ARTIST_FIELD_TOOLTIP
  return `picks shared evenly: ${selection.map((m) => memberName(m, ownUsername)).join(', ')}`
}

/** `a's`, `a's and b's`, `a's, b's and c's`. */
function possessives(names: readonly string[]): string {
  const each = names.map((n) => `${n}'s`)
  return each.length <= 1 ? (each[0] ?? '') : `${each.slice(0, -1).join(', ')} and ${each.at(-1)}`
}

/** The quiet line under the field, or null when it shows nothing (`me`). One other artist is
 * today's artistNotice word for word; a combination names its others (never `me`). */
export function artistSelectionNotice(
  selection: ArtistSelection,
  ownUsername: string
): string | null {
  if (selectionMode(selection, ownUsername) === 'own') return null
  const others = selectionOthers(selection)
  if (others.length === 1) return artistNotice(others[0])
  return `listening to ${possessives(others)} stems. to use them in your own work, ask them first.`
}

/** What one member's turn sends main. One member: today's rollFilterForArtist, untouched (`me`
 * keeps the `my sounds` toggle). In a combination, `me` is the stems you made -- the `my sounds`
 * path whatever the toggle says -- so every turn is one person's; anyone else is their own
 * artist-mode filter. */
export function rollFilterForMember(
  member: ArtistMember,
  selection: ArtistSelection,
  ownUsername: string,
  onlyOwnStems: boolean
): ArtistRollFilter {
  const own = ownUsername.trim()
  if (selection.length === 1 || member !== null || own === '') {
    return rollFilterForArtist(member, ownUsername, onlyOwnStems)
  }
  return { onlyOwnStems: true, targetUser: own, artist: undefined }
}

/** The creator filter for the riff-neighbour lookups (nearby popover, adjacent, dig): today's
 * single creator (or none, for `me`) for one member; for a combination every member's name, `me`
 * as the own username. */
export function selectionCreatorFilter(
  selection: ArtistSelection,
  ownUsername: string
): string | readonly string[] | undefined {
  if (selection.length === 1) return rollFilterForArtist(selection[0], ownUsername, false).artist
  return selection.map((m) => memberName(m, ownUsername))
}

/** A neighbour-lookup candidate tagged for a combination, by its creator: the own user's stem is
 * `me`'s (untagged, as a `me` roll is); a named member's carries that name (pickedUnderArtist).
 * Anything else is returned untouched. Never used for a one-member selection: those tag with
 * tagPickedUnderArtist as today. */
export function tagByCreator<T extends { creatorUserName?: string | null }>(
  candidate: T,
  selection: ArtistSelection,
  ownUsername: string
): T | (T & { pickedUnderArtist: string }) {
  const creator = candidate.creatorUserName ?? null
  if (creator === null || creator === ownUsername.trim()) return candidate
  return selection.includes(creator) ? { ...candidate, pickedUnderArtist: creator } : candidate
}

/** Which member a landed pick counts for: its pickedUnderArtist when that is a member, `me` (null)
 * when it has none and `me` is a member; undefined when it belongs to no member (rolled under an
 * earlier selection). */
export function memberOfPick(
  candidate: { pickedUnderArtist?: string } | null | undefined,
  selection: ArtistSelection
): ArtistMember | undefined {
  if (!candidate) return undefined
  const tag = candidate.pickedUnderArtist
  if (tag === undefined) return selection.includes(null) ? null : undefined
  return selection.includes(tag) ? tag : undefined
}

/** Whether a pick belongs to the current selection (the turnover's "this row has turned over").
 * One member: today's pickMatchesSelection. */
export function pickMatchesArtistSelection(
  candidate: { pickedUnderArtist?: string } | null | undefined,
  selection: ArtistSelection
): boolean {
  if (selection.length === 1) return pickMatchesSelection(candidate, selection[0])
  return memberOfPick(candidate, selection) !== undefined
}

/** Rows a mid-radio selection change turns over. One member: today's artistTurnoverIds. A
 * combination: every row holding a stem by nobody in it (`me` as the own username). Adding an
 * artist therefore turns nothing over -- the share brings them in pick by pick -- and removing one
 * turns over that artist's rows. */
export function selectionTurnoverIds(
  slots: readonly { id: string; creator: string | null }[],
  selection: ArtistSelection,
  ownUsername: string
): Set<string> {
  if (selection.length === 1) return artistTurnoverIds(slots, selection[0], ownUsername)
  const creators = new Set(selection.map((m) => memberName(m, ownUsername)))
  return new Set(
    slots.filter((s) => s.creator !== null && !creators.has(s.creator)).map((s) => s.id)
  )
}

/** Identity for "picked under the same selection" (a sized build's spare still fits): the
 * selection and the `my sounds` toggle, which together decide every member's filter. */
export function artistSelectionKey(selection: ArtistSelection, onlyOwnStems: boolean): string {
  return JSON.stringify({ selection, onlyOwnStems })
}

export function selectionsEqual(a: ArtistSelection, b: ArtistSelection): boolean {
  return a.length === b.length && a.every((m, i) => m === b[i])
}

/** Whether the picker's `+` can add `member`: not at the cap, and `me` only with an own username
 * (normalizeArtistSelection). A member already in can always be removed. */
export function canAddMember(
  selection: ArtistSelection,
  member: ArtistMember,
  ownUsername: string
): boolean {
  if (selection.includes(member)) return true
  if (selection.length >= MAX_COMBINED_ARTISTS) return false
  return member !== null || ownUsername.trim() !== ''
}

/** The picker's two gestures. `only`: this artist alone (a click or Enter -- today's pick).
 * `toggle`: add or remove it, keeping the rest (`+`/`-`, Shift+click, Shift+Enter). Removing the
 * last member leaves `me`; an add the selection cannot take (canAddMember) changes nothing. */
export function applyArtistPick(
  selection: ArtistSelection,
  member: ArtistMember,
  how: 'only' | 'toggle',
  ownUsername: string
): ArtistSelection {
  if (how === 'only') return normalizeArtistSelection([member], ownUsername)
  if (selection.includes(member)) {
    return normalizeArtistSelection(
      selection.filter((m) => m !== member),
      ownUsername
    )
  }
  if (!canAddMember(selection, member, ownUsername)) return selection
  return normalizeArtistSelection([...selection, member], ownUsername)
}

/** The flash on a row whose turn's artist had nothing for it (radio only, like `no fave fits`):
 * the name cut to fit the row's word budget. */
export function artistSkipWord(member: ArtistMember, ownUsername: string): string {
  const name = memberName(member, ownUsername)
  const cut = name.length > 10 ? `${name.slice(0, 9)}…` : name
  return `no ${cut} fits`
}
```

- [ ] **Step 4: Run it and see it pass.**
  - Run: `npx vitest run src/shared/artistSelection.test.ts src/shared/discoverArtist.test.ts`
  - Expected: PASS (38 tests in the new file; the old file unchanged).
  - Then `npm run typecheck` and
    `npx eslint src/shared/artistSelection.ts src/shared/artistSelection.test.ts`: clean.

- [ ] **Step 5: Commit.**

```bash
git commit --only src/shared/artistSelection.ts src/shared/artistSelection.test.ts -m "combine artists: the selection (@shared/artistSelection) -- one constructor, one member delegates to discoverArtist

<two attribution lines>"
```

### Task 2: The even share (`src/shared/artistShare.ts`)

**Parallel-safe** with Tasks 3-5. **Depends on:** Task 1.

**Files:**
- Create: `src/shared/artistShare.ts`, `src/shared/artistShare.test.ts`

- [ ] **Step 1: Write the failing test.** Create `src/shared/artistShare.test.ts`:

```ts
// src/shared/artistShare.test.ts -- combine artists' even share (spec 2026-10-06-combine-artists-
// design §3). Seeded: every "random" here is seededRandom, so a failure reproduces.
import { describe, expect, it } from 'vitest'
import {
  ARTIST_EMPTY_TTL_MS,
  ARTIST_SHARE_MAX_OWED,
  EMPTY_ARTIST_MEMO,
  EMPTY_ARTIST_SHARE,
  artistKnownEmpty,
  artistPickAttempts,
  artistShareOrder,
  beginArtistTurn,
  endArtistTurn,
  landArtistTurn,
  noteArtistEmpty,
  reconcileArtistShare,
  type ArtistShareLedger
} from './artistShare'
import { memberKey, type ArtistMember, type ArtistSelection } from './artistSelection'
import { rollFilterForArtist } from './discoverArtist'
import { seededRandom } from './seededRandom'

function counting(random: () => number): { random: () => number; calls: () => number } {
  let n = 0
  return {
    random: () => {
      n += 1
      return random()
    },
    calls: () => n
  }
}

/** Sequential picks: ask in order, the first member that `fits` the row lands. */
function simulate(
  selection: ArtistSelection,
  rows: readonly string[],
  fits: (member: ArtistMember, row: string) => boolean,
  seed: string
): { landed: ArtistMember[]; ledger: ArtistShareLedger } {
  const random = seededRandom(seed)
  let ledger = reconcileArtistShare(EMPTY_ARTIST_SHARE, selection)
  const landed: ArtistMember[] = []
  for (const row of rows) {
    const who = artistShareOrder(selection, ledger, random).find((m) => fits(m, row))
    if (who === undefined) continue
    ledger = landArtistTurn(ledger, who)
    landed.push(who)
  }
  return { landed, ledger }
}

function tally(landed: readonly ArtistMember[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const m of landed) out[memberKey(m)] = (out[memberKey(m)] ?? 0) + 1
  return out
}

function longestRun(landed: readonly ArtistMember[], member: ArtistMember): number {
  let best = 0
  let run = 0
  for (const m of landed) {
    run = m === member ? run + 1 : 0
    best = Math.max(best, run)
  }
  return best
}

describe('one member', () => {
  it('is one attempt with today’s filter, and draws nothing', () => {
    for (const [sel, own, onlyOwn] of [
      [[null], 'elling', false],
      [[null], 'elling', true],
      [[null], '', false],
      [['bananepoep'], 'elling', false],
      [['bananepoep'], '', true]
    ] as [ArtistSelection, string, boolean][]) {
      const r = counting(seededRandom('one'))
      const attempts = artistPickAttempts(sel, EMPTY_ARTIST_SHARE, r.random, own, onlyOwn)
      expect(attempts).toEqual([
        { member: sel[0], filter: rollFilterForArtist(sel[0], own, onlyOwn) }
      ])
      expect(r.calls()).toBe(0)
    }
  })
  it('still draws nothing with a ledger and a skip memo', () => {
    const r = counting(Math.random)
    let ledger = reconcileArtistShare(EMPTY_ARTIST_SHARE, ['a'])
    ledger = landArtistTurn(beginArtistTurn(ledger, 'a'), 'a')
    expect(artistShareOrder(['a'], ledger, r.random, new Set(['a']))).toEqual(['a'])
    expect(r.calls()).toBe(0)
  })
})

describe('even turns', () => {
  it('three artists who all fit: exactly level after every round', () => {
    const sel: ArtistSelection = ['a', 'b', null]
    const { landed } = simulate(sel, Array(300).fill('row'), () => true, 'level')
    expect(tally(landed)).toEqual({ a: 100, b: 100, ':me': 100 })
    // never more than one apart at any point
    const running: Record<string, number> = {}
    for (const m of landed) {
      running[memberKey(m)] = (running[memberKey(m)] ?? 0) + 1
      const v = Object.values(running)
      expect(Math.max(...v) - (v.length < 3 ? 0 : Math.min(...v))).toBeLessThanOrEqual(1)
    }
  })

  it('size does not matter: the share counts turns, not stems', () => {
    // a: 30,000 stems, b: 300 -- both fit every row, so both get half
    const { landed } = simulate(['a', 'b'], Array(200).fill('row'), () => true, 'size')
    expect(tally(landed)).toEqual({ a: 100, b: 100 })
  })

  it('ties break randomly, and reproducibly from a seed', () => {
    const order = (seed: string): ArtistMember[] =>
      simulate(['a', 'b', 'c'], Array(30).fill('row'), () => true, seed).landed
    expect(order('s1')).toEqual(order('s1'))
    expect(order('s1')).not.toEqual(order('s2'))
    expect(order('s1').slice(0, 3)).not.toEqual(['a', 'b', 'c']) // not plain round-robin
  })

  it('picks in flight count: a roll-all of four spreads two and two', () => {
    const random = seededRandom('flight')
    const sel: ArtistSelection = ['a', 'b']
    let ledger = reconcileArtistShare(EMPTY_ARTIST_SHARE, sel)
    const asked: ArtistMember[] = []
    for (let i = 0; i < 4; i += 1) {
      const m = artistShareOrder(sel, ledger, random)[0]
      ledger = beginArtistTurn(ledger, m)
      asked.push(m)
    }
    expect(tally(asked)).toEqual({ a: 2, b: 2 })
    for (const m of asked) ledger = endArtistTurn(ledger, m)
    expect(ledger.inFlight).toEqual({ a: 0, b: 0 })
    expect(endArtistTurn(ledger, 'a').inFlight.a).toBe(0) // never below zero
  })
})

describe('a member with nothing for a row', () => {
  it('passes its turn on; the others share the rest evenly', () => {
    const sel: ArtistSelection = ['nobass', 'b', 'c']
    const rows = Array(300).fill('bass')
    const { landed } = simulate(sel, rows, (m) => m !== 'nobass', 'pass')
    expect(tally(landed)).toEqual({ b: 150, c: 150 })
  })

  it('is owed at most MAX_OWED, so it never takes a burst when it fits again', () => {
    const sel: ArtistSelection = ['nobass', 'b']
    const rows = [...Array(100).fill('bass'), ...Array(100).fill('drums')]
    const fits = (m: ArtistMember, row: string): boolean => m !== 'nobass' || row !== 'bass'
    const { landed } = simulate(sel, rows, fits, 'owed')
    const drums = landed.slice(100)
    expect(longestRun(drums, 'nobass')).toBeLessThanOrEqual(ARTIST_SHARE_MAX_OWED + 1)
    const t = tally(drums)
    expect(Math.abs(t.nobass - t.b)).toBeLessThanOrEqual(ARTIST_SHARE_MAX_OWED + 1)
  })

  it('a row nobody fits is skipped by everyone and charges nobody', () => {
    const { landed, ledger } = simulate(['a', 'b'], ['x', 'x'], () => false, 'none')
    expect(landed).toEqual([])
    expect(ledger.landed).toEqual({ a: 0, b: 0 })
  })
})

describe('the empty memo', () => {
  it('skips a member known empty for those kinds, until it expires', () => {
    let memo = noteArtistEmpty(EMPTY_ARTIST_MEMO, 'a', 'bass', 1000)
    expect([...artistKnownEmpty(memo, ['a', 'b'], 'bass', 1000)]).toEqual(['a'])
    expect([...artistKnownEmpty(memo, ['a', 'b'], 'drums', 1000)]).toEqual([])
    expect([...artistKnownEmpty(memo, ['a', 'b'], 'bass', 1000 + ARTIST_EMPTY_TTL_MS)]).toEqual([])
    memo = noteArtistEmpty(memo, null, 'bass', 1000)
    expect([...artistKnownEmpty(memo, [null, 'a'], 'bass', 2000)].sort()).toEqual([':me', 'a'])
  })
  it('the order leaves skipped members out, but never everyone', () => {
    const random = seededRandom('skip')
    const ledger = reconcileArtistShare(EMPTY_ARTIST_SHARE, ['a', 'b'])
    expect(artistShareOrder(['a', 'b'], ledger, random, new Set(['a']))).toEqual(['b'])
    expect(artistShareOrder(['a', 'b'], ledger, random, new Set(['a', 'b'])).sort()).toEqual([
      'a',
      'b'
    ])
  })
})

describe('reconcileArtistShare', () => {
  it('a joining artist starts level with the least served, not at zero', () => {
    let ledger = reconcileArtistShare(EMPTY_ARTIST_SHARE, ['a', 'b'])
    for (let i = 0; i < 9; i += 1) ledger = landArtistTurn(landArtistTurn(ledger, 'a'), 'b')
    ledger = landArtistTurn(ledger, 'a')
    const next = reconcileArtistShare(ledger, ['a', 'b', 'c'])
    expect(next.landed).toEqual({ a: 10, b: 9, c: 9 })
  })
  it('drops members gone, and starts a fresh selection from zero', () => {
    let ledger = reconcileArtistShare(EMPTY_ARTIST_SHARE, ['a', 'b'])
    ledger = beginArtistTurn(landArtistTurn(ledger, 'a'), 'b')
    expect(reconcileArtistShare(ledger, ['b'])).toEqual({ landed: { b: 0 }, inFlight: { b: 1 } })
    expect(reconcileArtistShare(ledger, ['x', 'y'])).toEqual({
      landed: { x: 0, y: 0 },
      inFlight: {}
    })
  })
  it('the debt cap holds across landings', () => {
    let ledger = reconcileArtistShare(EMPTY_ARTIST_SHARE, ['a', 'b'])
    for (let i = 0; i < 50; i += 1) ledger = landArtistTurn(ledger, 'b')
    expect(ledger.landed).toEqual({ a: 48, b: 50 })
  })
})
```

- [ ] **Step 2: Run it and see it fail.**
  - Run: `npx vitest run src/shared/artistShare.test.ts`
  - Expected: FAIL, unresolved `./artistShare`.

- [ ] **Step 3: Implement.** Create `src/shared/artistShare.ts`:

```ts
// src/shared/artistShare.ts
//
// Combine artists' even share (docs/superpowers/specs/2026-10-06-combine-artists-design.md §3):
// with several artists chosen, each gets roughly equal turns -- NOT one pooled list, where an
// artist with 30,000 stems would drown one with 300 (Elling, 2026-10-05).
//
// A TURN is a fresh pick landing on a row (DiscoverPanel's commitSlotPick, hook returns excluded),
// counted for the member it was picked under (memberOfPick). Each pick asks the member furthest
// behind first; picks still in flight count as theirs already, so a roll-all spreads at once. A
// member with nothing for a row passes the turn on (artistPickAttempts' order) and stays owed --
// at most ARTIST_SHARE_MAX_OWED turns, so a member who could not use its turns for a while never
// takes a burst of them when rows it fits come back.
//
// Pure. `random` is injected: the app passes Math.random, the tests a seededRandom. A one-member
// selection never draws from it, so today's single-artist picks consume exactly the random numbers
// they did before (artistShare.test.ts pins it).
import {
  memberKey,
  rollFilterForMember,
  type ArtistMember,
  type ArtistSelection
} from './artistSelection'
import type { ArtistRollFilter } from './discoverArtist'

export interface ArtistShareLedger {
  /** Turns landed per member (memberKey), current members only. */
  readonly landed: Readonly<Record<string, number>>
  /** Picks asked of a member and not back yet (memberKey). */
  readonly inFlight: Readonly<Record<string, number>>
}

export const EMPTY_ARTIST_SHARE: ArtistShareLedger = Object.freeze({
  landed: Object.freeze({}),
  inFlight: Object.freeze({})
})

/** How many turns a member can be owed. */
export const ARTIST_SHARE_MAX_OWED = 2

/** How long "this member has nothing for these kinds" is believed (noteArtistEmpty): long enough
 * that a radio of bass rows does not ask an artist without bass every pick, short enough that the
 * overnight scan's new classifications show up within a few minutes. */
export const ARTIST_EMPTY_TTL_MS = 5 * 60_000

function get(record: Readonly<Record<string, number>>, key: string): number {
  return record[key] ?? 0
}

/** Who to ask, in order: least landed-plus-in-flight first; ties in a random order (drawn only
 * where there is a tie, so never for one member). Members in `skip` (memberKey; known to have
 * nothing for this row, artistKnownEmpty) are left out, unless that would leave nobody, in which
 * case they are all asked anyway (the memo can be wrong, and a row must never go unpicked because
 * of it). */
export function artistShareOrder(
  selection: ArtistSelection,
  ledger: ArtistShareLedger,
  random: () => number,
  skip: ReadonlySet<string> = new Set()
): ArtistMember[] {
  const asked = selection.filter((m) => !skip.has(memberKey(m)))
  const members = asked.length > 0 ? asked : [...selection]
  if (members.length === 1) return members
  const load = (m: ArtistMember): number =>
    get(ledger.landed, memberKey(m)) + get(ledger.inFlight, memberKey(m))
  const byLoad = new Map<number, ArtistMember[]>()
  for (const m of members) {
    const l = load(m)
    const group = byLoad.get(l)
    if (group) group.push(m)
    else byLoad.set(l, [m])
  }
  const out: ArtistMember[] = []
  for (const l of [...byLoad.keys()].sort((a, b) => a - b)) {
    const group = byLoad.get(l) as ArtistMember[]
    // Fisher-Yates, drawing only for a real tie.
    for (let i = group.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1))
      ;[group[i], group[j]] = [group[j], group[i]]
    }
    out.push(...group)
  }
  return out
}

export interface ArtistPickAttempt {
  member: ArtistMember
  filter: ArtistRollFilter
}

/** One pick's plan: the members to try, in order, each with the filter its turn sends main. A
 * one-member selection is exactly one attempt with today's filter (rollFilterForArtist), and
 * draws nothing from `random`. */
export function artistPickAttempts(
  selection: ArtistSelection,
  ledger: ArtistShareLedger,
  random: () => number,
  ownUsername: string,
  onlyOwnStems: boolean,
  skip?: ReadonlySet<string>
): ArtistPickAttempt[] {
  return artistShareOrder(selection, ledger, random, skip).map((member) => ({
    member,
    filter: rollFilterForMember(member, selection, ownUsername, onlyOwnStems)
  }))
}

function bump(
  record: Readonly<Record<string, number>>,
  key: string,
  by: number
): Record<string, number> {
  return { ...record, [key]: Math.max(0, get(record, key) + by) }
}

/** A pick asked of `member` (before the pick's first await). */
export function beginArtistTurn(
  ledger: ArtistShareLedger,
  member: ArtistMember
): ArtistShareLedger {
  return { ...ledger, inFlight: bump(ledger.inFlight, memberKey(member), 1) }
}

/** That pick is back, whatever came of it (pickForSlot's finally). Never below zero. */
export function endArtistTurn(ledger: ArtistShareLedger, member: ArtistMember): ArtistShareLedger {
  return { ...ledger, inFlight: bump(ledger.inFlight, memberKey(member), -1) }
}

/** A pick by `member` landed on a row. Every member is then raised to within MAX_OWED of the
 * leader: the debt cap. Members with no entry yet (reconcileArtistShare gives every member one)
 * are left as they are. */
export function landArtistTurn(ledger: ArtistShareLedger, member: ArtistMember): ArtistShareLedger {
  const landed = bump(ledger.landed, memberKey(member), 1)
  const floor = Math.max(...Object.values(landed)) - ARTIST_SHARE_MAX_OWED
  for (const key of Object.keys(landed)) landed[key] = Math.max(landed[key], floor)
  return { ...ledger, landed }
}

/** The ledger for a new selection. Members kept keep their counts; a member joining starts level
 * with the least-served one kept (it does not get a burst of catch-up turns); members gone are
 * dropped. A selection sharing nobody with the last starts from zero. */
export function reconcileArtistShare(
  ledger: ArtistShareLedger,
  selection: ArtistSelection
): ArtistShareLedger {
  const keys = selection.map(memberKey)
  const kept = keys.filter((k) => k in ledger.landed)
  const start = kept.length > 0 ? Math.min(...kept.map((k) => ledger.landed[k])) : 0
  const landed: Record<string, number> = {}
  const inFlight: Record<string, number> = {}
  for (const k of keys) {
    landed[k] = k in ledger.landed ? ledger.landed[k] : start
    if (get(ledger.inFlight, k) > 0) inFlight[k] = ledger.inFlight[k]
  }
  return { landed, inFlight }
}

/** "This member had nothing for these kinds" (memberKey|kindsKey -> expiry, ms). */
export type ArtistEmptyMemo = ReadonlyMap<string, number>

export const EMPTY_ARTIST_MEMO: ArtistEmptyMemo = new Map()

function memoKey(member: ArtistMember, kindsKey: string): string {
  return `${memberKey(member)}|${kindsKey}`
}

/** Remember that `member`'s pool for `kindsKey` was EMPTY (no candidate at all, both sources --
 * not merely all already on other rows, which changes from pick to pick). */
export function noteArtistEmpty(
  memo: ArtistEmptyMemo,
  member: ArtistMember,
  kindsKey: string,
  now: number
): ArtistEmptyMemo {
  const next = new Map(memo)
  next.set(memoKey(member, kindsKey), now + ARTIST_EMPTY_TTL_MS)
  return next
}

/** The members (memberKey) believed empty for `kindsKey` now: artistShareOrder's `skip`. */
export function artistKnownEmpty(
  memo: ArtistEmptyMemo,
  selection: ArtistSelection,
  kindsKey: string,
  now: number
): Set<string> {
  const out = new Set<string>()
  for (const m of selection) {
    const until = memo.get(memoKey(m, kindsKey))
    if (until !== undefined && until > now) out.add(memberKey(m))
  }
  return out
}
```

- [ ] **Step 4: Run it and see it pass.**
  - Run: `npx vitest run src/shared/artistShare.test.ts`
  - Expected: PASS, 14 tests.
  - Then `npm run typecheck` and eslint on both files: clean.
  - **If a seeded expectation fails after an edit to the order,** don't re-pin the seed. The
    evenness assertions are the contract; the seeds only make failures reproducible.
    `ties break randomly` asserts `s1` differs from `s2` and from plain rotation. If a change to
    the shuffle makes those coincide, pick other seeds and say so in the commit.

- [ ] **Step 5: Commit** (`git commit --only src/shared/artistShare.ts src/shared/artistShare.test.ts`):
  "combine artists: the even share (@shared/artistShare) -- landed + in flight, ties random, debt
  cap 2, empty memo".

### Task 3: `creatorAllowed` takes a list; main's mirror takes the selection

**Parallel-safe.** **Depends on:** Task 1.

**Files:**
- Modify: `src/shared/discoverArtist.ts`, `src/shared/discoverArtist.test.ts`,
  `src/main/discoverArtistSession.ts`, `src/main/discoverArtistSession.test.ts`,
  `src/main/index.ts`, `src/preload/index.ts`

- [ ] **Step 1: Write the failing tests** (the test hunks of this diff):

```diff
--- a/src/main/discoverArtistSession.test.ts
+++ b/src/main/discoverArtistSession.test.ts
@@ -2,6 +2,7 @@
 import { afterEach, describe, expect, it, vi } from 'vitest'
 import {
   currentArtistMode,
+  getDiscoverArtistSelection,
   getDiscoverArtistSession,
   keepBlockedForPhone,
   refusesKeep,
@@ -53,6 +54,32 @@ describe('discover artist session', () => {
     expect(currentArtistMode()).toBe('own')
   })
 
+  it("reads a combined selection; one member stays today's push", () => {
+    expect(
+      setDiscoverArtistSession({
+        artist: 'bananepoep',
+        ownUsername: 'elling',
+        artists: ['bananepoep', null, 'tpj']
+      })
+    ).toBe('other')
+    expect(getDiscoverArtistSelection()).toEqual(['bananepoep', null, 'tpj'])
+    expect(getDiscoverArtistSession()).toEqual({
+      artist: 'bananepoep + tpj',
+      ownUsername: 'elling'
+    })
+    expect(setDiscoverArtistSession({ artist: null, ownUsername: 'elling', artists: [null] })).toBe(
+      'own'
+    )
+    expect(getDiscoverArtistSession()).toEqual({ artist: null, ownUsername: 'elling' })
+    setDiscoverArtistSession({ artist: 'tpj', ownUsername: 'elling' })
+    expect(getDiscoverArtistSelection()).toEqual(['tpj'])
+    expect(currentArtistMode()).toBe('other')
+    setDiscoverArtistSession({ artist: null, ownUsername: 'elling', artists: 'junk-but-a-name' })
+    expect(getDiscoverArtistSelection()).toEqual(['junk-but-a-name'])
+    resetDiscoverArtistSession()
+    expect(getDiscoverArtistSelection()).toEqual([null])
+  })
+
   it('the refused fetch reads as a label', () => {
     expect(heartFetchLabel({ ok: false, reason: 'listening only' })).toBe('listening only')
   })
--- a/src/shared/discoverArtist.test.ts
+++ b/src/shared/discoverArtist.test.ts
@@ -127,6 +127,12 @@ describe('creatorAllowed', () => {
     expect(creatorAllowed('elling', 'tpj')).toBe(false)
     expect(creatorAllowed(null, 'tpj')).toBe(false)
   })
+  it('allows any of a combination', () => {
+    expect(creatorAllowed('tpj', ['elling', 'tpj'])).toBe(true)
+    expect(creatorAllowed('bananepoep', ['elling', 'tpj'])).toBe(false)
+    expect(creatorAllowed(null, ['elling', 'tpj'])).toBe(false)
+    expect(creatorAllowed(undefined, ['elling'])).toBe(false)
+  })
 })
 
 describe('artist turnover (course change on switch)', () => {
```

- [ ] **Step 2: Run and see them fail.**
  - Run: `npx vitest run src/shared/discoverArtist.test.ts src/main/discoverArtistSession.test.ts`
  - Expected: FAIL. `getDiscoverArtistSelection` is not exported, and `creatorAllowed` with a list
    returns false for `'tpj'`. (TypeScript also flags the array argument; vitest doesn't
    typecheck, so the assertion is what fails.)

- [ ] **Step 3: Implement** (the source hunks):

```diff
--- a/src/main/discoverArtistSession.ts
+++ b/src/main/discoverArtistSession.ts
@@ -6,12 +6,18 @@
 // main refusing keep while the UI shows `me`. No electron, no sqlite --
 // unit-tested in CI.
 import {
-  artistMode,
   blockedActions,
   listenOnlyActions,
   type ArtistMode,
   type ListenOnlyAction
 } from '@shared/discoverArtist'
+import {
+  ME_SELECTION,
+  normalizeArtistSelection,
+  selectionMode,
+  selectionOthers,
+  type ArtistSelection
+} from '@shared/artistSelection'
 
 export interface DiscoverArtistSession {
   artist: string | null
@@ -19,15 +25,21 @@ export interface DiscoverArtistSession {
 }
 
 /** What the renderer pushes: the session, plus (optionally) the artists
- * whose stems still play on Discover's rows (lingeringArtists). */
+ * whose stems still play on Discover's rows (lingeringArtists), and the
+ * whole selection when several artists are combined (spec 2026-10-06-
+ * combine-artists-design §6). Without `artists`, `artist` alone is the
+ * selection -- today's push, read exactly as before. */
 export interface DiscoverArtistSessionUpdate extends DiscoverArtistSession {
   lingering?: readonly string[]
+  artists?: unknown
 }
 
 const ME: DiscoverArtistSession = Object.freeze({ artist: null, ownUsername: '' })
 let session: DiscoverArtistSession = ME
 /** Kept apart from `session` so its shape stays the two fields. */
 let lingering: readonly string[] = []
+/** The whole selection (combine artists); `[artist]` when the push named one. */
+let selection: ArtistSelection = ME_SELECTION
 
 /** Only non-empty strings; anything else is not a list of artists. */
 function artistList(value: unknown): string[] {
@@ -36,18 +48,32 @@ function artistList(value: unknown): string[] {
 }
 
 export function setDiscoverArtistSession(next: DiscoverArtistSessionUpdate): ArtistMode {
-  const artist = next.artist === null ? null : next.artist.trim() || null
-  session = { artist, ownUsername: next.ownUsername.trim() }
+  const ownUsername = next.ownUsername.trim()
+  if (next.artists !== undefined) {
+    selection = normalizeArtistSelection(next.artists, ownUsername)
+    // `artist` names the others for the refusal log: one member is that member, as before.
+    const named = selection.length === 1 ? selection[0] : selectionOthers(selection).join(' + ')
+    session = { artist: named, ownUsername }
+  } else {
+    const artist = next.artist === null ? null : next.artist.trim() || null
+    session = { artist, ownUsername }
+    selection = artist === null ? ME_SELECTION : [artist]
+  }
   lingering = artistList(next.lingering)
   return currentArtistMode()
 }
 
+/** The whole selection, for anything main does per artist (the prewarm). */
+export function getDiscoverArtistSelection(): ArtistSelection {
+  return selection
+}
+
 export function getDiscoverArtistSession(): DiscoverArtistSession {
   return session
 }
 
 export function currentArtistMode(): ArtistMode {
-  return artistMode(session.artist, session.ownUsername)
+  return selectionMode(selection, session.ownUsername)
 }
 
 /** True when `action` must be refused now. While the mode is `other`, the
@@ -92,5 +118,6 @@ export function keepBlockedForPhone(): boolean {
 
 export function resetDiscoverArtistSession(): void {
   lingering = []
+  selection = ME_SELECTION
   session = ME
 }
--- a/src/shared/discoverArtist.ts
+++ b/src/shared/discoverArtist.ts
@@ -101,12 +101,15 @@ export function rollFilterForArtist(
   return { onlyOwnStems: true, targetUser: name, artist: name }
 }
 
-/** The nearby-jam filter: no artist allows everything. */
+/** The nearby-jam filter: no artist allows everything; one artist (a string, today's) only that
+ * creator; a combination (a list, @shared/artistSelection selectionCreatorFilter) any of them. */
 export function creatorAllowed(
   creator: string | null | undefined,
-  artist: string | undefined
+  artist: string | readonly string[] | undefined
 ): boolean {
-  return artist === undefined || creator === artist
+  if (artist === undefined) return true
+  if (typeof artist === 'string') return creator === artist
+  return creator != null && artist.includes(creator)
 }
 
 /** Rows a mid-radio artist change turns over: every row holding a stem
```

- [ ] **Step 4: The IPC's optional 4th argument.**
  - `src/main/index.ts`, the `discover-set-artist` handler:

```diff
   ipcMain.handle(
     'discover-set-artist',
-    (_event, artist: unknown, ownUsername: unknown, lingering?: unknown) =>
+    (_event, artist: unknown, ownUsername: unknown, lingering?: unknown, artists?: unknown) =>
       setDiscoverArtistSession({
         artist: typeof artist === 'string' ? artist : null,
         ownUsername: typeof ownUsername === 'string' ? ownUsername : '',
         // Sanitised in the session (only non-empty strings count).
-        lingering: Array.isArray(lingering) ? (lingering as string[]) : []
+        lingering: Array.isArray(lingering) ? (lingering as string[]) : [],
+        // Combine artists: the whole selection, normalized in the session. Absent (an older
+        // renderer): `artist` alone is the selection, as before.
+        ...(artists !== undefined ? { artists } : {})
       })
   )
```

  - `src/preload/index.ts`, `discoverSetArtist`:

```diff
   discoverSetArtist: (
     artist: string | null,
     ownUsername: string,
-    lingering?: string[]
+    lingering?: string[],
+    /** Combine artists: the whole selection (null = me). */
+    artists?: readonly (string | null)[]
   ): Promise<ArtistMode> =>
-    ipcRenderer.invoke('discover-set-artist', artist, ownUsername, lingering),
+    ipcRenderer.invoke('discover-set-artist', artist, ownUsername, lingering, artists),
```

  (Match the existing parameter list exactly; if `lingering` is typed differently there, keep its
  type.)

- [ ] **Step 5: Run.**
  - `npx vitest run src/shared/discoverArtist.test.ts src/main/discoverArtistSession.test.ts`:
    PASS.
  - `npm run typecheck`: clean. `creatorAllowed`'s only other caller, `discoverAdjacency.ts`, still
    passes a string.

- [ ] **Step 6: Commit** the six files: "combine artists: main's mirror holds the selection,
  creatorAllowed takes a list".

### Task 4: Main: adjacency creator list, prewarm, cache-size pin

**Parallel-safe.** **Depends on:** Task 1.

**Files:**
- Modify: `src/main/discoverAdjacency.ts`, `src/main/discoverArtistStems.ts`,
  `src/main/discoverArtistStems.test.ts`, `src/main/index.ts`, `src/preload/index.ts`

- [ ] **Step 1: Failing test, the cache-size pin.** Append to
  `src/main/discoverArtistStems.test.ts`:

```ts
import { MAX_COMBINED_ARTISTS } from '@shared/artistSelection'
import { MAX_CACHED_ARTISTS } from './discoverArtistStems'

describe('combine artists', () => {
  it('a whole selection fits the per-db artist cache', () => {
    expect(MAX_CACHED_ARTISTS).toBeGreaterThanOrEqual(MAX_COMBINED_ARTISTS)
  })
})
```

  (Merge the imports into the file's existing import block.) Run
  `npx vitest run src/main/discoverArtistStems.test.ts`: FAIL, `MAX_CACHED_ARTISTS` is not
  exported (`undefined >= 6` is false).

- [ ] **Step 2: Export it.** In `src/main/discoverArtistStems.ts`, change
  `const MAX_CACHED_ARTISTS = 8` to `export const MAX_CACHED_ARTISTS = 8`, and add to its doc
  comment: "Combine artists keeps a whole selection (at most MAX_COMBINED_ARTISTS) cached:
  discoverArtistStems.test.ts pins it." Run the test: PASS.

- [ ] **Step 3: The adjacency creator list.**
  - `src/main/discoverAdjacency.ts`, `getAdjacentDiscoverCandidates`:
    - the parameter becomes `creator?: string | readonly string[]` (doc: "Discover artist mode:
      only this creator's stems; combine artists: any of these (creatorAllowed)").
    - Replace `const creatorName = creator?.trim() || undefined` with:

```ts
  // A blank creator is no filter, never "only stems with no creator". A list (combine artists)
  // is trimmed and kept only when something is left in it.
  const creatorName: string | readonly string[] | undefined =
    typeof creator === 'string'
      ? creator.trim() || undefined
      : creator !== undefined
        ? (() => {
            const names = creator.map((c) => c.trim()).filter((c) => c !== '')
            return names.length > 0 ? names : undefined
          })()
        : undefined
```

  - `src/main/index.ts`, `get-adjacent-discover-candidates`: the handler's `creator?: string`
    becomes `creator?: unknown`. Pass it through as:

```ts
        typeof creator === 'string'
          ? creator.trim() || undefined
          : Array.isArray(creator)
            ? creator.filter((c): c is string => typeof c === 'string')
            : undefined,
```

  - `src/preload/index.ts`, `getAdjacentDiscoverCandidates`: `creator?: string` becomes
    `creator?: string | readonly string[]`.

- [ ] **Step 4: The prewarm IPC.**
  - `src/main/index.ts`, next to `discover-artist-analysed`:

```ts
  // Combine artists (spec 2026-10-06-combine-artists-design §6): warm each newly chosen artist's
  // stem list (getArtistStemCIDs' cache) one after another, so a new artist's first turn is not a
  // cold index read on the USB archive. A warm-up only: failures are logged, never thrown.
  ipcMain.handle('discover-prewarm-artists', async (_event, names: unknown) => {
    if (!Array.isArray(names)) return
    const dbs = [...new Set(listJamsWithDb().map(({ db }) => db))]
    for (const name of names) {
      if (typeof name !== 'string' || name.trim() === '') continue
      try {
        await getArtistStemCIDs(dbs, name.trim())
      } catch (err) {
        console.error(`discover-prewarm-artists(${name}) failed:`, err)
      }
    }
  })
```

  (`get-discover-candidates` derives its dbs the same way: `jams.map((j) => j.dbForJam)` from
  `listJamsWithDb()`. Use that exact expression if the file has moved on.)
  - `src/preload/index.ts`:

```ts
  /** Combine artists: warm newly chosen artists' stem lists in main. */
  discoverPrewarmArtists: (names: string[]): Promise<void> =>
    ipcRenderer.invoke('discover-prewarm-artists', names),
```

- [ ] **Step 5: Run.**
  - `npm run typecheck`: clean.
  - `npx vitest run src/main/discoverAdjacency.test.ts src/main/discoverArtistStems.test.ts`:
    PASS.

- [ ] **Step 6: Commit** the five files: "combine artists: main takes a creator list for
  neighbours, prewarms chosen artists, pins the cache size".

### Task 5: The strip's context (`radioStripModel.ts`)

**Parallel-safe.** **Depends on:** nothing (Task 1 only for meaning).

**Files:**
- Modify: `src/shared/radioStripModel.ts`, `src/shared/radioStripModel.test.ts`

- [ ] **Step 1: Failing test** (the test hunk):

```diff
--- a/src/shared/radioStripModel.test.ts
+++ b/src/shared/radioStripModel.test.ts
@@ -302,6 +302,15 @@ describe('radioStripModel: greyed, not omitted', () => {
       control(radioStripModel(settings(), { ...CTX, artistMode: true }), 'my-sounds')?.disabled
     ).toBe(true)
   })
+
+  it("combined with me: faves live (it acts on me's turns), my sounds still greyed", () => {
+    const combined = { ...CTX, artistMode: true, artistsIncludeMe: true }
+    expect(control(radioStripModel(settings(), combined), 'faves')?.dimmed).toBe(false)
+    expect(control(radioStripModel(settings(), combined), 'my-sounds')?.disabled).toBe(true)
+    expect(
+      control(radioStripModel(settings(), { ...CTX, artistsIncludeMe: true }), 'faves')?.dimmed
+    ).toBe(false)
+  })
 })
 
 describe('radioStripModel: options come from the shared constants', () => {
```

  Run `npx vitest run src/shared/radioStripModel.test.ts`: FAIL (faves still dimmed).

- [ ] **Step 2: Implement:**

```diff
--- a/src/shared/radioStripModel.ts
+++ b/src/shared/radioStripModel.ts
@@ -144,6 +144,9 @@ export interface RadioStripGroup {
 export interface RadioStripContext {
   /** Discover artist mode (another artist's stems). */
   artistMode: boolean
+  /** Combine artists: `me` is one of several chosen artists, so the faves dial still acts on
+   * `me`'s turns and is not dimmed. Absent: false (today). */
+  artistsIncludeMe?: boolean
   /** The user's own username is known (`my sounds` needs it). */
   hasUsername: boolean
   /** The open project's sound settings, normalized (the panel's `sound ?? app defaults`). */
@@ -312,7 +315,7 @@ export function radioStripModel(
     panel('faves', FAVES_LABEL, {
       tooltip: FAVES_TOOLTIP,
       sets: ['faves'],
-      dimmed: ctx.artistMode
+      dimmed: ctx.artistMode && ctx.artistsIncludeMe !== true
     }),
     panel('source', 'source · endlesss - other', { tooltip: 'right for other, left for endlesss' }),
     panel('matching', 'matching', { tooltip: 'right for more matching' }),
```

- [ ] **Step 3: Run:** PASS (25 tests). `npm run typecheck`: clean, since the field is optional.

- [ ] **Step 4: Commit** both files: "combine artists: faves live in the strip when me is combined".

---

## Phase 2: the panel

No component tests in this codebase (CLAUDE.md, "Testing conventions"). Each task ends with
`npm run typecheck`, `npm run lint`, `npx vitest run src/shared`, and the greps it names. No agent
can click the app; say so in the report.

### Task 6: Selection state, labels, notices, the course change, the mirror

**Depends on:** Tasks 1, 3, 4, 5.

**Files:**
- Modify: `src/renderer/src/App.tsx`, `src/renderer/src/components/LibraryBrowser.tsx`,
  `src/renderer/src/components/DiscoverPanel.tsx`,
  `src/renderer/src/components/RadioStrip.tsx`

What changes (behaviour for one artist: none):

- [ ] **Step 1: `App.tsx`.**
  - Replace `const [discoverArtist, setDiscoverArtist] = useState<string | null>(null)` with
    `const [discoverArtists, setDiscoverArtists] = useState<ArtistSelection>(ME_SELECTION)`.
  - Import both from `@shared/artistSelection`.
  - Keep the comment, amended: "the chosen artists (combine artists, spec 2026-10-06), `[null]` =
    me. Session-only".
  - Pass `discoverArtists` and `setDiscoverArtists` to `LibraryBrowser`.

- [ ] **Step 2: `LibraryBrowser.tsx`.** The pure pass-through:
  - `discoverArtist: string | null` becomes `discoverArtists: ArtistSelection`;
  - `setDiscoverArtist` becomes `setDiscoverArtists: (next: ArtistSelection) => void`;
  - at the `DiscoverPanel` site, `artist={discoverArtist}` → `artists={discoverArtists}` and
    `onArtistChange={setDiscoverArtist}` → `onArtistsChange={setDiscoverArtists}`.

- [ ] **Step 3: `DiscoverPanel.tsx` props and the derived values.** The props `artist` and
  `onArtistChange` become `artists: ArtistSelection` and
  `onArtistsChange: (next: ArtistSelection) => void`. In the artist-mode block (anchor:
  `const artistRef = useRef<string | null>(artist)`), replace through the `discoverSetArtist`
  effect with:

```ts
  // Artist mode, now a selection (combine artists, spec 2026-10-06-combine-artists-design).
  // Mirrored into a ref for the same reason sourceLeanRef is: radio's picks run from long-lived
  // callbacks. Written from an effect, this file's ref-mirroring convention, and synchronously by
  // changeArtists so a pick is in force before the next render lands.
  const artistsRef = useRef<ArtistSelection>(artists)
  useEffect(() => {
    artistsRef.current = artists
  }, [artists])
  const mode = selectionMode(artists, currentUsername)
  const combined = isCombined(artists)
  /** The creator filter as of this render, for children (the nearby popover): today's single
   * creator for one artist, every member's name for a combination. */
  const artistCreator = selectionCreatorFilter(artists, currentUsername)
  /** The others' names, for the single-name tooltips (one other artist: that name). */
  const othersLabel = selectionOthers(artists).join(' + ')
  function refusesNow(action: ListenOnlyAction): boolean {
    const nowMode = selectionMode(artistsRef.current, currentUsername)
    const still = nowMode === 'own' ? lingeringArtists(slotsRef.current) : []
    return blockedActions(nowMode, still).has(action)
  }
  /** TEMPORARY until Task 7: the first member's filter -- for one artist exactly today's
   * rollFilterForArtist (artistSelection.test.ts). Task 7 deletes it. */
  function rollFilter(): ArtistRollFilter {
    const sel = artistsRef.current
    return rollFilterForMember(sel[0], sel, currentUsername, globalRollOptions.onlyOwnStems)
  }
  const lingering = mode === 'own' ? lingeringArtists(slots) : []
  const lingeringKey = lingering.join('\n')
  const listenOnly = blockedActions(mode, lingering)
  // Main's mirror, for the guards. `artist` is the single member (today's push, for an older
  // main); `artists` the whole selection.
  const artistsKey = JSON.stringify(artists)
  useEffect(() => {
    const sel = JSON.parse(artistsKey) as (string | null)[]
    void window.rifffApi.discoverSetArtist(
      sel.length === 1 ? sel[0] : (sel.find((m) => m !== null) ?? null),
      currentUsername,
      lingeringKey === '' ? [] : lingeringKey.split('\n'),
      sel
    )
  }, [artistsKey, currentUsername, lingeringKey])
```

  Keep every existing comment that still applies; drop the ones naming `artistRef`.

- [ ] **Step 4: The share's ledger ref.** Add it beside `artistsRef`. It is reconciled
  synchronously in `changeArtists`, so it's never a render behind.

```ts
  /** Combine artists' even share (@shared/artistShare): turns landed and picks in flight per
   * member, this session. Reconciled on every selection change (changeArtists). */
  const artistShareRef = useRef<ArtistShareLedger>(reconcileArtistShare(EMPTY_ARTIST_SHARE, artists))
  /** Members known to have nothing for a row's kinds (noteArtistEmpty), for 5 minutes. */
  const artistEmptyRef = useRef<ArtistEmptyMemo>(EMPTY_ARTIST_MEMO)
  /** The picker's `turns:` line re-reads the ledger on this tick (Task 9). */
  const [artistShareTick, setArtistShareTick] = useState(0)
```

- [ ] **Step 5: `changeArtist` becomes `changeArtists`.** Anchor: `function changeArtist(next:
  string | null): void`. Replace the function with:

```ts
  /** The artist field's pick. Radio off: the next rolls just use it. Radio on: a course change --
   * every row by nobody chosen turns over, one per loop top (spec §4), through skipRadio. One
   * artist to one artist is today's switch exactly; a combination skips only when something has
   * to turn over, so adding an artist changes no row (the share brings them in). */
  function changeArtists(next: ArtistSelection): void {
    const prev = artistsRef.current
    if (selectionsEqual(next, prev)) return
    artistsRef.current = next
    artistShareRef.current = reconcileArtistShare(artistShareRef.current, next)
    artistEmptyRef.current = EMPTY_ARTIST_MEMO
    setArtistShareTick((n) => n + 1)
    onArtistsChange(next)
    setAnalysisQueued(null)
    const added = selectionOthers(next).filter((m) => !prev.includes(m))
    if (added.length > 0) void window.rifffApi.discoverPrewarmArtists(added)
    if (!radioOnRef.current) return
    artistTurnoverRef.current = selectionTurnoverIds(
      slotsRef.current.map((s) => ({ id: s.id, creator: s.candidate?.creatorUserName ?? null })),
      next,
      currentUsername
    )
    const bothSingle = prev.length === 1 && next.length === 1
    if (!bothSingle && artistTurnoverRef.current.size === 0) return
    // Never two rows at one loop top: a skip already waiting (or still picking) lands first, and
    // its landing re-arms -- armRadioPick then starts the turnover. A pick still in flight for the
    // OLD selection is dropped by skipRadio itself.
    if (!radioSkipWaiting()) void skipRadio()
  }
```

  Then replace every other `artistRef.current` read with the selection versions:
  - in `commitSlotPick`, `pickMatchesSelection(pick.candidate, artistRef.current)` →
    `pickMatchesArtistSelection(pick.candidate, artistsRef.current)`;
  - in `keepGroup`, `artistMode(artistRef.current, currentUsername)` →
    `selectionMode(artistsRef.current, currentUsername)`. Keep it inlined: the React Compiler note
    there.
  - `rg -n "artistRef\b" src/renderer/src/components/DiscoverPanel.tsx` must print nothing.

- [ ] **Step 6: Labels, notices, tooltips.** Replace each single-artist read:
  - **The header button (radio off):**
    - `{artistFieldLabel(artist, currentUsername)}` → `{artistSelectionLabel(artists, currentUsername)}`;
    - its `data-tooltip="whose stems discover plays"` →
      `data-tooltip={artistSelectionTooltip(artists, currentUsername)}`.
  - **The notice:**
    - `{mode === 'other' && artist !== null && (` → `{artistSelectionNotice(artists, currentUsername) !== null && (`;
    - `{artistNotice(artist)}` → `{artistSelectionNotice(artists, currentUsername)}`.
  - **`listenOnlyTooltip(artist)`** (the `mode === 'other' && artist !== null` ternary) →
    `mode === 'other' ? listenOnlyTooltip(othersLabel) : …` (the existing else branch).
  - **Faves and my-sounds tooltips:** both the strip's `picks` and the radio-off header row's
    `Dial`/toggle read `` `artist mode picks ${artist}'s stems` `` today. Make them:
    - faves: `mode === 'other' && !selectionHasMe(artists) ? \`artist mode picks ${othersLabel}'s stems\` : combined ? 'faves act on your turns' : FAVES_TOOLTIP`;
    - my sounds: `combined ? 'combined: me is your own stems' : mode === 'other' ? \`artist mode picks ${othersLabel}'s stems\` : !hasUsername ? MY_SOUNDS_NEEDS_USERNAME : undefined`;
    - the header row's faves `Dial` `dimmed` prop: `mode === 'other' && !selectionHasMe(artists)`.
  - **The strip's `picks`:**
    - `artistLabel: artistSelectionLabel(artists, currentUsername)`;
    - `artistTooltip: artistSelectionTooltip(artists, currentUsername)`.
  - **The strip context:** `artistMode: mode === 'other'` stays; add
    `artistsIncludeMe: combined && selectionHasMe(artists)`.
  - **The picker** (until Task 9):
    - `artist={artists.length === 1 ? artists[0] : selectionOthers(artists)[0] ?? null}`;
    - `onPick={(next) => changeArtists(applyArtistPick(artistsRef.current, normalizeArtistPick(next, currentUsername), 'only', currentUsername))}`.
  - **`analyse overnight`:** leave it reading that `artist` value until Task 9.
  - **`nearbyCreator={artistCreator}`:** unchanged in Task 6. `DiscoverSlotRow`'s prop is still
    `string | undefined`, so pass `typeof artistCreator === 'string' ? artistCreator : undefined`
    until Task 8.
  - **Imports:**
    - drop the now-unused `artistFieldLabel`, `artistNotice`, `artistTurnoverIds`,
      `pickMatchesSelection` and `rollFilterForArtist`;
    - add `@shared/artistSelection`'s names and `@shared/artistShare`'s ledger names.
    - `npm run lint` (with `noUnusedLocals`) says what is left over.

- [ ] **Step 7: `RadioStrip.tsx`.** `picks` gains `artistTooltip: string`. On the `artist`
  button, add `data-tooltip={picks.artistTooltip}`. If the button already carries a
  `data-tooltip` from the strip model (`'whose stems discover plays'`), replace that with
  `picks.artistTooltip`: for one artist it is the same string (`ARTIST_FIELD_TOOLTIP`).

- [ ] **Step 8: Check.**
  - `npm run typecheck`, `npm run lint` and `npx vitest run src/shared`: clean, green.
  - `rg -n "discoverArtist\b|setDiscoverArtist\b|onArtistChange\b" src/renderer` prints nothing.
  - **Behaviour:** one artist only. No UI can make a combination yet.

- [ ] **Step 9: Commit** the four files: "combine artists: Discover holds a selection; one artist
  is today's path".

### Task 7: The share in every pick

**Depends on:** Tasks 2, 6.

**Files:**
- Create: `src/renderer/src/audio/wallClock.ts`
- Modify: `src/renderer/src/components/DiscoverPanel.tsx`

- [ ] **Step 1: `wallClock.ts`:**

```ts
// src/renderer/src/audio/wallClock.ts -- the wall clock, for callers inside components: the React
// Compiler's purity rule rejects Date.now() inside a component-defined function (DiscoverPanel's
// pickForSlot), and an imported call is how this codebase reads time there.
export function wallClockMs(): number {
  return Date.now()
}
```

- [ ] **Step 2: `pickForSlot`: the attempts.**
  1. **Compute the plan.** Right after the generation claim and before the `try`, alongside
     `const lean = …`, add:

```ts
    // Combine artists (@shared/artistShare): who this pick asks, in order. One artist: one
    // attempt, today's filter, and no random draw (artistShare.test.ts).
    const selection = artistsRef.current
    const kindsKeyNow = slotKindsKey(kinds)
    const attempts = artistPickAttempts(
      selection,
      artistShareRef.current,
      Math.random,
      currentUsername,
      globalRollOptions.onlyOwnStems,
      artistKnownEmpty(artistEmptyRef.current, selection, kindsKeyNow, wallClockMs())
    )
    let attempt = 0
    artistShareRef.current = beginArtistTurn(artistShareRef.current, attempts[0].member)
```

  2. **End the turn.** In the `finally`, before the existing `if (!yieldRow && …)`:

```ts
      artistShareRef.current = endArtistTurn(artistShareRef.current, attempts[attempt].member)
```

  3. **Filter by attempt.** Replace `const f = rollFilter()` with
     `let f = attempts[0].filter`, and give `fetchPool` the filter it fetches under. Its signature
     becomes `async (only?: string[], ff: ArtistRollFilter = f)`, and every `f.` inside it becomes
     `ff.`.
     - That covers `ff.onlyOwnStems`, `ff.targetUser`, `ff.artist`, and
       `tagPickedUnderArtist(c, ff.artist)`.
     - The default reads `f` at call time, so a call after `f` moves on uses the new member.
  4. **Faves and dig.** Both read `f` as it is when they run: the first attempt.
     - `const faves = f.artist === undefined ? favesRef.current : 0` is unchanged. In a
       combination it is live only when `me` is asked first.
     - The dig near draw changes in Task 8.
  5. **Pass the turn on.** Replace the block

```ts
      if (candidates === null) {
        if (rerollGenerationRef.current.get(id) !== myGeneration) return null
        candidates = await fetchPool()
        if (candidates === null) return null
      }
```

  with:

```ts
      if (candidates === null) {
        if (rerollGenerationRef.current.get(id) !== myGeneration) return null
        candidates = await fetchPool()
        if (candidates === null) return null
        // Combine artists: a member with nothing new for this row passes its turn on to the next
        // (never silent: logged, and flashed on the row while radio runs). An EMPTY pool is
        // remembered for these kinds; one that is all duplicates is not (that changes pick to
        // pick). Nobody with anything new: the first non-empty pool, whole -- duplicates beat
        // nothing, as today.
        let firstNonEmpty: DiscoverCandidate[] | null = candidates.length > 0 ? candidates : null
        while (!candidates.some(unused) && attempt + 1 < attempts.length) {
          const skipped = attempts[attempt].member
          if (candidates.length === 0) {
            artistEmptyRef.current = noteArtistEmpty(
              artistEmptyRef.current,
              skipped,
              kindsKeyNow,
              wallClockMs()
            )
          }
          const word = artistSkipWord(skipped, currentUsername)
          console.log(`[artist-share] pickForSlot(${kindsKeyNow}) -- ${word}`)
          flashPickFallback(word, `artist-${attempt}`)
          artistShareRef.current = endArtistTurn(artistShareRef.current, skipped)
          attempt += 1
          artistShareRef.current = beginArtistTurn(artistShareRef.current, attempts[attempt].member)
          f = attempts[attempt].filter
          if (rerollGenerationRef.current.get(id) !== myGeneration) return null
          const next = await fetchPool(undefined, f)
          if (next === null) return null
          candidates = next
          if (firstNonEmpty === null && next.length > 0) firstNonEmpty = next
        }
        if (!candidates.some(unused) && firstNonEmpty !== null) candidates = firstNonEmpty
      }
```

  - **The last member's empty pool** isn't memoed. That's harmless: the memo is a shortcut, never
    a rule.
  - **`flashPickFallback`** is declared above the faves draw, so it is in scope. Its key must be
    unique per row and pick: `artist-<n>` plus its own `@id@generation`.

- [ ] **Step 3: `rollRandomForSlot`: the same plan.**
  - Compute `attempts` as in Step 2. Begin before the `try`; end in the `finally` for
    `attempts[attempt].member`.
  - Replace `const f = rollFilter()` and the two `getRandomDiscoverCandidate` calls with a loop:

```ts
      const draw = drawSoundSource(sourceLeanRef.current)
      let candidate: DiscoverCandidate | null = null
      for (;;) {
        const f = attempts[attempt].filter
        // Falls back only on no candidate at all, unlike pickForSlot (see its note above).
        candidate = await window.rifffApi.getRandomDiscoverCandidate(
          kinds,
          f.onlyOwnStems,
          f.targetUser,
          draw.first
        )
        if (candidate !== null) candidate = tagPickedUnderArtist(candidate, f.artist)
        if (candidate === null && draw.fallback !== null) {
          if (rerollGenerationRef.current.get(id) !== myGeneration) return
          candidate = await window.rifffApi.getRandomDiscoverCandidate(
            kinds,
            f.onlyOwnStems,
            f.targetUser,
            draw.fallback
          )
          if (candidate !== null) candidate = tagPickedUnderArtist(candidate, f.artist)
        }
        if (candidate !== null || attempt + 1 >= attempts.length) break
        if (rerollGenerationRef.current.get(id) !== myGeneration) return
        const skipped = attempts[attempt].member
        console.log(
          `[artist-share] rollRandomForSlot -- ${artistSkipWord(skipped, currentUsername)}`
        )
        artistShareRef.current = endArtistTurn(artistShareRef.current, skipped)
        attempt += 1
        artistShareRef.current = beginArtistTurn(artistShareRef.current, attempts[attempt].member)
      }
```

  - For one artist the loop runs once and is exactly today's two calls.
  - Keep the comment block that sat above the first call.

- [ ] **Step 4: Landings.**
  1. **The helper,** beside `changeArtists`:

```ts
  /** A fresh pick landed on a row: it counts as a turn for its member (spec §3). Only in a
   * combination; a one-artist selection keeps no score. */
  function noteArtistLanding(candidate: DiscoverCandidate | null): void {
    const sel = artistsRef.current
    if (!isCombined(sel)) return
    const member = memberOfPick(candidate, sel)
    if (member === undefined) return
    artistShareRef.current = landArtistTurn(artistShareRef.current, member)
    setArtistShareTick((n) => n + 1)
  }
```

  2. **`commitSlotPick`:** next to the turnover block, add
     `if (!hookLanding) noteArtistLanding(pick.candidate)`. The `hookLanding` flag already covers
     hook and arc landings.
  3. **The two direct writes:**
     - `rollRandomForSlot`'s `else` branch, the `setSlots` call that writes `candidate` with radio
       off;
     - `rollAdjacentForSlot`'s matching `setSlots` write (anchor:
       `s.id === id ? { ...s, candidate, hasRerolled: true, seedStem: undefined } : s` in that
       function).
     - Call `noteArtistLanding(candidate)` right after each `setSlots(...)`.

- [ ] **Step 5: Spares.**
  - In the sized-build spare code, both `JSON.stringify(rollFilter())`, in `radioSpareFits` and
    where spares are created (`const filterKey = …`), become
    `artistSelectionKey(artistsRef.current, globalRollOptions.onlyOwnStems)`.
  - Update the `filterKey` field's doc comment: "the selection and my sounds it was picked under".

- [ ] **Step 6: Remove `rollFilter()`.**
  - Its last caller should now be `rollAdjacentForSlot`'s `nearbyArtist`. Until Task 8, make that
    `const nearbyArtist = rollFilterForMember(artistsRef.current[0], artistsRef.current, currentUsername, false).artist`.
  - Delete `rollFilter()` and its TEMPORARY comment.
  - `rg -n "rollFilter\(\)" src/renderer` prints nothing.

- [ ] **Step 7: Check.**
  - `npm run typecheck`, `npm run lint` and `npx vitest run src/shared`: clean, green.
  - **One artist, by reading the diff:**
    - `attempts` has one entry, its filter is `rollFilterForArtist`'s, and nothing draws from
      `Math.random`;
    - the `while` never runs;
    - `noteArtistLanding` returns at once;
    - the spare key compares with itself.

- [ ] **Step 8: Commit** both files: "combine artists: every pick asks the artist furthest behind,
  passes the turn on, counts landings".

### Task 8: Neighbours: the nearby popover, one-tap adjacent, dig

**Depends on:** Task 7.

**Files:**
- Modify: `src/renderer/src/components/DiscoverPanel.tsx`,
  `src/renderer/src/components/DiscoverSlotRow.tsx`,
  `src/renderer/src/components/DiscoverNearbyPopover.tsx`

- [ ] **Step 1: The popover.**
  - **Props:** `creator?: string` becomes `creator?: string | readonly string[]`, and add
    `ownUsername?: string`. The doc reads: "combine artists: any of these; tagged by creator".
  - **`resultKey`:** use
    `${typeof creator === 'string' ? creator : (creator ?? []).join(',')}` where it reads
    `${creator ?? ''}`. For a string or none, that is the same text.
  - **Tagging:**

```ts
        const tag = (c: AdjacentDiscoverCandidate): AdjacentDiscoverCandidate =>
          typeof creator === 'object'
            ? tagByCreator(c, creator, ownUsername ?? '')
            : tagPickedUnderArtist(c, creator)
        const tagged = { newer: candidates.newer.map(tag), older: candidates.older.map(tag) }
```

  `tagByCreator` takes the creator list as its "selection". The own name is handled first, so a
  list with the own username in it tags `me`'s stems untagged, as `me` rolls are.

- [ ] **Step 2: `DiscoverSlotRow.tsx`.**
  - `nearbyCreator: string | undefined` becomes `string | readonly string[] | undefined`.
  - Add `ownUsername: string`.
  - Pass both to the popover (`creator={nearbyCreator}`, `ownUsername={ownUsername}`).
  - In `DiscoverPanel`, pass `nearbyCreator={artistCreator}` (Task 6's temporary narrowing goes)
    and `ownUsername={currentUsername}` at every `DiscoverSlotRow` site.

- [ ] **Step 3: `rollAdjacentForSlot`:**

```ts
      const sel = artistsRef.current
      const nearbyArtist = selectionCreatorFilter(sel, currentUsername)
      const nearbyRaw = await window.rifffApi.getAdjacentDiscoverCandidates(
        anchor.riffCID,
        slot.kinds,
        soundSourceForLean(sourceLeanRef.current),
        nearbyArtist
      )
      const tagNear = <T extends DiscoverCandidate>(c: T): T =>
        typeof nearbyArtist === 'object'
          ? tagByCreator(c, sel, currentUsername)
          : tagPickedUnderArtist(c, nearbyArtist)
      const nearby = { older: nearbyRaw.older.map(tagNear), newer: nearbyRaw.newer.map(tagNear) }
```

  For one artist, `nearbyArtist` is today's string or undefined, and the tag is today's.

- [ ] **Step 4: Dig's near draw in `pickForSlot`** (spec decision 9). In `nearFrom`:
  - pass `isCombined(selection) ? selectionCreatorFilter(selection, currentUsername) : f.artist`
    as the creator;
  - in a combination, skip the `own` filter (the list already restricts creators) and tag with
    `tagByCreator(c, selection, currentUsername)`;
  - for one artist, leave every line as it is.
  - **Ledger:** a near pick's landing is counted by `noteArtistLanding` for whoever's stem it is.
    The turn begun for `attempts[0]` ends in the `finally` as usual.

- [ ] **Step 5: Check.**
  - `npm run typecheck`, `npm run lint` and `npx vitest run src/shared src/main/discoverAdjacency.test.ts`:
    clean, green.
  - `rg -n "creator\?: string\b" src/renderer/src/components` prints nothing.

- [ ] **Step 6: Commit** the three files: "combine artists: neighbour lookups span the selection,
  tagged by creator".

### Task 9: The picker: multi-select

**Depends on:** Task 6 (and Task 7 for the `turns:` line).

**Files:**
- Modify: `src/renderer/src/components/DiscoverArtistPicker.tsx`,
  `src/renderer/src/components/DiscoverPanel.tsx`

Follow the spec's §1 exactly. The design rules: lowercase, sharp corners, `--ra-*` tokens only, no
colour (this is chrome), Silkscreen inherited, sizes as the existing picker (font 10, status 9).

- [ ] **Step 1: Props.**
  - `artist: string | null` becomes `selection: ArtistSelection`.
  - `onPick: (artist: string | null) => void` becomes
    `onChange: (next: ArtistSelection) => void`.
  - Add `turns?: string | null`, the footer's `turns:` line, rendered when non-null.
  - `footerExtra` stays.

- [ ] **Step 2: Gestures.** Replace `pick(s)` with:

```ts
  function memberOf(s: ArtistSuggestion): ArtistMember {
    return s.kind === 'me' ? null : normalizeArtistPick(s.user, ownUsername)
  }
  /** Click / Enter: only this artist, and close -- today's pick. */
  function pickOnly(s: ArtistSuggestion): void {
    onChange(applyArtistPick(selection, memberOf(s), 'only', ownUsername))
    ignoreRef.current?.focus()
    onClose()
  }
  /** `+`/`−`, Shift+click, Shift+Enter: add or remove, and stay open. */
  function toggle(s: ArtistSuggestion): void {
    onChange(applyArtistPick(selection, memberOf(s), 'toggle', ownUsername))
    setQuery('')
  }
```

  **Keyboard** on the input:
  - `Enter` with `e.shiftKey`: `toggle(suggestions[active])`;
  - plain `Enter`: `pickOnly`;
  - `Backspace` with `query === ''` and `selection.length > 1`: `e.preventDefault()`, then
    `onChange(applyArtistPick(selection, selection[selection.length - 1], 'toggle', ownUsername))`.

- [ ] **Step 3: Chips.** Above the input, only when `selection.length > 1`, add a
  `display: flex; flexWrap: wrap; gap: 4` row. Each chip:
  - is a `<button>` reading `{name} ×`, `name` being the member, or the own name, or `me`;
  - has `aria-label={\`remove ${name}\`}`;
  - is styled `fontFamily: 'inherit', fontSize: 9, padding: '2px 6px', background: 'transparent', border: '1px solid var(--ra-border-strong)', color: 'var(--ra-text)', cursor: 'pointer'`;
  - removes that member on click: `onChange(applyArtistPick(selection, member, 'toggle', ownUsername))`.
  - No `border-radius` anywhere.

- [ ] **Step 4: Option rows.** Each option becomes a two-cell row:
  `display: 'grid', gridTemplateColumns: '1fr 18px', gap: 4`.
  - **The name button** keeps today's `role="option"`, id, `onMouseEnter`, and highlight
    background. Then:
    - `onClick={(e) => (e.shiftKey ? toggle(s) : pickOnly(s))}`;
    - `aria-selected={selection.includes(memberOf(s))}` (chosen, no longer highlighted);
    - `color: selection.includes(memberOf(s)) ? 'var(--ra-text)' : i === active ? 'var(--ra-text)' : 'var(--ra-text-2)'`.
  - **The `+`/`−` button:**
    - `tabIndex={-1}`, `aria-label` = `add <name>` or `remove <name>`;
    - `disabled={!canAddMember(selection, memberOf(s), ownUsername)}`;
    - `data-tooltip`, when disabled: `memberOf(s) === null ? 'set your endlesss username to combine me' : 'six at most'`;
    - style: 18 × 18, `border: '1px solid var(--ra-border)'`, transparent background, `--ra-text-4`
      when disabled, otherwise `--ra-text-2`;
    - content: `−` when chosen, else `+`;
    - `onClick={() => toggle(s)}`.
  - **The listbox** gains `aria-multiselectable="true"`.

- [ ] **Step 5: Footer.**
  - **One member:** today's analysed line, keyed by the single named member (`selection[0]`, when
    not null).
  - **Combined:** fetch `discoverArtistAnalysed` for each named member, in the same effect shape,
    keyed by `JSON.stringify(selectionOthers(selection))`, sequentially, cancelled on change.
    Render `analysed: a 3% · b <1%`, each value through `analysedLabel(...)` with its
    `analysed: ` prefix stripped.
  - Then `footerExtra`, then `turns` when non-null (`fontSize: 9`, `--ra-text-3`).

- [ ] **Step 6: `DiscoverPanel`'s picker site.**
  - `selection={artists}`, `onChange={changeArtists}`.
  - `turns`, when combined:

```ts
            turns={
              combined
                ? `turns: ${artists
                    .map(
                      (m) =>
                        `${m ?? (currentUsername.trim() || 'me')} ${artistShareRef.current.landed[memberKey(m)] ?? 0}`
                    )
                    .join(' · ')}`
                : null
            }
```

  `artistShareTick` is already state, so the line re-renders on every landing. Reference it in a
  `void artistShareTick` if lint calls it unused.
  - **`analyse overnight`:**
    - shown when `selectionOthers(artists).length > 0`;
    - its tooltip: `queue these artists' stems for the overnight scan` when combined, else today's;
    - its click queues each named member in turn (`for (const name of selectionOthers(artists)) await window.rifffApi.discoverQueueArtistAnalysis(name)`);
    - it shows the last answer's `size` and calls `announceArtistScanQueued` once with it.
    - **Error handling:** as today.

- [ ] **Step 7: Check.**
  - `npm run typecheck`, `npm run lint`: clean.
  - `rg -n "border-?[Rr]adius" src/renderer/src/components/DiscoverArtistPicker.tsx` prints
    nothing.
  - `rg -n "[A-Z]" ` over the new UI strings by eye: lowercase only.

- [ ] **Step 8: Commit** both files: "combine artists: the picker chooses several (chips, +/-,
  shift+enter), shows each analysed share and the turns".

### Task 10: Whose stem, on rows with radio off

**Depends on:** Task 6.

**Files:**
- Modify: `src/renderer/src/components/DiscoverSlotRow.tsx`,
  `src/renderer/src/components/DiscoverPanel.tsx`

- [ ] **Step 1: The tooltip.**
  - `DiscoverSlotRow` gains `creatorInTooltip?: boolean`.
  - On the waveform button's `data-tooltip` (the date one), build:

```ts
          data-tooltip={
            [
              resolvedStem.creationTime
                ? new Date(resolvedStem.creationTime * 1000).toLocaleDateString(undefined, {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric'
                  })
                : null,
              creatorInTooltip && slot.candidate?.creatorUserName
                ? `by ${slot.candidate.creatorUserName}`
                : null
            ]
              .filter((p): p is string => p !== null)
              .join(' · ') || undefined
          }
```

  With the flag off, that is exactly the date or undefined, as today.
  - **If the move-visuals or simple-view work has restyled this cell,** keep their changes and add
    only the `by` part.

- [ ] **Step 2: Pass the flag.** `DiscoverPanel` passes `creatorInTooltip={combined}` at every
  `DiscoverSlotRow` site. Radio's plates already end in `— creator` (`radioRowLabel`), so nothing
  is added there.

- [ ] **Step 3: Check and commit.**
  - Run `npm run typecheck` and `npm run lint`.
  - Commit both files: "combine artists: a combined row's tooltip says whose stem".

## Last

### Task 11: Verification, review, handoff, walkthrough

- [ ] **Step 1: The full suite.**
  - Run `npm test`, `npm run typecheck` and `npm run lint`.
  - Expected: green apart from the known engine-spawn tests.
- [ ] **Step 2: Review.** Run `superpowers:requesting-code-review` against the spec, especially:
  - **§9:** for one artist, the path is today's. Read `pickForSlot`, `rollRandomForSlot`,
    `rollAdjacentForSlot` and `changeArtists` with a one-member selection in mind.
  - **Begin and end pair up** on every return path of both pick functions. An early `return null`
    inside the `try` still reaches the `finally`.
  - **`noteArtistLanding`:** no landing site double-counts. `commitSlotPick` plus the two direct
    writes, nothing else.
  - **Design rules:** tokens only, no radius, lowercase copy.
- [ ] **Step 3: Handoff.**
  - Add an "as built" section to the spec: commits, deviations, anything measured.
  - Update the memory index with a `combine_artists_shipped.md` entry. Say it is unverified by a
    human, and list the walkthrough.
- [ ] **Step 4: Walkthrough for Elling.** The spec's "Walkthrough for Elling": six checks, about
  ten minutes. **No agent can hear or see the app**, so say so in the report. Don't deploy or
  release without his go-ahead.

## Timing risks, per task

- **T1-T5:** none. They are additive and inert.
- **T6:**
  - A missed `artistRef` read is a type error, not a silent bug, because the prop type changed.
  - The mirror effect's dependency is a JSON key, so a new array identity with the same members
    doesn't re-push.
- **T7:**
  - In-flight counts must pair. A leaked begin biases the share toward the others; it never stalls
    a pick.
  - The pass-on loop checks the generation before each await, as the source-dial fallback does.
- **T8:** none. For one artist the creator is the same string.
- **T9:**
  - Each toggle is a selection change. While radio runs, a removal turns rows over one per loop top,
    and an add changes nothing at once.
  - Rapid toggling replaces the turnover set each time, and at most one skip waits.
- **T10:** none.
