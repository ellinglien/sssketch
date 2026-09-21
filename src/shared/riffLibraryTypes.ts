import type { SoundType } from './types'

/** Default riff-library username, used only as the initial value of the
 * user-editable "your username" setting in LibraryBrowser (persisted to
 * localStorage from there) and as computeOwnerFraction's own fallback
 * default below. Not a hardcoded identity any more — other people testing
 * this app set their own in the riff library browser's filter bar. */
export const RIFF_LIBRARY_USERNAME = 'elling'

export interface RiffLibraryJam {
  jamCID: string
  name: string
  lastRiffTime: number // unix seconds
}

export interface RiffLibraryRiffSummary {
  riffCID: string
  creationTime: number
  bpm: number
  barLength: number
  userName: string
  stemCount: number // populated slots, 1-8
  cachedStemCount: number // of those, how many are on disk right now
  ownerFraction: number // 0-1, fraction of populated slots created by RIFF_LIBRARY_USERNAME
}

export interface RiffLibraryResolvedStem {
  stemCID: string
  slot: number // 1-8
  path: string | null // local file path, or null if not cached
  gain: number // from the riff's GainsJSON, default 1.0
  creatorUserName: string
  presetName: string
  instrumentMask: number
  durationSec: number // computed from this stem's own BPMrnd/BarLength, not the riff's
  barLength: number // this stem's own loop length — may differ from the riff's own barLength if the stem tiles
  /** This stem's own BPM (already the OUROVEON-matching rounded value, see
   * bpsToRoundedBpm) — kept separately from durationSec/barLength (which are
   * DERIVED from it) so a warehouse writer can persist it as its own BPMrnd
   * column, matching loreWarehouse.ts's own Stems.BPMrnd. Undefined only for
   * a construction site that doesn't have it (loreWarehouse.ts's own
   * resolveRiff, reading an external warehouse, doesn't set this). */
  bpm?: number
  /** Direct, unauthenticated HTTPS URL for this stem's audio — the actual
   * stem blobs turn out to be public DigitalOcean Spaces objects (verified
   * against the real warehouse; the login LORE asks for is only for the
   * Endlesss metadata API, not for fetching cached-elsewhere audio). Null
   * only if the Stems row itself is missing (shouldn't happen for a
   * populated slot). Present even when path is already non-null — a caller
   * downloading only cares about the ones where path is null. */
  downloadUrl: string | null
  /** Raw components behind downloadUrl (endpoint/bucket/key -- see
   * stemDownloadUrl), kept separately rather than only the combined URL, so
   * a SQLite warehouse writer can persist them as their own
   * FileEndpoint/FileBucket/FileKey columns matching loreWarehouse.ts's own
   * Stems table, and reconstruct the URL the same way loreWarehouse.ts's
   * resolveRiff already does. Undefined when downloadUrl itself is null
   * (no oggAudio at all) or for a construction site that doesn't have raw
   * components available (loreWarehouse.ts's own resolveRiff). fileBucket
   * is specifically undefined (not empty string) when the real endpoint had
   * no separate bucket subdomain -- matches stemDownloadUrl's own
   * fileBucket-is-optional contract. */
  fileEndpoint?: string
  fileBucket?: string
  fileKey?: string
  /** The stem audio file's byte size, straight from Endlesss's own
   * cdn_attachments metadata (RawStemDoc.cdn_attachments.oggAudio.length in
   * endlesssApi.ts) -- known upfront, before any download starts, since it's
   * embedded in the same doc as downloadUrl. Undefined when unavailable (no
   * oggAudio, or a construction site that doesn't carry it, e.g.
   * loreWarehouse.ts's own resolveRiff reading an external warehouse that
   * never persisted a size column). Lets loreWarehouseSync.ts's progress
   * reporting show real data amounts (see SyncProgress.bytesDone) without
   * needing a separate metadata round trip. */
  sizeBytes?: number
}

export interface RiffFilters {
  dateFrom?: number
  dateTo?: number
  bpmMin?: number
  bpmMax?: number
  /** Both filter against the same Root/Scale columns resolveKeyName reads --
   * pass both together (a key is a root+scale pair) or neither; there's no
   * "any scale in this root" partial-match mode. */
  root?: number
  scale?: number
  userName?: string
  onlyFullyCached?: boolean
  /** Whichever username the renderer's "your username" setting is currently
   * set to — drives both ownerFraction and onlyContainsUser. Not the same
   * field as `userName` above, which filters by the riff's own top-level
   * owner; this instead affects how a riff's per-STEM authorship is scored,
   * regardless of who owns it. */
  targetUser?: string
  /** Only riffs with at least one stem authored by targetUser (falls back to
   * RIFF_LIBRARY_USERNAME if targetUser is unset). */
  onlyContainsUser?: boolean
  /** How many riffs (most-recent-first) to skip before this page — 0/undefined
   * for the first page. */
  offset?: number
  /** How many riffs to fetch, defaulting to a per-backend default when unset. */
  limit?: number
}

