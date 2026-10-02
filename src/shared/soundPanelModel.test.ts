import { describe, expect, it } from 'vitest'
import {
  reverbLevelLabel,
  signedDb,
  soundPanelModel,
  toneTiltLabel,
  type SoundChoiceControl,
  type SoundControl,
  type SoundPanelRow,
  type SoundSliderControl,
  type SoundSwitchControl
} from './soundPanelModel'
import { mergeSoundSettings, normalizeSoundSettings, type SoundSettings } from './radioSound'

const defaults = (): SoundSettings => normalizeSoundSettings(undefined)
const row = (rows: SoundPanelRow[], stage: string): SoundPanelRow => {
  const r = rows.find((x) => x.stage === stage)
  if (!r) throw new Error(`no row ${stage}`)
  return r
}
const control = <T extends SoundControl>(rows: SoundPanelRow[], id: string): T => {
  for (const r of rows) for (const c of r.controls) if (c.id === id) return c as T
  throw new Error(`no control ${id}`)
}

describe('soundPanelModel', () => {
  it('lists the rows top to bottom, as the plan orders them', () => {
    expect(soundPanelModel(defaults()).map((r) => r.label)).toEqual([
      'mastering',
      'glue',
      'saturation',
      'tone',
      'reverb',
      'panning',
      'pump',
      'throws',
      'riser variety'
    ])
  })

  it('with everything on, nothing is greyed out', () => {
    const rows = soundPanelModel(defaults())
    for (const r of rows) {
      expect(r.greyed).toBe(false)
      expect(r.hint).toBeUndefined()
      for (const c of r.controls) expect(c.disabled, c.id).toBe(false)
    }
  })

  it('without mastering, glue, saturation and tone are greyed out whole, and say why', () => {
    const s = defaults()
    s.mastering.on = false
    const rows = soundPanelModel(s)
    for (const stage of ['glue', 'saturation', 'tone']) {
      const r = row(rows, stage)
      expect(r.greyed).toBe(true)
      expect(r.hint).toBe('needs mastering')
      for (const c of r.controls) expect(c.disabled, c.id).toBe(true)
    }
    // the mastering switch itself stays live; its own sliders grey out with it
    expect(control<SoundSwitchControl>(rows, 'mastering.on').disabled).toBe(false)
    expect(control<SoundSwitchControl>(rows, 'mastering.on').on).toBe(false)
    expect(control(rows, 'mastering.headroomDb').disabled).toBe(true)
    expect(control(rows, 'mastering.ceilingDb').disabled).toBe(true)
    // the other stages are untouched by it
    for (const stage of ['reverb', 'panning', 'pump', 'throws', 'riserVariety']) {
      expect(row(rows, stage).greyed).toBe(false)
      for (const c of row(rows, stage).controls) expect(c.disabled, c.id).toBe(false)
    }
  })

  it('a master stage keeps the switch it was given while greyed out', () => {
    const s = defaults()
    s.mastering.on = false
    s.glue.on = false
    const rows = soundPanelModel(s)
    expect(control<SoundSwitchControl>(rows, 'glue.on').on).toBe(false)
    expect(control<SoundSwitchControl>(rows, 'saturation.on').on).toBe(true)
  })

  it('a stage switched off greys its own sliders and chips, not its switch', () => {
    const s = defaults()
    for (const stage of ['glue', 'saturation', 'tone', 'panning', 'pump', 'throws'] as const) {
      s[stage].on = false
    }
    const rows = soundPanelModel(s)
    for (const id of [
      'glue.on',
      'saturation.on',
      'tone.on',
      'panning.on',
      'pump.on',
      'throws.on'
    ]) {
      expect(control(rows, id).disabled, id).toBe(false)
    }
    for (const id of [
      'glue.amount',
      'saturation.amount',
      'tone.amount',
      'panning.width',
      'pump.depthDb',
      'throws.rate',
      'throws.level'
    ]) {
      expect(control(rows, id).disabled, id).toBe(true)
    }
    for (const r of rows) expect(r.greyed, r.stage).toBe(false)
  })

  it('the reverb has no switch: its room and amount are always live', () => {
    const rows = soundPanelModel(defaults())
    expect(row(rows, 'reverb').controls.map((c) => c.kind)).toEqual(['choice', 'slider'])
    const room = control<SoundChoiceControl>(rows, 'reverb.room')
    expect(room.options.map((o) => o.label)).toEqual(['cavern', 'zita'])
    expect(room.value).toBe('cavern')
  })

  it('the throw rate offers rare, normal and often', () => {
    const rate = control<SoundChoiceControl>(soundPanelModel(defaults()), 'throws.rate')
    expect(rate.options.map((o) => o.label)).toEqual(['rare', 'normal', 'often'])
    expect(rate.value).toBe('normal')
  })

  it('the sliders take their ranges from SOUND_LIMITS and their values from the settings', () => {
    const rows = soundPanelModel(defaults())
    const ranges = Object.fromEntries(
      rows
        .flatMap((r) => r.controls)
        .filter((c): c is SoundSliderControl => c.kind === 'slider')
        .map((c) => [c.id, [c.label, c.min, c.max, c.value]])
    )
    expect(ranges).toEqual({
      'mastering.headroomDb': ['headroom', -8, 0, -4],
      'mastering.ceilingDb': ['ceiling', -3, -0.3, -1],
      'glue.amount': ['amount', 0, 1, 0.5],
      'saturation.amount': ['drive', 0, 1, 0.5],
      'tone.amount': ['tilt', -1, 1, 0],
      'reverb.amount': ['amount', 0, 1, 0.5],
      'panning.width': ['width', 0, 0.5, 0.25],
      'pump.depthDb': ['depth', 0, 8, 4],
      'throws.level': ['level', 0, 1, 1]
    })
  })

  it('labels each slider in its own terms, at any value', () => {
    const rows = soundPanelModel(defaults())
    const read = (id: string, v: number): string => control<SoundSliderControl>(rows, id).readout(v)
    expect(read('mastering.headroomDb', -4)).toBe('−4.0 dB')
    expect(read('mastering.headroomDb', 0)).toBe('0.0 dB')
    expect(read('mastering.ceilingDb', -1)).toBe('−1.0 dBTP')
    expect(read('mastering.ceilingDb', -0.3)).toBe('−0.3 dBTP')
    // glue: the threshold the amount maps to
    expect(read('glue.amount', 0.5)).toBe('−14.0 dB')
    expect(read('glue.amount', 0)).toBe('−8.0 dB')
    expect(read('glue.amount', 1)).toBe('−20.0 dB')
    // saturation: the drive
    expect(read('saturation.amount', 0.5)).toBe('0.90')
    expect(read('saturation.amount', 1)).toBe('1.80')
    expect(read('saturation.amount', 0)).toBe('0.00')
    // tone: warmer <-> brighter
    expect(read('tone.amount', 0)).toBe('neutral')
    expect(read('tone.amount', -0.5)).toBe('warmer 50%')
    expect(read('tone.amount', 1)).toBe('brighter 100%')
    // reverb: the return against today's level
    expect(read('reverb.amount', 0.5)).toBe('0.0 dB')
    expect(read('reverb.amount', 1)).toBe('+6.0 dB')
    expect(read('reverb.amount', 0)).toBe('off')
    expect(read('panning.width', 0.25)).toBe('±0.25')
    expect(read('pump.depthDb', 4)).toBe('4.0 dB')
    expect(read('throws.level', 1)).toBe('100%')
    expect(read('throws.level', 0.35)).toBe('35%')
  })

  it("every control's change touches exactly its own field", () => {
    const rows = soundPanelModel(defaults())
    const sw = (id: string): SoundSwitchControl => control<SoundSwitchControl>(rows, id)
    const sl = (id: string): SoundSliderControl => control<SoundSliderControl>(rows, id)
    const ch = (id: string): SoundChoiceControl => control<SoundChoiceControl>(rows, id)
    expect(sw('mastering.on').patch(false)).toEqual({ mastering: { on: false } })
    expect(sl('mastering.headroomDb').patch(-6)).toEqual({ mastering: { headroomDb: -6 } })
    expect(sl('mastering.ceilingDb').patch(-2)).toEqual({ mastering: { ceilingDb: -2 } })
    expect(sw('glue.on').patch(false)).toEqual({ glue: { on: false } })
    expect(sl('glue.amount').patch(0.8)).toEqual({ glue: { amount: 0.8 } })
    expect(sw('saturation.on').patch(false)).toEqual({ saturation: { on: false } })
    expect(sl('saturation.amount').patch(0.2)).toEqual({ saturation: { amount: 0.2 } })
    expect(sw('tone.on').patch(false)).toEqual({ tone: { on: false } })
    expect(sl('tone.amount').patch(-0.4)).toEqual({ tone: { amount: -0.4 } })
    expect(ch('reverb.room').patch('zita')).toEqual({ reverb: { room: 'zita' } })
    expect(sl('reverb.amount').patch(0.7)).toEqual({ reverb: { amount: 0.7 } })
    expect(sw('panning.on').patch(false)).toEqual({ panning: { on: false } })
    expect(sl('panning.width').patch(0.4)).toEqual({ panning: { width: 0.4 } })
    expect(sw('pump.on').patch(false)).toEqual({ pump: { on: false } })
    expect(sl('pump.depthDb').patch(6)).toEqual({ pump: { depthDb: 6 } })
    expect(sw('throws.on').patch(false)).toEqual({ throws: { on: false } })
    expect(ch('throws.rate').patch('often')).toEqual({ throws: { rate: 'often' } })
    expect(sl('throws.level').patch(0.5)).toEqual({ throws: { level: 0.5 } })
    expect(sw('riserVariety.on').patch(false)).toEqual({ riserVariety: { on: false } })
  })

  it('a change merged into the settings comes back as the model of the new settings', () => {
    let s = defaults()
    s = mergeSoundSettings(
      s,
      control<SoundSwitchControl>(soundPanelModel(s), 'mastering.on').patch(false)
    )
    expect(row(soundPanelModel(s), 'glue').greyed).toBe(true)
    s = mergeSoundSettings(
      s,
      control<SoundSwitchControl>(soundPanelModel(s), 'mastering.on').patch(true)
    )
    expect(row(soundPanelModel(s), 'glue').greyed).toBe(false)
  })
  it("a slider's change is rounded clear of floating-point step noise", () => {
    const glue = control<SoundSliderControl>(soundPanelModel(defaults()), 'glue.amount')
    expect(glue.patch(0.1 + 0.2)).toEqual({ glue: { amount: 0.3 } })
  })
})

describe('the readout helpers', () => {
  it('signedDb rounds to a tenth, with a real minus and a plus', () => {
    expect(signedDb(-4)).toBe('−4.0 dB')
    expect(signedDb(6.02)).toBe('+6.0 dB')
    expect(signedDb(-0.01)).toBe('0.0 dB')
    expect(signedDb(-1, 'dBTP')).toBe('−1.0 dBTP')
  })

  it('toneTiltLabel says which way, and how far', () => {
    expect(toneTiltLabel(0)).toBe('neutral')
    expect(toneTiltLabel(0.004)).toBe('neutral')
    expect(toneTiltLabel(-1)).toBe('warmer 100%')
    expect(toneTiltLabel(0.25)).toBe('brighter 25%')
  })

  it('reverbLevelLabel is the return against today, off at 0', () => {
    expect(reverbLevelLabel(0)).toBe('off')
    expect(reverbLevelLabel(0.25)).toBe('−6.0 dB')
    expect(reverbLevelLabel(0.5)).toBe('0.0 dB')
  })
})
