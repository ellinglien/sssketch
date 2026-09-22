import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import icon from '../../resources/icon.png?asset'
import { importRifff, readWavHeaderBytes } from './importRifff'
import { readWavDurationSeconds } from '../shared/wavDuration'
import { importDemoRifff } from './demoRifff'
import {
  importOneShot,
  importLoop,
  importRecordedTake,
  importRecordedStem,
  importDiscoverLoopSeed
} from './importOneShot'
import { readAudioFile } from './readAudioFile'
import { renderStretched } from './rubberband'
import {
  saveProjectAs,
  openProject,
  writeAutosave,
  loadAutosave,
  clearAutosave,
  writeAutosaveSketchInfo,
  loadAutosaveSketchInfo,
  saveProjectToLibrary,
  saveProjectInPlace,
  openLibrarySketch,
  duplicateSketchAsNewVersion,
  generateDefaultProjectName,
  renameExternalSketchFile
} from './projectFile'
import { bakeOffset, type BakeJob } from './bakeOffset'
import { exportMixToWav } from './exportMix'
import { exportAbleton, exportAbletonToLibrary, exportAbletonNextToSource } from './exportAbleton'
import { exportReaper, exportReaperToLibrary, exportReaperNextToSource } from './exportReaper'
import {
  nativeExport,
  nativeExportStemsToDisk,
  exportStemsToLibrary,
  exportStemsNextToSource,
  nativeExportStemTracksToDisk,
  exportStemTracksToLibrary,
  exportStemTracksNextToSource
} from './nativeExport'
import { startPlaybackEngine, type PlaybackEngineHandle } from './playbackEngineLifecycle'
import { runFullScan } from './runFullScan'
import { loadCatalog, toggleFavourite } from './pluginCatalog'
import { loadCategoryCentroidStore } from './categoryCentroidStore'
import { getConfirmedEmbeddings } from './embeddingMatch'
import type { ConfirmedEmbedding } from '@shared/embeddingMatch'
import type { CategoryCentroidStore, CategoryAxis } from '@shared/categoryCentroids'
import {
  trainCentroidsFromBusEntries,
  trainCentroidsFromRoleEntries
} from './categoryCentroidTraining'
import { nextUpdateState, type UpdateState } from '@shared/updateState'
import {
  instrumentMaskToSoundType,
  type RiffFilters,
  type DiscoverSoundSourceFilter
} from '@shared/riffLibraryTypes'
import {
  riffLibraryAvailable,
  riffLibraryRootPath,
  setRiffLibraryRoot,
  listJams,
  listRiffs,
  resolveRiff,
  resolveRiffWithContext,
  downloadMissingStems,
  candidateDbsForRiff,
  listJamsWithDb
} from './riffLibraryStore'
import {
  getDiscoverCandidates,
  getRandomLibraryCandidate,
  prewarmDiscoverCandidateCaches,
  type DiscoverCandidate,
  type PrewarmScanProgress
} from './discoverCandidates'
import { getAdjacentDiscoverCandidates, findRiffForStemPath } from './discoverAdjacency'
import { prewarmTraitQuantileTables } from './traitQuantileCache'
import { resolveStemArrangeRoles } from './resolveStemArrangeRole'
import { guessSoundTypeFromPresetName } from '@shared/presetNames'
import { loadDiscoverSettings, saveDiscoverSettings } from './discoverSettingsStore'
import type { DiscoverSettings } from './discoverSettingsStore'
import {
  getStemAutoClassifyProgress,
  isStemEligibleForAutoCategory,
  markYamnetZeroShotAttempted,
  upsertStemAutoCategory,
  type StemAutoClassifyProgress
} from './stemAutoCategoryStore'
import { arrangeRoleForAudiosetClass } from '@shared/audiosetClasses'
import { listLibraryScanTargets } from './discoverLibraryStems'
import type { LibraryScanTarget } from './discoverLibraryStems'
import {
  listYamnetZeroShotRetroactiveTargets,
  type YamnetZeroShotRetroactiveTarget
} from './yamnetZeroShotRetroactiveScan'
import { SOUND_TYPE_TO_ARRANGE_ROLE, type ArrangeRole } from '@shared/stemRole'
import type { DiscoverSlotKind } from '@shared/discoverSlotKind'
import type { RawPluginStatesCapture } from '@shared/pluginStates'
import {
  loginWithCredentials,
  logout as endlesssLogout,
  getAuthStatus as getEndlesssAuthStatus,
  listJams as listEndlesssJams,
  jamRiffCount
} from './endlesssApi'
import {
  syncSharedFeed as syncSharedFeedToWarehouse,
  syncJam as syncJamToWarehouse,
  abortSync as abortWarehouseSync,
  removeJamSync as removeWarehouseJamSync
} from './riffLibrarySync'
import { openOwnRiffLibraryDb, ownRiffLibraryRoot } from './riffLibrarySchema'
import {
  getWarehouseSyncStatus,
  listWarehouseFavourites,
  toggleWarehouseFavourite
} from './riffLibraryWriter'
import { listStemFavourites, toggleStemFavourite } from './stemFavouriteStore'
import {
  upsertStemCategoryBus,
  upsertStemCategoryRole,
  resolveSourceProjectPath,
  stemCIDForPath,
  type StemBusCategoryEntry,
  type StemRoleCategoryEntry
} from './stemCategoriesStore'
import { getStemFeatureCache, setStemFeatureCache } from './stemFeatureCacheStore'
import { getStemPeaksCache, setStemPeaksCache, type StemPeaks } from './stemPeaksCacheStore'
import { getStemEmbeddingCache, setStemEmbeddingCache } from './stemEmbeddingCacheStore'
import { readYamnetModelBytes } from './yamnetModel'
import type { StemFeatures } from '@shared/stemFeatures'
import type { ProjectRef } from '@shared/types'
import { migrateEndlesssStemCache } from './stemCacheMigration'
import { migrateLegacyFavourites } from './riffFavouritesMigration'
import { backfillStemCategoriesFromProjectLibrary } from './stemCategoriesBackfill'
import { backfillInstrumentMaskCategories } from './instrumentMaskCentroidBackfill'
import { startStemAutoClassifyScheduler } from './stemAutoClassifyScheduler'
import { migrateProjectLibraryLocation } from './projectLibraryMigration'
import { migrateRiffLibraryLocation } from './riffLibraryMigration'
import {
  listLibrarySketches,
  libraryRootPath,
  setLibraryRootPath,
  shouldWarnBeforeOverwrite,
  renameSketch,
  deleteSketch,
  toggleSketchFavourite,
  listSketchBackups,
  restoreSketchBackup,
  readSketchBackup
} from './projectLibrary'

// Assigned inside app.whenReady().then(...) once the engine has started;
// read from the before-quit handler below, which runs in a different
// closure and can't otherwise reach it.
let playbackEngine: PlaybackEngineHandle | undefined

/**
 * Best-effort fetch of current plugin state from the PERSISTENT live engine
 * (not any fresh, export-only engine a caller might separately spawn) --
 * shared by every export path (mixdown, bus stems, per-track stems) so an
 * export taken right after tweaking a plugin, without an intervening
 * explicit Save, still reflects that tweak. Returns null (never throws) if
 * the engine isn't running or the round trip fails -- unlike handleSave's
 * own "fail loud, don't write the file" choice, every export path degrades
 * to exporting at default plugin state rather than failing the whole
 * export; Save is the one place this codebase treats plugin state as
 * something the user is relying on being durably correct, while an export
 * is regenerable at any time by exporting again once the round trip works.
 * `logLabel` is only for the console.error prefix, so a failure is
 * traceable back to which export path hit it.
 */
async function fetchLivePluginStates(logLabel: string): Promise<RawPluginStatesCapture | null> {
  if (!playbackEngine) return null
  try {
    return (await playbackEngine.client.sendAndAwaitType(
      'get-plugin-states',
      undefined,
      'plugin-states'
    )) as RawPluginStatesCapture
  } catch (err) {
    console.error(
      `${logLabel}: failed to fetch live plugin states, exporting at default state:`,
      err
    )
    return null
  }
}

// Tracks whichever BrowserWindow is currently live, reassigned every time
// createWindow() runs (both the initial whenReady() call and any later
// 'activate' call after the user closed all windows and reopened via the
// dock on macOS). The engine-event relay below reads this module-level
// variable fresh on every push event instead of closing over a single
// window captured at startup — a stale closure would keep sending to a
// destroyed BrowserWindow after a close-all/reopen cycle, which throws
// synchronously inside EngineClient's socket 'data' handler and can crash
// the whole main process.
let mainWindow: BrowserWindow | undefined
// Single source of truth for the auto-update flow -- see @shared/updateState's
// own doc comment. Only ever mutated by pushUpdateState, defined inside the
// `if (app.isPackaged)` block below (stays 'idle' forever in dev, where that
// whole block never runs).
let currentUpdateState: UpdateState = { state: 'idle' }

