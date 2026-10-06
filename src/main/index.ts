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
import {
  linkLoopFolder,
  listLoopFolders,
  setLoopTempoOverride,
  unlinkLoopFolder
} from './loopFolders'
import { recordLoopDuration, rescanAllLoopFolders, rescanLoopFolder } from './loopFolderScan'
import { importLinkedLoops } from './loopFolderImport'
import type { LinkLoopFolderResult } from '@shared/loopFolderTypes'
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
import type { ToolkitExportMode } from '@shared/toolkit'
import type { LiveParamField } from '@shared/liveParam'
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
  recordStemCategoryBus,
  recordStemCategoryRole,
  rebuildMissingCentroidStore,
  setCentroidStoreUnreadableListener
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
  downloadStemForAnalysis,
  candidateDbsForRiff,
  listJamsWithDb,
  riffLibraryArchiveReachable
} from './riffLibraryStore'
import {
  getDiscoverCandidates,
  getRandomLibraryCandidate,
  prewarmDiscoverCandidateCaches,
  appendToInMemoryDiscoverCaches,
  type DiscoverCandidate,
  type PrewarmScanProgress
} from './discoverCandidates'
import {
  forgetDiscoveredRifff,
  saveDiscoveredRifff,
  type DiscoveredMemberInput,
  type SaveDiscoveredResult
} from './discoveredLibrary'
import { fetchRadioHearts, resolveHeartStem } from './radioHeartsImport'
import { loadRadioHeartsKey, radioHeartsKeyStatus, saveRadioHeartsKey } from './radioHeartsKeyStore'
import {
  lanIPv4Address,
  remoteAddressCandidates,
  startRemoteServer,
  type RemoteServerHandle
} from './remoteServer'
import { loadPhoneRemoteSettings, savePhoneRemoteSettings } from './phoneRemoteSettingsStore'
import type { LanAddressCandidate } from '@shared/lanAddress'
import { createRemoteLoopRenderer, type RemoteLoopRenderer } from './remoteLoopRenderer'
import { createRemoteStemRenderer, type RemoteStemRenderer } from './remoteStemRenderer'
import type { EngineProject } from '@shared/buildEngineProject'
import {
  createRemoteKeepLedger,
  parseRemoteKeepId,
  parseRemoteKeepOutcome,
  type RemoteCommand,
  type RemoteState
} from '@shared/remoteState'
import type { PairingGate } from '@shared/remoteAuth'
import {
  getAdjacentDiscoverCandidates,
  findRiffForStemPath,
  type AdjacentDiscoverOptions
} from './discoverAdjacency'
import {
  discoverStemRestriction,
  getArtistStemCIDs,
  getArtistStemRows
} from './discoverArtistStems'
import {
  artistScanQueueSize,
  queueArtistStems,
  removeFromArtistScanQueue,
  takeArtistScanBatch
} from './discoverArtistScanQueue'
import { KEEP_REFUSED } from '@shared/discoverArtist'
import { abortArtistIndexWork, getArtistAnalysed, getArtistIndex } from './discoverArtistIndex'
import {
  keepBlockedForPhone,
  refusesKeep,
  refusesListenOnly,
  refusesStar,
  resetDiscoverArtistSession,
  setDiscoverArtistSession
} from './discoverArtistSession'
import type Database from 'better-sqlite3'
import { prewarmTraitQuantileTables } from './traitQuantileCache'
import { resolveStemArrangeRoles } from './resolveStemArrangeRole'
import { guessSoundTypeFromPresetName } from '@shared/presetNames'
import { loadDiscoverSettings, saveDiscoverSettings } from './discoverSettingsStore'
import type { DiscoverSettings } from './discoverSettingsStore'
import { loadSoundSettings, saveSoundSettings } from './soundSettingsStore'
import type { SoundMeters, SoundSettings } from '@shared/radioSound'
import {
  getStemAutoClassifyProgress,
  applyYamnetZeroShotCategory,
  markYamnetZeroShotAttempted,
  type StemAutoClassifyProgress
} from './stemAutoCategoryStore'
import { arrangeRoleForAudiosetClass } from '@shared/audiosetClasses'
import { listLibraryScanWork, type LibraryScanWork } from './libraryScanWork'
import { getStemPriority, seedStemPriorityOwnStems, setStemPriorityUsername } from './stemPriority'
import { loadOwnUsername, saveOwnUsername } from './ownUsernameStore'
import { seedTableCounts, whenTableCountsSeeded } from './tableCountSeed'
import { whenAllTableCountsSettled } from './tableChangeSignal'
import { stemPriorityRank } from '@shared/stemPriorityOrder'
import { getStemAvailabilityReport, onStemAvailabilityNotice } from './stemAvailability'
import type { StemAvailabilityNotice } from '@shared/stemAvailability'
import { SOUND_TYPE_TO_ARRANGE_ROLE, type ArrangeRole } from '@shared/stemRole'
import type { DiscoverSlotKind, DiscoverTraitKind } from '@shared/discoverSlotKind'
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
  removeJamSync as removeWarehouseJamSync,
  activeSyncCount as activeWarehouseSyncCount,
  setSyncsInFlightListener as setWarehouseSyncsInFlightListener
} from './riffLibrarySync'
import { openOwnRiffLibraryDb, ownRiffLibraryRoot } from './riffLibrarySchema'
import {
  getWarehouseSyncStatus,
  listWarehouseFavourites,
  toggleWarehouseFavourite
} from './riffLibraryWriter'
import { listStemFavourites, toggleStemFavourite } from './stemFavouriteStore'
import { listTidyUpLibraryStems, type TidyUpLibraryStem } from './tidyUpLibraryStems'
import {
  getStemCategoryRolesForPaths,
  resolveSourceProjectPath,
  stemCIDForPath,
  type StemBusCategoryEntry,
  type StemRoleCategoryEntry,
  type StemRoleLookup
} from './stemCategoriesStore'
import { getStemFeatureCache, setStemFeatureCache } from './stemFeatureCacheStore'
import { getStemPeaksCache, setStemPeaksCache, type StemPeaks } from './stemPeaksCacheStore'
import { getStemGlyphCache, setStemGlyphCache } from './stemGlyphCacheStore'
import type { StemGlyphCacheEntry, StemGlyphCacheWrite } from '@shared/glyphBands'
import { getStemEmbeddingCache, setStemEmbeddingCache } from './stemEmbeddingCacheStore'
import { readYamnetModelBytes } from './yamnetModel'
import { enableWorkCounters } from './workCounters'
import { getStemAnalysisNeeds } from './stemAnalysisNeeds'
import { writeStemAnalysisResults } from './stemAnalysisResultsWriter'
import type { StemAnalysisWrite } from '@shared/stemAnalysisWrite'
import type { StemAnalysisNeeds } from '@shared/stemAnalysisNeeds'
import type { StemFeatures } from '@shared/stemFeatures'
import type { ProjectRef } from '@shared/types'
import { restrictStems } from '@shared/discoverFaves'
import { migrateEndlesssStemCache } from './stemCacheMigration'
import { migrateLegacyFavourites } from './riffFavouritesMigration'
import { backfillStemCategoriesFromProjectLibrary } from './stemCategoriesBackfill'
import { backfillInstrumentMaskCategories } from './instrumentMaskCentroidBackfill'
import {
  startStemAutoClassifyScheduler,
  getAutoClassifyStatus,
  setAutoClassifyStatusListener,
  type AutoClassifyStatus
} from './stemAutoClassifyScheduler'
import { migrateProjectLibraryLocation } from './projectLibraryMigration'
import { createWindowNoticeQueue } from './windowNoticeQueue'
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
// Warnings raised before the window exists (the startup backfill) or after:
// each is shown as a sheet on the main window once it is ready to show,
// never as a parentless dialog, which on macOS blocks the main process
// (windowNoticeQueue.ts). createWindow() tells it when the window is ready
// and when it is closed.
const windowNotices = createWindowNoticeQueue<BrowserWindow>()
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

