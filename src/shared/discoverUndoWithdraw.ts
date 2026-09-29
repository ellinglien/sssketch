// src/shared/discoverUndoWithdraw.ts

/** Which waiting manual changes an undo takes back.
 *
 * Elling, 2026-09-29: undo withdraws every change still waiting for the
 * loop top that was queued AFTER the undo point. The row keeps the stem it
 * has; nothing lands for it.
 *
 * "After" is measured on a sequence, not on the undo stack's depth. The
 * stack is capped (DISCOVER_UNDO_LIMIT), so at the cap a push leaves the
 * depth where it was and a depth could not tell a change queued before a
 * push from one queued after it. Instead every snapshot carries the
 * sequence number it was pushed with, and every queued change carries the
 * latest sequence number at the moment it was queued -- so a change
 * queued after snapshot N (by the action that pushed N, or by any later
 * one) has `undoSeq >= N`, and one queued before it has `undoSeq < N`.
 *
 * `restoredSeq` undefined is a snapshot whose age is not known. Nothing
 * can then be shown to predate it, so everything waiting is withdrawn --
 * an undo never lets a change land that it might have been meant to take
 * back.
 *
 * Returns the slot ids in queue order. */
export function manualChangesUndoneBy(
  waiting: ReadonlyMap<string, { undoSeq: number }>,
  restoredSeq: number | undefined
): string[] {
  const undone: string[] = []
  for (const [slotId, change] of waiting) {
    if (restoredSeq === undefined || change.undoSeq >= restoredSeq) undone.push(slotId)
  }
  return undone
}

/** Numbers undo snapshots in the order they are pushed. Keyed by the
 * snapshot array itself, in a WeakMap, so a snapshot trimmed off the capped
 * stack takes its number with it. `latest()` is what a queued change
 * records; `seqOf(snapshot)` is what an undo compares it against. */
export class UndoSnapshotSequence {
  private seq = 0
  private readonly bySnapshot = new WeakMap<object, number>()

  /** Numbers `snapshot` if it has no number yet, and returns its number. */
  mark(snapshot: object): number {
    const known = this.bySnapshot.get(snapshot)
    if (known !== undefined) return known
    this.seq += 1
    this.bySnapshot.set(snapshot, this.seq)
    return this.seq
  }

  seqOf(snapshot: object): number | undefined {
    return this.bySnapshot.get(snapshot)
  }

  latest(): number {
    return this.seq
  }
}
