import { describe, expect, it } from 'vitest'
import { ROLE_LABELS, stemLabelsByKey } from './autoArrangeLabels'

describe('stemLabelsByKey', () => {
  it('labels a single stem by its role, with no number', () => {
    const labels = stemLabelsByKey([{ stemKey: 'a', role: 'drums', included: true }])
    expect(labels.get('a')).toBe('drums')
  })

  it('numbers stems that share a role, in list order', () => {
    const labels = stemLabelsByKey([
      { stemKey: 'a', role: 'drums', included: true },
      { stemKey: 'b', role: 'drums', included: true }
    ])
    expect(labels.get('a')).toBe('drums 1')
    expect(labels.get('b')).toBe('drums 2')
  })

  it('excludes stems not marked included from both numbering and the map', () => {
    const labels = stemLabelsByKey([
      { stemKey: 'a', role: 'drums', included: true },
      { stemKey: 'b', role: 'drums', included: false }
    ])
    expect(labels.get('a')).toBe('drums')
    expect(labels.has('b')).toBe(false)
  })

  it('falls back to the raw role string when it has no ROLE_LABELS entry', () => {
    const labels = stemLabelsByKey([{ stemKey: 'a', role: 'mystery-role', included: true }])
    expect(labels.get('a')).toBe('mystery-role')
  })

  it('uses the human ROLE_LABELS text for known roles', () => {
    expect(ROLE_LABELS.hihat).toBe('hi-hat')
  })

  it('shows every stored role as its category', () => {
    expect(ROLE_LABELS.lead).toBe('front')
    expect(ROLE_LABELS.vocal).toBe('front')
    expect(ROLE_LABELS.backing).toBe('back')
    expect(ROLE_LABELS.aux).toBe('back')
    expect(ROLE_LABELS.textureFx).toBe('back')
    expect(ROLE_LABELS.fill).toBe('drums')
  })

  it('numbers stems across a whole category', () => {
    const labels = stemLabelsByKey([
      { stemKey: 'a', role: 'backing', included: true },
      { stemKey: 'b', role: 'aux', included: true },
      { stemKey: 'c', role: 'lead', included: true }
    ])
    expect(labels.get('a')).toBe('back 1')
    expect(labels.get('b')).toBe('back 2')
    expect(labels.get('c')).toBe('front')
  })
})
