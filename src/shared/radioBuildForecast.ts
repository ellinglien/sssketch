// src/shared/radioBuildForecast.ts
//
// The desktop's forecast for sized builds (spec 2026-10-03-radio-anointed-stems-design 4.1, 4.5,
// 4.7; radioBuildSize.ts): what it may count of a change it knows about but cannot yet be sure of,
// and when the density arc's add is decided so it is warm by the phrase end's roll. Pure.

import type { RadioChangeForecast } from './radioBuildSize'

/** `f` with `n` rows picked for the top but still warming (radio's armed pick and companions,
 * cold): they may not land in time, so they raise the change to `medium` at most -- never to the
 * three rows that make it large (and promise a gap). */
export function radioForecastWithUncertainRows(
  f: RadioChangeForecast,
  n: number
): RadioChangeForecast {
  const add = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
  if (add === 0) return f
  return { ...f, rows: Math.max(f.rows, Math.min(f.rows + add, 2)) }
}

/** Whether the wrap into lap `lap` (0-based, of `laps` in the turnaround's phrase) is the one
 * BEFORE the wrap that starts the phrase's last lap (where the phrase end's roll runs): the
 * density arc's add is decided here, a lap early, so its stem is picked and warm by the roll,
 * and joins on the phrase start. One lap a phrase: every wrap. */
export function radioWrapBeforeLastLap(lap: number, laps: number): boolean {
  if (!(laps > 1)) return true
  return lap === laps - 2
}
