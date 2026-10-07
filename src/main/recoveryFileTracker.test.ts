import { describe, expect, it } from 'vitest'
import {
  initialRecoveryFileState,
  recoveryFileStep,
  shouldClearRecoveryOnCleanQuit,
  type RecoveryFileEvent,
  type RecoveryFileState
} from './recoveryFileTracker'

function after(events: RecoveryFileEvent[]): RecoveryFileState {
  return events.reduce(recoveryFileStep, initialRecoveryFileState)
}

const clean = { rendererDirty: false, quittingAfterSavePrompt: false }

describe('shouldClearRecoveryOnCleanQuit', () => {
  it('clears after a save with no autosave written since', () => {
    expect(shouldClearRecoveryOnCleanQuit(after(['window-created', 'saved']), clean)).toBe(true)
  })

  it('leaves a recovery file written after the last save', () => {
    const state = after(['window-created', 'saved', 'autosave-written'])
    expect(shouldClearRecoveryOnCleanQuit(state, clean)).toBe(false)
  })

  it('save, edit (autosave), close the window, reopen (the prompt shows), quit: kept', () => {
    const state = after(['window-created', 'saved', 'autosave-written', 'window-created'])
    expect(shouldClearRecoveryOnCleanQuit(state, clean)).toBe(false)
  })

  it('a save in the reopened window makes a clean quit clear again', () => {
    const state = after(['window-created', 'saved', 'autosave-written', 'window-created', 'saved'])
    expect(shouldClearRecoveryOnCleanQuit(state, clean)).toBe(true)
  })

  it('a save after the last autosave write clears it', () => {
    const state = after(['window-created', 'saved', 'autosave-written', 'saved'])
    expect(shouldClearRecoveryOnCleanQuit(state, clean)).toBe(true)
  })

  it('nothing saved in this window: a previous session`s file is left alone', () => {
    expect(shouldClearRecoveryOnCleanQuit(after(['window-created']), clean)).toBe(false)
    expect(
      shouldClearRecoveryOnCleanQuit(
        after(['window-created', 'autosave-written', 'cleared']),
        clean
      )
    ).toBe(false)
  })

  it('a clear after the write (edits undone, the renderer cleared it) and a save before: clears', () => {
    const state = after(['window-created', 'saved', 'autosave-written', 'cleared'])
    expect(shouldClearRecoveryOnCleanQuit(state, clean)).toBe(true)
  })

  it('never while the renderer reports unsaved work, or after the quit prompt`s save', () => {
    const state = after(['window-created', 'saved'])
    expect(
      shouldClearRecoveryOnCleanQuit(state, { rendererDirty: true, quittingAfterSavePrompt: false })
    ).toBe(false)
    expect(
      shouldClearRecoveryOnCleanQuit(state, { rendererDirty: false, quittingAfterSavePrompt: true })
    ).toBe(false)
  })
})