// Guards before-quit's shutdown-then-requit sequence (see below) against
// re-entering itself when it calls app.quit() a second time.
let isQuitting = false

// True once prewarmDiscoverCandidateCaches's own real table scan has
// finished (see its own call site below) -- the renderer's source of truth
// for whether the app is still doing real startup work that can make it
// feel sluggish. Queried once on mount (get-library-warmup-status) rather
// than relying on the push event alone, since a slow-to-mount renderer
// could otherwise miss it entirely if warmup finishes first (a real
// possibility on a small/already-cached library).
let libraryWarmupDone = false

// Direct report, 2026-09-17: "startup is quite sluggish... could we show
// welcome first to indicate it's loading?... otherwise the user thinks
// the app didn't start." Root cause: createWindow() below used to be
// blocked behind `await startPlaybackEngine()` (a real, sometimes-slow
// native process spawn) -- during that whole window there was no
// BrowserWindow at all (show: false + 'ready-to-show' means nothing
// appears until the renderer has mounted, which can't happen before
// createWindow() itself runs). engineStartupDone is the renderer's own
// source of truth for "is the engine still starting" -- same
// query-once-on-mount-plus-push-when-done pattern as libraryWarmupDone/
// get-library-warmup-status, just above/below.
let engineStartupDone = false

// Kept in sync with the renderer's own hasUnsavedChanges value via the
// 'set-dirty-state' IPC call below, fired on each of its transitions (not
// every keystroke) -- read from the before-quit handler to decide whether
// Cmd+Q needs to ask before discarding real unsaved work.
let rendererHasUnsavedChanges = false

