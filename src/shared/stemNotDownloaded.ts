// src/shared/stemNotDownloaded.ts

const MARKER = 'stem not downloaded (0 bytes or missing)'

/** A stem whose audio isn't on disk yet: its file is missing, or is a
 * 0-byte placeholder. Real, 2026-10-01: an unfinished LORE download left
 * 2,361 such placeholders in one jam folder of Elling's archive, and each
 * one failed as "Unable to decode audio data" / rubberband's "Format not
 * recognised" instead of being fetched. Thrown before any decode or
 * rubberband run, so the failure says what it is in one line. */
export class StemNotDownloadedError extends Error {
  readonly path: string
  constructor(path: string) {
    super(`${MARKER}: ${path}`)
    this.name = 'StemNotDownloadedError'
    this.path = path
  }
}

/** True for a StemNotDownloadedError, including one that crossed IPC:
 * ipcRenderer.invoke rejects with a plain Error that only keeps the
 * message, so this matches on that. */
export function isStemNotDownloadedError(err: unknown): boolean {
  if (err instanceof StemNotDownloadedError) return true
  return err instanceof Error && err.message.includes(MARKER)
}
