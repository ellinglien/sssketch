import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { Rifff, ExportedStem } from '@shared/types'
import type { StretchedStem } from '@shared/buildEngineProject'
import type { LoreJam, LoreRiffSummary, LoreResolvedRiff } from '@shared/loreLibrary'
import type { PluginCatalog } from '../main/pluginCatalog'

const api = {
  importRifff: (paths: string[]): Promise<Rifff | null> =>
    ipcRenderer.invoke('import-rifff', paths),
  importOneShot: (path: string): Promise<Rifff | null> =>
    ipcRenderer.invoke('import-one-shot', path),
  importRecordedTake: (path: string, bpm: number): Promise<Rifff | null> =>
    ipcRenderer.invoke('import-recorded-take', path, bpm),
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
  autosaveProject: (json: string): Promise<void> => ipcRenderer.invoke('autosave-project', json),
  loadAutosave: (): Promise<string | null> => ipcRenderer.invoke('load-autosave'),
  clearAutosave: (): Promise<void> => ipcRenderer.invoke('clear-autosave'),
  autosaveProjectSketch: (json: string): Promise<void> =>
    ipcRenderer.invoke('autosave-project-sketch', json),
  loadAutosaveSketch: (): Promise<string | null> => ipcRenderer.invoke('load-autosave-sketch'),
  exportMix: (bytes: Uint8Array): Promise<string | null> => ipcRenderer.invoke('export-mix', bytes),
  exportMixNative: (stateJson: string): Promise<Uint8Array> =>
    ipcRenderer.invoke('export-mix-native', stateJson),
  exportStemsNative: (stateJson: string): Promise<ExportedStem[]> =>
    ipcRenderer.invoke('export-stems-native', stateJson),
  exportStems: (stems: ExportedStem[]): Promise<string | null> =>
    ipcRenderer.invoke('export-stems', stems),
  exportAls: (stateJson: string): Promise<string | null> =>
    ipcRenderer.invoke('export-als', stateJson),
  generateDefaultProjectName: (): Promise<string> =>
    ipcRenderer.invoke('generate-default-project-name'),
  saveProjectToLibrary: (name: string, json: string): Promise<{ path: string }> =>
    ipcRenderer.invoke('save-project-to-library', name, json),
  saveProjectInPlace: (path: string, json: string): Promise<void> =>
    ipcRenderer.invoke('save-project-in-place', path, json),
  openLibrarySketch: (name: string): Promise<{ path: string; json: string } | null> =>
    ipcRenderer.invoke('open-library-sketch', name),
  duplicateSketch: (currentName: string): Promise<{ name: string; path: string } | null> =>
    ipcRenderer.invoke('duplicate-sketch', currentName),
  listLibrarySketches: (): Promise<{ name: string; mtimeMs: number }[]> =>
    ipcRenderer.invoke('list-library-sketches'),
  getLibraryRoot: (): Promise<string> => ipcRenderer.invoke('get-library-root'),
  setLibraryRoot: (newRoot: string): Promise<void> =>
    ipcRenderer.invoke('set-library-root', newRoot),
  shouldWarnBeforeAbletonOverwrite: (libraryName: string): Promise<boolean> =>
    ipcRenderer.invoke('should-warn-before-ableton-overwrite', libraryName),
  exportAlsToLibrary: (stateJson: string, libraryName: string): Promise<void> =>
    ipcRenderer.invoke('export-als-to-library', stateJson, libraryName),
  engineLoadProject: (project: unknown): Promise<void> =>
    ipcRenderer.invoke('engine-load-project', project),
  enginePlay: (fromPos: number): Promise<void> => ipcRenderer.invoke('engine-play', fromPos),
  engineStop: (): Promise<void> => ipcRenderer.invoke('engine-stop'),
  engineSetPosition: (pos: number): Promise<void> => ipcRenderer.invoke('engine-set-position', pos),
  engineSetLiveParam: (
    field: 'volume' | 'fadeIn' | 'fadeOut',
    key: string,
    value: number
  ): Promise<void> => ipcRenderer.invoke('engine-set-live-param', field, key, value),
  engineSetLoopRegion: (startBar: number, endBar: number): Promise<void> =>
    ipcRenderer.invoke('engine-set-loop-region', startBar, endBar),
  engineListInputDevices: (): Promise<string[]> => ipcRenderer.invoke('engine-list-input-devices'),
  engineArmRecording: (
    channelId: string,
    deviceName: string,
    startBar: number,
    endBar: number
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('engine-arm-recording', channelId, deviceName, startBar, endBar),
  engineDisarmRecording: (): Promise<{ committed: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('engine-disarm-recording'),
  engineSetMetronome: (enabled: boolean): Promise<void> =>
    ipcRenderer.invoke('engine-set-metronome', enabled),
  engineLoadMasterPlugin: (
    slot: number,
    pluginId: string | null,
    path: string | null
  ): Promise<void> => ipcRenderer.invoke('engine-load-master-plugin', slot, pluginId, path),
  engineOpenMasterPluginEditor: (slot: number): Promise<void> =>
    ipcRenderer.invoke('engine-open-master-plugin-editor', slot),
  engineCloseMasterPluginEditor: (slot: number): Promise<void> =>
    ipcRenderer.invoke('engine-close-master-plugin-editor', slot),
  engineLoadChannelPlugin: (
    channelId: string,
    slot: number,
    pluginId: string | null,
    path: string | null
  ): Promise<void> =>
    ipcRenderer.invoke('engine-load-channel-plugin', channelId, slot, pluginId, path),
  engineOpenChannelPluginEditor: (channelId: string, slot: number): Promise<void> =>
    ipcRenderer.invoke('engine-open-channel-plugin-editor', channelId, slot),
  engineCloseChannelPluginEditor: (channelId: string, slot: number): Promise<void> =>
    ipcRenderer.invoke('engine-close-channel-plugin-editor', channelId, slot),
  scanPlugins: (): Promise<PluginCatalog> => ipcRenderer.invoke('scan-plugins'),
  getPluginCatalog: (): Promise<PluginCatalog> => ipcRenderer.invoke('get-plugin-catalog'),
  togglePluginFavourite: (id: string): Promise<PluginCatalog> =>
    ipcRenderer.invoke('toggle-plugin-favourite', id),
  onScanProgress: (callback: (progress: { done: number; total: number }) => void): (() => void) => {
    const listener = (_event: unknown, progress: { done: number; total: number }): void =>
      callback(progress)
    ipcRenderer.on('scan-progress', listener)
    return () => ipcRenderer.removeListener('scan-progress', listener)
  },
  onMasterPluginLoaded: (
    callback: (result: { slot: number; pluginId: string; success: boolean; error?: string }) => void
  ): (() => void) => {
    const listener = (
      _event: unknown,
      payload: { slot: number; pluginId: string; success: boolean; error?: string }
    ): void => callback(payload)
    ipcRenderer.on('master-plugin-loaded', listener)
    return () => ipcRenderer.removeListener('master-plugin-loaded', listener)
  },
  onChannelPluginLoaded: (
    callback: (result: {
      channelId: string
      slot: number
      pluginId: string
      success: boolean
      error?: string
    }) => void
  ): (() => void) => {
    const listener = (
      _event: unknown,
      payload: {
        channelId: string
        slot: number
        pluginId: string
        success: boolean
        error?: string
      }
    ): void => callback(payload)
    ipcRenderer.on('channel-plugin-loaded', listener)
    return () => ipcRenderer.removeListener('channel-plugin-loaded', listener)
  },
  onEnginePositionUpdate: (callback: (pos: number) => void): (() => void) => {
    const listener = (_event: unknown, payload: { pos: number }): void => callback(payload.pos)
    ipcRenderer.on('engine-position-update', listener)
    return () => ipcRenderer.removeListener('engine-position-update', listener)
  },
  // Channel name follows the same 'engine-' prefix convention as
  // onEnginePositionUpdate/onEngineRestarted above (main/index.ts's
  // subscribeToCaptureLevelUpdates forwards IpcServer's "capture-level-update"
  // engine push onto this renderer-facing 'engine-capture-level-update'
  // channel) -- deliberately NOT the bare 'capture-level-update' string, to
  // stay consistent with every other engine-originated push already bridged
  // here.
  onCaptureLevelUpdate: (
    callback: (channelId: string, peaksSoFar: number[], elapsedSeconds: number) => void
  ): (() => void) => {
    const listener = (
      _event: unknown,
      payload: { channelId: string; peaksSoFar: number[]; elapsedSeconds: number }
    ): void => callback(payload.channelId, payload.peaksSoFar, payload.elapsedSeconds)
    ipcRenderer.on('engine-capture-level-update', listener)
    return () => ipcRenderer.removeListener('engine-capture-level-update', listener)
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
      limit?: number
    }
  ): Promise<{ riffs: LoreRiffSummary[]; hasMore: boolean; nextOffset: number }> =>
    ipcRenderer.invoke('lore-list-riffs', jamCID, filters),
  loreResolveRiff: (riffCID: string): Promise<LoreResolvedRiff | null> =>
    ipcRenderer.invoke('lore-resolve-riff', riffCID),
  loreResolveRiffWithContext: (
    riffCID: string
  ): Promise<{ jamCID: string; offset: number; matchedRiffCID: string } | null> =>
    ipcRenderer.invoke('lore-resolve-riff-with-context', riffCID),
  loreDownloadMissingStems: (riffCID: string): Promise<LoreResolvedRiff | null> =>
    ipcRenderer.invoke('lore-download-missing-stems', riffCID)
}

contextBridge.exposeInMainWorld('rifffApi', api)

export type RifffApi = typeof api
