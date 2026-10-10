import { afterEach, describe, expect, it } from 'vitest'
import {
  reconcileReonedMissing,
  reonedMissingPaths,
  retryableReonedMissingPaths,
  setReonedMissing,
  subscribeReonedMissing
} from './reonedMissing'

const copy = (i: number): string => `/lib/.bakes/${String(i).padStart(32, '0')}.baked.wav`
const rifffs = (...paths: string[]): Record<string, { stems: { path: string }[] }> => ({
  g: { stems: paths.map((path) => ({ path })) }
})

afterEach(() => setReonedMissing([]))

// Review finding I3: the set only ever shrank when a copy came back, so a stem deleted, a riff
// removed, or an open that failed after its repair left entries no stem names, and the retry
// timer ran forever.
describe('reconcileReonedMissing', () => {
  it('drops the copies no stem names any more, keeping the rest and their reasons', () => {
    setReonedMissing([
      { path: copy(1), reason: 'unreachable' },
      { path: copy(2), reason: 'unreachable' },
      { path: copy(3), reason: 'render-failed' }
    ])
    reconcileReonedMissing(rifffs(copy(2), copy(3), '/elsewhere/plain.wav'))
    expect(reonedMissingPaths()).toEqual([copy(2), copy(3)])
    expect(retryableReonedMissingPaths()).toEqual([copy(2)])
  })

  it('clears the set when no stem names any of them, which stops the retry', () => {
    setReonedMissing([{ path: copy(1), reason: 'unreachable' }])
    let published = 0
    const unsubscribe = subscribeReonedMissing(() => published++)
    reconcileReonedMissing({})
    unsubscribe()
    expect(reonedMissingPaths()).toEqual([])
    expect(retryableReonedMissingPaths()).toEqual([])
    expect(published).toBe(1)
  })

  it('publishes nothing when every entry is still named', () => {
    setReonedMissing([{ path: copy(1), reason: 'unreachable' }])
    let published = 0
    const unsubscribe = subscribeReonedMissing(() => published++)
    reconcileReonedMissing(rifffs(copy(1)))
    unsubscribe()
    expect(published).toBe(0)
  })
})
