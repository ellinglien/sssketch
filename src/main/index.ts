import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { importRifff } from './importRifff'
import { readAudioFile } from './readAudioFile'
import { renderStretched } from './rubberband'
import { saveProjectAs, openProject } from './projectFile'
import { bakeOffset, type BakeJob } from './bakeOffset'
import { exportMixToWav } from './exportMix'
import { nativeExport } from './nativeExport'
import { startPlaybackEngine, type PlaybackEngineHandle } from './playbackEngineLifecycle'

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
    width: 900,
    height: 670,
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

  ipcMain.handle('export-mix', (event, bytes: Uint8Array) => {
    const win = BrowserWindow.fromWebContents(event.sender)!
    return exportMixToWav(win, bytes)
  })

  ipcMain.handle('export-mix-native', async (_event, stateJson: string) => {
    const state = JSON.parse(stateJson) as import('../renderer/src/state/store').AppState
    return nativeExport(state)
  })

  playbackEngine = await startPlaybackEngine()

  ipcMain.handle('engine-load-project', (_event, project: unknown) => {
    playbackEngine?.sendLoadProject(project)
  })

  ipcMain.handle('engine-play', (_event, fromPos: number) => {
    playbackEngine?.client.send('play', { fromPos })
  })

  ipcMain.handle('engine-pause', () => {
    playbackEngine?.client.send('pause')
  })

  ipcMain.handle('engine-stop', () => {
    playbackEngine?.client.send('stop')
  })

  ipcMain.handle('engine-set-position', (_event, pos: number) => {
    playbackEngine?.client.send('set-position', { pos })
  })

  createWindow()

  playbackEngine.client.on('position-update', (payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('engine-position-update', payload)
    }
  })

  playbackEngine.onRestarted(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('engine-restarted')
    }
  })

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
  playbackEngine
    .shutdown()
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
