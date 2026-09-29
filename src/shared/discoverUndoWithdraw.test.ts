import { describe, expect, it } from 'vitest'
import { manualChangesUndoneBy, UndoSnapshotSequence } from './discoverUndoWithdraw'

const waiting = (entries: [string, number][]): Map<string, { undoSeq: number }> =>
  new Map(entries.map(([slotId, undoSeq]) => [slotId, { undoSeq }]))

describe('manualChangesUndoneBy', () => {
  it('withdraws what was queued at or after the restored point, and nothing before it', () => {
    // Snapshot 3 was pushed, then a and b queued; c was queued before it.
    expect(
      manualChangesUndoneBy(
        waiting([
          ['c', 2],
          ['a', 3],
          ['b', 5]
        ]),
        3
      )
    ).toEqual(['a', 'b'])
  })

  it('withdraws a whole reroll-all: one snapshot up front, every row queued after it', () => {
    expect(
      manualChangesUndoneBy(
        waiting([
          ['a', 7],
          ['b', 7],
          ['c', 7]
        ]),
        7
      )
    ).toEqual(['a', 'b', 'c'])
  })

  it('leaves everything when every change predates the point', () => {
    expect(
      manualChangesUndoneBy(
        waiting([
          ['a', 1],
          ['b', 2]
        ]),
        3
      )
    ).toEqual([])
  })

  it('withdraws everything for a snapshot of unknown age, rather than guessing', () => {
    expect(
      manualChangesUndoneBy(
        waiting([
          ['a', 1],
          ['b', 9]
        ]),
        undefined
      )
    ).toEqual(['a', 'b'])
  })

  it('has nothing to do with nothing waiting -- radio off, always', () => {
    expect(manualChangesUndoneBy(waiting([]), 4)).toEqual([])
    expect(manualChangesUndoneBy(waiting([]), undefined)).toEqual([])
  })
})

describe('UndoSnapshotSequence', () => {
  it('numbers snapshots in push order and a queued change after its push', () => {
    const sequence = new UndoSnapshotSequence()
    const first: string[] = []
    const second: string[] = []
    expect(sequence.latest()).toBe(0)
    expect(sequence.mark(first)).toBe(1)
    const queuedAfterFirst = sequence.latest()
    expect(sequence.mark(second)).toBe(2)
    expect(sequence.seqOf(first)).toBe(1)
    expect(sequence.seqOf(second)).toBe(2)
    // Undo to the second snapshot keeps a change queued before it; undo to
    // the first takes it back.
    const queued = new Map([['a', { undoSeq: queuedAfterFirst }]])
    expect(manualChangesUndoneBy(queued, sequence.seqOf(second))).toEqual([])
    expect(manualChangesUndoneBy(queued, sequence.seqOf(first))).toEqual(['a'])
  })

  it('keeps a snapshot its first number when it is seen again', () => {
    const sequence = new UndoSnapshotSequence()
    const snapshot: string[] = []
    sequence.mark(snapshot)
    sequence.mark([])
    expect(sequence.mark(snapshot)).toBe(1)
    expect(sequence.latest()).toBe(2)
  })

  it('knows no number for a snapshot it never saw', () => {
    expect(new UndoSnapshotSequence().seqOf([])).toBeUndefined()
  })

  it('is not fooled by the cap: numbers keep rising where a depth would stand still', () => {
    const sequence = new UndoSnapshotSequence()
    const seqs = Array.from({ length: 25 }, () => sequence.mark([]))
    expect(seqs).toEqual(Array.from({ length: 25 }, (_, i) => i + 1))
  })
})
