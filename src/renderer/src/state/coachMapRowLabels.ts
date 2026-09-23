import type { ArrangeRole } from '@shared/stemRole'
import { stemLabelsByKey } from '../components/autoArrangeLabels'
import type { CoachMapRow } from './coachMapRows'

/**
 * The string actually drawn in a map row's header, and the ONE place that
 * decides it.
 *
 * THE CHAIN (spec, "Row labels, which is where part 1 meets part 2"):
 * **the confirmed role from the global StemCategories table -> the climax
 * role -> the stem's name -> the path.**
 *
 * Why the table comes first: real Endlesss material is recorded through
 * audio-in, so a stem's name and its SoundType both read "audio in" on
 * nearly every row at once and the map ends up saying nothing (direct
 * report, 2026-09-23). The role IS the categorised information, and a
 * library that has been through Tidy Up gives every map in the app readable
 * row headers for free, retroactively, with no wizard involved.
 *
 * Why the climax role survives as the second link rather than being deleted:
 * a locally-dropped file, a one-shot sample or an in-app recording has no
 * StemCID at all, so the global table can never answer for it. The climax
 * can. Dropping it would make the guided map WORSE for exactly the material
 * the user just made.
 *
 * Rows sharing a role are numbered ("drums 1", "drums 2") by
 * stemLabelsByKey, the same numbering DrawArrangeWizard's grid rows use --
 * two identical labels would re-lose exactly what this fixed. Numbered in
 * ROW order, so the "drums 1" above "drums 2" on screen is always the
 * earlier of the two.
 *
 * A pure function over plain data, not a hook, for the same reason
 * coachMapRows is one: the map's read path is the riskiest thing in this
 * feature and it has to be testable without mounting anything.
 */
export function coachMapRowLabels(
  rows: readonly CoachMapRow[],
  confirmedRoleByPath: Readonly<Record<string, ArrangeRole>>
): Map<string, string> {
  const roleByChannel = new Map<string, ArrangeRole>()
  for (const row of rows) {
    const role = roleFor(row, confirmedRoleByPath)
    if (role !== null) roleByChannel.set(row.channelId, role)
  }
  const numbered = stemLabelsByKey(
    [...roleByChannel].map(([channelId, role]) => ({ stemKey: channelId, role, included: true }))
  )
  const labels = new Map<string, string>()
  for (const row of rows) {
    labels.set(row.channelId, numbered.get(row.channelId) ?? row.label)
  }
  return labels
}

function roleFor(
  row: CoachMapRow,
  confirmedRoleByPath: Readonly<Record<string, ArrangeRole>>
): ArrangeRole | null {
  if (row.kind === 'riser') return null
  const confirmed = row.path === null ? undefined : confirmedRoleByPath[row.path]
  return confirmed ?? row.role
}

/**
 * Whether the map has rows nobody has named -- which is when the "what is
 * this?" button is worth offering.
 *
 * A riser row never counts: it has no stem and nothing to categorise. A row
 * with no path (clips the map did not lay out, naming several stems) does
 * not count either -- the merged surface works per stem, and there is no
 * single stem here for it to answer about.
 */
export function mapRowsNeedCategorising(
  rows: readonly CoachMapRow[],
  confirmedRoleByPath: Readonly<Record<string, ArrangeRole>>
): boolean {
  return rows.some((row) => row.path !== null && roleFor(row, confirmedRoleByPath) === null)
}
