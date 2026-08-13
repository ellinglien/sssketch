import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { Rifff, Stem } from '@shared/types'
import type { StretchedStem } from '@shared/buildEngineProject'
import type { LoreJam, LoreRiffSummary, LoreResolvedRiff } from '@shared/loreLibrary'
import type { PluginCatalog } from '../main/pluginCatalog'

const api = {
  importRifff: (paths: string[]): Promise<Rifff | null> =>
    ipcRenderer.invoke('import-rifff', paths),
  importDemoRifff: (): Promise<Rifff | null> => ipcRenderer.invoke('import-demo-rifff'),
  importOneShot: (path: string): Promise<Rifff | null> =>
    ipcRenderer.invoke('import-one-shot', path),
  // loopBars, when passed, is a gated-recording take's own loop-region
  // length -- see importRecordedTake's own doc comment for why that makes
  // it tile/loop like any other rifff instead of playing once (the default
  // when omitted, for manual arm/disarm takes).
  importRecordedTake: (path: string, bpm: number, loopBars?: number): Promise<Rifff | null> =>
    ipcRenderer.invoke('import-recorded-take', path, bpm, loopBars),
  // See importRecordedStem's own doc comment (src/main/importOneShot.ts)
  // for the tempo-compensation math -- rifffBpm is the TARGET rifff's own
  // bpm (not the project's live state.bpm), existingSlots is every other
  // stem already on that rifff (for slot-collision avoidance).
  importRecordedStem: (
    path: string,
    rifffBpm: number,
    loopBars: number,
    existingSlots: number[]
  ): Promise<Stem | null> =>
    ipcRenderer.invoke('import-recorded-stem', path, rifffBpm, loopBars, existingSlots),
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('pick-folder'),
  pickRifffImportPaths: (): Promise<string[]> => ipcRenderer.invoke('pick-rifff-import-paths'),
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
  openProjectFromPath: (path: string): Promise<{ path: string; json: string } | null> =>
    ipcRenderer.invoke('open-project-from-path', path),
  autosaveProject: (json: string): Promise<void> => ipcRenderer.invoke('autosave-project', json),
  loadAutosave: (): Promise<string | null> => ipcRenderer.invoke('load-autosave'),
  clearAutosave: (): Promise<void> => ipcRenderer.invoke('clear-autosave'),
  autosaveProjectSketch: (json: string): Promise<void> =>
    ipcRenderer.invoke('autosave-project-sketch', json),
  loadAutosaveSketch: (): Promise<string | null> => ipcRenderer.invoke('load-autosave-sketch'),
  // Distinct from autosave{Project,ProjectSketch}Sketch above -- those are
  // crash-recovery only (cleared once offered at startup). This pair is
  // never cleared, always reflecting the most recently opened/created
  // sketch, so the NEXT launch can open straight back into it -- see
  // App.tsx's mount effect.
  saveLastOpenedSketch: (json: string): Promise<void> =>
    ipcRenderer.invoke('save-last-opened-sketch', json),
  loadLastOpenedSketch: (): Promise<string | null> => ipcRenderer.invoke('load-last-opened-sketch'),
  exportMix: (bytes: Uint8Array): Promise<string | null> => ipcRenderer.invoke('export-mix', bytes),
  exportMixNative: (stateJson: string): Promise<Uint8Array> =>
    ipcRenderer.invoke('export-mix-native', stateJson),
  // Renders every stem straight to disk in the main process and returns
  // the chosen destination folder (or null if the folder picker was
  // cancelled) -- stem audio never crosses IPC at all, unlike the old
  // exportStemsNative()+exportStems() pair (see nativeExport.ts's
  // renderStemsToDir doc comment for why that crashed on large projects).
  exportStemsNative: (stateJson: string): Promise<string | null> =>
    ipcRenderer.invoke('export-stems-native', stateJson),
  exportAls: (stateJson: string, defaultName?: string): Promise<string | null> =>
    ipcRenderer.invoke('export-als', stateJson, defaultName),
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
  renameSketch: (
    oldName: string,
    newName: string
  ): Promise<{ ok: true; name: string } | { ok: false; reason: string }> =>
    ipcRenderer.invoke('rename-sketch', oldName, newName),
  renameExternalSketchFile: (
    oldPath: string,
    newName: string
  ): Promise<{ ok: true; path: string } | { ok: false; reason: string }> =>
    ipcRenderer.invoke('rename-external-sketch-file', oldPath, newName),
  deleteSketch: (name: string): Promise<{ ok: true } | { ok: false; reason: string }> =>
    ipcRenderer.invoke('delete-sketch', name),
  listLibrarySketches: (): Promise<{ name: string; mtimeMs: number; favourite: boolean }[]> =>
    ipcRenderer.invoke('list-library-sketches'),
  toggleSketchFavourite: (name: string): Promise<boolean> =>
    ipcRenderer.invoke('toggle-sketch-favourite', name),
  getLibraryRoot: (): Promise<string> => ipcRenderer.invoke('get-library-root'),
  setLibraryRoot: (newRoot: string): Promise<void> =>
    ipcRenderer.invoke('set-library-root', newRoot),
  shouldWarnBeforeAbletonOverwrite: (libraryName: string): Promise<boolean> =>
    ipcRenderer.invoke('should-warn-before-ableton-overwrite', libraryName),
  exportAlsToLibrary: (stateJson: string, libraryName: string): Promise<void> =>
    ipcRenderer.invoke('export-als-to-library', stateJson, libraryName),
  exportAlsNextToSource: (stateJson: string, sourcePath: string): Promise<void> =>
    ipcRenderer.invoke('export-als-next-to-source', stateJson, sourcePath),
  exportRpp: (stateJson: string, defaultName?: string): Promise<string | null> =>
    ipcRenderer.invoke('export-rpp', stateJson, defaultName),
  exportRppToLibrary: (stateJson: string, libraryName: string): Promise<void> =>
    ipcRenderer.invoke('export-rpp-to-library', stateJson, libraryName),
  exportRppNextToSource: (stateJson: string, sourcePath: string): Promise<void> =>
    ipcRenderer.invoke('export-rpp-next-to-source', stateJson, sourcePath),
  exportStemsToLibrary: (stateJson: string, libraryName: string): Promise<void> =>
    ipcRenderer.invoke('export-stems-to-library', stateJson, libraryName),
  exportStemsNextToSource: (stateJson: string, sourcePath: string): Promise<void> =>
    ipcRenderer.invoke('export-stems-next-to-source', stateJson, sourcePath),
  // Per-track variant of the exportStemsNative/exportStemsToLibrary/
  // exportStemsNextToSource trio above -- one WAV per packed track within a
  // bus rather than one mixed-down WAV per bus (see nativeExport.ts's
  // renderStemTracksToDir doc comment). projectName is required (unlike
  // exportAls/exportRpp's optional defaultName) since it's embedded directly
  // in every rendered filename, not just used as a save-dialog suggestion.
  exportStemTracksNative: (stateJson: string, projectName: string): Promise<string | null> =>
    ipcRenderer.invoke('export-stem-tracks-native', stateJson, projectName),
  exportStemTracksToLibrary: (stateJson: string, libraryName: string): Promise<void> =>
    ipcRenderer.invoke('export-stem-tracks-to-library', stateJson, libraryName),
  exportStemTracksNextToSource: (stateJson: string, sourcePath: string): Promise<void> =>
    ipcRenderer.invoke('export-stem-tracks-next-to-source', stateJson, sourcePath),
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
  engineListOutputDevices: (): Promise<string[]> =>
    ipcRenderer.invoke('engine-list-output-devices'),
  engineSetOutputDevice: (
    deviceName: string
  ): Promise<{ ok: true } | { ok: false; error: string }> =>
    ipcRenderer.invoke('engine-set-output-device', deviceName),
  engineGetBufferSize: (): Promise<number | null> => ipcRenderer.invoke('engine-get-buffer-size'),
  engineSetBufferSize: (bufferSize: number): Promise<{ ok: true } | { ok: false; error: string }> =>
    ipcRenderer.invoke('engine-set-buffer-size', bufferSize),
  engineArmRecording: (
    channelId: string,
    deviceName: string,
    startBar: number,
    endBar: number
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('engine-arm-recording', channelId, deviceName, startBar, endBar),
  engineDisarmRecording: (): Promise<{
    committed: boolean
    path?: string
    error?: string
    latencyCompensationBars?: number
  }> => ipcRenderer.invoke('engine-disarm-recording'),
  engineSetMetronome: (enabled: boolean): Promise<void> =>
    ipcRenderer.invoke('engine-set-metronome', enabled),
  engineSetGatedRecordingEnabled: (
    enabled: boolean,
    startBar: number,
    endBar: number,
    deviceName: string
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('engine-set-gated-recording-enabled', enabled, startBar, endBar, deviceName),
  engineCaptureGatedTake: (): Promise<{
    committed: boolean
    path?: string
    error?: string
    latencyCompensationBars?: number
  }> => ipcRenderer.invoke('engine-capture-gated-take'),
  engineSetLinkEnabled: (enabled: boolean): Promise<void> =>
    ipcRenderer.invoke('engine-set-link-enabled', enabled),
  engineGetLinkStatus: (): Promise<{ enabled: boolean; numPeers: number }> =>
    ipcRenderer.invoke('engine-get-link-status'),
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
  listRiffFavourites: (): Promise<string[]> => ipcRenderer.invoke('list-riff-favourites'),
  toggleRiffFavourite: (riffCID: string): Promise<string[]> =>
    ipcRenderer.invoke('toggle-riff-favourite', riffCID),
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
  onGatedRecordingUpdate: (callback: (peaks: number[]) => void): (() => void) => {
    const listener = (_event: unknown, payload: { peaks: number[] }): void =>
      callback(payload.peaks)
    ipcRenderer.on('engine-gated-recording-update', listener)
    return () => ipcRenderer.removeListener('engine-gated-recording-update', listener)
  },
  onEngineRestarted: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('engine-restarted', listener)
    return () => ipcRenderer.removeListener('engine-restarted', listener)
  },
  // Channel name follows the same 'engine-' prefix convention as every other
  // engine-originated push bridged here -- main/index.ts's
  // subscribeToLinkTempoChanged forwards IpcServer's own "link-tempo-changed"
  // push (from LinkSession::checkForExternalTempoChange, see its doc comment)
  // onto this renderer-facing channel. StoreContext.tsx's inbound listener
  // (kept next to its outbound state.bpm sync effect) adopts this into
  // state.bpm via SET_TEMPO.
  onLinkTempoChanged: (callback: (bpm: number) => void): (() => void) => {
    const listener = (_event: unknown, payload: { bpm: number }): void => callback(payload.bpm)
    ipcRenderer.on('engine-link-tempo-changed', listener)
    return () => ipcRenderer.removeListener('engine-link-tempo-changed', listener)
  },
  loreWarehouseAvailable: (): Promise<boolean> => ipcRenderer.invoke('lore-warehouse-available'),
  loreWarehouseRoot: (): Promise<string> => ipcRenderer.invoke('lore-warehouse-root'),
  loreSetWarehouseRoot: (newRoot: string): Promise<void> =>
    ipcRenderer.invoke('lore-set-warehouse-root', newRoot),
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
    ipcRenderer.invoke('lore-download-missing-stems', riffCID),
  endlesssLogin: (
    username: string,
    password: string
  ): Promise<{ ok: true } | { ok: false; error: string }> =>
    ipcRenderer
      .invoke('endlesss-login', username, password)
      .then((r) => (r.ok ? { ok: true } : { ok: false, error: r.error })),
  endlesssLogout: (): Promise<void> => ipcRenderer.invoke('endlesss-logout'),
  endlesssAuthStatus: (): Promise<
    { loggedIn: false } | { loggedIn: true; userId: string; username: string; expiresAt: number }
  > => ipcRenderer.invoke('endlesss-auth-status'),
  endlesssListJams: (): Promise<LoreJam[]> => ipcRenderer.invoke('endlesss-list-jams'),
  endlesssJamRiffCount: (jamId: string): Promise<number | null> =>
    ipcRenderer.invoke('endlesss-jam-riff-count', jamId),
  loreSyncStartSharedFeed: (userName: string): Promise<void> =>
    ipcRenderer.invoke('lore-sync-start-shared-feed', userName),
  loreSyncStartJam: (jamId: string, jamName: string): Promise<void> =>
    ipcRenderer.invoke('lore-sync-start-jam', jamId, jamName),
  loreSyncStatus: (jamCID: string): Promise<{ riffCount: number; complete: boolean } | null> =>
    ipcRenderer.invoke('lore-sync-status', jamCID),
  // `key` must match syncsInFlight's own internal key convention in
  // loreWarehouseSync.ts -- `shared:<username>` for a shared-feed sync
  // (same form as Jams/Riffs' OwnerJamCID storage), or the bare jamId for
  // a private jam. NOT the same as onLoreSyncProgress's own event `key`
  // field, which uses bare username for shared feed -- a separate,
  // decoupled convention chosen for the renderer's own per-jam display
  // state (syncingKeys/syncProgressByKey), see LibraryBrowser.tsx's
  // syncKeyFor. Resolves to false, not a rejection, if nothing was running
  // for that key.
  loreSyncAbort: (key: string): Promise<boolean> => ipcRenderer.invoke('lore-sync-abort', key),
  // jamCID here uses the SAME convention as loreSyncAbort's own `key`
  // param just above (shared:<username> for shared feed, not the bare
  // form) -- matches Jams/Riffs.OwnerJamCID storage directly. Rejects if a
  // sync is currently running for it; the renderer's right-click menu
  // should offer abort first in that case.
  loreRemoveJamSync: (
    jamCID: string,
    deleteFiles: boolean
  ): Promise<{ riffsRemoved: number; filesDeleted: number }> =>
    ipcRenderer.invoke('lore-remove-jam-sync', jamCID, deleteFiles),
  onLoreSyncProgress: (
    callback: (progress: {
      source: 'shared' | 'jam'
      key: string
      done: number
      total: number
      bytesDone: number
    }) => void
  ): (() => void) => {
    const listener = (
      _event: unknown,
      progress: {
        source: 'shared' | 'jam'
        key: string
        done: number
        total: number
        bytesDone: number
      }
    ): void => callback(progress)
    ipcRenderer.on('lore-sync-progress', listener)
    return () => ipcRenderer.removeListener('lore-sync-progress', listener)
  }
}

contextBridge.exposeInMainWorld('rifffApi', api)

export type RifffApi = typeof api
