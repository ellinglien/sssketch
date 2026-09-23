import { describe, expect, it } from 'vitest'
import type { LockedClimax, LockedClimaxStem } from './coachClimax'
import { cellIsOn } from './coachCells'
import {
  buildCoachMapSections,
  coachMapCellIsOn,
  coachMapRowOrder,
  relayoutCoachSections,
  resizeCoachMapToPhrase,
  templateCellOn,
  templateFallbackFor
} from './coachMapTemplate'
import { sectionBars } from './coachPasses'

function stem(
  path: string,
  kinds: LockedClimaxStem['kinds'],
  role: LockedClimaxStem['role']
): LockedClimaxStem {
  return {
    path,
    name: path,
    author: 'e',
    type: 'fx' as const,
    durationSec: 4,
    barLength: 4,
    kinds,
    role,
    gain: 1
  }
}

const climax: LockedClimax = {
  bpm: 120,
  barLength: 4,
  lockedAt: 0,
  stems: [
    stem('/hook.wav', ['lead', 'bright'], 'lead'),
    stem('/kick.wav', ['drums'], 'drums'),
    stem('/lead.wav', ['lead', 'warm'], 'lead'),
    stem('/bass.wav', ['bass'], 'bass')
  ]
}

describe('coachMapRowOrder', () => {
  it('puts the foundation first whatever order the climax was locked in', () => {
    expect(coachMapRowOrder(climax).map((s) => s.path)).toEqual([
      '/kick.wav',
      '/bass.wav',
      '/hook.wav',
      '/lead.wav'
    ])
  })
})

describe('templateCellOn', () => {
  it('draws the spec own verse: four stems arriving across four passes', () => {
    const rows = coachMapRowOrder(climax)
    const grid = rows.map((row, rank) =>
      [0, 1, 2, 3]
        .map((pass) =>
          templateCellOn({
            type: 'verse',
            homeType: 'drop',
            stem: row,
            rank,
            playingCount: rows.length,
            passIndex: pass,
            passes: 4
          })
            ? 'x'
            : '.'
        )
        .join('')
    )
    // kick all four, bass from pass 1, then the leads -- exactly the map
    // drawn in the spec.
    expect(grid[0]).toBe('xxxx')
    expect(grid[1]).toBe('.xxx')
  })

  it('leaves the home section completely full -- it is the loop he built', () => {
    const rows = coachMapRowOrder(climax)
    for (const [rank, row] of rows.entries()) {
      expect(
        templateCellOn({
          type: 'drop',
          homeType: 'drop',
          stem: row,
          rank,
          playingCount: rows.length,
          passIndex: 0,
          passes: 2
        })
      ).toBe(true)
    }
  })

  it('takes the hook out of a build', () => {
    const rows = coachMapRowOrder(climax)
    const hook = rows.findIndex((row) => row.path === '/hook.wav')
    expect(
      templateCellOn({
        type: 'build',
        homeType: 'drop',
        stem: rows[hook],
        rank: hook,
        playingCount: rows.length,
        passIndex: 0,
        passes: 2
      })
    ).toBe(false)
  })

  it('thins an outro OUT, foundation last', () => {
    const rows = coachMapRowOrder(climax)
    expect(
      templateCellOn({
        type: 'outro',
        homeType: 'drop',
        stem: rows[0],
        rank: 0,
        playingCount: 2,
        passIndex: 3,
        passes: 4
      })
    ).toBe(true)
    expect(
      templateCellOn({
        type: 'outro',
        homeType: 'drop',
        stem: rows[1],
        rank: 1,
        playingCount: 2,
        passIndex: 3,
        passes: 4
      })
    ).toBe(false)
  })
})

describe('templateFallbackFor', () => {
  it('answers false for a stem this section type drops entirely', () => {
    const fallback = templateFallbackFor({ type: 'build', passes: 2 }, 'drop', climax)
    const hook = climax.stems.find((s) => s.path === '/hook.wav')!
    expect(fallback(hook, 0)).toBe(false)
    expect(fallback(hook, 1)).toBe(false)
  })

  it('stages the arrival of the stems that DO play', () => {
    const fallback = templateFallbackFor({ type: 'intro', passes: 4 }, 'drop', climax)
    const kick = climax.stems.find((s) => s.path === '/kick.wav')!
    const bass = climax.stems.find((s) => s.path === '/bass.wav')!
    expect(fallback(kick, 0)).toBe(true)
    expect(fallback(bass, 0)).toBe(false)
    expect(fallback(bass, 3)).toBe(true)
  })
})

