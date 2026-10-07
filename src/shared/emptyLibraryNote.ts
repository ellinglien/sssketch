// src/shared/emptyLibraryNote.ts -- what Discover and radio say on an empty riff library.
//
// Share readiness S6 (2026-10-07). Both draw only from the riff library (the Endlesss sync, or
// a LORE archive). Stems dragged in or imported from a loop folder go to the timeline instead, so
// someone who has only done that would see Discover and radio roll nothing, with no word why.

export function emptyLibraryNote(where: 'discover' | 'radio'): string[] {
  return [
    where === 'discover'
      ? 'your riff library is empty, so discover has nothing to roll yet.'
      : 'your riff library is empty, so radio has nothing to play yet.',
    'to fill it: log into endlesss under import and sync your jams, or point sssketch at a LORE ' +
      'archive (gear → change riff archive location…).',
    'stems you drag in or import from a loop folder go to the timeline, not the library.'
  ]
}
