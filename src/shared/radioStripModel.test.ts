// The radio view's strip (spec 2026-10-03-sssketch-radio-view-design sections 1.3 and 4):
// radioStripModel.ts. The first test is the one that matters most: a radio setting added without
// a strip control fails it.
import { describe, expect, it } from 'vitest'
import {
  RADIO_BUILD_TOOLTIP,
  RADIO_DRAMA_TOOLTIP,
  RADIO_DROP_TOOLTIP,
  RADIO_ENERGY_TOOLTIP,
  RADIO_WITH_INTENSITY,
  RADIO_CHANNEL_OPTIONS,
  RADIO_STRIP_GROUPS,
  RADIO_STRIP_HINTS,
  RADIO_STRIP_LEGACY_KEYS,
  RADIO_STRIP_SUBTITLES,
  radioStripModel,
  soundDialPosition,
  soundDialValue,
  type RadioSettingKey,
  type RadioStripContext,
  type RadioStripControl,
  type RadioStripGroup
} from './radioStripModel'
import {
  DEFAULT_RADIO_SETTINGS,
  RADIO_DENSITY_OPTIONS,
  RADIO_LOOP_END_OPTIONS,
  RADIO_PHRASE_OPTIONS,
  RADIO_TURNOVER_OPTIONS,
  normalizeRadioSettings,
  type RadioSettings
} from './radioSchedule'
import {
  RADIO_TURNAROUNDS_OPTIONS,
  TURNAROUND_DEPTH_OPTIONS,
  TURNAROUND_FAMILIES
} from './radioTurnaround'
import { RADIO_TRANSITIONS_OPTIONS } from './radioTransition'
import { DEFAULT_SOUND_SETTINGS, normalizeSoundSettings } from './radioSound'
import { soundPanelModel, type SoundSliderControl } from './soundPanelModel'
import { radioViewStrip } from './radioView'

const CTX: RadioStripContext = {
  artistMode: false,
  hasUsername: true,
  sound: DEFAULT_SOUND_SETTINGS,
  sounding: true
}

function settings(over: Partial<RadioSettings> = {}): RadioSettings {
  return { ...DEFAULT_RADIO_SETTINGS, ...over }
}

function controls(groups: RadioStripGroup[]): RadioStripControl[] {
  return groups.flatMap((g) => g.controls)
}

function control(groups: RadioStripGroup[], id: string): RadioStripControl | undefined {
  return controls(groups).find((c) => c.id === id)
}

function ids(groups: RadioStripGroup[], group: string): string[] {
  return groups.find((g) => g.id === group)?.controls.map((c) => c.id) ?? []
}

/** Every state the visibility rules turn on: density, turnarounds and fold, each both ways. */
const STATES: RadioSettings[] = RADIO_DENSITY_OPTIONS.flatMap((density) =>
  RADIO_TURNAROUNDS_OPTIONS.flatMap((turnarounds) =>
    [false, true].map((foldMode) => settings({ density, turnarounds, foldMode }))
  )
)

/** The controls the advanced view draws (radioView.ts): the coverage test runs there. Simple
 * keeps fewer on purpose; its list is pinned in radioView.test.ts. */
function advancedControls(s: RadioSettings): RadioStripControl[] {
  const v = radioViewStrip(radioStripModel(s, CTX), 'advanced', s)
  return [...v.top, ...v.live, ...v.columns.flatMap((g) => g.controls)]
}

