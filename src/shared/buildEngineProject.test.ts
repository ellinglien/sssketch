import { describe, expect, it, vi } from 'vitest'
import {
  buildEngineProject,
  buildEngineRisers,
  buildEngineSound,
  engineDubFor,
  timelineStemPans,
  timelineStemPumpRoles,
  withoutDubThrows,
  type EngineStem
} from './buildEngineProject'
import { phoneLoopFingerprint } from './phoneLoop'
import type { PumpRole } from './radioPump'
import {
  glueThresholdDb,
  normalizeSoundSettings,
  reverbReturnGain,
  saturationDrive,
  stemExportSound,
  type SoundSettings
} from './radioSound'
import type { AppState } from '../renderer/src/state/store'
import { initialState } from '../renderer/src/state/store'
import { stemKey, type Rifff } from './types'
import { AUTOMATION_PARAMS, DEFAULT_REVERB, defaultFilterSettings, neutralCutoff } from './toolkit'
import { MIN_RISER_LENGTH_BARS, RISER_DEFAULTS, createRiser, type RiserClip } from './riser'

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

  it('sends NO masterFilter key at all when the master strip has not been touched', async () => {
    // Exactly the isStemToolkitNeutral discipline one level up: the ABSENCE
    // of the key is what puts the engine back on the path it was on before
    // the master filter existed, and what makes a resting master strip
    // bit-identical rather than nearly so (there is an engine-side test
    // asserting that, sample for sample).
    const project = await buildEngineProject(stateWith({ bpm: 150 }), resolveNothing, emptyCatalog)
    expect('masterFilter' in project).toBe(false)
  })

  it('omits a master filter parked at its own mode neutral end, whatever its resonance says', async () => {
    // A resonant peak AT a cutoff sitting on its own open end is nothing --
    // the same reason isNeutralFilter reads the cutoff only for a clip.
    const parked = await buildEngineProject(
      stateWith({ bpm: 150, masterFilter: { mode: 'lowpass', cutoff: 1, resonance: 0.8 } }),
      resolveNothing,
      emptyCatalog
    )
    expect('masterFilter' in parked).toBe(false)

    // ...but a parked HIGHPASS is still sent: absence means the engine's
    // own defaults, and those are a lowpass, so omitting the mode would
    // make the next live-param cutoff sweep the wrong kind of filter.
    const parkedHigh = await buildEngineProject(
      stateWith({ bpm: 150, masterFilter: { mode: 'highpass', cutoff: 0, resonance: 0.3 } }),
      resolveNothing,
      emptyCatalog
    )
    expect(parkedHigh.masterFilter).toEqual({ mode: 'highpass', cutoff: 0, resonance: 0.3 })
  })

  it('sends the master filter once the cutoff has actually moved off neutral', async () => {
    const project = await buildEngineProject(
      stateWith({ bpm: 150, masterFilter: { mode: 'lowpass', cutoff: 0.35, resonance: 0.5 } }),
      resolveNothing,
      emptyCatalog
    )
    expect(project.masterFilter).toEqual({ mode: 'lowpass', cutoff: 0.35, resonance: 0.5 })
    // One field beside `reverb`, and nothing per clip: the whole point of
    // 4A.3 is that this is NOT N identical per-clip curves.
    expect('toolkit' in project.rifffs[0].stems[0]).toBe(false)
  })

  it('treats a non-finite master cutoff as non-neutral rather than silently neutral', async () => {
    // Same rule the engine's channelFilterIsNeutral uses: a corrupted value
    // flows into the clamping maps rather than into bypassed arithmetic.
    const project = await buildEngineProject(
      stateWith({ bpm: 150, masterFilter: { mode: 'lowpass', cutoff: NaN, resonance: 0 } }),
      resolveNothing,
      emptyCatalog
    )
    expect(project.masterFilter).toBeDefined()
  })
})

