import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import icon from '../../resources/icon.png?asset'
import { importRifff } from './importRifff'
import { importDemoRifff } from './demoRifff'
import { importOneShot, importRecordedTake, importRecordedStem } from './importOneShot'
import { readAudioFile } from './readAudioFile'
import { renderStretched } from './rubberband'
import {
  saveProjectAs,
  openProject,
  openProjectFromPath,
  writeAutosave,
  loadAutosave,
  clearAutosave,
  writeAutosaveSketchInfo,
  loadAutosaveSketchInfo,
  writeLastOpenedSketch,
  loadLastOpenedSketch,
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
import { nativeExport, nativeExportStemsToDisk } from './nativeExport'
import { startPlaybackEngine, type PlaybackEngineHandle } from './playbackEngineLifecycle'
import { runFullScan } from './runFullScan'
import { loadCatalog, toggleFavourite } from './pluginCatalog'
import { listFavouriteRiffCIDs, toggleFavouriteRiff } from './riffFavourites'
import type { RiffFilters } from '@shared/loreLibrary'
import {
  warehouseAvailable,
  warehouseRootPath,
  setWarehouseRoot,
  listJams,
  listRiffs,
  resolveRiff,
  resolveRiffWithContext,
  downloadMissingStems
} from './loreWarehouse'
import {
  loginWithCredentials,
  logout as endlesssLogout,
  getAuthStatus as getEndlesssAuthStatus,
  listSharedFeed,
  resolveSharedFeedRiff,
  listJams as listEndlesssJams,
  listRiffsInJam,
  resolveJamRiff,
  listRiffOwnership
} from './endlesssApi'
import { syncSharedFeed, syncJam } from './endlesssSync'
import { getSyncStatus } from './endlesssSyncIndex'
import {
  syncSharedFeed as syncSharedFeedToWarehouse,
  syncJam as syncJamToWarehouse
} from './loreWarehouseSync'
import { openOwnWarehouseDb } from './loreWarehouseSchema'
import { getWarehouseSyncStatus } from './loreWarehouseWriter'
import { migrateEndlesssStemCache } from './stemCacheMigration'
import {
  listLibrarySketches,
  libraryRootPath,
  setLibraryRootPath,
  shouldWarnBeforeOverwrite,
  renameSketch,
  deleteSketch
} from './projectLibrary'

// Assigned inside app.whenReady().then(...) once the engine has started;
// read from the before-quit handler below, which runs in a different
// closure and can't otherwise reach it.
let playbackEngine: PlaybackEngineHandle | undefined

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

// Guards before-quit's shutdown-then-requit sequence (see below) against
// re-entering itself when it calls app.quit() a second time.
let isQuitting = false

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
  })

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
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

  // One-time (idempotent) migration off the old source-partitioned Endlesss
  // stem cache -- see stemCacheMigration.ts's own doc comment. Cheap once
  // already migrated (a symlink-recognizing scan, no real work), so no need
  // to gate this behind anything or run it off the main thread.
  migrateEndlesssStemCache()

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

  ipcMain.handle('import-recorded-take', (_event, path: string, bpm: number, loopBars?: number) => {
    return importRecordedTake(path, bpm, loopBars)
  })

  ipcMain.handle(
    'import-recorded-stem',
    (_event, path: string, rifffBpm: number, loopBars: number, existingSlots: number[]) => {
      return importRecordedStem(path, rifffBpm, loopBars, existingSlots)
    }
  )

  ipcMain.handle('lore-warehouse-available', () => warehouseAvailable())

  ipcMain.handle('lore-warehouse-root', () => warehouseRootPath())

  ipcMain.handle('lore-set-warehouse-root', (_event, newRoot: string) => setWarehouseRoot(newRoot))

  ipcMain.handle('lore-list-jams', (_event, filterText: string) => listJams(filterText))

  ipcMain.handle('lore-list-riffs', (_event, jamCID: string, filters: RiffFilters) =>
    listRiffs(jamCID, filters)
  )

  ipcMain.handle('lore-resolve-riff', (_event, riffCID: string) => resolveRiff(riffCID))

  ipcMain.handle('lore-resolve-riff-with-context', (_event, riffCID: string) =>
    resolveRiffWithContext(riffCID)
  )

  ipcMain.handle('lore-download-missing-stems', (_event, riffCID: string) =>
    downloadMissingStems(riffCID)
  )

  ipcMain.handle('endlesss-login', (_event, username: string, password: string) =>
    loginWithCredentials(username, password)
  )
  ipcMain.handle('endlesss-logout', () => endlesssLogout())
  ipcMain.handle('endlesss-auth-status', () => getEndlesssAuthStatus())
  ipcMain.handle(
    'endlesss-list-shared-feed',
    (_event, userName: string, offset: number, count: number) =>
      listSharedFeed(userName, offset, count)
  )
  ipcMain.handle('endlesss-resolve-shared-feed-riff', (_event, riffCID: string) =>
    resolveSharedFeedRiff(riffCID)
  )
  ipcMain.handle('endlesss-list-jams', () => listEndlesssJams())
  ipcMain.handle('endlesss-list-riffs', (_event, jamId: string, filters: RiffFilters) =>
    listRiffsInJam(jamId, filters)
  )
  ipcMain.handle('endlesss-resolve-riff', (_event, jamId: string, riffCID: string) =>
    resolveJamRiff(jamId, riffCID)
  )
  ipcMain.handle(
    'endlesss-list-riff-ownership',
    (_event, jamId: string, riffCIDs: string[], targetUser: string) =>
      listRiffOwnership(jamId, riffCIDs, targetUser)
  )
  ipcMain.handle('endlesss-start-sync-shared-feed', (event, userName: string) =>
    syncSharedFeed(userName, (progress) => {
      event.sender.send('endlesss-sync-progress', {
        source: 'shared' as const,
        key: userName,
        ...progress
      })
    })
  )
  ipcMain.handle('endlesss-start-sync-jam', (event, jamId: string) =>
    syncJam(jamId, (progress) => {
      event.sender.send('endlesss-sync-progress', {
        source: 'jam' as const,
        key: jamId,
        ...progress
      })
    })
  )
  ipcMain.handle('endlesss-sync-status-shared-feed', (_event, userName: string) =>
    getSyncStatus('shared', userName)
  )
  ipcMain.handle('endlesss-sync-status-jam', (_event, jamId: string) => getSyncStatus('jam', jamId))

  ipcMain.handle('lore-sync-start-shared-feed', (event, userName: string) =>
    syncSharedFeedToWarehouse(userName, (progress) => {
      event.sender.send('lore-sync-progress', {
        source: 'shared' as const,
        key: userName,
        ...progress
      })
    })
  )
  ipcMain.handle('lore-sync-start-jam', (event, jamId: string, jamName: string) =>
    syncJamToWarehouse(jamId, jamName, (progress) => {
      event.sender.send('lore-sync-progress', {
        source: 'jam' as const,
        key: jamId,
        ...progress
      })
    })
  )
  ipcMain.handle('lore-sync-status', (_event, jamCID: string) =>
    getWarehouseSyncStatus(openOwnWarehouseDb(), jamCID)
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

  ipcMain.handle('open-project-from-path', (_event, path: string) => openProjectFromPath(path))

  ipcMain.handle('autosave-project', (_event, json: string) => writeAutosave(json))

  ipcMain.handle('load-autosave', () => loadAutosave())

  ipcMain.handle('clear-autosave', () => clearAutosave())

  ipcMain.handle('autosave-project-sketch', (_event, json: string) => writeAutosaveSketchInfo(json))

  ipcMain.handle('load-autosave-sketch', () => loadAutosaveSketchInfo())

  ipcMain.handle('save-last-opened-sketch', (_event, json: string) => writeLastOpenedSketch(json))

  ipcMain.handle('load-last-opened-sketch', () => loadLastOpenedSketch())

  ipcMain.handle('export-mix', (event, bytes: Uint8Array) => {
    const win = BrowserWindow.fromWebContents(event.sender)!
    return exportMixToWav(win, bytes)
  })

  ipcMain.handle('export-mix-native', async (_event, stateJson: string) => {
    const state = JSON.parse(stateJson) as import('../renderer/src/state/store').AppState
    return nativeExport(state)
  })

  ipcMain.handle('export-stems-native', async (event, stateJson: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)!
    const state = JSON.parse(stateJson) as import('../renderer/src/state/store').AppState
    return nativeExportStemsToDisk(win, state)
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

  ipcMain.handle('get-library-root', () => libraryRootPath())

  ipcMain.handle('set-library-root', (_event, newRoot: string) => setLibraryRootPath(newRoot))

  ipcMain.handle('should-warn-before-ableton-overwrite', (_event, libraryName: string) =>
    shouldWarnBeforeOverwrite(libraryName)
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

  try {
    playbackEngine = await startPlaybackEngine()
  } catch (err) {
    // Previously nothing could prevent createWindow() below from running —
    // this await is new this phase, and without a catch, a failed spawn
    // (binary missing/not yet rebuilt, a port bind failure, the readiness
    // timeout in engineProcess.ts firing) would throw here, become an
    // unhandled rejection, and skip createWindow() entirely: the app would
    // launch with no window and no visible error. The engine-* ipcMain
    // handlers below already guard every call with `playbackEngine?.`, so
    // it's safe to just leave playbackEngine undefined and continue —
    // export and every other feature are unaffected, only live playback is
    // unavailable for this session.
    console.error('index: failed to start the native playback engine', err)
    dialog.showErrorBox(
      'Playback engine failed to start',
      `sssketch could not start its native audio engine, so live playback will not work this session. Export and other features are unaffected.\n\n${String(err)}`
    )
  }

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
    (_event, slot: number, pluginId: string | null, path: string | null) => {
      playbackEngine?.client.send('load-master-plugin', { slot, pluginId, path })
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
    (_event, channelId: string, slot: number, pluginId: string | null, path: string | null) => {
      playbackEngine?.client.send('load-channel-plugin', { channelId, slot, pluginId, path })
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

  ipcMain.handle('list-riff-favourites', () => listFavouriteRiffCIDs())

  ipcMain.handle('toggle-riff-favourite', (_event, riffCID: string) => toggleFavouriteRiff(riffCID))

  createWindow()

  // Only in a packaged (production) build -- never in dev, where there's no
  // meaningful "newer published release" to check against, and running it
  // unconditionally would just spam electron-updater's own network calls +
  // logging on every dev-server restart for no benefit. Failure here (no
  // network, no releases published yet, etc.) must never be fatal to the
  // rest of the app -- it's a background convenience check, not a
  // load-bearing startup step.
  if (app.isPackaged) {
    autoUpdater.checkForUpdatesAndNotify().catch((err: unknown) => {
      console.error('index: auto-update check failed', err)
    })
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
  if (playbackEngine) {
    const engine = playbackEngine
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

app.on('before-quit', (event) => {
  // shutdown() is async — normally it resolves fast enough that this race
  // never matters, but if a crash-triggered respawn happens to be in flight
  // exactly when the user quits, shutdown() has to await that respawn
  // unwinding before it kills the engine process, which can run past the
  // point Electron's default quit sequence is blocked on. Deferring the
  // actual quit until shutdown() has genuinely finished avoids leaving an
  // orphaned native engine subprocess behind. isQuitting guards against
  // infinite recursion from the app.quit() call below re-triggering this
  // same handler.
  if (isQuitting || !playbackEngine) return
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
