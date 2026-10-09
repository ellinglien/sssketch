// One process-wide lock around everything that creates or deletes files in `.bakes`
// (bakeOffset, and later the cleanup's delete phase), and the names this session has handed to
// the renderer. A handed-out name always counts as used (decision D8 in the plan): the renderer
// may hold it in memory before it can report it.
import { basename } from 'node:path'

let tail: Promise<unknown> = Promise.resolve()

export function withReonedCopiesLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.then(fn, fn)
  tail = run.catch(() => undefined)
  return run
}

const issued = new Set<string>()

export function noteIssuedCopy(path: string): void {
  issued.add(basename(path))
}

export function sessionIssuedNames(): ReadonlySet<string> {
  return issued
}
