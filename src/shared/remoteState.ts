// src/shared/remoteState.ts
import type { SoundType } from './types'
import type { CoachSlotSnapshot } from './coachClimax'
import {
  DISCOVER_SLOT_KIND_OPTIONS,
  normalizeSlotKinds,
  slotKindsLabel,
  type DiscoverSlotKind
} from './discoverSlotKind'
import { quantiseRemotePeaks } from './remotePeaks'

/** One row on the phone. `id` is Discover's own slot id -- needed so a tap
 * can reroll THAT slot, and not a filesystem path. There is deliberately
 * nothing else here: no path, no CID, no bpm, nothing about the library. */
export interface RemoteSlotView {
  id: string
  kindLabel: string
  stemName: string
  soundType: SoundType | null
  /** Not in Discover's audible preview mix. Inverted from
   * CoachSlotSnapshot's own `audible` HERE, once, rather than on the page:
   * the guided flow asks "is this in the mix", the phone shows a mute
   * state, and the page should not have to invert it at four call sites. */
  muted: boolean
  /** The only slot left in the audible mix. Not a mode the Mac remembers --
   * Discover deliberately keeps no soloed-slot id (see toggleSlotSolo) --
   * but the state a solo LEAVES, computed here the same way toggleSlotSolo
   * computes it: audible, and the only one that is. The phone needs it to
   * know which third of a row's tap cycle it is in (audible -> solo ->
   * mute -> audible), and for nothing else. It draws no mark of its own:
   * with every other row's colour gone, one coloured row among grey ones
   * already IS the picture of a solo, and a soloed row is not
   * distinguishable from a mix you muted by hand because it is the same
   * mix. */
  soloed: boolean
  /** 64 integers, 0..100, for this row's own waveform -- or null when the
   * stem has not been analysed yet. Quantised by quantiseRemotePeaks
   * (@shared/remotePeaks) from peaks the Mac's own Discover rows already
   * computed (peakCache.ts). Amplitude buckets are not a path, do not
   * identify a file and cannot be turned back into one, so this does not
   * widen the boundary this function IS. */
  peaks: number[] | null
}

/** What radio is about to do, as much of it as the phone needs.
 *
 * Direct report, 2026-09-29, listening on radio: "i don't see any
 * preparatory blinking on the channels about to transition." The phone is
 * a per-stem mixer now, so the same "about to change" is worth exactly as
 * much on the sofa as it is at the desk -- see @shared/radioApproach for
 * the two states and why they are two.
 *
 * TWO FIELDS AND NO MORE. Slot ids the phone already has: nothing
 * here names a file, a riff or a jam, so this does not widen the boundary
 * remoteStateFromSlots IS.
 *
 * It carried a `progress` fraction until 2026-09-29, for a 2px rule the
 * page drew along the bottom of the row. Both ends of that are gone --
 * Elling, on the desktop version of the same rule: "can't it be the red
 * playhead indicator instead of a progress bar? that would streamline the
 * ui" -- and this page has had its own red playhead sweeping every row
 * since 2026-09-26, so the "when" was already on screen twice. The row
 * fades instead, and a fraction nothing draws would be a field nothing
 * reads.
 *
 * It also cost real traffic: the renderer pushes remote state on a
 * dependency change, and a progress that moved once a bar made this
 * object -- and with it every row's peaks -- re-derive and go over IPC on
 * that cadence. Two ids change when radio picks a different row, which is
 * a handful of times a minute. */
export interface RemoteRadioView {
  /** The row whose next pick is chosen and warming, or null. */
  armedSlotId: string | null
  /** The rows whose change is decided and waiting for the loop top:
   * radio's own held change, and every manual change queued while radio
   * runs (2026-09-29) -- the phone's taps on a waiting row are ignored, so
   * the row has to say it is waiting, exactly as the mac's does. */
  heldSlotIds: string[]
}

