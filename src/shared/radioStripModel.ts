// src/shared/radioStripModel.ts -- the radio view's strip (spec
// 2026-10-03-sssketch-radio-view-design section 1.3): every radio setting out front, in seven
// groups (design pass 2026-10-04: play in the live bar, mix on the top line, the rest in columns),
// while radio runs. Pure, as soundPanelModel is for the sound panel: RadioStrip.tsx draws
// these groups as they come, so which control is in which group, in what order, when it shows,
// what it says, and which RadioSettings patch a choice makes are decided (and tested) here.
//
// THE GROUPS, in order, each with a `place` (top line, live bar, or columns) and a subtitle:
// play (live: tempo, pace, skip, new bed, turn, build, drop, level), picks (columns: faves, source,
// matching, artist, my sounds, density, energy, drama, channels, turnover), shape (phrase, loop end, transitions, builds),
// moves (turnarounds, families, depth), fold (the switch; bend, mismatch, seed), sound (reverb,
// filter, res, filter mode; saturation, pump, echo), mix (top: similar all, fetch hearts, add to
// shelf, add to timeline, keep).
//
// THE KINDS. `chips`, `slider`, `switch` and `seed` are RadioSettings controls and carry their
// patches. `sound` carries the sound panel's own slider control (soundPanelModel), so its greyed
// state and its SET_SOUND_SETTINGS patch are the panel's. `panel` is a control the panel draws
// from its own state (the tempo field, the dials it already owns, the artist picker, the mix
// actions); the model only places it and says what it sets.
//
// GREYED, NOT HIDDEN (Elling, 2026-10-04): every control is present in every state. One that does
// not apply is `disabled`, with its tooltip saying what it needs: channels (with density off),
// energy, drama, build and drop (with density intensity),
// families and depth (with turnarounds on), bend, mismatch and the seed (with fold on).
//
// THE HINTS. The running radio menu's hint paragraph went with the menu; each of its sentences is
// now the tooltip of the control it explains (RADIO_STRIP_HINTS), every one on exactly one control.
import {
  RADIO_CHANNELS_MAX,
  RADIO_CHANNELS_MIN,
  RADIO_DENSITY_OPTIONS,
  RADIO_LOOP_END_OPTIONS,
  RADIO_PHRASE_OPTIONS,
  RADIO_TURNOVER_OPTIONS,
  radioDensityOf,
  radioDramaOf,
  radioEnergyOf,
  radioPaceLevelOf,
  radioSizedBuildsOf,
  type RadioSettings
} from './radioSchedule'
import { RADIO_PACE_LABEL, RADIO_PACE_TOOLTIP } from './radioPace'
import {
  RADIO_TURNAROUNDS_OPTIONS,
  TURNAROUND_DEPTH_OPTIONS,
  TURNAROUND_FAMILIES,
  toggleTurnaroundFamily
} from './radioTurnaround'
import { RADIO_TRANSITIONS_OPTIONS } from './radioTransition'
import { FAVES_LABEL, FAVES_TOOLTIP } from './discoverFaves'
import {
  RADIO_ADD_TO_SHELF_TOOLTIP,
  RADIO_ADD_TO_TIMELINE_TOOLTIP,
  RADIO_KEEP_TOOLTIP,
  RADIO_TURN_TOOLTIP,
  SOURCE_DIAL_TOOLTIP
} from './radioControlCopy'
import { soundPanelModel, type SoundSliderControl } from './soundPanelModel'
import type { DeepReadonly, SoundSettings } from './radioSound'

export type RadioStripGroupId = 'play' | 'picks' | 'shape' | 'moves' | 'fold' | 'sound' | 'mix'

/** The groups in order; each group's caption is its id. */
export const RADIO_STRIP_GROUPS: readonly RadioStripGroupId[] = [
  'play',
  'picks',
  'shape',
  'moves',
  'fold',
  'sound',
  'mix'
]

/** Where the radio view draws a group: `top` on the top line, `live` in the live bar under the
 * rows (the controls that play), `columns` in the quiet shaping columns. */
