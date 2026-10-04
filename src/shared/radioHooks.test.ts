// Hooks that leave and come back (spec 2026-10-03-radio-anointed-stems-design section 2).
import { describe, expect, it } from 'vitest'
import {
  HOOK_AWAY,
  HOOK_LONG_REST,
  HOOK_RETURNS_BEFORE_REST,
  HOOK_STAY,
  NO_RADIO_HOOKS,
  NO_RADIO_LANDINGS,
  RADIO_ROLE_WORDS_MAX,
  advanceRadioLandingWindow,
  bringRadioHookBack,
  drawRadioHookBars,
  forgetRadioHookOnManualChange,
  likeRadioStem,
  noteRadioLandings,
  pruneRadioHooks,
  radioHookBars,
  radioHookBarsToReturn,
  radioHookInRow,
  radioHookInRowNext,
  radioHookLine,
  radioHookOf,
  radioHookPaceScale,
  radioHookReservesRow,
  radioHookStemsAway,
  radioHookTurnoverExcluded,
  radioHooksMax,
  radioHooksStarted,
  radioHooksStopped,
  radioLandingsInPhrase,
  radioRoleWords,
  releaseRadioHook,
  stepRadioHooks,
  toggleRadioHookStem,
  withdrawRadioHookEvent,
  type RadioHookRowInput,
  type RadioHooksState,
  type RadioHooksStepInput,
  type RadioHooksStepResult
} from './radioHooks'
import { turnaroundPhraseLaps } from './radioTurnaround'
import { seededRandom } from './seededRandom'

const ROWS: RadioHookRowInput[] = [
  { id: 'd', stemId: 'd-1', kinds: ['drums'], eligible: true, lastLowHeard: true },
  { id: 'b', stemId: 'b-1', kinds: ['bass'], eligible: true, lastLowHeard: true },
  { id: 'l', stemId: 'l-1', kinds: ['lead'], eligible: true, lastLowHeard: false },
  { id: 'w', stemId: 'w-1', kinds: ['warm'], eligible: true, lastLowHeard: false }
]

/** A random that counts its draws. */
function counted(seed: string): { random: () => number; n: () => number } {
  const r = seededRandom(seed)
  let n = 0
  return {
    random: () => {
      n++
      return r()
    },
    n: () => n
  }
}

/** Hook rows by id, with the stems the rows play. */
function hooked(ids: string[], seed = 'set', paceLevel = 50): RadioHooksState {
  let s = NO_RADIO_HOOKS
  const random = seededRandom(seed)
  for (const id of ids) {
    const row = ROWS.find((r) => r.id === id)!
    s = toggleRadioHookStem(s, {
      rowId: id,
      stemId: row.stemId!,
      rowCount: 8,
      paceLevel,
      random
    }).state
  }
  return s
}

interface Wrap {
  k: number
  lap: number
  r: RadioHooksStepResult
}

/** Steps `wraps` loop tops of a `loopBars` loop (a 16-bar phrase), rows playing what the hooks
 * leave them (a substitute `x-k` on exit, the hooked stem on return). */
function run(
  state: RadioHooksState,
  wraps: number,
  o: Partial<RadioHooksStepInput> & { loopBars?: number; seed?: string } = {}
): { state: RadioHooksState; log: Wrap[] } {
  const loopBars = o.loopBars ?? 4
  const P = turnaroundPhraseLaps(16, loopBars)
  const random = o.random ?? seededRandom(o.seed ?? 'run')
  let rows = (o.rows ?? ROWS).map((r) => ({ ...r }))
  let lap = 0
  const log: Wrap[] = []
  for (let k = 1; k <= wraps; k++) {
    lap = (lap + 1) % P
    const r = stepRadioHooks(state, {
      loopBars,
      lap,
      phraseLaps: P,
      paceLevel: 50,
      held: false,
      ready: () => true,
      changeAtNextWrap: false,
      calmLandings: 5,
      arcThinning: false,
      canRest: false,
      ...o,
      rows,
      random
    })
    for (const a of r.applied) {
      const h = radioHookOf(r.state, a.rowId)!
      rows = rows.map((x) =>
        x.id === a.rowId ? { ...x, stemId: a.event === 'return' ? h.stemId : `${x.id}-x${k}` } : x
      )
    }
    state = r.state
    log.push({ k, lap, r })
  }
  return { state, log }
}

