import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  appSoundDefaults,
  appSoundDefaultsNow,
  forgetAppSoundDefaults,
  rememberAppSoundDefaults
} from './appSoundDefaults'
import { DEFAULT_SOUND_SETTINGS, normalizeSoundSettings } from '@shared/radioSound'

describe('appSoundDefaults', () => {
  afterEach(() => forgetAppSoundDefaults())

  it('fetches once and hands out fresh copies', async () => {
    const stored = normalizeSoundSettings(undefined)
    stored.pump.on = false
    const fetch = vi.fn(async () => stored)
    const a = await appSoundDefaults(fetch)
    const b = await appSoundDefaults(fetch)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(a).toEqual(stored)
    expect(a).not.toBe(b)
    a.glue.on = false
    expect((await appSoundDefaults(fetch)).glue.on).toBe(true)
  })

  it('normalises what main sends', async () => {
    const got = await appSoundDefaults(async () => ({ glue: { amount: 5 } }))
    expect(got.glue.amount).toBe(1)
    expect(got.mastering).toEqual(DEFAULT_SOUND_SETTINGS.mastering)
  })

  it('a failed fetch gives everything on, not a rejection', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const got = await appSoundDefaults(async () => {
      throw new Error('no ipc')
    })
    expect(got).toEqual(DEFAULT_SOUND_SETTINGS)
  })

  it('forgetAppSoundDefaults makes the next call fetch again', async () => {
    const fetch = vi.fn(async () => undefined)
    await appSoundDefaults(fetch)
    forgetAppSoundDefaults()
    await appSoundDefaults(fetch)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('a fetch that throws synchronously is a failed fetch too, not an escaping throw', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const got = await appSoundDefaults(() => {
      throw new Error('no window.rifffApi')
    })
    expect(got).toEqual(DEFAULT_SOUND_SETTINGS)
  })

  it('appSoundDefaultsNow: all on until a fetch has resolved, then what it gave, a fresh copy', async () => {
    expect(appSoundDefaultsNow()).toEqual(DEFAULT_SOUND_SETTINGS)
    const stored = normalizeSoundSettings(undefined)
    stored.glue.on = false
    await appSoundDefaults(async () => stored)
    expect(appSoundDefaultsNow()).toEqual(stored)
    expect(appSoundDefaultsNow()).not.toBe(appSoundDefaultsNow())
    forgetAppSoundDefaults()
    expect(appSoundDefaultsNow()).toEqual(DEFAULT_SOUND_SETTINGS)
  })

  it('rememberAppSoundDefaults: appSoundDefaultsNow and appSoundDefaults see the saved settings at once, no fetch', async () => {
    const fetch = vi.fn(async () => normalizeSoundSettings(undefined))
    await appSoundDefaults(fetch)
    const saved = normalizeSoundSettings(undefined)
    saved.glue.on = false
    saved.throws.rate = 'rare'
    rememberAppSoundDefaults(saved)
    saved.pump.on = false // the memo is a copy
    const now = appSoundDefaultsNow()
    expect(now.glue.on).toBe(false)
    expect(now.throws.rate).toBe('rare')
    expect(now.pump.on).toBe(true)
    expect((await appSoundDefaults(fetch)).glue.on).toBe(false)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('rememberAppSoundDefaults wins over a fetch still in flight', async () => {
    let resolveFetch: (v: unknown) => void = () => {}
    const slow = (): Promise<unknown> => new Promise((r) => (resolveFetch = r))
    const inFlight = appSoundDefaults(slow)
    const saved = normalizeSoundSettings(undefined)
    saved.reverb.room = 'zita'
    rememberAppSoundDefaults(saved)
    await Promise.resolve() // the fetch is called a microtask later
    resolveFetch(normalizeSoundSettings(undefined))
    await inFlight
    expect(appSoundDefaultsNow().reverb.room).toBe('zita')
  })
})