export interface RemoteState {
  /** False when Discover is not open on the Mac -- the page then says
   * "open discover on the mac" and offers nothing else. It does not
   * navigate the desktop app there; screen-driving was considered and
   * rejected by Elling in the arrangement-map work. */
  discoverOpen: boolean
  playing: boolean
  /** A run is a session. Both reset when the server does. No points, no
   * badges, no streaks. */
  kept: number
  rolled: number
  /** Flashed once under the counters as `kept · misty kestrel`. */
  lastKeptName: string | null
  /** How many bars long the loop the phone can fetch is, or 0 when the Mac
   * does not know yet -- nothing has resolved, so there is no length to
   * report.
   *
   * It is the SAME number the renderer hands the engine as
   * EngineProject.loopLengthBars (the longest resolved slot's bar length),
   * so the phone's bar grid and the engine's loop boundary are one grid by
   * construction rather than two derivations that happen to agree.
   *
   * The phone needs it for exactly one thing: turning "swap every 4 bars"
   * into seconds. It divides the decoded buffer's OWN duration by this,
   * never a bpm -- the buffer is the ground truth for what is sounding, and
   * a bpm on the wire would be a second copy of the same fact, free to
   * disagree with it. A count of bars is not sensitive: it identifies no
   * file, names no jam and cannot be turned back into a path. */
  loopBars: number
  /** Null whenever radio is not running, which is also what a Mac that
   * has nothing armed says. The phone marks no row at all for null. */
  radio: RemoteRadioView | null
  slots: RemoteSlotView[]
}

/** One row as GET /api/state actually answers it: the view the renderer
 * pushed, plus the id of that slot's own audio.
 *
 * `stemId` is deliberately NOT part of RemoteSlotView and is NOT produced by
 * remoteStateFromSlots -- same reason, and same shape, as loopId one level
 * up. The renderer's boundary function has never seen a resolvedPath and
 * still does not; main derives this from the EngineProject it holds, which
 * is full of real filesystem paths and never leaves the main process.
 *
 * Sixteen hex characters of a sha256 is what leaves. It is a lookup key into
 * a map main built, meaningless to anything that does not hold that map, and
 * GET /api/stem never concatenates it into a path -- so the no-path property
 * remoteState.test.ts asserts stays preserved by construction rather than by
 * care, even though the phone can now fetch audio one stem at a time.
 *
 * Null for a slot the Mac has no audio for right now: unresolved, or muted
 * (a muted slot is not in Discover's preview project at all). The phone
 * reads null as "the Mac is not naming one", never as "throw the audio
 * away" -- see remotePage's wantedStemId. */
export interface RemoteSlotResponse extends RemoteSlotView {
  stemId: string | null
}

/** What GET /api/state actually answers: the snapshot the renderer pushed,
 * plus the id of the loop the phone can fetch right now.
 *
 * `loopId` is deliberately NOT part of RemoteState and is NOT produced by
 * remoteStateFromSlots. The renderer does not know it -- main computes it
 * from the EngineProject Discover pushes over IPC, which is full of real
 * filesystem paths and never leaves the main process. Sixteen hex characters
 * of a sha256 is what leaves, and the no-path property remoteState.test.ts
 * asserts is preserved by construction rather than by care. */
export interface RemoteStateResponse extends RemoteState {
  loopId: string | null
  /** Discover artist mode (2026-10-01): the Mac is playing another user's
   * stems, listen only, so the phone's keep is off. Main-derived from its
   * own session mirror (discoverArtistSession.ts) -- the same thing the
   * keep guard reads -- like loopId, and for the same reason it is not in
   * what the renderer pushes. Optional: absent (an older Mac) reads as
   * false. A boolean names no user, so the boundary is unchanged. */
  listenOnly?: boolean
  slots: RemoteSlotResponse[]
}

