// src/shared/radioTransition.ts
//
// Radio's transitions -- docs/superpowers/specs/2026-09-28-radio-controls-
// design.md section 5. Only the SETTING's shape exists so far: the
// temperament weighting and the curve builders are phase E, and nothing
// reads `RadioSettings.transitions` until they land.
//
// The shape ships early on purpose. It is the one field whose absence
// would force a second settings migration later, and a migration is the
// part of this that touches a real file on a real user's disk.
export type RadioTransitions = 'off' | 'subtle' | 'bold'

export const RADIO_TRANSITIONS_OPTIONS: RadioTransitions[] = ['off', 'subtle', 'bold']

export const DEFAULT_RADIO_TRANSITIONS: RadioTransitions = 'subtle'

export function normalizeRadioTransitions(value: unknown): RadioTransitions {
  return RADIO_TRANSITIONS_OPTIONS.includes(value as RadioTransitions)
    ? (value as RadioTransitions)
    : DEFAULT_RADIO_TRANSITIONS
}
