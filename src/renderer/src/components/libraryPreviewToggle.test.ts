import { describe, expect, it } from 'vitest'
import { libraryPreviewClickAction } from './libraryPreviewToggle'

describe('libraryPreviewClickAction', () => {
  it('selects and starts a different riff', () => {
    expect(libraryPreviewClickAction('a', 'a', 'b')).toBe('select-and-play')
  })

  it('stops the selected riff when it is already playing', () => {
    expect(libraryPreviewClickAction('a', 'a', 'a')).toBe('stop')
  })

  it('restarts the selected riff after it has stopped', () => {
    expect(libraryPreviewClickAction('a', null, 'a')).toBe('restart')
  })
})
