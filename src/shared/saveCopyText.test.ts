import { describe, expect, it } from 'vitest'
import {
  SAVE_AS_NEW_VERSION_HINT,
  SAVE_AS_NEW_VERSION_LABEL,
  SAVE_COPY_TO_FILE_HINT,
  SAVE_COPY_TO_FILE_LABEL,
  copyToFileConfirmation,
  newVersionConfirmation
} from './saveCopyText'

describe('save menu copy', () => {
  const fixed = [
    SAVE_AS_NEW_VERSION_LABEL,
    SAVE_AS_NEW_VERSION_HINT,
    SAVE_COPY_TO_FILE_LABEL,
    SAVE_COPY_TO_FILE_HINT
  ]

  it('follows the app voice: lowercase, no exclamation marks', () => {
    for (const text of fixed) {
      expect(text).toBe(text.toLowerCase())
      expect(text).not.toContain('!')
    }
  })

  it('stays one short line', () => {
    for (const text of fixed) expect(text.length).toBeLessThanOrEqual(48)
  })

  it('says which file you are in after each', () => {
    expect(SAVE_AS_NEW_VERSION_HINT).toContain('carry on in')
    expect(SAVE_AS_NEW_VERSION_HINT).toContain('save this one')
    expect(SAVE_COPY_TO_FILE_HINT).toContain('you stay in')
  })
})

describe('newVersionConfirmation', () => {
  it('names the copy you are now in and says the original was saved first', () => {
    expect(newVersionConfirmation('misty kestrel 2', 'misty kestrel')).toBe(
      "you're now working in misty kestrel 2 · misty kestrel was saved first"
    )
  })
})

describe('copyToFileConfirmation', () => {
  it('names the file written and the project you are still in', () => {
    expect(copyToFileConfirmation('/somewhere/backup.sssketchproj', 'misty kestrel')).toBe(
      "copy saved as backup · you're still working in misty kestrel"
    )
  })

  it('falls back to "this sketch" when the project has no name yet', () => {
    expect(copyToFileConfirmation('C:\\x\\b.sssketchproj', null)).toBe(
      "copy saved as b · you're still working in this sketch"
    )
  })
})
