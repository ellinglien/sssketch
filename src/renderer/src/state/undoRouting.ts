import { useEffect, useRef } from 'react'

/** The parts of a keydown that decide whether it's an undo or a redo. */
export interface UndoKeyEvent {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  target: { tagName: string; type?: string } | null
}

/**
 * Cmd/Ctrl+Z is undo, Cmd/Ctrl+Shift+Z (and the Windows-style Ctrl+Y) is
 * redo. Null for anything else, and for a key typed into a TEXT field, whose
 * own undo should edit its text. A slider, checkbox or radio has no text of
 * its own and keeps focus after a drag, so it doesn't count (native radio
 * sound plan, Task 13 review: Cmd+Z right after a sound panel slider drag
 * used to do nothing).
 */
export function undoShortcutFor(e: UndoKeyEvent): 'undo' | 'redo' | null {
  const key = e.key.toLowerCase()
  const mod = e.metaKey || e.ctrlKey
  const isUndo = mod && key === 'z' && !e.shiftKey
  const isRedo = (mod && key === 'z' && e.shiftKey) || (e.ctrlKey && key === 'y')
  if (!isUndo && !isRedo) return null
  const tag = e.target?.tagName
  const textInput =
    tag === 'INPUT' && !['range', 'checkbox', 'radio'].includes(e.target?.type ?? '')
  if (textInput || tag === 'TEXTAREA') return null
  return isRedo ? 'redo' : 'undo'
}

export interface UndoOwner {
  /** `repeat`: the key is being held (KeyboardEvent.repeat). */
  undo: (repeat?: boolean) => void
  redo: (repeat?: boolean) => void
}

export interface UndoRouter {
  /** Takes Cmd+Z until the returned release is called. The newest claim wins. */
  claim: (owner: UndoOwner) => () => void
  /** Who gets Cmd+Z now, or null for the project's own history. */
  current: () => UndoOwner | null
}

/**
 * Who Cmd+Z belongs to. An overlay that has its own undo (Discover and radio,
 * Cross) claims it while it's open, so the keys drive what the person is
 * looking at instead of silently undoing arrangement edits hidden under it
 * (Ben's call, 2026-10-08). With nothing claiming, the project's history has
 * it, as before.
 */
export function createUndoRouter(): UndoRouter {
  const claims: { owner: UndoOwner }[] = []
  return {
    claim(owner) {
      const entry = { owner }
      claims.push(entry)
      return () => {
        const i = claims.indexOf(entry)
        if (i !== -1) claims.splice(i, 1)
      }
    },
    current() {
      return claims.length > 0 ? claims[claims.length - 1].owner : null
    }
  }
}

/** The app's one router: App's Cmd+Z handler asks it before the project's history. */
export const undoRouter = createUndoRouter()

export interface RepeatGate {
  /** Whether a press may run now. `repeat`: the key is being held. */
  pass: (repeat: boolean) => boolean
  /** The owner re-rendered: its handlers see the state the last press left. */
  rendered: () => void
}

/**
 * Holding Cmd+Z repeats the key faster than React re-renders, and an owner's
 * handlers close over the state of their render (Discover's undo stack): two
 * repeats before a render would both pop the same top snapshot. A repeat is
 * let through only once the owner has rendered since the last press; a fresh
 * press always is, so a press that changed nothing can't wedge the keys.
 */
export function createRepeatGate(): RepeatGate {
  let renderedSinceLastPress = true
  return {
    pass(repeat) {
      if (repeat && !renderedSinceLastPress) return false
      renderedSinceLastPress = false
      return true
    },
    rendered() {
      renderedSinceLastPress = true
    }
  }
}

/**
 * Claims Cmd+Z while the calling component is mounted and `enabled`. The
 * handlers may be fresh closures every render; the latest ones are always
 * called, a held key waits for each render (createRepeatGate), and the claim
 * itself is made once per enabling, so its place in the order holds.
 */
export function useClaimUndo(undo: () => void, redo: () => void, enabled = true): void {
  const latest = useRef({ undo, redo })
  const gate = useRef<RepeatGate | null>(null)
  if (gate.current === null) gate.current = createRepeatGate()
  useEffect(() => {
    latest.current = { undo, redo }
    gate.current?.rendered()
  })
  useEffect(() => {
    if (!enabled) return
    return undoRouter.claim({
      undo: (repeat = false) => {
        if (gate.current?.pass(repeat)) latest.current.undo()
      },
      redo: (repeat = false) => {
        if (gate.current?.pass(repeat)) latest.current.redo()
      }
    })
  }, [enabled])
}

const nothing = (): void => {}

/**
 * Takes Cmd+Z away from the project while an overlay with no undo of its own
 * is showing (the import view's browse mode), so the keys do nothing instead
 * of undoing the arrangement hidden under it.
 */
export function useBlockUndo(enabled = true): void {
  useClaimUndo(nothing, nothing, enabled)
}
