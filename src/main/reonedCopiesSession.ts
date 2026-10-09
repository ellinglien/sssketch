// One process-wide lock around everything that creates or deletes files in `.bakes`
// (bakeOffset, and later the cleanup's delete phase), and the names this session has handed to
// the renderer. A handed-out name always counts as used (decision D8 in the plan): the renderer
// may hold it in memory before it can report it.
import { basename } from 'node:path'
import { reonedNamesInText } from '@shared/reonedNames'

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

const projectNames = new Set<string>()

/** Every copy named by a project text main handed to the renderer (open, library open, backup
 * read or restore, autosave offers) or wrote (save, autosave) this session. A clean snapshots the
 * renderer's names and the files when it starts, so a project opened, recovered or saved during
 * its scan would otherwise be seen by neither; cleanBakes reads these inside the lock. Called
 * before a write, so a half-written file is covered too. */
export function noteSessionProjectText(text: string): void {
  reonedNamesInText(text, projectNames)
}

export function sessionProjectNames(): ReadonlySet<string> {
  return projectNames
}

/** What this session keeps whatever the scan saw: copies handed out, and copies named by a
 * project handed out or written. */
export function sessionKeptNames(): Set<string> {
  return new Set([...issued, ...projectNames])
}
