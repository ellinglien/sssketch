import { stemKey, type Rifff, type Stem } from '@shared/types'
import { SNAP_DIVS, type Action, type AppState, type ArrangerMode } from './store'

/** The played-bars override/fallback logic on its own, so a caller that
 * already has these two fields via individual selectors (see
 * useAppSelector, StoreContext.tsx) doesn't need a full AppState just to
 * call resolvePlayedBars. resolvePlayedBars below is now a thin wrapper
 * around this. */
export function resolvedPlayedBarsFromFields(
  playedBarsOverride: number | undefined,
  rifffBarLength: number
): number {
  return playedBarsOverride ?? rifffBarLength
}

/** A clip's own played length, in bars — the tiling loop's bound. Falls
 * back to rifff.barLength (today's implicit behavior) when no resize
 * override has been set. */
export function resolvePlayedBars(state: AppState, groupId: string): number {
  const rifff = state.rifffs[groupId]
  return resolvedPlayedBarsFromFields(state.playedBars[groupId], rifff.barLength)
}

export function stretchRatio(state: AppState, groupId: string): number {
  const rifff = state.rifffs[groupId]
  return state.bpm / rifff.bpm
}

export interface ClipGeometry {
  leftPx: number
  widthPx: number
}

export interface Channel {
  channelId: string
  rifffs: Rifff[]
}

/** Every channel that currently has at least one placed clip on it, in
 * top-to-bottom row order — the single source of truth Timeline renders
 * from (one ChannelRow per entry). Prefers state.channelOrder, falling back
 * to first-seen order for any channel it doesn't (yet) know about — same
 * defensive fallback placedRifffsInOrder always had for trackOrder. A
 * placed rifff with no channelOf entry at all falls back to its own groupId
 * as an implicit solo channel (matching PLACE_ON_TIMELINE's own "own groupId
 * as channel id" default elsewhere) rather than silently vanishing from the
 * arranger.
 *
 * Recording channels (state.recordingChannelIds) are also always included,
 * even with zero clips -- per
 * docs/superpowers/specs/2026-08-03-loop-recording-design.md, "a recording
 * channel with nothing recorded onto it yet still needs to exist and
 * render as an empty row with its own arm button," and the same is true
 * again any time its clip gets deleted/moved off later (recordingChannelIds
 * is exempted from the usual "evict when empty" cleanup elsewhere in the
 * reducer specifically so this channel survives that). Contributes an
 * empty rifffs array in that case, which flatMaps to nothing extra in
 * placedRifffsInOrder below -- safe for every other consumer of this
 * selector, which only ever cares about placed clips. */
export function channelsInOrder(state: AppState): Channel[] {
  const byChannel = new Map<string, Rifff[]>()
  for (const rifff of Object.values(state.rifffs)) {
    if (rifff.startBar === undefined) continue
    const channelId = state.channelOf[rifff.groupId] ?? rifff.groupId
    const list = byChannel.get(channelId)
    if (list) list.push(rifff)
    else byChannel.set(channelId, [rifff])
  }
  // Defense-in-depth de-dup: reducers (ADD_RECORDING_CHANNEL, SEQUENCE_RIFFFS
  // in store.ts) already guard against ever writing a duplicate entry into
  // channelOrder, but this is the layer that actually turns channelOrder
  // into the list App.tsx renders one <ChannelRow> per entry from -- if some
  // FUTURE reducer bug reintroduces a duplicate, filtering it back out here
  // means the render layer still can't produce two literal React elements
  // for the same channel (the "double images... left on the timeline" bug
  // class). filter()'s own seen-set doubles as the seed for the
  // first-seen-order fallback loop just below, so a channel that made it
  // into `ordered` is never re-added there either.
  const seen = new Set<string>()
  const ordered = state.channelOrder.filter((id) => {
    if (seen.has(id)) return false
    if (!(byChannel.has(id) || state.recordingChannelIds[id])) return false
    seen.add(id)
    return true
  })
  for (const channelId of byChannel.keys()) {
    if (!seen.has(channelId)) {
      ordered.push(channelId)
      seen.add(channelId)
    }
  }
  return ordered.map((channelId) => ({ channelId, rifffs: byChannel.get(channelId) ?? [] }))
}