export interface RemoteStateMeta {
  discoverOpen: boolean
  playing: boolean
  kept: number
  rolled: number
  lastKeptName: string | null
  /** The longest resolved slot's bar length -- the same expression
   * DiscoverPanel already feeds assembleDiscoverRifff's barLengthOverride
   * and the radio clock, read off resolvedBarLengthsRef for the same
   * reason (the ref is current; its reactive twin can be a render behind).
   * 0, or anything that is not a whole positive number of bars, means "not
   * known" and is normalized to 0 below. */
  loopBars: number
  /** Optional rather than required, and that is not laziness: radio not
   * running has genuinely nothing to say here, and `undefined` says
   * exactly that. Normalized below -- an id naming no row becomes null, so
   * what leaves is always drawable. */
  radio?: RemoteRadioView | null
}

/** The whole privacy boundary of Part 2, in one pure function: whatever
 * Discover's renderer knows, only these fields leave the Mac. An
 * unresolved slot keeps its row (with an empty name) rather than
 * disappearing -- the phone should show the shape of the loop he left on
 * screen, mid-roll included. */
export function remoteStateFromSlots(
  slots: readonly CoachSlotSnapshot[],
  meta: RemoteStateMeta,
  // Keyed by SLOT ID, never by path -- the caller has the paths and this
  // function deliberately still never sees one.
  peaksBySlotId?: ReadonlyMap<string, readonly number[]>
): RemoteState {
  // One slot left in the mix is what a solo leaves behind, and what
  // toggleSlotSolo itself tests for when it decides whether a second press
  // restores the full mix. A single-slot Discover therefore reads as
  // soloed, which is true rather than a special case: it is the only thing
  // audible, and soloing it on the Mac is already a no-op.
  const audibleCount = slots.reduce((count, slot) => count + (slot.audible ? 1 : 0), 0)
  return {
    discoverOpen: meta.discoverOpen,
    playing: meta.playing,
    kept: meta.kept,
    rolled: meta.rolled,
    lastKeptName: meta.lastKeptName,
    // Normalized HERE, once, rather than on the page: the phone reads 0 as
    // "hand over at the end of the loop", which is what it did before the
    // grid existed, so an unknown or nonsensical length can only ever
    // produce no grid -- never a wrong one.
    loopBars: Number.isInteger(meta.loopBars) && meta.loopBars > 0 ? meta.loopBars : 0,
    // Normalized HERE, once, for the same reason loopBars is: an id that
    // names no row is a mark the phone could never draw. It fails closed
    // -- no mark -- rather than being passed on for the page to guard
    // against.
    radio: normalizeRemoteRadio(meta.radio ?? null, slots),
    slots: slots.map((slot) => ({
      id: slot.id,
      kindLabel: slotKindsLabel(slot.kinds),
      stemName: slot.stem?.name ?? '',
      soundType: slot.stem?.type ?? null,
      muted: !slot.audible,
      soloed: slot.audible && audibleCount === 1,
      peaks: quantiseRemotePeaks(peaksBySlotId?.get(slot.id) ?? [])
    }))
  }
}

function normalizeRemoteRadio(
  radio: RemoteRadioView | null,
  slots: readonly CoachSlotSnapshot[]
): RemoteRadioView | null {
  if (radio === null) return null
  const known = (slotId: string | null): string | null =>
    slotId !== null && slots.some((slot) => slot.id === slotId) ? slotId : null
  return {
    armedSlotId: known(radio.armedSlotId),
    heldSlotIds: radio.heldSlotIds.filter((slotId) => known(slotId) !== null)
  }
}

