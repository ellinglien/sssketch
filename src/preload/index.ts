import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { Rifff, ExportedStem } from '@shared/types'
import type { StretchedStem } from '@shared/buildEngineProject'
import type { LoreJam, LoreRiffSummary, LoreResolvedRiff } from '@shared/loreLibrary'

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
  renderStretched: (stemPath: string, ratio: number): Promise<StretchedStem> =>
    ipcRenderer.invoke('render-stretched', stemPath, ratio),
  bakeOffset: (
    jobs: { path: string; rotationSec: number }[]
  ): Promise<{ path: string; bakedPath: string; durationSec: number }[]> =>
    ipcRenderer.invoke('bake-offset', jobs),
  saveProject: (json: string): Promise<string | null> => ipcRenderer.invoke('save-project', json),
  openProject: (): Promise<{ path: string; json: string } | null> =>
    ipcRenderer.invoke('open-project'),
  exportMix: (bytes: Uint8Array): Promise<string | null> => ipcRenderer.invoke('export-mix', bytes),
  exportMixNative: (stateJson: string): Promise<Uint8Array> =>
    ipcRenderer.invoke('export-mix-native', stateJson),
  exportStemsNative: (stateJson: string): Promise<ExportedStem[]> =>
    ipcRenderer.invoke('export-stems-native', stateJson),
  exportStems: (stems: ExportedStem[]): Promise<string | null> =>
    ipcRenderer.invoke('export-stems', stems),
  engineLoadProject: (project: unknown): Promise<void> =>
    ipcRenderer.invoke('engine-load-project', project),
  enginePlay: (fromPos: number): Promise<void> => ipcRenderer.invoke('engine-play', fromPos),
  engineStop: (): Promise<void> => ipcRenderer.invoke('engine-stop'),
  engineSetPosition: (pos: number): Promise<void> => ipcRenderer.invoke('engine-set-position', pos),
  engineSetMetronome: (enabled: boolean): Promise<void> =>
    ipcRenderer.invoke('engine-set-metronome', enabled),
  onEnginePositionUpdate: (callback: (pos: number) => void): (() => void) => {
    const listener = (_event: unknown, payload: { pos: number }): void => callback(payload.pos)
    ipcRenderer.on('engine-position-update', listener)
    return () => ipcRenderer.removeListener('engine-position-update', listener)
  },
  onEngineRestarted: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('engine-restarted', listener)
    return () => ipcRenderer.removeListener('engine-restarted', listener)
  },
  loreWarehouseAvailable: (): Promise<boolean> => ipcRenderer.invoke('lore-warehouse-available'),
  loreListJams: (filterText: string): Promise<LoreJam[]> =>
    ipcRenderer.invoke('lore-list-jams', filterText),
  loreListRiffs: (
    jamCID: string,
    filters: {
      dateFrom?: number
      dateTo?: number
      bpm?: number
      userName?: string
      onlyFullyCached?: boolean
      targetUser?: string
      onlyContainsUser?: boolean
      offset?: number
    }
  ): Promise<{ riffs: LoreRiffSummary[]; hasMore: boolean; nextOffset: number }> =>
    ipcRenderer.invoke('lore-list-riffs', jamCID, filters),
  loreResolveRiff: (riffCID: string): Promise<LoreResolvedRiff | null> =>
    ipcRenderer.invoke('lore-resolve-riff', riffCID),
  loreDownloadMissingStems: (riffCID: string): Promise<LoreResolvedRiff | null> =>
    ipcRenderer.invoke('lore-download-missing-stems', riffCID)
}

contextBridge.exposeInMainWorld('rifffApi', api)

export type RifffApi = typeof api