/** Every placed rifff, flattened out of channelsInOrder — channel by
 * channel, top to bottom, then each channel's own clips in their array
 * order. Every OTHER selector that just wants "all placed rifffs, in
 * render order" (isSketchEligible, loopLengthBars, groupIdAtPosition)
 * keeps working unchanged against this, with no awareness of channels
 * needed at their level at all. */
export function placedRifffsInOrder(state: AppState): Rifff[] {
  return channelsInOrder(state).flatMap((channel) => channel.rifffs)
}

/**
 * True iff the current arrangement is "plain" enough for sketch mode: every
 * placed rifff is unfaded, with zero offset, AND the whole set —
 * sorted by startBar, not by placedRifffsInOrder's row-render order, which
 * is a DIFFERENT ordering — is perfectly contiguous starting at bar 0 with
 * no gaps or overlaps. An empty timeline is trivially eligible (starting a
 * fresh sketch is the common case, not an edge case). Mute and volume are
 * deliberately not checked — they don't affect positioning/sequencing
 * accuracy, only mix.
 *
 * A playedBars trim (state.playedBars[groupId]) does NOT disqualify a rifff
 * — sketch mode's own "how many bars does this tile play" control (see
 * SketchStrip's right-click menu) sets this same field, reusing the normal
 * arranger's resize-handle mechanism rather than inventing a second one. The
 * contiguity check below sums each rifff's PLAYED length, not its raw
 * barLength, to match: SEQUENCE_RIFFFS packs tiles the same way.
 *
 * Note there's no separate "track" concept in this data model beyond
 * trackOrder's render order — every placed rifff gets its own row
 * regardless of whether its bars overlap another's. Two rifffs both
 * starting at bar 0 (simultaneous playback, valid in Normal mode) correctly
 * fails this check, since sketch mode has no way to represent "two things
 * at once."
 */
export function isSketchEligible(state: AppState): boolean {
  const placed = placedRifffsInOrder(state)
  for (const rifff of placed) {
    if (state.fadeIn[rifff.groupId]) return false
    if (state.fadeOut[rifff.groupId]) return false
    if ((state.off[rifff.groupId] ?? 0) !== 0) return false
  }
  const sorted = [...placed].sort((a, b) => (a.startBar ?? 0) - (b.startBar ?? 0))
  let expectedStart = 0
  for (const rifff of sorted) {
    if (rifff.startBar !== expectedStart) return false
    expectedStart += state.playedBars[rifff.groupId] ?? rifff.barLength
  }
  return true
}

/** What Tab / the TransportBar's mode button should switch to next —
 * normal <-> sketch, staying on 'normal' when isSketchEligible(state) is
 * false, so the toggle never lands on a mode it can't actually show. */
export function nextArrangerMode(state: AppState): ArrangerMode {
  if (state.mode === 'sketch') return 'normal'
  return isSketchEligible(state) ? 'sketch' : 'normal'
}

/** Which placed rifff's [startBar, startBar + playedBars) range contains
 * `pos` — used by the sketch-mode Inspector auto-follow effect (App.tsx) to
 * find "whichever rifff is currently playing." Not sketch-mode-specific
 * itself, but its only caller lives in that world, where every placed rifff
 * is linked (see isSketchEligible) — so reading state.playedBars keyed
 * directly by groupId (rather than the slot-aware resolvePlayedBars) is
 * safe here specifically. */
export function groupIdAtPosition(state: AppState, pos: number): string | null {
  for (const rifff of placedRifffsInOrder(state)) {
    const start = rifff.startBar ?? 0
    const bars = state.playedBars[rifff.groupId] ?? rifff.barLength
    if (pos >= start && pos < start + bars) return rifff.groupId
  }
  return null
}

