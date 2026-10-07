// src/main/discoverArtistSession.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  currentArtistMode,
  getDiscoverArtistSelection,
  getDiscoverArtistSession,
  keepBlockedForPhone,
  refusesKeep,
  refusesStar,
  refusesListenOnly,
  resetDiscoverArtistSession,
  setDiscoverArtistSession
} from './discoverArtistSession'
import { heartFetchLabel } from '@shared/radioHearts'

afterEach(() => {
  resetDiscoverArtistSession()
  vi.restoreAllMocks()
})

describe('discover artist session', () => {
  it('starts on me, own mode, refusing nothing', () => {
    expect(getDiscoverArtistSession()).toEqual({ artist: null, ownUsername: '' })
    expect(currentArtistMode()).toBe('own')
    expect(refusesListenOnly('keep')).toBe(false)
    expect(refusesListenOnly('star')).toBe(false)
    expect(refusesListenOnly('fetchHearts')).toBe(false)
  })

  // Elling, 2026-10-02: restrictions lifted -- any artist's stems can be used.
  it('refuses nothing while another artist is chosen', () => {
    expect(setDiscoverArtistSession({ artist: 'bluemoth', ownUsername: 'elling' })).toBe('other')
    expect(refusesListenOnly('keep')).toBe(false)
    expect(refusesListenOnly('star')).toBe(false)
    expect(refusesListenOnly('fetchHearts')).toBe(false)
    expect(refusesKeep([])).toBe(false)
    expect(refusesStar()).toBe(false)
    expect(keepBlockedForPhone()).toBe(false)
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
    setDiscoverArtistSession({ artist: 'tqk', ownUsername: 'elling' })
    resetDiscoverArtistSession()
    expect(currentArtistMode()).toBe('own')
  })

  it("reads a combined selection; one member stays today's push", () => {
    expect(
      setDiscoverArtistSession({
        artist: 'bluemoth',
        ownUsername: 'elling',
        artists: ['bluemoth', null, 'tqk']
      })
    ).toBe('other')
    expect(getDiscoverArtistSelection()).toEqual(['bluemoth', null, 'tqk'])
    expect(getDiscoverArtistSession()).toEqual({
      artist: 'bluemoth + tqk',
      ownUsername: 'elling'
    })
    expect(setDiscoverArtistSession({ artist: null, ownUsername: 'elling', artists: [null] })).toBe(
      'own'
    )
    expect(getDiscoverArtistSession()).toEqual({ artist: null, ownUsername: 'elling' })
    setDiscoverArtistSession({ artist: 'tqk', ownUsername: 'elling' })
    expect(getDiscoverArtistSelection()).toEqual(['tqk'])
    expect(currentArtistMode()).toBe('other')
    setDiscoverArtistSession({ artist: null, ownUsername: 'elling', artists: 'junk-but-a-name' })
    expect(getDiscoverArtistSelection()).toEqual(['junk-but-a-name'])
    resetDiscoverArtistSession()
    expect(getDiscoverArtistSelection()).toEqual([null])
  })

  it('the refused fetch reads as a label', () => {
    expect(heartFetchLabel({ ok: false, reason: 'listening only' })).toBe('listening only')
  })
})

// Elling, 2026-10-01 blocked keep and star in `me` while another artist's
// stems still played; lifted 2026-10-02 along with the rest.
describe("keep and star while another artist's stems remain", () => {
  it('in me, refuses neither, from the call or the session', () => {
    setDiscoverArtistSession({ artist: null, ownUsername: 'elling', lingering: ['tqk'] })
    expect(refusesKeep(['tqk'])).toBe(false)
    expect(refusesKeep(undefined)).toBe(false)
    expect(refusesStar()).toBe(false)
    expect(keepBlockedForPhone()).toBe(false)
  })

  it('ignores a malformed list', () => {
    setDiscoverArtistSession({ artist: null, ownUsername: 'elling' })
    expect(refusesKeep('tqk')).toBe(false)
    expect(refusesKeep([7, null, ''])).toBe(false)
  })
})