export interface RiffPage {
  riffs: RiffLibraryRiffSummary[]
  /** True if there's likely at least one more riff beyond this page. */
  hasMore: boolean
  /** The `offset` to pass for the next page. */
  nextOffset: number
  /** The jam's total riff count, when the backend's own response happens to
   * carry one (endlesssApi.ts's listRiffsInJam gets this for free from the
   * CouchDB view's total_rows -- see its own doc comment) -- undefined for
   * backends that don't expose it (the local warehouse's own listRiffs, the
   * shared-feed listing). Used to warn before syncing a particularly large
   * jam, not for pagination itself. */
  totalCount?: number
}

export interface RiffLibraryResolvedRiff {
  riffCID: string
  bpm: number
  barLength: number
  /** e.g. "E Minor (Aeolian)" -- resolved from the warehouse's own Root/
   * Scale columns (see loreWarehouse.ts's resolveKeyName). Undefined for
   * riffs predating this metadata, not every riff has it. */
  key?: string
  /** Raw Root/Scale ints behind `key` (see resolveKeyName) -- kept
   * separately so a warehouse writer can persist them as their own
   * Root/Scale columns rather than only the derived display string.
   * Undefined for a construction site that doesn't have them
   * (loreWarehouse.ts's own resolveRiff only derives `key`, not these). */
  root?: number
  scale?: number
  /** Unix seconds -- when this riff was created on Endlesss (Riffs.
   * CreationTime). Copied onto every one of its own imported Stem's own
   * `creationTime` (see @shared/types's Stem.creationTime doc comment for
   * why that's per-stem, not per-riff, despite this being the single
   * source every NORMAL import copies from). Undefined for a construction
   * site that doesn't have it (the live Endlesss API path, endlesssApi.ts,
   * does not populate this -- only the local, already-synced riff library
   * does). */
  creationTime?: number
  stems: RiffLibraryResolvedStem[]
}

/** Traced directly from OUROVEON's own source (toolkit.warehouse.cpp), not
 * guessed: bit 1 = drum, bit 2 = note, bit 3 = bass, bit 4 = mic. If multiple
 * bits are set, drum wins, then note, then bass, then mic — matching
 * OUROVEON's own getInstrumentType() resolution order. No bits set (or any
 * other combination without one of these four) returns null, meaning "no
 * confident mapping" — the caller falls back to the existing audio-content
 * heuristic (classifyStems) rather than guessing 'fx'. */
export function instrumentMaskToSoundType(mask: number): SoundType | null {
  if ((mask & (1 << 1)) !== 0) return 'drums'
  if ((mask & (1 << 2)) !== 0) return 'notes'
  if ((mask & (1 << 3)) !== 0) return 'bass'
  if ((mask & (1 << 4)) !== 0) return 'audioIn'
  return null
}

/** Which Endlesss instrument-mask-derived sound sources a Discover roll is
 * allowed to draw from -- direct request, 2026-09-21: "a way to only
 * enable audio in or microphone stems... a checkbox for endlesss sounds,
 * or audio in or microphone (non-endlesss sounds)." Two independent
 * toggles, not three -- Elling's own clarification, after being told
 * "Endlesss sounds" vs "Endlesss effects" has no reliable mask-based
 * signal to split on: "it's fine to lump all fx and instruments together
 * for endlesss stuff... i just want a endlesss sounds switch and a
 * non-endlesss sounds switch." Both default true (no filtering) so every
 * EXISTING caller that doesn't pass this explicitly keeps today's
 * unfiltered behavior. */
export interface DiscoverSoundSourceFilter {
  endlesss: boolean
  audioIn: boolean
}

