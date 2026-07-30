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

  it('uses startBarOverride instead of the rifff’s own startBar when given', () => {
    // Mirrors an unlinked stem dragged to its own independent position.
    const segments = computeStemSchedule(rifff, rifff.stems[0], {
      offsetSteps: 0,
      snapDiv: 16,
      projectPos: 0,
      projectBpm: 150,
      startBarOverride: 20
    })
    expect(segments[0].startBarInTimeline).toBe(20)
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

  it('wraps an offset larger than the stem’s own loop length, rather than shifting the clip’s start by that much real time', () => {
    // Real bug this fixed: BeatPicker's downbeat pick can land many bars
    // into a stem's own loop (offsetStepsForBeatIndex scales with the
    // clicked beat across the WHOLE loop, not just one bar) — for a
    // LORE-sourced stem, which is never baked/rewritten, that large offset
    // stuck around permanently and showed up as a real silence gap before
    // the clip ever played. stems[0].barLength is 8 here; 160/16 = 10 bars
    // of raw offset wraps to 10 % 8 = 2.
    const segments = computeStemSchedule(rifff, rifff.stems[0], {
      offsetSteps: 160, // 160/16 = 10 bars, more than stems[0]'s own 8-bar loop
      snapDiv: 16,
      projectPos: 0,
      projectBpm: 150
    })
    expect(segments[0].startBarInTimeline).toBe(6) // 4 (rifff start) + (10 % 8)
  })

  it('wraps a negative offset into the positive [0, barLength) range, not left negative', () => {
    const segments = computeStemSchedule(rifff, rifff.stems[0], {
      offsetSteps: -16, // -16/16 = -1 bar
      snapDiv: 16,
      projectPos: 0,
      projectBpm: 150
    })
    // -1 wrapped into [0, 8) is 7, not -1 — landing at 4 + 7 = 11, not 4 - 1 = 3.
    expect(segments[0].startBarInTimeline).toBe(11)
  })

  it('is a no-op for an offset that is an exact multiple of the loop length', () => {
    const segments = computeStemSchedule(rifff, rifff.stems[0], {
      offsetSteps: 128, // 128/16 = 8 bars, exactly one full loop of stems[0]
      snapDiv: 16,
      projectPos: 0,
      projectBpm: 150
    })
    expect(segments[0].startBarInTimeline).toBe(4) // wraps to exactly 0
  })

  it('drops segments that have already fully played before the current position', () => {
    const segments = computeStemSchedule(rifff, rifff.stems[1], {
      offsetSteps: 0,
      snapDiv: 16,
      projectPos: 8, // partway through the rifff
      projectBpm: 150
    })
    // repetitions at bars 4,6,8,10 -> only the ones ending after pos 8 remain (6→8 boundary excluded, 8→10 and beyond)
    expect(segments).toHaveLength(2)
    expect(segments[0].startBarInTimeline).toBe(8)
    expect(segments[1].startBarInTimeline).toBe(10)
    expect(segments.every((s) => s.startBarInTimeline + s.barLength > 8)).toBe(true)
  })

  it('clips the final repetition when the stem length does not evenly divide the rifff length', () => {
    const threeBarStem = {
      slot: 9,
      author: 'e',
      name: 'c',
      type: 'fx' as const,
      path: '/c.wav',
      durationSec: 4.8, // 3 bars at 150 bpm (1.6s/bar)
      barLength: 3
    }
    const segments = computeStemSchedule(rifff, threeBarStem, {
      offsetSteps: 0,
      snapDiv: 16,
      projectPos: 0,
      projectBpm: 150
    })
    // 8-bar rifff / 3-bar stem: reps at [0,3) [3,6) [6,9) would overrun by 1 bar —
    // the last one must be clipped to [6,8), i.e. barLength 2, not 3.
    expect(segments).toHaveLength(3)
    expect(segments[0]).toMatchObject({ startBarInTimeline: 4, barLength: 3 })
    expect(segments[1]).toMatchObject({ startBarInTimeline: 7, barLength: 3 })
    expect(segments[2]).toMatchObject({ startBarInTimeline: 10, barLength: 2 })
    // No segment may extend past the rifff's own span on the timeline.
    const rifffEnd = (rifff.startBar ?? 0) + rifff.barLength
    for (const s of segments) {
      expect(s.startBarInTimeline + s.barLength).toBeLessThanOrEqual(rifffEnd)
    }
    // Duration scales down proportionally for the clipped final segment.
    expect(segments[2].durationSec).toBeCloseTo((2 / 3) * 4.8, 5)
  })

  it('tiles the stem twice when playedBars exceeds rifff.barLength by one full stem length', () => {
    const segments = computeStemSchedule(rifff, rifff.stems[0], {
      offsetSteps: 0,
      snapDiv: 16,
      projectPos: -Infinity,
      projectBpm: rifff.bpm,
      playedBars: rifff.stems[0].barLength * 2 // stem's own barLength doubled
    })
    expect(segments).toHaveLength(2)
    expect(segments[0].bufferOffsetSec).toBe(0)
    expect(segments[1].bufferOffsetSec).toBe(0) // second tile restarts from the stem's own beginning
    expect(segments[1].startBarInTimeline).toBe(
      segments[0].startBarInTimeline + rifff.stems[0].barLength
    )
  })

  it('truncates to one shorter segment when playedBars is less than the stem barLength', () => {
    const segments = computeStemSchedule(rifff, rifff.stems[0], {
      offsetSteps: 0,
      snapDiv: 16,
      projectPos: -Infinity,
      projectBpm: rifff.bpm,
      playedBars: rifff.stems[0].barLength / 2
    })
    expect(segments).toHaveLength(1)
    expect(segments[0].barLength).toBe(rifff.stems[0].barLength / 2)
  })

  it('defaults to rifff.barLength when playedBars is omitted (unchanged existing behavior)', () => {
    const withOverride = computeStemSchedule(rifff, rifff.stems[0], {
      offsetSteps: 0,
      snapDiv: 16,
      projectPos: -Infinity,
      projectBpm: rifff.bpm,
      playedBars: rifff.barLength
    })
    const withoutOverride = computeStemSchedule(rifff, rifff.stems[0], {
      offsetSteps: 0,
      snapDiv: 16,
      projectPos: -Infinity,
      projectBpm: rifff.bpm
    })
    expect(withoutOverride).toEqual(withOverride)
  })

  it('clips the final repetition against a playedBars bound, same as it does against rifff.barLength', () => {
    // Mirrors the "clips the final repetition when the stem length does not
    // evenly divide the rifff length" test above, but with the bound coming
    // from playedBars instead of rifff.barLength — the more interesting case
    // than the exact-multiple/exact-half cases the other playedBars tests
    // cover, since it proves the truncation logic itself was actually
    // repointed at `bound`, not just the loop's outer stopping condition.
    const segments = computeStemSchedule(rifff, rifff.stems[1], {
      offsetSteps: 0,
      snapDiv: 16,
      projectPos: 0,
      projectBpm: 150,
      playedBars: 5 // 2-bar stem tiling across a 5-bar bound: [0,2) [2,4) [4,5)
    })
    expect(segments).toHaveLength(3)
    expect(segments[0]).toMatchObject({ startBarInTimeline: 4, barLength: 2 })
    expect(segments[1]).toMatchObject({ startBarInTimeline: 6, barLength: 2 })
    expect(segments[2]).toMatchObject({ startBarInTimeline: 8, barLength: 1 })
  })
})
