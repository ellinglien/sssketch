import { describe, expect, it } from 'vitest'
import { groupRiffsByDateAndTempo } from './LibraryBrowser'
import type { RiffLibraryRiffSummary } from '@shared/riffLibraryTypes'

/** Minimal summary -- only the three fields the grouping reads. */
function riff(riffCID: string, isoTime: string, bpm: number): RiffLibraryRiffSummary {
  return {
    riffCID,
    creationTime: Math.floor(new Date(isoTime).getTime() / 1000),
    bpm
  } as RiffLibraryRiffSummary
}

describe('groupRiffsByDateAndTempo', () => {
  it("reads oldest-first within a tempo group, so the first dot is that day's first riff", () => {
    // As they arrive from listRiffs: newest first.
    const groups = groupRiffsByDateAndTempo([
      riff('c', '2026-09-20T18:00:00Z', 120),
      riff('b', '2026-09-20T15:00:00Z', 120),
      riff('a', '2026-09-20T12:00:00Z', 120)
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].tempoGroups[0].riffs.map((r) => r.riffCID)).toEqual(['a', 'b', 'c'])
  })

  it('keeps date groups newest-first, and tempo groups ascending by bpm', () => {
    const groups = groupRiffsByDateAndTempo([
      riff('today-fast', '2026-09-21T10:00:00Z', 140),
      riff('today-slow', '2026-09-21T09:00:00Z', 90),
      riff('yesterday', '2026-09-20T09:00:00Z', 120)
    ])
    expect(groups.map((g) => g.tempoGroups.map((t) => t.bpm))).toEqual([[90, 140], [120]])
    expect(groups[0].tempoGroups[0].riffs[0].riffCID).toBe('today-slow')
  })
})
