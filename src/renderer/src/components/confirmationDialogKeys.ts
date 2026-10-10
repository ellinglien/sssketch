// ConfirmationDialog's keyboard, pure: which button is safe (initial focus and Escape), and how
// Tab stays inside the dialog.

export interface DialogActionKind {
  label?: string
  danger?: boolean
  primary?: boolean
}

/** The action that neither destroys nor commits (cancel), else the first. */
export function safeActionIndex(actions: readonly DialogActionKind[]): number {
  const index = actions.findIndex((a) => !a.danger && !a.primary)
  return index === -1 ? 0 : index
}

export type DialogKeyAction =
  { kind: 'choose'; index: number } | { kind: 'focus'; index: number } | { kind: 'none' }

/** `focused` is the focused button's index, or -1 when focus is elsewhere in the dialog. */
export function dialogKeyAction(
  key: string,
  shift: boolean,
  focused: number,
  count: number,
  actions: readonly DialogActionKind[]
): DialogKeyAction {
  if (key === 'Escape') return { kind: 'choose', index: safeActionIndex(actions) }
  if (key === 'Tab' && count > 0) {
    if (focused < 0) return { kind: 'focus', index: shift ? count - 1 : 0 }
    return { kind: 'focus', index: (focused + (shift ? count - 1 : 1)) % count }
  }
  return { kind: 'none' }
}