describe('radioStripModel: nothing hidden', () => {
  it('sets every radio setting from some control in the advanced view (the legacy pace pair aside)', () => {
    const set = new Set<RadioSettingKey>()
    for (const s of STATES) for (const c of advancedControls(s)) c.sets.forEach((k) => set.add(k))
    const keys = (Object.keys(DEFAULT_RADIO_SETTINGS) as RadioSettingKey[]).filter(
      (k) => !RADIO_STRIP_LEGACY_KEYS.includes(k)
    )
    // also every key normalizeRadioSettings writes, so an optional field added there counts
    const normalized = Object.keys(normalizeRadioSettings({})) as RadioSettingKey[]
    for (const k of new Set([...keys, ...normalized])) {
      if (RADIO_STRIP_LEGACY_KEYS.includes(k)) continue
      expect(set.has(k), `no strip control sets ${k}`).toBe(true)
    }
  })

  it('only patches what a control says it sets', () => {
    for (const s of STATES) {
      for (const c of controls(radioStripModel(s, CTX))) {
        const patches =
          c.kind === 'chips'
            ? c.chips.map((x) => x.patch)
            : c.kind === 'slider'
              ? [c.patch(7)]
              : c.kind === 'switch'
                ? [c.patch(true), c.patch(false)]
                : c.kind === 'seed'
                  ? [c.patch('abc')]
                  : []
        for (const p of patches) {
          for (const k of Object.keys(p)) expect(c.sets, `${c.id} patches ${k}`).toContain(k)
        }
      }
    }
  })
})

describe('radioStripModel: groups and order', () => {
  it('has the seven groups in order, each captioned with its name', () => {
    const groups = radioStripModel(settings(), CTX)
    expect(groups.map((g) => g.id)).toEqual([
      'play',
      'picks',
      'shape',
      'moves',
      'fold',
      'sound',
      'mix'
    ])
    expect(groups.map((g) => g.caption)).toEqual([...RADIO_STRIP_GROUPS])
  })

  it('places each group on the top line, the live bar or the columns, with its subtitle', () => {
    const groups = radioStripModel(settings(), CTX)
    expect(groups.map((g) => [g.id, g.place])).toEqual([
      ['play', 'live'],
      ['picks', 'columns'],
      ['shape', 'columns'],
      ['moves', 'columns'],
      ['fold', 'columns'],
      ['sound', 'columns'],
      ['mix', 'top']
    ])
    expect(RADIO_STRIP_SUBTITLES).toEqual({
      play: null,
      picks: 'which stems come up',
      shape: 'how long things last',
      moves: 'what happens between',
      fold: 'how far it drifts',
      sound: 'the output',
      mix: null
    })
    for (const g of groups) expect(g.subtitle).toBe(RADIO_STRIP_SUBTITLES[g.id])
  })

  it('places every control in its group, in reading order', () => {
    const g = radioStripModel(
      settings({ density: 'off', turnarounds: 'rare', foldMode: true }),
      CTX
    )
    expect(ids(g, 'play')).toEqual([
      'tempo',
      'pace',
      'skip',
      'new-bed',
      'turn',
      'build',
      'drop',
      'level'
    ])
    expect(ids(g, 'picks')).toEqual([
      'faves',
      'source',
      'matching',
      'artist',
      'my-sounds',
      'density',
      'energy',
      'drama',
      'channels',
      'turnover'
    ])
    expect(ids(g, 'shape')).toEqual(['phrase', 'loop-end', 'transitions', 'builds'])
    expect(ids(g, 'moves')).toEqual(['turnarounds', 'moves', 'depth'])
    expect(ids(g, 'fold')).toEqual(['fold', 'bend', 'mismatch', 'seed'])
    expect(ids(g, 'sound')).toEqual([
      'reverb',
      'filter',
      'res',
      'filter-mode',
      'saturation',
      'pump',
      'echo'
    ])
    expect(ids(g, 'mix')).toEqual([
      'similar-all',
      'fetch-hearts',
      'add-to-shelf',
      'add-to-timeline',
      'keep'
    ])
  })
})

