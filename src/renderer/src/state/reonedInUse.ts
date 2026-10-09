// The re-oned stem copies the renderer holds in memory, for the cleanup's used set (spec part
// 3, "what counts as used"): the open project and every undo and redo step, plus any open Cross
// or Discover session (Discover's own undo and redo included). Main can't see these, so the
// renderer reports them with each survey and clean (reonedCopiesSurvey / reonedCopiesClean).
import { collectReonedNames } from '@shared/reonedNames'
import { getHistorySnapshot } from './StoreContext'

export type ReonedSessionKey = 'cross' | 'discover' | 'discover-history'

const sessionRoots = new Map<ReonedSessionKey, unknown>()

/** App keeps these current: its Cross draft (with its own undo and redo), its Discover slots,
 * and Discover's undo and redo stacks of slots (null when closed). */
export function setReonedSessionRoot(key: ReonedSessionKey, value: unknown): void {
  if (value === null || value === undefined) sessionRoots.delete(key)
  else sessionRoots.set(key, value)
}

export function collectInMemoryReonedNames(): string[] {
  const h = getHistorySnapshot()
  return [...collectReonedNames([h.past, h.present, h.future, ...sessionRoots.values()])]
}