/** True if a stem's own raw Instrument mask (or the ABSENCE of one --
 * `null`/`undefined`, meaning no confident mask signal at all) is allowed
 * under `filter`. Only a mask that resolves to 'audioIn' (instrumentMaskToSoundType's
 * own mic-bit priority, above) counts as the non-Endlesss bucket --
 * everything else (a real drums/notes/bass mask hit, OR no confident mask
 * at all -- which covers Endlesss's own on-board/external FX and
 * instrument sounds that don't set a recognizable mask bit) counts as
 * "Endlesss," lumped together per Elling's own explicit instruction:
 * "anything but audio in and microphone would be a[n Endlesss] sound."
 * There's no reliable mask-based signal to split "Endlesss instrument"
 * from "Endlesss effect" further -- doing so would mean falling back to
 * the same preset-name-guessing heuristic Discover's whole redesign moved
 * away from trusting. */
export function soundSourceMatchesFilter(
  mask: number | null | undefined,
  filter: DiscoverSoundSourceFilter
): boolean {
  const isAudioIn =
    mask !== null && mask !== undefined && instrumentMaskToSoundType(mask) === 'audioIn'
  return isAudioIn ? filter.audioIn : filter.endlesss
}

/** The stem's direct download URL, from its Stems row's FileEndpoint/
 * FileBucket/FileKey columns. Verified empirically against several real
 * FileEndpoint values (a mix of endpoints with FileBucket empty, where
 * FileEndpoint alone is already the full virtual-hosted host, and endpoints
 * with FileBucket set, where the bucket is a subdomain of a shared regional
 * endpoint) — both forms resolve to a working, unauthenticated HTTPS URL
 * whose Content-Length matches the DB's own FileLength exactly. */
export function stemDownloadUrl(fileEndpoint: string, fileBucket: string, fileKey: string): string {
  const host = fileBucket ? `${fileBucket}.${fileEndpoint}` : fileEndpoint
  return `https://${host}/${fileKey}`
}

/** Fraction of `creatorUserNames` equal to `targetUser` (defaults to
 * RIFF_LIBRARY_USERNAME). Returns 0 for an empty list rather than dividing by zero. */
export function computeOwnerFraction(
  creatorUserNames: string[],
  targetUser: string = RIFF_LIBRARY_USERNAME
): number {
  if (creatorUserNames.length === 0) return 0
  const matching = creatorUserNames.filter((u) => u === targetUser).length
  return matching / creatorUserNames.length
}

// Traced directly from OUROVEON's own source (endlesss/core.constants.h,
// cRootNames), not guessed -- same "verify against the real reference
// client" standard this file already applies. Root is a 12-tone chromatic
// index; OUROVEON's own naming deliberately favors flats over sharps for the
// black keys (Db, Eb, F#, Ab, Bb -- not a typo, that's genuinely the
// reference client's own spelling choice, kept verbatim rather than "fixed"
// to an enharmonic sharps-only convention).
export const RIFF_LIBRARY_ROOT_NAMES = [
  'C',
  'Db',
  'D',
  'Eb',
  'E',
  'F',
  'F#',
  'G',
  'Ab',
  'A',
  'Bb',
  'B'
] as const

// Traced directly from OUROVEON's own source (endlesss/core.constants.h,
// cScaleNames), not guessed. 0-17 index covering the 7 diatonic modes plus
// pentatonic/blues/whole-tone/chromatic scales Endlesss also supports.
// "Major (Ionian)"/"Minor (Aeolian)" get their common pop name alongside the
// mode name; every other entry is OUROVEON's own exact string, used verbatim.
export const RIFF_LIBRARY_SCALE_NAMES = [
  'Major (Ionian)',
  'Dorian',
  'Phrygian',
  'Lydian',
  'Mixolydian',
  'Minor (Aeolian)',
  'Locrian',
  'Minor Pentatonic',
  'Major Pentatonic',
  'Suspended Pent.',
  'Blues Minor Pent.',
  'Blues Major Pent.',
  'Harmonic Minor',
  'Melodic Minor',
  'Double Harmonic',
  'Blues',
  'Whole Tone',
  'Chromatic'
] as const

/** Resolves a Root/Scale pair to a display string like "E Minor (Aeolian)" --
 * returns undefined for anything out of the known range (including null,
 * which means "no key metadata for this riff") rather than guessing or
 * showing a raw number. */
export function resolveKeyName(root: number | null, scale: number | null): string | undefined {
  if (root === null || scale === null) return undefined
  const rootName = RIFF_LIBRARY_ROOT_NAMES[root]
  const scaleName = RIFF_LIBRARY_SCALE_NAMES[scale]
  if (!rootName || !scaleName) return undefined
  return `${rootName} ${scaleName}`
}
