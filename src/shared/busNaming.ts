import type { BusId, SoundType } from './types'

/** 'extInst' -> 'ext inst', 'audioIn' -> 'audio in' -- this app's own design
 * system calls for lowercase UI copy everywhere (see CLAUDE.md); SoundType's
 * own values are camelCase identifiers, not display text, so track/folder
 * names built from them need this conversion rather than using them raw. */
export function humanizeSoundType(type: SoundType): string {
  return type.replace(/([A-Z])/g, ' $1').toLowerCase()
}

/** The most common sound type(s) among a set of stems, as a short
 * human-readable summary -- e.g. "drums, notes" -- used to make bus names
 * actually say something about what's IN them, instead of just the bare bus
 * id repeated everywhere. Capped at the top 3 types so a highly mixed bus
 * doesn't produce an unreadably long name. */
export function summarizeSoundTypes(types: SoundType[]): string {
  const counts = new Map<SoundType, number>()
  for (const type of types) counts.set(type, (counts.get(type) ?? 0) + 1)
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1])
  return sorted
    .slice(0, 3)
    .map(([type]) => humanizeSoundType(type))
    .join(', ')
}

/** A bus's own display name -- the bare bus id, plus a sound-type summary
 * UNLESS that summary would just repeat the bus id back verbatim (e.g. a
 * 'drums' bus made up entirely of 'drums'-typed stems gains nothing from
 * "drums — drums"). Upper-cased -- purely decorative export-side flavor
 * (Ableton group-track names, Reaper track/folder names), not this app's
 * own UI copy, so it doesn't conflict with sssketch's own
 * lowercase-everywhere design system convention. `entries` only needs a
 * `soundType` field -- both buildAlsXml.ts's StemClipsResult and a future
 * Reaper builder's own per-stem result type satisfy this structurally,
 * without either file importing the other's types. */
export function busGroupName(busId: BusId, entries: { soundType: SoundType }[]): string {
  const summary = summarizeSoundTypes(entries.map((e) => e.soundType))
  const name = summary === busId ? busId : `${busId} — ${summary}`
  return name.toUpperCase()
}

/** The next free "{bus} N" name for a newly bus-assigned clip -- lowercase,
 * matching this app's own UI-copy convention (unlike busGroupName above,
 * which is deliberately uppercase export-side flavor). Scans every
 * existing rifff name for this exact bus's own "{bus} N" pattern and picks
 * one past the highest N found, rather than just counting current
 * members, so a clip that got renamed away or deleted doesn't free up its
 * old number for reuse. */
export function nextBusClipName(existingNames: Iterable<string>, busId: BusId): string {
  const pattern = new RegExp(`^${busId} (\\d+)$`, 'i')
  let max = 0
  for (const name of existingNames) {
    const match = pattern.exec(name.trim())
    if (match) max = Math.max(max, parseInt(match[1], 10))
  }
  return `${busId} ${max + 1}`
}