// True once every library index can answer reads (faster startup,
// 2026-10-06): saved copies loaded, or the own-only index built where a copy
// has to be rebuilt. StartupGate closes here, not at libraryWarmupDone; the
// walks that extend or rebuild run after it, under BackgroundWorkIndicator's
// "indexing library". Same query-plus-push pattern.
let libraryIndexUsable = false

// Whose own-only index a startup rebuild serves first: the last username the
// renderer reported (ownUsernameStore.ts), so it is known before the renderer
// has spoken; updated by every report-own-username.
let ownUsername: string | null = null

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

// The phone remote is OFF BY DEFAULT and per-session -- never auto-started,
// stopped on quit, and no accounts. The one thing that IS persisted, since
// 2026-09-26, is WHICH ADDRESS to serve on if he switches it on: a
// per-machine fact about his network (phoneRemoteSettingsStore.ts), not a
// record that the remote was ever running.
let remoteServer: RemoteServerHandle | null = null
// The phone's keeps by tap id, and what each came to (2026-10-01). Held
// HERE rather than in the renderer so a Discover remount cannot lose an
// answer the phone is waiting on, and so a duplicate request is dropped
// before it can keep twice.
const remoteKeeps = createRemoteKeepLedger()

let lastRemoteState: RemoteState = {
  discoverOpen: false,
  playing: false,
  kept: 0,
  rolled: 0,
  lastKeptName: null,
  loopBars: 0,
  radio: null,
  slots: []
}
let remotePairingGate: PairingGate = { attemptsUsed: 0, lockedOut: false }
// The phone remote's own render engine -- SEPARATE from the session-long
// playback engine, which is busy playing. Created when the remote is switched
// on and torn down with it, so at rest this feature owns no process at all.
let remoteLoop: RemoteLoopRenderer | null = null
// The phone's per-stem audio. No engine, no spawn, no cold start: it shells
// out to afconvert per stem and holds the bytes in memory. Lives and dies
// with the server, like the loop renderer beside it.
let remoteStems: RemoteStemRenderer | null = null

interface PhoneRemoteStatus {
  running: boolean
  url: string | null
  pairingCode: string | null
  attemptsUsed: number
  lockedOut: boolean
  /** The address the remote is on, or would be on if switched on now --
   * his remembered choice when it is still present, else the best default.
   * Null when this machine has nothing usable, in which case the phone
   * could not reach it and the gear menu says so instead of starting a
   * server. */
  lanAddress: string | null
  /** Every address it COULD be served on, best first. More than one and
   * the modal shows a picker; see phoneRemoteAddressOptions. */
  candidates: LanAddressCandidate[]
}

function phoneRemoteStatus(): PhoneRemoteStatus {
  const candidates = remoteAddressCandidates()
  return {
    running: remoteServer !== null,
    url: remoteServer?.url ?? null,
    pairingCode: remoteServer?.pairingCode ?? null,
    attemptsUsed: remotePairingGate.attemptsUsed,
    lockedOut: remotePairingGate.lockedOut,
    // While running, the address the server is ACTUALLY on -- not what the
    // resolver would pick now. The two differ for a moment if he unplugs
    // an interface while the remote is up, and the picker must mark the one
    // the URL on screen belongs to.
    lanAddress: remoteServer
      ? remoteServer.address
      : lanIPv4Address(loadPhoneRemoteSettings().preferredAddress),
    candidates
  }
}

/** Brings the http server up on one address, reusing the render engine if
 * there already is one. Separate from the ipc handler because switching
 * address restarts the server and MUST NOT restart the renderer with it:
 * createRemoteLoopRenderer has a documented 45s cold start, and he is
 * standing in front of the modal waiting for a QR code to change. */
function startPhoneRemoteOn(address: string): void {
  // A new server means a new pairing code, so the attempt counter starts
  // over with it -- an old count against a code that no longer exists
  // would be meaningless arithmetic on screen.
  remotePairingGate = { attemptsUsed: 0, lockedOut: false }
  // Spawned here and deliberately NOT awaited: READINESS_TIMEOUT_MS is 45s
  // for documented cold-start reasons and the gear menu must not sit on it.
  // The first render awaits it instead.
  remoteLoop ??= createRemoteLoopRenderer()
  // No engine, no spawn, no cold start -- it shells out to afconvert per
  // stem and caches the bytes. Created here only so it dies with the server.
  remoteStems ??= createRemoteStemRenderer()
  remoteServer = startRemoteServer({
    lanAddress: address,
    getState: () => {
      // stemId is injected HERE, from main's own map, for the same reason
      // loopId is: remoteStateFromSlots is the privacy boundary and has
      // never seen a resolvedPath. See RemoteSlotResponse.
      const bySlot = remoteStems?.stemIdsBySlotId() ?? new Map<string, string>()
      return {
        ...lastRemoteState,
        loopId: remoteLoop?.currentLoopId() ?? null,
        listenOnly: keepBlockedForPhone(),
        keeps: remoteKeeps.results(),
        slots: lastRemoteState.slots.map((slot) => ({
          ...slot,
          stemId: bySlot.get(slot.id) ?? null
        }))
      }
    },
    loopWav: () => remoteLoop?.wav() ?? Promise.resolve(null),
    stemBytes: (stemId: string) => remoteStems?.bytes(stemId) ?? Promise.resolve(null),
    onCommand: (command: RemoteCommand) => {
      // Commands are performed by the RENDERER, by calling the exact
      // functions its own buttons call. There is no second
      // implementation of anything.
      // A keep id already seen is a duplicate request: it must not keep twice.
      if (command.kind === 'keep' && command.keepId !== undefined) {
        if (!remoteKeeps.begin(command.keepId)) return
      }
      mainWindow?.webContents.send('remote-command', command)
    },
    refusesKeep: () => refusesKeep(),
    onPairingChanged: (gate) => {
      remotePairingGate = gate
      mainWindow?.webContents.send('phone-remote-status', phoneRemoteStatus())
    },
    onServerError: () => {
      // The listen failed (port 7373 already taken is the realistic
      // one). Forget the handle so the gear menu says it is off rather
      // than showing a URL nothing is listening on.
      stopPhoneRemote()
      mainWindow?.webContents.send('phone-remote-status', phoneRemoteStatus())
    }
  })
}

