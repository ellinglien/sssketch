import { describe, expect, it } from 'vitest'
import { cellIsOn } from './coachCells'
import { readRowPasses, type MapBarWindow } from './coachMapRead'
import {
  clipsCrossingSectionEdge,
  passIsLocked,
  planCellToggle,
  remapCellsToPhrase,
  type MapClip
} from './coachMapEdit'

/** A 4-pass section starting at bar 8, on a 4-bar phrase: bars 8..24. */
const SECTION = { startBar: 8, passes: 4 }
const PHRASE = 4

function clip(groupId: string, startBar: number, endBar: number): MapClip {
  return { groupId, startBar, endBar }
}

/** Applies a plan to a clip list the way the reducer will: drop the removed
 * ones, add one clip per run. Lets a test close the loop without a store. */
function apply(clips: readonly MapClip[], plan: ReturnType<typeof planCellToggle>): MapClip[] {
  const kept = clips.filter((c) => !plan.removeGroupIds.includes(c.groupId))
  const added = plan.addRuns.map((run, i): MapClip => {
    const startBar = SECTION.startBar + run.startPass * PHRASE
    return { groupId: `new-${i}`, startBar, endBar: startBar + run.passCount * PHRASE }
  })
  return [...kept, ...added]
}

function grid(clips: readonly MapClip[]): string {
  const windows: MapBarWindow[] = clips.map((c) => ({ startBar: c.startBar, endBar: c.endBar }))
  return readRowPasses(windows, SECTION, PHRASE)
    .map((on) => (on ? 'x' : '.'))
    .join('')
}

describe('planCellToggle', () => {
  it('does nothing at all when the cell already says what was asked', () => {
    const clips = [clip('a', 8, 24)]
    const plan = planCellToggle({
      clips,
      section: SECTION,
      phraseBars: PHRASE,
      passIndex: 0,
      on: true
    })
    expect(plan).toEqual({ removeGroupIds: [], addRuns: [], blockedGroupIds: [] })
  })

  it('turning off the END of a run shortens it rather than splitting it', () => {
    const clips = [clip('a', 8, 24)]
    const plan = planCellToggle({
      clips,
      section: SECTION,
      phraseBars: PHRASE,
      passIndex: 3,
      on: false
    })
    expect(plan.removeGroupIds).toEqual(['a'])
    expect(plan.addRuns).toEqual([{ startPass: 0, passCount: 3 }])
  })

  it('turning off the MIDDLE of a run leaves two runs', () => {
    const clips = [clip('a', 8, 24)]
    const plan = planCellToggle({
      clips,
      section: SECTION,
      phraseBars: PHRASE,
      passIndex: 1,
      on: false
    })
    expect(plan.removeGroupIds).toEqual(['a'])
    expect(plan.addRuns).toEqual([
      { startPass: 0, passCount: 1 },
      { startPass: 2, passCount: 2 }
    ])
  })

  it('turning a cell ON between two runs merges all three into one clip', () => {
    const clips = [clip('a', 8, 12), clip('b', 16, 24)]
    const plan = planCellToggle({
      clips,
      section: SECTION,
      phraseBars: PHRASE,
      passIndex: 1,
      on: true
    })
    expect(plan.removeGroupIds.sort()).toEqual(['a', 'b'])
    expect(plan.addRuns).toEqual([{ startPass: 0, passCount: 4 }])
  })

  it('turning a cell ON on an empty row adds one clip and removes nothing', () => {
    const plan = planCellToggle({
      clips: [],
      section: SECTION,
      phraseBars: PHRASE,
      passIndex: 2,
      on: true
    })
    expect(plan.removeGroupIds).toEqual([])
    expect(plan.addRuns).toEqual([{ startPass: 2, passCount: 1 }])
  })

  it('leaves a run the toggle did not touch completely alone', () => {
    // Two separate clips; the toggle only disturbs the second.
    const clips = [clip('a', 8, 12), clip('b', 16, 24)]
    const plan = planCellToggle({
      clips,
      section: SECTION,
      phraseBars: PHRASE,
      passIndex: 3,
      on: false
    })
    expect(plan.removeGroupIds).toEqual(['b'])
    expect(plan.addRuns).toEqual([{ startPass: 2, passCount: 1 }])
  })

  it('keeps a nudged clip in an untouched run, nudge and all', () => {
    // 'a' was dragged a bar late by hand. The toggle is three passes away.
    const clips = [clip('a', 9, 12), clip('b', 20, 24)]
    const plan = planCellToggle({
      clips,
      section: SECTION,
      phraseBars: PHRASE,
      passIndex: 3,
      on: false
    })
    expect(plan.removeGroupIds).toEqual(['b'])
    expect(plan.addRuns).toEqual([])
  })
})