describe('coachMapCellIsOn', () => {
  it('lets a stored override beat the template', () => {
    const [section] = buildCoachMapSections({
      shape: 'short',
      loopIs: 'drop',
      phraseBars: 4,
      climax,
      firstStartBar: 0
    })
    const kick = climax.stems.find((s) => s.path === '/kick.wav')!
    expect(coachMapCellIsOn(section, 'drop', climax, kick, 0)).toBe(true)
    const edited = { ...section, cells: { '0|/kick.wav': false } }
    expect(coachMapCellIsOn(edited, 'drop', climax, kick, 0)).toBe(false)
  })
})

describe('buildCoachMapSections', () => {
  it('lays out the shape, contiguously, with every section pre-filled', () => {
    const sections = buildCoachMapSections({
      shape: 'short',
      loopIs: 'drop',
      phraseBars: 4,
      climax,
      firstStartBar: 0
    })
    expect(sections.map((s) => s.type)).toEqual(['intro', 'verse', 'drop', 'outro'])
    // 8-bar intro target at a 4-bar phrase is two passes.
    expect(sections[0].passes).toBe(2)
    expect(sections[1].passes).toBe(4)
    expect(sections[0].startBar).toBe(0)
    expect(sections[1].startBar).toBe(8)
    expect(sections[2].startBar).toBe(24)
  })

  it('overrides NOTHING -- pre-filled means the template, not stored cells', () => {
    const sections = buildCoachMapSections({
      shape: 'standard',
      loopIs: 'unsure',
      phraseBars: 4,
      climax,
      firstStartBar: 0
    })
    for (const section of sections) expect(section.cells).toEqual({})
  })

  it('numbers repeated types the way a person would name them', () => {
    const sections = buildCoachMapSections({
      shape: 'standard',
      loopIs: 'drop',
      phraseBars: 4,
      climax,
      firstStartBar: 0
    })
    expect(sections.map((s) => s.name)).toEqual([
      'intro',
      'verse',
      'build',
      'drop',
      'verse 2',
      'build 2',
      'drop 2',
      'outro'
    ])
  })

  it('gives every section its own stable id', () => {
    const sections = buildCoachMapSections({
      shape: 'long',
      loopIs: 'drop',
      phraseBars: 8,
      climax,
      firstStartBar: 0
    })
    expect(new Set(sections.map((s) => s.id)).size).toBe(sections.length)
  })

  it('starts after whatever is already on the timeline', () => {
    const sections = buildCoachMapSections({
      shape: 'short',
      loopIs: 'drop',
      phraseBars: 4,
      climax,
      firstStartBar: 32
    })
    expect(sections[0].startBar).toBe(32)
  })
})

describe('resizeCoachMapToPhrase', () => {
  const built = buildCoachMapSections({
    shape: 'short',
    loopIs: 'drop',
    phraseBars: 8,
    climax,
    firstStartBar: 0
  })

  it('RE-SIZES rather than rebuilding: ids, names, types and cells all survive', () => {
    const edited = built.map((section, i) =>
      i === 1 ? { ...section, name: 'my verse', cells: { '0|/kick.wav': false } } : section
    )
    const resized = resizeCoachMapToPhrase(edited, 8, 4)
    expect(resized.map((s) => s.id)).toEqual(built.map((s) => s.id))
    expect(resized.map((s) => s.type)).toEqual(built.map((s) => s.type))
    expect(resized[1].name).toBe('my verse')
    expect(cellIsOn(resized[1].cells, 0, '/kick.wav', true)).toBe(false)
  })

  it('keeps each section about the same number of BARS at the new phrase', () => {
    const before = sectionBars(built[1].passes, 8)
    const resized = resizeCoachMapToPhrase(built, 8, 4)
    expect(sectionBars(resized[1].passes, 4)).toBe(before)
  })

  it('re-lays the sections out contiguously from the first one', () => {
    const resized = resizeCoachMapToPhrase(built, 8, 4)
    expect(resized[0].startBar).toBe(built[0].startBar)
    for (let i = 1; i < resized.length; i += 1) {
      expect(resized[i].startBar).toBe(
        resized[i - 1].startBar + sectionBars(resized[i - 1].passes, 4)
      )
    }
  })

  it('restores a nudge the user made rather than snapping back to the template', () => {
    // A verse he stretched comes back at the new phrase as the same LENGTH,
    // not as whatever the template would have drawn.
    const stretched = built.map((s, i) => (i === 1 ? { ...s, passes: 6 } : s))
    const resized = resizeCoachMapToPhrase(stretched, 8, 4)
    expect(resized[1].passes).toBe(12)
  })
})

describe('relayoutCoachSections', () => {
  it('does nothing to an empty map', () => {
    expect(relayoutCoachSections([], 4, 0)).toEqual([])
  })
})
