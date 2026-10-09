import { afterEach, describe, expect, it, vi } from 'vitest'
import { initialState, type AppState } from './store'
import { dirtyCheckJson } from './saveSerialization'
import { openWithReonedRepair, repairReonedCopiesOnOpen } from './reonedRepairOnOpen'
import { reonedMissingPaths, retryableReonedMissingPaths, setReonedMissing } from './reonedMissing'
import type { ReonedRepairOutcome } from '@shared/reonedRepair'

const COPY = '/lib/.bakes/0123456789abcdef0123456789abcdef.baked.wav'
const NEW = '/lib/.bakes/ffffffffffffffffffffffffffffffff.baked.wav'

function loaded(): AppState {
  return {
    ...initialState,
    rifffs: {
      g: {
        groupId: 'g',
        name: 'g',
        bpm: 120,
        barLength: 4,
        folderPath: '',
        startBar: 0,
        stems: [
          {
            slot: 1,
            author: '',
            name: 'd',
            type: 'drums',
            path: COPY,
            durationSec: 8,
            barLength: 4,
            phaseSourcePath: '/src/d.wav',
            phaseBars: 1
          }
        ]
      }
    }
  }
}

afterEach(() => setReonedMissing([]))

describe('repairReonedCopiesOnOpen', () => {
  it('a copy rebuilt to the same name: the same state comes back, so the project is not unsaved', async () => {
    const state = loaded()
    const rebuild = vi.fn(async (): Promise<ReonedRepairOutcome[][]> => [
      [{ path: COPY, status: 'rebuilt', bakedPath: COPY, durationSec: 8 }]
    ])
    const repaired = await repairReonedCopiesOnOpen(state, rebuild)
    expect(repaired).toBe(state)
    expect(reonedMissingPaths()).toEqual([])
  })

  it('an unreachable original marks the stem missing and changes nothing else', async () => {
    const state = loaded()
    const repaired = await repairReonedCopiesOnOpen(state, async () => [
      [{ path: COPY, status: 'missing', reason: 'unreachable' }]
    ])
    expect(repaired).toBe(state)
    expect(reonedMissingPaths()).toEqual([COPY])
    expect(retryableReonedMissingPaths()).toEqual([COPY])
  })

  it('a failed render is missing too, but not retried', async () => {
    await repairReonedCopiesOnOpen(loaded(), async () => [
      [{ path: COPY, status: 'missing', reason: 'render-failed' }]
    ])
    expect(reonedMissingPaths()).toEqual([COPY])
    expect(retryableReonedMissingPaths()).toEqual([])
  })

  it('no IPC at all for a project without copies; a failing IPC is logged, not thrown', async () => {
    const rebuild = vi.fn()
    const plain = { ...loaded(), rifffs: {} }
    await expect(repairReonedCopiesOnOpen(plain, rebuild)).resolves.toBe(plain)
    expect(rebuild).not.toHaveBeenCalled()
    const state = loaded()
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(
      repairReonedCopiesOnOpen(state, async () => {
        throw new Error('ipc')
      })
    ).resolves.toBe(state)
    log.mockRestore()
  })

  it('opening a project clears what the last one had missing', async () => {
    setReonedMissing([{ path: '/old.baked.wav', reason: 'unreachable' }])
    await repairReonedCopiesOnOpen({ ...loaded(), rifffs: {} }, vi.fn())
    expect(reonedMissingPaths()).toEqual([])
  })
})

describe('openWithReonedRepair: the saved baseline is the file as saved', () => {
  it('a repair that keeps every path leaves the project saved', async () => {
    const state = loaded()
    const opened = await openWithReonedRepair(state, async () => [
      [{ path: COPY, status: 'rebuilt', bakedPath: COPY, durationSec: 8 }]
    ])
    expect(opened.state).toBe(state)
    expect(dirtyCheckJson(opened.state)).toBe(opened.savedJson)
  })

  it('a repair that changes a path leaves the project unsaved, which is true', async () => {
    const state = loaded()
    const opened = await openWithReonedRepair(state, async () => [
      [{ path: COPY, status: 'rebuilt', bakedPath: NEW, durationSec: 8.01 }]
    ])
    expect(opened.state.rifffs.g.stems[0].path).toBe(NEW)
    expect(opened.savedJson).toBe(dirtyCheckJson(state))
    expect(dirtyCheckJson(opened.state)).not.toBe(opened.savedJson)
  })
})
