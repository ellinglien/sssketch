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
    expect(listenOnlyTooltip('seasickcookie')).toBe(
      "listening only: these are seasickcookie's stems"
    )
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
  it("in own mode passes today's values through and no artist", () => {
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

describe('follow-ups (Task 1 review)', () => {
  it('rollFilterForArtist: another artist wins over onlyOwnStems=true', () => {
    expect(rollFilterForArtist('honeydisco', 'elling', true)).toEqual({
      onlyOwnStems: true,
      targetUser: 'honeydisco',
      artist: 'honeydisco'
    })
  })
  it('rollFilterForArtist: a blank artist behaves as own', () => {
    expect(rollFilterForArtist('', 'elling', false)).toEqual({
      onlyOwnStems: false,
      targetUser: 'elling',
      artist: undefined
    })
    expect(rollFilterForArtist('   ', 'elling', true)).toEqual({
      onlyOwnStems: true,
      targetUser: 'elling',
      artist: undefined
    })
  })
  it('artistTurnoverIds trims the artist', () => {
    const slots = [
      { id: 'a', creator: 'elling' },
      { id: 'b', creator: 'tpj' }
    ]
    expect([...artistTurnoverIds(slots, ' tpj ', 'elling')]).toEqual(['a'])
  })
  it('artistTurnoverIds: a blank artist targets the own username', () => {
    const slots = [
      { id: 'a', creator: 'elling' },
      { id: 'b', creator: 'tpj' }
    ]
    expect([...artistTurnoverIds(slots, '  ', 'elling')]).toEqual(['b'])
  })
  it('matching is case-sensitive (pinned current behaviour)', () => {
    expect(artistMode('Elling', 'elling')).toBe('other')
    expect(normalizeArtistPick('Elling', 'elling')).toBe('Elling')
    expect(creatorAllowed('TPJ', 'tpj')).toBe(false)
    expect(rollFilterForArtist('Elling', 'elling', false).artist).toBe('Elling')
    expect([...artistTurnoverIds([{ id: 'a', creator: 'TPJ' }], 'tpj', 'elling')]).toEqual(['a'])
  })
})
