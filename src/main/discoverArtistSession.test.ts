// src/main/discoverArtistSession.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  currentArtistMode,
  getDiscoverArtistSession,
  keepBlockedForPhone,
  refusesKeep,
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

// Elling, 2026-10-01: in `me`, keep is refused while any row still plays a
// stem picked under artist mode.
describe("keep while another artist's stems remain", () => {
  it('in me, refuses keep for a call that names lingering artists', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    setDiscoverArtistSession({ artist: null, ownUsername: 'elling' })
    expect(refusesKeep(['tpj'])).toBe(true)
    expect(refusesKeep([])).toBe(false)
    expect(refusesKeep(undefined)).toBe(false)
  })

  it('ignores a malformed list rather than refusing on it', () => {
    setDiscoverArtistSession({ artist: null, ownUsername: 'elling' })
    expect(refusesKeep('tpj')).toBe(false)
    expect(refusesKeep([7, null, ''])).toBe(false)
  })

  it("refuses on the session's own lingering list too (the phone's path)", () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    setDiscoverArtistSession({ artist: null, ownUsername: 'elling', lingering: ['tpj'] })
    expect(keepBlockedForPhone()).toBe(true)
    expect(refusesKeep(undefined)).toBe(true)
    setDiscoverArtistSession({ artist: null, ownUsername: 'elling', lingering: [] })
    expect(keepBlockedForPhone()).toBe(false)
  })

  it('in artist mode keep is refused whatever the list says', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    setDiscoverArtistSession({ artist: 'tpj', ownUsername: 'elling' })
    expect(refusesKeep([])).toBe(true)
    expect(keepBlockedForPhone()).toBe(true)
  })

  it('a reset clears the lingering list', () => {
    setDiscoverArtistSession({ artist: null, ownUsername: 'elling', lingering: ['tpj'] })
    resetDiscoverArtistSession()
    expect(keepBlockedForPhone()).toBe(false)
  })
})
