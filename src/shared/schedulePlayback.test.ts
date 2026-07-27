import { describe, expect, it } from 'vitest'
import { computeStemSchedule } from './schedulePlayback'
import type { Rifff } from './types'

const rifff: Rifff = {
  groupId: 'r1',
  name: 'test',
  bpm: 150,
  barLength: 8,
  folderPath: '/x',
  startBar: 4,
  stems: [
    {
      slot: 1,
      author: 'e',
      name: 'a',
      type: 'fx',
      path: '/a.wav',
      durationSec: 12.8,
      barLength: 8
    },
    { slot: 6, author: 'e', name: 'b', type: 'fx', path: '/b.wav', durationSec: 3.2, barLength: 2 }
  ]
}

describe('computeStemSchedule', () => {
  it('schedules one segment for a stem whose loop matches the rifff length', () => {
    const segments = computeStemSchedule(rifff, rifff.stems[0], {
      offsetSteps: 0,
      snapDiv: 16,
      projectPos: 0,
      projectBpm: 150
    })
    expect(segments).toHaveLength(1)
    expect(segments[0].startBarInTimeline).toBe(4)
    expect(segments[0].durationSec).toBeCloseTo(12.8, 5)
    expect(segments[0].bufferOffsetSec).toBe(0)
  })

  it('schedules one segment per repetition for a shorter loop', () => {
    const segments = computeStemSchedule(rifff, rifff.stems[1], {
      offsetSteps: 0,
      snapDiv: 16,
      projectPos: 0,
      projectBpm: 150
    })
    expect(segments).toHaveLength(4) // 8-bar rifff / 2-bar stem
    expect(segments[0].startBarInTimeline).toBe(4)
    expect(segments[1].startBarInTimeline).toBe(6)
    expect(segments[3].startBarInTimeline).toBe(10)
  })

  it('shifts segments by the grid-step offset, in bars', () => {
    const segments = computeStemSchedule(rifff, rifff.stems[0], {
      offsetSteps: 4, // +4/16 = +0.25 bar
      snapDiv: 16,
      projectPos: 0,
      projectBpm: 150
    })
    expect(segments[0].startBarInTimeline).toBe(4.25)
  })

  it('drops segments that have already fully played before the current position', () => {
    const segments = computeStemSchedule(rifff, rifff.stems[1], {
      offsetSteps: 0,
      snapDiv: 16,
      projectPos: 8, // partway through the rifff
      projectBpm: 150
    })
    // repetitions at bars 4,6,8,10 -> only the ones ending after pos 8 remain (6→8 boundary excluded, 8→10 and beyond)
    expect(segments.every((s) => s.startBarInTimeline + s.barLength > 8)).toBe(true)
  })
})
