import { describe, expect, it } from 'vitest'
import {
  MASTER_LEVEL_UNITY,
  masterScaledCurve,
  masterScaledGains,
  masterSendsFor
} from './performanceDeck'

describe('masterScaledGains', () => {
  it('leaves every slot alone at unity', () => {
    const gains = new Map([
      ['a', 0.8],
      ['b', 0.5]
    ])
    expect([...masterScaledGains(gains, MASTER_LEVEL_UNITY)]).toEqual([
      ['a', 0.8],
      ['b', 0.5]
    ])
  })

  it('scales the mix rather than flattening it', () => {
    // Halving the master must preserve the balance between slots, not set
    // them all to the same value.
    const gains = new Map([
      ['a', 0.8],
      ['b', 0.4]
    ])
    expect([...masterScaledGains(gains, 0.5)]).toEqual([
      ['a', 0.4],
      ['b', 0.2]
    ])
  })

  it('takes the mix to silence at zero', () => {
    expect([...masterScaledGains(new Map([['a', 1]]), 0)]).toEqual([['a', 0]])
  })

  it('clamps a master above unity rather than boosting into clipping', () => {
    expect([...masterScaledGains(new Map([['a', 1]]), 4)]).toEqual([['a', 1]])
  })

  it('clamps a negative master to silence -- a negative is the engine clear sentinel', () => {
    // IpcServer.cpp:338-342 treats a negative value as "clear this
    // override", so a negative must never reach the wire as a level.
    expect([...masterScaledGains(new Map([['a', 1]]), -1)]).toEqual([['a', 0]])
  })

  it('is empty for an empty mix', () => {
    expect([...masterScaledGains(new Map(), 0.5)]).toEqual([])
  })
})

describe('masterSendsFor', () => {
  it('gives every stem key the same send', () => {
    expect(masterSendsFor(['a:1', 'a:2'], 0.3)).toEqual({ 'a:1': 0.3, 'a:2': 0.3 })
  })

  it('returns an empty record at zero, so the toolkit stays neutral', () => {
    // isStemToolkitNeutral drops the whole toolkit key when the send is 0
    // and nothing is drawn, which makes the project bit-identical to one
    // sent without this feature at all. Emitting explicit zeroes would
    // still be neutral, but returning {} makes that guarantee obvious at
    // the call site rather than relying on a helper downstream.
    expect(masterSendsFor(['a:1', 'a:2'], 0)).toEqual({})
  })

  it('clamps above one', () => {
    expect(masterSendsFor(['a:1'], 5)).toEqual({ 'a:1': 1 })
  })

  it('clamps below zero to an empty record', () => {
    expect(masterSendsFor(['a:1'], -2)).toEqual({})
  })
})

describe('masterScaledCurve', () => {
  it('leaves a curve alone at unity', () => {
    const curve = [
      { bar: 0, value: 1 },
      { bar: 1, value: 0 }
    ]
    expect(masterScaledCurve(curve, 1)).toEqual(curve)
  })

  it('scales every point, because a volume curve REPLACES the static level', () => {
    // PlaybackEngine.cpp:317-329: a non-empty volume curve makes
    // EngineStem.volume inert and the clip runs at the curve's own value.
    // So a gesture curve that was not scaled would jump a ducked layer
    // back to full while the master fader is down.
    expect(
      masterScaledCurve(
        [
          { bar: 0, value: 1 },
          { bar: 2, value: 0.5 }
        ],
        0.25
      )
    ).toEqual([
      { bar: 0, value: 0.25 },
      { bar: 2, value: 0.125 }
    ])
  })

  it('keeps a full duck at silence', () => {
    expect(masterScaledCurve([{ bar: 1, value: 0 }], 0.5)).toEqual([{ bar: 1, value: 0 }])
  })

  it('clamps a scale above unity', () => {
    expect(masterScaledCurve([{ bar: 0, value: 1 }], 3)).toEqual([{ bar: 0, value: 1 }])
  })

  it('takes the whole curve to silence at zero, rather than dropping it', () => {
    // Dropping it would make the stem un-automated again and hand it
    // straight back to the live-override path mid-gesture.
    expect(masterScaledCurve([{ bar: 0, value: 1 }], 0)).toEqual([{ bar: 0, value: 0 }])
  })

  it('is empty for an empty curve', () => {
    expect(masterScaledCurve([], 0.5)).toEqual([])
  })
})
