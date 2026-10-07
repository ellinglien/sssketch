// src/main/recoveryFileTracker.ts -- what main knows about the crash-recovery file
// (projectFile.ts's writeAutosave/clearAutosave), to decide whether a clean quit may delete it.
// Pure: index.ts feeds it events and asks shouldClearRecoveryOnCleanQuit at before-quit.
//
// A clean quit (the renderer reports nothing unsaved) deletes the file only when main itself saw
// a successful save in this window, and no autosave write since. Anything else is left for the
// next launch's recovery prompt. In particular, on macOS a window can close (Cmd+W) with an
// autosave written after the last save, and the window reopened from the Dock shows the
// recovery prompt on a renderer that is not dirty: that file is the only copy of those edits.
// A new window ('window-created') therefore starts knowing nothing.

export interface RecoveryFileState {
  /** A save (library, in place, duplicate, save as) landed since the window was created. */
  savedInThisWindow: boolean
  /** An autosave was written since the last save or clear. */
  writtenSinceSaveOrClear: boolean
}

export type RecoveryFileEvent = 'window-created' | 'saved' | 'autosave-written' | 'cleared'

export const initialRecoveryFileState: RecoveryFileState = {
  savedInThisWindow: false,
  writtenSinceSaveOrClear: false
}

export function recoveryFileStep(
  state: RecoveryFileState,
  event: RecoveryFileEvent
): RecoveryFileState {
  switch (event) {
    case 'window-created':
      return initialRecoveryFileState
    case 'saved':
      // Every save clears the file (projectFile.ts) after writing the project.
      return { savedInThisWindow: true, writtenSinceSaveOrClear: false }
    case 'autosave-written':
      return { ...state, writtenSinceSaveOrClear: true }
    case 'cleared':
      return { ...state, writtenSinceSaveOrClear: false }
  }
}

export function shouldClearRecoveryOnCleanQuit(
  state: RecoveryFileState,
  quit: { rendererDirty: boolean; quittingAfterSavePrompt: boolean }
): boolean {
  // After the quit prompt's Save, that save clears the file itself if it lands; if it failed,
  // the file is all there is.
  if (quit.rendererDirty || quit.quittingAfterSavePrompt) return false
  return state.savedInThisWindow && !state.writtenSinceSaveOrClear
}