export type RadioStripPlace = 'top' | 'live' | 'columns'

/** Each group's one-line subtitle in the columns; play and mix have none. */
export const RADIO_STRIP_SUBTITLES: Readonly<Record<RadioStripGroupId, string | null>> = {
  play: null,
  picks: 'which stems come up',
  shape: 'how long things last',
  moves: 'what happens between',
  fold: 'how far it drifts',
  sound: 'the output',
  mix: null
}

const RADIO_STRIP_PLACE: Readonly<Record<RadioStripGroupId, RadioStripPlace>> = {
  play: 'live',
  picks: 'columns',
  shape: 'columns',
  moves: 'columns',
  fold: 'columns',
  sound: 'columns',
  mix: 'top'
}

export type RadioSettingKey = keyof RadioSettings

/** Kept on RadioSettings only to migrate an old settings file (paceLevel supersedes both): no
 * control sets them. */
export const RADIO_STRIP_LEGACY_KEYS: readonly RadioSettingKey[] = ['pace', 'paceBars']

export interface RadioStripChip {
  label: string
  on: boolean
  patch: Partial<RadioSettings>
}

interface RadioStripControlBase {
  id: string
  label: string
  tooltip?: string
  /** The RadioSettings keys this control writes (none for a control that is not a setting). */
  sets: readonly RadioSettingKey[]
  /** Greyed and inert. */
  disabled: boolean
  /** Dimmed but live (the faves dial in artist mode: your stars are not among the artist's). */
  dimmed?: boolean
}

export type RadioStripControl =
  | (RadioStripControlBase & { kind: 'chips'; chips: readonly RadioStripChip[] })
  | (RadioStripControlBase & {
      kind: 'slider'
      value: number
      patch(value: number): Partial<RadioSettings>
    })
  | (RadioStripControlBase & {
      kind: 'switch'
      on: boolean
      patch(on: boolean): Partial<RadioSettings>
    })
  | (RadioStripControlBase & {
      kind: 'seed'
      value: string
      patch(seed: string): Partial<RadioSettings>
    })
  | (RadioStripControlBase & { kind: 'sound'; control: SoundSliderControl })
  | (RadioStripControlBase & { kind: 'panel' })

export interface RadioStripGroup {
  id: RadioStripGroupId
  caption: string
  place: RadioStripPlace
  subtitle: string | null
  controls: RadioStripControl[]
}

export interface RadioStripContext {
  /** Discover artist mode (another artist's stems). */
  artistMode: boolean
  /** Combine artists: `me` is one of several chosen artists, so the faves dial still acts on
   * `me`'s turns and is not dimmed. Absent: false (today). */
  artistsIncludeMe?: boolean
  /** The user's own username is known (`my sounds` needs it). */
  hasUsername: boolean
  /** The open project's sound settings, normalized (the panel's `sound ?? app defaults`). */
  sound: DeepReadonly<SoundSettings>
  /** Something is in the playing mix: the master dials address it, and mean nothing otherwise. */
  sounding: boolean
}

/** The old radio menu's hint paragraph, sentence by sentence, keyed by the control each now
 * explains. `loopEnd` drops the paragraph's leading `below that,`: its `that` was the pace
 * sentence before it, which is no longer beside it. */
export const RADIO_STRIP_HINTS = {
  pace: [
    'pace is heard from the next change, and takes nothing back',
    'above fast the phrase shortens, and from 71 changes may come at every loop top',
    'from 80 changes may land mid-loop on bar lines, every 4, 2 or 1 bars, as cuts, long layers included',
    'above 70 a change may turn over more than one row, up to four at 100, all landing together'
  ],
  loopEnd: [
    'a layer longer than loop end changes at the top of the loop, a shorter one on its own cycle'
  ],
  phrase: [
    'phrase holds every change back to a 16 or 32 bar boundary, counted from where radio started'
  ],
  transitions: [
    'transitions decide how a layer arrives, and a hole or a riser holds its change to the top of the loop'
  ],
  density: [
    'density arc grows the rows to four or five and thins them to two or three, only ever removing rows radio added',
    'intensity builds, breaks down and drops, led by drums and bass'
  ],
  turnarounds: ['turnarounds mark the end of each phrase'],
  fold: [
    'fold loops one or two short layers at odd lengths against the beat, and changes come every 8 to 32 bars while it is on'
  ]
} as const

