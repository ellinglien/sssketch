import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  RADIO_GUIDE,
  RADIO_GUIDE_BUTTON,
  RADIO_GUIDE_LABEL,
  RADIO_GUIDE_WEB_START_PACE,
  radioGuideFor,
  radioGuideWave,
  type RadioGuideApp,
  type RadioGuideBars,
  type RadioGuideFigure,
  type RadioGuideItem
} from './radioGuide'
import { radioStripModel } from './radioStripModel'
import { RADIO_ROW_PARTS, type RadioRowPart } from './radioView'
import {
  DEFAULT_RADIO_DENSITY,
  DEFAULT_RADIO_SETTINGS,
  RADIO_DENSITY_OPTIONS,
  RADIO_PHRASE_OPTIONS
} from './radioSchedule'
import { normalizeSoundSettings } from './radioSound'
import {
  DEFAULT_RADIO_PACE_LEVEL,
  RADIO_PACE_ANCHORS,
  RADIO_PACE_BAR_BANDS,
  RADIO_PACE_PHRASE_CAPS,
  RADIO_PACE_ROWS_FROM,
  radioPaceLabel,
  radioPacePhraseBars,
  radioPaceProfile
} from './radioPace'
import {
  TURNAROUND_CHANCE,
  TURNAROUND_DEFAULT_PHRASE_BARS,
  TURNAROUND_FAMILIES,
  TURNAROUND_GAP_WORD,
  TURNAROUND_MOVE_LABEL,
  TURNAROUND_MOVES
} from './radioTurnaround'
import { RADIO_DIG_TOOLTIP, RADIO_HOOK_TOOLTIP, radioHookPaceScale } from './radioHooks'
import { radioBreakdownDepth } from './radioIntensityArc'

/**
 * The radio's `?` guide is the one place a listener reads how radio works, in both apps. It goes
 * wrong by drifting: a control is renamed, a threshold retuned, and the guide keeps saying the old
 * thing. These hold its voice (the copy rules), every control it names to a real control, and its
 * claims to the code they describe.
 */

const APPS: readonly RadioGuideApp[] = ['desktop', 'web']

/** Every string a listener reads, in both apps. */
function allCopy(): string[] {
  const out: string[] = [RADIO_GUIDE.title, RADIO_GUIDE.lede, RADIO_GUIDE.foot]
  const figure = (f: RadioGuideFigure): void => {
    out.push(f.alt)
    if (f.type === 'bars') {
      for (const l of f.labels ?? []) out.push(l.text)
      for (const l of f.lanes) if (l.label !== undefined) out.push(l.label)
    } else for (const w of f.words) out.push(w.text)
  }
  for (const app of APPS) {
    for (const s of radioGuideFor(app).sections) {
      out.push(s.eyebrow, s.heading)
      for (const b of s.blocks) {
        if (b.type === 'text') out.push(b.text)
        else if (b.type === 'figure') {
          out.push(b.caption)
          figure(b.figure)
        } else {
          if (b.type === 'keys' && b.title !== undefined) out.push(b.title)
          for (const i of b.items) {
            out.push(i.key, i.text)
            if (i.figure) figure(i.figure)
          }
        }
      }
    }
  }
  return out
}

function itemsIn(app: RadioGuideApp, controlsOnly: boolean): RadioGuideItem[] {
  return radioGuideFor(app).sections.flatMap((s) =>
    s.blocks.flatMap((b) => (b.type === 'keys' && (!controlsOnly || b.controls) ? b.items : []))
  )
}

const textOf = (app: RadioGuideApp): string =>
  radioGuideFor(app)
    .sections.flatMap((s) =>
      s.blocks.flatMap((b) =>
        b.type === 'text'
          ? [b.text]
          : b.type === 'figure'
            ? [b.caption]
            : b.items.flatMap((i) => [i.key, i.text])
      )
    )
    .join('\n')

describe('the radio guide: the copy rules', () => {
  it('is lowercase, with no exclamation marks and no emoji', () => {
    for (const s of allCopy()) {
      expect(s, s).toBe(s.toLowerCase())
      expect(s, s).not.toMatch(/!/)
      expect(s, s).not.toMatch(/\p{Extended_Pictographic}/u)
      expect(s.trim(), s).not.toBe('')
    }
  })

  it('every heading is lowercase, in both apps', () => {
    for (const app of APPS) {
      for (const s of radioGuideFor(app).sections) {
        expect(s.heading).toBe(s.heading.toLowerCase())
        expect(s.eyebrow).toBe(s.eyebrow.toLowerCase())
      }
    }
  })

  it('has the sections asked for, in order', () => {
    expect(RADIO_GUIDE.sections.map((s) => s.id)).toEqual([
      'loops',
      'pace',
      'turnarounds',
      'intensity',
      'hooks',
      'fold',
      'throws',
      'steer',
      'views'
    ])
    expect(radioGuideFor('desktop').sections.at(-1)?.heading).toBe('simple and advanced')
    expect(radioGuideFor('web').sections.at(-1)?.heading).toBe('simple and full')
  })

  it('names its button and says what it opens', () => {
    expect(RADIO_GUIDE_BUTTON).toBe('?')
    expect(RADIO_GUIDE_LABEL).toBe('how radio works')
  })

  it('leaves out what belongs to the other app', () => {
    const desktop = textOf('desktop')
    const web = textOf('web')
    expect(desktop).toContain('new bed')
    expect(web).not.toContain('new bed')
    expect(web).toContain('hold')
    expect(desktop).toContain('change soon')
    expect(web).toContain('less of')
    expect(web).not.toContain('change soon')
  })
})

