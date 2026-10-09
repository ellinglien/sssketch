const LAST_SELECTED_JAM_STORAGE_KEY = 'sssketch:lastSelectedImportJam'

type JamSelectionStorage = Pick<Storage, 'getItem' | 'setItem'>

/** The Import browser is mounted fresh every time its modal opens. Keep the
 * last real jam selection outside project state so moving between projects
 * or restarting the app returns to the same browsing location without
 * putting a machine-specific UI preference into saved project files. */
export function loadLastSelectedImportJam(
  storage: JamSelectionStorage = localStorage
): string | null {
  try {
    const stored = storage.getItem(LAST_SELECTED_JAM_STORAGE_KEY)?.trim()
    return stored ? stored : null
  } catch {
    return null
  }
}

/** Null means the user temporarily moved to a linked loop folder, not that
 * they deliberately forgot their last jam, so only concrete jam choices
 * replace the saved value. */
export function storeLastSelectedImportJam(
  jamCID: string | null,
  storage: JamSelectionStorage = localStorage
): void {
  if (!jamCID) return
  try {
    storage.setItem(LAST_SELECTED_JAM_STORAGE_KEY, jamCID)
  } catch {
    // A disabled/full localStorage must never prevent browsing.
  }
}
