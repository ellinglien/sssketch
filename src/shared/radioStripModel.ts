// src/shared/radioStripModel.ts -- the radio view's strip (spec
// 2026-10-03-sssketch-radio-view-design section 1.3): every radio setting out front, in six
// groups, while radio runs. Pure, as soundPanelModel is for the sound panel: RadioStrip.tsx draws
// these groups as they come, so which control is in which group, in what order, when it shows,
// what it says, and which RadioSettings patch a choice makes are decided (and tested) here.
//
// THE GROUPS, in order: play (tempo, pace, skip, new bed), picks (faves, source, matching,
// artist, my sounds, density, channels, turnover), shape (phrase, loop end, transitions,
// turnarounds, moves, depth, builds, turn), fold (the switch; bend, mismatch, seed), sound
// (level, reverb, filter, res, filter mode; saturation, pump, echo), mix (similar all, keep,
// fetch hearts, add to shelf, add to timeline).
//
// THE KINDS. `chips`, `slider`, `switch` and `seed` are RadioSettings controls and carry their
// patches. `sound` carries the sound panel's own slider control (soundPanelModel), so its greyed
// state and its SET_SOUND_SETTINGS patch are the panel's. `panel` is a control the panel draws
// from its own state (the tempo field, the dials it already owns, the artist picker, the mix
// actions); the model only places it and says what it sets.
//
// VISIBILITY is omission: a control that does not show is not in its group. Channels shows only
// with density `off`; moves and depth only while turnarounds is not `off`; bend, mismatch and the
// seed only with fold on (Elling, 2026-10-03: hidden as before, not disabled).
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
import { soundPanelModel, type SoundSliderControl } from './soundPanelModel'
import type { DeepReadonly, SoundSettings } from './radioSound'

export type RadioStripGroupId = 'play' | 'picks' | 'shape' | 'fold' | 'sound' | 'mix'

/** The groups in order; each group's caption is its id. */
export const RADIO_STRIP_GROUPS: readonly RadioStripGroupId[] = [
  'play',
  'picks',
  'shape',
  'fold',
  'sound',
  'mix'
]

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
  controls: RadioStripControl[]
}

export interface RadioStripContext {
  /** Discover artist mode (another artist's stems). */
  artistMode: boolean
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
    'density arc grows the rows to four or five and thins them to two or three, only ever removing rows radio added'
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
  return bars === 0 ? 'always' : `${bars} bars`
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

/** The strip for these settings, group by group, only what shows. */
export function radioStripModel(
  settings: RadioSettings,
  ctx: RadioStripContext
): RadioStripGroup[] {
  const density = radioDensityOf(settings)
  const turnaroundsOn = settings.turnarounds !== 'off'
  const foldOn = settings.foldMode
  const sizedBuilds = radioSizedBuildsOf(settings)

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
    panel('new-bed', 'new bed', { tooltip: RADIO_NEW_BED_TOOLTIP })
  ]

  const picks: RadioStripControl[] = [
    panel('faves', FAVES_LABEL, {
      tooltip: FAVES_TOOLTIP,
      sets: ['faves'],
      dimmed: ctx.artistMode
    }),
    panel('source', 'source', { tooltip: 'other clockwise' }),
    panel('matching', 'matching', { tooltip: 'more matching clockwise' }),
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
    ...(density === 'off'
      ? [
          {
            kind: 'chips' as const,
            id: 'channels',
            label: 'channels',
            sets: ['channels'] as const,
            disabled: false,
            chips: chips(
              RADIO_CHANNEL_OPTIONS,
              (n) => String(n),
              (n) => settings.channels === n,
              (n) => ({ channels: n })
            )
          }
        ]
      : []),
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
      label: 'loop end',
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
    ...(turnaroundsOn
      ? [
          {
            kind: 'chips' as const,
            id: 'moves',
            label: 'moves',
            tooltip: 'which moves',
            sets: ['turnaroundMoves'] as const,
            disabled: false,
            chips: chips(
              TURNAROUND_FAMILIES,
              (f) => f,
              (f) => settings.turnaroundMoves.includes(f),
              (f) => ({ turnaroundMoves: toggleTurnaroundFamily(settings.turnaroundMoves, f) })
            )
          },
          {
            kind: 'chips' as const,
            id: 'depth',
            label: 'depth',
            tooltip: 'how far',
            sets: ['turnaroundDepth'] as const,
            disabled: false,
            chips: chips(
              TURNAROUND_DEPTH_OPTIONS,
              (d) => d,
              (d) => settings.turnaroundDepth === d,
              (d) => ({ turnaroundDepth: d })
            )
          }
        ]
      : []),
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
    },
    panel('turn', 'turn', { tooltip: 'turn at the top' })
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
    ...(foldOn
      ? [
          {
            kind: 'slider' as const,
            id: 'bend',
            label: 'bend',
            tooltip: 'how far layers bend off the beat',
            sets: ['fold'] as const,
            disabled: false,
            value: settings.fold,
            patch: (v: number) => ({ fold: v })
          },
          {
            kind: 'slider' as const,
            id: 'mismatch',
            label: 'mismatch',
            tooltip: 'how unlike the rest new layers are',
            sets: ['clash'] as const,
            disabled: false,
            value: settings.clash,
            patch: (v: number) => ({ clash: v })
          },
          {
            kind: 'seed' as const,
            id: 'seed',
            label: 'seed',
            tooltip: 'same seed, same folding. any text',
            sets: ['foldSeed'] as const,
            disabled: false,
            value: settings.foldSeed,
            patch: (seed: string) => ({ foldSeed: seed })
          }
        ]
      : [])
  ]

  const soundControls = soundPanelModel(ctx.sound).flatMap((r) => r.controls)
  const sliderOf = (panelId: string): SoundSliderControl => {
    const c = soundControls.find((x) => x.id === panelId)
    if (c === undefined || c.kind !== 'slider') throw new Error(`no sound slider ${panelId}`)
    return c
  }
  const quiet = !ctx.sounding
  const sound: RadioStripControl[] = [
    panel('level', 'level', { tooltip: 'whole mix level', disabled: quiet }),
    panel('reverb', 'reverb', { tooltip: 'whole mix reverb', disabled: quiet }),
    panel('filter', 'filter', { tooltip: 'whole mix filter', disabled: quiet }),
    panel('res', 'res', { tooltip: 'filter resonance', disabled: quiet }),
    panel('filter-mode', 'filter mode', { disabled: quiet }),
    ...RADIO_STRIP_SOUND_DIALS.map(([id, panelId, label]) =>
      soundDial(id, label, sliderOf(panelId), ctx.sound.mastering.on)
    )
  ]

  const mix: RadioStripControl[] = [
    panel('similar-all', 'similar all'),
    panel('keep', 'keep', { tooltip: 'keep this group' }),
    panel('fetch-hearts', 'fetch hearts', { tooltip: 'fetch radio hearts' }),
    panel('add-to-shelf', 'add to shelf'),
    panel('add-to-timeline', 'add to timeline')
  ]

  const byId: Record<RadioStripGroupId, RadioStripControl[]> = {
    play,
    picks,
    shape,
    fold,
    sound,
    mix
  }
  return RADIO_STRIP_GROUPS.map((id) => ({ id, caption: id, controls: byId[id] }))
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