describe('radioStripModel: greyed, not omitted', () => {
  it('has every control present in every state', () => {
    const first = radioStripModel(STATES[0], CTX).map((g) => [g.id, g.controls.map((c) => c.id)])
    for (const s of STATES) {
      expect(radioStripModel(s, CTX).map((g) => [g.id, g.controls.map((c) => c.id)])).toEqual(first)
    }
  })

  it('greys channels unless density is off', () => {
    for (const d of RADIO_DENSITY_OPTIONS) {
      const c = control(radioStripModel(settings({ density: d }), CTX), 'channels')
      expect(c?.disabled, d).toBe(d !== 'off')
      expect(c?.tooltip === 'with density off', d).toBe(d !== 'off')
    }
  })

  it('greys energy, drama, build and drop unless density is intensity, saying so', () => {
    const want: Record<string, string> = {
      energy: RADIO_ENERGY_TOOLTIP,
      drama: RADIO_DRAMA_TOOLTIP,
      build: RADIO_BUILD_TOOLTIP,
      drop: RADIO_DROP_TOOLTIP
    }
    for (const d of RADIO_DENSITY_OPTIONS) {
      const g = radioStripModel(settings({ density: d }), CTX)
      for (const id of Object.keys(want)) {
        const c = control(g, id)
        expect(c?.disabled, `${id} ${d}`).toBe(d !== 'intensity')
        expect(c?.tooltip, `${id} ${d}`).toBe(
          d === 'intensity' ? want[id] : `${want[id]} · ${RADIO_WITH_INTENSITY}`
        )
      }
    }
  })

  it('reads and patches energy and drama as sliders, the defaults when unset', () => {
    const g = radioStripModel(settings({ density: 'intensity', energy: 30 }), CTX)
    const e = control(g, 'energy')
    const d = control(radioStripModel(settings({ drama: undefined }), CTX), 'drama')
    if (e?.kind !== 'slider' || d?.kind !== 'slider') throw new Error('dials')
    expect(e.value).toBe(30)
    expect(e.patch(80)).toEqual({ energy: 80 })
    expect(d.value).toBe(60)
    expect(d.patch(10)).toEqual({ drama: 10 })
  })

  it('greys families and depth while turnarounds is off', () => {
    for (const t of RADIO_TURNAROUNDS_OPTIONS) {
      const g = radioStripModel(settings({ turnarounds: t }), CTX)
      for (const id of ['moves', 'depth']) {
        expect(control(g, id)?.disabled, `${id} ${t}`).toBe(t === 'off')
        expect(control(g, id)?.tooltip?.endsWith('· with turnarounds on'), `${id} ${t}`).toBe(
          t === 'off'
        )
      }
    }
  })

  it('greys bend, mismatch and the seed with fold off; the switch never', () => {
    for (const on of [false, true]) {
      const g = radioStripModel(settings({ foldMode: on }), CTX)
      expect(control(g, 'fold')?.disabled).toBe(false)
      for (const id of ['bend', 'mismatch', 'seed']) {
        expect(control(g, id)?.disabled, id).toBe(!on)
        expect(control(g, id)?.tooltip?.endsWith('· with fold on'), id).toBe(!on)
      }
    }
  })

  it('keeps a disabled chip control carrying its patches', () => {
    const c = control(radioStripModel(settings({ density: 'arc' }), CTX), 'channels')
    if (c?.kind !== 'chips') throw new Error('channels')
    expect(c.chips.map((x) => x.patch.channels)).toEqual([...RADIO_CHANNEL_OPTIONS])
  })

  it('greys the master dials while nothing sounds, and nothing else', () => {
    const g = radioStripModel(settings(), { ...CTX, sounding: false })
    for (const id of ['level', 'reverb', 'filter', 'res', 'filter-mode']) {
      expect(control(g, id)?.disabled, id).toBe(true)
    }
    const off = (gs: RadioStripGroup[]): string[] =>
      controls(gs)
        .filter((c) => c.disabled)
        .map((c) => c.id)
    const loud = off(radioStripModel(settings(), CTX))
    expect(off(g).filter((id) => !loud.includes(id))).toEqual([
      'level',
      'reverb',
      'filter',
      'res',
      'filter-mode'
    ])
    expect(loud.filter((id) => !off(g).includes(id))).toEqual([])
    expect(control(radioStripModel(settings(), CTX), 'level')?.disabled).toBe(false)
  })

  it('dims faves in artist mode and greys my sounds without a username or in artist mode', () => {
    expect(control(radioStripModel(settings(), CTX), 'faves')?.dimmed).toBe(false)
    expect(
      control(radioStripModel(settings(), { ...CTX, artistMode: true }), 'faves')?.dimmed
    ).toBe(true)
    expect(control(radioStripModel(settings(), CTX), 'my-sounds')?.disabled).toBe(false)
    expect(
      control(radioStripModel(settings(), { ...CTX, hasUsername: false }), 'my-sounds')?.disabled
    ).toBe(true)
    expect(
      control(radioStripModel(settings(), { ...CTX, artistMode: true }), 'my-sounds')?.disabled
    ).toBe(true)
  })
})

