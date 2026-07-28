import { stemKey, type Rifff, type Stem } from '@shared/types'
import { SNAP_DIVS, type Action, type AppState } from './store'

export function resolveOffsetKey(state: AppState, groupId: string, slot: number): string {
  return state.unlinked[groupId] ? stemKey(groupId, slot) : groupId
}

export function stretchRatio(state: AppState, groupId: string): number {
  const rifff = state.rifffs[groupId]
  return state.bpm / rifff.bpm
}

export interface ClipGeometry {
  leftPx: number
  widthPx: number
}

export function clipGeometry(state: AppState, groupId: string, ppb: number): ClipGeometry {
  const rifff = state.rifffs[groupId]
  const start = rifff.startBar ?? 0
  const offsetSteps = state.off[groupId] ?? 0
  const snapDiv = SNAP_DIVS[state.snapIdx]
  const offsetPx = (offsetSteps * ppb) / snapDiv
  const stretchOn = state.stretch[groupId] ?? true
  const shownBars = stretchOn ? rifff.barLength : rifff.barLength * (rifff.bpm / state.bpm)
  return { leftPx: start * ppb + offsetPx, widthPx: shownBars * ppb }
}

/** A stem's own position — independent of its group's once unlinked and dragged,
 * falling back to the group's startBar otherwise (before any drag, or while still
 * linked). */
export function stemStartBar(state: AppState, groupId: string, slot: number): number {
  const rifff = state.rifffs[groupId]
  if (state.unlinked[groupId]) {
    return state.stemStart[stemKey(groupId, slot)] ?? rifff.startBar ?? 0
  }
  return rifff.startBar ?? 0
}

/** Same shape as clipGeometry, anchored to the stem's own position instead of its
 * group's — identical to clipGeometry while linked (or before a drag), diverging
 * once unlinked and moved. */
export function stemGeometry(
  state: AppState,
  groupId: string,
  slot: number,
  ppb: number
): ClipGeometry {
  const rifff = state.rifffs[groupId]
  const start = stemStartBar(state, groupId, slot)
  const offsetSteps = state.off[resolveOffsetKey(state, groupId, slot)] ?? 0
  const snapDiv = SNAP_DIVS[state.snapIdx]
  const offsetPx = (offsetSteps * ppb) / snapDiv
  const stretchOn = state.stretch[groupId] ?? true
  const shownBars = stretchOn ? rifff.barLength : rifff.barLength * (rifff.bpm / state.bpm)
  return { leftPx: start * ppb + offsetPx, widthPx: shownBars * ppb }
}

const DEFAULT_LOOP_BARS = 32

/** Loop length auto-fits to whichever placed clip ends latest, falling back to a
 * sensible default when the timeline is empty rather than collapsing to 0. An
 * unlinked stem dragged out past its group's own span must count too, or it would
 * fall outside the loop and never be reached during playback. */
export function loopLengthBars(state: AppState): number {
  const ends: number[] = []
  for (const rifff of Object.values(state.rifffs)) {
    if (rifff.startBar === undefined) continue
    if (state.unlinked[rifff.groupId]) {
      for (const stem of rifff.stems) {
        ends.push(stemStartBar(state, rifff.groupId, stem.slot) + rifff.barLength)
      }
    } else {
      ends.push(rifff.startBar + rifff.barLength)
    }
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
