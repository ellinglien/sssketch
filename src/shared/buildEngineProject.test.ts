import { describe, expect, it, vi } from 'vitest'
import { buildEngineProject, type EngineStem } from './buildEngineProject'
import type { AppState } from '../renderer/src/state/store'
import { initialState } from '../renderer/src/state/store'
import type { Rifff } from './types'
import { DEFAULT_REVERB, defaultFilterSettings } from './toolkit'

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

  it('carries volume/mute/offset fields through', async () => {
    const state = stateWith({
      bpm: 150, // matches rifff.bpm -> ratio 1, no stretch call needed
      vol: { 'r1:1': 0.7 },
      mute: { 'r1:1': true },
      off: { r1: 2 }
    })
    const project = await buildEngineProject(state, vi.fn(), emptyCatalog)
    const stem = project.rifffs[0].stems[0]
    expect(stem.volume).toBe(0.7)
    expect(stem.muted).toBe(true)
    expect(stem.offsetSteps).toBe(2)
  })

  it('prefers a live drag-preview volume over the committed value when present', async () => {
    const state = stateWith({
      bpm: 150,
      vol: { 'r1:1': 0.7 },
      dragVol: { 'r1:1': 0.2 }
    })
    const project = await buildEngineProject(state, vi.fn(), emptyCatalog)
    expect(project.rifffs[0].stems[0].volume).toBe(0.2)
  })

  it('falls back to the committed volume when no drag preview is present', async () => {
    const state = stateWith({ bpm: 150, vol: { 'r1:1': 0.7 } })
    const project = await buildEngineProject(state, vi.fn(), emptyCatalog)
    expect(project.rifffs[0].stems[0].volume).toBe(0.7)
  })

  it('a drag-preview value of exactly 0 (fader dragged to silence) is not skipped in favor of the committed value', async () => {
    // Regression guard for `??` (preserves 0) vs `||` (would incorrectly
    // fall through to the committed value on 0) -- easy typo given how
    // visually similar the two operators are in this "prefer this, else
    // fall back" shape.
    const state = stateWith({
      bpm: 150,
      vol: { 'r1:1': 0.7 },
      dragVol: { 'r1:1': 0 }
    })
    const project = await buildEngineProject(state, vi.fn(), emptyCatalog)
    expect(project.rifffs[0].stems[0].volume).toBe(0)
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

  // Real perf bug, found live 2026-09-15 via a direct report on a real
  // 409-placed-stem project ("it's all very sluggish, the interface
  // takes a while for buttons to register"): every stem needing a stretch
  // used to be resolved SEQUENTIALLY, one `await resolveStretched(...)`
  // at a time -- this function's own wall-clock cost scaled linearly with
  // placed-stem count, on every single tracked state change, not just a
  // real tempo change. Proves multiple stems' own resolutions now run
  // CONCURRENTLY (not queued) by tracking how many of the mock resolver's
  // own calls are simultaneously in flight -- more than one in flight at
  // once is only possible if buildEngineProject isn't awaiting each call
  // before starting the next.
  it('resolves multiple stems needing a stretch CONCURRENTLY, not one at a time', async () => {
    const NUM_RIFFFS = 5
    const rifffs: Record<string, Rifff> = {}
    for (let i = 0; i < NUM_RIFFFS; i++) {
      rifffs[`r${i}`] = {
        groupId: `r${i}`,
        name: `test${i}`,
        bpm: 150,
        barLength: 8,
        folderPath: '/x',
        startBar: i * 8,
        stems: [
          {
            slot: 1,
            author: 'e',
            name: 'a',
            type: 'fx',
            path: `/${i}.wav`,
            durationSec: 12.8,
            barLength: 8
          }
        ]
      }
    }
    let inFlight = 0
    let maxInFlight = 0
    const resolveStretched = vi.fn(async (path: string) => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 5))
      inFlight -= 1
      return { path: `${path}.stretched`, durationSec: 12.8 }
    })
    // bpm 100 != every rifff's own 150 -- every stem needs a real stretch.
    const state = stateWith({ bpm: 100, rifffs })
    const project = await buildEngineProject(state, resolveStretched, emptyCatalog)

    expect(resolveStretched).toHaveBeenCalledTimes(NUM_RIFFFS)
    expect(maxInFlight).toBeGreaterThan(1)
    // Concurrency must never corrupt WHICH result lands on which stem --
    // every rifff's own stem still resolves to its own real stretched path,
    // not a different rifff's.
    expect(project.rifffs).toHaveLength(NUM_RIFFFS)
    for (const engineRifff of project.rifffs) {
      const i = engineRifff.groupId.replace('r', '')
      expect(engineRifff.stems[0].resolvedPath).toBe(`/${i}.wav.stretched`)
    }
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
      { pluginId: '', path: '', stateBase64: '' },
      {
        pluginId: 'pro-q-3',
        path: '/Library/Audio/Plug-Ins/VST3/FabFilter Pro-Q 3.vst3',
        stateBase64: ''
      },
      { pluginId: '', path: '', stateBase64: '' },
      { pluginId: 'soothe2', path: '/Library/Audio/Plug-Ins/VST3/soothe2.vst3', stateBase64: '' }
    ])
  })

  it('resolves to an empty path when the catalog id is not found (e.g. plugin no longer scanned)', async () => {
    const state = stateWith({ bpm: 150, masterChain: ['unknown-id', null, null, null] })
    const project = await buildEngineProject(state, vi.fn(), emptyCatalog)
    expect(project.masterChain[0]).toEqual({ pluginId: 'unknown-id', path: '', stateBase64: '' })
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
          {
            pluginId: 'pro-q-3',
            path: '/Library/Audio/Plug-Ins/VST3/FabFilter Pro-Q 3.vst3',
            stateBase64: ''
          },
          { pluginId: '', path: '', stateBase64: '' }
        ]
      }
    ])
  })

  it('omits a channel from channelChains if it has no plugins loaded', async () => {
    const state = stateWith({ bpm: 150, channelOf: { r1: 'ch-1' }, channelPlugins: {} })
    const project = await buildEngineProject(state, vi.fn(), emptyCatalog)
    expect(project.channelChains).toEqual([])
  })

  it('threads pluginStates into masterChain/channelChains, matched by slot address and pluginId', async () => {
    const state = stateWith({
      bpm: 150,
      masterChain: ['reverb-plugin', null, null, null],
      channelPlugins: { kick: ['comp-plugin', null] }
    })
    const pluginCatalog = {
      plugins: [
        { id: 'reverb-plugin', path: '/plugins/reverb.vst3' },
        { id: 'comp-plugin', path: '/plugins/comp.vst3' }
      ]
    }
    const pluginStates = {
      'master:0': { pluginId: 'reverb-plugin', stateBase64: 'AQIDBA==' },
      'channel:kick:0': { pluginId: 'comp-plugin', stateBase64: 'Q0FUUw==' }
    }

    const project = await buildEngineProject(
      state,
      async (path) => ({ path, durationSec: 1 }),
      pluginCatalog,
      pluginStates
    )

    expect(project.masterChain[0].stateBase64).toBe('AQIDBA==')
    const kickChain = project.channelChains.find((c) => c.channelId === 'kick')
    expect(kickChain?.slots[0].stateBase64).toBe('Q0FUUw==')
  })

  it('leaves stateBase64 empty when pluginStates is omitted (existing callers unaffected)', async () => {
    const state = stateWith({ bpm: 150, masterChain: ['reverb-plugin', null, null, null] })
    const pluginCatalog = { plugins: [{ id: 'reverb-plugin', path: '/plugins/reverb.vst3' }] }

    const project = await buildEngineProject(
      state,
      async (path) => ({ path, durationSec: 1 }),
      pluginCatalog
    )

    expect(project.masterChain[0].stateBase64).toBe('')
  })

  it('leaves stateBase64 empty when a captured entry exists but its pluginId no longer matches the slot', async () => {
    const state = stateWith({ bpm: 150, masterChain: ['a-different-plugin', null, null, null] })
    const pluginCatalog = { plugins: [{ id: 'a-different-plugin', path: '/plugins/other.vst3' }] }
    const pluginStates = {
      'master:0': { pluginId: 'reverb-plugin', stateBase64: 'AQIDBA==' } // stale -- a different plugin now occupies slot 0
    }

    const project = await buildEngineProject(
      state,
      async (path) => ({ path, durationSec: 1 }),
      pluginCatalog,
      pluginStates
    )

    expect(project.masterChain[0].stateBase64).toBe('')
  })
})

