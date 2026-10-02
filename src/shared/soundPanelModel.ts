// src/shared/soundPanelModel.ts -- what the sound settings panel shows (native radio sound plan,
// docs/superpowers/plans/2026-10-01-native-radio-sound.md, Task 13). Pure: the panel
// (SoundSettingsPanel.tsx) renders these rows as they come, so every label, every greyed-out
// control and every change a control makes is decided (and tested) here.
//
// THE ROWS, top to bottom: mastering (headroom, ceiling), glue, saturation, tone, reverb, panning,
// pump, throws, riser variety. Glue, saturation and tone are master stages: they only run with
// mastering on (the wire and the engine drop them otherwise), so without mastering their rows are
// greyed out whole -- switch and slider -- and say why. A stage switched off keeps its slider
// greyed too: the amount would do nothing. The reverb has no switch (a room is always playing;
// its amount 0 is silent).
//
// THE CHANGES. Every control returns the SoundSettingsPatch it makes (SET_SOUND_SETTINGS, or a
// merge into the app-wide defaults), so the panel never builds one by hand. A slider's readout is
// a function of the value, so the panel can label a drag's live value before it is committed.
import {
  REVERB_ROOMS,
  SOUND_LIMITS,
  THROW_RATES,
  glueThresholdDb,
  saturationDrive,
  type DeepReadonly,
  type ReverbRoom,
  type SoundSettings,
  type SoundSettingsPatch,
  type ThrowRate
} from './radioSound'

export type SoundStage = keyof SoundSettings

/** An on/off pair of chips. */
export interface SoundSwitchControl {
  kind: 'switch'
  id: string
  on: boolean
  disabled: boolean
  patch(on: boolean): SoundSettingsPatch
}

/** One of a few named values, as chips (the reverb room, the throw rate). */
export interface SoundChoiceControl<T extends string = string> {
  kind: 'choice'
  id: string
  options: readonly { value: T; label: string }[]
  value: T
  disabled: boolean
  patch(value: T): SoundSettingsPatch
}

/** A slider. Commits on release (the panel); `readout` labels any value, a live drag's included. */
export interface SoundSliderControl {
  kind: 'slider'
  id: string
  label: string
  min: number
  max: number
  step: number
  value: number
  disabled: boolean
  readout(value: number): string
  patch(value: number): SoundSettingsPatch
}

export type SoundControl = SoundSwitchControl | SoundChoiceControl | SoundSliderControl

export interface SoundPanelRow {
  stage: SoundStage
  label: string
  /** The whole row is greyed out (a master stage without mastering). */
  greyed: boolean
  /** Why it is greyed out, or nothing. */
  hint?: string
  controls: SoundControl[]
}

/** A real minus sign, as dbLabel (visuals.ts) writes one. */
const minus = (s: string): string => s.replace('-', '−')

/** dB with one decimal and a sign: "−4.0 dB", "+6.0 dB", "0.0 dB". */
export function signedDb(db: number, unit = 'dB'): string {
  const r = Math.round(db * 10) / 10
  if (r === 0) return `0.0 ${unit}`
  return `${r > 0 ? '+' : ''}${minus(r.toFixed(1))} ${unit}`
}

/** The tone's tilt in words: "warmer 50%", "neutral", "brighter 100%". */
export function toneTiltLabel(amount: number): string {
  const pct = Math.round(Math.abs(amount) * 100)
  if (pct === 0) return 'neutral'
  return `${amount < 0 ? 'warmer' : 'brighter'} ${pct}%`
}

/** The reverb amount as the return's level against today's (0.5 is 0 dB, 1 is +6 dB, 0 off). */
export function reverbLevelLabel(amount: number): string {
  if (amount <= 0.0005) return 'off'
  return signedDb(20 * Math.log10(2 * amount))
}

const pct = (v: number): string => `${Math.round(v * 100)}%`

const ROOM_LABELS: Record<ReverbRoom, string> = { cavern: 'cavern', zita: 'zita' }
const RATE_LABELS: Record<ThrowRate, string> = { rare: 'rare', normal: 'normal', often: 'often' }

const MASTER_STAGE_HINT = 'needs mastering'

function onOff(stage: SoundStage, on: boolean, disabled: boolean): SoundSwitchControl {
  return {
    kind: 'switch',
    id: `${stage}.on`,
    on,
    disabled,
    patch: (next) => ({ [stage]: { on: next } }) as SoundSettingsPatch
  }
}

