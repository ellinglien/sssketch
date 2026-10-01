import { afterEach, describe, expect, it, vi } from 'vitest'
import { appSoundDefaults, forgetAppSoundDefaults } from './appSoundDefaults'
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
})
