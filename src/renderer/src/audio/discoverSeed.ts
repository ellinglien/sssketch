import type { SoundType, Stem } from '@shared/types'
import { normalizeSlotKinds, type DiscoverSlotKind } from '@shared/discoverSlotKind'
import {
  freshSlotId,
  type DiscoverSlot,
  type ResolvedCandidateStem
} from '../components/DiscoverPanel'
import type { DiscoverCandidate } from '../../../main/discoverCandidates'

/** Best-effort DiscoverSlotKind for a stem's own SoundType -- used by both
 * seed paths in this file (Shelf-sourced and, via LibraryBrowser.tsx,
 * Browse-sourced). A real Endlesss instrument mask reliably identifies
 * drums/bass/notes (see reliableMaskSoundType, stemAutoClassify.ts, for
 * the same real-data finding this mirrors); everything else -- audioIn,
 * fx, extInst, sampler, extFx -- has no reliable mask-kind signal, so it
 * falls back to a single fixed trait kind rather than guessing, same
 * "cheap and fast over exactly right" tradeoff as DiscoverPanel.tsx's own
 * external-sample-import default (see that file's own doc comment on why
 * 'bright' specifically). */
export function discoverSlotKindForSoundType(soundType: SoundType): DiscoverSlotKind {
  if (soundType === 'drums') return 'drums'
  if (soundType === 'bass') return 'bass'
  if (soundType === 'notes') return 'lead'
  return 'bright'
}

// A real Rifff can only ever have 8 stems (StemCID_1..8, see
// riffLibrarySchema.ts) -- caps defensively at the same number
// discoverRifffAssembly.ts's own MAX_STEMS_PER_RIFFF already enforces on
// the way back OUT of Discover, so seeding never produces more slots than
// a "plunk in arranger" could ever turn back into a single rifff anyway.
const MAX_SEED_SLOTS = 8

/** Whether any slot in a Discover loop is real, meaningful content worth
 * confirming before destroying/worth reopening onto the 'discover' tab for
 * -- NOT the same check as `s.candidate !== null` alone, which misses
 * every seedStem-only slot (Shelf-sourced, `candidate: null` by design --
 * see buildSeedSlotsFromStems' own doc comment above). Real bug, found in
 * code review, 2026-09-17: two fresh call sites (App.tsx's own
 * openRiffLibraryWithDiscoverSeed overwrite guard, and LibraryBrowser.tsx's
 * own libraryMode initial-tab check) used the narrower `candidate !== null`
 * form, which silently treated a Shelf-seeded, never-rerolled loop as
 * "empty" -- reopening Discover after seeding from Shelf landed on the
 * 'browse' tab instead of 'discover', and seeding from a DIFFERENT Shelf
 * riff while one was already in progress skipped the confirm-before-
 * overwrite dialog entirely. The correct predicate (`candidate !== null ||
 * seedStem !== undefined`) already existed once, in DiscoverPanel.tsx's
 * own `placeable` filter (a direct report, 2026-09-16, fixed the identical
 * class of bug for "add to timeline"/"add to shelf") -- this is that same
 * check, shared, so it can't drift out of sync across call sites again. */
export function discoverHasRealContent(slots: readonly DiscoverSlot[]): boolean {
  return slots.some((s) => s.candidate !== null || s.seedStem !== undefined)
}

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
 * Kind is inferred directly from the stem's own `SoundType` via
 * `discoverSlotKindForSoundType` -- NOT `resolveStemRole` (the heuristic
 * AutoArrangeRoleStep.tsx/ClusterStemsBrowser.tsx's own role-confirmation
 * pickers use for Tidy Up, untouched elsewhere): Discover's own matching
 * wants a direct mask-kind/trait-kind split, not Tidy Up's role guess.
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
    return {
      id: freshSlotId(),
      kinds: [discoverSlotKindForSoundType(stem.type)],
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
 * caching). `kinds` comes directly off the candidate's own `slotKinds`
 * (already populated by whoever built it -- see LibraryBrowser.tsx's own
 * seed-triggering handler), normalized here so a candidate built before
 * normalization existed (or an out-of-order/duplicate set) still lands as
 * a canonical slot kind set. Every slot starts unlocked and
 * `hasRerolled: true`, `gain: 1`, `seedStem: undefined` -- same defaults as
 * the Stems path above. Returns `[]` for an empty input. */
export function buildSeedSlotsFromCandidates(
  candidates: readonly DiscoverCandidate[]
): DiscoverSlot[] {
  return candidates.slice(0, MAX_SEED_SLOTS).map((candidate) => ({
    id: freshSlotId(),
    kinds: normalizeSlotKinds(candidate.slotKinds),
    locked: false,
    candidate,
    hasRerolled: true,
    gain: 1
  }))
}