describe('risers on the wire', () => {
  const resolveNothing = async (path: string): Promise<{ path: string; durationSec: number }> => ({
    path,
    durationSec: 12.8
  })

  it('sends an empty array for a project that has none', async () => {
    const project = await buildEngineProject(stateWith({ bpm: 150 }), resolveNothing, emptyCatalog)
    expect(project.risers).toEqual([])
  })

  it('sends a riser field for field, with no geometry resolved on its behalf', async () => {
    const riser = createRiser({ id: 'riser-1', channelId: 'ch1', startBar: 12, lengthBars: 8 })
    const project = await buildEngineProject(
      stateWith({ bpm: 150, risers: { 'riser-1': riser } }),
      resolveNothing,
      emptyCatalog
    )
    expect(project.risers).toEqual([
      {
        id: 'riser-1',
        channelId: 'ch1',
        startBar: 12,
        lengthBars: 8,
        startCutoffValue: RISER_DEFAULTS.startCutoffValue,
        endCutoffValue: RISER_DEFAULTS.endCutoffValue,
        level: RISER_DEFAULTS.level,
        curve: [
          { bar: 0, value: RISER_DEFAULTS.startCutoffValue },
          { bar: 8, value: RISER_DEFAULTS.endCutoffValue }
        ]
      }
    ])
  })

  it('orders risers earliest first, with the id as the tiebreak', async () => {
    const project = await buildEngineProject(
      stateWith({
        bpm: 150,
        risers: {
          late: createRiser({ id: 'late', channelId: 'ch1', startBar: 32 }),
          zz: createRiser({ id: 'zz', channelId: 'ch1', startBar: 0 }),
          aa: createRiser({ id: 'aa', channelId: 'ch1', startBar: 0 })
        }
      }),
      resolveNothing,
      emptyCatalog
    )
    expect(project.risers.map((r) => r.id)).toEqual(['aa', 'zz', 'late'])
  })

  it('normalises a hand-edited riser before it can reach the audio thread', async () => {
    const project = await buildEngineProject(
      stateWith({
        bpm: 150,
        risers: {
          bad: {
            ...createRiser({ id: 'bad', channelId: 'ch1', startBar: 0 }),
            startBar: Number.NaN,
            lengthBars: -4,
            level: 12,
            curve: [
              { bar: 2, value: 5 },
              { bar: 1, value: -5 }
            ]
          }
        }
      }),
      resolveNothing,
      emptyCatalog
    )
    expect(project.risers[0]).toMatchObject({
      startBar: 0,
      lengthBars: MIN_RISER_LENGTH_BARS,
      level: 1,
      curve: [
        { bar: 1, value: 0 },
        { bar: 2, value: 1 }
      ]
    })
  })

  it('leaves a muted riser off the wire entirely, rather than sending it silent', () => {
    const risers = {
      on: createRiser({ id: 'on', channelId: 'ch1', startBar: 0 }),
      off: { ...createRiser({ id: 'off', channelId: 'ch2', startBar: 4 }), muted: true }
    }
    expect(buildEngineRisers(risers).map((riser) => riser.id)).toEqual(['on'])
  })

  it('sends no risers at all when every one of them is muted', () => {
    const risers = {
      off: { ...createRiser({ id: 'off', channelId: 'ch1', startBar: 0 }), muted: true }
    }
    expect(buildEngineRisers(risers)).toEqual([])
  })

  describe('the riser character (native radio sound plan, Task 6)', () => {
    const base = createRiser({ id: 'r', channelId: 'ch1', startBar: 0 })

    it('a riser without a character sends exactly the keys it always did', () => {
      const [wire] = buildEngineRisers({ r: base })
      expect(Object.keys(wire).sort()).toEqual(
        [
          'channelId',
          'curve',
          'endCutoffValue',
          'id',
          'lengthBars',
          'level',
          'startBar',
          'startCutoffValue'
        ].sort()
      )
    })

    it("omits each field at today's value: Q 2, white, wide, no send", () => {
      const [wire] = buildEngineRisers({
        r: { ...base, q: 2, colour: 'white', stereo: 'wide', send: 0 }
      })
      expect(wire).toStrictEqual(buildEngineRisers({ r: base })[0])
    })

    it('sends each field that differs', () => {
      const [wire] = buildEngineRisers({
        r: { ...base, q: 4.5, colour: 'pink', stereo: 'mono', send: 0.3 }
      })
      expect(wire).toMatchObject({ q: 4.5, colour: 'pink', stereo: 'mono', send: 0.3 })
      const [partial] = buildEngineRisers({ r: { ...base, q: 1.5 } })
      expect(partial.q).toBe(1.5)
      expect(partial).not.toHaveProperty('colour')
      expect(partial).not.toHaveProperty('stereo')
      expect(partial).not.toHaveProperty('send')
    })

    it('clamps Q and the send, and drops junk rather than inventing a value', () => {
      const [high] = buildEngineRisers({ r: { ...base, q: 40, send: 7 } })
      expect(high).toMatchObject({ q: 6, send: 1 })
      const [low] = buildEngineRisers({ r: { ...base, q: 0.2, send: -1 } })
      expect(low.q).toBe(1)
      expect(low).not.toHaveProperty('send')
      const junk = {
        ...base,
        q: Number.NaN,
        colour: 'red',
        stereo: 7,
        send: Number.POSITIVE_INFINITY
      } as unknown as RiserClip
      expect(buildEngineRisers({ r: junk })[0]).toStrictEqual(buildEngineRisers({ r: base })[0])
    })
  })
})

