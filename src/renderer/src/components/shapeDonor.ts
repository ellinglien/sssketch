import { crossItemIsAudible, crossSourceAuditionGain } from '@shared/cross'
import type { ShapeDraft } from '@shared/shape'
import { stemKey, type Rifff, type Stem } from '@shared/types'

export interface ShapeDonorRow {
  id: string
  slot: number
  stem: Omit<Stem, 'slot'>
  gain: number
}

export function shapeDonorRows(
  rifff: Rifff,
  vol: Readonly<Record<string, number>>
): ShapeDonorRow[] {
  const groupGain = vol[rifff.groupId] ?? 1
  return rifff.stems.map(({ slot, ...stem }) => ({
    id: `${rifff.groupId}:${slot}`,
    slot,
    stem,
    gain: Math.max(0, Math.min(1, vol[stemKey(rifff.groupId, slot)] ?? groupGain))
  }))
}

export function shapeDonorMembers(
  rows: readonly ShapeDonorRow[],
  muted: ReadonlySet<string>,
  soloedId: string | null
): Array<{ stem: Omit<Stem, 'slot'>; gain: number }> {
  return rows.flatMap((row) =>
    crossItemIsAudible(row.id, muted.has(row.id), soloedId)
      ? [
          {
            stem: row.stem,
            gain: crossSourceAuditionGain(row.gain, soloedId === row.id)
          }
        ]
      : []
  )
}

export function shapeDonorStemIsPresent(draft: ShapeDraft, row: ShapeDonorRow): boolean {
  const identity = row.stem.phaseSourcePath ?? row.stem.path
  return draft.lanes.some((lane) => (lane.source.phaseSourcePath ?? lane.source.path) === identity)
}
