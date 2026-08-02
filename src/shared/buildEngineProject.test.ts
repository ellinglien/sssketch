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

const emptyCatalog = { plugins: [] }

describe('buildEngineProject', () => {
  it('resolves an unstretched stem to its own path (ratio ~1)', async () => {
    const resolveStretched = vi.fn()
    const state = stateWith({ bpm: 150 }) // matches rifff.bpm -> ratio 1, no stretch call needed
    const project = await buildEngineProject(state, resolveStretched, emptyCatalog)
    expect(resolveStretched).not.toHaveBeenCalled()
    expect(project.rifffs).toHaveLength(1)
    expect(project.rifffs[0].stems[0].resolvedPath).toBe('/a.wav')
  })

  it("carries a one-shot stem's oneShot/trim fields onto the wire, defaulting trimEndSec to -1 when unset", async () => {
    const resolveStretched = vi.fn()
    const oneShotRifff: Rifff = {
      groupId: 'r1',
      name: 'kick',
      bpm: 150,
      barLength: 8,
      folderPath: '/tmp/kick.wav',
      startBar: 4,
      stems: [
        {
          slot: 1,
          author: '',
          name: 'kick',
          type: 'fx',
          path: '/kick.wav',
          durationSec: 0.6,
          barLength: 8,
          oneShot: true,
          trimStartSec: 0.1
        }
      ]
    }
    const state = stateWith({ bpm: 150, rifffs: { r1: oneShotRifff } })
    const project = await buildEngineProject(state, resolveStretched, emptyCatalog)
    const stem = project.rifffs[0].stems[0]
    expect(stem.oneShot).toBe(true)
    expect(stem.trimStartSec).toBeCloseTo(0.1)
    expect(stem.trimEndSec).toBe(-1)
  })

  it('resolves a stretched stem via the provided resolver when stretch is on and bpm differs', async () => {
    const resolveStretched = vi
      .fn()
      .mockResolvedValue({ path: '/a-stretched.wav', durationSec: 19.2 })
    const state = stateWith({ bpm: 100, stretch: { r1: true } })
    const project = await buildEngineProject(state, resolveStretched, emptyCatalog)
    expect(resolveStretched).toHaveBeenCalledTimes(1)
    const [calledPath, calledRatio] = resolveStretched.mock.calls[0]
    expect(calledPath).toBe('/a.wav')
    expect(calledRatio).toBeCloseTo(100 / 150, 10)
    expect(project.rifffs[0].stems[0].resolvedPath).toBe('/a-stretched.wav')
  })

  it("uses the resolver-reported duration of the STRETCHED file, not the source stem's own durationSec — regression test for a real bug where a slowed-down rifff left trailing silence because the native engine's per-bar timing (durationSec / barLength) was computed from the pre-stretch duration instead of the stretched file's actual length", async () => {
    // rifff.bpm=150, project bpm=100 -> ratio=100/150=0.6667 (<1, slowing down),
    // which per rubberband's real, verified semantics (see rubberband.ts's
    // comment) produces a LONGER file than the 12.8s source stem — the
    // resolver here reports that real, measured, longer duration (19.2s,
    // matching the exact fixture already verified end-to-end in rubberband.ts's
    // own doc comment: 12.8/0.6667 = 19.2).
    const resolveStretched = vi
      .fn()
      .mockResolvedValue({ path: '/a-stretched.wav', durationSec: 19.2 })
    const state = stateWith({ bpm: 100, stretch: { r1: true } })
    const project = await buildEngineProject(state, resolveStretched, emptyCatalog)
    const stem = project.rifffs[0].stems[0]
    // Must be the resolver's reported (stretched) duration, NOT the source
    // stem's own unstretched 12.8s — sending the wrong one here is exactly
    // the bug: it desyncs the native engine's per-bar timing from the
    // project's own tempo and silently truncates the tail of the loop.
    expect(stem.durationSec).toBe(19.2)
    expect(stem.durationSec).not.toBe(rifff.stems[0].durationSec)
  })

  it("computes each stem's stretch ratio from its OWN duration/barLength, not the rifff's declared bpm — regression test for a real LORE riff (b5a204a0, verified against the actual warehouse) where one stem was recorded at a different native tempo than the rest of the riff, still perfectly loop-locked (same bar count). The old code used state.bpm/rifff.bpm uniformly for every stem, which stretched that one stem by the wrong ratio and made it audibly play at the wrong speed relative to the others", async () => {
    const mixedTempoRifff: Rifff = {
      ...rifff,
      bpm: 150, // the riff's own declared bpm — no longer used in the ratio calc at all
      stems: [
        // native ~150bpm: durationSec/barLength = 1.6 sec/bar = (60/150)*4
        {
          slot: 1,
          author: 'e',
          name: 'a',
          type: 'fx',
          path: '/a.wav',
          durationSec: 12.8,
          barLength: 8
        },
        // native ~100bpm: durationSec/barLength = 2.4 sec/bar = (60/100)*4 — mismatched vs the riff's own 150bpm
        {
          slot: 2,
          author: 'e',
          name: 'b',
          type: 'fx',
          path: '/b.wav',
          durationSec: 19.2,
          barLength: 8
        }
      ]
    }
    const resolveStretched = vi.fn().mockResolvedValue({ path: '/stretched.wav', durationSec: 1 })
    const state = stateWith({ bpm: 120, rifffs: { r1: mixedTempoRifff }, stretch: { r1: true } })
    await buildEngineProject(state, resolveStretched, emptyCatalog)

    const calls = resolveStretched.mock.calls
    const aCall = calls.find((c) => c[0] === '/a.wav')
    const bCall = calls.find((c) => c[0] === '/b.wav')
    expect(aCall?.[1]).toBeCloseTo(120 / 150, 5)
    expect(bCall?.[1]).toBeCloseTo(120 / 100, 5)
  })

  it('skips unstretched-path resolution when stretch is explicitly off, even if bpm differs', async () => {
    const resolveStretched = vi.fn()
    const state = stateWith({ bpm: 100, stretch: { r1: false } })
    const project = await buildEngineProject(state, resolveStretched, emptyCatalog)
    expect(resolveStretched).not.toHaveBeenCalled()
    expect(project.rifffs[0].stems[0].resolvedPath).toBe('/a.wav')
  })

  it('excludes rifffs not yet placed on the timeline', async () => {
    const unplaced: Rifff = { ...rifff, groupId: 'r2', startBar: undefined }
    const state = stateWith({ bpm: 150, rifffs: { r1: rifff, r2: unplaced } }) // matches rifff.bpm -> ratio 1, no stretch call needed
    const project = await buildEngineProject(state, vi.fn(), emptyCatalog)
    expect(project.rifffs.map((r) => r.groupId)).toEqual(['r1'])
  })

  it('carries volume/mute/offset/fade fields through', async () => {
    const state = stateWith({
      bpm: 150, // matches rifff.bpm -> ratio 1, no stretch call needed
      vol: { 'r1:1': 0.7 },
      mute: { 'r1:1': true },
      off: { r1: 2 },
      fadeIn: { r1: 1.5 },
      fadeOut: { r1: 0.5 }
    })
    const project = await buildEngineProject(state, vi.fn(), emptyCatalog)
    const stem = project.rifffs[0].stems[0]
    expect(stem.volume).toBe(0.7)
    expect(stem.muted).toBe(true)
    expect(stem.offsetSteps).toBe(2)
    expect(project.rifffs[0].fadeInBars).toBe(1.5)
    expect(project.rifffs[0].fadeOutBars).toBe(0.5)
  })

  it('always uses -1 as startBarOverride — a stem can no longer diverge from its own rifff (see UNGROUP)', async () => {
    const state = stateWith({ bpm: 150 }) // matches rifff.bpm -> ratio 1, no stretch call needed
    const project = await buildEngineProject(state, vi.fn(), emptyCatalog)
    expect(project.rifffs[0].stems[0].startBarOverride).toBe(-1)
  })

  it('falls back to the original path AND the original durationSec when the resolver rejects, rather than throwing', async () => {
    const resolveStretched = vi.fn().mockRejectedValue(new Error('rubberband binary missing'))
    const state = stateWith({ bpm: 100, stretch: { r1: true } })
    const project = await buildEngineProject(state, resolveStretched, emptyCatalog)
    const stem = project.rifffs[0].stems[0]
    expect(stem.resolvedPath).toBe('/a.wav')
    // The fallback must be fully consistent: a stem that fell back to its
    // original (unstretched) path must also report its original duration,
    // not a stretched one from a resolution that never actually happened.
    expect(stem.durationSec).toBe(rifff.stems[0].durationSec)
  })

  it('resolves playedBars via resolvePlayedBars, defaulting to rifff.barLength when unset', async () => {
    const state = stateWith({ bpm: 150 }) // ratio 1, no stretch call needed
    const project = await buildEngineProject(state, vi.fn(), emptyCatalog)
    expect(project.rifffs[0].stems[0].playedBars).toBe(rifff.barLength)
  })

  it('reflects a playedBars override', async () => {
    const state = stateWith({ bpm: 150, playedBars: { r1: 16 } })
    const project = await buildEngineProject(state, vi.fn(), emptyCatalog)
    expect(project.rifffs[0].stems[0].playedBars).toBe(16)
  })

  it('resolves a catalog id to its real path, using "" for an empty slot', async () => {
    const catalog = {
      plugins: [
        { id: 'pro-q-3', path: '/Library/Audio/Plug-Ins/VST3/FabFilter Pro-Q 3.vst3' },
        { id: 'soothe2', path: '/Library/Audio/Plug-Ins/VST3/soothe2.vst3' }
      ]
    }
    const state = stateWith({ bpm: 150, masterChain: [null, 'pro-q-3', null, 'soothe2'] })
    const project = await buildEngineProject(state, vi.fn(), catalog)
    expect(project.masterChain).toEqual([
      { pluginId: '', path: '' },
      { pluginId: 'pro-q-3', path: '/Library/Audio/Plug-Ins/VST3/FabFilter Pro-Q 3.vst3' },
      { pluginId: '', path: '' },
      { pluginId: 'soothe2', path: '/Library/Audio/Plug-Ins/VST3/soothe2.vst3' }
    ])
  })

  it('resolves to an empty path when the catalog id is not found (e.g. plugin no longer scanned)', async () => {
    const state = stateWith({ bpm: 150, masterChain: ['unknown-id', null, null, null] })
    const project = await buildEngineProject(state, vi.fn(), emptyCatalog)
    expect(project.masterChain[0]).toEqual({ pluginId: 'unknown-id', path: '' })
  })

  it("resolves each rifff's channelId from channelOf", async () => {
    const state = stateWith({ bpm: 150, channelOf: { r1: 'ch-1' } })
    const project = await buildEngineProject(state, vi.fn(), emptyCatalog)
    expect(project.rifffs[0].channelId).toBe('ch-1')
  })

  it("falls back to the rifff's own groupId when channelOf has no entry for it", async () => {
    const state = stateWith({ bpm: 150, channelOf: {} })
    const project = await buildEngineProject(state, vi.fn(), emptyCatalog)
    expect(project.rifffs[0].channelId).toBe('r1') // rifff's own groupId, per the fixture at the top of this file
  })

  it('resolves channelPlugins into channelChains, using real catalog paths', async () => {
    const catalog = {
      plugins: [{ id: 'pro-q-3', path: '/Library/Audio/Plug-Ins/VST3/FabFilter Pro-Q 3.vst3' }]
    }
    const state = stateWith({
      bpm: 150,
      channelOf: { r1: 'ch-1' },
      channelPlugins: { 'ch-1': ['pro-q-3', null] }
    })
    const project = await buildEngineProject(state, vi.fn(), catalog)
    expect(project.channelChains).toEqual([
      {
        channelId: 'ch-1',
        slots: [
          { pluginId: 'pro-q-3', path: '/Library/Audio/Plug-Ins/VST3/FabFilter Pro-Q 3.vst3' },
          { pluginId: '', path: '' }
        ]
      }
    ])
  })

  it('omits a channel from channelChains if it has no plugins loaded', async () => {
    const state = stateWith({ bpm: 150, channelOf: { r1: 'ch-1' }, channelPlugins: {} })
    const project = await buildEngineProject(state, vi.fn(), emptyCatalog)
    expect(project.channelChains).toEqual([])
  })
})
