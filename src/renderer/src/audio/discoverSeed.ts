import { resolveStemRole } from '@shared/stemRole'
import type { Stem } from '@shared/types'
import {
  freshSlotId,
  type DiscoverSlot,
  type ResolvedCandidateStem
} from '../components/DiscoverPanel'
import type { DiscoverCandidate } from '../../../main/discoverCandidates'

// A real Rifff can only ever have 8 stems (StemCID_1..8, see
// riffLibrarySchema.ts) -- caps defensively at the same number
// discoverRifffAssembly.ts's own MAX_STEMS_PER_RIFFF already enforces on
// the way back OUT of Discover, so seeding never produces more slots than
// a "plunk in arranger" could ever turn back into a single rifff anyway.
const MAX_SEED_SLOTS = 8

/** Builds Discover's replacement slots from a list of already-resolved,
 * local Stem objects -- the Shelf-sourced seed path (a Shelf riff is
 * already a real `Rifff` with real local Stem data, `state.rifffs`, no
 * network/resolution step needed at all). Each stem becomes one slot with
 * `seedStem` set (DiscoverSlotRow, per a later task, treats a slot with
 * `seedStem` as already resolved, skipping the normal candidate-based
 * resolution path entirely) and `candidate: null` (there is no
 * DiscoverCandidate to speak of -- a real placed/shelved Stem carries no
 * riffCID/stemCID at all).
 *
 * Role is inferred via `resolveStemRole` (the SAME heuristic
 * AutoArrangeRoleStep.tsx/ClusterStemsBrowser.tsx's own role-confirmation
 * pickers already use) with `busId: null` -- a Shelf/unplaced stem has no
 * channel/bus assignment yet (that only exists for PLACED rifffs), so this
 * always falls through to `resolveStemRole`'s own preset-name-guess-then-
 * soundType-fallback chain, never its busId shortcut.
 *
 * Every slot starts unlocked and `hasRerolled: true` (there is no
 * meaningful "hasn't rolled yet" state for a slot that already has real
 * content) and `gain: 1` (full volume, matching every other fresh slot's
 * own default). Returns `[]` for an empty input. */
export function buildSeedSlotsFromStems(stems: readonly Stem[]): DiscoverSlot[] {
  return stems.slice(0, MAX_SEED_SLOTS).map((stem) => {
    const seedStem: ResolvedCandidateStem = {
      author: stem.author,
      name: stem.name,
      type: stem.type,
      path: stem.path,
      durationSec: stem.durationSec,
      barLength: stem.barLength
    }
    const { arrangeRole } = resolveStemRole(stem, stem.path, null)
    return {
      id: freshSlotId(),
      role: arrangeRole,
      locked: false,
      candidate: null,
      hasRerolled: true,
      gain: 1,
      seedStem
    }
  })
}

/** Builds Discover's replacement slots from a list of unresolved
 * DiscoverCandidates -- the Browse-sourced seed path. Each candidate
 * becomes one slot with `candidate` set (the existing, UNCHANGED
 * DiscoverSlotRow resolution path handles it exactly like a normal roll's
 * own candidate -- same lazy per-row "downloading + analyzing…" state, same
 * caching). `arrangeRole` comes directly off the candidate (already
 * populated by whoever built it -- see LibraryBrowser.tsx's own
 * seed-triggering handler). Every slot starts unlocked and
 * `hasRerolled: true`, `gain: 1`, `seedStem: undefined` -- same defaults as
 * the Stems path above. Returns `[]` for an empty input. */
export function buildSeedSlotsFromCandidates(
  candidates: readonly DiscoverCandidate[]
): DiscoverSlot[] {
  return candidates.slice(0, MAX_SEED_SLOTS).map((candidate) => ({
    id: freshSlotId(),
    role: candidate.arrangeRole,
    locked: false,
    candidate,
    hasRerolled: true,
    gain: 1
  }))
}
