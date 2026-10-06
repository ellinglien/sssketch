import { describe, expect, it } from 'vitest'
import {
  newRadioIntensityArc,
  type RadioIntensityArc,
  type RadioIntensityDecided
} from '@shared/radioIntensityArc'
import {
  intensityArcRemote,
  intensityArcShown,
  intensityDropThrowStep,
  intensityFlashRows,
  intensityHeldAddGoes,
  intensityLapAfterLandings,
  intensityMayPickAdd,
  intensityNextChange,
  intensityRestSweep,
  intensityRestsDecided,
  intensityRowsHeld,
  intensityThrowDropDue,
  sameArcShown
} from './radioIntensityGlue'

const arcWith = (o: Partial<RadioIntensityArc>): RadioIntensityArc => ({
  ...newRadioIntensityArc(),
  begun: true,
  phrases: 2,
  ...o
})
const breakdown = (rest: string[]): RadioIntensityDecided => ({
  event: 'breakdown',
  depth: 'full',
  rest,
  throwRowId: rest[0] ?? null,
  throw: null,
  carry: false
})
const drop = (returning: string[], renew: string[] = [], quick = false): RadioIntensityDecided => ({
  event: 'drop',
  returning,
  renew,
  ...(quick && { quick: true as const, forced: true as const })
})

describe('intensityRowsHeld', () => {
  it('is the rests and the decided event rows, once each', () => {
    expect(
      intensityRowsHeld(arcWith({ rests: ['a', 'b'], decided: drop(['a', 'b'], ['b', 'c']) }))
    ).toEqual(['a', 'b', 'c'])
    expect(intensityRowsHeld(arcWith({ decided: breakdown(['d']) }))).toEqual(['d'])
    expect(intensityRowsHeld(arcWith({ decided: { event: 'add' } }))).toEqual([])
  })
})

describe('intensityRestsDecided', () => {
  it('is the decided breakdown rests only', () => {
    expect([...intensityRestsDecided(arcWith({ decided: breakdown(['a', 'b']) }))]).toEqual([
      'a',
      'b'
    ])
    expect(intensityRestsDecided(arcWith({ rests: ['a'], decided: drop(['a']) })).size).toBe(0)
  })
})

describe('intensityNextChange', () => {
  const entries = (m: Record<string, 'rest' | 'return'>) => (id: string) => m[id]
  it('names the breakdown rests at the top, the rest riding it', () => {
    const arc = arcWith({ decided: breakdown(['a', 'b', 'c']) })
    const next = intensityNextChange(arc, null, entries({ a: 'rest', c: 'rest' }), 1, 4)
    expect(next).toEqual({ rowId: 'a', kind: null, barsAway: 3, rests: true, with: ['c'] })
  })
  it('is no rest when none is queued', () => {
    const arc = arcWith({ decided: breakdown(['a']) })
    expect(intensityNextChange(arc, null, entries({}), 1, 4)).toBeNull()
  })
  it('says the drop at the top, with a row coming back when one is queued', () => {
    const arc = arcWith({ phase: 'breakdown', decided: drop(['a', 'b']) })
    expect(intensityNextChange(arc, null, entries({ b: 'return' }), 2, 4)).toEqual({
      rowId: 'b',
      kind: null,
      barsAway: 2,
      drop: true
    })
    // a quick drop brings nothing back
    expect(
      intensityNextChange(arcWith({ decided: drop([], [], true) }), null, entries({}), 0, 4)
    ).toEqual({ rowId: '', kind: null, barsAway: 4, drop: true })
  })
  it('keeps whatever lands before the top, and wins a tie at it', () => {
    const arc = arcWith({ decided: drop([]) })
    const sooner = { rowId: 'x', kind: null, barsAway: 1, leaving: true }
    expect(intensityNextChange(arc, sooner, entries({}), 1, 4)).toBe(sooner)
    const atTop = { rowId: 'y', kind: 'cut' as const, barsAway: 3 }
    expect(intensityNextChange(arc, atTop, entries({}), 1, 4)?.drop).toBe(true)
  })
  it('is the landing as it was with nothing decided, or an add', () => {
    const n = { rowId: 'y', kind: null, barsAway: 3 }
    expect(intensityNextChange(arcWith({}), n, entries({}), 1, 4)).toBe(n)
    expect(intensityNextChange(arcWith({ decided: { event: 'add' } }), n, entries({}), 1, 4)).toBe(
      n
    )
  })
})