describe('the radio guide: every control it names exists', () => {
  const model = radioStripModel(
    { ...DEFAULT_RADIO_SETTINGS, density: 'intensity', foldMode: true },
    {
      artistMode: false,
      hasUsername: true,
      sound: normalizeSoundSettings(undefined),
      sounding: true
    }
  )
  const strip = model.flatMap((g) => g.controls)
  const rowSource = readFileSync(
    fileURLToPath(new URL('../renderer/src/components/DiscoverSlotRow.tsx', import.meta.url)),
    'utf8'
  )
  /** A row part's words, and how the row's source names each (a tooltip or an aria-label). */
  const ROW_WORDS: Readonly<Record<string, readonly string[]>> = {
    'mute-solo': ['mute', 'solo'],
    skip: ['skip'],
    like: ['like'],
    'change-soon': ['change soon'],
    'hook-dig': [RADIO_HOOK_TOOLTIP.split(':')[0], RADIO_DIG_TOOLTIP.split(':')[0]]
  }

  it('names a control in every app a control line shows in', () => {
    for (const app of APPS) {
      const items = itemsIn(app, true)
      expect(items.length).toBeGreaterThan(0)
      for (const i of items) {
        const refs = app === 'desktop' ? i.desktop : i.web
        expect(refs?.length ?? 0, `${app}: ${i.key}`).toBeGreaterThan(0)
      }
    }
  })

  it('every desktop strip control is in radioStripModel, under the word the guide uses', () => {
    for (const i of itemsIn('desktop', true)) {
      for (const ref of i.desktop ?? []) {
        if (!('strip' in ref)) continue
        const c = strip.find((x) => x.id === ref.strip)
        expect(c, `${i.key}: ${ref.strip}`).toBeDefined()
        expect(i.key, ref.strip).toContain(c!.label.split(' · ')[0])
      }
    }
  })

  it('every desktop row button is a radio row part, and the row still calls it that', () => {
    for (const i of itemsIn('desktop', true)) {
      for (const ref of i.desktop ?? []) {
        if (!('row' in ref)) continue
        expect(RADIO_ROW_PARTS).toContain(ref.row)
        const wordsOf = ROW_WORDS[ref.row as RadioRowPart]
        expect(wordsOf, ref.row).toBeDefined()
        expect(
          wordsOf.some((w) => i.key.includes(w)),
          `${i.key} names ${ref.row}`
        ).toBe(true)
        for (const w of wordsOf) {
          // the hook and dig words are the shared tooltips' own; the rest are in the row's source
          if (ref.row === 'hook-dig') continue
          expect(rowSource, w).toMatch(new RegExp(`['"]${w}['"]`))
        }
      }
    }
  })

  it('every row button the simple view shows is in the guide', () => {
    const named = new Set(
      itemsIn('desktop', true).flatMap((i) =>
        (i.desktop ?? []).flatMap((r) => ('row' in r ? [r.row] : []))
      )
    )
    for (const part of ['mute-solo', 'skip', 'like', 'change-soon', 'hook-dig'] as const) {
      expect(named.has(part), part).toBe(true)
    }
  })

  it('the desktop says a build-up pays off only with builds sized, its default; the web always', () => {
    const builds = strip.find((c) => c.id === 'builds')
    expect(builds?.label).toBe('builds')
    expect(builds?.kind === 'chips' ? builds.chips.map((c) => c.label) : []).toContain('sized')
    expect(DEFAULT_RADIO_SETTINGS.sizedBuilds).toBe(true)
    expect(textOf('desktop')).toContain(
      'with builds sized (the default), a build-up always pays off'
    )
    expect(textOf('web')).toContain('a build-up always pays off')
    expect(textOf('web')).not.toContain('builds sized')
  })

  it('the density line names every density option', () => {
    const density = itemsIn('web', true).find((i) => i.key === 'density')
    for (const d of RADIO_DENSITY_OPTIONS) {
      expect(density?.web).toContain(d)
      expect(density?.text).toContain(d)
    }
  })
})

