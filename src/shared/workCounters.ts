// src/shared/workCounters.ts
//
// Dev-only work counters (docs/superpowers/specs/
// 2026-09-22-background-efficiency-design.md, A1): each process counts how
// many decodes / worker jobs / IPC calls / SQL queries its background paths
// did, and logs one summary line per interval. The process-specific
// wrappers (src/main/workCounters.ts, src/renderer/src/perf/
// workCounters.ts) own the timer and the dev/packaged switch; this file is
// the pure part both share.

export interface WorkCounters {
  count: (kind: string, n?: number) => void
  /** Returns every count since the last drain and resets them. */
  drain: () => Map<string, number>
}

export function createWorkCounters(): WorkCounters {
  let counts = new Map<string, number>()
  return {
    count(kind, n = 1) {
      counts.set(kind, (counts.get(kind) ?? 0) + n)
    },
    drain() {
      const out = counts
      counts = new Map()
      return out
    }
  }
}

/** One log line, e.g. `[work renderer] decode 42 · analysis 42 ·
 * ipc:get-stem-feature-cache 120` -- highest count first, ties by name.
 * Null when nothing happened (nothing worth logging). */
export function formatWorkSummary(label: string, counts: Map<string, number>): string | null {
  const entries = [...counts].filter(([, n]) => n > 0)
  if (entries.length === 0) return null
  entries.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  return `[work ${label}] ${entries.map(([kind, n]) => `${kind} ${n}`).join(' · ')}`
}

export const WORK_SUMMARY_INTERVAL_MS = 60_000
