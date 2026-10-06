// The radio view's simple and advanced views (spec 2026-10-05-radio-simple-view-design):
// radioView.ts. Simple's lists are pinned here, so a control added to the strip model does not
// silently land in simple; advanced is the strip model's own places (its coverage test runs there,
// radioStripModel.test.ts).
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RADIO_VIEW,
  RADIO_LOCK_MARK_TOOLTIP,
  RADIO_ROW_PARTS,
  RADIO_SIMPLE_LIVE,
  RADIO_VIEWS,
  RADIO_VIEW_TOOLTIP,
  normalizeRadioView,
  radioRowParts,
  radioViewStrip,
  type RadioView
} from './radioView'
import { radioStripModel, type RadioStripContext, type RadioStripGroup } from './radioStripModel'
import { DEFAULT_RADIO_SETTINGS, RADIO_DENSITY_OPTIONS, type RadioSettings } from './radioSchedule'
import { RADIO_TURNAROUNDS_OPTIONS } from './radioTurnaround'
import { DEFAULT_SOUND_SETTINGS } from './radioSound'

const CTX: RadioStripContext = {
  artistMode: false,
  hasUsername: true,
  sound: DEFAULT_SOUND_SETTINGS,
  sounding: true
}

function settings(over: Partial<RadioSettings> = {}): RadioSettings {
  return { ...DEFAULT_RADIO_SETTINGS, ...over }
}

function view(s: RadioSettings, v: RadioView): ReturnType<typeof radioViewStrip> {
  return radioViewStrip(radioStripModel(s, CTX), v, s)
}

const ids = (cs: readonly { id: string }[]): string[] => cs.map((c) => c.id)

/** Every state the strip's visibility rules turn on. */
const STATES: RadioSettings[] = RADIO_DENSITY_OPTIONS.flatMap((density) =>
  RADIO_TURNAROUNDS_OPTIONS.flatMap((turnarounds) =>
    [false, true].map((foldMode) => settings({ density, turnarounds, foldMode }))
  )
)

describe('radioView: the setting', () => {
  it('is simple by default, and an unknown value reads as simple', () => {
    expect(DEFAULT_RADIO_VIEW).toBe('simple')
    expect(RADIO_VIEWS).toEqual(['simple', 'advanced'])
    expect(normalizeRadioView('advanced')).toBe('advanced')
    expect(normalizeRadioView('simple')).toBe('simple')
    expect(normalizeRadioView(undefined)).toBe('simple')
    expect(normalizeRadioView('full')).toBe('simple')
    expect(normalizeRadioView(1)).toBe('simple')
  })

  it('words its switch and the lock mark in lowercase, no emoji, no exclamation mark', () => {
    for (const w of [
      ...Object.values(RADIO_VIEW_TOOLTIP),
      RADIO_LOCK_MARK_TOOLTIP,
      ...RADIO_VIEWS
    ]) {
      expect(w, w).toBe(w.toLowerCase())
      expect(w, w).not.toMatch(/!|\p{Extended_Pictographic}/u)
    }
  })
})

describe('radioView: advanced is the strip model, unchanged', () => {
  it('draws every group in its own place, every control, the move chips', () => {
    for (const s of STATES) {
      const groups = radioStripModel(s, CTX)
      const at = (place: RadioStripGroup['place']): RadioStripGroup[] =>
        groups.filter((g) => g.place === place)
      const a = view(s, 'advanced')
      expect(ids(a.top)).toEqual(ids(at('top').flatMap((g) => g.controls)))
      expect(ids(a.live)).toEqual(ids(at('live').flatMap((g) => g.controls)))
      expect(a.columns.map((g) => g.id)).toEqual(at('columns').map((g) => g.id))
      expect(a.moveChips).toBe(true)
      const drawn = [...a.top, ...a.live, ...a.columns.flatMap((g) => g.controls)]
      expect(ids(drawn).sort()).toEqual(ids(groups.flatMap((g) => g.controls)).sort())
    }
  })

  it('draws every row part but the lock mark, locked or not', () => {
    for (const locked of [false, true]) {
      expect([...radioRowParts('advanced', { locked })]).toEqual(
        RADIO_ROW_PARTS.filter((p) => p !== 'lock-mark')
      )
    }
  })
})

describe('radioView: simple, pinned', () => {
  it('keeps only keep on the top line', () => {
    for (const s of STATES) expect(ids(view(s, 'simple').top)).toEqual(['keep'])
  })

  it('draws the live bar: the play controls, and the arc and its dials with density intensity', () => {
    for (const s of STATES) {
      const live = ids(view(s, 'simple').live)
      if (s.density === 'intensity') {
        expect(live).toEqual([
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
        ])
      } else {
        expect(live).toEqual(['tempo', 'pace', 'skip', 'new-bed', 'turn', 'level'])
      }
    }
  })

  it('has no move chips and no columns', () => {
    for (const s of STATES) {
      const v = view(s, 'simple')
      expect(v.moveChips).toBe(false)
      expect(v.columns).toEqual([])
    }
  })

  it('names only controls the strip model has: a renamed id fails here, not on screen', () => {
    const all = ids(
      radioStripModel(settings({ density: 'intensity' }), CTX).flatMap((g) => g.controls)
    )
    for (const id of [...RADIO_SIMPLE_LIVE, 'keep']) expect(all, id).toContain(id)
  })

  it('sets only pace, energy and drama: a setting added to the strip stays in advanced', () => {
    const sets = new Set(
      view(settings({ density: 'intensity' }), 'simple').live.flatMap((c) => [...c.sets])
    )
    expect([...sets].sort()).toEqual(['drama', 'energy', 'paceLevel'])
  })

  it('passes the model controls through as they are (greyed, tooltips, patches)', () => {
    const s = settings({ density: 'intensity' })
    const model = radioStripModel(s, { ...CTX, sounding: false })
    const simple = radioViewStrip(model, 'simple', s)
    const all = model.flatMap((g) => g.controls)
    for (const c of simple.live) expect(c).toBe(all.find((x) => x.id === c.id))
    expect(simple.live.find((c) => c.id === 'level')?.disabled).toBe(true)
  })

  it('draws the live cluster and the label on a row', () => {
    expect([...radioRowParts('simple', { locked: false })]).toEqual([
      'mute-solo',
      'skip',
      'like',
      'change-soon',
      'hook-dig',
      'kind'
    ])
  })

  it('shows a locked row its lock, as a mark and never the button', () => {
    const p = radioRowParts('simple', { locked: true })
    expect(p.has('lock-mark')).toBe(true)
    expect(p.has('lock')).toBe(false)
    expect(radioRowParts('simple', { locked: false }).has('lock-mark')).toBe(false)
  })

  it('hides the extras, the kinds menu and the meter', () => {
    for (const locked of [false, true]) {
      const p = radioRowParts('simple', { locked })
      for (const hidden of [
        'any-stem',
        'nearby',
        'duplicate',
        'kind-menu',
        'meter',
        'lock',
        'remove'
      ] as const) {
        expect(p.has(hidden), hidden).toBe(false)
      }
    }
  })
})