describe('the radio guide: its claims match the code', () => {
  it('names every turnaround move, by its chip, and the gap', () => {
    const cards = RADIO_GUIDE.sections
      .find((s) => s.id === 'turnarounds')!
      .blocks.flatMap((b) => (b.type === 'cards' ? b.items.map((i) => i.key) : []))
    expect(cards).toEqual([
      ...TURNAROUND_MOVES.map((m) => TURNAROUND_MOVE_LABEL[m]),
      TURNAROUND_GAP_WORD
    ])
  })

  it('the wash card names the rows a wash is on (radioTurnaround bedOf: the leaving row, else a hook going out, else all but the drums)', () => {
    const wash = RADIO_GUIDE.sections
      .find((s) => s.id === 'turnarounds')!
      .blocks.flatMap((b) => (b.type === 'cards' ? b.items : []))
      .find((i) => i.key === TURNAROUND_MOVE_LABEL.wash)
    expect(wash?.text).toContain('the row about to leave')
    expect(wash?.text).toContain('a hook on its way out')
    expect(wash?.text).toContain('with neither, all but the drums')
  })

  it('the web turnaround line names every family', () => {
    for (const f of TURNAROUND_FAMILIES) expect(textOf('web')).toContain(f)
  })

  it('rare and often are one phrase end in three and two in three', () => {
    expect(TURNAROUND_CHANCE.rare).toBeCloseTo(1 / 3)
    expect(TURNAROUND_CHANCE.often).toBeCloseTo(2 / 3)
    expect(textOf('desktop')).toContain('rare: one phrase end in three, often: two in three')
  })

  it('the pace lines hold at their levels', () => {
    const at = radioPaceProfile
    // up to 70 one row per change, above it more
    expect(at(RADIO_PACE_ROWS_FROM).rows).toBe(1)
    expect(at(RADIO_PACE_ROWS_FROM + 1).rows).toBeGreaterThan(1)
    expect(at(100).rows).toBe(4)
    // above 70 any loop top (no phrase grid); 8 then 4 bars before that
    expect(at(RADIO_PACE_ROWS_FROM + 1).phraseCap).toBe(0)
    expect(RADIO_PACE_PHRASE_CAPS.map(([, b]) => b)).toEqual([8, 4])
    expect(at(RADIO_PACE_ANCHORS.fast).phraseCap).toBeNull()
    // mid-loop bar lines from 80: 4, 2, 1
    expect(at(RADIO_PACE_BAR_BANDS[0][0] - 1).barEvery).toBeNull()
    expect(RADIO_PACE_BAR_BANDS.map(([, b]) => b)).toEqual([4, 2, 1])
    expect(at(RADIO_PACE_BAR_BANDS[0][0]).barEvery).toBe(4)
    // ludicrous: every bar
    expect(at(RADIO_PACE_ANCHORS.ludicrous).window).toEqual({ min: 1, max: 1 })
    const pace = itemsIn('desktop', false)
    expect(pace.find((i) => i.key === '0 slow')?.text).toContain('24 to 48 bars')
    expect(pace.find((i) => i.key === '25 mid')?.text).toContain('8 to 16 bars')
    expect(pace.find((i) => i.key === '50 fast')?.text).toContain('3 to 6 bars')
    expect(pace.find((i) => i.key === '90 ludicrous')?.text).toBe('something changes every bar')
  })

  it('the desktop starts where it says: its default pace and density', () => {
    const t = textOf('desktop')
    expect(DEFAULT_RADIO_SETTINGS.paceLevel).toBe(DEFAULT_RADIO_PACE_LEVEL)
    expect(DEFAULT_RADIO_SETTINGS.density).toBe(DEFAULT_RADIO_DENSITY)
    expect(t).toContain(`sssketch starts at ${radioPaceLabel(DEFAULT_RADIO_PACE_LEVEL)}.`)
    expect(t).toContain(`sssketch starts on ${DEFAULT_RADIO_DENSITY};`)
  })

  it('the web starts where it says: its window and its phrase at that level', () => {
    // ell.ing/radio's guide.test.ts holds RADIO_GUIDE_WEB_START_PACE to its DEFAULT_WEB_PACE_LEVEL
    const p = radioPaceProfile(RADIO_GUIDE_WEB_START_PACE)
    const t = textOf('web')
    expect(t).not.toContain('starts at fast')
    expect(t).toContain(
      `this radio starts at ${RADIO_GUIDE_WEB_START_PACE}: a change every ${p.window.min} to ${p.window.max} bars`
    )
    expect(t).toContain(
      `the next ${radioPacePhraseBars(p, TURNAROUND_DEFAULT_PHRASE_BARS)}-bar phrase.`
    )
  })

  it('the phrase options are the ones the desktop line names', () => {
    expect(RADIO_PHRASE_OPTIONS).toEqual([0, 16, 32])
  })

  it('hook lengths are at fast pace: longer when slower, half at the quickest', () => {
    expect(radioHookPaceScale(RADIO_PACE_ANCHORS.fast)).toBe(1)
    expect(radioHookPaceScale(0)).toBeGreaterThan(1)
    expect(radioHookPaceScale(100)).toBe(0.5)
    expect(textOf('desktop')).toContain('it plays for 16 to 32 bars')
  })

  it('a hook comes back on a phrase start, preferring one where something else changes (radioHooks)', () => {
    for (const app of APPS) {
      const t = textOf(app)
      expect(t).toContain(
        'it comes back on a phrase start, preferring one where something else changes too, so its return lands as the drop.'
      )
      expect(t).not.toContain('where it can on one')
    }
  })

  it('the drama thresholds are the breakdown depths the guide describes', () => {
    expect(radioBreakdownDepth(24, false)).toBe('swell')
    expect(radioBreakdownDepth(25, false)).toBe('thin')
    expect(radioBreakdownDepth(59, false)).toBe('thin')
    expect(radioBreakdownDepth(60, false)).toBe('full')
    const drama = itemsIn('desktop', true).find((i) => i.key === 'drama')
    expect(drama?.text).toContain('under 25')
    expect(drama?.text).toContain('from 60')
  })
})