/** Joins a short tooltip and its hint sentences into one tooltip. */
function tip(...parts: readonly string[]): string {
  return parts.join('. ')
}

/** The `loop end` chips: 0 is every layer waiting for the loop top. */
export function radioLoopEndLabel(bars: number): string {
  return bars === 0 ? 'always' : String(bars)
}

/** The `phrase` chips: 0 is no phrase grid, every boundary the loop offers. */
export function radioPhraseLabel(bars: number): string {
  return bars === 0 ? 'loop' : `${bars} bars`
}

export const RADIO_CHANNEL_OPTIONS: readonly number[] = Array.from(
  { length: RADIO_CHANNELS_MAX - RADIO_CHANNELS_MIN + 1 },
  (_, i) => RADIO_CHANNELS_MIN + i
)

export const RADIO_TURNOVER_TOOLTIP =
  'which row changes next: even, the one that has gone longest; random, any'
export const RADIO_BUILDS_TOOLTIP = 'build-ups sized to the change; every turnaround paid off'
export const RADIO_NEW_BED_TOOLTIP = 'every unlocked row at once, at the next loop top'
export const RADIO_SOUND_TOOLTIP = 'project sound'
/** The intensity arc's controls (spec 2026-10-05-radio-intensity-arc-design sections 6, 8, 9):
 * greyed, not hidden, with density not `intensity`. */
export const RADIO_WITH_INTENSITY = 'with density intensity'
export const RADIO_ENERGY_TOOLTIP = 'gentle to driving'
export const RADIO_DRAMA_TOOLTIP = 'how far it swings'
export const RADIO_BUILD_TOOLTIP = 'build: go up now'
export const RADIO_DROP_TOOLTIP = 'drop: the drop at the next top'

/** The strip's sound dials, from the sound panel's own controls: [strip id, panel id, label]. */
export const RADIO_STRIP_SOUND_DIALS: readonly (readonly [string, string, string])[] = [
  ['saturation', 'saturation.amount', 'saturation'],
  ['pump', 'pump.depthDb', 'pump'],
  ['echo', 'throws.level', 'echo']
]

function chips<T>(
  options: readonly T[],
  label: (o: T) => string,
  on: (o: T) => boolean,
  patch: (o: T) => Partial<RadioSettings>
): RadioStripChip[] {
  return options.map((o) => ({ label: label(o), on: on(o), patch: patch(o) }))
}

function panel(
  id: string,
  label: string,
  o: {
    tooltip?: string
    sets?: readonly RadioSettingKey[]
    disabled?: boolean
    dimmed?: boolean
  } = {}
): RadioStripControl {
  return {
    kind: 'panel',
    id,
    label,
    ...(o.tooltip !== undefined ? { tooltip: o.tooltip } : {}),
    sets: o.sets ?? [],
    disabled: o.disabled ?? false,
    ...(o.dimmed !== undefined ? { dimmed: o.dimmed } : {})
  }
}

/** A sound panel slider as a strip dial: greyed exactly when the panel greys it; the tooltip
 * says it is the project's sound, and why it does nothing when it does nothing. */
function soundDial(
  id: string,
  label: string,
  control: SoundSliderControl,
  mastering: boolean
): RadioStripControl {
  const why = !control.disabled
    ? null
    : id === 'saturation' && !mastering
      ? 'needs mastering'
      : 'switched off in sound'
  return {
    kind: 'sound',
    id,
    label,
    tooltip: why === null ? RADIO_SOUND_TOOLTIP : `${RADIO_SOUND_TOOLTIP} · ${why}`,
    sets: [],
    disabled: control.disabled,
    control
  }
}

