// src/shared/discoverCandidate.ts
import type { DrumSubRole } from './stemRole'
import type { DiscoverKindSources, DiscoverSlotKind } from './discoverSlotKind'
import type { TraitFieldValues, TraitValues } from './discoverTraits'
import type { TraitPercentiles } from './traitQuantiles'

/** One library-wide candidate for a Discover slot.
 *
 * For a MASK slot kind (drums/bass/lead -- DISCOVER_MASK_SLOT_KINDS), a
 * candidate comes from one of three sources (getMaskKindStemMasks, below):
 * human-confirmed (StemCategories) for the requested kind's own
 * ArrangeRole, any mask; its own Endlesss instrument category maps to that
 * kind (real ground truth, no confirmation needed); or -- ONLY for a stem
 * the mask can't place (no mask, or audio-in) -- the overnight classify
 * scan's own guess (StemAutoCategory, stemAutoClassify.ts). That last
 * source was dropped for mask kinds on 2026-09-18 and restored, scoped to
 * unplaceable stems, on 2026-09-22 (direct request: audio-in/mic stems
 * never appeared under drums/bass/lead). The endlesss/non-endlesss
 * source filter then filters the whole pool by each stem's own mask.
 *
 * For a TRAIT-ONLY slot kind set (bassHeavy/rhythmic/bright/warm), see
 * getTraitPoolCandidates -- any stem with a cached StemFeatureCache row,
 * tagged or not (combination slots, 2026-09-21 -- see
 * getDiscoverCandidates's own doc comment for the full combination-slot
 * rule, including why a mask+trait set is no longer a disjoint pool from
 * a mask-only one). */
export interface DiscoverCandidate {
  stemCID: string
  jamCID: string
  riffCID: string
  presetName: string
  creatorUserName: string
  /** The slot's own normalized kind set this candidate was drawn for
   * (normalizeSlotKinds) -- combination slots, 2026-09-21. */
  slotKinds: DiscoverSlotKind[]
  drumSubRole: DrumSubRole | null
  /** The OWNING RIFF's own BPM (Riffs.BPMrnd) -- the compatibility signal
   * this plan's own ranking (Task 3) actually scores against, since a
   * riff's BPM is always populated, unlike a stem's own (Stems.BPMrnd is
   * frequently null in real data -- LORE's own resolveRiff falls back to
   * the riff's BPM for exactly this reason, riffLibraryTypes.ts). */
  riffBpm: number
  /** Raw StemFeatureCache field value per requested TRAIT kind, for
   * rankCandidates' trait terms. {} when the slot has no trait kinds or the
   * stem has no cached features. */
  traitValues: TraitValues
  /** Raw values of each requested trait kind's preferred AND fallback
   * StemFeatureCache fields (Phase 3 of the 2026-09-22 spec) -- what
   * library percentiles are looked up from, and what rankCandidates'
   * pool-relative fallback uses so a pool mixing re-extracted and old rows
   * stays on one scale. Absent wherever traitValues is {}. */
  traitFieldValues?: TraitFieldValues
  /** Library-wide percentile per requested TRAIT kind, [0, 1], already
   * direction-adjusted (@shared/traitQuantiles) -- what applyTraitBar and
   * rankCandidates actually use. {} when the slot has no trait kinds or
   * the stem has no values; null per kind when unknown. */
  traitPercentiles: TraitPercentiles
  /** Per MASK kind of the slot that admitted this stem, which rule did it
   * (docs/superpowers/specs/2026-09-22-discover-promise-vs-delivery-
   * design.md, Phase 2 -- the slot's match meter): 'confirmed' (a human
   * StemCategories row for the kind's role -- always wins), 'tag' (the
   * Endlesss instrument mask), 'guess' (the overnight classifier, only for
   * stems the mask can't place). {} for trait-only sets and every non-
   * mask-pool constructor (random/adjacency/seeded). */
  kindSources: DiscoverKindSources
  /** The OWNING RIFF's own creation time (Riffs.CreationTime, Unix
   * seconds) -- same "riff-level, not stem-level, since it's always
   * populated" rationale as riffBpm above. Copied onto the eventual placed
   * Stem's own `creationTime` once this candidate is committed to the
   * shelf/timeline (see @shared/types's Stem.creationTime doc comment for
   * why THAT field is per-stem). Direct request, 2026-09-20: "date could
   * be a tooltip on hover.. in discovery and in arranger or sketch." */
  riffCreationTime: number | null
}
