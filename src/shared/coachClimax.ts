/**
 * The material phase two carves from, and the framework-agnostic view of
 * Discover that produces it.
 *
 * Two shapes live here, both deliberately plain data:
 *
 * **CoachSlotSnapshot** is everything the guided flow is allowed to know
 * about one Discover slot. DiscoverPanel publishes these upward (it is the
 * only component that knows whether a slot has actually RESOLVED, whether
 * it is audible, and whether it is mid-roll); nothing in src/shared/ ever
 * sees a DiscoverSlot, a DiscoverCandidate or a React anything.
 *
 * **LockedClimax** is the spec's "lock in the climax... its stems, roles
 * and gains become the material phase 2 carves from". Roles come from the
 * kind set Discover itself tagged the slot with -- never from stem order or
 * channel index, which the spec rules out twice.
 */

import {
  DISCOVER_SLOT_KIND_OPTIONS,
  arrangeRoleToSlotKinds,
  discoverSlotKindToArrangeRole,
  normalizeSlotKinds,
  type DiscoverSlotKind
} from './discoverSlotKind'
import type { ArrangeRole } from './stemRole'
import type { SoundType } from './types'

/** The parts of a resolved Discover stem the guided flow needs. A subset of
 * DiscoverPanel's own ResolvedCandidateStem, restated here so src/shared/
 * does not import from the renderer. */
export interface CoachStemSnapshot {
  path: string
  name: string
  author: string
  type: SoundType
  durationSec: number
  barLength: number
}

export interface CoachSlotSnapshot {
  id: string
  /** The kinds this slot targets -- Discover's own role tagging. */
  kinds: readonly DiscoverSlotKind[]
  /** null until this slot has real, locally-resolved audio behind it. This
   * is what "a step completes when a slot with those kinds resolves" (spec)
   * actually tests. */
  stem: CoachStemSnapshot | null
  /** 0-1, the slot's own committed gain. */
  gain: number
  /** In Discover's audible preview mix (i.e. not muted). */
  audible: boolean
  /** Mid-roll. The only reason the flow knows is so sssketchy can climb
   * while the app works, which is a fact about the machine, not a guess. */
  rolling: boolean
}

export interface LockedClimaxStem extends CoachStemSnapshot {
  kinds: DiscoverSlotKind[]
  role: ArrangeRole
  gain: number
}

export interface LockedClimax {
  bpm: number
  /** The longest member's bar length -- the same rule assembleDiscoverRifff
   * already uses for a placed Discover rifff, so a section built from this
   * tiles exactly like the loop did. */
  barLength: number
  stems: LockedClimaxStem[]
  lockedAt: number
}

const KIND_SET = new Set<string>(DISCOVER_SLOT_KIND_OPTIONS)

export function isDiscoverSlotKind(value: unknown): value is DiscoverSlotKind {
  return typeof value === 'string' && KIND_SET.has(value)
}

/** The ArrangeRole a slot's kind set stands for. normalizeSlotKinds puts
 * mask kinds (drums/bass/lead) first, so a combination slot is named by its
 * mask kind when it has one, and by its trait kind otherwise -- exactly the
 * mapping discoverSlotKindToArrangeRole already defines for placing a
 * Discover pick on the timeline. 'aux' for an empty set, which only a
 * hand-edited project can produce. */
export function coachSlotRole(kinds: readonly DiscoverSlotKind[]): ArrangeRole {
  const normalized = normalizeSlotKinds(kinds)
  if (normalized.length === 0) return 'aux'
  return discoverSlotKindToArrangeRole(normalized[0])
}

/**
 * The one superset rule every kind-set check in this feature shares: a set
 * of kinds COVERS a wanted set when it contains all of them.
 *
 * Superset, not overlap, is what keeps a {leadesque, buttery} harmony stem
 * from answering for a {leadesque, sparkly} hook -- and normalizeSlotKinds
 * allows at most one of sparkly/buttery in a set, so those two can never
 * collide. Phase one uses it to decide whether a step is satisfied
 * (slotCoversKindSet, deleted with phase one); phase two uses it to decide
 * whether a section type's suggested drop applies to a stem
 * (./coachSections.ts). One rule, one implementation.
 */
export function kindsCoverSet(
  kinds: readonly DiscoverSlotKind[],
  want: readonly DiscoverSlotKind[]
): boolean {
  if (want.length === 0) return false
  const owned = new Set(normalizeSlotKinds(kinds))
  return want.every((kind) => owned.has(kind))
}

function clampGain(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1
  return Math.max(0, Math.min(1, value))
}

/**
 * Whether there is anything to freeze yet.
 *
 * Exported so the UI can DISABLE the lock rather than run it into a silent
 * no-op: lockCoachClimax on an empty Discover returns the flow untouched,
 * which as a live button is a click that does nothing and explains
 * nothing. Same rule as lockClimaxFromSlots' own null return, stated once
 * so the button and the transition can never disagree.
 */
export function canLockClimax(slots: readonly CoachSlotSnapshot[]): boolean {
  return slots.some((slot) => slot.stem !== null)
}