/** The mix group (the top line's actions): the same whatever the settings and context, so the
 * top line can ask for it without building the whole model (radioViewTopIds). */
export function radioStripMixControls(): RadioStripControl[] {
  return [
    panel('similar-all', 'similar all'),
    // Listed always, so the coverage tests keep pinning it; DRAWN only with a hearts key and the
    // advanced features switch on (heartsButtonShown, @shared/features): RadioMixActions skips
    // it when DiscoverPanel's bundle carries no `hearts`.
    panel('fetch-hearts', 'fetch hearts', { tooltip: 'fetch radio hearts' }),
    panel('add-to-shelf', 'add to shelf', { tooltip: RADIO_ADD_TO_SHELF_TOOLTIP }),
    panel('add-to-timeline', 'add to timeline', { tooltip: RADIO_ADD_TO_TIMELINE_TOOLTIP }),
    panel('keep', 'keep', { tooltip: RADIO_KEEP_TOOLTIP })
  ]
}

/** The strip for these settings, group by group, only what shows. */
export function radioStripModel(
  settings: RadioSettings,
  ctx: RadioStripContext
): RadioStripGroup[] {
  const density = radioDensityOf(settings)
  const turnaroundsOn = settings.turnarounds !== 'off'
  const foldOn = settings.foldMode
  const sizedBuilds = radioSizedBuildsOf(settings)
  const intensity = density === 'intensity'
  /** A tooltip, with what it needs while density is not intensity. */
  const withIntensity = (t: string): string => (intensity ? t : `${t} · ${RADIO_WITH_INTENSITY}`)

  const play: RadioStripControl[] = [
    panel('tempo', 'tempo'),
    {
      kind: 'slider',
      id: 'pace',
      label: RADIO_PACE_LABEL,
      tooltip: tip(RADIO_PACE_TOOLTIP, ...RADIO_STRIP_HINTS.pace),
      sets: ['paceLevel'],
      disabled: false,
      value: radioPaceLevelOf(settings),
      patch: (v) => ({ paceLevel: v })
    },
    panel('skip', 'skip', { tooltip: 'skip a row' }),
    panel('new-bed', 'new bed', { tooltip: RADIO_NEW_BED_TOOLTIP }),
    panel('turn', 'turn', { tooltip: RADIO_TURN_TOOLTIP }),
    panel('build', 'build', { tooltip: withIntensity(RADIO_BUILD_TOOLTIP), disabled: !intensity }),
    panel('drop', 'drop', { tooltip: withIntensity(RADIO_DROP_TOOLTIP), disabled: !intensity }),
    panel('level', 'level', { tooltip: 'whole mix level', disabled: !ctx.sounding })
  ]

  const picks: RadioStripControl[] = [
    panel('faves', FAVES_LABEL, {
      tooltip: FAVES_TOOLTIP,
      sets: ['faves'],
      dimmed: ctx.artistMode && ctx.artistsIncludeMe !== true
    }),
    panel('source', 'source · endlesss - other', {
      tooltip: SOURCE_DIAL_TOOLTIP,
      sets: ['source']
    }),
    panel('matching', 'matching', { tooltip: 'right for more matching' }),
    panel('artist', 'artist', { tooltip: 'whose stems discover plays' }),
    panel('my-sounds', 'my sounds', { disabled: !ctx.hasUsername || ctx.artistMode }),
    {
      kind: 'chips',
      id: 'density',
      label: 'density',
      tooltip: tip(...RADIO_STRIP_HINTS.density),
      sets: ['density'],
      disabled: false,
      chips: chips(
        RADIO_DENSITY_OPTIONS,
        (d) => d,
        (d) => density === d,
        (d) => ({ density: d })
      )
    },
    {
      kind: 'slider',
      id: 'energy',
      label: 'energy',
      tooltip: withIntensity(RADIO_ENERGY_TOOLTIP),
      sets: ['energy'],
      disabled: !intensity,
      value: radioEnergyOf(settings),
      patch: (v: number) => ({ energy: v })
    },
    {
      kind: 'slider',
      id: 'drama',
      label: 'drama',
      tooltip: withIntensity(RADIO_DRAMA_TOOLTIP),
      sets: ['drama'],
      disabled: !intensity,
      value: radioDramaOf(settings),
      patch: (v: number) => ({ drama: v })
    },
    {
      kind: 'chips',
      id: 'channels',
      label: 'channels',
      ...(density !== 'off' ? { tooltip: 'with density off' } : {}),
      sets: ['channels'],
      disabled: density !== 'off',
      chips: chips(
        RADIO_CHANNEL_OPTIONS,
        (n) => String(n),
        (n) => settings.channels === n,
        (n) => ({ channels: n })
      )
    },
    {
      kind: 'chips',
      id: 'turnover',
      label: 'turnover',
      tooltip: RADIO_TURNOVER_TOOLTIP,
      sets: ['turnover'],
      disabled: false,
      chips: chips(
        RADIO_TURNOVER_OPTIONS,
        (t) => t,
        (t) => settings.turnover === t,
        (t) => ({ turnover: t })
      )
    }
  ]

  const shape: RadioStripControl[] = [
    {
      kind: 'chips',
      id: 'phrase',
      label: 'phrase',
      tooltip: tip(...RADIO_STRIP_HINTS.phrase),
      sets: ['phraseBars'],
      disabled: false,
      chips: chips(
        RADIO_PHRASE_OPTIONS,
        radioPhraseLabel,
        (n) => settings.phraseBars === n,
        (n) => ({ phraseBars: n })
      )
    },
    {
      kind: 'chips',
      id: 'loop-end',
      label: 'loop end · bars',
      tooltip: tip(...RADIO_STRIP_HINTS.loopEnd),
      sets: ['loopEndOverBars'],
      disabled: false,
      chips: chips(
        RADIO_LOOP_END_OPTIONS,
        radioLoopEndLabel,
        (n) => settings.loopEndOverBars === n,
        (n) => ({ loopEndOverBars: n })
      )
    },
    {
      kind: 'chips',
      id: 'transitions',
      label: 'transitions',
      tooltip: tip(...RADIO_STRIP_HINTS.transitions),
      sets: ['transitions'],
      disabled: false,
      chips: chips(
        RADIO_TRANSITIONS_OPTIONS,
        (t) => t,
        (t) => settings.transitions === t,
        (t) => ({ transitions: t })
      )
    },
    {
      kind: 'chips',
      id: 'builds',
      label: 'builds',
      tooltip: RADIO_BUILDS_TOOLTIP,
      sets: ['sizedBuilds'],
      disabled: false,
      chips: [
        { label: 'sized', on: sizedBuilds, patch: { sizedBuilds: true } },
        { label: 'off', on: !sizedBuilds, patch: { sizedBuilds: false } }
      ]
    }
  ]

  const moves: RadioStripControl[] = [
    {
      kind: 'chips',
      id: 'turnarounds',
      label: 'turnarounds',
      tooltip: tip(...RADIO_STRIP_HINTS.turnarounds),
      sets: ['turnarounds'],
      disabled: false,
      chips: chips(
        RADIO_TURNAROUNDS_OPTIONS,
        (t) => t,
        (t) => settings.turnarounds === t,
        (t) => ({ turnarounds: t })
      )
    },
    {
      kind: 'chips',
      id: 'moves',
      label: 'families',
      tooltip: turnaroundsOn ? 'which moves' : 'which moves · with turnarounds on',
      sets: ['turnaroundMoves'],
      disabled: !turnaroundsOn,
      chips: chips(
        TURNAROUND_FAMILIES,
        (f) => f,
        (f) => settings.turnaroundMoves.includes(f),
        (f) => ({ turnaroundMoves: toggleTurnaroundFamily(settings.turnaroundMoves, f) })
      )
    },
    {
      kind: 'chips',
      id: 'depth',
      label: 'depth',
      tooltip: turnaroundsOn ? 'how far' : 'how far · with turnarounds on',
      sets: ['turnaroundDepth'],
      disabled: !turnaroundsOn,
      chips: chips(
        TURNAROUND_DEPTH_OPTIONS,
        (d) => d,
        (d) => settings.turnaroundDepth === d,
        (d) => ({ turnaroundDepth: d })
      )
    }
  ]

  const fold: RadioStripControl[] = [
    {
      kind: 'switch',
      id: 'fold',
      label: 'fold',
      tooltip: tip('layers in other time signatures', ...RADIO_STRIP_HINTS.fold),
      sets: ['foldMode'],
      disabled: false,
      on: foldOn,
      patch: (on) => ({ foldMode: on })
    },
    {
      kind: 'slider',
      id: 'bend',
      label: 'bend',
      tooltip: foldOn
        ? 'how far layers bend off the beat'
        : 'how far layers bend off the beat · with fold on',
      sets: ['fold'],
      disabled: !foldOn,
      value: settings.fold,
      patch: (v: number) => ({ fold: v })
    },
    {
      kind: 'slider',
      id: 'mismatch',
      label: 'mismatch',
      tooltip: foldOn
        ? 'how unlike the rest new layers are'
        : 'how unlike the rest new layers are · with fold on',
      sets: ['clash'],
      disabled: !foldOn,
      value: settings.clash,
      patch: (v: number) => ({ clash: v })
    },
    {
      kind: 'seed',
      id: 'seed',
      label: 'seed',
      tooltip: foldOn
        ? 'same seed, same folding. any text'
        : 'same seed, same folding. any text · with fold on',
      sets: ['foldSeed'],
      disabled: !foldOn,
      value: settings.foldSeed,
      patch: (seed: string) => ({ foldSeed: seed })
    }
  ]

  const soundControls = soundPanelModel(ctx.sound).flatMap((r) => r.controls)
  const sliderOf = (panelId: string): SoundSliderControl => {
    const c = soundControls.find((x) => x.id === panelId)
    if (c === undefined || c.kind !== 'slider') throw new Error(`no sound slider ${panelId}`)
    return c
  }
  const quiet = !ctx.sounding
  const sound: RadioStripControl[] = [
    panel('reverb', 'reverb', { tooltip: 'whole mix reverb', disabled: quiet }),
    panel('filter', 'filter', { tooltip: 'whole mix filter', disabled: quiet }),
    panel('res', 'res', { tooltip: 'filter resonance', disabled: quiet }),
    panel('filter-mode', 'filter mode', { disabled: quiet }),
    ...RADIO_STRIP_SOUND_DIALS.map(([id, panelId, label]) =>
      soundDial(id, label, sliderOf(panelId), ctx.sound.mastering.on)
    )
  ]

  const mix = radioStripMixControls()

  const byId: Record<RadioStripGroupId, RadioStripControl[]> = {
    play,
    picks,
    shape,
    moves,
    fold,
    sound,
    mix
  }
  return RADIO_STRIP_GROUPS.map((id) => ({
    id,
    caption: id,
    place: RADIO_STRIP_PLACE[id],
    subtitle: RADIO_STRIP_SUBTITLES[id],
    controls: byId[id]
  }))
}

/** A 0..100 strip dial's position for a sound panel slider's value. */
export function soundDialPosition(control: SoundSliderControl, value = control.value): number {
  const span = control.max - control.min
  if (!(span > 0)) return 0
  const t = (value - control.min) / span
  return Math.round(Math.min(1, Math.max(0, t)) * 100)
}

/** The sound panel slider's value at a 0..100 strip dial position: on the slider's own step,
 * inside its range, rounded as the panel's patch rounds. */
export function soundDialValue(control: SoundSliderControl, position: number): number {
  const span = control.max - control.min
  const t = Math.min(100, Math.max(0, Number.isFinite(position) ? position : 0)) / 100
  const steps = Math.round((t * span) / control.step)
  const v = Math.min(control.max, Math.max(control.min, control.min + steps * control.step))
  return Math.round(v * 1e6) / 1e6
}
