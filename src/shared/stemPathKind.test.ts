import { describe, expect, it } from 'vitest'
import { isLibraryStemName } from './stemPathKind'

describe('isLibraryStemName', () => {
  it('is true for a 32-hex StemCID', () => {
    expect(isLibraryStemName('0123456789abcdef0123456789abcdef')).toBe(true)
  })

  it('is false for any name with a dot: drag-imported, baked and loop-folder files', () => {
    expect(isLibraryStemName('x.wav')).toBe(false)
    expect(isLibraryStemName('0123456789abcdef0123456789abcdef.baked.wav')).toBe(false)
    expect(isLibraryStemName('loop.aif')).toBe(false)
  })
})
