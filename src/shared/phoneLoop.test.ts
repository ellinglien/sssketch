import { describe, expect, it } from 'vitest'
import type { EngineProject, EngineStem } from './buildEngineProject'
import { phoneLoopFingerprint, phoneLoopProject } from './phoneLoop'

function stem(overrides: Partial<EngineStem> = {}): EngineStem {
  return {
    stemKey: 'group-a::1',
    resolvedPath: '/Users/nickel/Music/secret/abc123',
    durationSec: 2,
    barLength: 1,
    playedBars: 1,
    leftCropBars: 0,
    offsetSteps: 0,
    startBarOverride: -1,
    volume: 1,
    muted: false,
    muteRegions: [],
    oneShot: false,
    trimStartSec: 0,
    trimEndSec: -1,
    ...overrides
  }
}

function project(overrides: Partial<EngineProject> = {}): EngineProject {
  const slot = { pluginId: '', path: '', stateBase64: '' }
  return {
    bpm: 120,
    snapDiv: 4,
    loopLengthBars: 4,
    rifffs: [{ groupId: 'group-a', channelId: 'ch-a', startBar: 0, barLength: 4, stems: [stem()] }],
    risers: [],
    masterChain: [{ ...slot }, { ...slot }, { ...slot }, { ...slot }],
    channelChains: [],
    reverb: { roomSize: 0.5, damping: 0.5, preDelayMs: 20 },
    ...overrides
  }
}

describe('phoneLoopProject', () => {
  it('empties the master chain, so a fresh render engine cannot instantiate plugins at defaults', () => {
    const withPlugin = project({
      masterChain: [
        { pluginId: 'p1', path: '/p1.vst3', stateBase64: '' },
        { pluginId: '', path: '', stateBase64: '' },
        { pluginId: '', path: '', stateBase64: '' },
        { pluginId: '', path: '', stateBase64: '' }
      ]
    })
    expect(phoneLoopProject(withPlugin).masterChain.map((s) => s.pluginId)).toEqual([
      '',
      '',
      '',
      ''
    ])
  })

  it('drops every channel chain', () => {
    const withChannel = project({
      channelChains: [
        {
          channelId: 'ch-a',
          slots: [
            { pluginId: 'p1', path: '/p1.vst3', stateBase64: '' },
            { pluginId: '', path: '', stateBase64: '' }
          ]
        }
      ]
    })
    expect(phoneLoopProject(withChannel).channelChains).toEqual([])
  })

  it('leaves the stems, bpm and loop length exactly alone', () => {
    const out = phoneLoopProject(project())
    expect(out.bpm).toBe(120)
    expect(out.loopLengthBars).toBe(4)
    expect(out.rifffs[0].stems[0].resolvedPath).toBe('/Users/nickel/Music/secret/abc123')
  })
})

describe('phoneLoopFingerprint', () => {
  it('is IDENTICAL for two projects differing only in groupId, channelId and stemKey', () => {
    const a = project()
    const b = project({
      rifffs: [
        {
          groupId: 'a-completely-different-uuid',
          channelId: 'ch-z',
          startBar: 0,
          barLength: 4,
          stems: [stem({ stemKey: 'a-completely-different-uuid::1' })]
        }
      ]
    })
    expect(phoneLoopFingerprint(b)).toBe(phoneLoopFingerprint(a))
  })

  it('is IDENTICAL when only the order of the stems differs', () => {
    const one = stem({ stemKey: 'g::1', resolvedPath: '/a' })
    const two = stem({ stemKey: 'g::2', resolvedPath: '/b' })
    const a = project({
      rifffs: [{ groupId: 'g', channelId: 'c', startBar: 0, barLength: 4, stems: [one, two] }]
    })
    const b = project({
      rifffs: [{ groupId: 'g', channelId: 'c', startBar: 0, barLength: 4, stems: [two, one] }]
    })
    expect(phoneLoopFingerprint(b)).toBe(phoneLoopFingerprint(a))
  })

  it('DIFFERS when one stem gain differs', () => {
    const quieter = project({
      rifffs: [
        {
          groupId: 'group-a',
          channelId: 'ch-a',
          startBar: 0,
          barLength: 4,
          stems: [stem({ volume: 0.5 })]
        }
      ]
    })
    expect(phoneLoopFingerprint(quieter)).not.toBe(phoneLoopFingerprint(project()))
  })

  it('DIFFERS when a stem is muted', () => {
    const muted = project({
      rifffs: [
        {
          groupId: 'group-a',
          channelId: 'ch-a',
          startBar: 0,
          barLength: 4,
          stems: [stem({ muted: true })]
        }
      ]
    })
    expect(phoneLoopFingerprint(muted)).not.toBe(phoneLoopFingerprint(project()))
  })

  it('DIFFERS when a stem resolves to a different file', () => {
    const other = project({
      rifffs: [
        {
          groupId: 'group-a',
          channelId: 'ch-a',
          startBar: 0,
          barLength: 4,
          stems: [stem({ resolvedPath: '/Users/nickel/Music/secret/def456' })]
        }
      ]
    })
    expect(phoneLoopFingerprint(other)).not.toBe(phoneLoopFingerprint(project()))
  })

  it('DIFFERS when the tempo differs', () => {
    expect(phoneLoopFingerprint(project({ bpm: 128 }))).not.toBe(phoneLoopFingerprint(project()))
  })

  it('DIFFERS when the loop length differs', () => {
    expect(phoneLoopFingerprint(project({ loopLengthBars: 8 }))).not.toBe(
      phoneLoopFingerprint(project())
    )
  })
})
