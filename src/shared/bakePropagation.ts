import type { Rifff } from './types'

/**
 * A downbeat correction is a fact about a FILE, not about a clip.
 *
 * Auto-arrange's `pasteStemWindowAction` (selectors.ts) mints a fresh
 * `crypto.randomUUID()` per window-copy and shallow-copies the stem
 * (`{ ...stem }`), so one source rifff becomes N single-stem rifffs with N
 * distinct groupIds all pointing at ONE file on disk -- PASTE_RIFFF's own
 * reducer comment says so outright ("new groupId, same stem file paths --
 * no audio is actually duplicated on disk"). But the re-one machinery is
 * keyed by groupId: `state.off[groupId]`, and APPLY_BAKE used to repoint
 * only `action.groupId`. So re-picking a downbeat reached exactly one clip
 * out of the N that share the audio, and the rest were either left pointing
 * at the unrotated original or left drawing a file that had been rotated
 * out from under them.
 *
 * This is the lookup that closes that gap: given the paths a bake actually
 * rewrote, which clips are made of that audio.
 *
 * Returns groupIds in `rifffs` key order, each at most once however many of
 * its stems matched.
 */
export function groupIdsSharingStemPaths(
  rifffs: Readonly<Record<string, Rifff>>,
  paths: Iterable<string>
): string[] {
  const wanted = new Set(paths)
  if (wanted.size === 0) return []
  const out: string[] = []
  for (const [groupId, rifff] of Object.entries(rifffs)) {
    if (rifff.stems.some((stem) => wanted.has(stem.path))) out.push(groupId)
  }
  return out
}

/**
 * How many clips on the timeline a downbeat pick on `groupId` will move --
 * what the beat picker tells the user before they commit, so "one
 * adjustment moves them all" is something they can see rather than
 * something they have to trust.
 *
 * Placed clips only (`startBar !== undefined`): a shelf copy is repointed
 * too, but "clips" in the app's own vocabulary means things on the
 * timeline, and counting invisible ones would just make the number look
 * wrong.
 */
export function placedClipsSharingStems(
  rifffs: Readonly<Record<string, Rifff>>,
  groupId: string
): number {
  const source = rifffs[groupId]
  if (!source) return 0
  const paths = source.stems.map((stem) => stem.path)
  return groupIdsSharingStemPaths(rifffs, paths).filter((id) => rifffs[id].startBar !== undefined)
    .length
}