/** Fields clipGeometryFromFields needs -- an options object rather than a
 * long positional parameter list deliberately, matching this codebase's own
 * convention for functions like this (computeBandEnergy/computePitchContour/
 * computeStemSchedule in src/shared/ all take an opts object). Several of
 * these are same-typed and adjacent (three bare numbers up front, rifffBpm/
 * stateBpm next to each other later) -- exactly the shape where a positional
 * transposition would silently typecheck and produce a wrong-but-plausible
 * result, which is a real risk here specifically (the bpm-ratio direction is
 * already easy to get backwards, see clipGeometryFromFields's own comment). */
export interface ClipGeometryFields {
  startBar: number
  offsetSteps: number
  snapDiv: number
  playedBarsOverride: number | undefined
  /** Bars cropped from this clip's own left edge -- see leftCrop's own doc
   * comment on AppState (store.ts). 0 = no crop, the default for every
   * clip that's never had its left handle dragged. */
  leftCropBars: number
  rifffBarLength: number
  stretchOn: boolean
  rifffBpm: number
  stateBpm: number
  ppb: number
}

/** clipGeometry's own formula, parameterized by individual fields instead
 * of a full AppState -- so a caller that already has these fields via
 * individual selectors (see useAppSelector, StoreContext.tsx) doesn't need
 * a full AppState just to call it. clipGeometry below is now a thin wrapper
 * around this. */
export function clipGeometryFromFields(fields: ClipGeometryFields): ClipGeometry {
  const {
    startBar,
    offsetSteps,
    snapDiv,
    playedBarsOverride,
    leftCropBars,
    rifffBarLength,
    stretchOn,
    rifffBpm,
    stateBpm,
    ppb
  } = fields
  const offsetPx = (offsetSteps * ppb) / snapDiv
  const playedBars = resolvedPlayedBarsFromFields(playedBarsOverride, rifffBarLength)
  const visibleBars = playedBars - leftCropBars
  const shownBars = stretchOn ? visibleBars : visibleBars * (rifffBpm / stateBpm)
  return {
    leftPx: (startBar + leftCropBars) * ppb + offsetPx,
    widthPx: shownBars * ppb
  }
}

/** A clip's screen position/width. Uses resolvePlayedBars (which reflects
 * an active playedBars resize override) rather than raw rifff.barLength, so
 * a resized clip's rendered width actually matches its resize — this used
 * to only use rifff.barLength unconditionally, a real bug that stemGeometry
 * (now folded in here, since per-stem geometry divergence no longer exists
 * — see UNGROUP) used to work around for the expanded per-stem view only. */
export function clipGeometry(state: AppState, groupId: string, ppb: number): ClipGeometry {
  const rifff = state.rifffs[groupId]
  const start = rifff.startBar ?? 0
  const offsetSteps = state.off[groupId] ?? 0
  const snapDiv = SNAP_DIVS[state.snapIdx]
  const stretchOn = state.stretch[groupId] ?? true
  return clipGeometryFromFields({
    startBar: start,
    offsetSteps,
    snapDiv,
    playedBarsOverride: state.playedBars[groupId],
    leftCropBars: state.leftCrop[groupId] ?? 0,
    rifffBarLength: rifff.barLength,
    stretchOn,
    rifffBpm: rifff.bpm,
    stateBpm: state.bpm,
    ppb
  })
}

/** Pixel offsets for each repeat of a tiled clip's waveform image, shared by
 * StemWaveformRow.tsx (expanded view) and CollapsedRifffRow.tsx's own
 * CollapsedTiles (collapsed view) -- both previously duplicated this exact
 * formula. Extracted here (like clipGeometryFromFields already was) both for
 * testability and to fix the two independent copies with one change.
 *
 * A tile's own image always starts at its stem's sample 0 -- normally fine,
 * since tile 0 is drawn at the container's own left edge, which is exactly
 * where the stem's own audio starts too. But once leftCropBars != 0, the
 * container's left edge no longer sits at the stem's sample-0 point (it
 * sits leftCropBars bars into the stem's own repeating pattern instead) --
 * every tile needs to shift left by that same wrapped amount so the
 * CORRECT mid-loop content lands at the container's own pixel 0, matching
 * what actually plays (see PlaybackEngine.cpp's own analogous
 * sourceOffsetSec fix). Wrapped into [0, stemBarLength) first since a
 * crop amount doesn't need to exceed one stem-bar-length of phase shift --
 * shifting by a whole multiple of stemBarLength doesn't change which
 * content shows (every tile is identical content already).
 *
 * widthPx here is the ALREADY-CROPPED visible width (i.e. clipGeometry's
 * own widthPx) -- not the full uncropped playedBars width. */