function slider(
  stage: SoundStage,
  field: string,
  label: string,
  range: readonly [number, number],
  step: number,
  value: number,
  disabled: boolean,
  readout: (v: number) => string
): SoundSliderControl {
  return {
    kind: 'slider',
    id: `${stage}.${field}`,
    label,
    min: range[0],
    max: range[1],
    step,
    value,
    disabled,
    readout,
    // a range input's steps come back as 0.30000000000000004 and the like: keep the saved value clean
    patch: (next) => ({ [stage]: { [field]: Math.round(next * 1e6) / 1e6 } }) as SoundSettingsPatch
  }
}

/** The panel's rows for these settings. */
export function soundPanelModel(settings: DeepReadonly<SoundSettings>): SoundPanelRow[] {
  const s = settings
  const mastering = s.mastering.on
  const masterStage = (
    stage: 'glue' | 'saturation' | 'tone',
    label: string,
    slide: (off: boolean) => SoundSliderControl
  ): SoundPanelRow => ({
    stage,
    label,
    greyed: !mastering,
    hint: mastering ? undefined : MASTER_STAGE_HINT,
    controls: [onOff(stage, s[stage].on, !mastering), slide(!mastering || !s[stage].on)]
  })

  return [
    {
      stage: 'mastering',
      label: 'mastering',
      greyed: false,
      controls: [
        onOff('mastering', mastering, false),
        slider(
          'mastering',
          'headroomDb',
          'headroom',
          SOUND_LIMITS.headroomDb,
          0.5,
          s.mastering.headroomDb,
          !mastering,
          (v) => signedDb(v)
        ),
        slider(
          'mastering',
          'ceilingDb',
          'ceiling',
          SOUND_LIMITS.ceilingDb,
          0.1,
          s.mastering.ceilingDb,
          !mastering,
          (v) => signedDb(v, 'dBTP')
        )
      ]
    },
    masterStage('glue', 'glue', (off) =>
      slider('glue', 'amount', 'amount', SOUND_LIMITS.glueAmount, 0.05, s.glue.amount, off, (v) =>
        signedDb(glueThresholdDb(v))
      )
    ),
    masterStage('saturation', 'saturation', (off) =>
      slider(
        'saturation',
        'amount',
        'drive',
        SOUND_LIMITS.saturationAmount,
        0.05,
        s.saturation.amount,
        off,
        (v) => saturationDrive(v).toFixed(2)
      )
    ),
    masterStage('tone', 'tone', (off) =>
      slider('tone', 'amount', 'tilt', SOUND_LIMITS.toneAmount, 0.05, s.tone.amount, off, (v) =>
        toneTiltLabel(v)
      )
    ),
    {
      stage: 'reverb',
      label: 'reverb',
      greyed: false,
      controls: [
        {
          kind: 'choice',
          id: 'reverb.room',
          options: REVERB_ROOMS.map((value) => ({ value, label: ROOM_LABELS[value] })),
          value: s.reverb.room,
          disabled: false,
          patch: (room: string) => ({ reverb: { room: room as ReverbRoom } })
        },
        slider(
          'reverb',
          'amount',
          'amount',
          SOUND_LIMITS.reverbAmount,
          0.05,
          s.reverb.amount,
          false,
          (v) => reverbLevelLabel(v)
        )
      ]
    },
    {
      stage: 'panning',
      label: 'panning',
      greyed: false,
      controls: [
        onOff('panning', s.panning.on, false),
        slider(
          'panning',
          'width',
          'width',
          SOUND_LIMITS.panWidth,
          0.05,
          s.panning.width,
          !s.panning.on,
          (v) => `±${v.toFixed(2)}`
        )
      ]
    },
    {
      stage: 'pump',
      label: 'pump',
      greyed: false,
      controls: [
        onOff('pump', s.pump.on, false),
        slider(
          'pump',
          'depthDb',
          'depth',
          SOUND_LIMITS.pumpDepthDb,
          0.5,
          s.pump.depthDb,
          !s.pump.on,
          (v) => `${v.toFixed(1)} dB`
        )
      ]
    },
    {
      stage: 'throws',
      label: 'throws',
      greyed: false,
      controls: [
        onOff('throws', s.throws.on, false),
        {
          kind: 'choice',
          id: 'throws.rate',
          options: THROW_RATES.map((value) => ({ value, label: RATE_LABELS[value] })),
          value: s.throws.rate,
          disabled: !s.throws.on,
          patch: (rate: string) => ({ throws: { rate: rate as ThrowRate } })
        },
        slider(
          'throws',
          'level',
          'level',
          SOUND_LIMITS.throwLevel,
          0.05,
          s.throws.level,
          !s.throws.on,
          pct
        )
      ]
    },
    {
      stage: 'riserVariety',
      label: 'riser variety',
      greyed: false,
      controls: [onOff('riserVariety', s.riserVariety.on, false)]
    }
  ]
}
