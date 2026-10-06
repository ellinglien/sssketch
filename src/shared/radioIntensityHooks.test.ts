// Hooks prefer the drop (spec 2026-10-05-radio-intensity-arc-design 5.2): stepRadioHooks'
// dropAtNextWrap, inBreakdown and a row's arcResting.
import { describe, expect, it } from 'vitest'
import {
  NO_RADIO_HOOKS,
  stepRadioHooks,
  toggleRadioHookStem,
  type RadioHook,
  type RadioHookRowInput,
  type RadioHooksState,
  type RadioHooksStepInput
} from './radioHooks'
import { hashText, seededRandom } from './seededRandom'

const ROWS: RadioHookRowInput[] = [
  { id: 'd', stemId: 'd-1', kinds: ['drums'], eligible: true, lastLowHeard: true },
  { id: 'b', stemId: 'b-1', kinds: ['bass'], eligible: true, lastLowHeard: true },
  { id: 'l', stemId: 'l-1', kinds: ['lead'], eligible: true, lastLowHeard: false }
]

function withHook(o: Partial<RadioHook>, row = 'd'): RadioHooksState {
  const set = toggleRadioHookStem(NO_RADIO_HOOKS, {
    rowId: row,
    stemId: `${row}-1`,
    rowCount: 8,
    paceLevel: 50,
    random: () => 0.5
  }).state
  return { ...set, hooks: set.hooks.map((h) => ({ ...h, ...o })) }
}

function input(o: Partial<RadioHooksStepInput> = {}): RadioHooksStepInput {
  return {
    loopBars: 4,
    lap: 3, // the next wrap is a phrase start
    phraseLaps: 4,
    paceLevel: 50,
    held: false,
    rows: ROWS,
    ready: () => true,
    changeAtNextWrap: false,
    calmLandings: 0,
    arcThinning: false,
    canRest: false,
    random: () => 0.9,
    ...o
  }
}

describe('hooks and the intensity arc', () => {
  it('a return due within a phrase after the drop is decided for it, with no calm wait', () => {
    // 8 bars short of due at the line (8 + 4 counted + 4 to the line = 16 of 24): not today; for
    // the drop, yes (a 16-bar phrase early at most)
    const away = withHook({ state: 'away', bars: 8, targetBars: 24 })
    expect(stepRadioHooks(away, input()).decided).toEqual([])
    const r = stepRadioHooks(away, input({ dropAtNextWrap: true, random: () => 0 }))
    expect(r.decided).toHaveLength(1)
    expect(r.decided[0]).toMatchObject({ event: 'return', rowId: 'd', awayBars: 16 })
    // more than a phrase short: not even for the drop
    const far = withHook({ state: 'away', bars: 0, targetBars: 32 })
    expect(stepRadioHooks(far, input({ dropAtNextWrap: true })).decided).toEqual([])
  })

  it('a return due in a breakdown waits for the drop', () => {
    const due = withHook({ state: 'away', bars: 24, targetBars: 24 })
    expect(stepRadioHooks(due, input({ random: () => 0.9 })).decided).toHaveLength(1)
    expect(stepRadioHooks(due, input({ inBreakdown: true })).decided).toEqual([])
    expect(
      stepRadioHooks(due, input({ inBreakdown: true, dropAtNextWrap: true })).decided
    ).toHaveLength(1)
  })

  it('no exit into a breakdown, through one, or onto the drop', () => {
    const tired = withHook({ state: 'in', bars: 64, targetBars: 16 }, 'l')
    expect(stepRadioHooks(tired, input()).decided).toHaveLength(1)
    expect(stepRadioHooks(tired, input({ inBreakdown: true })).decided).toEqual([])
    expect(stepRadioHooks(tired, input({ dropAtNextWrap: true })).decided).toEqual([])
  })

  it("a hooked-in row the breakdown rests keeps its hook, its clock stopped, and doesn't exit", () => {
    const hook = withHook({ state: 'in', bars: 4, targetBars: 64 })
    const rows = ROWS.map((r) => (r.id === 'd' ? { ...r, arcResting: true } : r))
    const r = stepRadioHooks(hook, input({ lap: 0, rows }))
    expect(r.state.hooks[0]).toMatchObject({ state: 'in', bars: 4 })
    const tired = withHook({ state: 'in', bars: 64, targetBars: 16 })
    expect(stepRadioHooks(tired, input({ rows })).decided).toEqual([])
  })

  it('absent, every step is what it was (a fingerprint of 3000 seeded steps)', () => {
    const r = seededRandom('hooks-fp')
    const lines: string[] = []
    for (let i = 0; i < 3000; i++) {
      const state = withHook(
        {
          state: (['in', 'away', 'resting'] as const)[Math.floor(r() * 3)],
          bars: Math.floor(r() * 12) * 4,
          targetBars: 8 + Math.floor(r() * 8) * 4,
          waited: r() < 0.3,
          returns: Math.floor(r() * 4)
        },
        ROWS[Math.floor(r() * 3)].id
      )
      const step = stepRadioHooks(state, {
        ...input({
          lap: Math.floor(r() * 4),
          phraseLaps: 4,
          calmLandings: Math.floor(r() * 3),
          changeAtNextWrap: r() < 0.3,
          arcThinning: r() < 0.3,
          canRest: r() < 0.5,
          random: seededRandom(`h${i}`)
        })
      })
      lines.push(JSON.stringify([step.state, step.applied, step.prepare, step.decided]))
    }
    expect(hashText(lines.join('\n'))).toBe(HOOKS_BEFORE)
  })
})

/** Recorded from the unmodified radioHooks.ts (a9d68ef4) with this test's trace. */
const HOOKS_BEFORE = 'dd70db82'
