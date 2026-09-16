// src/renderer/src/audio/discoverRifffAssembly.ts
import { stemKey, type Rifff, type Stem } from '@shared/types'

/** One stem to include in an assembled Discover rifff, paired with its own
 * committed gain (0-1) -- gain lives OUTSIDE the Stem/Rifff shape itself
 * (there's no such field on either), carried the same way every other
 * placed stem's own gain already is: a separate vol map keyed by
 * stemKey(groupId, slot), built alongside the rifff by this same function
 * (see DiscoverRifffAssembly.vol below). `stem` omits `slot` deliberately
 * -- assembleDiscoverRifff always assigns slots itself, 1-indexed in the
 * given member order, so a caller's own placeholder value (if any) would
 * just be silently overwritten; omitting the field entirely avoids that
 * footgun. */
export interface DiscoverRifffMember {
  stem: Omit<Stem, 'slot'>
  gain: number
}

export interface DiscoverRifffAssembly {
  rifff: Rifff
  /** stemKey(rifff.groupId, slot) -> that member's own gain, for every
   * member included in `rifff.stems` -- ready to merge directly into
   * whatever AppState.vol the caller is building (PLACE_LOOP_ON_TIMELINE's
   * own vol param, or a throwaway preview AppState). */
  vol: Record<string, number>
}

// Real-Rifff.stems can only ever address 8 slots (StemCID_1..8 is the
// schema every OTHER rifff in this app -- LORE-imported or hand-built --
// is already bound by, see riffLibrarySchema.ts) -- caps at the first 8
// given members (in their own given order) rather than silently producing
// a Rifff no other part of this codebase's own wire format could
// represent. Originally plunkInArranger's own MAX_STEMS_PER_RIFFF
// constant, moved here now that this is the one place that actually
// builds a Discover rifff.
const MAX_STEMS_PER_RIFFF = 8

/** Assembles one throwaway `Rifff` from a list of already-resolved Discover
 * slot members -- one stem per member, 1-indexed slots in the given order,
 * capped at 8. The rifff's own `barLength` is set to the LONGEST included
 * member's own `stem.barLength`, while each STEM keeps its own real,
 * unstretched barLength unchanged -- exactly the shape a normal multi-bar-
 * length rifff already has, so the SAME tiling machinery every other
 * placed rifff already uses (StemWaveformRow.tsx/CollapsedRifffRow.tsx's
 * tileOffsetsPx on the display side, LoopSewing.cpp on the native engine
 * side) tiles the shorter stems to fill the group for free -- no new
 * looping logic needed here, just correct grouping. `name`/`bpm` are
 * passed through verbatim -- this function has no opinion on what a
 * caller wants either to be.
 *
 * Used by BOTH plunkInArranger (the real, committed placement -- see
 * DiscoverPanel.tsx) and the engine-preview sync (an ephemeral, never-
 * persisted throwaway project) -- extracted here specifically so there's
 * one tested implementation instead of two untested inline copies, per
 * design spec docs/superpowers/specs/2026-09-15-discover-native-engine-
 * preview-design.md.
 *
 * Returns null for an empty `members` list (nothing to assemble) --
 * callers are expected to have already filtered down to placeable/
 * resolved members before calling this; this null case exists so a caller
 * doesn't need to duplicate that same empty-check itself.
 *
 * `maxMembers` defaults to MAX_STEMS_PER_RIFFF (8) -- the right default for
 * plunkInArranger's own call, whose output becomes a REAL, persisted
 * `Rifff` genuinely bound to Riffs.StemCID_1..8's own schema. Real bug,
 * live-reported 2026-09-16: the engine-preview sync call (syncPreviewToEngine,
 * DiscoverPanel.tsx) used to share that SAME default, even though its own
 * output is a throwaway, never-persisted preview project with no such
 * schema constraint -- a 9th+ Discover slot toggled into the preview mix
 * was silently dropped from the actual audio sent to the engine while
 * still showing as resolved/toggled-on in the UI ("i can only hear the
 * last stem if i solo it"). That call site now passes an explicit, much
 * higher `maxMembers` -- see its own call site for the reasoning.
 *
 * `barLengthOverride`, when given, replaces the normal max-of-included-
 * members computation entirely. Real bug, live-reported 2026-09-16:
 * "sometimes soloing or muting causes the discover loop to restart from
 * the beginning." Root cause: `members` here is always just the
 * CURRENTLY toggled-on (previewingSlotIds) slots, so the default
 * Math.max(...) barLength shrinks or grows every time a slot is
 * muted/soloed -- and that barLength is sent straight to the native
 * engine's `setLoopLengthBars` on every resulting `load-project` call,
 * which wraps/resets playback position when the loop length changes out
 * from under it. plunkInArranger's own call (a real, persisted
 * placement, where the clip's length SHOULD reflect exactly what's in
 * it) intentionally leaves this unset; syncPreviewToEngine passes a
 * stable override computed from every resolved slot regardless of
 * mute/solo state, so the loop length the engine sees never moves just
 * because a toggle changed which slots are currently included. */
export function assembleDiscoverRifff(
  name: string,
  members: DiscoverRifffMember[],
  bpm: number,
  maxMembers: number = MAX_STEMS_PER_RIFFF,
  barLengthOverride?: number
): DiscoverRifffAssembly | null {
  if (members.length === 0) return null

  const capped = members.slice(0, maxMembers)
  const groupId = crypto.randomUUID()
  const barLength = barLengthOverride ?? Math.max(...capped.map((m) => m.stem.barLength))

  const rifff: Rifff = {
    groupId,
    name,
    bpm,
    barLength,
    folderPath: '',
    stems: capped.map(({ stem }, i) => ({ ...stem, slot: i + 1 }))
  }

  // Each member's own gain, passed straight through -- NOT scaled by
  // sqrtGain(capped.length) or anything else. A brief 2026-09-16 revision
  // added that scaling (matching Browse's own auto-preview, which
  // compensates for combined loudness as more stems join a mix) to fix a
  // real "discover audio is louder than the browse preview" report --
  // but it meant the visible per-slot gain control (drag-on-waveform in
  // DiscoverSlotRow) no longer directly determined what you actually
  // heard: the SAME displayed gain produced different real loudness
  // depending on how many other slots happened to be toggled on, an
  // invisible second multiplier layered underneath the one real control.
  // Reverted same day, direct follow-up: "the volumes of the loaded
  // stems as they are played should be adjusted using that volume adjust
  // instead of a secret hidden one." What you see on the waveform is
  // what you hear, full stop -- the earlier loudness-matching goal was
  // real but secondary to that.
  const vol: Record<string, number> = {}
  capped.forEach(({ gain }, i) => {
    vol[stemKey(groupId, i + 1)] = gain
  })

  return { rifff, vol }
}
