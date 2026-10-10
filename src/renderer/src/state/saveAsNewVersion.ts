// "save as a new version" (Elling, 2026-10-09): save the original first, so its last save holds
// your latest edits, then write the same project as the next numbered version and move into it.
// Both writes take the one JSON from serializeForSave (plugin settings included), and both go
// through main's library save, which clears the recovery file the way a normal save does.
import { newVersionConfirmation } from '@shared/saveCopyText'
import { saveOutcomeNotice } from './saveSerialization'

export interface SaveAsNewVersionDeps {
  /** Frame's serializeForSave: throws when the plugin settings can't be read. */
  serialize: () => Promise<string>
  /** A normal save of the original library sketch (saveProjectToLibrary). */
  saveOriginal: (name: string, json: string) => Promise<unknown>
  /** Writes the next numbered version (duplicateSketch); null when there's no such sketch. */
  writeCopy: (name: string, json: string) => Promise<{ name: string } | null>
}

/** 'done': both written, move into `copyName` and show `notice`. 'save-failed': nothing written,
 * the project stays as it was (unsaved). 'copy-failed': the original was saved (record it as
 * saved) but there's no copy, so you stay in the original. */
export type SaveAsNewVersionOutcome =
  | { kind: 'done'; copyName: string; notice: string }
  | { kind: 'save-failed'; alert: string }
  | { kind: 'copy-failed'; alert: string }

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export async function saveAsNewVersion(
  originalName: string,
  deps: SaveAsNewVersionDeps
): Promise<SaveAsNewVersionOutcome> {
  let json: string
  try {
    json = await deps.serialize()
    await deps.saveOriginal(originalName, json)
  } catch (err) {
    // The same words a failed save uses (saveOutcomeNotice), and no copy.
    return {
      kind: 'save-failed',
      alert: saveOutcomeNotice({ kind: 'failed', error: message(err) }, 'save') ?? ''
    }
  }
  try {
    const copy = await deps.writeCopy(originalName, json)
    if (copy === null) {
      return {
        kind: 'copy-failed',
        alert: `${originalName} was saved, but the new version couldn't be made`
      }
    }
    return {
      kind: 'done',
      copyName: copy.name,
      notice: newVersionConfirmation(copy.name, originalName)
    }
  } catch (err) {
    return {
      kind: 'copy-failed',
      alert: `${originalName} was saved, but the new version failed: ${message(err)}`
    }
  }
}