/**
 * Freezes the loop as it stands. Every slot with real audio behind it is
 * included, muted ones at gain 0 rather than dropped -- the same choice
 * resolveDiscoverRifff already makes when plunking into the arranger ("keeps
 * the stem itself present... just silent"), so the locked climax and the
 * placed loop agree about what is in the loop.
 *
 * Returns null when nothing has resolved yet; the caller leaves the flow
 * alone rather than locking an empty climax.
 */
export function lockClimaxFromSlots(
  slots: readonly CoachSlotSnapshot[],
  bpm: number,
  now: number
): LockedClimax | null {
  const stems: LockedClimaxStem[] = []
  for (const slot of slots) {
    if (slot.stem === null) continue
    const kinds = normalizeSlotKinds(slot.kinds)
    stems.push({
      ...slot.stem,
      kinds,
      role: coachSlotRole(kinds),
      gain: slot.audible ? clampGain(slot.gain) : 0
    })
  }
  if (stems.length === 0) return null
  return {
    bpm,
    barLength: Math.max(...stems.map((stem) => stem.barLength), 1),
    stems,
    lockedAt: now
  }
}

/** One stem on its way into a locked climax, as the auto-arranger's own
 * role step knows it. */
export interface CoachClimaxStemInput {
  stem: CoachStemSnapshot
  /** The role the USER confirmed in AutoArrangeRoleStep -- kept verbatim,
   * never re-derived from the kinds below. */
  role: ArrangeRole
  /** 0-1, the stem's own committed gain off state.vol. */
  gain: number
}

/**
 * A locked climax built from the auto-arranger's confirmed roles rather than
 * from Discover's slots.
 *
 * The two constructors differ in which field is authoritative, and it
 * matters: lockClimaxFromSlots DERIVES the role from the kinds Discover
 * tagged, because there the kinds are the real signal. Here the ROLE is the
 * real signal -- a person just chose it from a dropdown -- and the kinds are
 * derived from it (ARRANGE_ROLE_SLOT_KINDS). Deriving the role back out of
 * those kinds would squash 'backing', 'textureFx', 'fill' and 'vocal' into
 * 'lead' or 'aux' and throw away the one piece of information the user gave
 * by hand.
 *
 * barLength is the longest member's, the same rule the other constructor and
 * assembleDiscoverRifff both use, so a section built from this tiles exactly
 * as the source material did.
 */
export function lockClimaxFromArrangeRoles(
  stems: readonly CoachClimaxStemInput[],
  bpm: number,
  now: number
): LockedClimax | null {
  if (stems.length === 0) return null
  const locked: LockedClimaxStem[] = stems.map((entry) => ({
    ...entry.stem,
    kinds: [...arrangeRoleToSlotKinds(entry.role)],
    role: entry.role,
    gain: clampGain(entry.gain)
  }))
  const barLength = Math.max(...locked.map((stem) => (stem.barLength > 0 ? stem.barLength : 1)))
  return { bpm, barLength, stems: locked, lockedAt: now }
}

function finitePositive(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback
  return value
}

function loadedStem(value: unknown): LockedClimaxStem | null {
  if (typeof value !== 'object' || value === null) return null
  const loose = value as Record<string, unknown>
  if (typeof loose.path !== 'string' || loose.path === '') return null
  const kinds = normalizeSlotKinds(
    (Array.isArray(loose.kinds) ? loose.kinds : []).filter(isDiscoverSlotKind)
  )
  return {
    path: loose.path,
    name: typeof loose.name === 'string' ? loose.name : '',
    author: typeof loose.author === 'string' ? loose.author : '',
    type: (typeof loose.type === 'string' ? loose.type : 'audioIn') as SoundType,
    durationSec: finitePositive(loose.durationSec, 0.1),
    barLength: finitePositive(loose.barLength, 1),
    kinds,
    role: coachSlotRole(kinds),
    gain: clampGain(loose.gain)
  }
}

/**
 * Turns whatever a `.sssketchproj` actually contains into a LockedClimax,
 * or null -- the same repair-rather-than-trust rule the rest of the load
 * path follows, for the same reason: a project file is plain JSON that
 * people can and do hand-edit, and a load must never throw.
 *
 * `role` is recomputed from the (validated) kinds rather than read from the
 * file, so a hand-edited role can never disagree with the kinds phase two
 * will key its suggested drops off.
 */
export function sanitiseLockedClimax(value: unknown): LockedClimax | null {
  if (typeof value !== 'object' || value === null) return null
  const loose = value as Record<string, unknown>
  if (!Array.isArray(loose.stems)) return null
  const stems = loose.stems
    .map(loadedStem)
    .filter((stem): stem is LockedClimaxStem => stem !== null)
  if (stems.length === 0) return null
  return {
    bpm: finitePositive(loose.bpm, 120),
    barLength: finitePositive(loose.barLength, Math.max(...stems.map((s) => s.barLength), 1)),
    stems,
    lockedAt: finitePositive(loose.lockedAt, 0)
  }
}
