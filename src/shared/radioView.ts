// src/shared/radioView.ts -- the radio view's two views (spec 2026-10-05-radio-simple-view-design):
// `advanced` is the radio view as the design pass built it, every radio setting out front
// (radioStripModel's groups, each in its place); `simple`, the default, keeps the controls that
// play. Pure: which strip controls, which mix actions and which row parts each view draws are
// decided (and pinned by tests) here. Visibility only -- a view is never a setting radio reads:
// a hidden control keeps its value and keeps working.
//
// SIMPLE'S LISTS ARE EXPLICIT, by control id. A control added to the strip model lands in
// advanced (the strip's coverage test runs there) and in simple only when it is named below, so
// nothing silently joins simple (radioView.test.ts pins both lists).
import { radioIntensityOn, type RadioSettings } from './radioSchedule'
import type { RadioStripControl, RadioStripGroup } from './radioStripModel'

export type RadioView = 'simple' | 'advanced'

/** The switch's options, in its order. */
export const RADIO_VIEWS: readonly RadioView[] = ['simple', 'advanced']

/** Simple is the default (Elling, 2026-10-05); the choice is remembered (DiscoverSettings). */
export const DEFAULT_RADIO_VIEW: RadioView = 'simple'

export function normalizeRadioView(value: unknown): RadioView {
  return value === 'simple' || value === 'advanced' ? value : DEFAULT_RADIO_VIEW
}

/** The switch's tooltip, on both its options: what the other view adds or leaves out. */
export const RADIO_VIEW_TOOLTIP: Readonly<Record<RadioView, string>> = {
  simple: 'advanced adds every setting, the moves and the row extras',
  advanced: 'simple keeps what plays. hidden settings keep working'
}

/** A locked row's padlock in simple: a mark, not a button. */
export const RADIO_LOCK_MARK_TOOLTIP = 'locked · unlock in advanced'

/** Simple's top-line mix actions: keep, the one people reach for while listening. */
export const RADIO_SIMPLE_TOP: readonly string[] = ['keep']

/** Simple's live bar, in order: the play group's controls (the move chips aside: `turn` picks
 * for you), then the intensity arc's dials from the picks column. */
export const RADIO_SIMPLE_LIVE: readonly string[] = [
  'tempo',
  'pace',
  'skip',
  'new-bed',
  'turn',
  'build',
  'drop',
  'energy',
  'drama',
  'level'
]

/** The intensity arc's controls: in simple only while density is `intensity` (planning decision
 * 3). Greyed, they would point at a density control simple does not show. */
export const RADIO_SIMPLE_INTENSITY_ONLY: readonly string[] = ['build', 'drop', 'energy', 'drama']

/** What a view draws of the strip model's groups. */
export interface RadioViewStrip {
  /** The top line's mix actions, in order. */
  top: RadioStripControl[]
  /** The live bar's controls, in order. */
  live: RadioStripControl[]
  /** The seven fire-now move chips beside `turn`. */
  moveChips: boolean
  /** The shaping columns. */
  columns: RadioStripGroup[]
}

/** The strip model's groups as `view` draws them, for the settings the model was built from.
 * Advanced is the model's own places, unchanged; simple picks its lists by id, in their order. */
export function radioViewStrip(
  groups: readonly RadioStripGroup[],
  view: RadioView,
  settings: Pick<RadioSettings, 'density'>
): RadioViewStrip {
  if (view === 'advanced') {
    return {
      top: groups.filter((g) => g.place === 'top').flatMap((g) => g.controls),
      live: groups.filter((g) => g.place === 'live').flatMap((g) => g.controls),
      moveChips: true,
      columns: groups.filter((g) => g.place === 'columns')
    }
  }
  const all = groups.flatMap((g) => g.controls)
  const pick = (ids: readonly string[]): RadioStripControl[] =>
    ids.flatMap((id) => {
      const c = all.find((x) => x.id === id)
      return c === undefined ? [] : [c]
    })
  const arcIdle = !radioIntensityOn(settings)
  return {
    top: pick(RADIO_SIMPLE_TOP),
    live: pick(
      RADIO_SIMPLE_LIVE.filter((id) => !(arcIdle && RADIO_SIMPLE_INTENSITY_ONLY.includes(id)))
    ),
    moveChips: false,
    columns: []
  }
}

/** A radio-layout row's parts in its button line (DiscoverSlotRow's radio assembly). The
 * waveform and its plates are in both views and are not parts: the waveform cell never moves, so
 * a switch remounts nothing. */
export type RadioRowPart =
  | 'mute-solo'
  | 'skip'
  | 'like'
  | 'change-soon'
  | 'hook-dig'
  /** The kind label in the stem's type colour (both views). */
  | 'kind'
  /** The kind label opens the kinds menu (a button with its caret). */
  | 'kind-menu'
  | 'meter'
  | 'any-stem'
  | 'nearby'
  | 'duplicate'
  | 'lock'
  /** A locked row's padlock as a status mark, not a button (simple). */
  | 'lock-mark'
  | 'remove'

/** Every part, in the button line's reading order. */
export const RADIO_ROW_PARTS: readonly RadioRowPart[] = [
  'mute-solo',
  'skip',
  'like',
  'change-soon',
  'hook-dig',
  'kind',
  'kind-menu',
  'meter',
  'any-stem',
  'nearby',
  'duplicate',
  'lock',
  'lock-mark',
  'remove'
]

/** Simple's button line: the live cluster (m s, skip, like, change soon, hook dig) and the
 * label. */
export const RADIO_SIMPLE_ROW: readonly RadioRowPart[] = [
  'mute-solo',
  'skip',
  'like',
  'change-soon',
  'hook-dig',
  'kind'
]

/** The parts a row's button line draws in `view`. A part's own condition (a stem to act on,
 * radio running, a nearby anchor) still applies on top. A locked row in simple shows its lock as
 * a mark: hiding an active lock would be confusing (spec). */
export function radioRowParts(
  view: RadioView,
  row: { locked: boolean }
): ReadonlySet<RadioRowPart> {
  if (view === 'advanced') return new Set(RADIO_ROW_PARTS.filter((p) => p !== 'lock-mark'))
  return new Set<RadioRowPart>(row.locked ? [...RADIO_SIMPLE_ROW, 'lock-mark'] : RADIO_SIMPLE_ROW)
}
