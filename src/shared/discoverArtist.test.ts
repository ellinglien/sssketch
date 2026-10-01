// src/shared/discoverArtist.test.ts
import { describe, expect, it } from 'vitest'
import {
  KEEP_REFUSED,
  LISTEN_ONLY_ACTIONS,
  isKeepRefused,
  analysedLabel,
  jammedWithFromPairs,
  mergeArtistCounts,
  suggestArtists,
  suggestionLabel,
  type ArtistIndex,
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

describe('mergeArtistCounts', () => {
  it('sums a user across dbs', () => {
    expect(
      mergeArtistCounts([
        [
          { user: 'tpj', stems: 10 },
          { user: 'elling', stems: 5 }
        ],
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
    ['j1', 'elling'],
    ['j1', 'tpj'],
    ['j1', 'bananepoep'],
    ['j2', 'elling'],
    ['j2', 'tpj'],
    ['j3', 'honeydisco'], // a jam elling is not in
    ['shared:feed', 'elling'],
    ['shared:feed', 'stranger'], // not a jam
    ['discovered', 'elling'],
    ['discovered', 'keptfrom'] // kept groups, not a jam
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
    expect(
      suggestArtists(index, 'SEA', 'elling').map((s) => (s.kind === 'me' ? 'me' : s.user))
    ).toEqual(['seasickcookie', 'seaweed', 'oversea'])
  })
  it('typing "me" or part of the own name offers me first', () => {
    expect(suggestArtists(index, 'me', 'elling')[0]).toEqual({ kind: 'me' })
    expect(suggestArtists(index, 'ell', 'elling')[0]).toEqual({ kind: 'me' })
  })
})

describe('labels', () => {
  it('formats suggestions and the analysed share', () => {
    expect(
      suggestionLabel(
        { kind: 'user', user: 'seasickcookie', stems: 26828, sharedJams: null },
        'elling'
      )
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

describe('suggestArtists: Task 3 review', () => {
  const counts = [
    { user: 'elling', stems: 66534 },
    { user: 'bananepoep', stems: 31398 },
    { user: 'tpj', stems: 500 }
  ]
  it('an empty jammed-with list falls back to stem count, so the picker is never only me', () => {
    expect(
      suggestArtists({ counts, jammedWith: [], jammedWithPending: false }, '', 'elling')
    ).toEqual([
      { kind: 'me' },
      { kind: 'user', user: 'bananepoep', stems: 31398, sharedJams: null },
      { kind: 'user', user: 'tpj', stems: 500, sharedJams: null }
    ])
  })
  it('gives the same answer when called again with the same index (maps built once)', () => {
    const index = {
      counts,
      jammedWith: [{ user: 'tpj', sharedJams: 3 }],
      jammedWithPending: false
    }
    const first = suggestArtists(index, 'b', 'elling')
    expect(suggestArtists(index, 'b', 'elling')).toEqual(first)
    expect(suggestArtists(index, '', 'elling')[1]).toEqual({
      kind: 'user',
      user: 'tpj',
      stems: 500,
      sharedJams: 3
    })
  })
})

describe('keep refusal over IPC', () => {
  it('is a distinct value: not null, not a kept riff', () => {
    expect(isKeepRefused(KEEP_REFUSED)).toBe(true)
    expect(isKeepRefused(null)).toBe(false)
    expect(isKeepRefused({ riffCID: 'r', name: 'n', duplicate: false })).toBe(false)
    expect(KEEP_REFUSED).toEqual({ refused: 'listening only' })
  })
})
