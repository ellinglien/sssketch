// src/main/discoverArtistSession.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  currentArtistMode,
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
    expect(setDiscoverArtistSession({ artist: 'bananepoep', ownUsername: 'elling' })).toBe('other')
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
    setDiscoverArtistSession({ artist: 'tpj', ownUsername: 'elling' })
    resetDiscoverArtistSession()
    expect(currentArtistMode()).toBe('own')
  })

  it('the refused fetch reads as a label', () => {
    expect(heartFetchLabel({ ok: false, reason: 'listening only' })).toBe('listening only')
  })
})

// Elling, 2026-10-01 blocked keep and star in `me` while another artist's
// stems still played; lifted 2026-10-02 along with the rest.
describe("keep and star while another artist's stems remain", () => {
  it('in me, refuses neither, from the call or the session', () => {
    setDiscoverArtistSession({ artist: null, ownUsername: 'elling', lingering: ['tpj'] })
    expect(refusesKeep(['tpj'])).toBe(false)
    expect(refusesKeep(undefined)).toBe(false)
    expect(refusesStar()).toBe(false)
    expect(keepBlockedForPhone()).toBe(false)
  })

  it('ignores a malformed list', () => {
    setDiscoverArtistSession({ artist: null, ownUsername: 'elling' })
    expect(refusesKeep('tpj')).toBe(false)
    expect(refusesKeep([7, null, ''])).toBe(false)
  })
})
