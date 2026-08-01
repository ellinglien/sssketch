import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { importRifff } from './importRifff'
import { readAudioFile } from './readAudioFile'
import { renderStretched } from './rubberband'
import {
  saveProjectAs,
  openProject,
  writeAutosave,
  loadAutosave,
  clearAutosave
} from './projectFile'
import { bakeOffset, type BakeJob } from './bakeOffset'
import { exportMixToWav, exportStemsToWavs } from './exportMix'
import { nativeExport, nativeExportStems } from './nativeExport'
import type { ExportedStem } from '@shared/types'
import { startPlaybackEngine, type PlaybackEngineHandle } from './playbackEngineLifecycle'
import { runFullScan } from './runFullScan'
import { loadCatalog, toggleFavourite } from './pluginCatalog'
import {
  warehouseAvailable,
  listJams,
  listRiffs,
  resolveRiff,
  downloadMissingStems,
  type RiffFilters
} from './loreWarehouse'

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
    width: 1440,
    height: 960,
    minWidth: 900,
    minHeight: 600,
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

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.ellinglien.ssstitch')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.handle('import-rifff', (_event, paths: string[]) => {
    return importRifff(paths)
  })

  ipcMain.handle('lore-warehouse-available', () => warehouseAvailable())

  ipcMain.handle('lore-list-jams', (_event, filterText: string) => listJams(filterText))

  ipcMain.handle('lore-list-riffs', (_event, jamCID: string, filters: RiffFilters) =>
    listRiffs(jamCID, filters)
  )

  ipcMain.handle('lore-resolve-riff', (_event, riffCID: string) => resolveRiff(riffCID))

  ipcMain.handle('lore-download-missing-stems', (_event, riffCID: string) =>
    downloadMissingStems(riffCID)
  )

  ipcMain.handle('pick-folder', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return result.canceled ? null : result.filePaths[0]
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

  ipcMain.handle('export-mix', (event, bytes: Uint8Array) => {
    const win = BrowserWindow.fromWebContents(event.sender)!
    return exportMixToWav(win, bytes)
  })

  ipcMain.handle('export-mix-native', async (_event, stateJson: string) => {
    const state = JSON.parse(stateJson) as import('../renderer/src/state/store').AppState
    return nativeExport(state)
  })

  ipcMain.handle('export-stems-native', async (_event, stateJson: string) => {
    const state = JSON.parse(stateJson) as import('../renderer/src/state/store').AppState
    return nativeExportStems(state)
  })

  ipcMain.handle('export-stems', (event, stems: ExportedStem[]) => {
    const win = BrowserWindow.fromWebContents(event.sender)!
    return exportStemsToWavs(win, stems)
  })

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
      `ssstitch could not start its native audio engine, so live playback will not work this session. Export and other features are unaffected.\n\n${String(err)}`
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

  ipcMain.handle('engine-set-metronome', (_event, enabled: boolean) => {
    playbackEngine?.client.send('set-metronome', { enabled })
  })

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

  createWindow()

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
    subscribeToPositionUpdates()
    subscribeToMasterPluginLoaded()
    subscribeToChannelPluginLoaded()

    engine.onRestarted(() => {
      subscribeToPositionUpdates()
      subscribeToMasterPluginLoaded()
      subscribeToChannelPluginLoaded()
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