describe('lines', () => {
  it('exits on phrase starts and half lines, returns only on phrase starts, at every loop', () => {
    for (const loopBars of [1, 2, 3, 4, 5, 6, 8, 16, 32]) {
      const P = turnaroundPhraseLaps(16, loopBars)
      const lines: string[] = []
      for (let lap = 0; lap < P; lap++) lines.push(String(radioHookLine(lap, P)))
      // the wrap ending the last lap is the phrase start
      expect(lines[P - 1]).toBe('phrase')
      if (P % 2 === 0 && P > 1) expect(lines[P / 2 - 1]).toBe('half')
      expect(lines.filter((l) => l === 'phrase')).toHaveLength(1)
      // at the default 16 bars: every 8 bars on an 8-bar or shorter loop that halves the phrase
      if (loopBars <= 8 && 16 % loopBars === 0) {
        const every = lines
          .map((l, i) => (l !== 'null' ? (i + 1) * loopBars : null))
          .filter((x) => x !== null)
        expect(every).toEqual([8, 16])
      }
    }
  })
})

describe('lengths', () => {
  it('the pace scale at its knots', () => {
    expect(radioHookPaceScale(0)).toBeCloseTo(1.5)
    expect(radioHookPaceScale(25)).toBeCloseTo(1.25)
    expect(radioHookPaceScale(50)).toBeCloseTo(1)
    expect(radioHookPaceScale(70)).toBeCloseTo(0.75)
    expect(radioHookPaceScale(90)).toBeCloseTo(0.5)
    expect(radioHookPaceScale(100)).toBeCloseTo(0.5)
    for (let l = 1; l <= 100; l++)
      expect(radioHookPaceScale(l)).toBeLessThanOrEqual(radioHookPaceScale(l - 1))
  })

  it('the spec table: rounded to 8 (ties up), clamped 8-64', () => {
    const menu = (m: readonly { bars: number }[], scale: number): number[] =>
      m.map((x) => radioHookBars(x.bars, scale))
    expect(menu(HOOK_STAY, 1.5)).toEqual([24, 40, 48])
    expect(menu(HOOK_STAY, 1.25)).toEqual([24, 32, 40])
    expect(menu(HOOK_STAY, 1)).toEqual([16, 24, 32])
    expect(menu(HOOK_STAY, 0.75)).toEqual([16, 16, 24])
    expect(menu(HOOK_STAY, 0.5)).toEqual([8, 16, 16])
    expect(menu(HOOK_LONG_REST, 1.5)).toEqual([64, 64])
    expect(menu(HOOK_LONG_REST, 1)).toEqual([48, 64])
    expect(menu(HOOK_LONG_REST, 0.75)).toEqual([40, 48])
    expect(menu(HOOK_LONG_REST, 0.5)).toEqual([24, 32])
  })

  it('the menus draw by their weights (10k seeded)', () => {
    for (const menu of [HOOK_STAY, HOOK_AWAY]) {
      const random = seededRandom(`menu-${menu[0].weight}`)
      const n: Record<number, number> = {}
      for (let i = 0; i < 10000; i++) {
        const b = drawRadioHookBars(menu, 1, random)
        n[b] = (n[b] ?? 0) + 1
      }
      for (const m of menu) expect(n[m.bars] / 10000).toBeCloseTo(m.weight, 1)
    }
  })
})

describe('no hooks: nothing at all', () => {
  it('the same state, no draws, nothing out', () => {
    const c = counted('none')
    const r = stepRadioHooks(NO_RADIO_HOOKS, {
      loopBars: 4,
      lap: 3,
      phraseLaps: 4,
      paceLevel: 50,
      held: false,
      rows: ROWS,
      ready: () => true,
      changeAtNextWrap: false,
      calmLandings: 0,
      arcThinning: true,
      canRest: true,
      random: c.random
    })
    expect(r.state).toBe(NO_RADIO_HOOKS)
    expect(r.applied).toEqual([])
    expect(r.decided).toEqual([])
    expect(r.prepare).toEqual([])
    expect(c.n()).toBe(0)
  })
})

