import { describe, expect, it, vi } from 'vitest'
import { buildEngineProject } from './buildEngineProject'
import type { AppState } from '../renderer/src/state/store'
import { initialState } from '../renderer/src/state/store'
import type { Rifff } from './types'

const rifff: Rifff = {
  groupId: 'r1',
  name: 'test',
  bpm: 150,
  barLength: 8,
  folderPath: '/x',
  startBar: 4,
  stems: [
    { slot: 1, author: 'e', name: 'a', type: 'fx', path: '/a.wav', durationSec: 12.8, barLength: 8 }
  ]
}

function stateWith(overrides: Partial<AppState>): AppState {
  return { ...initialState, rifffs: { r1: rifff }, ...overrides }
}

describe('buildEngineProject', () => {
  it('resolves an unstretched stem to its own path (ratio ~1)', async () => {
    const resolveStretched = vi.fn()
    const state = stateWith({ bpm: 150 }) // matches rifff.bpm -> ratio 1, no stretch call needed
    const project = await buildEngineProject(state, resolveStretched)
    expect(resolveStretched).not.toHaveBeenCalled()
    expect(project.rifffs).toHaveLength(1)
    expect(project.rifffs[0].stems[0].resolvedPath).toBe('/a.wav')
  })

  it('resolves a stretched stem via the provided resolver when stretch is on and bpm differs', async () => {
    const resolveStretched = vi.fn().mockResolvedValue('/a-stretched.wav')
    const state = stateWith({ bpm: 100, stretch: { r1: true } })
    const project = await buildEngineProject(state, resolveStretched)
    expect(resolveStretched).toHaveBeenCalledWith('/a.wav', 100 / 150)
    expect(project.rifffs[0].stems[0].resolvedPath).toBe('/a-stretched.wav')
  })

  it('skips unstretched-path resolution when stretch is explicitly off, even if bpm differs', async () => {
    const resolveStretched = vi.fn()
    const state = stateWith({ bpm: 100, stretch: { r1: false } })
    const project = await buildEngineProject(state, resolveStretched)
    expect(resolveStretched).not.toHaveBeenCalled()
    expect(project.rifffs[0].stems[0].resolvedPath).toBe('/a.wav')
  })

  it('excludes rifffs not yet placed on the timeline', async () => {
    const unplaced: Rifff = { ...rifff, groupId: 'r2', startBar: undefined }
    const state = stateWith({ rifffs: { r1: rifff, r2: unplaced } })
    const project = await buildEngineProject(state, vi.fn())
    expect(project.rifffs.map((r) => r.groupId)).toEqual(['r1'])
  })

  it('carries volume/mute/offset/fade fields through', async () => {
    const state = stateWith({
      vol: { 'r1:1': 0.7 },
      mute: { 'r1:1': true },
      off: { r1: 2 },
      fadeIn: { r1: 1.5 },
      fadeOut: { r1: 0.5 }
    })
    const project = await buildEngineProject(state, vi.fn())
    const stem = project.rifffs[0].stems[0]
    expect(stem.volume).toBe(0.7)
    expect(stem.muted).toBe(true)
    expect(stem.offsetSteps).toBe(2)
    expect(project.rifffs[0].fadeInBars).toBe(1.5)
    expect(project.rifffs[0].fadeOutBars).toBe(0.5)
  })

  it('uses the unlinked stem start override when the group is unlinked', async () => {
    const state = stateWith({
      unlinked: { r1: true },
      stemStart: { 'r1:1': 9 }
    })
    const project = await buildEngineProject(state, vi.fn())
    expect(project.rifffs[0].stems[0].startBarOverride).toBe(9)
  })

  it('uses -1 as startBarOverride when the stem is not unlinked (matches the rifff default)', async () => {
    const state = stateWith({})
    const project = await buildEngineProject(state, vi.fn())
    expect(project.rifffs[0].stems[0].startBarOverride).toBe(-1)
  })
})