describe('intensityFlashRows', () => {
  const o = { arcEntryOf: (id: string) => (id === 'a' ? ('rest' as const) : undefined) }
  it('flashes breakdown on the rests queued, drop on the rows coming back', () => {
    expect(
      intensityFlashRows(arcWith({ decided: breakdown(['a', 'b']) }), { ...o, heard: [], rows: [] })
    ).toEqual({ ids: ['a'], word: 'breakdown' })
    expect(
      intensityFlashRows(arcWith({ decided: drop(['b']) }), { ...o, heard: ['c'], rows: [] })
    ).toEqual({ ids: ['b'], word: 'drop' })
  })
  it('flashes a quick drop on every heard row, a pressed build on every row', () => {
    expect(
      intensityFlashRows(arcWith({ decided: drop([], [], true) }), {
        ...o,
        heard: ['c', 'd'],
        rows: []
      })
    ).toEqual({ ids: ['c', 'd'], word: 'drop' })
    expect(
      intensityFlashRows(arcWith({ decided: { event: 'cycle', strip: true, forced: true } }), {
        ...o,
        heard: [],
        rows: ['a', 'b']
      })
    ).toEqual({ ids: ['a', 'b'], word: 'build' })
  })
  it('flashes nothing for the clock own cycle, an add, or nothing decided', () => {
    const none = { ...o, heard: ['a'], rows: ['a'] }
    expect(intensityFlashRows(arcWith({ decided: { event: 'cycle', strip: false } }), none)).toBe(
      null
    )
    expect(intensityFlashRows(arcWith({ decided: { event: 'add' } }), none)).toBe(null)
    expect(intensityFlashRows(arcWith({}), none)).toBe(null)
  })
})

describe('intensityHeldAddGoes', () => {
  const build = arcWith({ phase: 'build', phrases: 3, done: 0 })
  it('keeps a held add away from a decide wrap', () => {
    expect(intensityHeldAddGoes(build, { decideWrap: false, tookAdd: false })).toBe(false)
  })
  it('keeps it when its decide wrap took it, or the build goes on undecided', () => {
    expect(intensityHeldAddGoes(build, { decideWrap: true, tookAdd: true })).toBe(false)
    expect(intensityHeldAddGoes(build, { decideWrap: true, tookAdd: false })).toBe(false)
  })
  it('lets it go when another event, or a press, has the coming top, or the build is over', () => {
    expect(
      intensityHeldAddGoes(arcWith({ phase: 'build', decided: breakdown([]) }), {
        decideWrap: true,
        tookAdd: false
      })
    ).toBe(true)
    expect(
      intensityHeldAddGoes(arcWith({ phase: 'build', forced: 'drop' }), {
        decideWrap: true,
        tookAdd: false
      })
    ).toBe(true)
    expect(
      intensityHeldAddGoes(arcWith({ phase: 'drop' }), { decideWrap: true, tookAdd: false })
    ).toBe(true)
  })
})

describe('intensityThrowDropDue', () => {
  it('is the breakdown last phrase before the drop is decided', () => {
    expect(intensityThrowDropDue(arcWith({ phase: 'breakdown', phrases: 2, done: 1 }))).toBe(true)
    expect(intensityThrowDropDue(arcWith({ phase: 'breakdown', phrases: 2, done: 0 }))).toBe(false)
    expect(intensityThrowDropDue(arcWith({ phase: 'drop' }))).toBe(false)
    expect(intensityThrowDropDue(arcWith({ begun: false, phase: 'breakdown', done: 5 }))).toBe(
      false
    )
  })
  it('stops once the drop is decided: its throw is armed at the decide wrap', () => {
    expect(
      intensityThrowDropDue(arcWith({ phase: 'breakdown', phrases: 2, done: 1, decided: drop([]) }))
    ).toBe(false)
    expect(intensityThrowDropDue(arcWith({ phase: 'build', decided: drop([], [], true) }))).toBe(
      false
    )
  })
})