describe('the sound settings on the wire (native radio sound plan, Task 2)', () => {
  const allOff = (): SoundSettings => {
    const s = normalizeSoundSettings(undefined)
    s.mastering.on = false
    s.glue.on = false
    s.tone.on = false
    s.saturation.on = false
    s.reverb.room = 'zita'
    s.panning.on = false
    s.pump.on = false
    s.throws.on = false
    s.riserVariety.on = false
    return s
  }

  it('the defaults resolve to parameters, never amounts', () => {
    expect(buildEngineSound(normalizeSoundSettings(undefined))).toEqual({
      mastering: { headroomDb: -4, ceilingDb: -1 },
      glue: { thresholdDb: -14, ratio: 2, kneeDb: 6 },
      tone: { lowShelfDb: 1, highShelfDb: 1 },
      saturation: { drive: 0.9 },
      room: 'cavern',
      pump: { depthDb: 4 }
    })
  })

  it('a project with no sound settings sends no `sound` key (today)', async () => {
    const project = await buildEngineProject(stateWith({ bpm: 150 }), vi.fn(), emptyCatalog)
    expect('sound' in project).toBe(false)
  })

  it('every stage off, zita at amount 0.5: no `sound` key, the JSON byte-identical to a pre-plan project', async () => {
    expect(buildEngineSound(allOff())).toBeUndefined()
    const before = await buildEngineProject(stateWith({ bpm: 150 }), vi.fn(), emptyCatalog)
    const after = await buildEngineProject(
      stateWith({ bpm: 150, sound: allOff() }),
      vi.fn(),
      emptyCatalog
    )
    expect(JSON.stringify(after)).toBe(JSON.stringify(before))
    // pinned: the top-level keys a pre-plan project sends, in order
    const preplanKeys = [
      'bpm',
      'snapDiv',
      'loopLengthBars',
      'masterChain',
      'channelChains',
      'reverb',
      'risers',
      'rifffs'
    ]
    expect(Object.keys(before)).toEqual(preplanKeys)
    expect(Object.keys(after)).toEqual(preplanKeys)
  })

  it('every stage off still sends the room when it is the cavern', () => {
    const s = allOff()
    s.reverb.room = 'cavern'
    expect(buildEngineSound(s)).toEqual({ room: 'cavern' })
  })

  it('a stage switched off is an absent key', () => {
    const s = normalizeSoundSettings(undefined)
    s.pump.on = false
    s.glue.on = false
    const wire = buildEngineSound(s)!
    expect('pump' in wire).toBe(false)
    expect('glue' in wire).toBe(false)
    expect(wire.tone).toBeDefined()
  })

  it('glue, tone and saturation need mastering: off with it, whatever their own switches say', () => {
    const s = normalizeSoundSettings(undefined)
    s.mastering.on = false
    expect(buildEngineSound(s)).toEqual({ room: 'cavern', pump: { depthDb: 4 } })
  })

  it('each stage maps its amounts', () => {
    const s = normalizeSoundSettings(undefined)
    s.mastering.headroomDb = -6
    s.mastering.ceilingDb = -2
    s.glue.amount = 1
    s.tone.amount = -1
    s.saturation.amount = 1
    s.pump.depthDb = 7
    const wire = buildEngineSound(s)!
    expect(wire.mastering).toEqual({ headroomDb: -6, ceilingDb: -2 })
    expect(wire.glue).toEqual({ thresholdDb: glueThresholdDb(1), ratio: 2, kneeDb: 6 })
    expect(wire.glue!.thresholdDb).toBe(-20)
    expect(wire.tone).toEqual({ lowShelfDb: 2.5, highShelfDb: -0.5 })
    expect(wire.saturation).toEqual({ drive: saturationDrive(1) })
    expect(wire.saturation!.drive).toBeCloseTo(1.8, 12)
    expect(wire.pump).toEqual({ depthDb: 7 })
  })

  it('the reverb return is relative to the room’s own trim, absent at amount 0.5', () => {
    const s = allOff()
    s.reverb.amount = 0.5
    expect(buildEngineSound(s)).toBeUndefined()
    s.reverb.amount = 0.25
    expect(buildEngineSound(s)).toEqual({ room: 'zita', reverbReturn: 0.5 })
    s.reverb.room = 'cavern'
    s.reverb.amount = 1
    const cavern = buildEngineSound(s)!
    expect(cavern.reverbReturn).toBeCloseTo(
      reverbReturnGain(1, 'cavern') / reverbReturnGain(0.5, 'cavern'),
      12
    )
    s.reverb.amount = 0
    expect(buildEngineSound(s)!.reverbReturn).toBe(0)
  })

  it('panning, throws and riser variety put nothing in the block (their own tasks)', () => {
    const s = allOff()
    s.panning.on = true
    s.throws.on = true
    s.riserVariety.on = true
    expect(buildEngineSound(s)).toBeUndefined()
  })

  it('a stored junk sound is normalised on the way out', async () => {
    const project = await buildEngineProject(
      stateWith({
        bpm: 150,
        sound: { glue: { on: true, amount: 99 } } as unknown as SoundSettings
      }),
      vi.fn(),
      emptyCatalog
    )
    expect(project.sound?.glue?.thresholdDb).toBe(-20)
    expect(project.sound?.mastering).toEqual({ headroomDb: -4, ceilingDb: -1 })
  })
})

