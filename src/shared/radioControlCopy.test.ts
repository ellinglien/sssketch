import { describe, expect, it } from 'vitest'
import {
  RADIO_ADD_TO_SHELF_TOOLTIP,
  RADIO_ADD_TO_TIMELINE_TOOLTIP,
  RADIO_KEEP_TOOLTIP,
  RADIO_LIKE_TOOLTIP,
  DISCOVER_LIKE_TOOLTIP,
  RADIO_TURN_TOOLTIP,
  SOURCE_DIAL_LEFT_LABEL,
  SOURCE_DIAL_RIGHT_LABEL,
  SOURCE_DIAL_TOOLTIP
} from './radioControlCopy'
import { RADIO_GUIDE } from './radioGuide'

const all = [
  RADIO_ADD_TO_SHELF_TOOLTIP,
  RADIO_ADD_TO_TIMELINE_TOOLTIP,
  RADIO_KEEP_TOOLTIP,
  RADIO_LIKE_TOOLTIP,
  DISCOVER_LIKE_TOOLTIP,
  RADIO_TURN_TOOLTIP,
  SOURCE_DIAL_LEFT_LABEL,
  SOURCE_DIAL_RIGHT_LABEL,
  SOURCE_DIAL_TOOLTIP
]

/** Every guide item's text, flattened, whatever the section shapes. */
function guideTexts(): string[] {
  const out: string[] = []
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>
      if (typeof o.key === 'string' && typeof o.text === 'string') out.push(o.text)
      Object.values(o).forEach(walk)
    }
  }
  walk(RADIO_GUIDE)
  return out
}

describe('radio and discover control tooltips', () => {
  it('follow the app voice: lowercase, no exclamation marks', () => {
    for (const text of all) {
      expect(text).toBe(text.toLowerCase())
      expect(text).not.toContain('!')
    }
  })

  it("say what keep does in the radio guide's own words", () => {
    expect(guideTexts()).toContain(RADIO_KEEP_TOOLTIP)
    expect(guideTexts()).toContain(RADIO_TURN_TOOLTIP)
    expect(guideTexts()).toContain(SOURCE_DIAL_TOOLTIP)
  })

  it('tell keep (your library) apart from the adds (this project)', () => {
    expect(RADIO_KEEP_TOOLTIP).toContain('library')
    expect(RADIO_ADD_TO_SHELF_TOOLTIP).toContain('this project')
    expect(RADIO_ADD_TO_TIMELINE_TOOLTIP).toContain('this project')
  })

  it('name both ends of the source dial: instruments to the left, recorded to the right', () => {
    expect(SOURCE_DIAL_LEFT_LABEL).toBe('instruments')
    expect(SOURCE_DIAL_RIGHT_LABEL).toBe('recorded')
    expect(SOURCE_DIAL_TOOLTIP).toContain(SOURCE_DIAL_LEFT_LABEL)
    expect(SOURCE_DIAL_TOOLTIP).toContain(SOURCE_DIAL_RIGHT_LABEL)
    expect(SOURCE_DIAL_TOOLTIP).toContain('audio-in')
    expect(SOURCE_DIAL_TOOLTIP).not.toContain('other')
  })
})