describe('intensityLapAfterLandings', () => {
  const resolved = new Map([
    ['a', 4],
    ['b', 2]
  ])
  it('reads a landing that lengthens the loop (4 -> 8)', () => {
    expect(intensityLapAfterLandings(resolved, new Map([['b', 8]]), 0)).toBe(8)
  })
  it('reads a landing that shortens it (8 -> 4)', () => {
    const long = new Map([
      ['a', 8],
      ['b', 2]
    ])
    expect(intensityLapAfterLandings(long, new Map([['a', 4]]), 0)).toBe(4)
  })
  it('is the resolved loop with nothing landed, the fallback with no rows', () => {
    expect(intensityLapAfterLandings(resolved, new Map(), 0)).toBe(4)
    expect(intensityLapAfterLandings(new Map(), new Map(), 16)).toBe(16)
  })
  it('is unknown while a landed length is', () => {
    expect(
      intensityLapAfterLandings(
        resolved,
        new Map<string, number | null>([
          ['a', 8],
          ['b', null]
        ]),
        0
      )
    ).toBeNull()
  })
})

describe('intensityDropThrowStep', () => {
  const o = {
    owedLap: 3,
    lap: 3,
    waited: null,
    waitingOn: null,
    loopBars: 8,
    pos: 0.1
  }
  it('arms in the lap the landings make, at the throw clock', () => {
    expect(intensityDropThrowStep(o)).toEqual({ act: 'arm', loopBars: 8, pos: 0.1 })
  })
  it('waits on a roll, a turn or a stage, an unknown length, the throw clock', () => {
    expect(intensityDropThrowStep({ ...o, waitingOn: 'a stage' })).toEqual({
      act: 'wait',
      on: 'a stage'
    })
    expect(intensityDropThrowStep({ ...o, loopBars: null }).act).toBe('wait')
    expect(intensityDropThrowStep({ ...o, loopBars: 0 }).act).toBe('wait')
    expect(intensityDropThrowStep({ ...o, pos: null }).act).toBe('wait')
  })
  it("gives up on the drop's own top, logging what it waited on", () => {
    // on the top itself the drop is still decided and pos is ~0: it must not arm a lap late
    const top = intensityDropThrowStep({ ...o, lap: 4, pos: 0.01 })
    expect(top).toEqual({ act: 'give-up', why: "dry (the drop's top came before it armed)" })
    expect(
      intensityDropThrowStep({ ...o, lap: 4, waited: 'a stage', waitingOn: 'a stage' })
    ).toEqual({ act: 'give-up', why: "dry (the drop's top came while it waited on a stage)" })
  })
})

describe('intensityMayPickAdd', () => {
  it('only with no add on the way and no next add picked ahead', () => {
    expect(intensityMayPickAdd({ adding: false, nextAdd: false })).toBe(true)
    expect(intensityMayPickAdd({ adding: true, nextAdd: false })).toBe(false)
    // a one-lap phrase's next add whose pick is still out: no second silent row
    expect(intensityMayPickAdd({ adding: false, nextAdd: true })).toBe(false)
  })
})

