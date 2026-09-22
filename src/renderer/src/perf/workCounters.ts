// src/renderer/src/perf/workCounters.ts
//
// Renderer dev-only work counters -- see src/shared/workCounters.ts. Active
// only in a dev build (import.meta.env.DEV), and not under vitest (no
// minute-long timer left running in a test worker). A no-op in packaged
// builds.
import {
  createWorkCounters,
  formatWorkSummary,
  WORK_SUMMARY_INTERVAL_MS
} from '@shared/workCounters'

const enabled = import.meta.env.DEV && import.meta.env.MODE !== 'test'
const counters = createWorkCounters()
let timerStarted = false

export function countWork(kind: string, n = 1): void {
  if (!enabled) return
  counters.count(kind, n)
  if (timerStarted) return
  timerStarted = true
  window.setInterval(() => {
    const line = formatWorkSummary('renderer', counters.drain())
    if (line) console.log(line)
  }, WORK_SUMMARY_INTERVAL_MS)
}