function createWindow(): BrowserWindow {
  // Create the browser window.
  const win = new BrowserWindow({
    // 1512x982 -- the current MacBook Pro's own logical resolution
    // (14"/16", ratio ~1.54:1), not an arbitrary round number -- just the
    // initial/default size now, not an enforced shape (see below).
    width: 1512,
    height: 982,
    // Floors, not a locked shape -- keeps the arranger area from being
    // crushed below usability, same numbers as the old locked minimum.
    minWidth: 945,
    minHeight: 614,
    // Resizable and fullscreenable again as of the .ra-frame rework
    // (global.css/App.tsx's old FrameScaleContext, removed): the previous
    // lock existed only because whole-app proportional CSS scaling made
    // every click/drag coordinate calculation dependent on window size --
    // a repeat source of subtly-wrong cursor math (several bugs root-caused
    // and fixed this way, but the scaling mechanism itself kept being what
    // made them possible). .ra-frame now just fills the real window at
    // real, 1:1 pixels with no scale transform, so there's nothing left for
    // a resize or fullscreen to put out of sync.
    resizable: true,
    fullscreenable: true,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow = win

  win.on('ready-to-show', () => {
    win.show()
    // Direct report, 2026-09-18: "still hanging... stuck for a minute"
    // (then several more minutes, CPU climbing the whole time -- 57%,
    // 67%...) against Elling's real, large external LORE archive
    // (372,297 riffs). Root cause: this call USED to sit directly in
    // app.whenReady()'s own body, before createWindow() -- `void` on an
    // async call does NOT protect the caller from its callee's own
    // SYNCHRONOUS prefix (everything before that callee's own first
    // real `await`), and prewarmDiscoverCandidateCaches's synchronous
    // prefix used to run several async-function-calls deep (through
    // getRiffIndexForDb straight into buildRiffIndex) before ever
    // reaching a yield point -- including a single, un-chunked
    // `SELECT * FROM Riffs` fetch of the WHOLE table. On a library this
    // size, against an external (possibly slower) volume, that one
    // synchronous fetch alone could take minutes -- and for that whole
    // stretch, NOTHING ELSE in the single-threaded main process could run,
    // including the rest of app.whenReady()'s own body that calls
    // createWindow() itself further down. Moved here, inside
    // ready-to-show, so the window is GUARANTEED to already be visible
    // before this scan's own synchronous prefix ever gets a chance to
    // start -- it can now only ever compete with the app's OWN later
    // responsiveness (matching this comment's original intent), never
    // with the window showing up at all. buildRiffIndex/
    // getInstrumentRowsForDb were themselves later rewritten to paginate
    // via LIMIT/OFFSET rather than one giant fetch -- see
    // discoverCandidates.ts's own PREWARM_CHUNK_SIZE doc comment -- but
    // this call still belongs here regardless, since even a well-chunked
    // scan is real ongoing work that should never compete with the
    // window's own first paint.
    void prewarmDiscoverCandidateCaches(
      listJamsWithDb().map(({ jamCID, db }) => ({ jamCID, dbForJam: db })),
      openOwnRiffLibraryDb(),
      (progress: PrewarmScanProgress) => {
        mainWindow?.webContents.send('library-warmup-progress', progress)
      }
    ).finally(() => {
      libraryWarmupDone = true
      mainWindow?.webContents.send('library-warmup-complete')
      // Library-wide trait percentiles (Discover promise-vs-delivery spec,
      // Phase 1): build the quantile tables now, after the warmup, so the
      // first trait roll doesn't pay for it. Paginated + yielding.
      void prewarmTraitQuantileTables(openOwnRiffLibraryDb())
    })
  })

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Cmd+- (zoom out) fallback -- no custom app menu exists here, so View >
  // Zoom Out/In/Actual Size come from Electron's own default macOS menu,
  // which wires them to the 'zoomIn'/'zoomOut'/'resetZoom' roles. Zoom In
  // works fine (Cmd+= or Cmd+Plus), but Zoom Out's accelerator (Cmd+-)
  // reportedly doesn't fire on some keyboards -- clicking the menu item
  // itself still works, only the shortcut doesn't, which points at
  // Electron's accelerator parser not matching whatever the OS reports for
  // that physical key on the affected layout (a known class of issue, not
  // something specific to this app's own code). Rather than replacing the
  // entire native menu just to attach a second accelerator to one item,
  // this listens directly for the key and replicates the role's own effect
  // (zoomLevel -= 0.5, matching Electron's built-in zoomIn/zoomOut/
  // resetZoom increment) as a supplemental path -- checks both the
  // produced character (key) and the physical key code (code) so it isn't
  // tied to one specific layout.
  win.webContents.on('before-input-event', (_event, input) => {
    if (input.type !== 'keyDown' || !input.meta || input.shift) return
    if (input.key === '-' || input.code === 'Minus') {
      win.webContents.zoomLevel -= 0.5
    }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

// Dev (`npm run dev`) and a packaged build both default to the exact same
// userData path (~/Library/Application Support/sssketch, from package.json's
// productName) -- Chromium's own profile-singleton lock means running both
// at once causes whichever one launches second to fail to fully start (no
// window, or a silent early exit), independent of anything Electron's own
// app.requestSingleInstanceLock() API would control. Must run before
// whenReady() -- Chromium locks the profile directory during its own
// startup, before the 'ready' event fires.
if (is.dev) {
  app.setPath('userData', `${app.getPath('userData')}-dev`)
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.ellinglien.sssketch')

  // One-time, idempotent relocation of the project library from its old
  // default (~/Music/sssketch/ directly) onto its new one
  // (~/Music/sssketch/projects/) -- see projectLibraryMigration.ts's own
  // doc comment. No ordering constraint relative to the other migrations
  // below (touches an entirely separate directory tree), but run first for
  // readability alongside its riff-library counterpart.
  migrateProjectLibraryLocation()

  // Same for the riff library -- see riffLibraryMigration.ts's own doc
  // comment. MUST run before migrateLegacyFavourites' own
  // openOwnRiffLibraryDb() call a few lines below, which is this process's
  // first time opening that connection -- moving the directory out from
  // under an already-open one would corrupt it.
  migrateRiffLibraryLocation()

  // One-time (idempotent) migration off the old source-partitioned Endlesss
  // stem cache -- see stemCacheMigration.ts's own doc comment. Cheap once
  // already migrated (a symlink-recognizing scan, no real work), so no need
  // to gate this behind anything or run it off the main thread.
  migrateEndlesssStemCache()

  // One-time-in-spirit, idempotent migration of favourites off the old
  // flat-JSON file onto the new warehouse's Tags table -- see
  // riffFavouritesMigration.ts's own doc comment for why this is safe to
  // run unconditionally on every startup.
  migrateLegacyFavourites(openOwnRiffLibraryDb())

  // One-time-in-spirit, safe-to-call-on-every-startup migration recovering
  // busOf bus assignments trapped in old .sssketchproj files under the
  // project library folder -- see stemCategoriesBackfill.ts's own doc
  // comment.
  backfillStemCategoriesFromProjectLibrary(openOwnRiffLibraryDb())

  // Idempotent, safe-to-call-on-every-startup backfill of drums/bass
  // ArrangeRole labels from Endlesss's own performer-set Instrument
  // bitmask -- see instrumentMaskCentroidBackfill.ts's own doc comment.
  // Direct report, 2026-09-17 ("restarted .. no sign of it in the
  // console"): this call previously discarded its own return value, so
  // there was no way to tell from the outside whether it ran, or ran and
  // found nothing left to do (idempotent -- 0 is the expected, correct
  // result on every restart AFTER the first one that actually backfills
  // the real backlog). Logged the same way get-discover-candidates' own
  // TEMPORARY diagnostic log elsewhere in this file already does for
  // this codebase.
  const instrumentMaskBackfillSummary = backfillInstrumentMaskCategories(openOwnRiffLibraryDb())
  console.log(
    `backfillInstrumentMaskCategories: categorized ${instrumentMaskBackfillSummary.categorizedStems} stems`
  )

  // Background "pre-categorize the whole library" scheduler -- direct
  // request, 2026-09-15 ("why not just do a prelim scan that
  // pre-categorizes the stems... something people can leave running
  // overnight"). Its own doc comment (stemAutoClassifyScheduler.ts)
  // covers the consent gating and self-rescheduling; starting it here,
  // once, at app startup is all this call site needs to do.
  startStemAutoClassifyScheduler()

  // Pre-warms the riff-index cache (discoverCandidates.ts's own
  // getRiffIndexForDb) in the BACKGROUND, well before anyone actually
  // rolls -- direct live report: even after that cache made every roll
  // AFTER the first one fast, the very FIRST roll of a fresh app session
  // still paid a real, one-time table-scan cost (confirmed live: 57+
  // seconds on a real 5,057-jam library) on the user's own critical path,
  // right as they opened Discover for the first time. Deliberately NOT
  // gated on discover consent (loadDiscoverSettings) the way
  // startStemAutoClassifyScheduler is -- this only warms the SAME
  // Riffs/Stems reads getDiscoverCandidates always needed regardless of
  // consent (consent gates the separate whole-library feature/embedding
  // extraction scan, not basic candidate resolution).
  //
  // The actual call moved to createWindow()'s own ready-to-show handler
  // (direct report, 2026-09-18: "still hanging... stuck for a minute" --
  // several minutes, on a real large external archive) -- `void` alone
  // does NOT stop this function's own synchronous prefix (several
  // async-function-calls deep, down into buildRiffIndex's own single
  // un-chunked full-table SELECT) from blocking the ENTIRE single-
  // threaded main process, including createWindow() itself, for however
  // long that first synchronous chunk takes on a large library. See that
  // handler's own comment for the full mechanism.

  // macOS only (app.dock is undefined elsewhere) -- a packaged build's Dock
  // icon comes from build/icon.icns, embedded in the .app bundle at build
  // time by electron-builder, before Electron itself even starts. In dev
  // (npm run dev, running the plain Electron binary with no such bundle)
  // there's nothing to embed it into, so the Dock shows Electron's own
  // stock icon instead -- this explicitly sets it at startup so dev matches
  // what a packaged build already looks like. Gated to is.dev only:
  // redundant, not wrong, in a packaged build (the bundle's own icon is
  // already showing by the time this would run), but pointless to call there.
  if (is.dev) {
    app.dock?.setIcon(icon)
  }

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.handle('import-rifff', (_event, paths: string[]) => {
    return importRifff(paths)
  })

  ipcMain.handle('import-demo-rifff', () => importDemoRifff())

  ipcMain.handle('import-one-shot', (_event, path: string) => {
    return importOneShot(path)
  })

  ipcMain.handle('import-loop', (_event, path: string, barCount: number) => {
    return importLoop(path, barCount)
  })

  // Discover's own drop target (DiscoverPanel.tsx) -- always a loop, no
  // LoopOrOneShotPrompt, see importDiscoverLoopSeed's own doc comment
  // (importOneShot.ts) for why.
  ipcMain.handle('import-discover-loop-seed', (_event, path: string, projectBpm: number) => {
    return importDiscoverLoopSeed(path, projectBpm)
  })

  // Direct request, 2026-09-18: "took a while for the window to recognize
  // that it was a target... maybe we could have a conventional file
  // import + as well in the list '+ sample'" -- the click-to-pick
  // equivalent of Discover's own drag-and-drop loop import, same shape as
  // Shelf's own 'pick-rifff-import-paths' (that handler's own doc comment
  // explains the same "+" tile pattern). WAV-only filter matches
  // importDiscoverLoopSeed's own hard requirement -- no point letting the
  // user pick a file type that import would just reject.
  ipcMain.handle('pick-discover-loop-seed-paths', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'WAV audio', extensions: ['wav'] }]
    })
    return result.canceled ? [] : result.filePaths
  })

  // Read-only, for Shelf's own "one-shot or loop?" import prompt to show a
  // pre-filled bar-count guess (loopBarGuess.ts's guessLoopBars) before the
  // user commits to importLoop -- never throws, matching this codebase's
  // "can't read it, return null" convention for optional file probes.
  ipcMain.handle('get-wav-duration-seconds', (_event, path: string) => {
    try {
      return readWavDurationSeconds(readWavHeaderBytes(path))
    } catch {
      return null
    }
  })

  ipcMain.handle('import-recorded-take', (_event, path: string, bpm: number, loopBars?: number) => {
    return importRecordedTake(path, bpm, loopBars)
  })

  ipcMain.handle(
    'import-recorded-stem',
    (_event, path: string, rifffBpm: number, loopBars: number, existingSlots: number[]) => {
      return importRecordedStem(path, rifffBpm, loopBars, existingSlots)
    }
  )

  ipcMain.handle('riff-library-available', () => riffLibraryAvailable())

  ipcMain.handle('riff-library-root', () => riffLibraryRootPath())

  ipcMain.handle('riff-library-is-own', () => riffLibraryRootPath() === ownRiffLibraryRoot())

  ipcMain.handle('riff-library-set-root', (_event, newRoot: string) => setRiffLibraryRoot(newRoot))

  ipcMain.handle('riff-library-list-jams', (_event, filterText: string) => listJams(filterText))

  ipcMain.handle('riff-library-list-riffs', (_event, jamCID: string, filters: RiffFilters) =>
    listRiffs(jamCID, filters)
  )

  ipcMain.handle('riff-library-resolve-riff', (_event, riffCID: string) => resolveRiff(riffCID))

  ipcMain.handle('riff-library-resolve-riff-with-context', (_event, riffCID: string) =>
    resolveRiffWithContext(riffCID)
  )

  ipcMain.handle('riff-library-download-missing-stems', (_event, riffCID: string) =>
    downloadMissingStems(riffCID)
  )

  ipcMain.handle('endlesss-login', (_event, username: string, password: string) =>
    loginWithCredentials(username, password)
  )
  ipcMain.handle('endlesss-logout', () => endlesssLogout())
  ipcMain.handle('endlesss-auth-status', () => getEndlesssAuthStatus())
  ipcMain.handle('endlesss-list-jams', () => listEndlesssJams())
  ipcMain.handle('endlesss-jam-riff-count', (_event, jamId: string) => jamRiffCount(jamId))
  ipcMain.handle('riff-library-sync-start-shared-feed', (event, userName: string) =>
    syncSharedFeedToWarehouse(userName, (progress) => {
      event.sender.send('riff-library-sync-progress', {
        source: 'shared' as const,
        key: userName,
        ...progress
      })
    })
  )
  ipcMain.handle('riff-library-sync-start-jam', (event, jamId: string, jamName: string) =>
    syncJamToWarehouse(jamId, jamName, (progress) => {
      event.sender.send('riff-library-sync-progress', {
        source: 'jam' as const,
        key: jamId,
        ...progress
      })
    })
  )
  ipcMain.handle('riff-library-sync-status', (_event, jamCID: string) =>
    getWarehouseSyncStatus(openOwnRiffLibraryDb(), jamCID)
  )
  // `key` matches riff-library-sync-progress's own key convention (bare
  // username for a shared-feed sync, jamId for a private jam) -- see
  // abortSync's own doc comment in riffLibrarySync.ts. Returns false, not
  // an error, if nothing was running for that key (e.g. it already
  // finished on its own).
  ipcMain.handle('riff-library-sync-abort', (_event, key: string) => abortWarehouseSync(key))
  // Renderer already confirms with the user before calling this (see
  // LibraryBrowser.tsx's right-click "remove from sync" menu) -- this
  // handler just does the deletion. Rejects (rather than silently no-op)
  // if a sync is currently running for this jamCID, matching
  // removeJamSync's own doc comment in riffLibrarySync.ts.
  ipcMain.handle('riff-library-remove-jam-sync', (_event, jamCID: string, deleteFiles: boolean) =>
    removeWarehouseJamSync(jamCID, deleteFiles)
  )

  ipcMain.handle('pick-folder', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })

  // Rifff import normally only happens by dragging a folder (or its loose
  // stem files) onto the shelf's own drop zone -- this is the click-to-pick
  // equivalent, for the "+" tile at the end of that same row. openFile +
  // openDirectory + multiSelections together lets one dialog cover both
  // "picked a rifff folder" and "picked several loose stem files", matching
  // what Shelf.tsx's own handleDrop already accepts from a real drag.
  ipcMain.handle('pick-rifff-import-paths', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'openDirectory', 'multiSelections']
    })
    return result.canceled ? [] : result.filePaths
  })

  ipcMain.handle('read-audio-file', async (_event, path: string) => readAudioFile(path))

  ipcMain.handle('render-stretched', (_event, stemPath: string, ratio: number) =>
    renderStretched(stemPath, ratio)
  )

  ipcMain.handle('bake-offset', (_event, jobs: BakeJob[]) => bakeOffset(jobs))

  ipcMain.handle('save-project', (event, json: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)!
    return saveProjectAs(win, json)
  })

  ipcMain.handle('open-project', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)!
    return openProject(win)
  })

  ipcMain.handle('autosave-project', (_event, json: string) => writeAutosave(json))

  ipcMain.handle('load-autosave', () => loadAutosave())

  ipcMain.handle('clear-autosave', () => clearAutosave())

  ipcMain.handle('autosave-project-sketch', (_event, json: string) => writeAutosaveSketchInfo(json))

  ipcMain.handle('load-autosave-sketch', () => loadAutosaveSketchInfo())

  ipcMain.handle('set-dirty-state', (_event, dirty: boolean) => {
    rendererHasUnsavedChanges = dirty
  })

  ipcMain.handle('export-mix', (event, bytes: Uint8Array, defaultName?: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)!
    return exportMixToWav(win, bytes, defaultName)
  })

  ipcMain.handle('export-mix-native', async (_event, stateJson: string) => {
    const state = JSON.parse(stateJson) as import('../renderer/src/state/store').AppState
    const rawPluginStates = await fetchLivePluginStates('export-mix-native')
    return nativeExport(state, rawPluginStates)
  })

  ipcMain.handle('export-stems-native', async (event, stateJson: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)!
    const state = JSON.parse(stateJson) as import('../renderer/src/state/store').AppState
    const rawPluginStates = await fetchLivePluginStates('export-stems-native')
    return nativeExportStemsToDisk(win, state, rawPluginStates)
  })

  ipcMain.handle('export-als', async (event, stateJson: string, defaultName?: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)!
    const state = JSON.parse(stateJson) as import('../renderer/src/state/store').AppState
    return exportAbleton(win, state, defaultName)
  })

  ipcMain.handle('generate-default-project-name', () => generateDefaultProjectName())

  ipcMain.handle('save-project-to-library', (_event, name: string, json: string) =>
    saveProjectToLibrary(name, json)
  )

  ipcMain.handle('save-project-in-place', (_event, path: string, json: string) =>
    saveProjectInPlace(path, json)
  )

  ipcMain.handle('open-library-sketch', (_event, name: string) => openLibrarySketch(name))

  ipcMain.handle('duplicate-sketch', (_event, currentName: string) =>
    duplicateSketchAsNewVersion(currentName)
  )

  ipcMain.handle('rename-sketch', (_event, oldName: string, newName: string) =>
    renameSketch(oldName, newName)
  )

  ipcMain.handle('rename-external-sketch-file', (_event, oldPath: string, newName: string) =>
    renameExternalSketchFile(oldPath, newName)
  )

  ipcMain.handle('delete-sketch', (_event, name: string) => deleteSketch(name))

  ipcMain.handle('list-library-sketches', () => listLibrarySketches())

  ipcMain.handle('toggle-sketch-favourite', (_event, name: string) => toggleSketchFavourite(name))

  ipcMain.handle('get-library-root', () => libraryRootPath())

  ipcMain.handle('set-library-root', (_event, newRoot: string) => setLibraryRootPath(newRoot))

  ipcMain.handle('should-warn-before-ableton-overwrite', (_event, libraryName: string) =>
    shouldWarnBeforeOverwrite(libraryName)
  )

  ipcMain.handle('list-sketch-backups', (_event, name: string) => listSketchBackups(name))

  ipcMain.handle('restore-sketch-backup', (_event, name: string, backupPath: string) =>
    restoreSketchBackup(name, backupPath)
  )

  ipcMain.handle('read-sketch-backup', (_event, name: string, backupPath: string) =>
    readSketchBackup(name, backupPath)
  )

  ipcMain.handle(
    'export-als-to-library',
    async (_event, stateJson: string, libraryName: string) => {
      const state = JSON.parse(stateJson) as import('../renderer/src/state/store').AppState
      return exportAbletonToLibrary(state, libraryName)
    }
  )

  ipcMain.handle(
    'export-als-next-to-source',
    async (_event, stateJson: string, sourcePath: string) => {
      const state = JSON.parse(stateJson) as import('../renderer/src/state/store').AppState
      return exportAbletonNextToSource(state, sourcePath)
    }
  )

  ipcMain.handle('export-rpp', async (event, stateJson: string, defaultName?: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)!
    const state = JSON.parse(stateJson) as import('../renderer/src/state/store').AppState
    return exportReaper(win, state, defaultName)
  })

  ipcMain.handle(
    'export-rpp-to-library',
    async (_event, stateJson: string, libraryName: string) => {
      const state = JSON.parse(stateJson) as import('../renderer/src/state/store').AppState
      return exportReaperToLibrary(state, libraryName)
    }
  )

  ipcMain.handle(
    'export-rpp-next-to-source',
    async (_event, stateJson: string, sourcePath: string) => {
      const state = JSON.parse(stateJson) as import('../renderer/src/state/store').AppState
      return exportReaperNextToSource(state, sourcePath)
    }
  )

  ipcMain.handle(
    'export-stems-to-library',
    async (_event, stateJson: string, libraryName: string) => {
      const state = JSON.parse(stateJson) as import('../renderer/src/state/store').AppState
      const rawPluginStates = await fetchLivePluginStates('export-stems-to-library')
      return exportStemsToLibrary(state, libraryName, rawPluginStates)
    }
  )

  ipcMain.handle(
    'export-stems-next-to-source',
    async (_event, stateJson: string, sourcePath: string) => {
      const state = JSON.parse(stateJson) as import('../renderer/src/state/store').AppState
      const rawPluginStates = await fetchLivePluginStates('export-stems-next-to-source')
      return exportStemsNextToSource(state, sourcePath, rawPluginStates)
    }
  )

  ipcMain.handle(
    'export-stem-tracks-native',
    async (event, stateJson: string, projectName: string) => {
      const win = BrowserWindow.fromWebContents(event.sender)!
      const state = JSON.parse(stateJson) as import('../renderer/src/state/store').AppState
      const rawPluginStates = await fetchLivePluginStates('export-stem-tracks-native')
      return nativeExportStemTracksToDisk(win, state, projectName, rawPluginStates)
    }
  )

  ipcMain.handle(
    'export-stem-tracks-to-library',
    async (_event, stateJson: string, libraryName: string) => {
      const state = JSON.parse(stateJson) as import('../renderer/src/state/store').AppState
      const rawPluginStates = await fetchLivePluginStates('export-stem-tracks-to-library')
      return exportStemTracksToLibrary(state, libraryName, rawPluginStates)
    }
  )

  ipcMain.handle(
    'export-stem-tracks-next-to-source',
    async (_event, stateJson: string, sourcePath: string) => {
      const state = JSON.parse(stateJson) as import('../renderer/src/state/store').AppState
      const rawPluginStates = await fetchLivePluginStates('export-stem-tracks-next-to-source')
      return exportStemTracksNextToSource(state, sourcePath, rawPluginStates)
    }
  )

  // See engineStartupDone's own doc comment above for why this is no
  // longer awaited here.
  //
  // CRITICAL, found in code review: this whole app.whenReady().then(async
  // () => {...}) body has NO top-level `await` anywhere else in it (every
  // await below lives inside an ipcMain.handle(...) callback, not at this
  // statement level) -- so everything from here through the end of this
  // function, including createWindow() further down, runs in one
  // uninterrupted synchronous turn. subscribeEngineRelays(handle) MUST be
  // called from inside this .then(), not as a separate `if (playbackEngine)`
  // block later in this same function body (that was tried first and is
  // exactly wrong: playbackEngine is still undefined at that point on
  // 100% of runs, not just sometimes, since the .then() callback can't run
  // until this synchronous turn drains) -- see subscribeEngineRelays' own
  // doc comment for what silently breaks if this ever regresses again.
  void startPlaybackEngine()
    .then((handle) => {
      playbackEngine = handle
      subscribeEngineRelays(handle)
    })
    .catch((err) => {
      // Same handling as before this became non-blocking -- a failed spawn
      // (binary missing/not yet rebuilt, a port bind failure, the
      // readiness timeout in engineProcess.ts firing) leaves playbackEngine
      // undefined; every engine-* ipcMain handler below already guards
      // every call with `playbackEngine?.`, so the rest of the app
      // degrades safely -- export and every other feature are unaffected,
      // only live playback is unavailable this session.
      console.error('index: failed to start the native playback engine', err)
      dialog.showErrorBox(
        'Playback engine failed to start',
        `sssketch could not start its native audio engine, so live playback will not work this session. Export and other features are unaffected.\n\n${String(err)}`
      )
    })
    .finally(() => {
      engineStartupDone = true
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('engine-startup-complete')
      }
    })

  ipcMain.handle('engine-load-project', (_event, project: unknown) => {
    playbackEngine?.sendLoadProject(project)
  })

  ipcMain.handle('engine-play', (_event, fromPos: number) => {
    playbackEngine?.client.send('play', { fromPos })
  })

  ipcMain.handle('engine-stop', () => {
    playbackEngine?.client.send('stop')
  })

  ipcMain.handle('engine-set-position', (_event, pos: number) => {
    playbackEngine?.client.send('set-position', { pos })
  })

  ipcMain.handle(
    'engine-set-live-param',
    (_event, field: 'volume' | 'fadeIn' | 'fadeOut', key: string, value: number) => {
      playbackEngine?.client.send('set-live-param', { field, key, value })
    }
  )

  ipcMain.handle('engine-set-loop-region', (_event, startBar: number, endBar: number) => {
    playbackEngine?.client.send('set-loop-region', { startBar, endBar })
  })

  ipcMain.handle('engine-list-input-devices', async (): Promise<string[]> => {
    if (!playbackEngine) return []
    try {
      const result = (await playbackEngine.client.sendAndAwaitType(
        'list-input-devices',
        undefined,
        'input-devices-list'
      )) as { devices: string[] }
      return result.devices
    } catch (err) {
      console.error('engine-list-input-devices: failed:', err)
      return []
    }
  })

  ipcMain.handle('engine-list-output-devices', async (): Promise<string[]> => {
    if (!playbackEngine) return []
    try {
      const result = (await playbackEngine.client.sendAndAwaitType(
        'list-output-devices',
        undefined,
        'output-devices-list'
      )) as { devices: string[] }
      return result.devices
    } catch (err) {
      console.error('engine-list-output-devices: failed:', err)
      return []
    }
  })

  ipcMain.handle(
    'engine-set-output-device',
    async (_event, deviceName: string): Promise<{ ok: true } | { ok: false; error: string }> => {
      if (!playbackEngine) return { ok: false, error: 'engine not running' }
      try {
        const result = (await playbackEngine.client.sendAndAwaitType(
          'set-output-device',
          { deviceName },
          'set-output-device-result'
        )) as { success: boolean; error?: string }
        return result.success ? { ok: true } : { ok: false, error: result.error ?? 'unknown error' }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error('engine-set-output-device: failed:', err)
        return { ok: false, error: message }
      }
    }
  )

  ipcMain.handle('get-category-centroids', (): CategoryCentroidStore => loadCategoryCentroidStore())

  // No candidateDbsForRiff() here, unlike most other openOwnRiffLibraryDb()
  // handlers in this file -- see getConfirmedEmbeddings's own doc comment
  // (2026-09-15 real-world bug fix) for why StemCategories/StemEmbeddingCache
  // can only ever live in the own db, never an external candidate.
  ipcMain.handle('get-confirmed-embeddings', (_event, axis: CategoryAxis): ConfirmedEmbedding[] =>
    getConfirmedEmbeddings(openOwnRiffLibraryDb(), axis)
  )

  ipcMain.handle(
    'get-discover-candidates',
    async (
      _event,
      kinds: DiscoverSlotKind[],
      onlyOwnStems: boolean,
      targetUser?: string,
      soundSource?: DiscoverSoundSourceFilter
    ): Promise<DiscoverCandidate[]> => {
      // TEMPORARY diagnostic log (2026-09-15) -- a live report of rolling
      // staying stuck with no console errors made it impossible to tell,
      // from the outside, which part of this handler was slow. Remove
      // once confirmed.
      const t0 = Date.now()
      const jams = listJamsWithDb().map(({ jamCID, db }) => ({ jamCID, dbForJam: db }))
      const t1 = Date.now()
      console.log(
        `get-discover-candidates(${kinds.join('+')}): listJamsWithDb -- ${jams.length} jams in ${t1 - t0}ms`
      )
      const result = await getDiscoverCandidates({
        ownDb: openOwnRiffLibraryDb(),
        jams,
        kinds,
        onlyOwnStems,
        targetUser,
        soundSource
      })
      console.log(
        `get-discover-candidates(${kinds.join('+')}): getDiscoverCandidates -- ${result.length} candidates in ${Date.now() - t1}ms`
      )
      return result
    }
  )

  ipcMain.handle(
    'get-random-discover-candidate',
    (
      _event,
      kinds: DiscoverSlotKind[],
      onlyOwnStems: boolean,
      targetUser?: string,
      soundSource?: DiscoverSoundSourceFilter
    ): Promise<DiscoverCandidate | null> =>
      getRandomLibraryCandidate({
        jams: listJamsWithDb().map(({ jamCID, db }) => ({ jamCID, dbForJam: db })),
        kinds,
        onlyOwnStems,
        targetUser,
        soundSource
      })
  )

  ipcMain.handle(
    'get-adjacent-discover-candidates',
    (
      _event,
      centerRiffCID: string,
      kinds: DiscoverSlotKind[],
      soundSource?: DiscoverSoundSourceFilter
    ) => getAdjacentDiscoverCandidates(centerRiffCID, kinds, soundSource)
  )

  ipcMain.handle('find-riff-for-stem-path', (_event, stemPath: string) =>
    findRiffForStemPath(stemPath)
  )

  // Direct request, 2026-09-16: "the audio analysis should be able to
  // detect and differentiate drums from leads etc etc." Batched (one round
  // trip for a whole riff's stems, not one per stem) -- checks the real
  // trained classifier (StemCategories human confirmations, else
  // StemAutoCategory's own audio-analysis result) before falling back to
  // the SAME blunt instrument-mask/preset-name chain the renderer used to
  // compute entirely on its own (LibraryBrowser.tsx's own
  // seedDiscoverFromBrowseRiff) -- `?? 'fx'` as the very last resort so
  // this always returns a real ArrangeRole for every entry, matching that
  // original chain's own contract (a seeded slot must always get SOME
  // role, never null).
  ipcMain.handle(
    'resolve-stem-arrange-roles',
    (
      _event,
      entries: { stemCID: string; instrumentMask: number; presetName: string }[]
    ): Record<string, ArrangeRole | null> => {
      const entryByStemCID = new Map(entries.map((e) => [e.stemCID, e]))
      return resolveStemArrangeRoles(
        openOwnRiffLibraryDb(),
        entries.map((e) => e.stemCID),
        (stemCID) => {
          const entry = entryByStemCID.get(stemCID)
          if (!entry) return null
          const soundType =
            instrumentMaskToSoundType(entry.instrumentMask) ??
            guessSoundTypeFromPresetName(entry.presetName) ??
            'fx'
          return SOUND_TYPE_TO_ARRANGE_ROLE[soundType]
        }
      )
    }
  )

  ipcMain.handle('get-library-warmup-status', (): boolean => libraryWarmupDone)

  ipcMain.handle('get-engine-startup-status', (): boolean => engineStartupDone)

  ipcMain.handle('get-discover-settings', (): DiscoverSettings => loadDiscoverSettings())
  ipcMain.handle('set-discover-settings', (_event, settings: DiscoverSettings): void =>
    saveDiscoverSettings(settings)
  )

  ipcMain.handle('get-discover-classify-progress', (): StemAutoClassifyProgress =>
    getStemAutoClassifyProgress(openOwnRiffLibraryDb())
  )

  ipcMain.handle('get-discover-library-scan-targets', (): Promise<LibraryScanTarget[]> =>
    listLibraryScanTargets(listJamsWithDb().map(({ jamCID, db }) => ({ jamCID, dbForJam: db })))
  )

  ipcMain.handle(
    'upsert-stem-category-bus',
    (_event, entries: StemBusCategoryEntry[], source: string, project: ProjectRef) => {
      const db = openOwnRiffLibraryDb()
      const extraCandidateDbs = candidateDbsForRiff()
      upsertStemCategoryBus(
        db,
        entries,
        source,
        resolveSourceProjectPath(project),
        Date.now() / 1000,
        extraCandidateDbs
      )
      trainCentroidsFromBusEntries(db, entries, extraCandidateDbs)
    }
  )

  ipcMain.handle(
    'upsert-stem-category-role',
    (_event, entries: StemRoleCategoryEntry[], source: string, project: ProjectRef) => {
      const db = openOwnRiffLibraryDb()
      const extraCandidateDbs = candidateDbsForRiff()
      upsertStemCategoryRole(
        db,
        entries,
        source,
        resolveSourceProjectPath(project),
        Date.now() / 1000,
        extraCandidateDbs
      )
      trainCentroidsFromRoleEntries(db, entries, extraCandidateDbs)
    }
  )

  ipcMain.handle('get-stem-feature-cache', (_event, path: string): StemFeatures | null =>
    getStemFeatureCache(openOwnRiffLibraryDb(), path, candidateDbsForRiff())
  )

  ipcMain.handle('get-stem-peaks-cache', (_event, path: string): StemPeaks | null =>
    getStemPeaksCache(openOwnRiffLibraryDb(), path, candidateDbsForRiff())
  )

  ipcMain.handle('set-stem-peaks-cache', (_event, path: string, peaks: StemPeaks) => {
    // Floored, same reasoning as set-stem-feature-cache below --
    // StemPeaksCache has exactly one writer and its own upsert has no
    // WHERE-guarded comparison against a prior write's timestamp.
    setStemPeaksCache(
      openOwnRiffLibraryDb(),
      path,
      peaks,
      Math.floor(Date.now() / 1000),
      candidateDbsForRiff()
    )
  })

  ipcMain.handle('get-yamnet-model', (): Promise<Uint8Array | null> => readYamnetModelBytes())

  ipcMain.handle('set-stem-feature-cache', (_event, path: string, features: StemFeatures) => {
    // Floored (not unrounded like the upsert-stem-category-* handlers above) is
    // correct here: StemFeatureCache has exactly one writer and its own upsert
    // (stemFeatureCacheStore.ts) has no WHERE-guarded comparison against a prior
    // write's timestamp, unlike StemCategories.UpdatedAt (fixed in 175cd8d after a
    // real cross-writer precision bug). There's nothing here for extra precision
    // to protect against.
    setStemFeatureCache(
      openOwnRiffLibraryDb(),
      path,
      features,
      Math.floor(Date.now() / 1000),
      candidateDbsForRiff()
    )
  })

  ipcMain.handle('get-stem-embedding-cache', (_event, path: string): number[] | null =>
    getStemEmbeddingCache(openOwnRiffLibraryDb(), path, candidateDbsForRiff())
  )

  ipcMain.handle('set-stem-embedding-cache', (_event, path: string, embedding: number[]) => {
    // Floored, same reasoning as set-stem-feature-cache right above --
    // StemEmbeddingCache has exactly one writer and its own upsert has no
    // WHERE-guarded comparison against a prior write's timestamp.
    setStemEmbeddingCache(
      openOwnRiffLibraryDb(),
      path,
      embedding,
      Math.floor(Date.now() / 1000),
      candidateDbsForRiff()
    )
  })

  // Direct counterpart to how the classifier passes in stemAutoClassify.ts
  // gate their own writes (BASE_ELIGIBILITY_WHERE): never overwrite an
  // existing StemCategories confirmation OR an existing StemAutoCategory
  // guess from a DIFFERENT source -- first classifier to claim a stem wins,
  // same "no source ever re-evaluates/overrides another source's guess"
  // convention already established there.
  ipcMain.handle(
    'set-yamnet-zeroshot-category',
    (_event, path: string, audiosetClassIndex: number) => {
      const arrangeRole = arrangeRoleForAudiosetClass(audiosetClassIndex)
      if (!arrangeRole) return
      const db = openOwnRiffLibraryDb()
      const extraCandidateDbs = candidateDbsForRiff()
      const stemCID = stemCIDForPath(db, path, extraCandidateDbs)
      if (!stemCID) return
      if (!isStemEligibleForAutoCategory(db, stemCID)) return
      // Floored, same reasoning as set-stem-feature-cache/set-stem-embedding-cache
      // two handlers above: StemAutoCategory's own upsert (upsertStemAutoCategory)
      // has no WHERE-guarded comparison against a prior write's timestamp, unlike
      // upsertStemCategoryRole's, so there's no cross-writer ordering for extra
      // precision to protect here.
      upsertStemAutoCategory(
        db,
        stemCID,
        arrangeRole,
        'yamnet-zeroshot',
        Math.floor(Date.now() / 1000)
      )
    }
  )

  // Records a zero-shot classification ATTEMPT, independent of whether
  // set-yamnet-zeroshot-category above actually wrote a role for it --
  // see StemYamnetZeroShotAttempted's own schema doc comment
  // (riffLibrarySchema.ts) for the full reasoning: most stems' own top
  // AudioSet class won't map to anything in audiosetClasses.ts's
  // deliberately narrow table, and that's a genuine, deterministic
  // answer for a given audio file -- without recording that the attempt
  // happened at all, listYamnetZeroShotRetroactiveTargets below would
  // keep re-selecting the same never-classifiable stems forever.
  ipcMain.handle('mark-yamnet-zeroshot-attempted', (_event, path: string) => {
    const db = openOwnRiffLibraryDb()
    const stemCID = stemCIDForPath(db, path, candidateDbsForRiff())
    if (!stemCID) return
    markYamnetZeroShotAttempted(db, stemCID, Math.floor(Date.now() / 1000))
  })

  // Feeds YamnetZeroShotRetroactiveScan.tsx's own one-time migration pass
  // (see yamnetZeroShotRetroactiveScan.ts's own doc comment) -- every
  // stem whose embedding was cached before the zero-shot classification
  // path existed, so it never got a chance to run.
  ipcMain.handle(
    'get-yamnet-zeroshot-retroactive-targets',
    (): Promise<YamnetZeroShotRetroactiveTarget[]> =>
      listYamnetZeroShotRetroactiveTargets(openOwnRiffLibraryDb())
  )

  ipcMain.handle('engine-get-buffer-size', async (): Promise<number | null> => {
    if (!playbackEngine) return null
    try {
      const result = (await playbackEngine.client.sendAndAwaitType(
        'get-buffer-size',
        undefined,
        'buffer-size'
      )) as { bufferSize: number }
      return result.bufferSize
    } catch (err) {
      console.error('engine-get-buffer-size: failed:', err)
      return null
    }
  })

  ipcMain.handle('engine-get-plugin-states', (): Promise<RawPluginStatesCapture | null> =>
    fetchLivePluginStates('engine-get-plugin-states')
  )

  ipcMain.handle(
    'engine-set-buffer-size',
    async (_event, bufferSize: number): Promise<{ ok: true } | { ok: false; error: string }> => {
      if (!playbackEngine) return { ok: false, error: 'engine not running' }
      try {
        const result = (await playbackEngine.client.sendAndAwaitType(
          'set-buffer-size',
          { bufferSize },
          'set-buffer-size-result'
        )) as { success: boolean; error?: string }
        return result.success ? { ok: true } : { ok: false, error: result.error ?? 'unknown error' }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error('engine-set-buffer-size: failed:', err)
        return { ok: false, error: message }
      }
    }
  )

  ipcMain.handle(
    'engine-arm-recording',
    async (
      _event,
      channelId: string,
      deviceName: string,
      startBar: number,
      endBar: number
    ): Promise<{ success: boolean; error?: string }> => {
      if (!playbackEngine) return { success: false, error: 'engine not running' }
      try {
        return (await playbackEngine.client.sendAndAwaitType(
          'arm-recording',
          { channelId, deviceName, startBar, endBar },
          'arm-recording-result'
        )) as { success: boolean; error?: string }
      } catch (err) {
        console.error('engine-arm-recording: failed:', err)
        return { success: false, error: String(err) }
      }
    }
  )

  ipcMain.handle(
    'engine-disarm-recording',
    async (): Promise<{
      committed: boolean
      path?: string
      error?: string
      latencyCompensationBars?: number
    }> => {
      if (!playbackEngine) return { committed: false }
      try {
        return (await playbackEngine.client.sendAndAwaitType(
          'disarm-recording',
          undefined,
          'disarm-recording-result'
        )) as {
          committed: boolean
          path?: string
          error?: string
          latencyCompensationBars?: number
        }
      } catch (err) {
        console.error('engine-disarm-recording: failed:', err)
        return { committed: false, error: String(err) }
      }
    }
  )

  ipcMain.handle('engine-set-metronome', (_event, enabled: boolean) => {
    playbackEngine?.client.send('set-metronome', { enabled })
  })

  ipcMain.handle('engine-set-link-enabled', (_event, enabled: boolean) => {
    playbackEngine?.client.send('set-link-enabled', { enabled })
  })

  ipcMain.handle(
    'engine-get-link-status',
    async (): Promise<{ enabled: boolean; numPeers: number }> => {
      if (!playbackEngine) return { enabled: false, numPeers: 0 }
      try {
        return (await playbackEngine.client.sendAndAwaitType(
          'get-link-status',
          undefined,
          'link-status'
        )) as { enabled: boolean; numPeers: number }
      } catch (err) {
        console.error('engine-get-link-status: failed:', err)
        return { enabled: false, numPeers: 0 }
      }
    }
  )

  ipcMain.handle(
    'engine-set-gated-recording-enabled',
    async (
      _event,
      enabled: boolean,
      startBar: number,
      endBar: number,
      deviceName: string
    ): Promise<{ success: boolean; error?: string }> => {
      if (!playbackEngine) return { success: false, error: 'engine not running' }
      try {
        return (await playbackEngine.client.sendAndAwaitType(
          'set-gated-recording-enabled',
          { enabled, startBar, endBar, deviceName },
          'set-gated-recording-enabled-result'
        )) as { success: boolean; error?: string }
      } catch (err) {
        console.error('engine-set-gated-recording-enabled: failed:', err)
        return { success: false, error: String(err) }
      }
    }
  )

  ipcMain.handle(
    'engine-capture-gated-take',
    async (): Promise<{
      committed: boolean
      path?: string
      error?: string
      latencyCompensationBars?: number
    }> => {
      if (!playbackEngine) return { committed: false }
      try {
        return (await playbackEngine.client.sendAndAwaitType(
          'capture-gated-take',
          undefined,
          'capture-gated-take-result'
        )) as {
          committed: boolean
          path?: string
          error?: string
          latencyCompensationBars?: number
        }
      } catch (err) {
        console.error('engine-capture-gated-take: failed:', err)
        return { committed: false, error: String(err) }
      }
    }
  )

  ipcMain.handle(
    'engine-load-master-plugin',
    (
      _event,
      slot: number,
      pluginId: string | null,
      path: string | null,
      stateBase64: string | null
    ) => {
      playbackEngine?.client.send('load-master-plugin', { slot, pluginId, path, stateBase64 })
    }
  )

  ipcMain.handle('engine-open-master-plugin-editor', (_event, slot: number) => {
    playbackEngine?.client.send('open-master-plugin-editor', { slot })
  })

  ipcMain.handle('engine-close-master-plugin-editor', (_event, slot: number) => {
    playbackEngine?.client.send('close-master-plugin-editor', { slot })
  })

  ipcMain.handle(
    'engine-load-channel-plugin',
    (
      _event,
      channelId: string,
      slot: number,
      pluginId: string | null,
      path: string | null,
      stateBase64: string | null
    ) => {
      playbackEngine?.client.send('load-channel-plugin', {
        channelId,
        slot,
        pluginId,
        path,
        stateBase64
      })
    }
  )

  ipcMain.handle('engine-open-channel-plugin-editor', (_event, channelId: string, slot: number) => {
    playbackEngine?.client.send('open-channel-plugin-editor', { channelId, slot })
  })

  ipcMain.handle(
    'engine-close-channel-plugin-editor',
    (_event, channelId: string, slot: number) => {
      playbackEngine?.client.send('close-channel-plugin-editor', { channelId, slot })
    }
  )

  ipcMain.handle('scan-plugins', async (event) => {
    const catalog = await runFullScan((progress) => {
      event.sender.send('scan-progress', progress)
    })
    return catalog
  })

  ipcMain.handle('get-plugin-catalog', () => loadCatalog())

  ipcMain.handle('toggle-plugin-favourite', (_event, id: string) => {
    toggleFavourite(id)
    return loadCatalog()
  })

  ipcMain.handle('list-riff-favourites', () => listWarehouseFavourites(openOwnRiffLibraryDb()))

  ipcMain.handle('toggle-riff-favourite', (_event, riffCID: string) =>
    toggleWarehouseFavourite(openOwnRiffLibraryDb(), riffCID)
  )

  // Per-STEM favourites (distinct from the riff-level pair just above) --
  // direct request, 2026-09-16, for Discover's own "star a stem" feature.
  ipcMain.handle('list-stem-favourites', () => listStemFavourites(openOwnRiffLibraryDb()))

  ipcMain.handle('toggle-stem-favourite', (_event, stemCID: string) =>
    toggleStemFavourite(openOwnRiffLibraryDb(), stemCID)
  )

  createWindow()

  // Only in a packaged (production) build -- never in dev, where there's no
  // meaningful "newer published release" to check against, and running it
  // unconditionally would just spam electron-updater's own network calls +
  // logging on every dev-server restart for no benefit. Failure at any
  // stage below must never be fatal to the rest of the app -- it's a
  // background convenience feature, not a load-bearing startup step.
  if (app.isPackaged) {
    // electron-updater defaults autoDownload to true -- explicitly turned
    // off here since nothing may download or install without the user
    // confirming first via the update-confirm-install handler below (see
    // this feature's own design doc).
    autoUpdater.autoDownload = false

    function pushUpdateState(next: UpdateState): void {
      currentUpdateState = next
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-state-changed', currentUpdateState)
      }
    }

    autoUpdater.on('update-available', (info) => {
      pushUpdateState(
        nextUpdateState(currentUpdateState, { type: 'update-available', version: info.version })
      )
    })
    autoUpdater.on('update-not-available', () => {
      pushUpdateState(nextUpdateState(currentUpdateState, { type: 'dismiss' }))
    })
    autoUpdater.on('download-progress', (progress) => {
      pushUpdateState(
        nextUpdateState(currentUpdateState, {
          type: 'download-progress',
          percent: progress.percent
        })
      )
    })
    autoUpdater.on('update-downloaded', () => {
      pushUpdateState(nextUpdateState(currentUpdateState, { type: 'update-downloaded' }))
      // Immediate, per this feature's own design doc -- the app quits and
      // relaunches itself on the new version right away rather than
      // waiting for the user to quit on their own.
      autoUpdater.quitAndInstall()
    })
    autoUpdater.on('error', (err) => {
      pushUpdateState(nextUpdateState(currentUpdateState, { type: 'error', error: err.message }))
    })

    ipcMain.handle('update-confirm-install', () => {
      pushUpdateState(nextUpdateState(currentUpdateState, { type: 'confirm-install' }))
      autoUpdater.downloadUpdate().catch((err: unknown) => {
        console.error('index: auto-update download failed', err)
      })
    })

    ipcMain.handle('update-dismiss', () => {
      pushUpdateState(nextUpdateState(currentUpdateState, { type: 'dismiss' }))
    })

    autoUpdater.checkForUpdates().catch((err: unknown) => {
      console.error('index: auto-update check failed', err)
    })
    // Every 4 hours for as long as the app stays open. Skips its own check
    // whenever a check/download/install is already in flight (state isn't
    // idle) -- otherwise a tick landing while the user has an unanswered
    // "available" dialog open, or mid-download, would kick off a redundant
    // overlapping check (see this feature's own design doc).
    setInterval(
      () => {
        if (currentUpdateState.state === 'idle') {
          autoUpdater.checkForUpdates().catch((err: unknown) => {
            console.error('index: periodic auto-update check failed', err)
          })
        }
      },
      4 * 60 * 60 * 1000
    )
  }

  // playbackEngine.client is a getter (see playbackEngineLifecycle.ts's doc
  // comment) that re-reads the live EngineClient on every *property access*
  // — but EngineClient.on() itself subscribes onto whichever specific
  // instance it was called on, so a single one-time
  // `playbackEngine.client.on(...)` call still binds the listener to that
  // one snapshot object forever. After a crash-triggered respawn swaps in a
  // brand-new EngineClient, the old instance's subscriber map is orphaned
  // (still "subscribed", but its socket is dead and nothing ever pushes
  // into it again) and the new instance starts with no listeners — so
  // position-update pushes would silently stop reaching the renderer after
  // the very first crash-recovery cycle, even though play/pause/stop still
  // work fine (those IPC handlers read `playbackEngine?.client` fresh on
  // every call, not once). Re-subscribing inside onRestarted, in addition to
  // the initial subscription, keeps the relay attached to whichever
  // EngineClient is actually live. Found and fixed during Task 8 manual
  // verification by reproducing it against the real spawned engine process
  // (see git history for the repro).
  //
  // CRITICAL, found in code review, 2026-09-17: this used to be a plain
  // `if (playbackEngine) {...}` block sitting later in this same
  // whenReady().then(async () => {...}) body, on the (wrong) assumption
  // that `playbackEngine` would already be assigned by the time execution
  // reached it. It never was -- see the .then() call site's own doc
  // comment (above, near startPlaybackEngine()) for why. That made this
  // whole relay block dead code on every single launch: no playhead
  // motion, no VU meters, no gated-recording preview, no Link tempo sync,
  // no plugin-loaded events reaching the renderer, and no crash-recovery
  // re-subscription -- while transport commands kept working fine (they
  // read playbackEngine?.client fresh per call), so it presented as "audio
  // plays but the UI looks frozen," not an obvious break. Now a real
  // function, called directly from inside startPlaybackEngine()'s own
  // .then(), right after playbackEngine is actually assigned -- the one
  // place in this file that's guaranteed to run AFTER that assignment.
  function subscribeEngineRelays(engine: PlaybackEngineHandle): void {
    function subscribeToPositionUpdates(): void {
      engine.client.on('position-update', (payload) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('engine-position-update', payload)
        }
      })
    }
    function subscribeToMasterPluginLoaded(): void {
      engine.client.on('master-plugin-loaded', (payload) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('master-plugin-loaded', payload)
        }
      })
    }
    function subscribeToChannelPluginLoaded(): void {
      engine.client.on('channel-plugin-loaded', (payload) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('channel-plugin-loaded', payload)
        }
      })
    }
    // Mirrors subscribeToPositionUpdates exactly -- same "re-subscribe on
    // every crash-recovery respawn" requirement applies here too (see that
    // function's own doc comment above), since this push rides the same
    // per-connection 30Hz timer in IpcServer.cpp.
    function subscribeToCaptureLevelUpdates(): void {
      engine.client.on('capture-level-update', (payload) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('engine-capture-level-update', payload)
        }
      })
    }
    // Same "rides the existing per-connection 30Hz timer, re-subscribe on
    // every crash-recovery respawn" reasoning as subscribeToCaptureLevelUpdates
    // above -- the gated (threshold-triggered) recording feature's own live
    // waveform preview.
    function subscribeToGatedRecordingUpdates(): void {
      engine.client.on('gated-recording-update', (payload) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('engine-gated-recording-update', payload)
        }
      })
    }
    // Unsolicited push from IpcServer.cpp's own link-poll MultiTimer id --
    // fires whenever LinkSession::checkForExternalTempoChange detects a peer
    // changed the Link session's tempo (see LinkSession.h's own doc comment).
    // Same "rides an engine-side timer, re-subscribe on every crash-recovery
    // respawn" reasoning as the other subscribeTo* functions here — this one
    // doesn't ride the SAME timer as position-update (it keeps running
    // independent of play state), but the respawn hazard is identical:
    // without re-subscribing here, a crash-triggered EngineClient swap would
    // silently stop forwarding Link tempo changes to the renderer.
    function subscribeToLinkTempoChanged(): void {
      engine.client.on('link-tempo-changed', (payload) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('engine-link-tempo-changed', payload)
        }
      })
    }
    subscribeToPositionUpdates()
    subscribeToMasterPluginLoaded()
    subscribeToChannelPluginLoaded()
    subscribeToCaptureLevelUpdates()
    subscribeToGatedRecordingUpdates()
    subscribeToLinkTempoChanged()

    engine.onRestarted(() => {
      subscribeToPositionUpdates()
      subscribeToMasterPluginLoaded()
      subscribeToChannelPluginLoaded()
      subscribeToCaptureLevelUpdates()
      subscribeToGatedRecordingUpdates()
      subscribeToLinkTempoChanged()
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('engine-restarted')
      }
    })
  }

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Asks the renderer to save now (the quit dialog's own "Save" choice,
// below), awaiting its reply over a dedicated round-trip pair --
// 'request-save-before-quit' pushed to the renderer, 'save-before-quit-
// complete' sent back once handleSave() resolves (see preload/index.ts's
// onRequestSaveBeforeQuit/notifySaveBeforeQuitComplete and App.tsx's Frame,
// which wires the two together). Raced against a fixed timeout, the same
// Promise.race shape as the engine shutdownTimeout below, so a hung or
// already-torn-down renderer can't make the app un-quittable.
function requestSaveBeforeQuit(): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) return Promise.resolve()
  const win = mainWindow
  const replyPromise = new Promise<void>((resolve) => {
    ipcMain.once('save-before-quit-complete', () => resolve())
  })
  const timeoutPromise = new Promise<void>((resolve) => setTimeout(resolve, 5000))
  win.webContents.send('request-save-before-quit')
  return Promise.race([replyPromise, timeoutPromise])
}