describe('per-row panning on the wire (native radio sound plan, Task 4)', () => {
  const fourStems: Rifff = {
    ...rifff,
    stems: [
      {
        slot: 1,
        author: 'e',
        name: 'k',
        type: 'drums',
        path: '/k.wav',
        durationSec: 12.8,
        barLength: 8
      },
      {
        slot: 2,
        author: 'e',
        name: 'n',
        type: 'notes',
        path: '/n.wav',
        durationSec: 12.8,
        barLength: 8
      },
      {
        slot: 3,
        author: 'e',
        name: 'b',
        type: 'bass',
        path: '/b.wav',
        durationSec: 12.8,
        barLength: 8
      },
      {
        slot: 4,
        author: 'e',
        name: 'f',
        type: 'fx',
        path: '/f.wav',
        durationSec: 12.8,
        barLength: 8
      }
    ]
  }
  const withPanning = (on: boolean, width = 0.25): SoundSettings => {
    const s = normalizeSoundSettings(undefined)
    s.panning = { on, width }
    return s
  }
  const pansOf = (stems: EngineStem[]): (number | undefined)[] => stems.map((s) => s.pan)

  it('the timeline: drums and bass centred (no key), the rest +width, -width by slot', async () => {
    const project = await buildEngineProject(
      stateWith({ bpm: 150, rifffs: { r1: fourStems }, sound: withPanning(true) }),
      vi.fn(),
      emptyCatalog
    )
    expect(pansOf(project.rifffs[0].stems)).toEqual([undefined, 0.25, undefined, -0.25])
    expect('pan' in project.rifffs[0].stems[0]).toBe(false)
  })

  it('honours the width', async () => {
    const project = await buildEngineProject(
      stateWith({ bpm: 150, rifffs: { r1: fourStems }, sound: withPanning(true, 0.4) }),
      vi.fn(),
      emptyCatalog
    )
    expect(pansOf(project.rifffs[0].stems)).toEqual([undefined, 0.4, undefined, -0.4])
  })

  it('a muted stem keeps its place, so muting never moves another row', async () => {
    const project = await buildEngineProject(
      stateWith({
        bpm: 150,
        rifffs: { r1: fourStems },
        sound: withPanning(true),
        mute: { [stemKey('r1', 2)]: true }
      }),
      vi.fn(),
      emptyCatalog
    )
    expect(project.rifffs[0].stems[3].pan).toBe(-0.25)
  })

  it('panning off, a width of 0 and no sound settings all emit no `pan` at all', async () => {
    for (const sound of [withPanning(false), withPanning(true, 0), undefined]) {
      const project = await buildEngineProject(
        stateWith({ bpm: 150, rifffs: { r1: fourStems }, sound }),
        vi.fn(),
        emptyCatalog
      )
      expect(project.rifffs[0].stems.some((s) => 'pan' in s)).toBe(false)
    }
  })

  it("Discover's map replaces the timeline rule, keyed by stem key; a key not in it is centred", async () => {
    const stemPans = new Map([
      [stemKey('r1', 1), -0.25],
      [stemKey('r1', 3), 0.25]
    ])
    const project = await buildEngineProject(
      stateWith({ bpm: 150, rifffs: { r1: fourStems }, sound: withPanning(true) }),
      vi.fn(),
      emptyCatalog,
      {},
      { stemPans }
    )
    expect(pansOf(project.rifffs[0].stems)).toEqual([-0.25, undefined, 0.25, undefined])
  })

  it("Discover's map is ignored while panning is off", async () => {
    const project = await buildEngineProject(
      stateWith({ bpm: 150, rifffs: { r1: fourStems }, sound: withPanning(false) }),
      vi.fn(),
      emptyCatalog,
      {},
      { stemPans: new Map([[stemKey('r1', 2), 0.25]]) }
    )
    expect(project.rifffs[0].stems.some((s) => 'pan' in s)).toBe(false)
  })
})