describe('the cycle', () => {
  it('exits only on a line, returns only on a phrase start, decided one wrap ahead', () => {
    const { log } = run(hooked(['l']), 400)
    let exits = 0
    let returns = 0
    for (const w of log) {
      for (const d of w.r.decided) {
        const line = radioHookLine(w.lap, 4)
        if (d.event === 'exit') {
          exits++
          expect(line).not.toBeNull()
        } else {
          returns++
          expect(line).toBe('phrase')
        }
      }
    }
    expect(exits).toBeGreaterThan(5)
    expect(returns).toBeGreaterThan(5)
    // every decision lands at the very next wrap
    for (let i = 0; i + 1 < log.length; i++) {
      for (const d of log[i].r.decided) {
        expect(log[i + 1].r.applied).toContainEqual({ rowId: d.rowId, event: d.event })
      }
    }
  })

  it('stays and absences are what was drawn, counted from the line', () => {
    const { log } = run(hooked(['l']), 400)
    let lastFlip: { k: number; event: string; target: number } | null = null
    for (const w of log) {
      for (const a of w.r.applied) {
        const h = radioHookOf(w.r.state, a.rowId)!
        if (lastFlip !== null) {
          const bars = (w.k - lastFlip.k) * 4
          // at least what was drawn; a return also waits for its phrase start (16 bars)
          expect(bars).toBeGreaterThanOrEqual(lastFlip.target)
          expect(bars).toBeLessThan(lastFlip.target + (lastFlip.event === 'exit' ? 16 : 8) + 1e-9)
        }
        lastFlip = { k: w.k, event: a.event, target: h.targetBars }
      }
    }
  })

  it('at most one hook away at a time, with three hooks', () => {
    const { log } = run(hooked(['d', 'l', 'w']), 1000)
    let maxOut = 0
    let exits = 0
    for (const w of log) {
      const out = w.r.state.hooks.filter((h) => h.state !== 'in').length
      maxOut = Math.max(maxOut, out)
      exits += w.r.decided.filter((d) => d.event === 'exit').length
    }
    expect(maxOut).toBe(1)
    expect(exits).toBeGreaterThan(10)
  })

  it('the hook with the most bars in goes first', () => {
    let s = hooked(['l', 'w'])
    s = {
      ...s,
      hooks: s.hooks.map((h) => ({ ...h, targetBars: 8, bars: h.rowId === 'w' ? 20 : 12 }))
    }
    const r = stepRadioHooks(s, {
      loopBars: 4,
      lap: 1,
      phraseLaps: 4,
      paceLevel: 50,
      held: false,
      rows: ROWS,
      ready: () => true,
      changeAtNextWrap: false,
      calmLandings: 5,
      arcThinning: false,
      canRest: false,
      random: seededRandom('most')
    })
    expect(r.decided.map((d) => d.rowId)).toEqual(['w'])
  })

  it('bass leaves dry; drums leave with an echo', () => {
    const { log } = run(hooked(['d', 'b']), 1000)
    const exits = log.flatMap((w) => w.r.decided.filter((d) => d.event === 'exit'))
    const bass = exits.filter((d) => d.rowId === 'b')
    const drums = exits.filter((d) => d.rowId === 'd')
    expect(bass.length).toBeGreaterThan(0)
    expect(drums.length).toBeGreaterThan(0)
    for (const d of bass) expect(d.event === 'exit' && d.throw).toBeNull()
    for (const d of drums) expect(d.event === 'exit' && d.throw !== null).toBe(true)
  })

  it('rests only while the arc thins and not on the last heard low row; its draw only then', () => {
    const lead = run(hooked(['l']), 1000, { arcThinning: true, canRest: true, seed: 'rest' })
    const rests = lead.log.flatMap((w) => w.r.decided).filter((d) => d.event === 'exit' && d.rest)
    expect(rests.length).toBeGreaterThan(0)
    const drums = run(hooked(['d']), 1000, { arcThinning: true, canRest: true, seed: 'rest' })
    expect(drums.log.flatMap((w) => w.r.decided).some((d) => d.event === 'exit' && d.rest)).toBe(
      false
    )
    // not thinning, or the runtime cannot rest: the same draws as never resting
    const plain = run(hooked(['l']), 300, { seed: 'same' })
    for (const o of [
      { arcThinning: false, canRest: true },
      { arcThinning: true, canRest: false }
    ]) {
      const other = run(hooked(['l']), 300, { ...o, seed: 'same' })
      expect(JSON.stringify(other.state)).toBe(JSON.stringify(plain.state))
    }
  })

  it('never rests a row whose silence would shorten the loop; its draw not made', () => {
    // the arc's own shrinksLoop rule (Task 11): a resting row is gone from the mix, and a loop
    // whose longest stem leaves shrinks under every hook's phrase
    const rows = ROWS.map((r) => (r.id === 'l' ? { ...r, restShrinksLoop: true } : r))
    const shrinks = run(hooked(['l']), 1000, {
      arcThinning: true,
      canRest: true,
      rows,
      seed: 'rest'
    })
    const exits = shrinks.log.flatMap((w) => w.r.decided).filter((d) => d.event === 'exit')
    expect(exits.length).toBeGreaterThan(10)
    expect(exits.some((d) => d.event === 'exit' && d.rest)).toBe(false)
    // no rest draw: the same draws as a runtime that cannot rest
    const plain = run(hooked(['l']), 300, { rows, seed: 'same' })
    const other = run(hooked(['l']), 300, { arcThinning: true, canRest: true, rows, seed: 'same' })
    expect(JSON.stringify(other.state)).toBe(JSON.stringify(plain.state))
    // false or absent: today's
    const off = ROWS.map((r) => (r.id === 'l' ? { ...r, restShrinksLoop: false } : r))
    const a = run(hooked(['l']), 300, { arcThinning: true, canRest: true, rows: off, seed: 's' })
    const b = run(hooked(['l']), 300, { arcThinning: true, canRest: true, seed: 's' })
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state))
  })

  it('after HOOK_RETURNS_BEFORE_REST returns, a long rest, and the count starts again', () => {
    const { log } = run(hooked(['l']), 3000)
    const exits = log.flatMap((w) => w.r.decided).filter((d) => d.event === 'exit')
    expect(exits.length).toBeGreaterThan(2 * (HOOK_RETURNS_BEFORE_REST + 1))
    exits.forEach((d, i) => {
      const long = (i + 1) % (HOOK_RETURNS_BEFORE_REST + 1) === 0
      const menu = (long ? HOOK_LONG_REST : HOOK_AWAY).map((m) => radioHookBars(m.bars, 1))
      expect(menu).toContain(d.event === 'exit' && d.awayBars)
    })
  })

  it('held: the clock stops and nothing is decided; a decided event still lands', () => {
    let s = hooked(['l'])
    s = { ...s, hooks: s.hooks.map((h) => ({ ...h, bars: 100 })) }
    const c = counted('held')
    const r = stepRadioHooks(s, {
      loopBars: 4,
      lap: 3,
      phraseLaps: 4,
      paceLevel: 50,
      held: true,
      rows: ROWS,
      ready: () => true,
      changeAtNextWrap: false,
      calmLandings: 5,
      arcThinning: false,
      canRest: false,
      random: c.random
    })
    expect(r.state).toBe(s)
    expect(c.n()).toBe(0)
    const decided = {
      ...s,
      hooks: s.hooks.map((h) => ({
        ...h,
        decided: { event: 'exit' as const, rest: false, throw: null, awayBars: 16, longRest: false }
      }))
    }
    const landed = stepRadioHooks(decided, {
      loopBars: 4,
      lap: 3,
      phraseLaps: 4,
      paceLevel: 50,
      held: true,
      rows: ROWS,
      ready: () => true,
      changeAtNextWrap: false,
      calmLandings: 5,
      arcThinning: false,
      canRest: false,
      random: c.random
    })
    expect(landed.applied).toEqual([{ rowId: 'l', event: 'exit' }])
    expect(radioHookOf(landed.state, 'l')!.state).toBe('away')
  })

  it('not ready: no decision, tried at the next line', () => {
    const ready = run(hooked(['l']), 200, { seed: 'r' })
    const never = run(hooked(['l']), 200, { seed: 'r', ready: () => false })
    expect(ready.log.some((w) => w.r.decided.length > 0)).toBe(true)
    expect(never.log.some((w) => w.r.decided.length > 0)).toBe(false)
  })
})

