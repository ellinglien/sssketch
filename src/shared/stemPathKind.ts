// src/shared/stemPathKind.ts

/** Whether a file's basename can be a library stem's StemCID -- the
 * content-addressed name every analysis row is stored under. A name
 * containing `.` never is: measured read-only 2026-10-05, every one of the
 * 972,964 StemCIDs in both warehouses (891,062 external + 81,902 own) is 32
 * lowercase hex, none contains `.`. So drag-imported rifffs (`… .wav`), baked
 * stems (`… .baked.wav`) and loop-folder files are not library stems, decided
 * with zero I/O and no Stems lookup on the USB archive. An extensionless name
 * keeps today's behaviour: treated as a library stem. (Merge-background-scans
 * plan, decision 10.) */
export function isLibraryStemName(name: string): boolean {
  return !name.includes('.')
}