describe('the drum-keyed pump on the wire (native radio sound plan, Task 9)', () => {
  const fourStems: Rifff = {
    ...rifff,
    stems: [
      { ...rifff.stems[0], slot: 1, type: 'drums', path: '/k.wav' },
      { ...rifff.stems[0], slot: 2, type: 'notes', path: '/n.wav' },
      { ...rifff.stems[0], slot: 3, type: 'bass', path: '/b.wav' },
      { ...rifff.stems[0], slot: 4, type: 'fx', path: '/f.wav' }
    ]
  }
  const withPump = (on: boolean): SoundSettings => {
    const s = normalizeSoundSettings(undefined)
    s.pump = { on, depthDb: 4 }
    return s
  }
  const rolesOf = (stems: EngineStem[]): (string | undefined)[] => stems.map((s) => s.pumpRole)

  it('the timeline: drums key it, bass is left alone (no key), the rest are pumped, by SoundType', async () => {
    const project = await buildEngineProject(
      stateWith({ bpm: 150, rifffs: { r1: fourStems }, sound: withPump(true) }),
      vi.fn(),
      emptyCatalog
    )
    expect(rolesOf(project.rifffs[0].stems)).toEqual(['key', 'pumped', undefined, 'pumped'])
    expect('pumpRole' in project.rifffs[0].stems[2]).toBe(false)
    expect(project.sound?.pump).toEqual({ depthDb: 4 })
  })

  it('a muted stem keeps its role (the engine keys nothing from a muted drums row)', async () => {
    const project = await buildEngineProject(
      stateWith({
        bpm: 150,
        rifffs: { r1: fourStems },
        sound: withPump(true),
        mute: { [stemKey('r1', 1)]: true }
      }),
      vi.fn(),
      emptyCatalog
    )
    expect(rolesOf(project.rifffs[0].stems)).toEqual(['key', 'pumped', undefined, 'pumped'])
  })

  it('pump off: no depth, but the roles still ride, so the engine can release a duck in progress', async () => {
    const project = await buildEngineProject(
      stateWith({ bpm: 150, rifffs: { r1: fourStems }, sound: withPump(false) }),
      vi.fn(),
      emptyCatalog
    )
    expect(project.sound?.pump).toBeUndefined()
    expect(rolesOf(project.rifffs[0].stems)).toEqual(['key', 'pumped', undefined, 'pumped'])
  })

  it('no roles at all: with no sound settings, with every stage off, or an off pump with pumpRelease false', async () => {
    const everyStageOff = normalizeSoundSettings(undefined)
    for (const stage of Object.values(everyStageOff)) if ('on' in stage) stage.on = false
    everyStageOff.reverb.room = 'zita'
    const cases: [SoundSettings | undefined, { pumpRelease?: boolean }][] = [
      [undefined, {}],
      [everyStageOff, {}],
      [withPump(false), { pumpRelease: false }]
    ]
    for (const [sound, opts] of cases) {
      const project = await buildEngineProject(
        stateWith({ bpm: 150, rifffs: { r1: fourStems }, sound }),
        vi.fn(),
        emptyCatalog,
        {},
        { stemPumpRoles: new Map([[stemKey('r1', 2), 'key' as const]]), ...opts }
      )
      expect(project.rifffs[0].stems.some((s) => 'pumpRole' in s)).toBe(false)
      expect(project.sound?.pump).toBeUndefined()
    }
    // pumpRelease is ignored while the pump is on
    const on = await buildEngineProject(
      stateWith({ bpm: 150, rifffs: { r1: fourStems }, sound: withPump(true) }),
      vi.fn(),
      emptyCatalog,
      {},
      { pumpRelease: false }
    )
    expect(rolesOf(on.rifffs[0].stems)).toEqual(['key', 'pumped', undefined, 'pumped'])
  })

  it('a per-stem export (stemExportSound) carries no depth: it never pumps (a fresh render has no duck to release)', async () => {
    const project = await buildEngineProject(
      stateWith({ bpm: 150, rifffs: { r1: fourStems }, sound: stemExportSound(withPump(true)) }),
      vi.fn(),
      emptyCatalog
    )
    expect(project.sound?.pump).toBeUndefined()
  })

  it("Discover's map replaces the timeline rule, keyed by stem key; a key not in it, or 'none', has no role", async () => {
    const stemPumpRoles = new Map<string, PumpRole>([
      [stemKey('r1', 2), 'key'],
      [stemKey('r1', 3), 'pumped'],
      [stemKey('r1', 4), 'none']
    ])
    const project = await buildEngineProject(
      stateWith({ bpm: 150, rifffs: { r1: fourStems }, sound: withPump(true) }),
      vi.fn(),
      emptyCatalog,
      {},
      { stemPumpRoles }
    )
    expect(rolesOf(project.rifffs[0].stems)).toEqual([undefined, 'key', 'pumped', undefined])
  })
})