describe('the return', () => {
  /** An away hook due at the next phrase start. */
  function dueBack(o: Partial<{ waited: boolean; broughtBack: boolean }> = {}): RadioHooksState {
    const s = hooked(['l'])
    return {
      ...s,
      hooks: s.hooks.map((h) => ({ ...h, state: 'away' as const, bars: 12, targetBars: 16, ...o }))
    }
  }
  const at = (
    s: RadioHooksState,
    o: Partial<RadioHooksStepInput>,
    seed: string
  ): { r: RadioHooksStepResult; draws: number } => {
    const c = counted(seed)
    const r = stepRadioHooks(s, {
      loopBars: 4,
      lap: 3,
      phraseLaps: 4,
      paceLevel: 50,
      held: false,
      rows: ROWS,
      ready: () => true,
      changeAtNextWrap: false,
      calmLandings: 5,
      arcThinning: false,
      canRest: false,
      random: c.random,
      ...o
    })
    return { r, draws: c.n() }
  }

  it('busy: back on time, only the stay drawn', () => {
    const { r, draws } = at(dueBack(), { changeAtNextWrap: true, calmLandings: 0 }, 'busy')
    expect(r.decided.map((d) => d.event)).toEqual(['return'])
    expect(draws).toBe(1)
  })

  it('calm: may wait one phrase, once', () => {
    let waits = 0
    let backs = 0
    for (let i = 0; i < 400; i++) {
      const { r, draws } = at(dueBack(), { calmLandings: 1 }, `calm-${i}`)
      if (r.decided.length === 0) {
        waits++
        expect(draws).toBe(1)
        const h = radioHookOf(r.state, 'l')!
        expect(h.waited).toBe(true)
        expect(h.targetBars).toBe(16 + 16)
      } else {
        backs++
        expect(draws).toBe(2)
      }
    }
    expect(waits / 400).toBeCloseTo(0.5, 1)
    expect(backs).toBeGreaterThan(0)
    // waited already: no wait draw
    expect(at(dueBack({ waited: true }), { calmLandings: 0 }, 'w').draws).toBe(1)
    // not calm: no wait draw
    expect(at(dueBack(), { calmLandings: 2 }, 'nc').draws).toBe(1)
  })

  it('brought back: the next phrase start, no wait', () => {
    const s = hooked(['l'])
    const away = {
      ...s,
      hooks: s.hooks.map((h) => ({ ...h, state: 'away' as const, bars: 4, targetBars: 32 }))
    }
    const back = bringRadioHookBack(away, 'l')
    const { r } = at(back, { calmLandings: 0 }, 'bb')
    expect(r.decided.map((d) => d.event)).toEqual(['return'])
    // not before a phrase start
    expect(at(back, { lap: 1 }, 'bb2').r.decided).toEqual([])
  })

  it('a return waits while its row is ineligible', () => {
    const rows = ROWS.map((r) => (r.id === 'l' ? { ...r, eligible: false } : r))
    expect(at(dueBack(), { rows, changeAtNextWrap: true }, 'inel').r.decided).toEqual([])
  })
})

