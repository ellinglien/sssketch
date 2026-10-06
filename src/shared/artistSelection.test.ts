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