describe('timelineStemPumpRoles', () => {
  it('maps every keying or pumped stem of every PLACED rifff, the pump on or off; nothing with no sound settings', () => {
    const sound = normalizeSoundSettings(undefined)
    const placed: Rifff = {
      ...rifff,
      stems: [
        { ...rifff.stems[0], slot: 1, type: 'drums' },
        { ...rifff.stems[0], slot: 2, type: 'bass' },
        { ...rifff.stems[0], slot: 3, type: 'sampler' }
      ]
    }
    const shelved: Rifff = { ...placed, groupId: 'r2', startBar: undefined }
    const other: Rifff = { ...placed, groupId: 'r3', startBar: 8 }
    const state = stateWith({ rifffs: { r1: placed, r2: shelved, r3: other }, sound })
    expect([...timelineStemPumpRoles(state).entries()]).toEqual([
      [stemKey('r1', 1), 'key'],
      [stemKey('r1', 3), 'pumped'],
      [stemKey('r3', 1), 'key'],
      [stemKey('r3', 3), 'pumped']
    ])
    sound.pump.on = false
    expect(timelineStemPumpRoles(stateWith({ rifffs: { r1: placed }, sound })).size).toBe(2)
    expect(timelineStemPumpRoles(stateWith({ rifffs: { r1: placed } })).size).toBe(0)
  })
})

describe('timelineStemPans (the one timeline rule the wire and the DAW exports share)', () => {
  it('maps every off-centre stem of every PLACED rifff, and nothing while panning is off', () => {
    const sound = normalizeSoundSettings(undefined)
    const placed: Rifff = {
      ...rifff,
      stems: [
        { ...rifff.stems[0], slot: 1, type: 'drums' },
        { ...rifff.stems[0], slot: 2, type: 'notes' }
      ]
    }
    const shelved: Rifff = { ...placed, groupId: 'r2', startBar: undefined }
    const state = stateWith({ rifffs: { r1: placed, r2: shelved }, sound })
    expect([...timelineStemPans(state).entries()]).toEqual([[stemKey('r1', 2), 0.25]])
    sound.panning.on = false
    expect(timelineStemPans(stateWith({ rifffs: { r1: placed }, sound })).size).toBe(0)
    expect(timelineStemPans(stateWith({ rifffs: { r1: placed } })).size).toBe(0)
  })
})