export function tileOffsetsPx(
  widthPx: number,
  stemBarLength: number,
  playedBars: number,
  leftCropBars: number
): number[] {
  const visibleBars = playedBars - leftCropBars
  const tileWidthPx = widthPx * (stemBarLength / visibleBars)
  const wrappedLeftCropBars = ((leftCropBars % stemBarLength) + stemBarLength) % stemBarLength
  const phaseShiftPx = wrappedLeftCropBars * (tileWidthPx / stemBarLength)
  // +1 over the naive ceil, but only when tiles are actually shifted:
  // shifting every tile left by phaseShiftPx can leave a gap at the
  // container's own right edge that an extra tile is needed to cover.
  // Conditional (not unconditional) so the overwhelmingly common
  // leftCropBars=0 case keeps rendering exactly the same tile count as
  // before this feature existed, instead of one permanently-harmless-but-
  // unnecessary extra tile on every clip that's never had its left edge
  // touched.
  const tileCount = Math.max(1, Math.ceil(widthPx / tileWidthPx) + (phaseShiftPx > 0 ? 1 : 0))
  return Array.from({ length: tileCount }, (_, i) => i * tileWidthPx - phaseShiftPx)
}

const DEFAULT_LOOP_BARS = 32

/** Loop length auto-fits to whichever placed clip ends latest, falling back to a
 * sensible default when the timeline is empty rather than collapsing to 0. */
export function loopLengthBars(state: AppState): number {
  const ends: number[] = []
  for (const rifff of Object.values(state.rifffs)) {
    if (rifff.startBar === undefined) continue
    const playedBars = resolvePlayedBars(state, rifff.groupId)
    ends.push(rifff.startBar + playedBars)
  }
  return ends.length === 0 ? DEFAULT_LOOP_BARS : Math.max(...ends)
}

/**
 * Converts a beat index clicked on the beat-picker (0 = the very start of the
 * stem's own audio, counting quarter-note beats forward from there) into the
 * offsetSteps value that makes that beat land exactly on the clip's timeline
 * start. offsetSteps shifts the clip's start time (see computeStemSchedule), so
 * lining up a beat that occurs `k` beats into the buffer requires shifting the
 * clip's start `k` beats *earlier* — hence the negation.
 */
export function offsetStepsForBeatIndex(beatIndex: number, snapDiv: number): number {
  // `|| 0` normalizes -0 (beatIndex 0 negated) to 0 — an exact match matters here
  // since this value is compared/displayed directly, not just used arithmetically.
  return -Math.round((beatIndex * snapDiv) / 4) || 0
}

/**
 * Where a stem's true downbeat sits within its own audio, in seconds — the inverse
 * of offsetStepsForBeatIndex, used to "bake" a beat-picker correction permanently
 * into the audio file instead of only shifting playback timing.
 *
 * All stems in a linked group are beat-locked to the same clock, so the same
 * bars-into-the-loop fraction (kBars) applies to every stem — just scaled by that
 * stem's own duration/barLength, and wrapped by its own (possibly shorter, tiling)
 * loop length rather than the rifff's.
 */
export function rotationSecondsForStem(offsetSteps: number, snapDiv: number, stem: Stem): number {
  const kBars = -offsetSteps / snapDiv
  const wrapped = ((kBars % stem.barLength) + stem.barLength) % stem.barLength
  return wrapped * (stem.durationSec / stem.barLength)
}

