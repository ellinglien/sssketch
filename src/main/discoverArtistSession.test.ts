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