describe('a clip that crosses the section edge', () => {
  const straddling = [clip('long', 4, 24)]

  it('is named rather than acted on', () => {
    expect(clipsCrossingSectionEdge(straddling, SECTION, PHRASE)).toEqual(['long'])
  })

  it('locks every pass it touches', () => {
    expect(passIsLocked(straddling, SECTION, PHRASE, 0)).toBe(true)
    expect(passIsLocked(straddling, SECTION, PHRASE, 3)).toBe(true)
    expect(passIsLocked([clip('a', 8, 12)], SECTION, PHRASE, 0)).toBe(false)
  })

  it('makes the toggle a refusal, never a deletion', () => {
    const plan = planCellToggle({
      clips: straddling,
      section: SECTION,
      phraseBars: PHRASE,
      passIndex: 1,
      on: false
    })
    expect(plan.removeGroupIds).toEqual([])
    expect(plan.addRuns).toEqual([])
    expect(plan.blockedGroupIds).toEqual(['long'])
  })

  it('does not block a toggle in a run it is nowhere near', () => {
    const clips = [clip('long', 4, 12), clip('b', 16, 24)]
    const plan = planCellToggle({
      clips,
      section: SECTION,
      phraseBars: PHRASE,
      passIndex: 3,
      on: false
    })
    expect(plan.blockedGroupIds).toEqual([])
    expect(plan.removeGroupIds).toEqual(['b'])
  })
})

describe('the round trip', () => {
  // The single most important test in this plan: read the grid, toggle a
  // cell, apply the plan, read the grid again, and get what was asked for.
  const cases: {
    name: string
    clips: MapClip[]
    passIndex: number
    on: boolean
    want: string
  }[] = [
    { name: 'off at the end', clips: [clip('a', 8, 24)], passIndex: 3, on: false, want: 'xxx.' },
    { name: 'off in the middle', clips: [clip('a', 8, 24)], passIndex: 1, on: false, want: 'x.xx' },
    { name: 'off at the start', clips: [clip('a', 8, 24)], passIndex: 0, on: false, want: '.xxx' },
    { name: 'on from empty', clips: [], passIndex: 2, on: true, want: '..x.' },
    {
      name: 'on between two runs',
      clips: [clip('a', 8, 12), clip('b', 16, 24)],
      passIndex: 1,
      on: true,
      want: 'xxxx'
    },
    {
      name: 'off the only pass of a run',
      clips: [clip('a', 8, 12), clip('b', 16, 24)],
      passIndex: 0,
      on: false,
      want: '..xx'
    }
  ]

  for (const c of cases) {
    it(`survives ${c.name}`, () => {
      const plan = planCellToggle({
        clips: c.clips,
        section: SECTION,
        phraseBars: PHRASE,
        passIndex: c.passIndex,
        on: c.on
      })
      expect(grid(apply(c.clips, plan))).toBe(c.want)
    })
  }

  it('is idempotent -- toggling to the value it already has changes nothing', () => {
    const clips = [clip('a', 8, 24)]
    const plan = planCellToggle({
      clips,
      section: SECTION,
      phraseBars: PHRASE,
      passIndex: 2,
      on: true
    })
    expect(grid(apply(clips, plan))).toBe(grid(clips))
  })

  it('goes back where it started when a toggle is reversed', () => {
    const clips = [clip('a', 8, 24)]
    const off = planCellToggle({
      clips,
      section: SECTION,
      phraseBars: PHRASE,
      passIndex: 1,
      on: false
    })
    const afterOff = apply(clips, off)
    expect(grid(afterOff)).toBe('x.xx')
    const on = planCellToggle({
      clips: afterOff,
      section: SECTION,
      phraseBars: PHRASE,
      passIndex: 1,
      on: true
    })
    expect(grid(apply(afterOff, on))).toBe('xxxx')
  })
})

describe('remapCellsToPhrase', () => {
  it('splits every pass in two when the phrase halves', () => {
    const cells = { '0|/a.wav': true, '1|/a.wav': false }
    const remapped = remapCellsToPhrase(cells, ['/a.wav'], 2, 4)
    expect(cellIsOn(remapped, 0, '/a.wav', false)).toBe(true)
    expect(cellIsOn(remapped, 1, '/a.wav', false)).toBe(true)
    expect(cellIsOn(remapped, 2, '/a.wav', true)).toBe(false)
    expect(cellIsOn(remapped, 3, '/a.wav', true)).toBe(false)
  })

  it('takes the first of each pair when the phrase doubles', () => {
    const cells = { '0|/a.wav': true, '1|/a.wav': false, '2|/a.wav': false, '3|/a.wav': false }
    const remapped = remapCellsToPhrase(cells, ['/a.wav'], 4, 2)
    expect(cellIsOn(remapped, 0, '/a.wav', false)).toBe(true)
    expect(cellIsOn(remapped, 1, '/a.wav', true)).toBe(false)
  })

  it('leaves a path it was not given alone', () => {
    const remapped = remapCellsToPhrase({ '0|/b.wav': false }, ['/a.wav'], 2, 4)
    expect(remapped['0|/b.wav']).toBeUndefined()
  })
})