describe('dub throws on the wire (native radio sound plan, Task 10)', () => {
  const twoStems: Rifff = {
    ...rifff,
    stems: [
      { ...rifff.stems[0], slot: 1, type: 'notes', path: '/n.wav' },
      { ...rifff.stems[0], slot: 2, type: 'fx', path: '/f.wav' }
    ]
  }
  const withThrows = (on: boolean, level = 1): SoundSettings => {
    const s = normalizeSoundSettings(undefined)
    s.throws = { on, rate: 'normal', level }
    return s
  }
  // a throw as the planners draw it: 5 ms ramps, clip-relative bars
  const curve = [
    { bar: 1, value: 0 },
    { bar: 1.0025, value: 1 },
    { bar: 1.2475, value: 1 },
    { bar: 1.25, value: 0 }
  ]
  type Plan = {
    dubThrows: {
      echo: { timing: 'dotted-eighth'; feedback: number }
      sends: Map<string, { bar: number; value: number }[]>
    }
  }
  const plan = (sends: [string, { bar: number; value: number }[]][]): Plan => ({
    dubThrows: {
      echo: { timing: 'dotted-eighth' as const, feedback: 0.6 },
      sends: new Map(sends)
    }
  })

  it("a planned curve passes through as the stem's dubSend, in a do-nothing toolkit, with sound.dub", async () => {
    const project = await buildEngineProject(
      stateWith({ bpm: 150, rifffs: { r1: twoStems }, sound: withThrows(true) }),
      vi.fn(),
      emptyCatalog,
      {},
      plan([[stemKey('r1', 2), curve]])
    )
    const [plain, throwing] = project.rifffs[0].stems
    expect('toolkit' in plain).toBe(false)
    expect(throwing.toolkit).toEqual({
      filterMode: 'lowpass',
      filterCutoff: neutralCutoff('lowpass'),
      filterResonance: defaultFilterSettings('lowpass').resonance,
      reverbSend: 0,
      volume: 1,
      originBar: 4, // the clip's left edge: its curve is clip-relative
      automation: {
        filterCutoff: [],
        filterResonance: [],
        reverbSend: [],
        volume: [],
        dubSend: curve
      }
    })
    expect(project.sound?.dub).toEqual({ delayBeats: 0.75, feedback: 0.6 })
  })

  it('is wire-only: never a lane the UI draws', () => {
    expect(AUTOMATION_PARAMS as readonly string[]).not.toContain('dubSend')
  })

  it('rides beside a toolkit the stem already has', async () => {
    const project = await buildEngineProject(
      stateWith({
        bpm: 150,
        rifffs: { r1: twoStems },
        sound: withThrows(true),
        stemSends: { [stemKey('r1', 1)]: 0.4 }
      }),
      vi.fn(),
      emptyCatalog,
      {},
      plan([[stemKey('r1', 1), curve]])
    )
    const tk = project.rifffs[0].stems[0].toolkit
    expect(tk?.reverbSend).toBe(0.4)
    expect(tk?.automation.dubSend).toEqual(curve)
  })

  it("the throw level scales the curve (the web's setEcho); level 0 sends no throw at all", async () => {
    const half = await buildEngineProject(
      stateWith({ bpm: 150, rifffs: { r1: twoStems }, sound: withThrows(true, 0.5) }),
      vi.fn(),
      emptyCatalog,
      {},
      plan([[stemKey('r1', 2), curve]])
    )
    expect(half.rifffs[0].stems[1].toolkit?.automation.dubSend?.map((p) => p.value)).toEqual([
      0, 0.5, 0.5, 0
    ])
    const none = await buildEngineProject(
      stateWith({ bpm: 150, rifffs: { r1: twoStems }, sound: withThrows(true, 0) }),
      vi.fn(),
      emptyCatalog,
      {},
      plan([[stemKey('r1', 2), curve]])
    )
    expect('toolkit' in none.rifffs[0].stems[1]).toBe(false)
    expect(none.sound?.dub).toBeUndefined()
  })

  it('throws off, no settings, no plan, or a curve that is 0 throughout: no dubSend key and no sound.dub', async () => {
    const zero = [
      { bar: 0, value: 0 },
      { bar: 2, value: 0 }
    ]
    const cases: [SoundSettings | undefined, Plan | object][] = [
      [withThrows(false), plan([[stemKey('r1', 2), curve]])],
      [undefined, plan([[stemKey('r1', 2), curve]])],
      [withThrows(true), {}],
      [withThrows(true), plan([[stemKey('r1', 2), zero]])]
    ]
    for (const [sound, opts] of cases) {
      const project = await buildEngineProject(
        stateWith({
          bpm: 150,
          rifffs: { r1: twoStems },
          sound,
          stemSends: { [stemKey('r1', 1)]: 0.4 }
        }),
        vi.fn(),
        emptyCatalog,
        {},
        opts
      )
      expect(
        project.rifffs[0].stems.some((s) => s.toolkit && 'dubSend' in s.toolkit.automation)
      ).toBe(false)
      expect('toolkit' in project.rifffs[0].stems[1]).toBe(false)
      expect(project.sound?.dub).toBeUndefined()
    }
  })

  it("the echo: a quarter is 1 beat, a dotted eighth 0.75; the feedback is clamped to the web's 0.95", () => {
    expect(engineDubFor({ timing: 'quarter', feedback: 0.45 })).toEqual({
      delayBeats: 1,
      feedback: 0.45
    })
    expect(engineDubFor({ timing: 'dotted-eighth', feedback: 2 })).toEqual({
      delayBeats: 0.75,
      feedback: 0.95
    })
    expect(engineDubFor({ timing: 'quarter', feedback: Number.NaN }).feedback).toBe(0)
    expect(engineDubFor({ timing: 'quarter', feedback: -1 }).feedback).toBe(0)
    // only with throws on
    expect(
      buildEngineSound(withThrows(false), { timing: 'quarter', feedback: 0.5 })?.dub
    ).toBeUndefined()
    expect(buildEngineSound(withThrows(true), { timing: 'quarter', feedback: 0.5 })?.dub).toEqual({
      delayBeats: 1,
      feedback: 0.5
    })
  })

  it('a per-stem render keeps the throws (stemExportSound keeps them: a per-stem stage)', async () => {
    const project = await buildEngineProject(
      stateWith({ bpm: 150, rifffs: { r1: twoStems }, sound: stemExportSound(withThrows(true)) }),
      vi.fn(),
      emptyCatalog,
      {},
      plan([[stemKey('r1', 2), curve]])
    )
    expect(project.rifffs[0].stems[1].toolkit?.automation.dubSend).toEqual(curve)
    expect(project.sound?.dub).toEqual({ delayBeats: 0.75, feedback: 0.6 })
  })

  it("withoutDubThrows (Discover's phone loop, Task 11) is the build without the plan, JSON and all", async () => {
    // every stage off but throws: the echo is all `sound` says, so it goes with it
    const onlyThrows = (): SoundSettings => {
      const s = withThrows(true)
      s.mastering.on = false
      s.panning.on = false
      s.pump.on = false
      s.reverb = { room: 'zita', amount: 0.5 }
      return s
    }
    const states = [
      // a do-nothing toolkit (no toolkit of its own) and one beside a send
      stateWith({
        bpm: 150,
        rifffs: { r1: twoStems },
        sound: withThrows(true),
        stemSends: { [stemKey('r1', 1)]: 0.4 }
      }),
      stateWith({ bpm: 150, rifffs: { r1: twoStems }, sound: onlyThrows() })
    ]
    for (const state of states) {
      const sends = plan([
        [stemKey('r1', 1), curve],
        [stemKey('r1', 2), curve]
      ])
      const thrown = await buildEngineProject(state, vi.fn(), emptyCatalog, {}, sends)
      const plain = await buildEngineProject(state, vi.fn(), emptyCatalog, {}, {})
      expect(thrown.sound?.dub).toBeDefined()
      expect(JSON.stringify(withoutDubThrows(thrown))).toBe(JSON.stringify(plain))
      expect(phoneLoopFingerprint(withoutDubThrows(thrown))).toBe(phoneLoopFingerprint(plain))
      // the input is left as it was
      expect(thrown.rifffs[0].stems[1].toolkit?.automation.dubSend).toEqual(curve)
    }
    // with no throws it is the same project
    const plain = await buildEngineProject(states[0], vi.fn(), emptyCatalog, {}, {})
    expect(withoutDubThrows(plain)).toEqual(plain)
  })
})