/**
 * Builds a PASTE_RIFFF action that places an independent copy of `sourceGroupId`
 * at `startBar` — a fresh groupId, the same stem file paths (no audio is actually
 * duplicated on disk; multiple rifff instances can safely share source files for
 * playback/waveform purposes), with volume and mute carried over from the
 * source. Returns null if the source no longer exists (e.g. copied, then
 * deleted before pasting).
 *
 * Sharing file paths does have one real edge: if two pasted copies are each
 * later independently re-baked (BeatPicker) with different downbeat picks,
 * their bakes target the same derived `.baked.wav` sibling file and the second
 * one wins on disk — a narrow, deliberate scope trade-off rather than adding a
 * file-copy step to every paste.
 */
export function pasteRifffAction(
  state: AppState,
  sourceGroupId: string,
  startBar: number
): Action | null {
  const source = state.rifffs[sourceGroupId]
  if (!source) return null

  const newGroupId = crypto.randomUUID()
  const stems = source.stems.map((s) => ({ ...s }))
  const rifff: Rifff = { ...source, groupId: newGroupId, stems, startBar }

  const vol: Record<string, number> = {}
  const mute: Record<string, boolean> = {}
  for (const stem of source.stems) {
    const oldKey = stemKey(sourceGroupId, stem.slot)
    const newKey = stemKey(newGroupId, stem.slot)
    if (state.vol[oldKey] !== undefined) vol[newKey] = state.vol[oldKey]
    if (state.mute[oldKey] !== undefined) mute[newKey] = state.mute[oldKey]
  }

  return {
    type: 'PASTE_RIFFF',
    rifff,
    vol,
    mute,
    off: { [newGroupId]: state.off[sourceGroupId] ?? 0 },
    stretch: state.stretch[sourceGroupId] ?? true
  }
}

/**
 * Builds a PASTE_RIFFF action for duplicating a SINGLE stem — cmd/ctrl-drag on
 * an unlinked stem's own waveform, the per-stem equivalent of pasteRifffAction's
 * whole-clip duplicate. There's no way to represent "the same stem slot twice,
 * at two different times" within one rifff (linked or not — a stem's slot is
 * unique per rifff), so this always creates a fresh, independent single-stem
 * rifff rather than adding a second instance to the source's own stems array.
 * It lands as its own new row (same as any other paste), not literally
 * "inside" the source's row.
 *
 * barLength is set to resolvePlayedBars' current resolved length, not
 * rifff.barLength — that's what makes this "duplicate it, OR a portion of
 * it": if the source stem is currently resized/trimmed, the copy's own full
 * extent IS that trimmed length, not the untrimmed original. Shares the
 * source's own audio file path — see pasteRifffAction's doc comment for the
 * same "no audio is actually duplicated on disk" tradeoff and its one edge
 * (independent re-bakes of two copies sharing a path race on the same
 * `.baked.wav` sibling).
 */
export function pasteStemAction(
  state: AppState,
  sourceGroupId: string,
  slot: number,
  startBar: number
): Action | null {
  const source = state.rifffs[sourceGroupId]
  if (!source) return null
  const stem = source.stems.find((s) => s.slot === slot)
  if (!stem) return null

  const newGroupId = crypto.randomUUID()
  const rifff: Rifff = {
    groupId: newGroupId,
    name: stem.name,
    bpm: source.bpm,
    barLength: resolvePlayedBars(state, sourceGroupId),
    folderPath: source.folderPath,
    startBar,
    stems: [{ ...stem }]
  }

  const oldKey = stemKey(sourceGroupId, slot)
  const newKey = stemKey(newGroupId, slot)
  const vol: Record<string, number> = {}
  const mute: Record<string, boolean> = {}
  if (state.vol[oldKey] !== undefined) vol[newKey] = state.vol[oldKey]
  if (state.mute[oldKey] !== undefined) mute[newKey] = state.mute[oldKey]

  return {
    type: 'PASTE_RIFFF',
    rifff,
    vol,
    mute,
    off: { [newGroupId]: state.off[sourceGroupId] ?? 0 },
    stretch: state.stretch[sourceGroupId] ?? true
  }
}