// ---- built-in sound toolkit ----
// docs/superpowers/specs/2026-09-22-builtin-sound-toolkit-design.md, section
// 2b (the per-CLIP rescope). The wire-format twin of
// EngineStem::EngineStemToolkit in native-engine/Source/EngineProject.h --
// these tests and EngineProjectTests.cpp's own toolkit cases are the two
// halves of the same contract.
describe('buildEngineProject toolkit', () => {
  const resolveNothing = async (path: string): Promise<{ path: string; durationSec: number }> => ({
    path,
    durationSec: 1
  })

  async function firstStem(state: AppState): Promise<EngineStem> {
    const project = await buildEngineProject(state, resolveNothing, emptyCatalog)
    return project.rifffs[0].stems[0]
  }

  it('sends NO toolkit key at all on a stem for a project that never touched it', async () => {
    // This is the guarantee an old project depends on: the absence of the
    // key is what makes the engine take its pre-toolkit render path, and a
    // stem object with no `toolkit` property is byte-for-byte the payload
    // this app sent before the toolkit existed.
    const stem = await firstStem(stateWith({ bpm: 150 }))
    expect('toolkit' in stem).toBe(false)
    const project = await buildEngineProject(stateWith({ bpm: 150 }), resolveNothing, emptyCatalog)
    expect(project.reverb).toEqual(DEFAULT_REVERB)
  })

  it('omits a clip whose filter is parked at its own neutral end with no send or curves', async () => {
    const stem = await firstStem(
      stateWith({
        bpm: 150,
        stemFilters: { 'r1:1': defaultFilterSettings('lowpass') },
        stemSends: { 'r1:1': 0 }
      })
    )
    expect('toolkit' in stem).toBe(false)
  })

  it('carries a moved filter, a send and every curve onto the wire', async () => {
    const stem = await firstStem(
      stateWith({
        bpm: 150,
        stemFilters: { 'r1:1': { mode: 'highpass', cutoff: 0.4, resonance: 0.6 } },
        stemSends: { 'r1:1': 0.35 },
        stemAutomation: {
          'r1:1': {
            filterCutoff: [
              { bar: 0, value: 0.1 },
              { bar: 8, value: 0.9 }
            ]
          }
        }
      })
    )

    expect(stem.toolkit).toEqual({
      filterMode: 'highpass',
      filterCutoff: 0.4,
      filterResonance: 0.6,
      reverbSend: 0.35,
      volume: 1,
      // rifff.startBar is 4, with no crop and no re-one offset.
      originBar: 4,
      automation: {
        filterCutoff: [
          { bar: 0, value: 0.1 },
          { bar: 8, value: 0.9 }
        ],
        // Every curve is a concrete array on the wire, even the untouched
        // ones -- the engine reads four fixed keys.
        filterResonance: [],
        reverbSend: [],
        volume: []
      }
    })
  })

  it("multiplies the clip's gain dial through its volume curve, so the dial is the level and the curve the shape", async () => {
    const stem = await firstStem(
      stateWith({
        bpm: 150,
        vol: { 'r1:1': 0.5 },
        stemAutomation: {
          'r1:1': {
            volume: [
              { bar: 0, value: 0 },
              { bar: 2, value: 1 },
              { bar: 8, value: 0.4 }
            ]
          }
        }
      })
    )

    // The engine treats a non-empty volume curve as the clip's whole level
    // and ignores EngineStem.volume (PlaybackEngine.cpp's volumeAutomated),
    // so the gain has to arrive folded INTO the curve for the two to
    // multiply. toolkit.volume stays 1: it is only the fallback the engine
    // uses when the curve is empty, where EngineStem.volume already applies.
    expect(stem.toolkit?.automation.volume).toEqual([
      { bar: 0, value: 0 },
      { bar: 2, value: 0.5 },
      { bar: 8, value: 0.2 }
    ])
    expect(stem.toolkit?.volume).toBe(1)
    expect(stem.volume).toBe(0.5)
  })

  it('prefers an in-progress gain drag over the committed gain when scaling the curve', async () => {
    const stem = await firstStem(
      stateWith({
        bpm: 150,
        vol: { 'r1:1': 0.5 },
        dragVol: { 'r1:1': 0.25 },
        stemAutomation: { 'r1:1': { volume: [{ bar: 0, value: 1 }] } }
      })
    )
    expect(stem.toolkit?.automation.volume).toEqual([{ bar: 0, value: 0.25 }])
    expect(stem.volume).toBe(0.25)
  })

  it('leaves the other three curves alone -- only volume is a level', async () => {
    const stem = await firstStem(
      stateWith({
        bpm: 150,
        vol: { 'r1:1': 0.5 },
        stemAutomation: {
          'r1:1': {
            filterCutoff: [{ bar: 0, value: 0.8 }],
            reverbSend: [{ bar: 0, value: 0.6 }]
          }
        }
      })
    )
    expect(stem.toolkit?.automation.filterCutoff).toEqual([{ bar: 0, value: 0.8 }])
    expect(stem.toolkit?.automation.reverbSend).toEqual([{ bar: 0, value: 0.6 }])
  })

  it('keeps two stems of one rifff independent -- the toolkit is per clip, not per row', async () => {
    const twoStem: Rifff = {
      ...rifff,
      stems: [
        ...rifff.stems,
        {
          slot: 6,
          author: 'e',
          name: 'b',
          type: 'fx',
          path: '/b.wav',
          durationSec: 12.8,
          barLength: 8
        }
      ]
    }
    const project = await buildEngineProject(
      {
        ...initialState,
        bpm: 150,
        rifffs: { r1: twoStem },
        stemAutomation: { 'r1:6': { volume: [{ bar: 0, value: 0.5 }] } }
      },
      resolveNothing,
      emptyCatalog
    )
    const [a, b] = project.rifffs[0].stems
    expect('toolkit' in a).toBe(false)
    expect(b.toolkit?.automation.volume).toEqual([{ bar: 0, value: 0.5 }])
  })

  it("originBar is the clip's own drawn left edge: startBar + leftCrop + the re-one offset", async () => {
    const stem = await firstStem(
      stateWith({
        bpm: 150,
        snapIdx: 2, // SNAP_DIVS[2] === 4, so 6 steps is 1.5 bars
        off: { r1: 6 },
        leftCrop: { r1: 2 },
        stemAutomation: { 'r1:1': { volume: [{ bar: 0, value: 0.5 }] } }
      })
    )
    // startBar 4 + leftCrop 2 + offset 1.5 -- the exact same three terms
    // clipGeometryFromFields uses to place the clip on screen, which is what
    // makes "bar 0 of the curve" and "the left edge of the clip" the same
    // place.
    expect(stem.toolkit?.originBar).toBe(7.5)
  })

  it('includes a clip that has ONLY automation, with its static values left neutral', async () => {
    const stem = await firstStem(
      stateWith({
        bpm: 150,
        stemAutomation: { 'r1:1': { volume: [{ bar: 0, value: 0.5 }] } }
      })
    )
    expect(stem.toolkit?.filterMode).toBe('lowpass')
    // Neutral for THAT mode -- a send-only or automation-only clip must not
    // arrive with a filter that silences it.
    expect(stem.toolkit?.filterCutoff).toBe(1)
    expect(stem.toolkit?.reverbSend).toBe(0)
  })

  it("falls back to the clip's own mode neutral cutoff when only a send is set", async () => {
    const stem = await firstStem(
      stateWith({
        bpm: 150,
        stemFilters: { 'r1:1': { mode: 'highpass', cutoff: 0, resonance: 0 } },
        stemSends: { 'r1:1': 0.5 }
      })
    )
    expect(stem.toolkit?.filterCutoff).toBe(0) // highpass neutral, not 1
  })

  it('normalises curves on the way out: sorted, clamped, non-finite dropped', async () => {
    const stem = await firstStem(
      stateWith({
        bpm: 150,
        stemAutomation: {
          'r1:1': {
            reverbSend: [
              { bar: 8, value: 3 },
              { bar: 2, value: -1 },
              { bar: NaN, value: 0.5 }
            ]
          }
        }
      })
    )
    expect(stem.toolkit?.automation.reverbSend).toEqual([
      { bar: 2, value: 0 },
      { bar: 8, value: 1 }
    ])
  })

  it('sends the project reverb settings, which stay project-wide after the rescope', async () => {
    const project = await buildEngineProject(
      stateWith({
        bpm: 150,
        reverb: { roomSize: 0.8, damping: 0.2, preDelayMs: 45 },
        stemSends: { 'r1:1': 0.5 }
      }),
      resolveNothing,
      emptyCatalog
    )
    expect(project.reverb).toEqual({ roomSize: 0.8, damping: 0.2, preDelayMs: 45 })
    expect(project.rifffs[0].stems[0].toolkit?.reverbSend).toBe(0.5)
  })
})
