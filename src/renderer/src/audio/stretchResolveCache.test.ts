import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearStretchResolveCache,
  makeCachedStretchResolver,
  peekStretchResolve,
  STRETCH_RESOLVE_CACHE_LIMIT
} from './stretchResolveCache'

// Why this exists (2026-09-28). Reported while listening to radio: "on
// new stem load the playing of the stem doesn't start until the wave
// appears completely, which is usually a moment or two after the loop has
// already started.. is pre-loading happening?"
//
// It was, partly. armRadioPick already warms the rubberband render an
// interval early. But resolveStretchedForPlayback was a bare IPC call with
// no memo, and buildEngineProject's own comment says a cache HIT "still
// round-trips through IPC and re-reads the whole resolved file from disk
// just to measure its duration". So every change still paid N IPC calls
// and N file reads at the moment it was due -- on a main thread already
// busy decoding that same audio to draw the waveform, which is exactly why
// the audio arrived when the picture did.
describe('makeCachedStretchResolver', () => {
  beforeEach(() => clearStretchResolveCache())

  it('asks the underlying resolver once for a given path and ratio', async () => {
    const under = vi.fn(async () => ({ path: '/a.stretched.wav', durationSec: 4 }))
    const resolve = makeCachedStretchResolver(under)
    expect(await resolve('/a.wav', 1.25)).toEqual({ path: '/a.stretched.wav', durationSec: 4 })
    expect(await resolve('/a.wav', 1.25)).toEqual({ path: '/a.stretched.wav', durationSec: 4 })
    expect(under).toHaveBeenCalledTimes(1)
  })

  it('treats a different ratio as a different thing, because it is', async () => {
    const under = vi.fn(async (p: string, r: number) => ({ path: `${p}:${r}`, durationSec: r }))
    const resolve = makeCachedStretchResolver(under)
    await resolve('/a.wav', 1.25)
    await resolve('/a.wav', 0.8)
    expect(under).toHaveBeenCalledTimes(2)
  })

  it('shares one in-flight request rather than starting a second', async () => {
    // Definite assignment, not a null union: the Promise executor runs
    // synchronously, so this IS assigned before any call -- but control
    // flow analysis cannot see through the callback and would narrow it
    // to null at the call site.
    let settle!: (v: { path: string; durationSec: number }) => void
    const under = vi.fn(
      () =>
        new Promise<{ path: string; durationSec: number }>((res) => {
          settle = res
        })
    )
    const resolve = makeCachedStretchResolver(under)
    const a = resolve('/a.wav', 2)
    const b = resolve('/a.wav', 2)
    expect(under).toHaveBeenCalledTimes(1)
    settle({ path: '/a.wav', durationSec: 1 })
    expect(await a).toEqual(await b)
  })

  // The whole point: by the time a change commits, the answer must already
  // be sitting here, synchronously, with no IPC left to do.
  it('lets a warmed answer be read without awaiting anything', async () => {
    const under = async (): Promise<{ path: string; durationSec: number }> => ({
      path: '/warm.wav',
      durationSec: 8
    })
    const resolve = makeCachedStretchResolver(under)
    expect(peekStretchResolve('/a.wav', 1.5)).toBeNull()
    await resolve('/a.wav', 1.5)
    expect(peekStretchResolve('/a.wav', 1.5)).toEqual({ path: '/warm.wav', durationSec: 8 })
  })

  it('forgets a rejection instead of caching the failure forever', async () => {
    let fail = true
    const under = vi.fn(async () => {
      if (fail) throw new Error('nope')
      return { path: '/ok.wav', durationSec: 2 }
    })
    const resolve = makeCachedStretchResolver(under)
    await expect(resolve('/a.wav', 1.5)).rejects.toThrow('nope')
    fail = false
    // Same eviction-on-rejection rule peakCache.ts established, so a
    // transient hiccup cannot poison a stem for the rest of the session.
    expect(await resolve('/a.wav', 1.5)).toEqual({ path: '/ok.wav', durationSec: 2 })
    expect(under).toHaveBeenCalledTimes(2)
  })

  it('does not grow without bound while radio churns through stems', async () => {
    const under = async (p: string): Promise<{ path: string; durationSec: number }> => ({
      path: p,
      durationSec: 1
    })
    const resolve = makeCachedStretchResolver(under)
    for (let i = 0; i < STRETCH_RESOLVE_CACHE_LIMIT + 25; i++) await resolve(`/s${i}.wav`, 1.5)
    expect(peekStretchResolve('/s0.wav', 1.5)).toBeNull()
    const last = STRETCH_RESOLVE_CACHE_LIMIT + 24
    expect(peekStretchResolve(`/s${last}.wav`, 1.5)).not.toBeNull()
  })
})
