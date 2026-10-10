/** The small mark beside a Cross column's title. Colour is spent only on
 * audio information, so the playhead red belongs to the column that is
 * actually sounding; a selected column that is silent gets a monochrome mark. */
export interface CrossColumnMark {
  kind: 'playing' | 'selected' | 'none'
  color: string
  label: 'playing' | 'selected' | undefined
}

export function crossColumnMark(selected: boolean, playing: boolean): CrossColumnMark {
  if (selected && playing) return { kind: 'playing', color: 'var(--ra-playhead)', label: 'playing' }
  if (selected) return { kind: 'selected', color: 'var(--ra-text-2)', label: 'selected' }
  return { kind: 'none', color: 'var(--ra-text-4)', label: undefined }
}