describe('radioStripModel: options come from the shared constants', () => {
  function chipsOf(g: RadioStripGroup[], id: string): { label: string; on: boolean }[] {
    const c = control(g, id)
    if (c?.kind !== 'chips') throw new Error(`${id} is not chips`)
    return c.chips.map(({ label, on }) => ({ label, on }))
  }
  const all = radioStripModel(settings({ density: 'off', turnarounds: 'often' }), CTX)

  it('lists every option, in the constants order, with the setting lit', () => {
    expect(chipsOf(all, 'density').map((c) => c.label)).toEqual([...RADIO_DENSITY_OPTIONS])
    expect(chipsOf(all, 'channels').map((c) => c.label)).toEqual(RADIO_CHANNEL_OPTIONS.map(String))
    expect(chipsOf(all, 'turnover').map((c) => c.label)).toEqual([...RADIO_TURNOVER_OPTIONS])
    expect(chipsOf(all, 'phrase')).toHaveLength(RADIO_PHRASE_OPTIONS.length)
    expect(chipsOf(all, 'loop-end')).toHaveLength(RADIO_LOOP_END_OPTIONS.length)
    expect(chipsOf(all, 'transitions').map((c) => c.label)).toEqual([...RADIO_TRANSITIONS_OPTIONS])
    expect(chipsOf(all, 'turnarounds').map((c) => c.label)).toEqual([...RADIO_TURNAROUNDS_OPTIONS])
    expect(chipsOf(all, 'moves').map((c) => c.label)).toEqual([...TURNAROUND_FAMILIES])
    expect(chipsOf(all, 'depth').map((c) => c.label)).toEqual([...TURNAROUND_DEPTH_OPTIONS])
    for (const id of [
      'density',
      'channels',
      'turnover',
      'phrase',
      'loop-end',
      'transitions',
      'turnarounds',
      'depth',
      'builds'
    ]) {
      expect(
        chipsOf(all, id).filter((c) => c.on),
        id
      ).toHaveLength(1)
    }
  })

  it('labels loop end (in bars, the label says so) and phrase', () => {
    expect(control(all, 'loop-end')?.label).toBe('loop end · bars')
    expect(chipsOf(all, 'loop-end').map((c) => c.label)).toEqual(
      RADIO_LOOP_END_OPTIONS.map((n) => (n === 0 ? 'always' : String(n)))
    )
    expect(chipsOf(all, 'phrase').map((c) => c.label)).toEqual(
      RADIO_PHRASE_OPTIONS.map((n) => (n === 0 ? 'loop' : `${n} bars`))
    )
  })

  it('toggles one move family at a time', () => {
    const c = control(all, 'moves')
    if (c?.kind !== 'chips') throw new Error('moves')
    const first = TURNAROUND_FAMILIES[0]
    expect(c.chips[0].patch.turnaroundMoves).toEqual(TURNAROUND_FAMILIES.filter((f) => f !== first))
  })

  it('switches builds and fold, and reads pace as the slider level', () => {
    const b = control(radioStripModel(settings({ sizedBuilds: false }), CTX), 'builds')
    if (b?.kind !== 'chips') throw new Error('builds')
    expect(b.chips.map((x) => [x.label, x.on])).toEqual([
      ['sized', false],
      ['off', true]
    ])
    const f = control(all, 'fold')
    if (f?.kind !== 'switch') throw new Error('fold')
    expect(f.patch(true)).toEqual({ foldMode: true })
    const p = control(radioStripModel(settings({ paceLevel: 63 }), CTX), 'pace')
    if (p?.kind !== 'slider') throw new Error('pace')
    expect(p.value).toBe(63)
    expect(p.patch(80)).toEqual({ paceLevel: 80 })
  })
})