/** Everything the phone can ask the Mac to do. SIX verbs, and nothing else:
 * no arranging, no timeline, no gain, no settings, no library browsing. The
 * phone can now set the shape of the loop as well as roll it.
 *
 * `slot-action` arrived on 2026-09-27 and is ONE verb carrying an enumerated
 * payload rather than six more verbs -- its six actions are the four
 * buttons already on every desktop Discover slot row plus that row's own
 * mute and its own solo, so the wire gains no operation Discover did not
 * already have.
 *
 * `add-slot`/`remove-slot` arrived on 2026-09-26, from real use: "the initial
 * state of the phone interface... how do i add a stem? it starts with zero
 * and no apparent way to add". Steering slots the Mac already has is no use
 * when Discover is empty, which is exactly when he is not at the Mac.
 *
 * Deliberately still NOT here, and each one can be pulled back later: the
 * matching dial, chaos, the source dial, favourites-only,
 * undo/redo, the adjacency popover itself (the phone gets its one-tap form,
 * not its browser), per-slot gain, the match meter. Every control competes
 * with the verbs that matter on a thumb-sized screen, and a reroll already
 * is undo on a phone.
 *
 * `transport` was here until 2026-09-26 and was removed on purpose when the
 * phone became an audio client. One button cannot mean two outputs, and the
 * phone's `play` now means the phone. The two outputs are independent by
 * Elling's own instruction ("phone audio distinct from the app") -- the phone
 * does not reach into the Mac's transport in either direction, and both
 * playing at once is intended rather than a bug. */
export type RemoteCommand =
  | { kind: 'roll-slot'; slotId: string }
  | { kind: 'roll-all' }
  | { kind: 'keep' }
  | { kind: 'add-slot'; kinds: DiscoverSlotKind[] }
  | { kind: 'remove-slot'; slotId: string }
  | { kind: 'slot-action'; slotId: string; action: RemoteSlotAction }

/** The six things a long press (or a tap, for `mute` and `solo`) on a phone
 * row can ask for. Four of them are the buttons that have been on every
 * desktop Discover slot row since 2026-09-20 -- `similar`, `adjacent`,
 * `random`, `duplicate` -- and the other two are that row's own mute and
 * its own solo, both of which the desktop row has had since 2026-09-15.
 * Nothing here is a new Discover operation; see docs/superpowers/specs/
 * 2026-09-27-stem-actions-and-phone-1a-design.md §1.1.
 *
 * `solo` arrived on 2026-09-27 from the first real iphone session ("could we
 * also add solo? first press is solo, then second press is mute / like
 * double tap"). It is toggleSlotSolo and nothing else: drop every other
 * slot out of the mix. */
export type RemoteSlotAction = 'mute' | 'solo' | 'similar' | 'adjacent' | 'random' | 'duplicate'

const REMOTE_SLOT_ACTIONS: RemoteSlotAction[] = [
  'mute',
  'solo',
  'similar',
  'adjacent',
  'random',
  'duplicate'
]

/** The whole trust boundary for the action sheet, in one pure function --
 * same shape and the same rule as parseRemoteSlotKinds below: an unknown
 * value is not coerced, dropped or best-guessed, it fails the whole
 * request. */
export function parseRemoteSlotAction(value: unknown): RemoteSlotAction | null {
  if (typeof value !== 'string') return null
  return REMOTE_SLOT_ACTIONS.find((a) => a === value) ?? null
}

/** The kinds POST /api/add-slot will accept, or null for "do not act on
 * this". The whole trust boundary for the phone's kind picker, in one pure
 * function: an unknown string is not coerced, dropped or best-guessed, it
 * fails the whole request -- so `kinds` can never become a channel for a
 * path, and the renderer's addSlot only ever sees a normalized, non-empty
 * set of real kinds. */
export function parseRemoteSlotKinds(value: unknown): DiscoverSlotKind[] | null {
  if (!Array.isArray(value)) return null
  if (value.length === 0 || value.length > DISCOVER_SLOT_KIND_OPTIONS.length) return null
  const kinds: DiscoverSlotKind[] = []
  for (const entry of value) {
    if (typeof entry !== 'string') return null
    const kind = DISCOVER_SLOT_KIND_OPTIONS.find((k) => k === entry)
    if (kind === undefined) return null
    kinds.push(kind)
  }
  const normalized = normalizeSlotKinds(kinds)
  return normalized.length === 0 ? null : normalized
}
