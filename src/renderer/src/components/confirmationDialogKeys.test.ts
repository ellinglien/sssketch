import { describe, expect, it } from 'vitest'
import { dialogKeyAction, safeActionIndex } from './confirmationDialogKeys'

const actions = [
  { label: 'cancel' },
  { label: 'discard', danger: true },
  { label: 'save', primary: true }
]

describe('safeActionIndex', () => {
  it('is the action that neither destroys nor commits: cancel', () => {
    expect(safeActionIndex(actions)).toBe(0)
    expect(
      safeActionIndex([{ label: 'discard', danger: true, primary: true }, { label: 'cancel' }])
    ).toBe(1)
  })

  it('falls back to the first action when every one acts', () => {
    expect(
      safeActionIndex([
        { label: 'a', primary: true },
        { label: 'b', danger: true }
      ])
    ).toBe(0)
  })
})

describe('dialogKeyAction', () => {
  it('Escape picks the safe action', () => {
    expect(dialogKeyAction('Escape', false, 2, 3, actions)).toEqual({ kind: 'choose', index: 0 })
  })

  it('Tab and Shift+Tab cycle focus inside the dialog', () => {
    expect(dialogKeyAction('Tab', false, 2, 3, actions)).toEqual({ kind: 'focus', index: 0 })
    expect(dialogKeyAction('Tab', true, 0, 3, actions)).toEqual({ kind: 'focus', index: 2 })
    expect(dialogKeyAction('Tab', false, -1, 3, actions)).toEqual({ kind: 'focus', index: 0 })
  })

  it('leaves other keys to the focused button', () => {
    expect(dialogKeyAction('Enter', false, 1, 3, actions)).toEqual({ kind: 'none' })
  })
})
