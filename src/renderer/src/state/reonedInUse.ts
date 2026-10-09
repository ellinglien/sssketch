// The re-oned stem copies the renderer holds in memory, for the cleanup's used set (spec part
// 3, "what counts as used"): the open project and every undo and redo step, plus any open Cross
// or Discover session. Main can't see these, so the renderer reports them with each survey and
// clean (reonedCopiesSurvey / reonedCopiesClean).
import { collectReonedNames } from '@shared/reonedNames'
import { getHistorySnapshot } from './StoreContext'

export type ReonedSessionKey = 'cross' | 'discover'

const sessionRoots = new Map<ReonedSessionKey, unknown>()

/** App keeps these current: its Cross draft and its Discover slots (null when closed). */
export function setReonedSessionRoot(key: ReonedSessionKey, value: unknown): void {
  if (value === null || value === undefined) sessionRoots.delete(key)
  else sessionRoots.set(key, value)
}

export function collectInMemoryReonedNames(): string[] {
  const h = getHistorySnapshot()
  return [...collectReonedNames([h.past, h.present, h.future, ...sessionRoots.values()])]
}
