import { describe, expect, it } from 'vitest'
import type { AppState } from '../state/store'
import { warmStemCaches } from './warmStemCaches'

function stateWith(paths: string[][]): AppState {
  const rifffs: Record<string, { stems: { path: string }[] }> = {}
  paths.forEach((stems, i) => {
    rifffs[`r${i}`] = { stems: stems.map((path) => ({ path })) }
  })
  return { rifffs } as unknown as AppState
}

describe('warmStemCaches', () => {
  it('warms every distinct path once, at most 4 at a time (plan T9)', async () => {
    const paths = Array.from({ length: 11 }, (_, i) => `/p/${i}.wav`)
    let inFlight = 0
    let peak = 0
    const warmed: string[] = []
    await warmStemCaches(stateWith([paths.slice(0, 6), paths.slice(4)]), async (path) => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 1))
      warmed.push(path)
      inFlight -= 1
    })
    expect(peak).toBe(4)
    expect([...warmed].sort()).toEqual([...paths].sort())
  })

  it('one failing path does not stop the rest', async () => {
    const warmed: string[] = []
    await warmStemCaches(stateWith([['/a', '/b', '/c']]), async (path) => {
      if (path === '/b') throw new Error('gone')
      warmed.push(path)
    })
    expect(warmed.sort()).toEqual(['/a', '/c'])
  })
})
