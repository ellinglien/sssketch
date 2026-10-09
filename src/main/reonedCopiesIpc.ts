// The IPC surface of the re-oned copies cleanup (docs/superpowers/specs/
// 2026-10-09-reoned-copies-cleanup-design.md): the open-time and retry rebuilds, the library
// check behind the gear item, the survey behind the launch notice, the clean, and "not now".
// Wiring only; the rules live in reonedRebuild.ts, reonedUsage.ts and reonedCopiesStore.ts.
// Registered from index.ts. Every handler with an unreachable library answers
// "library-missing" (or false) before reading anything else.
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { app, type IpcMain } from 'electron'
import type { ReonedRepairBatch, ReonedRepairOutcome } from '@shared/reonedRepair'
import type { ReonedCleanResult, ReonedSurvey } from '@shared/reonedCleanup'
import { rebuildReonedCopies } from './reonedRebuild'
import { cleanBakes, collectUsedNames, surveyBakes, type UsedScan } from './reonedUsage'
import { knownProjects, notNowUntil, setNotNow } from './reonedCopiesStore'
import { sessionKeptNames } from './reonedCopiesSession'
import { bakeAssetsDir, libraryRootPath } from './projectLibrary'
import { AUTOSAVE_FILENAME, AUTOSAVE_PREVIOUS_FILENAME } from './projectFile'

async function libraryAvailable(): Promise<boolean> {
  try {
    await access(libraryRootPath())
    return true
  } catch {
    return false
  }
}

const isString = (v: unknown): v is string => typeof v === 'string'
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(isString) : []
}

/** Drops anything malformed, so a bad call from the renderer bakes nothing it didn't mean. */
function validBatches(value: unknown): ReonedRepairBatch[] {
  if (!Array.isArray(value)) return []
  const batches: ReonedRepairBatch[] = []
  for (const b of value as Partial<ReonedRepairBatch>[]) {
    if (!isString(b?.groupId) || !Array.isArray(b.stems)) continue
    const stems = b.stems.filter(
      (s) =>
        isString(s?.path) &&
        isString(s.sourcePath) &&
        Array.isArray(s.rotationSecCandidates) &&
        s.rotationSecCandidates.every(isNumber) &&
        isNumber(s.phaseBars) &&
        isNumber(s.barLength)
    )
    if (stems.length > 0) batches.push({ groupId: b.groupId, stems })
  }
  return batches
}

/** The used set from scratch: library projects and backups, the autosave and its aside
 * snapshot, remembered outside projects (read fresh), what the renderer holds, and this
 * session's copies and project names (read again inside the lock by cleanBakes). */
function scanUsed(inMemoryNames: string[]): Promise<UsedScan> {
  const userData = app.getPath('userData')
  return collectUsedNames({
    libraryRoot: libraryRootPath(),
    userDataFiles: [join(userData, AUTOSAVE_FILENAME), join(userData, AUTOSAVE_PREVIOUS_FILENAME)],
    knownProjects: knownProjects(),
    inMemoryNames,
    sessionIssued: sessionKeptNames()
  })
}

export function registerReonedCopiesIpc(ipcMain: IpcMain): void {
  ipcMain.handle(
    'rebuild-reoned-copies',
    (_event, batches: unknown): Promise<ReonedRepairOutcome[][]> =>
      rebuildReonedCopies(validBatches(batches))
  )

  ipcMain.handle('reoned-copies-library-available', () => libraryAvailable())

  ipcMain.handle(
    'reoned-copies-survey',
    async (
      _event,
      request: { inMemoryNames?: unknown; respectNotNow?: unknown } | undefined
    ): Promise<ReonedSurvey> => {
      if (!(await libraryAvailable())) return { status: 'library-missing' }
      const snoozedUntil = notNowUntil()
      if (request?.respectNotNow === true && snoozedUntil !== null && snoozedUntil > Date.now()) {
        return { status: 'snoozed' }
      }
      try {
        const scan = await scanUsed(stringArray(request?.inMemoryNames))
        if (!scan.ok) return { status: 'unreadable', path: scan.path }
        const { unused, unusedBytes } = await surveyBakes(bakeAssetsDir(), scan.used, Date.now())
        return { status: 'ok', unusedBytes, unusedCount: unused.length, notNowUntil: snoozedUntil }
      } catch (err) {
        console.error('reoned-copies-survey failed:', err)
        return { status: 'unreadable', path: bakeAssetsDir() }
      }
    }
  )

  // Recomputes the used set at click time: a survey's list is never reused, since projects,
  // memory and this session's copies may all have changed since it ran.
  ipcMain.handle(
    'reoned-copies-clean',
    async (_event, inMemoryNames: unknown): Promise<ReonedCleanResult> => {
      if (!(await libraryAvailable())) return { status: 'library-missing' }
      try {
        const scan = await scanUsed(stringArray(inMemoryNames))
        if (!scan.ok) return { status: 'unreadable', path: scan.path }
        return { status: 'ok', ...(await cleanBakes(bakeAssetsDir(), scan.used, Date.now())) }
      } catch (err) {
        console.error('reoned-copies-clean failed:', err)
        return { status: 'unreadable', path: bakeAssetsDir() }
      }
    }
  )

  ipcMain.handle('reoned-copies-not-now', () => setNotNow(Date.now()))
}
