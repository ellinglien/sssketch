import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { Rifff } from '@shared/types'

const api = {
  importRifff: (paths: string[]): Promise<Rifff | null> =>
    ipcRenderer.invoke('import-rifff', paths),
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('pick-folder'),
  // Electron no longer augments dropped File objects with a `.path` property (removed
  // as of Electron 32+ — see https://electronjs.org/docs/api/web-utils). webUtils is
  // only reachable from main/preload, so the renderer has to go through this bridge
  // function, passed the File object itself, to resolve a real filesystem path.
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  // Raw bytes for a stem file, read by the main process (Node fs) and handed to the
  // renderer, which decodes them via Web Audio (decodeAudioData only exists in the
  // renderer/browser context).
  readAudioFile: (path: string): Promise<Uint8Array> => ipcRenderer.invoke('read-audio-file', path),
  renderStretched: (stemPath: string, ratio: number): Promise<string> =>
    ipcRenderer.invoke('render-stretched', stemPath, ratio),
  bakeOffset: (
    jobs: { path: string; rotationSec: number }[]
  ): Promise<{ path: string; bakedPath: string }[]> => ipcRenderer.invoke('bake-offset', jobs),
  saveProject: (json: string): Promise<string | null> => ipcRenderer.invoke('save-project', json),
  openProject: (): Promise<{ path: string; json: string } | null> =>
    ipcRenderer.invoke('open-project')
}

contextBridge.exposeInMainWorld('rifffApi', api)

export type RifffApi = typeof api