describe('intensityRestSweep', () => {
  const resting: [string, string][] = [
    ['a', 'arc'],
    ['b', 'arc'],
    ['c', 'arc'],
    ['d', 'hook'],
    ['gone', 'arc']
  ]
  const live = new Set(['a', 'b', 'c', 'd'])
  it('under intensity: rows gone leave, rows held or queued stay, the rest come back', () => {
    expect(
      intensityRestSweep(resting, {
        live,
        holds: new Set(['a']),
        queued: (id) => id === 'b'
      })
    ).toEqual({ gone: ['gone'], back: ['c'] })
  })
  it('the arc gone: a rest back in the mix leaves, one with nothing queued comes back', () => {
    expect(
      intensityRestSweep(resting, {
        live,
        holds: new Set(),
        queued: (id) => id === 'b',
        inMix: (id) => id === 'a'
      })
    ).toEqual({ gone: ['a', 'gone'], back: ['c'] })
  })
})

describe('intensityArcShown', () => {
  const room = { count: 3, max: 6, canAdd: true, canStrip: true }
  const at = { lap: 0, phraseLaps: 2, room, quickDropCanSound: true }

  it('before the machine has begun, neither button can act', () => {
    const shown = intensityArcShown(newRadioIntensityArc(), at)
    expect(shown).toEqual({
      phase: 'build',
      build: 'build',
      drop: 'drop',
      canBuild: false,
      canDrop: false
    })
  })

  it('in a build: build adds (with room), drop is the quick drop when its low drop can sound', () => {
    const arc = arcWith({ phase: 'build', peakRows: 5 })
    expect(intensityArcShown(arc, at)).toMatchObject({ canBuild: true, canDrop: true })
    expect(intensityArcShown(arc, { ...at, quickDropCanSound: false }).canDrop).toBe(false)
  })

  it('build in a build with no room and nothing left to halve cannot act', () => {
    const arc = arcWith({ phase: 'build', peakRows: 3, phrases: 1, done: 0 })
    expect(intensityArcShown(arc, { ...at, room: { ...room, canAdd: false } }).canBuild).toBe(false)
  })

  it('in a breakdown: drop brings the rests back whatever the low drop says', () => {
    const arc = arcWith({ phase: 'breakdown', rests: ['d'], phrases: 2 })
    expect(intensityArcShown(arc, { ...at, quickDropCanSound: false })).toMatchObject({
      phase: 'breakdown',
      canBuild: true,
      canDrop: true
    })
  })

  it('a press waiting reads building or dropping, and a decided drop still answers drop', () => {
    expect(intensityArcShown(arcWith({ forced: 'build' }), at).build).toBe('building')
    const dropping = arcWith({ phase: 'breakdown', decided: drop(['d']) })
    const shown = intensityArcShown(dropping, { ...at, quickDropCanSound: false })
    expect(shown.canDrop).toBe(true)
    expect(intensityArcShown(arcWith({ forced: 'drop' }), at).drop).toBe('dropping')
  })
})

describe('sameArcShown', () => {
  const a = {
    phase: 'build' as const,
    build: 'build',
    drop: 'drop',
    canBuild: true,
    canDrop: false
  }
  it('compares every field, and null', () => {
    expect(sameArcShown(a, { ...a })).toBe(true)
    expect(sameArcShown(a, { ...a, canDrop: true })).toBe(false)
    expect(sameArcShown(a, { ...a, build: 'building' })).toBe(false)
    expect(sameArcShown(null, null)).toBe(true)
    expect(sameArcShown(a, null)).toBe(false)
  })
})

describe('intensityArcRemote', () => {
  const a = {
    phase: 'build' as const,
    build: 'build',
    drop: 'drop',
    canBuild: true,
    canDrop: false
  }
  it("the phone's view: waiting from the labels, a drop's first", () => {
    expect(intensityArcRemote(null)).toBeNull()
    expect(intensityArcRemote(a)).toEqual({
      phase: 'build',
      waiting: null,
      canBuild: true,
      canDrop: false
    })
    expect(intensityArcRemote({ ...a, build: 'building' })?.waiting).toBe('build')
    expect(intensityArcRemote({ ...a, drop: 'dropping' })?.waiting).toBe('drop')
    expect(intensityArcRemote({ ...a, build: 'building', drop: 'dropping' })?.waiting).toBe('drop')
  })
})
