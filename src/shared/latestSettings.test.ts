import { describe, expect, it } from 'vitest'
import { mergeLatestSettings, nestedPatchFromLatest } from './latestSettings'

interface S {
  view: 'simple' | 'advanced'
  bar: number
  radio: { pace: number; level: number }
}

const initial: S = { view: 'simple', bar: 0.5, radio: { pace: 1, level: 50 } }

describe('mergeLatestSettings', () => {
  it('merges onto the latest settings and records them', () => {
    const holder = { current: initial }
    const next = mergeLatestSettings(holder, { bar: 0.75 })
    expect(next).toEqual({ ...initial, bar: 0.75 })
    expect(holder.current).toBe(next)
    expect(initial.bar).toBe(0.5)
  })

  it('a late commit from an older render keeps a save made in between', () => {
    // The race: a bar click's commit waits 300 ms; the view switch saves meanwhile.
    const holder = { current: initial }
    mergeLatestSettings(holder, { view: 'advanced' })
    const late = mergeLatestSettings(holder, nestedPatchFromLatest(holder, 'radio', { pace: 3 }))
    expect(late).toEqual({ view: 'advanced', bar: 0.5, radio: { pace: 3, level: 50 } })
  })

  it('two nested patches in a row both survive', () => {
    const holder = { current: initial }
    mergeLatestSettings(holder, nestedPatchFromLatest(holder, 'radio', { level: 80 }))
    mergeLatestSettings(holder, nestedPatchFromLatest(holder, 'radio', { pace: 2 }))
    expect(holder.current.radio).toEqual({ pace: 2, level: 80 })
    expect(initial.radio).toEqual({ pace: 1, level: 50 })
  })
})
