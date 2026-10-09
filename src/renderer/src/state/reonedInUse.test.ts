import { afterEach, describe, expect, it } from 'vitest'
import { __setHistoryForTest } from './StoreContext'
import { collectInMemoryReonedNames, setReonedSessionRoot } from './reonedInUse'
import { createHistoryState } from './history'
import { initialState } from './store'

const n = (i: number): string => `${String(i).padStart(32, '0')}.baked.wav`
const stateWith = (i: number): unknown => ({ rifffs: { g: { stems: [{ path: `/b/${n(i)}` }] } } })

afterEach(() => {
  __setHistoryForTest(createHistoryState(initialState))
  setReonedSessionRoot('cross', null)
  setReonedSessionRoot('discover', null)
})

describe('collectInMemoryReonedNames', () => {
  it('the project, its undo and redo, and open cross and discover sessions', () => {
    __setHistoryForTest({
      past: [stateWith(1)],
      present: stateWith(2),
      future: [stateWith(3)]
    } as never)
    setReonedSessionRoot('cross', { parents: [{ sources: [{ path: `/b/${n(4)}` }] }] })
    setReonedSessionRoot('discover', [{ seedStem: { path: `/b/${n(5)}` } }])
    expect(collectInMemoryReonedNames().sort()).toEqual([n(1), n(2), n(3), n(4), n(5)])
    setReonedSessionRoot('cross', null)
    expect(collectInMemoryReonedNames()).not.toContain(n(4))
  })
})
