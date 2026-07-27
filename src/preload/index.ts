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
  getPathForFile: (file: File): string => webUtils.getPathForFile(file)
}

contextBridge.exposeInMainWorld('rifffApi', api)

export type RifffApi = typeof api