function stopPhoneRemote(): void {
  remoteServer?.stop()
  remoteServer = null
  remoteLoop?.stop()
  remoteLoop = null
  remoteStems?.stop()
  remoteStems = null
  remotePairingGate = { attemptsUsed: 0, lockedOut: false }
}

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
    windowNotices.windowReady(win)
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
    // listJamsWithDb reads the archive's Riffs signal: after the worker's
    // count, so that read takes none of its own on the main thread.
    void Promise.all(candidateDbsForRiff().map((db) => whenTableCountsSeeded(db)))
      .then(() =>
        prewarmDiscoverCandidateCaches(
          listJamsWithDb().map(({ jamCID, db }) => ({ jamCID, dbForJam: db })),
          openOwnRiffLibraryDb(),
          (progress: PrewarmScanProgress) => {
            mainWindow?.webContents.send('library-warmup-progress', progress)
          },
          {
            ownUsername: () => ownUsername,
            // Its stems are "only my stems"' restriction set too: handed over,
            // not read a second time while the rebuild walk runs.
            onOwnIndex: (db, own) => {
              if (own.stems) seedStemPriorityOwnStems(db, own.username, own.stems)
            },
            // Faster startup (2026-10-06): the gate opens once every index can
            // answer reads; the walks that extend or rebuild them follow.
            onUsable: () => {
              libraryIndexUsable = true
              mainWindow?.webContents.send('library-index-usable')
              // Library-wide trait percentiles (Discover promise-vs-delivery spec,
              // Phase 1): built now, so the first trait roll doesn't pay for it.
              // Paginated + yielding; it reads only ownDb.
              void prewarmTraitQuantileTables(openOwnRiffLibraryDb())
            }
          }
        )
      )
      .finally(() => {
        // A prewarm that failed before it was usable must not keep the gate up.
        if (!libraryIndexUsable) {
          libraryIndexUsable = true
          mainWindow?.webContents.send('library-index-usable')
          void prewarmTraitQuantileTables(openOwnRiffLibraryDb())
        }
        libraryWarmupDone = true
        mainWindow?.webContents.send('library-warmup-complete')
      })
  })

  win.on('closed', () => windowNotices.windowGone(win))

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
  // Discover artist mode: the renderer's chosen artist starts as `me` on
  // every load, so main's mirror must too. Reset when a main-frame load
  // STARTS, not when it finishes: a guarded call from the old page landing
  // in between, or the new page pushing its artist before did-finish-load,
  // must never meet a stale `other`.
  win.webContents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) resetDiscoverArtistSession()
  })

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

  // Dev-only once-a-minute work summary (decodes/IPC/SQL counts) -- see
  // src/main/workCounters.ts. A no-op in packaged builds.
  enableWorkCounters(!app.isPackaged)

  // One-time, idempotent relocation of the project library from its old
  // default (~/Music/sssketch/ directly) onto its new one
  // (~/Music/sssketch/projects/) -- see projectLibraryMigration.ts's own
  // doc comment. No ordering constraint relative to the other migrations
  // below (touches an entirely separate directory tree), but run first for
  // readability alongside its riff-library counterpart.
  migrateProjectLibraryLocation()

  // Same for the riff library -- see riffLibraryMigration.ts's own doc
  // comment. MUST run before migrateEndlesssStemCache's
  // openOwnRiffLibraryDb() call just below, which is this process's first
  // time opening that connection -- moving the directory out from under an
  // already-open one would corrupt it.
  migrateRiffLibraryLocation()

  // Whose own stems come first, known from the last launch until the
  // renderer reports it again (report-own-username): the startup prewarm's
  // own-only index needs it before the renderer has said anything.
  ownUsername = loadOwnUsername()
  setStemPriorityUsername(ownUsername)

  // The archive's row counts, before anything reads them (faster startup,
  // tableCountSeed.ts): a count saved at a launch the file is unchanged
  // since is primed right here, synchronously; otherwise one is taken on a
  // worker thread. Either way no reader pays the 1.7-2.3 s COUNT on the main
  // thread (only one that runs before a worker count is back, after a sync).
  for (const db of candidateDbsForRiff()) void seedTableCounts(db, openOwnRiffLibraryDb())

  // One-time (idempotent) migration off the old source-partitioned Endlesss
  // stem cache -- see stemCacheMigration.ts's own doc comment. Once a pass
  // finds nothing left to move it records a done-marker in ownDb
  // (startupBackfillGate.ts), and later launches skip the listing entirely.
  migrateEndlesssStemCache(openOwnRiffLibraryDb())

  // One-time-in-spirit, idempotent migration of favourites off the old
  // flat-JSON file onto the new warehouse's Tags table -- see
  // riffFavouritesMigration.ts's own doc comment for why this is safe to
  // run unconditionally on every startup.
  migrateLegacyFavourites(openOwnRiffLibraryDb())

  // A classifier training file (busCentroids.json) that exists but will not
  // load is never trained into or saved over (categoryCentroidTraining.ts),
  // so nothing learns from new confirmations until it is fixed or moved
  // aside: say so, once per distinct error, not only in the console. Set
  // before the backfill below, the first training write of a launch. The
  // backfill runs before the window exists, so the warning waits for it
  // (windowNotices): a dialog with no parent window would block startup.
  setCentroidStoreUnreadableListener((path, error) => {
    windowNotices.post(`centroid-store-unreadable:${error}`, (win) => {
      void dialog
        .showMessageBox(win, {
          type: 'warning',
          buttons: ['show in finder', 'ok'],
          defaultId: 1,
          cancelId: 1,
          message:
            "sssketch couldn't read the file where it keeps what it has learned from your " +
            "confirmed stems, so it won't learn new ones until this is fixed.",
          detail:
            'your confirmed stems themselves are still saved. move this file somewhere else ' +
            `and sssketch rebuilds it from them.\n\n${path}\n(${error})`
        })
        .then(({ response }) => {
          if (response === 0) shell.showItemInFolder(path)
        })
    })
  })

  // One-time-in-spirit, safe-to-call-on-every-startup migration recovering
  // busOf bus assignments trapped in old .sssketchproj files under the
  // project library folder -- see stemCategoriesBackfill.ts's own doc
  // comment. A project file unchanged since it was backfilled completely is
  // not parsed again (startupBackfillGate.ts).
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

  // A classifier training file (busCentroids.json) that is missing -- first
  // run, or moved aside -- and that neither backfill above rebuilt (they
  // rebuild it only on a write, and an unchanged library writes nothing) is
  // rebuilt from the db now, so the classifier doesn't run on an empty store
  // until the next bus or role confirmation. After the backfills, so it
  // holds what they wrote. Synchronous, ~50 ms on Elling's db; a no-op when
  // the file is there.
  if (rebuildMissingCentroidStore(openOwnRiffLibraryDb())) {
    console.log('rebuildMissingCentroidStore: rebuilt busCentroids.json from the library db')
  }

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

  // Linked loop folders (docs/superpowers/specs/2026-10-01-import-loop-
  // folders-design.md). The picker is the existing pick-folder. Everything
  // here is the own library db; the folders themselves are only read.
  ipcMain.handle('loop-folders-list', () => listLoopFolders(openOwnRiffLibraryDb()))

  ipcMain.handle(
    'loop-folders-link',
    async (_event, rootPath: string, projectBpm: number): Promise<LinkLoopFolderResult> => {
      const db = openOwnRiffLibraryDb()
      const linked = linkLoopFolder(db, rootPath)
      if (!linked.ok) return linked
      await rescanLoopFolder(db, linked.folder.rootPath, projectBpm)
      const folder = listLoopFolders(db).find((f) => f.rootPath === linked.folder.rootPath)
      return folder ? { ok: true, folder } : linked
    }
  )

  ipcMain.handle('loop-folders-unlink', (_event, rootPath: string) =>
    unlinkLoopFolder(openOwnRiffLibraryDb(), rootPath)
  )

  ipcMain.handle('loop-folders-rescan', async (_event, projectBpm: number) => {
    const db = openOwnRiffLibraryDb()
    await rescanAllLoopFolders(db, projectBpm)
    return listLoopFolders(db)
  })

  ipcMain.handle('loop-folders-set-tempo', (_event, loopId: string, bpm: number | null) =>
    setLoopTempoOverride(openOwnRiffLibraryDb(), loopId, bpm)
  )

  ipcMain.handle(
    'loop-folders-report-duration',
    (_event, loopId: string, durationSec: number, projectBpm: number) =>
      recordLoopDuration(openOwnRiffLibraryDb(), loopId, durationSec, projectBpm)
  )

  ipcMain.handle('loop-folders-import', (_event, loopIds: string[], projectBpm: number) =>
    importLinkedLoops(openOwnRiffLibraryDb(), loopIds, projectBpm)
  )

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

  ipcMain.handle(
    'riff-library-list-jams',
    // targetUser is the renderer's own "your username" setting -- passing
    // it asks for each jam's authorship counts (jamOwnership.ts), which is
    // what the sidebar's ordering and its "only my jams" filter run on.
    // After the startup worker's archive count (tableCountSeed.ts): the
    // ownership counts' cache reads the Riffs signal.
    async (_event, filterText: string, targetUser?: string) => {
      await whenAllTableCountsSettled()
      return listJams(filterText, targetUser)
    }
  )

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

  // One explicit, human-initiated save. Eight stemCIDForPath point lookups
  // is not what CLAUDE.md's "never one query per stem" rule is about;
  // everything that WRITES inside saveDiscoveredRifff is one transaction.
  // keep's whole save, shared by the keep button and "fetch radio hearts"
  // (radioHeartsImport.ts) so a fetched combo is kept exactly as a kept one.
  function keepDiscovered(
    members: DiscoveredMemberInput[],
    bpm: number,
    barLength: number
  ): SaveDiscoveredResult | null {
    const ownDb = openOwnRiffLibraryDb()
    const result = saveDiscoveredRifff(ownDb, candidateDbsForRiff(), {
      members,
      bpm,
      barLength,
      creationTime: Math.floor(Date.now() / 1000)
    })
    // AFTER the commit, never inside it -- appendToInMemoryDiscoverCaches
    // re-reads the table signals the in-memory caches are validated
    // against, and those have to see the new counts. saveDiscoveredRifff
    // hands back exactly the rows to fold in (indexRows /
    // newInstrumentRows) rather than this handler re-deriving StemCIDs it
    // does not have.
    if (result && !result.duplicate) {
      appendToInMemoryDiscoverCaches(ownDb, result.indexRows, result.newInstrumentRows)
    }
    return result
  }

  ipcMain.handle(
    'save-discovered-rifff',
    (
      _event,
      members: DiscoveredMemberInput[],
      bpm: number,
      barLength: number,
      // The artists whose stems are still on Discover's rows, at the moment
      // of this keep (lingeringArtists). Optional: an older caller sends none.
      lingering?: unknown
    ) =>
      // A refusal is KEEP_REFUSED, never null: null still means "nothing
      // was kept", and the renderer has to tell the two apart.
      refusesKeep(lingering) ? KEEP_REFUSED : keepDiscovered(members, bpm, barLength)
  )

  // "fetch radio hearts" -- ell.ing/radio's hearted combos as kept riffs and
  // starred stems. The only network call is here; the key never leaves
  // main (the renderer only learns whether one is set).
  ipcMain.handle('fetch-radio-hearts', () => {
    if (refusesListenOnly('fetchHearts')) return { ok: false, reason: 'listening only' } as const
    const ownDb = openOwnRiffLibraryDb()
    const dbs = [ownDb, ...candidateDbsForRiff().filter((db) => db !== ownDb)]
    return fetchRadioHearts({
      key: loadRadioHeartsKey(),
      fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(20_000) }),
      ownDb,
      archiveReachable: riffLibraryArchiveReachable,
      resolveStem: (stemCID) => resolveHeartStem(stemCID, dbs),
      save: keepDiscovered
    })
  })

  ipcMain.handle('radio-hearts-key-status', () => radioHeartsKeyStatus())

  ipcMain.handle('set-radio-hearts-key', (_event, key: string | null) => {
    saveRadioHeartsKey(key)
    return radioHeartsKeyStatus()
  })

  ipcMain.handle('forget-discovered-rifff', (_event, riffCID: string) =>
    forgetDiscoveredRifff(openOwnRiffLibraryDb(), riffCID)
  )

  ipcMain.handle('get-phone-remote-status', () => phoneRemoteStatus())

  ipcMain.handle('start-phone-remote', () => {
    if (remoteServer) return phoneRemoteStatus()
    const lanAddress = lanIPv4Address(loadPhoneRemoteSettings().preferredAddress)
    if (lanAddress === null) return phoneRemoteStatus()
    startPhoneRemoteOn(lanAddress)
    return phoneRemoteStatus()
  })

  /** He picked a different address in the modal. Remembered for next time
   * (per machine, see phoneRemoteSettingsStore.ts) and, if the remote is
   * up, moved onto it immediately -- the URL, the QR and the Host guard all
   * follow from the address the server was started with, so there is
   * nothing to move but the server itself.
   *
   * Restarting invalidates the pairing code, which is correct rather than
   * unfortunate: he is changing address because the phone could not reach
   * the old one, so there is no paired phone to disturb, and the modal he
   * is looking at redraws the QR from the new one. */
  ipcMain.handle('set-phone-remote-address', (_event, address: string | null) => {
    savePhoneRemoteSettings({ preferredAddress: address })
    if (remoteServer) {
      remoteServer.stop()
      remoteServer = null
      const next = lanIPv4Address(address)
      if (next !== null) startPhoneRemoteOn(next)
    }
    return phoneRemoteStatus()
  })

  ipcMain.handle('stop-phone-remote', () => {
    stopPhoneRemote()
    return phoneRemoteStatus()
  })

  ipcMain.handle('set-remote-state', (_event, state: RemoteState) => {
    lastRemoteState = state
  })

  ipcMain.handle('set-remote-loop', (_event, project: EngineProject | null, slotIds: string[]) => {
    // The project is full of real filesystem paths and NEVER leaves the main
    // process. What the phone sees is remoteLoop.currentLoopId() and, per
    // row, remoteStems.stemIdsBySlotId() -- sixteen hex characters each, of
    // a sha256 of the loop's (or the stem's) audio-bearing fields.
    //
    // slotIds rides along rather than arriving in a second call: it is one
    // id per EngineStem, in the same order, taken from the same array in the
    // same render (DiscoverPanel's `members`), so there is no second push to
    // fall out of step with. A length disagreement drops the map entirely.
    remoteLoop?.setLoop(project)
    remoteStems?.setLoop(project, slotIds ?? [])
  })

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

  ipcMain.handle(
    'export-als',
    async (event, stateJson: string, defaultName?: string, toolkitMode?: ToolkitExportMode) => {
      const win = BrowserWindow.fromWebContents(event.sender)!
      const state = JSON.parse(stateJson) as import('../renderer/src/state/store').AppState
      return exportAbleton(win, state, defaultName, toolkitMode)
    }
  )

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
    async (_event, stateJson: string, libraryName: string, toolkitMode?: ToolkitExportMode) => {
      const state = JSON.parse(stateJson) as import('../renderer/src/state/store').AppState
      return exportAbletonToLibrary(state, libraryName, toolkitMode)
    }
  )

  ipcMain.handle(
    'export-als-next-to-source',
    async (_event, stateJson: string, sourcePath: string, toolkitMode?: ToolkitExportMode) => {
      const state = JSON.parse(stateJson) as import('../renderer/src/state/store').AppState
      return exportAbletonNextToSource(state, sourcePath, toolkitMode)
    }
  )

  ipcMain.handle(
    'export-rpp',
    async (event, stateJson: string, defaultName?: string, toolkitMode?: ToolkitExportMode) => {
      const win = BrowserWindow.fromWebContents(event.sender)!
      const state = JSON.parse(stateJson) as import('../renderer/src/state/store').AppState
      return exportReaper(win, state, defaultName, toolkitMode)
    }
  )

  ipcMain.handle(
    'export-rpp-to-library',
    async (_event, stateJson: string, libraryName: string, toolkitMode?: ToolkitExportMode) => {
      const state = JSON.parse(stateJson) as import('../renderer/src/state/store').AppState
      return exportReaperToLibrary(state, libraryName, toolkitMode)
    }
  )

  ipcMain.handle(
    'export-rpp-next-to-source',
    async (_event, stateJson: string, sourcePath: string, toolkitMode?: ToolkitExportMode) => {
      const state = JSON.parse(stateJson) as import('../renderer/src/state/store').AppState
      return exportReaperNextToSource(state, sourcePath, toolkitMode)
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

  // Radio's scheduled swap. The project rides NESTED inside the payload
  // rather than being the payload, because EngineClient matches replies by
  // message TYPE and not by request id -- the token is what pairs an ack
  // to its request. Keeping the project a verbatim buildEngineProject
  // output is the point: it is the hand-synced twin of the C++
  // EngineProject and nothing on this path may reshape it.
  ipcMain.handle(
    'engine-stage-project',
    (_event, token: number, project: unknown, atBars?: number) => {
      playbackEngine?.sendStageProject(token, project, atBars)
    }
  )

  ipcMain.handle('engine-cancel-staged-project', (_event, token: number) => {
    playbackEngine?.sendCancelStagedProject(token)
  })

  // Radio fold mode (@shared/radioFold; native-engine/Source/CycleTable.h): the per-row cycles
  // for the next loop top, or for the next block with `now`. Fire-and-forget, like play/stop.
  ipcMain.handle(
    'engine-stage-cycles',
    (
      _event,
      rows: { row: string; id: string; bars: number; phaseBars: number }[],
      now: boolean
    ) => {
      // The engine keeps at most 8 rows and drops bad ones; this only keeps a
      // malformed call from the renderer off the socket.
      if (!Array.isArray(rows)) return
      playbackEngine?.client.send('stage-cycles', { rows: rows.slice(0, 8), now: now === true })
    }
  )

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
    (_event, field: LiveParamField, key: string, value: number) => {
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
      soundSource?: DiscoverSoundSourceFilter,
      artist?: string,
      alsoTraits?: DiscoverTraitKind[],
      onlyStemCIDs?: string[],
      alsoIntensity?: boolean
    ): Promise<DiscoverCandidate[]> => {
      // TEMPORARY diagnostic log (2026-09-15) -- a live report of rolling
      // staying stuck with no console errors made it impossible to tell,
      // from the outside, which part of this handler was slow. Remove
      // once confirmed.
      // listJamsWithDb reads the archive's Riffs signal: after the startup
      // worker's count, never a COUNT of its own on the main thread.
      await whenAllTableCountsSettled()
      const t0 = Date.now()
      const jams = listJamsWithDb().map(({ jamCID, db }) => ({ jamCID, dbForJam: db }))
      const t1 = Date.now()
      console.log(
        `get-discover-candidates(${kinds.join('+')}): listJamsWithDb -- ${jams.length} jams in ${t1 - t0}ms`
      )
      // Before-the-sample gate (discoverStemRestriction): artist mode's
      // artist, else with "only my stems" the target user's own stems --
      // so a 1,000-stem sample is drawn from them, not from the whole
      // library and then filtered down to ~1% of it. Neither: undefined,
      // today's path.
      const artistStemCIDs = await discoverStemRestriction(
        [...new Set(jams.map((j) => j.dbForJam))],
        { artist, onlyOwnStems, targetUser }
      )
      // The faves dial's favourites-only draw (@shared/discoverFaves): the same before-the-sample
      // gate artist mode uses, so a handful of starred stems is not lost in a 1000-stem sample.
      const favesStemCIDs = Array.isArray(onlyStemCIDs)
        ? new Set(onlyStemCIDs.filter((s): s is string => typeof s === 'string'))
        : undefined
      const result = await getDiscoverCandidates({
        ownDb: openOwnRiffLibraryDb(),
        jams,
        kinds,
        onlyOwnStems,
        targetUser,
        soundSource,
        artistStemCIDs: restrictStems(artistStemCIDs, favesStemCIDs),
        // Whose stems alone this roll can draw (artist mode's artist, else
        // "only my stems"' user): while the library index is still being
        // rebuilt at startup, that user's own-only index may answer it.
        ownStemsOf:
          (typeof artist === 'string' ? artist.trim() : '') ||
          (onlyOwnStems ? targetUser?.trim() || undefined : undefined),
        // Fold mode's clash (radioClash): the renderer only ever sends 'rhythmic' and 'bright'.
        alsoTraits: (Array.isArray(alsoTraits) ? alsoTraits : []).filter(
          (k) => k === 'rhythmic' || k === 'bright'
        ),
        // The radio's intensity arc (@shared/radioIntensity): only an explicit true attaches it.
        alsoIntensity: alsoIntensity === true
      })
      console.log(
        `get-discover-candidates(${kinds.join('+')}): getDiscoverCandidates -- ${result.length} candidates in ${Date.now() - t1}ms`
      )
      return result
    }
  )

  ipcMain.handle(
    'get-random-discover-candidate',
    async (
      _event,
      kinds: DiscoverSlotKind[],
      onlyOwnStems: boolean,
      targetUser?: string,
      soundSource?: DiscoverSoundSourceFilter
    ): Promise<DiscoverCandidate | null> => {
      await whenAllTableCountsSettled()
      return getRandomLibraryCandidate({
        ownDb: openOwnRiffLibraryDb(),
        jams: listJamsWithDb().map(({ jamCID, db }) => ({ jamCID, dbForJam: db })),
        kinds,
        onlyOwnStems,
        targetUser,
        soundSource
      })
    }
  )

  ipcMain.handle(
    'get-adjacent-discover-candidates',
    (
      _event,
      centerRiffCID: string,
      kinds: DiscoverSlotKind[],
      soundSource?: DiscoverSoundSourceFilter,
      creator?: unknown,
      options?: AdjacentDiscoverOptions
    ) =>
      getAdjacentDiscoverCandidates(
        centerRiffCID,
        kinds,
        soundSource,
        // One creator (artist mode) or a list (combine artists); anything else is no filter.
        typeof creator === 'string'
          ? creator.trim() || undefined
          : Array.isArray(creator)
            ? creator.filter((c): c is string => typeof c === 'string')
            : undefined,
        options ?? {}
      )
  )

  // Discover artist mode (2026-10-01): the picker's data. The dbs are the
  // ones Discover rolls from -- the same distinct set get-discover-candidates
  // derives from listJamsWithDb -- read after the startup worker's archive
  // count (tableCountSeed.ts), as listJamsWithDb reads the Riffs signal.
  async function discoverSourceDbs(): Promise<Database.Database[]> {
    await whenAllTableCountsSettled()
    return [...new Set(listJamsWithDb().map(({ db }) => db))]
  }

  ipcMain.handle('discover-artist-index', async (_event, ownUsername: unknown) =>
    getArtistIndex(
      openOwnRiffLibraryDb(),
      await discoverSourceDbs(),
      typeof ownUsername === 'string' ? ownUsername : ''
    )
  )

  ipcMain.handle('discover-artist-analysed', async (_event, artist: unknown) => {
    const name = (typeof artist === 'string' ? artist.trim() : '') || undefined
    return name
      ? getArtistAnalysed(openOwnRiffLibraryDb(), await discoverSourceDbs(), name)
      : { analysed: 0, total: 0 }
  })

  // Combine artists (spec 2026-10-06-combine-artists-design §6): warm each newly chosen artist's
  // stem list (getArtistStemCIDs' cache) one after another, so a new artist's first turn is not a
  // cold index read on the USB archive. A warm-up only: failures are logged, never thrown.
  ipcMain.handle('discover-prewarm-artists', async (_event, names: unknown) => {
    if (!Array.isArray(names)) return
    const dbs = await discoverSourceDbs()
    for (const name of names) {
      if (typeof name !== 'string' || name.trim() === '') continue
      try {
        await getArtistStemCIDs(dbs, name.trim())
      } catch (err) {
        console.error(`discover-prewarm-artists(${name}) failed:`, err)
      }
    }
  })

  // The renderer's answer to a phone keep: what keepGroup came to, by the
  // tap's own id (remoteKeeps). Validated: an unknown shape is dropped.
  ipcMain.handle('remote-keep-result', (_event, keepId: unknown, outcome: unknown) => {
    const id = parseRemoteKeepId(keepId)
    const result = parseRemoteKeepOutcome(outcome)
    if (id !== null && result !== null) remoteKeeps.finish(id, result)
  })

  // Discover artist mode's "analyse overnight" (Task 8). Reading audio for
  // classification is allowed in listen-only mode (spec §2): not guarded.
  ipcMain.handle('discover-queue-artist-analysis', async (_event, artist: unknown) => {
    const name = typeof artist === 'string' ? artist.trim() : ''
    if (name === '') return { queued: 0, total: 0, size: 0 }
    const rows = await getArtistStemRows(await discoverSourceDbs(), name)
    const ownDb = openOwnRiffLibraryDb()
    const queued = queueArtistStems(ownDb, rows, name)
    // `size`: the whole queue now (every artist), for the button and the
    // scan's indicator -- "queued 0" says nothing when they were all queued.
    return { queued, total: rows.length, size: artistScanQueueSize(ownDb) }
  })

  // The scan's priority batch: the next `limit` queued stems, downloaded
  // (in parallel -- limit is the scan's BATCH_SIZE, 3). path null = could
  // not be fetched; the renderer still finishes it so it never loops.
  // The scan's priority batch (takeArtistScanBatch): only a stem that
  // downloaded or is known unfetchable leaves the queue; a temporary failure
  // stays; with the archive drive away the whole queue pauses.
  ipcMain.handle('take-artist-scan-batch', (_event, limit: unknown) =>
    takeArtistScanBatch(
      openOwnRiffLibraryDb(),
      typeof limit === 'number' && Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 10) : 3,
      { archiveReachable: riffLibraryArchiveReachable, download: downloadStemForAnalysis }
    )
  )

  ipcMain.handle('finish-artist-scan-batch', (_event, stemCIDs: unknown) =>
    removeFromArtistScanQueue(
      openOwnRiffLibraryDb(),
      Array.isArray(stemCIDs) ? stemCIDs.filter((id): id is string => typeof id === 'string') : []
    )
  )

  ipcMain.handle(
    'discover-set-artist',
    (_event, artist: unknown, ownUsername: unknown, lingering?: unknown, artists?: unknown) =>
      setDiscoverArtistSession({
        artist: typeof artist === 'string' ? artist : null,
        ownUsername: typeof ownUsername === 'string' ? ownUsername : '',
        // Sanitised in the session (only non-empty strings count).
        lingering: Array.isArray(lingering) ? (lingering as string[]) : [],
        // Combine artists: the whole selection, normalized in the session. Absent (an older
        // renderer): `artist` alone is the selection, as before.
        ...(artists !== undefined ? { artists } : {})
      })
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
  ipcMain.handle('get-library-index-usable', (): boolean => libraryIndexUsable)
  // The renderer's "me" (resolveRiffLibraryUsername), reported at mount and
  // on every change: the background passes rank by it (stemPriority.ts), and
  // it is kept for the next launch's own-only index (ownUsernameStore.ts).
  ipcMain.handle('report-own-username', (_event, username: unknown): void => {
    const name = typeof username === 'string' ? username.trim() || null : null
    ownUsername = name
    setStemPriorityUsername(name)
    saveOwnUsername(name)
  })

  ipcMain.handle('get-engine-startup-status', (): boolean => engineStartupDone)

  // Stems that can no longer be downloaded (see @shared/stemAvailability):
  // queried once on mount for skips that happened before the renderer was
  // listening, plus a push for the first skip of a session and for each
  // newly-learned refusing host. StemsUnavailableIndicator.tsx is the one
  // surface for both -- a Discover roll and a library import go through the
  // same main-process download path, so neither screen needs to know.
  ipcMain.handle('get-stem-availability-report', (): StemAvailabilityNotice =>
    getStemAvailabilityReport()
  )
  onStemAvailabilityNotice((availability) => {
    mainWindow?.webContents.send('stem-availability-notice', availability)
  })

  // Background-work indicator (BackgroundWorkIndicator.tsx): the two
  // main-process processes that had no app-wide "is it running" signal.
  // Same query-on-mount-plus-push pattern as the warmup status above.
  // Reporting only -- neither changes when its process does anything.
  ipcMain.handle('get-auto-classify-status', (): AutoClassifyStatus => getAutoClassifyStatus())
  setAutoClassifyStatusListener((status) => {
    mainWindow?.webContents.send('auto-classify-status', status)
  })
  ipcMain.handle('get-riff-library-sync-active', (): number => activeWarehouseSyncCount())
  setWarehouseSyncsInFlightListener((count) => {
    mainWindow?.webContents.send('riff-library-sync-active', count)
  })

  ipcMain.handle('get-discover-settings', (): DiscoverSettings => loadDiscoverSettings())
  ipcMain.handle('set-discover-settings', (_event, settings: DiscoverSettings): void =>
    saveDiscoverSettings(settings)
  )

  // The app-wide default sound settings (native radio sound plan, Task 2): a new project, and a
  // project saved before the radio sound, start from these.
  ipcMain.handle('sound-settings:get', (): SoundSettings => loadSoundSettings())
  ipcMain.handle('sound-settings:set', (_event, settings: SoundSettings): void =>
    saveSoundSettings(settings)
  )

  ipcMain.handle('get-discover-classify-progress', (): StemAutoClassifyProgress =>
    getStemAutoClassifyProgress(openOwnRiffLibraryDb())
  )

  // The library scan's work list (background scan audit 3, libraryScanWork.ts):
  // what needs analysis first (SQL preselect over the persisted stem/jam pairs,
  // B6, and the trait value table's versions), then existence, asynchronously.
  // Own stems first, then favourites (stemPriority.ts): the renderer passes
  // its username (typed, else the Endlesss session's; null when none), which
  // also becomes the one main's own background passes rank by.
  ipcMain.handle(
    'get-discover-library-scan-work',
    async (_event, username: string | null = null): Promise<LibraryScanWork> => {
      setStemPriorityUsername(username)
      // listJamsWithDb and the scan targets read the archive's Riffs signal:
      // after the startup worker's count (tableCountSeed.ts).
      await whenAllTableCountsSettled()
      // Read alongside the listing, not before it (the first build takes
      // 4 s or more on the USB archive): both are `.all()` per bounded
      // statement with yields between, so they interleave safely on the
      // shared connection. The order is applied once both are done; a
      // failed read leaves today's order (listLibraryScanWork logs it).
      return listLibraryScanWork(
        listJamsWithDb().map(({ jamCID, db }) => ({ jamCID, dbForJam: db })),
        openOwnRiffLibraryDb(),
        { priority: getStemPriority() }
      )
    }
  )
  // A username change mid-session: the renderer re-ranks what its library
  // tier has left (DiscoverLibraryScan).
  ipcMain.handle(
    'get-stem-priority-ranks',
    async (_event, keys: string[], username: string | null): Promise<number[]> => {
      setStemPriorityUsername(username)
      const priority = await getStemPriority()
      return keys.map((key) => stemPriorityRank(priority, key))
    }
  )

  ipcMain.handle(
    'upsert-stem-category-bus',
    (_event, entries: StemBusCategoryEntry[], source: string, project: ProjectRef): void => {
      // Each (stem, bus) pair trains once into this app's store file
      // (busCentroids.json keeps the pairs it holds), whoever writes it
      // first: the startup backfill reading the same assignment from the
      // saved project later adds nothing. A store rebuilt from the db (the
      // file was missing) starts over from the rows (recordStemCategoryBus).
      recordStemCategoryBus(
        openOwnRiffLibraryDb(),
        entries,
        source,
        resolveSourceProjectPath(project),
        Date.now() / 1000,
        candidateDbsForRiff()
      )
    }
  )

  ipcMain.handle(
    'upsert-stem-category-role',
    (_event, entries: StemRoleCategoryEntry[], source: string, project: ProjectRef) => {
      recordStemCategoryRole(
        openOwnRiffLibraryDb(),
        entries,
        source,
        resolveSourceProjectPath(project),
        Date.now() / 1000,
        candidateDbsForRiff()
      )
    }
  )

  // The read side of the same table: what somebody already SAID these stems
  // are, keyed by the path the renderer asked about. Read-only; a path
  // nobody confirmed is simply absent from the result.
  ipcMain.handle(
    'get-stem-category-roles',
    (_event, paths: string[]): Record<string, StemRoleLookup> =>
      getStemCategoryRolesForPaths(openOwnRiffLibraryDb(), paths, candidateDbsForRiff())
  )

  // Tidy Up's LIBRARY population -- unconfirmed first, then most-recently-
  // imported (see listTidyUpLibraryStems' own doc comment for why that
  // ordering, and why least-confident-first was rejected as the default).
  ipcMain.handle(
    'get-tidy-up-library-stems',
    (_event, limit: number): Promise<TidyUpLibraryStem[]> =>
      listTidyUpLibraryStems(openOwnRiffLibraryDb(), candidateDbsForRiff(), limit)
  )

  // Batched "what's still missing" for the ambient scans (background-
  // efficiency spec, A3) -- chunked IN-list queries against the cache
  // tables, yielding between chunks; index-aligned with `paths`.
  ipcMain.handle(
    'get-stem-analysis-needs',
    (_event, paths: string[]): Promise<StemAnalysisNeeds[]> =>
      getStemAnalysisNeeds(openOwnRiffLibraryDb(), paths)
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

  // A stem's glyph rings and pitch line, persisted at drawn resolution (plan
  // 2026-10-05-merge-background-scans T9): StemCID-keyed for a library stem,
  // path + size:mtimeMs for any other file (an async stat, before any SQL).
  ipcMain.handle(
    'get-stem-glyph-cache',
    (_event, path: string): Promise<StemGlyphCacheEntry | null> =>
      getStemGlyphCache(openOwnRiffLibraryDb(), path)
  )

  ipcMain.handle(
    'set-stem-glyph-cache',
    (_event, path: string, write: StemGlyphCacheWrite): Promise<void> =>
      setStemGlyphCache(openOwnRiffLibraryDb(), path, write, Math.floor(Date.now() / 1000))
  )

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
      // Unmapped class: nothing to write, skip the StemCID lookup too.
      if (!arrangeRoleForAudiosetClass(audiosetClassIndex)) return
      const db = openOwnRiffLibraryDb()
      const stemCID = stemCIDForPath(db, path, candidateDbsForRiff())
      if (!stemCID) return
      // Floored -- see applyYamnetZeroShotCategory.
      applyYamnetZeroShotCategory(db, stemCID, audiosetClassIndex, Math.floor(Date.now() / 1000))
    }
  )

  // Records a zero-shot classification ATTEMPT, independent of whether
  // set-yamnet-zeroshot-category above actually wrote a role for it --
  // see StemYamnetZeroShotAttempted's own schema doc comment
  // (riffLibrarySchema.ts) for the full reasoning: most stems' own top
  // AudioSet class won't map to anything in audiosetClasses.ts's
  // deliberately narrow table, and that's a genuine, deterministic
  // answer for a given audio file -- without recording that the attempt
  // happened at all, get-stem-analysis-needs' zeroShot flag would keep
  // re-selecting the same never-classifiable stems forever.
  // Batched counterpart to the set-stem-*-cache / zero-shot handlers above
  // for the ambient scans (background efficiency B7): every output of
  // several analysed stems in one IPC and one (time-budgeted) transaction,
  // with the StemCIDs resolved in one query per db instead of per write.
  // The single-write handlers stay for interactive callers.
  ipcMain.handle(
    'set-stem-analysis-results',
    (_event, results: StemAnalysisWrite[]): Promise<void> =>
      writeStemAnalysisResults(
        openOwnRiffLibraryDb(),
        results,
        Math.floor(Date.now() / 1000),
        candidateDbsForRiff()
      )
  )

  ipcMain.handle('mark-yamnet-zeroshot-attempted', (_event, path: string) => {
    const db = openOwnRiffLibraryDb()
    const stemCID = stemCIDForPath(db, path, candidateDbsForRiff())
    if (!stemCID) return
    markYamnetZeroShotAttempted(db, stemCID, Math.floor(Date.now() / 1000))
  })

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

  // The radio sound's master meters (native radio sound plan, Task 13), for the sound panel's
  // dev-only readouts: dB at the end of the engine's last block, 0 while a stage is not running.
  ipcMain.handle('engine-get-sound-meters', async (): Promise<SoundMeters | null> => {
    if (!playbackEngine) return null
    try {
      return (await playbackEngine.client.sendAndAwaitType(
        'get-sound-meters',
        undefined,
        'sound-meters'
      )) as SoundMeters
    } catch (err) {
      console.error('engine-get-sound-meters: failed:', err)
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

  // Fire-and-forget, deliberately: Discover radio calls this a whole
  // change-interval before the stem is due, and there is nothing useful it
  // could do with a success or a failure. `client.send` (not
  // sendAndAwaitType) because the engine sends no reply -- see IpcServer's
  // own preload-stem handler. No engine running yet is a silent no-op, the
  // same as every other engine-* handler here.
  //
  // `path`/`durationSec` MUST be the resolved (post-stretch) pair, since
  // that is what load-project will later put in EngineStem.resolvedPath --
  // the renderer decides that, in warmEngineBuffer.ts.
  ipcMain.handle('engine-preload-stem', (_event, path: string, durationSec: number) => {
    playbackEngine?.client.send('preload-stem', { path, durationSec })
  })

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
    refusesStar()
      ? listStemFavourites(openOwnRiffLibraryDb())
      : toggleStemFavourite(openOwnRiffLibraryDb(), stemCID)
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
    // The two acks of the scheduled-swap contract. Relayed rather than
    // awaited (EngineClient.sendAndAwaitType matches by type, so two
    // changes in flight would cross their replies) -- the renderer pairs
    // them to its own request by the token it minted.
    function subscribeToProjectStageResult(): void {
      engine.client.on('project-stage-result', (payload) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('engine-project-stage-result', payload)
        }
      })
    }
    function subscribeToProjectApplied(): void {
      engine.client.on('project-applied', (payload) => {
        // Before the relay: a staged project that has gone live is what a
        // crash respawn has to restore, and the renderer's own handler
        // must not be able to run first and send something that races it.
        const token = (payload as { token?: unknown } | null)?.token
        if (typeof token === 'number') engine.promoteStagedProject(token)
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('engine-project-applied', payload)
        }
      })
    }
    subscribeToPositionUpdates()
    subscribeToProjectStageResult()
    subscribeToProjectApplied()
    subscribeToMasterPluginLoaded()
    subscribeToChannelPluginLoaded()
    subscribeToCaptureLevelUpdates()
    subscribeToGatedRecordingUpdates()
    subscribeToLinkTempoChanged()

    engine.onRestarted(() => {
      subscribeToPositionUpdates()
      subscribeToProjectStageResult()
      subscribeToProjectApplied()
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

// The phone remote is per-session and stops with the app. 'will-quit' rather
// than 'before-quit': before-quit can be preventDefault'd (the unsaved-changes
// prompt, the engine shutdown race below) and the user may still cancel, in
// which case the server should stay up. will-quit only fires once quitting is
// actually happening.
app.on('will-quit', () => {
  stopPhoneRemote()
  // Discover artist mode's background walks stop at their next page.
  abortArtistIndexWork()
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