describe('taps and other hands', () => {
  const set = (s: RadioHooksState, id: string, rowCount = 8): RadioHooksState =>
    toggleRadioHookStem(s, {
      rowId: id,
      stemId: ROWS.find((r) => r.id === id)!.stemId!,
      rowCount,
      paceLevel: 50,
      random: seededRandom(id)
    }).state

  it('the toggle hooks the playing stem, then releases it', () => {
    const on = set(NO_RADIO_HOOKS, 'l')
    expect(radioHookInRow(on, 'l')).toBe(true)
    expect(radioHookOf(on, 'l')!.stemId).toBe('l-1')
    expect(radioHookOf(set(on, 'l'), 'l')).toBeNull()
  })

  it('the cap: half the rows, oldest released first, one that is in before one that is away', () => {
    expect(radioHooksMax(1)).toBe(1)
    expect(radioHooksMax(4)).toBe(2)
    expect(radioHooksMax(5)).toBe(2)
    expect(radioHooksMax(8)).toBe(4)
    let s = set(set(NO_RADIO_HOOKS, 'd', 4), 'b', 4)
    s = set(s, 'l', 4)
    expect(s.hooks.map((h) => h.rowId)).toEqual(['b', 'l'])
    // the oldest is away: the oldest IN goes
    s = {
      ...s,
      hooks: s.hooks.map((h) => (h.rowId === 'b' ? { ...h, state: 'away' as const } : h))
    }
    s = set(s, 'w', 4)
    expect(s.hooks.map((h) => h.rowId)).toEqual(['b', 'w'])
  })

  it('the cap after the bed shrank: releases until under it, in hooks first, then the oldest', () => {
    const shrink = (s: RadioHooksState, rowCount: number): ReturnType<typeof toggleRadioHookStem> =>
      toggleRadioHookStem(s, {
        rowId: 'w',
        stemId: 'w-1',
        rowCount,
        paceLevel: 50,
        random: seededRandom('shrink')
      })
    // three hooks set on an 8-row bed; the bed shrinks to 2 rows (cap 1)
    const three = set(set(set(NO_RADIO_HOOKS, 'd'), 'b'), 'l')
    const one = shrink(three, 2)
    expect(one.state.hooks.map((h) => h.rowId)).toEqual(['w'])
    expect(one.released.map((h) => h.rowId)).toEqual(['d', 'b', 'l'])
    // cap 2 (4 rows) with the middle one away: both hooks in go first, oldest first
    const mixed = {
      ...three,
      hooks: three.hooks.map((h) => (h.rowId === 'b' ? { ...h, state: 'away' as const } : h))
    }
    const two = shrink(mixed, 4)
    expect(two.state.hooks.map((h) => h.rowId)).toEqual(['b', 'w'])
    expect(two.released.map((h) => h.rowId)).toEqual(['d', 'l'])
    // under the cap: nothing released
    expect(shrink(NO_RADIO_HOOKS, 8).released).toEqual([])
  })

  it('👍 hooks and never un-hooks; on an away hook it does nothing', () => {
    const like = (s: RadioHooksState, canHold = true): RadioHooksState =>
      likeRadioStem(s, {
        rowId: 'l',
        stemId: 'l-9',
        rowCount: 8,
        paceLevel: 50,
        random: seededRandom('x'),
        canHold
      }).state
    const on = like(NO_RADIO_HOOKS)
    expect(radioHookOf(on, 'l')!.stemId).toBe('l-9')
    expect(like(on)).toBe(on)
    expect(like(NO_RADIO_HOOKS, false)).toBe(NO_RADIO_HOOKS)
    const away = { ...on, hooks: on.hooks.map((h) => ({ ...h, state: 'away' as const })) }
    expect(like(away)).toBe(away)
  })

  it('a manual change clears a hook in; an away hook stays', () => {
    const on = set(NO_RADIO_HOOKS, 'l')
    expect(radioHookOf(forgetRadioHookOnManualChange(on, 'l'), 'l')).toBeNull()
    const away = { ...on, hooks: on.hooks.map((h) => ({ ...h, state: 'away' as const })) }
    expect(forgetRadioHookOnManualChange(away, 'l')).toBe(away)
  })

  it('release, withdraw, prune, stop and start', () => {
    const on = set(set(NO_RADIO_HOOKS, 'l'), 'w')
    expect(releaseRadioHook(on, 'l').released!.rowId).toBe('l')
    expect(pruneRadioHooks(on, new Set(['l', 'w']))).toBe(on)
    expect(pruneRadioHooks(on, new Set(['w'])).hooks.map((h) => h.rowId)).toEqual(['w'])
    const decided = {
      ...on,
      hooks: on.hooks.map((h) =>
        h.rowId === 'l'
          ? {
              ...h,
              decided: {
                event: 'exit' as const,
                rest: false,
                throw: null,
                awayBars: 16,
                longRest: false
              }
            }
          : { ...h, state: 'away' as const }
      )
    }
    expect(radioHookOf(withdrawRadioHookEvent(decided, 'l'), 'l')!.decided).toBeNull()
    const stopped = radioHooksStopped(decided)
    expect(stopped.hooks.map((h) => [h.rowId, h.state, h.decided])).toEqual([['l', 'in', null]])
    const c = counted('start')
    const started = radioHooksStarted(stopped, { paceLevel: 50, random: c.random })
    expect(c.n()).toBe(1)
    expect(radioHookOf(started, 'l')!.bars).toBe(0)
  })

  it('who holds what: in, in next, reserved, turnover, stems away', () => {
    const on = set(NO_RADIO_HOOKS, 'l')
    const h = radioHookOf(on, 'l')!
    const exitDecided = {
      ...on,
      hooks: [
        {
          ...h,
          decided: {
            event: 'exit' as const,
            rest: false,
            throw: null,
            awayBars: 16,
            longRest: false
          }
        }
      ]
    }
    expect(radioHookInRow(exitDecided, 'l')).toBe(true)
    expect(radioHookInRowNext(exitDecided, 'l')).toBe(false)
    const away = { ...on, hooks: [{ ...h, state: 'away' as const }] }
    expect(radioHookInRow(away, 'l')).toBe(false)
    expect(radioHookReservesRow(away, 'l')).toBe(true)
    expect(radioHookTurnoverExcluded(away, 'l')).toBe(false)
    expect(
      radioHookTurnoverExcluded({ ...away, hooks: [{ ...away.hooks[0], prepared: true }] }, 'l')
    ).toBe(true)
    expect(radioHookStemsAway(away)).toEqual(['l-1'])
    const back = {
      ...on,
      hooks: [
        {
          ...h,
          state: 'away' as const,
          decided: { event: 'return' as const, stayBars: 16, awayBars: 16 }
        }
      ]
    }
    expect(radioHookInRowNext(back, 'l')).toBe(true)
    expect(radioHookTurnoverExcluded(on, 'l')).toBe(true)
  })
})

