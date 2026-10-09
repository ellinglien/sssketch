// The save menu's two copy items, and what each says once it's done (Ben, the 2026-10-08 call:
// after "save a copy" he wasn't sure which file he was in, or whether the original was saved).
//
// What they do, unchanged:
// - "save as a new version" (duplicateSketch) writes the live project, unsaved edits included,
//   as the next numbered version, and switches the window to it. The original isn't written: it
//   keeps what it last saved.
// - "save a copy to a file…" (saveProject) writes the live project to a file you pick and leaves
//   you where you were. Nothing about the current project changes, its unsaved state included.

export const SAVE_AS_NEW_VERSION_LABEL = 'save as a new version'
export const SAVE_AS_NEW_VERSION_HINT = 'carry on in a copy · the original stays as saved'

export const SAVE_COPY_TO_FILE_LABEL = 'save a copy to a file…'
export const SAVE_COPY_TO_FILE_HINT = 'write a copy anywhere · you stay in this one'

export function newVersionConfirmation(copyName: string, originalName: string): string {
  return `you're now working in ${copyName} · ${originalName} keeps its last save`
}

export function copyToFileConfirmation(filePath: string, currentName: string | null): string {
  const base = filePath.split(/[\\/]/).pop() ?? filePath
  const fileName = base.replace(/\.sssketchproj$/i, '')
  return `copy saved as ${fileName} · you're still working in ${currentName ?? 'this sketch'}`
}
