// src/main/workCounters.ts
//
// Main-process dev-only work counters -- see src/shared/workCounters.ts.
// Off until index.ts calls enableWorkCounters(!app.isPackaged), so this
// module never imports 'electron' itself (the cache stores that call
// countWork stay importable from plain vitest) and packaged builds pay
// nothing beyond one boolean check per call.
import {
  createWorkCounters,
  formatWorkSummary,
  WORK_SUMMARY_INTERVAL_MS
} from '@shared/workCounters'

const counters = createWorkCounters()
let enabled = false

export function countWork(kind: string, n = 1): void {
  if (enabled) counters.count(kind, n)
}

/** Starts the once-a-minute summary line. Call once, at startup, with
 * `!app.isPackaged`. */
export function enableWorkCounters(on: boolean): void {
  if (!on || enabled) return
  enabled = true
  const timer = setInterval(() => {
    const line = formatWorkSummary('main', counters.drain())
    if (line) console.log(line)
  }, WORK_SUMMARY_INTERVAL_MS)
  timer.unref()
}