describe('calm', () => {
  it('counts landings over the last phrase of laps', () => {
    let w = NO_RADIO_LANDINGS
    w = noteRadioLandings(w, 1)
    for (let i = 0; i < 3; i++) w = advanceRadioLandingWindow(w, 4)
    w = noteRadioLandings(w, 2)
    expect(radioLandingsInPhrase(w)).toBe(3)
    w = advanceRadioLandingWindow(w, 4)
    expect(radioLandingsInPhrase(w)).toBe(2)
  })
})

describe('words', () => {
  it('every role text fits the phone, and the short forms', () => {
    for (const state of ['in', 'away', 'resting'] as const)
      for (const decided of [null, 'exit', 'return'] as const)
        for (const barsToReturn of [null, 1, 16, 64])
          for (const dig of [false, true])
            for (const narrow of [false, true]) {
              const w = radioRoleWords({ hook: { state, decided, barsToReturn }, dig, narrow })!
              expect(w.length).toBeLessThanOrEqual(RADIO_ROLE_WORDS_MAX)
              expect(w).toBe(w.toLowerCase())
            }
    expect(
      radioRoleWords({ hook: { state: 'away', decided: null, barsToReturn: 16 }, dig: false })
    ).toBe('hook · back in 16 bars')
    expect(
      radioRoleWords({
        hook: { state: 'away', decided: null, barsToReturn: 16 },
        dig: false,
        narrow: true
      })
    ).toBe('back in 16')
    expect(
      radioRoleWords({ hook: { state: 'in', decided: null, barsToReturn: null }, dig: true })
    ).toBe('hook · dig')
    expect(radioRoleWords({ hook: null, dig: true })).toBe('dig')
    expect(radioRoleWords({ hook: null, dig: false })).toBeNull()
  })

  it('bars to the planned return: the first phrase start its target reaches', () => {
    const h = { state: 'away' as const, bars: 0, targetBars: 16 }
    // lap 0 of a 4-lap phrase, at bar 1: 3 bars, then 3 more laps
    expect(radioHookBarsToReturn(h, { lap: 0, phraseLaps: 4, loopBars: 4, pos: 1 })).toBe(15)
    expect(
      radioHookBarsToReturn(
        { ...h, targetBars: 20 },
        { lap: 0, phraseLaps: 4, loopBars: 4, pos: 0 }
      )
    ).toBe(32)
    expect(
      radioHookBarsToReturn({ ...h, state: 'in' }, { lap: 0, phraseLaps: 4, loopBars: 4, pos: 0 })
    ).toBeNull()
  })
})
