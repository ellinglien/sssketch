// src/shared/discoverArtist.test.ts
import { describe, expect, it } from 'vitest'
import {
  KEEP_REFUSED,
  blockedActions,
  lingeringArtists,
  lingeringNotice,
  pickMatchesSelection,
  tagPickedUnderArtist,
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
    expect(artistMode('bluemoth', 'elling')).toBe('other')
  })
  it('counts every named artist as other when no own username is set', () => {
    expect(artistMode('elling', '')).toBe('other')
    expect(artistMode('bluemoth', '   ')).toBe('other')
  })
})

describe('listenOnlyActions', () => {
  it('disables nothing in own mode', () => {
    expect([...listenOnlyActions('own')]).toEqual([])
  })
  // Elling, 2026-10-02: restrictions lifted, to come back if needed.
  it('disables nothing in other mode either', () => {
    expect([...listenOnlyActions('other')]).toEqual([])
  })
  it('keeps the full catalogue a restriction can name', () => {
    expect([...LISTEN_ONLY_ACTIONS].sort()).toEqual(
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
  })
})

describe('copy', () => {
  it('has the notice, the tooltip and the field label, lowercase', () => {
    expect(artistNotice('seasaltbiscuit')).toBe(
      "listening to seasaltbiscuit's stems. to use them in your own work, ask them first."
    )
    expect(listenOnlyTooltip('seasaltbiscuit')).toBe(
      "listening only: these are seasaltbiscuit's stems"
    )
    expect(artistFieldLabel(null, 'elling')).toBe('artist: elling')
    expect(artistFieldLabel(null, '')).toBe('artist: me')
    expect(artistFieldLabel('bluemoth', 'elling')).toBe('artist: bluemoth')
  })
})

describe('normalizeArtistPick', () => {
  it('turns blank and the own name into me (null)', () => {
    expect(normalizeArtistPick('', 'elling')).toBeNull()
    expect(normalizeArtistPick('  elling ', 'elling')).toBeNull()
    expect(normalizeArtistPick(null, 'elling')).toBeNull()
  })
  it('keeps anyone else, trimmed', () => {
    expect(normalizeArtistPick(' tqk ', 'elling')).toBe('tqk')
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
    expect(rollFilterForArtist('hollowbell', 'elling', false)).toEqual({
      onlyOwnStems: true,
      targetUser: 'hollowbell',
      artist: 'hollowbell'
    })
  })
})

describe('creatorAllowed', () => {
  it('allows everything with no artist', () => {
    expect(creatorAllowed('anyone', undefined)).toBe(true)
    expect(creatorAllowed(null, undefined)).toBe(true)
  })
  it('allows only the artist otherwise', () => {
    expect(creatorAllowed('tqk', 'tqk')).toBe(true)
    expect(creatorAllowed('elling', 'tqk')).toBe(false)
    expect(creatorAllowed(null, 'tqk')).toBe(false)
  })
  it('allows any of a combination', () => {
    expect(creatorAllowed('tqk', ['elling', 'tqk'])).toBe(true)
    expect(creatorAllowed('bluemoth', ['elling', 'tqk'])).toBe(false)
    expect(creatorAllowed(null, ['elling', 'tqk'])).toBe(false)
    expect(creatorAllowed(undefined, ['elling'])).toBe(false)
    // an empty list (main's adjacency after trimming) allows nobody, never everybody
    expect(creatorAllowed('tqk', [])).toBe(false)
  })
})

describe('artist turnover (course change on switch)', () => {
  const slots = [
    { id: 'a', creator: 'elling' },
    { id: 'b', creator: 'tqk' },
    { id: 'c', creator: null },
    { id: 'd', creator: 'bluemoth' }
  ]
  it('marks every row with a stem not by the new artist', () => {
    expect([...artistTurnoverIds(slots, 'tqk', 'elling')].sort()).toEqual(['a', 'd'])
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
    expect(rollFilterForArtist('hollowbell', 'elling', true)).toEqual({
      onlyOwnStems: true,
      targetUser: 'hollowbell',
      artist: 'hollowbell'
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
      { id: 'b', creator: 'tqk' }
    ]
    expect([...artistTurnoverIds(slots, ' tqk ', 'elling')]).toEqual(['a'])
  })
  it('artistTurnoverIds: a blank artist targets the own username', () => {
    const slots = [
      { id: 'a', creator: 'elling' },
      { id: 'b', creator: 'tqk' }
    ]
    expect([...artistTurnoverIds(slots, '  ', 'elling')]).toEqual(['b'])
  })
  it('matching is case-sensitive (pinned current behaviour)', () => {
    expect(artistMode('Elling', 'elling')).toBe('other')
    expect(normalizeArtistPick('Elling', 'elling')).toBe('Elling')
    expect(creatorAllowed('TQK', 'tqk')).toBe(false)
    expect(rollFilterForArtist('Elling', 'elling', false).artist).toBe('Elling')
    expect([...artistTurnoverIds([{ id: 'a', creator: 'TQK' }], 'tqk', 'elling')]).toEqual(['a'])
  })
})

describe('mergeArtistCounts', () => {
  it('sums a user across dbs', () => {
    expect(
      mergeArtistCounts([
        [
          { user: 'tqk', stems: 10 },
          { user: 'elling', stems: 5 }
        ],
        [{ user: 'tqk', stems: 2 }]
      ])
    ).toEqual([
      { user: 'tqk', stems: 12 },
      { user: 'elling', stems: 5 }
    ])
  })
})

describe('jammedWithFromPairs', () => {
  const pairs: [string, string][] = [
    ['j1', 'elling'],
    ['j1', 'tqk'],
    ['j1', 'bluemoth'],
    ['j2', 'elling'],
    ['j2', 'tqk'],
    ['j3', 'hollowbell'], // a jam elling is not in
    ['shared:feed', 'elling'],
    ['shared:feed', 'stranger'], // not a jam
    ['discovered', 'elling'],
    ['discovered', 'keptfrom'] // kept groups, not a jam
  ]
  it('orders users by shared jams, then name, excluding self and non-jams', () => {
    expect(jammedWithFromPairs(pairs, 'elling')).toEqual([
      { user: 'tqk', sharedJams: 2 },
      { user: 'bluemoth', sharedJams: 1 }
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
      { user: 'seasaltbiscuit', stems: 26828 },
      { user: 'bluemoth', stems: 31398 },
      { user: 'seawren', stems: 12 },
      { user: 'oversea', stems: 400 }
    ],
    jammedWith: [
      { user: 'seawren', sharedJams: 9 },
      { user: 'bluemoth', sharedJams: 4 }
    ],
    jammedWithPending: false
  }
  it('before typing: me, then people you have jammed with, in that order', () => {
    expect(suggestArtists(index, '', 'elling')).toEqual([
      { kind: 'me' },
      { kind: 'user', user: 'seawren', stems: 12, sharedJams: 9 },
      { kind: 'user', user: 'bluemoth', stems: 31398, sharedJams: 4 }
    ])
  })
  it('before typing, while jammed-with is still being built: by stem count', () => {
    const pending = { ...index, jammedWith: null, jammedWithPending: true }
    expect(suggestArtists(pending, '', 'elling', 2)).toEqual([
      { kind: 'me' },
      { kind: 'user', user: 'bluemoth', stems: 31398, sharedJams: null },
      { kind: 'user', user: 'seasaltbiscuit', stems: 26828, sharedJams: null }
    ])
  })
  it('typing: prefix matches first, then substring, each by stem count; never self', () => {
    expect(
      suggestArtists(index, 'SEA', 'elling').map((s) => (s.kind === 'me' ? 'me' : s.user))
    ).toEqual(['seasaltbiscuit', 'seawren', 'oversea'])
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
        { kind: 'user', user: 'seasaltbiscuit', stems: 26828, sharedJams: null },
        'elling'
      )
    ).toBe('seasaltbiscuit · 26,828')
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
    { user: 'bluemoth', stems: 31398 },
    { user: 'tqk', stems: 500 }
  ]
  it('an empty jammed-with list falls back to stem count, so the picker is never only me', () => {
    expect(
      suggestArtists({ counts, jammedWith: [], jammedWithPending: false }, '', 'elling')
    ).toEqual([
      { kind: 'me' },
      { kind: 'user', user: 'bluemoth', stems: 31398, sharedJams: null },
      { kind: 'user', user: 'tqk', stems: 500, sharedJams: null }
    ])
  })
  it('gives the same answer when called again with the same index (maps built once)', () => {
    const index = {
      counts,
      jammedWith: [{ user: 'tqk', sharedJams: 3 }],
      jammedWithPending: false
    }
    const first = suggestArtists(index, 'b', 'elling')
    expect(suggestArtists(index, 'b', 'elling')).toEqual(first)
    expect(suggestArtists(index, '', 'elling')[1]).toEqual({
      kind: 'user',
      user: 'tqk',
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

describe('suggestArtists: me and Enter', () => {
  const index = {
    counts: [
      { user: 'elling', stems: 100 },
      { user: 'linda', stems: 50 }
    ],
    jammedWith: null,
    jammedWithPending: false
  }
  it('a query that is only a SUBSTRING of the own name lists me after the users', () => {
    expect(suggestArtists(index, 'lin', 'elling')).toEqual([
      { kind: 'user', user: 'linda', stems: 50, sharedJams: null },
      { kind: 'me' }
    ])
  })
  it('a prefix of the own name (or of "me") still puts me first', () => {
    expect(suggestArtists(index, 'ell', 'elling')[0]).toEqual({ kind: 'me' })
    expect(suggestArtists(index, 'm', 'elling')[0]).toEqual({ kind: 'me' })
  })
})

// Task 7 review (2026-10-01): picks are tagged with the artist they were
// rolled under, and the tag drives both turnover and the keep block.
describe('picked under artist', () => {
  const c = { stemCID: 's1', creatorUserName: 'tqk' }
  it('tags a candidate rolled in artist mode, and leaves a me roll untouched', () => {
    expect(tagPickedUnderArtist(c, 'tqk')).toEqual({ ...c, pickedUnderArtist: 'tqk' })
    expect(tagPickedUnderArtist(c, undefined)).toBe(c)
  })
  it('a pick counts for the current selection only when rolled under it', () => {
    expect(pickMatchesSelection({ pickedUnderArtist: 'tqk' }, 'tqk')).toBe(true)
    expect(pickMatchesSelection({ pickedUnderArtist: 'tqk' }, 'hollowbell')).toBe(false)
    expect(pickMatchesSelection({ pickedUnderArtist: 'tqk' }, null)).toBe(false)
    // A me pick, of any creator (collaborators' stems included), counts for me.
    expect(pickMatchesSelection({ creatorUserName: 'bluemoth' }, null)).toBe(true)
    expect(pickMatchesSelection({}, 'tqk')).toBe(false)
    expect(pickMatchesSelection(null, null)).toBe(false)
  })
  it('lists the artists whose stems still play, once each, in name order', () => {
    expect(
      lingeringArtists([
        { candidate: { pickedUnderArtist: 'tqk' } },
        { candidate: null },
        { candidate: {} },
        { candidate: { pickedUnderArtist: 'bluemoth' } },
        { candidate: { pickedUnderArtist: 'tqk' } }
      ])
    ).toEqual(['bluemoth', 'tqk'])
    expect(lingeringArtists([])).toEqual([])
  })
  it('says whose stems are still playing', () => {
    expect(lingeringNotice(['tqk'])).toBe("listening only: tqk's stems still playing")
    expect(lingeringNotice(['bluemoth', 'tqk'])).toBe(
      "listening only: bluemoth's and tqk's stems still playing"
    )
  })
})

// The Task 7 race, by the helpers DiscoverPanel's commitSlotPick and
// skipRadio use: a pick rolled before a switch must not count as turned over.
describe('turnover after a switch, with a stale pick in flight', () => {
  it('a pick rolled under the OLD artist leaves its row pending; one under the new clears it', () => {
    const slots = [
      { id: 'a', creator: 'tqk' },
      { id: 'b', creator: 'tqk' }
    ]
    // tqk -> hollowbell mid-radio.
    const pending = artistTurnoverIds(slots, 'hollowbell', 'elling')
    expect([...pending].sort()).toEqual(['a', 'b'])
    // A skip rolled under tqk lands on row a: not a turnover.
    const stale = { creatorUserName: 'tqk', pickedUnderArtist: 'tqk' }
    if (pickMatchesSelection(stale, 'hollowbell')) pending.delete('a')
    expect(nextTurnoverSlotId(['a', 'b'], pending)).toBe('a')
    // The new artist's pick for row a clears it; b is next.
    const fresh = { creatorUserName: 'hollowbell', pickedUnderArtist: 'hollowbell' }
    if (pickMatchesSelection(fresh, 'hollowbell')) pending.delete('a')
    expect(nextTurnoverSlotId(['a', 'b'], pending)).toBe('b')
  })

  it("back to me: a me pick clears the row even when its stem is a collaborator's", () => {
    const pending = artistTurnoverIds([{ id: 'a', creator: 'tqk' }], null, 'elling')
    const mePick = tagPickedUnderArtist({ creatorUserName: 'bluemoth' }, undefined)
    if (pickMatchesSelection(mePick, null)) pending.delete('a')
    expect(pending.size).toBe(0)
  })
})

// Elling, 2026-10-01 blocked keep, star, shelf and timeline while another
// artist's stems lingered in `me`; lifted 2026-10-02.
describe('blockedActions', () => {
  it('blocks nothing, in artist mode or with stems lingering', () => {
    expect(blockedActions('other', []).size).toBe(0)
    expect(blockedActions('own', ['tqk']).size).toBe(0)
    expect(blockedActions('own', []).size).toBe(0)
  })
  it('says how to clear a row radio will not turn over', () => {
    expect(lingeringNotice(['tqk'], true)).toBe(
      "listening only: tqk's stems still playing · reroll or unlock the row to keep"
    )
  })
})
