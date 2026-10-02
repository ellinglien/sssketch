// src/shared/loopFolderTypes.ts
import type { LoopTempoSource } from './loopFolderTempo'

/** Where the tempo a row shows came from: the guess cascade, or the user. */
export type LoopTempoShownSource = LoopTempoSource | 'user'

/** One linked loop, as main sends it to the renderer. */
export interface LoopEntry {
  /** 'loop-' + sha1 of the normalized absolute path (main's loopIdForPath).
   * Stable across rescans and relinks. Phase 2's Discover keys on this --
   * see the plan's "Phase 2 readiness". */
  loopId: string
  rootPath: string
  /** Absolute path of the file where it lives. Never copied while linked. */
  path: string
  /** The filename without its extension. */
  name: string
  /** Folder segments below the root, format folders flattened. */
  groupPath: string[]
  /** null until measured: WAVs are measured during the scan, other formats
   * when the renderer first decodes them (loop-folders-report-duration). */
  durationSec: number | null
  bpm: number | null
  bars: number | null
  source: LoopTempoShownSource | null
  irregular: boolean
}

export interface LoopFolderListing {
  rootPath: string
  /** The folder's own name, the sidebar title. */
  name: string
  /** false when the last scan could not find the folder (an unplugged
   * drive). Its loops are kept, not removed, until it is back. */
  available: boolean
  lastScannedAt: number | null
  loops: LoopEntry[]
}

export type LinkLoopFolderRefusal =
  'not a folder' | 'already linked' | 'inside a linked folder' | 'contains a linked folder'

export type LinkLoopFolderResult =
  { ok: true; folder: LoopFolderListing } | { ok: false; reason: LinkLoopFolderRefusal }

/** The range a corrected tempo may take. The renderer's input and main's
 * setLoopTempoOverride both check it. */
export const MIN_LOOP_TEMPO_OVERRIDE = 40
export const MAX_LOOP_TEMPO_OVERRIDE = 300