describe('radioStripModel: words', () => {
  const words = (c: RadioStripControl): string[] => [
    c.label,
    ...(c.tooltip !== undefined ? [c.tooltip] : []),
    ...(c.kind === 'chips' ? c.chips.map((x) => x.label) : [])
  ]
  it('labels source with its ends, in words (no arrow glyph)', () => {
    expect(control(radioStripModel(settings(), CTX), 'source')?.label).toBe(
      'source · endlesss - other'
    )
  })

  it('is lowercase, with no emoji and no exclamation mark', () => {
    for (const s of STATES) {
      for (const g of radioStripModel(s, CTX)) {
        for (const w of [
          g.caption,
          ...(g.subtitle !== null ? [g.subtitle] : []),
          ...g.controls.flatMap(words)
        ]) {
          expect(w, w).toBe(w.toLowerCase())
          expect(w, w).not.toMatch(/!|\p{Extended_Pictographic}/u)
        }
      }
    }
  })

  it('puts each hint sentence on exactly one control', () => {
    const everything = controls(
      radioStripModel(settings({ density: 'off', turnarounds: 'rare', foldMode: true }), CTX)
    )
    for (const sentence of Object.values(RADIO_STRIP_HINTS).flat()) {
      const on = everything.filter((c) => c.tooltip?.includes(sentence)).map((c) => c.id)
      expect(on, sentence).toHaveLength(1)
    }
  })
})

describe('radioStripModel: the sound dials are the sound panel', () => {
  function slider(
    settingsIn: Parameters<typeof soundPanelModel>[0],
    id: string
  ): SoundSliderControl {
    const c = soundPanelModel(settingsIn)
      .flatMap((r) => r.controls)
      .find((x) => x.id === id)
    if (c?.kind !== 'slider') throw new Error(id)
    return c
  }
  const cases = [
    DEFAULT_SOUND_SETTINGS,
    normalizeSoundSettings({ mastering: { on: false } }),
    normalizeSoundSettings({ pump: { on: false }, throws: { on: false } }),
    normalizeSoundSettings({ saturation: { on: true, amount: 0.4 } })
  ]

  it('greys and patches exactly as the panel does', () => {
    for (const sound of cases) {
      const g = radioStripModel(settings(), { ...CTX, sound })
      for (const [id, panelId] of [
        ['saturation', 'saturation.amount'],
        ['pump', 'pump.depthDb'],
        ['echo', 'throws.level']
      ]) {
        const c = control(g, id)
        if (c?.kind !== 'sound') throw new Error(id)
        const p = slider(sound, panelId)
        expect(c.disabled, id).toBe(p.disabled)
        expect(c.control.value, id).toBe(p.value)
        expect(c.control.patch(0.5), id).toEqual(p.patch(0.5))
      }
    }
  })

  it('says why a dial does nothing, and that it is the project sound', () => {
    const noMastering = radioStripModel(settings(), {
      ...CTX,
      sound: normalizeSoundSettings({ mastering: { on: false } })
    })
    expect(control(noMastering, 'saturation')?.tooltip).toBe('project sound · needs mastering')
    const pumpOff = radioStripModel(settings(), {
      ...CTX,
      sound: normalizeSoundSettings({ pump: { on: false } })
    })
    expect(control(pumpOff, 'pump')?.tooltip).toBe('project sound · switched off in sound')
  })

  it('maps a 0..100 dial onto the slider, on its step, both ways', () => {
    const pump = slider(DEFAULT_SOUND_SETTINGS, 'pump.depthDb')
    expect(soundDialValue(pump, 0)).toBe(pump.min)
    expect(soundDialValue(pump, 100)).toBe(pump.max)
    expect(soundDialValue(pump, 50)).toBe(4)
    expect(soundDialValue(pump, 3)).toBe(0) // 0.24 dB rounds to the 0.5 dB step's 0
    expect(soundDialValue(pump, 150)).toBe(pump.max)
    expect(soundDialPosition(pump, 4)).toBe(50)
    expect(soundDialPosition(pump, 8)).toBe(100)
    const sat = slider(DEFAULT_SOUND_SETTINGS, 'saturation.amount')
    for (let pos = 0; pos <= 100; pos += 5) {
      expect(soundDialPosition(sat, soundDialValue(sat, pos))).toBe(pos)
    }
  })
})