describe('the radio guide: the diagrams', () => {
  const figures: RadioGuideFigure[] = RADIO_GUIDE.sections.flatMap((s) =>
    s.blocks.flatMap((b) =>
      b.type === 'figure'
        ? [b.figure]
        : b.type === 'cards'
          ? b.items.flatMap((i) => (i.figure ? [i.figure] : []))
          : []
    )
  )

  it('every bars figure has lanes of one length, values in 0..1, positions in 0..1', () => {
    const bars = figures.filter((f): f is RadioGuideBars => f.type === 'bars')
    expect(bars.length).toBeGreaterThan(5)
    for (const f of bars) {
      const n = f.lanes[0].cells.length
      for (const l of f.lanes) {
        expect(l.cells).toHaveLength(n)
        for (const c of l.cells) {
          expect(c.v).toBeGreaterThanOrEqual(0)
          expect(c.v).toBeLessThanOrEqual(1)
          expect(c.a).toBeGreaterThanOrEqual(0)
          expect(c.a).toBeLessThanOrEqual(1)
        }
      }
      for (const p of [
        ...(f.lines ?? []).map((l) => l.at),
        ...(f.labels ?? []).map((l) => l.at),
        ...(f.ramp ? [f.ramp.from, f.ramp.to] : [])
      ]) {
        expect(p).toBeGreaterThanOrEqual(0)
        expect(p).toBeLessThanOrEqual(1)
      }
    }
  })

  it('colour is for sound only: the intensity wave, not a sound, is drawn in ink', () => {
    const intensity = RADIO_GUIDE.sections
      .find((s) => s.id === 'intensity')!
      .blocks.flatMap((b) => (b.type === 'figure' && b.figure.type === 'bars' ? [b.figure] : []))
    expect(intensity).toHaveLength(1)
    expect(intensity[0].lanes.map((l) => l.kind)).toEqual(['ink'])
    // every other lane is a sound's
    const others = figures.filter(
      (f): f is RadioGuideBars => f.type === 'bars' && f !== intensity[0]
    )
    for (const f of others) for (const l of f.lanes) expect(l.kind).not.toBe('ink')
  })

  it('the pace scale climbs from slow to 100', () => {
    const scale = figures.find((f) => f.type === 'scale')
    expect(scale?.type).toBe('scale')
    if (scale?.type !== 'scale') return
    for (let i = 1; i < scale.values.length; i++) {
      expect(scale.values[i]).toBeGreaterThanOrEqual(scale.values[i - 1])
    }
    expect(scale.words.map((w) => w.text)).toEqual(['slow', 'mid', 'fast', 'ludicrous'])
  })

  it('the pace scale ticks the levels the pace list starts its lines at', () => {
    const scale = figures.find((f) => f.type === 'scale')
    if (scale?.type !== 'scale') throw new Error('no pace scale')
    const pace = RADIO_GUIDE.sections.find((s) => s.id === 'pace')!
    const starts = new Set(
      pace.blocks.flatMap((b) => (b.type === 'keys' ? b.items.map((i) => parseInt(i.key, 10)) : []))
    )
    for (const t of scale.ticks.filter((t) => t !== 100))
      expect(starts.has(t), String(t)).toBe(true)
  })

  it('draws the same waveform every time', () => {
    expect(radioGuideWave('drums', 12)).toEqual(radioGuideWave('drums', 12))
    expect(JSON.stringify(RADIO_GUIDE)).toBe(JSON.stringify(RADIO_GUIDE))
  })
})