app.on('before-quit', (event) => {
  // isQuitting guards against infinite recursion from the app.quit() calls
  // below (both this handler's own dirty-prompt branch and the
  // engine-shutdown branch further down) re-triggering this same handler --
  // each of those is a deliberate re-issue of quit once there's nothing
  // left to interrupt it for, not a bug.
  if (isQuitting) return

  // Ask before discarding real unsaved work -- see rendererHasUnsavedChanges's
  // own doc comment above (kept current via the 'set-dirty-state' IPC call).
  // A NATIVE dialog here, not the custom in-app UnsavedChangesDialog: at
  // shutdown the window may already be tearing down, and a native
  // quit-prompt matches what every Mac user already expects from Cmd+Q. See
  // docs/superpowers/specs/2026-08-14-explicit-save-model-design.md, §5.
  if (rendererHasUnsavedChanges) {
    event.preventDefault()
    const choice = dialog.showMessageBoxSync({
      type: 'warning',
      buttons: ['Save', "Don't Save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      message: 'This project has unsaved changes.',
      detail: 'Do you want to save before quitting?'
    })
    if (choice === 2) return // Cancel -- stay open, nothing else to do.
    if (choice === 0) {
      // Save -- ask the renderer to save and wait for its reply (bounded by
      // a timeout, see requestSaveBeforeQuit), then re-issue quit now that
      // there's nothing left to lose.
      void requestSaveBeforeQuit().finally(() => {
        rendererHasUnsavedChanges = false
        app.quit()
      })
      return
    }
    // Don't Save -- the user just explicitly discarded unsaved work, so
    // clear the crash-recovery snapshot too (see the renderer-side discard
    // paths in App.tsx for the matching New/open/restore cases). Without
    // this, the debounced autosave effect's last snapshot survives and the
    // next launch offers to "recover" exactly the content just discarded.
    clearAutosave()
    rendererHasUnsavedChanges = false
    app.quit()
    return
  }

  // shutdown() is async — normally it resolves fast enough that this race
  // never matters, but if a crash-triggered respawn happens to be in flight
  // exactly when the user quits, shutdown() has to await that respawn
  // unwinding before it kills the engine process, which can run past the
  // point Electron's default quit sequence is blocked on. Deferring the
  // actual quit until shutdown() has genuinely finished avoids leaving an
  // orphaned native engine subprocess behind.
  if (!playbackEngine) return
  isQuitting = true
  event.preventDefault()
  // shutdown() has no internal timeout of its own — if a respawn's
  // EngineClient.connect() were to hang (unlike spawnEngine()'s own 5s
  // readiness timeout, a raw socket.connect() has no bound), awaiting it
  // unconditionally could make the app un-quittable via Cmd+Q/dock/menu,
  // which is worse than the orphaned-subprocess risk this handler exists to
  // avoid. Race it against a fixed timeout so quitting is never held
  // hostage by the engine layer.
  const shutdownTimeout = new Promise<void>((resolve) => setTimeout(resolve, 5000))
  Promise.race([playbackEngine.shutdown(), shutdownTimeout])
    .catch((err: unknown) => {
      // Not expected to reject under normal conditions (shutdown()'s
      // internal errors are already caught), but guarded the same way
      // playbackEngineLifecycle.ts guards its own internal fire-and-forget
      // respawn() call, since this runs with nothing else downstream to
      // catch a rejection.
      console.error('index: playbackEngine shutdown failed', err)
    })
    .finally(() => {
      app.quit()
    })
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
