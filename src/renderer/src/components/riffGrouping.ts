// Riff grid grouping for LibraryBrowser.tsx -- its own module so the
// component file only exports components (react-refresh/only-export-
// components) and so this stays unit-testable.
import type { RiffLibraryRiffSummary } from '@shared/riffLibraryTypes'

interface RiffTempoGroup {
  bpm: number // rounded to the nearest whole BPM — the grouping key for "similar tempos"
  riffs: RiffLibraryRiffSummary[]
}

interface RiffDateGroup {
  label: string
  tempoGroups: RiffTempoGroup[]
}

/** Groups riffs by local calendar date, then by tempo within each date —
 * date > tempo. A jam with thousands of riffs otherwise renders as one
 * undifferentiated wall of circles with no sense of when anything was made
 * or which ones actually belong together tempo-wise. Riffs already arrive
 * sorted by CreationTime DESC (see listRiffs), so a single linear scan is
 * enough for the date grouping: consecutive riffs sharing the same date
 * label just extend the current group. Tempo grouping keys on the rounded
 * whole-number BPM (not exact equality) — LORE's own BPMrnd column carries
 * floating-point noise (see formatBpm's own doc comment), so two riffs that
 * are really "the same tempo" rarely match exactly. Each date's tempo
 * groups are then sorted numerically ascending, for easy scanning rather
 * than whatever order they happened to occur in that day. Within a tempo
 * group the riffs are flipped back to OLDEST FIRST -- direct report,
 * 2026-09-22: "the rifff dots are kind of in the reverse order of what
 * you'd expect... I would expect the top first left to be the first under
 * that date." The incoming CreationTime DESC order made the top-left dot
 * the LAST riff of that day and the bottom-right the first; reading order
 * now runs forward through the session. Date groups themselves stay
 * newest-first, so the most recent day is still at the top. */
export function groupRiffsByDateAndTempo(riffs: RiffLibraryRiffSummary[]): RiffDateGroup[] {
  const dateGroups: RiffDateGroup[] = []
  for (const riff of riffs) {
    const label = new Date(riff.creationTime * 1000).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
    let dateGroup = dateGroups[dateGroups.length - 1]
    if (!dateGroup || dateGroup.label !== label) {
      dateGroup = { label, tempoGroups: [] }
      dateGroups.push(dateGroup)
    }
    const bpm = Math.round(riff.bpm)
    let tempoGroup = dateGroup.tempoGroups.find((g) => g.bpm === bpm)
    if (!tempoGroup) {
      tempoGroup = { bpm, riffs: [] }
      dateGroup.tempoGroups.push(tempoGroup)
    }
    tempoGroup.riffs.push(riff)
  }
  for (const dateGroup of dateGroups) {
    dateGroup.tempoGroups.sort((a, b) => a.bpm - b.bpm)
    for (const tempoGroup of dateGroup.tempoGroups) tempoGroup.riffs.reverse()
  }
  return dateGroups
}
