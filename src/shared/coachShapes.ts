/**
 * How long a journey, and where the material the user already has lands in
 * it.
 *
 * Both tables come straight from the spec
 * (docs/superpowers/specs/2026-09-23-arrangement-map-design.md, "Getting
 * started: two questions"), which in turn reads them off
 * edmprod.com/beatport-analysis. The finding that shapes this file: hardstyle,
 * future bass and big-room tracks all land on nearly the same section ORDER.
 * What actually differs by genre is section LENGTH. **That is why there is no
 * genre picker** -- a genre list would mostly be one template wearing six
 * names, and someone would have to be right about genres. Do not add one.
 */

import type { CoachSectionType } from './coachSections'

export type CoachShapeId = 'short' | 'standard' | 'long'

/** The article's own letter notation, kept as letters because that is how
 * the shapes are SHOWN to the user -- `A B C D B C D A` reads as a journey
 * in a way a list of six words does not. */
export type CoachShapeLetter = 'A' | 'B' | 'C' | 'D' | 'E'

/** A intro/outro · B verse · C build · D drop · E breakdown (spec). `A` maps
 * to intro here; shapeSectionTypes below turns the LAST one into an outro,
 * which is the only thing the letter leaves ambiguous. */
export const COACH_SHAPE_LETTER_TYPE: Record<CoachShapeLetter, CoachSectionType> = {
  A: 'intro',
  B: 'verse',
  C: 'build',
  D: 'drop',
  E: 'breakdown'
}

export interface CoachShapeDef {
  id: CoachShapeId
  /** Lowercase, like all UI copy in this app. */
  label: string
  letters: readonly CoachShapeLetter[]
  /** Roughly, at an ordinary tempo -- shown next to the letters so the
   * choice reads as a length rather than as a code. */
  approxMinutes: number
}

const COACH_SHAPE_BY_ID: Record<CoachShapeId, CoachShapeDef> = {
  short: { id: 'short', label: 'short', letters: ['A', 'B', 'D', 'A'], approxMinutes: 2 },
  standard: {
    id: 'standard',
    label: 'standard',
    letters: ['A', 'B', 'C', 'D', 'B', 'C', 'D', 'A'],
    approxMinutes: 4
  },
  long: {
    id: 'long',
    label: 'long',
    letters: ['A', 'B', 'C', 'D', 'E', 'C', 'D', 'A'],
    approxMinutes: 6
  }
}

export const COACH_SHAPES: readonly CoachShapeDef[] = [
  COACH_SHAPE_BY_ID.short,
  COACH_SHAPE_BY_ID.standard,
  COACH_SHAPE_BY_ID.long
]

export function coachShapeDef(shape: CoachShapeId): CoachShapeDef {
  return COACH_SHAPE_BY_ID[shape]
}

export function isCoachShapeId(value: unknown): value is CoachShapeId {
  return typeof value === 'string' && value in COACH_SHAPE_BY_ID
}

/** The shape as real section types. The only rule beyond the letter table
 * is that the FINAL `A` is an outro -- the same section kind at the other
 * end of the track, which is what the letter has always meant. */
export function shapeSectionTypes(shape: CoachShapeId): CoachSectionType[] {
  const letters = coachShapeDef(shape).letters
  return letters.map((letter, index) =>
    letter === 'A' && index === letters.length - 1 ? 'outro' : COACH_SHAPE_LETTER_TYPE[letter]
  )
}

/**
 * "Target lengths from the article, rounded to whole passes: intro/outro
 * 8-16 bars, verse 16 (second 16-32), build 8, drop 8-16 (second the same or
 * longer)" (spec).
 *
 * The spec gives RANGES; these are the single figures picked from them, and
 * the reasoning is written down so a later tune is a decision rather than a
 * rediscovery: intro/outro take the bottom of their range (an opening that
 * outstays its welcome is the commonest fault in a first arrangement), the
 * verse takes its stated 16 and then the midpoint of 16-32 for the second,
 * the build takes its one figure, and the drop takes the TOP of 8-16 because
 * it is the payoff. Every one of them is a TARGET -- passesForTargetBars
 * rounds it to whole passes of whatever the phrase turns out to be.
 *
 * Indexed by how many sections of that type are already down, so "the
 * second verse is longer" is data rather than a special case.
 */
export const COACH_SECTION_TARGET_BARS: Record<CoachSectionType, readonly number[]> = {
  intro: [8],
  verse: [16, 24],
  build: [8],
  drop: [16],
  breakdown: [16],
  outro: [8]
}

/** The target for the `ordinal`-th section of this type, holding the last
 * figure for anything beyond the table. */
export function targetBarsFor(type: CoachSectionType, ordinal: number): number {
  const targets = COACH_SECTION_TARGET_BARS[type]
  const index = Math.max(0, Math.min(targets.length - 1, Math.round(ordinal)))
  return targets[index]
}

/** "What is this loop?" -- drop / verse / intro / not sure (spec). It
 * "decides where the material the user already has lands in the structure",
 * and it replaces all six of phase one's steps. */
export type CoachLoopAnswer = 'drop' | 'verse' | 'intro' | 'unsure'

export const COACH_LOOP_ANSWERS: readonly CoachLoopAnswer[] = ['drop', 'verse', 'intro', 'unsure']

export function isCoachLoopAnswer(value: unknown): value is CoachLoopAnswer {
  return COACH_LOOP_ANSWERS.includes(value as CoachLoopAnswer)
}

/** Which section type the user's loop IS -- the one section the pre-fill
 * leaves completely full, because it is the thing he actually built.
 *
 * 'unsure' lands on the drop, and says so rather than pretending to know:
 * the method this whole feature follows builds the climax first and
 * subtracts from it, so the drop is where unattributed material belongs.
 * Choosing it is a default, not a claim about his track, and every cell it
 * produces is one toggle away from being wrong-and-fixed. */
export const COACH_LOOP_HOME_TYPE: Record<CoachLoopAnswer, CoachSectionType> = {
  drop: 'drop',
  verse: 'verse',
  intro: 'intro',
  unsure: 'drop'
}
