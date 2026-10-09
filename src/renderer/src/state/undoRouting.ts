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
  undo: () => void
  redo: () => void
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

/**
 * Claims Cmd+Z for as long as the calling component is mounted. The handlers
 * may be fresh closures every render; the latest ones are always called,
 * and the claim itself is made once, so its place in the order holds.
 */
export function useClaimUndo(undo: () => void, redo: () => void): void {
  const latest = useRef<UndoOwner>({ undo, redo })
  useEffect(() => {
    latest.current = { undo, redo }
  })
  useEffect(
    () =>
      undoRouter.claim({
        undo: () => latest.current.undo(),
        redo: () => latest.current.redo()
      }),
    []
  )
}
