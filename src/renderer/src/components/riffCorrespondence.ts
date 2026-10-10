import type { Rifff, Stem } from '@shared/types'

/** The stable audio identity of one stem across ordinary riff copies and
 * immutable re-one bakes. A bake changes `path`, but records the original
 * material in `phaseSourcePath`, so copies still point back to the same
 * source without coupling their editable phase state. */
function correspondencePath(stem: Stem): string {
  return stem.phaseSourcePath ?? stem.path
}

/** Content identity used only for hover correspondence. It deliberately
 * ignores groupId, placement, name, gain, and played length: those are
 * instance-specific. Exact slot order plus source audio keeps a partial
 * remix/Discover variation from being mistaken for another copy of the
 * same riff. */
export function riffCorrespondenceKey(rifff: Rifff): string {
  return JSON.stringify(
    [...rifff.stems]
      .sort((left, right) => left.slot - right.slot)
      .map((stem) => [stem.slot, correspondencePath(stem)])
  )
}
