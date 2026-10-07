import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { Rifff, Stem, BusId, ProjectRef } from '@shared/types'
import type { ArrangeRole, DrumSubRole } from '@shared/stemRole'
import type { DiscoverSlotKind, DiscoverTraitKind } from '@shared/discoverSlotKind'
import type { StretchedStem } from '@shared/buildEngineProject'
import type { ToolkitExportMode } from '@shared/toolkit'
import type { LiveParamField } from '@shared/liveParam'
import type { OwnUsernameReport } from '@shared/ownUsernameReport'
import type { AppFeatureSettings } from '@shared/features'
import type { LoginSyncConsent } from '@shared/loginSyncConsent'
import type { RiffArchivePick } from '@shared/riffArchiveRoot'
import type {
  RiffLibraryJam,
  RiffLibraryRiffSummary,
  RiffLibraryResolvedRiff,
  DiscoverSoundSourceFilter,
  SyncOutcome
} from '@shared/riffLibraryTypes'
import type { LinkLoopFolderResult, LoopEntry, LoopFolderListing } from '@shared/loopFolderTypes'
import type { PluginCatalog } from '../main/pluginCatalog'
import type { DiscoverCandidate } from '../main/discoverCandidates'
import type { ArtistIndex, ArtistMode, KeepRefused } from '@shared/discoverArtist'
import type { ArtistScanBatch } from '../main/discoverArtistScanQueue'
import type { AdjacentDiscoverCandidate, AdjacentDiscoverOptions } from '../main/discoverAdjacency'
import type { DiscoverSettings } from '../main/discoverSettingsStore'
import type { SoundMeters, SoundSettings } from '@shared/radioSound'
import type { StemAutoClassifyProgress } from '../main/stemAutoCategoryStore'
import type { AutoClassifyStatus } from '../main/stemAutoClassifyScheduler'
import type { LibraryScanWork } from '../main/libraryScanWork'
import type { TidyUpLibraryStem } from '../main/tidyUpLibraryStems'
import type { DiscoverLoopSeedResult } from '../main/importOneShot'
import type { PrewarmScanProgress } from '../main/discoverCandidates'
import type { CategoryCentroidStore, CategoryAxis } from '@shared/categoryCentroids'
import type { RawPluginStatesCapture } from '@shared/pluginStates'
import type { UpdateState } from '@shared/updateState'
import type { RadioHeartsKeyStatus, RadioHeartsResult } from '@shared/radioHearts'
import type { StemFeatures } from '@shared/stemFeatures'
import type { StemPeaks } from '../main/stemPeaksCacheStore'
import type { StemGlyphCacheEntry, StemGlyphCacheWrite } from '@shared/glyphBands'
import type { StemAnalysisNeeds } from '@shared/stemAnalysisNeeds'
import type { StemAvailabilityNotice } from '@shared/stemAvailability'
import type { StemAnalysisWrite } from '@shared/stemAnalysisWrite'
import type { ConfirmedEmbedding } from '@shared/embeddingMatch'
import type { RemoteCommand, RemoteKeepOutcome, RemoteState } from '@shared/remoteState'
import type { LanAddressCandidate } from '@shared/lanAddress'

/** What the gear menu needs to show the phone remote's whole state: whether
 * it is on, the URL to type, the pairing code, how many tries are left, and
 * whether there is a LAN address to reach it at in the first place. Declared
 * once here rather than inlined on each of the four bridges below. */
interface PhoneRemoteStatus {
  running: boolean
  url: string | null
  pairingCode: string | null
  attemptsUsed: number
  lockedOut: boolean
  /** The address the remote is on, or would be on if switched on now. */
  lanAddress: string | null
  /** Every address it could be served on, best first -- the modal's picker
   * when there is more than one. */
  candidates: LanAddressCandidate[]
}

const api = {
  importRifff: (paths: string[]): Promise<Rifff | null> =>
    ipcRenderer.invoke('import-rifff', paths),
  importDemoRifff: (): Promise<Rifff | null> => ipcRenderer.invoke('import-demo-rifff'),
  importOneShot: (path: string): Promise<Rifff | null> =>
    ipcRenderer.invoke('import-one-shot', path),
  // barCount is user-supplied (Shelf's own import prompt) -- see
  // importLoop's own doc comment (src/main/importOneShot.ts) for why bar
  // count rather than bpm is what's asked for.
  importLoop: (path: string, barCount: number): Promise<Rifff | null> =>
    ipcRenderer.invoke('import-loop', path, barCount),
  // See importDiscoverLoopSeed's own doc comment (src/main/importOneShot.ts)
  // -- always a loop, projectBpm is the fallback tempo target when the
  // dropped file's own filename carries no usable BPM hint.
  importDiscoverLoopSeed: (
    path: string,
    projectBpm: number
  ): Promise<DiscoverLoopSeedResult | null> =>
    ipcRenderer.invoke('import-discover-loop-seed', path, projectBpm),
  // Click-to-pick equivalent of Discover's own drag-and-drop loop import --
  // see pick-discover-loop-seed-paths' own doc comment (main/index.ts).
  pickDiscoverLoopSeedPaths: (): Promise<string[]> =>
    ipcRenderer.invoke('pick-discover-loop-seed-paths'),
  // Used only to pre-fill the loop-import prompt's own bar-count guess
  // (loopBarGuess.ts's guessLoopBars) -- null when the file can't be read
  // as a WAV at all (the prompt just falls back to its default candidate).
  getWavDurationSeconds: (path: string): Promise<number | null> =>
    ipcRenderer.invoke('get-wav-duration-seconds', path),
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
  // Linked loop folders -- see the loop-folders-* handlers in main/index.ts.
  // Pick with pickFolder above, then link the path.
  loopFoldersList: (): Promise<LoopFolderListing[]> => ipcRenderer.invoke('loop-folders-list'),
  loopFoldersLink: (rootPath: string, projectBpm: number): Promise<LinkLoopFolderResult> =>
    ipcRenderer.invoke('loop-folders-link', rootPath, projectBpm),
  loopFoldersUnlink: (rootPath: string): Promise<void> =>
    ipcRenderer.invoke('loop-folders-unlink', rootPath),
  loopFoldersRescan: (projectBpm: number): Promise<LoopFolderListing[]> =>
    ipcRenderer.invoke('loop-folders-rescan', projectBpm),
  loopFoldersSetTempo: (loopId: string, bpm: number | null): Promise<LoopEntry | null> =>
    ipcRenderer.invoke('loop-folders-set-tempo', loopId, bpm),
  loopFoldersReportDuration: (
    loopId: string,
    durationSec: number,
    projectBpm: number
  ): Promise<LoopEntry | null> =>
    ipcRenderer.invoke('loop-folders-report-duration', loopId, durationSec, projectBpm),
  loopFoldersImport: (loopIds: string[], projectBpm: number): Promise<Rifff[]> =>
    ipcRenderer.invoke('loop-folders-import', loopIds, projectBpm),
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
  // One-way: main just stores the boolean, no reply expected. Fired from
  // App.tsx's Frame whenever hasUnsavedChanges's own value transitions, not
  // on every keystroke -- see index.ts's rendererHasUnsavedChanges.
  setDirtyState: (dirty: boolean): Promise<void> => ipcRenderer.invoke('set-dirty-state', dirty),
  // Main pushes this when the quit dialog's "Save" choice is picked (see
  // index.ts's requestSaveBeforeQuit) -- the renderer's own listener (Frame)
  // runs handleSave() and calls notifySaveBeforeQuitComplete() once it
  // resolves, which main is waiting on via a matching ipcMain.once().
  onRequestSaveBeforeQuit: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('request-save-before-quit', listener)
    return () => ipcRenderer.removeListener('request-save-before-quit', listener)
  },
  notifySaveBeforeQuitComplete: (): void => {
    ipcRenderer.send('save-before-quit-complete')
  },
  exportMix: (bytes: Uint8Array, defaultName?: string): Promise<string | null> =>
    ipcRenderer.invoke('export-mix', bytes, defaultName),
  exportMixNative: (stateJson: string): Promise<Uint8Array> =>
    ipcRenderer.invoke('export-mix-native', stateJson),
  // Renders every stem straight to disk in the main process and returns
  // the chosen destination folder (or null if the folder picker was
  // cancelled) -- stem audio never crosses IPC at all, unlike the old
  // exportStemsNative()+exportStems() pair (see nativeExport.ts's
  // renderStemsToDir doc comment for why that crashed on large projects).
  exportStemsNative: (stateJson: string): Promise<string | null> =>
    ipcRenderer.invoke('export-stems-native', stateJson),
  // `toolkitMode` is the export dialog's bake/automation choice (see
  // ExportFormatPicker.tsx and the toolkit spec's section 4). Optional and
  // last on every one of these six, so a call that predates the choice still
  // means what it always meant: bake.
  exportAls: (
    stateJson: string,
    defaultName?: string,
    toolkitMode?: ToolkitExportMode
  ): Promise<string | null> =>
    ipcRenderer.invoke('export-als', stateJson, defaultName, toolkitMode),
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
  listSketchBackups: (name: string): Promise<{ path: string; mtimeMs: number }[]> =>
    ipcRenderer.invoke('list-sketch-backups', name),
  restoreSketchBackup: (
    name: string,
    backupPath: string
  ): Promise<{ ok: true } | { ok: false; reason: string }> =>
    ipcRenderer.invoke('restore-sketch-backup', name, backupPath),
  readSketchBackup: (name: string, backupPath: string): Promise<string | null> =>
    ipcRenderer.invoke('read-sketch-backup', name, backupPath),
  exportAlsToLibrary: (
    stateJson: string,
    libraryName: string,
    toolkitMode?: ToolkitExportMode
  ): Promise<void> =>
    ipcRenderer.invoke('export-als-to-library', stateJson, libraryName, toolkitMode),
  exportAlsNextToSource: (
    stateJson: string,
    sourcePath: string,
    toolkitMode?: ToolkitExportMode
  ): Promise<void> =>
    ipcRenderer.invoke('export-als-next-to-source', stateJson, sourcePath, toolkitMode),
  exportRpp: (
    stateJson: string,
    defaultName?: string,
    toolkitMode?: ToolkitExportMode
  ): Promise<string | null> =>
    ipcRenderer.invoke('export-rpp', stateJson, defaultName, toolkitMode),
  exportRppToLibrary: (
    stateJson: string,
    libraryName: string,
    toolkitMode?: ToolkitExportMode
  ): Promise<void> =>
    ipcRenderer.invoke('export-rpp-to-library', stateJson, libraryName, toolkitMode),
  exportRppNextToSource: (
    stateJson: string,
    sourcePath: string,
    toolkitMode?: ToolkitExportMode
  ): Promise<void> =>
    ipcRenderer.invoke('export-rpp-next-to-source', stateJson, sourcePath, toolkitMode),
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
  /** Radio's scheduled swap -- hand the engine a project now, have it
   * become real exactly at the next loop top, or at `atBars` of the
   * current lap when one is given (radio's mid-lap bare cuts, the one
   * population a loop-top-only swap could not reach). `project` is typed
   * `unknown` for the same reason engineLoadProject's is: it crosses this
   * boundary as plain JSON and preload has no business re-stating
   * EngineProject's shape.
   *
   * `token` pairs the two acks below to this request. It exists because
   * EngineClient matches replies by message TYPE, not by request id, so
   * two swaps in flight would otherwise cross their answers. */
  engineStageProject: (token: number, project: unknown, atBars?: number): Promise<void> =>
    ipcRenderer.invoke('engine-stage-project', token, project, atBars),
  /** Withdraw a staged swap. `-1` cancels whatever is staged. Answered by
   * onEngineProjectStageResult with status `cancelled` -- or, if the audio
   * thread took it first, `applied`, which is why a caller must keep
   * waiting for onEngineProjectApplied rather than assume a cancel won. */
  engineCancelStagedProject: (token: number): Promise<void> =>
    ipcRenderer.invoke('engine-cancel-staged-project', token),
  /** Radio fold mode: the cycles each folded row plays from the next loop top (or the next block,
   * `now`); a row not named plays full length. `row` is the Discover slot id each stem carries
   * as its cycleRow, `id` the cycle's id (the same id keeps its phase), lengths in bars. */
  engineStageCycles: (
    rows: { row: string; id: string; bars: number; phaseBars: number }[],
    now: boolean
  ): Promise<void> => ipcRenderer.invoke('engine-stage-cycles', rows, now),
  /** Every staged token gets exactly one of these. `staged` means parked
   * for the loop top; `applied` means the engine did it immediately
   * (reason `not-playing`, `no-loop`, `tempo-change`, or a cancel that
   * lost the race); `cancelled` means it will never play; `error` means
   * the project would not parse and nothing was staged. */
  onEngineProjectStageResult: (
    callback: (result: {
      token: number
      status: 'staged' | 'applied' | 'cancelled' | 'error'
      reason?: string
    }) => void
  ): (() => void) => {
    const listener = (
      _event: unknown,
      payload: {
        token: number
        status: 'staged' | 'applied' | 'cancelled' | 'error'
        reason?: string
      }
    ): void => callback(payload)
    ipcRenderer.on('engine-project-stage-result', listener)
    return () => ipcRenderer.removeListener('engine-project-stage-result', listener)
  },
  /** The staged project is now the live one. `via` is `wrap` for the
   * normal case (and then `atBars` is exactly the loop start), or
   * `deadline`/`transport-stopped`/`immediate` for the fallbacks.
   * `deferrals` should always be 0. */
  onEngineProjectApplied: (
    callback: (applied: {
      token: number
      via: 'wrap' | 'deadline' | 'transport-stopped' | 'immediate'
      atBars: number
      deferrals: number
    }) => void
  ): (() => void) => {
    const listener = (
      _event: unknown,
      payload: {
        token: number
        via: 'wrap' | 'deadline' | 'transport-stopped' | 'immediate'
        atBars: number
        deferrals: number
      }
    ): void => callback(payload)
    ipcRenderer.on('engine-project-applied', listener)
    return () => ipcRenderer.removeListener('engine-project-applied', listener)
  },
  enginePlay: (fromPos: number): Promise<void> => ipcRenderer.invoke('engine-play', fromPos),
  engineStop: (): Promise<void> => ipcRenderer.invoke('engine-stop'),
  engineSetPosition: (pos: number): Promise<void> => ipcRenderer.invoke('engine-set-position', pos),
  engineSetLiveParam: (field: LiveParamField, key: string, value: number): Promise<void> =>
    ipcRenderer.invoke('engine-set-live-param', field, key, value),
  engineSetLoopRegion: (startBar: number, endBar: number): Promise<void> =>
    ipcRenderer.invoke('engine-set-loop-region', startBar, endBar),
  engineListInputDevices: (): Promise<string[]> => ipcRenderer.invoke('engine-list-input-devices'),
  engineListOutputDevices: (): Promise<string[]> =>
    ipcRenderer.invoke('engine-list-output-devices'),
  engineSetOutputDevice: (
    deviceName: string
  ): Promise<{ ok: true } | { ok: false; error: string }> =>
    ipcRenderer.invoke('engine-set-output-device', deviceName),
  getCategoryCentroids: (): Promise<CategoryCentroidStore> =>
    ipcRenderer.invoke('get-category-centroids'),
  getConfirmedEmbeddings: (axis: CategoryAxis): Promise<ConfirmedEmbedding[]> =>
    ipcRenderer.invoke('get-confirmed-embeddings', axis),
  getDiscoverCandidates: (
    kinds: DiscoverSlotKind[],
    onlyOwnStems: boolean,
    targetUser?: string,
    soundSource?: DiscoverSoundSourceFilter,
    artist?: string,
    /** Radio fold mode's clash: trait percentiles to attach on top of the slot's own. */
    alsoTraits?: DiscoverTraitKind[],
    /** The faves dial's favourites-only draw: only these stems, before the sample. */
    onlyStemCIDs?: string[],
    /** The radio's intensity arc: attach each candidate's intensity score. */
    alsoIntensity?: boolean
  ): Promise<DiscoverCandidate[]> =>
    ipcRenderer.invoke(
      'get-discover-candidates',
      kinds,
      onlyOwnStems,
      targetUser,
      soundSource,
      artist,
      alsoTraits,
      onlyStemCIDs,
      alsoIntensity
    ),
  getRandomDiscoverCandidate: (
    kinds: DiscoverSlotKind[],
    onlyOwnStems: boolean,
    targetUser?: string,
    soundSource?: DiscoverSoundSourceFilter
  ): Promise<DiscoverCandidate | null> =>
    ipcRenderer.invoke(
      'get-random-discover-candidate',
      kinds,
      onlyOwnStems,
      targetUser,
      soundSource
    ),
  getAdjacentDiscoverCandidates: (
    centerRiffCID: string,
    kinds: DiscoverSlotKind[],
    soundSource?: DiscoverSoundSourceFilter,
    creator?: string | readonly string[],
    /** Optional (discoverAdjacency's AdjacentDiscoverOptions): radio's dig asks for 8 per
     * direction, no downloads, and trait percentiles. Absent: today's behaviour. */
    options?: AdjacentDiscoverOptions
  ): Promise<{ newer: AdjacentDiscoverCandidate[]; older: AdjacentDiscoverCandidate[] }> =>
    ipcRenderer.invoke(
      'get-adjacent-discover-candidates',
      centerRiffCID,
      kinds,
      soundSource,
      creator,
      options
    ),
  discoverArtistIndex: (ownUsername: string): Promise<ArtistIndex> =>
    ipcRenderer.invoke('discover-artist-index', ownUsername),
  discoverArtistAnalysed: (artist: string): Promise<{ analysed: number; total: number }> =>
    ipcRenderer.invoke('discover-artist-analysed', artist),
  /** Combine artists: warm newly chosen artists' stem lists in main. */
  discoverPrewarmArtists: (names: string[]): Promise<void> =>
    ipcRenderer.invoke('discover-prewarm-artists', names),
  /** What a phone keep (by its tap id) came to -- served back to the phone
   * in /api/state's `keeps`. */
  reportRemoteKeep: (keepId: string, outcome: RemoteKeepOutcome): Promise<void> =>
    ipcRenderer.invoke('remote-keep-result', keepId, outcome),
  discoverQueueArtistAnalysis: (
    artist: string
  ): Promise<{ queued: number; total: number; size: number }> =>
    ipcRenderer.invoke('discover-queue-artist-analysis', artist),
  takeArtistScanBatch: (limit: number): Promise<ArtistScanBatch> =>
    ipcRenderer.invoke('take-artist-scan-batch', limit),
  finishArtistScanBatch: (stemCIDs: string[]): Promise<void> =>
    ipcRenderer.invoke('finish-artist-scan-batch', stemCIDs),
  discoverSetArtist: (
    artist: string | null,
    ownUsername: string,
    lingering?: string[],
    /** Combine artists: the whole selection (null = me). */
    artists?: readonly (string | null)[]
  ): Promise<ArtistMode> =>
    ipcRenderer.invoke('discover-set-artist', artist, ownUsername, lingering, artists),
  findRiffForStemPath: (
    stemPath: string
  ): Promise<{
    stemCID: string
    riffCID: string
    jamCID: string
    bpm: number
    creationTime: number | null
  } | null> => ipcRenderer.invoke('find-riff-for-stem-path', stemPath),
  resolveStemArrangeRoles: (
    entries: { stemCID: string; instrumentMask: number; presetName: string }[]
  ): Promise<Record<string, ArrangeRole | null>> =>
    ipcRenderer.invoke('resolve-stem-arrange-roles', entries),
  getLibraryWarmupStatus: (): Promise<boolean> => ipcRenderer.invoke('get-library-warmup-status'),
  // Faster startup (2026-10-06): every library index can answer reads (saved
  // copies loaded, or the own-only index on a rebuild) -- StartupGate closes
  // here; the walks after it are the warmup above.
  getLibraryIndexUsable: (): Promise<boolean> => ipcRenderer.invoke('get-library-index-usable'),
  onLibraryIndexUsable: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('library-index-usable', listener)
    return () => ipcRenderer.removeListener('library-index-usable', listener)
  },
  reportOwnUsername: (report: OwnUsernameReport): Promise<void> =>
    ipcRenderer.invoke('report-own-username', report),
  onLibraryWarmupComplete: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('library-warmup-complete', listener)
    return () => ipcRenderer.removeListener('library-warmup-complete', listener)
  },
  onLibraryWarmupProgress: (callback: (progress: PrewarmScanProgress) => void): (() => void) => {
    const listener = (_event: unknown, progress: PrewarmScanProgress): void => callback(progress)
    ipcRenderer.on('library-warmup-progress', listener)
    return () => ipcRenderer.removeListener('library-warmup-progress', listener)
  },
  // Background-work indicator: whether the auto-classify scheduler has a
  // backlog, and how many riff library syncs are running. Query on mount,
  // then a push on every change.
  getAutoClassifyStatus: (): Promise<AutoClassifyStatus> =>
    ipcRenderer.invoke('get-auto-classify-status'),
  onAutoClassifyStatus: (callback: (status: AutoClassifyStatus) => void): (() => void) => {
    const listener = (_event: unknown, status: AutoClassifyStatus): void => callback(status)
    ipcRenderer.on('auto-classify-status', listener)
    return () => ipcRenderer.removeListener('auto-classify-status', listener)
  },
  getRiffLibrarySyncActive: (): Promise<number> =>
    ipcRenderer.invoke('get-riff-library-sync-active'),
  onRiffLibrarySyncActive: (callback: (count: number) => void): (() => void) => {
    const listener = (_event: unknown, count: number): void => callback(count)
    ipcRenderer.on('riff-library-sync-active', listener)
    return () => ipcRenderer.removeListener('riff-library-sync-active', listener)
  },
  getStemAvailabilityReport: (): Promise<StemAvailabilityNotice> =>
    ipcRenderer.invoke('get-stem-availability-report'),
  onStemAvailabilityNotice: (callback: (notice: StemAvailabilityNotice) => void): (() => void) => {
    const listener = (_event: unknown, notice: StemAvailabilityNotice): void => callback(notice)
    ipcRenderer.on('stem-availability-notice', listener)
    return () => ipcRenderer.removeListener('stem-availability-notice', listener)
  },
  getEngineStartupStatus: (): Promise<boolean> => ipcRenderer.invoke('get-engine-startup-status'),
  onEngineStartupComplete: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('engine-startup-complete', listener)
    return () => ipcRenderer.removeListener('engine-startup-complete', listener)
  },
  getDiscoverSettings: (): Promise<DiscoverSettings> => ipcRenderer.invoke('get-discover-settings'),
  setDiscoverSettings: (settings: DiscoverSettings): Promise<void> =>
    ipcRenderer.invoke('set-discover-settings', settings),
  /** The app-wide default sound settings (soundSettingsStore.ts). */
  getSoundSettings: (): Promise<SoundSettings> => ipcRenderer.invoke('sound-settings:get'),
  setSoundSettings: (settings: SoundSettings): Promise<void> =>
    ipcRenderer.invoke('sound-settings:set', settings),
  getDiscoverClassifyProgress: (): Promise<StemAutoClassifyProgress> =>
    ipcRenderer.invoke('get-discover-classify-progress'),
  /** The library tier's work list, own stems first for `username` (then
   * favourites; null: no own stems). Also sets main's priority username. */
  getDiscoverLibraryScanWork: (username: string | null): Promise<LibraryScanWork> =>
    ipcRenderer.invoke('get-discover-library-scan-work', username),
  /** Each key's priority rank for `username` (0 own, 1 favourite, 2 the
   * rest; stemPriority.ts). Also sets main's priority username. */
  getStemPriorityRanks: (keys: string[], username: string | null): Promise<number[]> =>
    ipcRenderer.invoke('get-stem-priority-ranks', keys, username),
  upsertStemCategoryBus: (
    entries: { path: string; busId: BusId }[],
    source: string,
    project: ProjectRef
  ): Promise<void> => ipcRenderer.invoke('upsert-stem-category-bus', entries, source, project),
  upsertStemCategoryRole: (
    entries: {
      path: string
      arrangeRole: ArrangeRole
      drumSubRole?: DrumSubRole
    }[],
    source: string,
    project: ProjectRef
  ): Promise<void> => ipcRenderer.invoke('upsert-stem-category-role', entries, source, project),
  /** Tidy Up's LIBRARY population: unconfirmed first, then most-recently-
   * imported, capped at `limit` (one evening's worth, not the whole
   * backlog). Only stems already feature-scanned AND already on disk. */
  getTidyUpLibraryStems: (limit: number): Promise<TidyUpLibraryStem[]> =>
    ipcRenderer.invoke('get-tidy-up-library-stems', limit),
  /** The read side of the same table. A path nobody has confirmed is simply
   * ABSENT from the result -- never an empty string and never a guess, so a
   * caller's fallback chain has something unambiguous to fall through on. */
  getStemCategoryRoles: (
    paths: string[]
  ): Promise<Record<string, { arrangeRole: ArrangeRole; drumSubRole: DrumSubRole | null }>> =>
    ipcRenderer.invoke('get-stem-category-roles', paths),
  getStemAnalysisNeeds: (paths: string[]): Promise<StemAnalysisNeeds[]> =>
    ipcRenderer.invoke('get-stem-analysis-needs', paths),
  getStemFeatureCache: (path: string): Promise<StemFeatures | null> =>
    ipcRenderer.invoke('get-stem-feature-cache', path),
  setStemFeatureCache: (path: string, features: StemFeatures): Promise<void> =>
    ipcRenderer.invoke('set-stem-feature-cache', path, features),
  getStemPeaksCache: (path: string): Promise<StemPeaks | null> =>
    ipcRenderer.invoke('get-stem-peaks-cache', path),
  setStemPeaksCache: (path: string, peaks: StemPeaks): Promise<void> =>
    ipcRenderer.invoke('set-stem-peaks-cache', path, peaks),
  /** Glyph rings and pitch line persisted per stem (stemGlyphCacheStore.ts):
   * null on a miss, a changed file, or a path that can't be stamped. */
  getStemGlyphCache: (path: string): Promise<StemGlyphCacheEntry | null> =>
    ipcRenderer.invoke('get-stem-glyph-cache', path),
  setStemGlyphCache: (path: string, write: StemGlyphCacheWrite): Promise<void> =>
    ipcRenderer.invoke('set-stem-glyph-cache', path, write),
  getStemEmbeddingCache: (path: string): Promise<number[] | null> =>
    ipcRenderer.invoke('get-stem-embedding-cache', path),
  setStemEmbeddingCache: (path: string, embedding: number[]): Promise<void> =>
    ipcRenderer.invoke('set-stem-embedding-cache', path, embedding),
  setYamnetZeroShotCategory: (path: string, audiosetClassIndex: number): Promise<void> =>
    ipcRenderer.invoke('set-yamnet-zeroshot-category', path, audiosetClassIndex),
  markYamnetZeroShotAttempted: (path: string): Promise<void> =>
    ipcRenderer.invoke('mark-yamnet-zeroshot-attempted', path),
  setStemAnalysisResults: (results: StemAnalysisWrite[]): Promise<void> =>
    ipcRenderer.invoke('set-stem-analysis-results', results),
  getYamnetModel: (): Promise<Uint8Array | null> => ipcRenderer.invoke('get-yamnet-model'),
  engineGetBufferSize: (): Promise<number | null> => ipcRenderer.invoke('engine-get-buffer-size'),
  /** The radio sound's master meters, dB (the sound panel's dev-only readouts); null without an
   * engine. */
  engineGetSoundMeters: (): Promise<SoundMeters | null> =>
    ipcRenderer.invoke('engine-get-sound-meters'),
  engineGetPluginStates: (): Promise<RawPluginStatesCapture | null> =>
    ipcRenderer.invoke('engine-get-plugin-states'),
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
  enginePreloadStem: (path: string, durationSec: number): Promise<void> =>
    ipcRenderer.invoke('engine-preload-stem', path, durationSec),
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
    path: string | null,
    stateBase64: string | null
  ): Promise<void> =>
    ipcRenderer.invoke('engine-load-master-plugin', slot, pluginId, path, stateBase64),
  engineOpenMasterPluginEditor: (slot: number): Promise<void> =>
    ipcRenderer.invoke('engine-open-master-plugin-editor', slot),
  engineCloseMasterPluginEditor: (slot: number): Promise<void> =>
    ipcRenderer.invoke('engine-close-master-plugin-editor', slot),
  engineLoadChannelPlugin: (
    channelId: string,
    slot: number,
    pluginId: string | null,
    path: string | null,
    stateBase64: string | null
  ): Promise<void> =>
    ipcRenderer.invoke('engine-load-channel-plugin', channelId, slot, pluginId, path, stateBase64),
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
  listStemFavourites: (): Promise<string[]> => ipcRenderer.invoke('list-stem-favourites'),
  toggleStemFavourite: (stemCID: string): Promise<string[]> =>
    ipcRenderer.invoke('toggle-stem-favourite', stemCID),
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
    callback: (channelId: string, peakL: number, peakR: number) => void
  ): (() => void) => {
    const listener = (
      _event: unknown,
      payload: { channelId: string; peakL: number; peakR: number }
    ): void => callback(payload.channelId, payload.peakL, payload.peakR)
    ipcRenderer.on('engine-capture-level-update', listener)
    return () => ipcRenderer.removeListener('engine-capture-level-update', listener)
  },
  // main/index.ts's update-state-changed push (see @shared/updateState's
  // own doc comment for the full UpdateState shape) -- one consolidated
  // payload per change, not one event per field.
  onUpdateStateChanged: (callback: (state: UpdateState) => void): (() => void) => {
    const listener = (_event: unknown, state: UpdateState): void => callback(state)
    ipcRenderer.on('update-state-changed', listener)
    return () => ipcRenderer.removeListener('update-state-changed', listener)
  },
  confirmUpdateInstall: (): Promise<void> => ipcRenderer.invoke('update-confirm-install'),
  dismissUpdate: (): Promise<void> => ipcRenderer.invoke('update-dismiss'),
  onGatedRecordingUpdate: (callback: (peakL: number, peakR: number) => void): (() => void) => {
    const listener = (_event: unknown, payload: { peakL: number; peakR: number }): void =>
      callback(payload.peakL, payload.peakR)
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
  riffLibraryAvailable: (): Promise<boolean> => ipcRenderer.invoke('riff-library-available'),
  /** Whether the riff library (archive and own) holds any riff at all. */
  riffLibraryHasRiffs: (): Promise<boolean> => ipcRenderer.invoke('riff-library-has-riffs'),
  riffLibraryRoot: (): Promise<string> => ipcRenderer.invoke('riff-library-root'),
  // True iff the currently active riff library root is sssketch's own
  // self-built one (rather than a user-pointed real external LORE archive)
  // -- see riff-library-is-own's own handler in index.ts. Threaded into
  // friendlyRiffName's suffix by LibraryBrowser.tsx so an imported riff's
  // generated name reflects where it actually came from, instead of always
  // saying "lore" -- see docs/superpowers/specs/
  // 2026-08-14-riff-library-rename-design.md §4.
  riffLibraryIsOwn: (): Promise<boolean> => ipcRenderer.invoke('riff-library-is-own'),
  setRiffLibraryRoot: (newRoot: string): Promise<void> =>
    ipcRenderer.invoke('riff-library-set-root', newRoot),
  /** A picked folder, snapped to the LORE archive root one level off it, or why not
   * (@shared/riffArchiveRoot). Only an `ok` pick changes the root. */
  setRiffLibraryRootFromPick: (picked: string): Promise<RiffArchivePick> =>
    ipcRenderer.invoke('riff-library-set-root-from-pick', picked),
  /** Back to sssketch's own library from a linked archive. */
  useOwnRiffLibrary: (): Promise<void> => ipcRenderer.invoke('riff-library-use-own'),
  riffLibraryListJams: (filterText: string, targetUser?: string): Promise<RiffLibraryJam[]> =>
    ipcRenderer.invoke('riff-library-list-jams', filterText, targetUser),
  riffLibraryListRiffs: (
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
  ): Promise<{ riffs: RiffLibraryRiffSummary[]; hasMore: boolean; nextOffset: number }> =>
    ipcRenderer.invoke('riff-library-list-riffs', jamCID, filters),
  riffLibraryResolveRiff: (riffCID: string): Promise<RiffLibraryResolvedRiff | null> =>
    ipcRenderer.invoke('riff-library-resolve-riff', riffCID),
  riffLibraryResolveRiffWithContext: (
    riffCID: string
  ): Promise<{ jamCID: string; offset: number; matchedRiffCID: string } | null> =>
    ipcRenderer.invoke('riff-library-resolve-riff-with-context', riffCID),
  riffLibraryDownloadMissingStems: (riffCID: string): Promise<RiffLibraryResolvedRiff | null> =>
    ipcRenderer.invoke('riff-library-download-missing-stems', riffCID),
  saveDiscoveredRifff: (
    members: {
      path: string
      gain: number
      name: string
      author: string
      barLength: number
      durationSec: number
    }[],
    bpm: number,
    barLength: number,
    /** Artists whose stems still play on Discover's rows -- main refuses
     * the keep while any do (lingeringArtists). */
    lingering?: string[]
  ): Promise<{ riffCID: string; name: string; duplicate: boolean } | KeepRefused | null> =>
    ipcRenderer.invoke('save-discovered-rifff', members, bpm, barLength, lingering),
  forgetDiscoveredRifff: (riffCID: string): Promise<void> =>
    ipcRenderer.invoke('forget-discovered-rifff', riffCID),
  /** "fetch radio hearts": ell.ing/radio's hearted combos, kept as riffs
   * the way keep keeps one, and every hearted stem starred. Counts, or why
   * not. See src/main/radioHeartsImport.ts. */
  fetchRadioHearts: (): Promise<RadioHeartsResult> => ipcRenderer.invoke('fetch-radio-hearts'),
  /** Whether a hearts.json key is set, and whether only for this session
   * (no keychain encryption). The key itself never comes back. */
  radioHeartsKeyStatus: (): Promise<RadioHeartsKeyStatus> =>
    ipcRenderer.invoke('radio-hearts-key-status'),
  /** Sets the key (null or '' clears it); resolves to the new status. */
  setRadioHeartsKey: (key: string | null): Promise<RadioHeartsKeyStatus> =>
    ipcRenderer.invoke('set-radio-hearts-key', key),
  getPhoneRemoteStatus: (): Promise<PhoneRemoteStatus> =>
    ipcRenderer.invoke('get-phone-remote-status'),
  startPhoneRemote: (): Promise<PhoneRemoteStatus> => ipcRenderer.invoke('start-phone-remote'),
  stopPhoneRemote: (): Promise<PhoneRemoteStatus> => ipcRenderer.invoke('stop-phone-remote'),
  /** Serve on this address instead, and remember it for next time. Null
   * forgets the choice and goes back to the default ranking. */
  setPhoneRemoteAddress: (address: string | null): Promise<PhoneRemoteStatus> =>
    ipcRenderer.invoke('set-phone-remote-address', address),
  setRemoteState: (state: RemoteState): Promise<void> =>
    ipcRenderer.invoke('set-remote-state', state),
  /** The EngineProject Discover is previewing, so the phone can be served a
   * render of it, or null to clear it. Typed as `unknown` here for the same
   * reason engineLoadProject just above is: the project crosses the IPC
   * boundary as plain JSON and preload has no business re-stating
   * EngineProject's shape.
   *
   * `slotIds` is one Discover slot id per EngineStem, in the same order, and
   * it rides in THIS call rather than arriving in a second one on purpose:
   * main pairs a phone row to its stem's audio id from one snapshot, so
   * there is no second push to fall out of step with. A length disagreement
   * makes main drop the whole map rather than guess at an alignment -- a row
   * naming one stem while the phone plays another is the worst bug this
   * feature can have. */
  setRemoteLoop: (project: unknown, slotIds: string[]): Promise<void> =>
    ipcRenderer.invoke('set-remote-loop', project, slotIds),
  onRemoteCommand: (callback: (command: RemoteCommand) => void): (() => void) => {
    const listener = (_event: unknown, command: RemoteCommand): void => callback(command)
    ipcRenderer.on('remote-command', listener)
    return () => ipcRenderer.removeListener('remote-command', listener)
  },
  // The gear menu's "advanced features" switch (src/main/appFeaturesStore.ts,
  // @shared/features).
  getAppFeatures: (): Promise<AppFeatureSettings> => ipcRenderer.invoke('get-app-features'),
  setAdvancedFeatures: (on: boolean): Promise<AppFeatureSettings> =>
    ipcRenderer.invoke('set-advanced-features', on),
  onAppFeaturesChanged: (callback: (settings: AppFeatureSettings) => void): (() => void) => {
    const listener = (_event: unknown, settings: AppFeatureSettings): void => callback(settings)
    ipcRenderer.on('app-features-changed', listener)
    return () => ipcRenderer.removeListener('app-features-changed', listener)
  },
  onPhoneRemoteStatus: (callback: (status: PhoneRemoteStatus) => void): (() => void) => {
    const listener = (_event: unknown, status: PhoneRemoteStatus): void => callback(status)
    ipcRenderer.on('phone-remote-status', listener)
    return () => ipcRenderer.removeListener('phone-remote-status', listener)
  },
  endlesssLogin: (
    username: string,
    password: string
  ): Promise<{ ok: true } | { ok: false; error: string }> =>
    ipcRenderer
      .invoke('endlesss-login', username, password)
      .then((r) => (r.ok ? { ok: true } : { ok: false, error: r.error })),
  endlesssLogout: (): Promise<void> => ipcRenderer.invoke('endlesss-logout'),
  /** `username`: the account's Endlesss username, '' when unknown (an
   * email login not yet checked); `loginName`: what was typed at login. */
  endlesssAuthStatus: (): Promise<
    | { loggedIn: false }
    | { loggedIn: true; userId: string; username: string; loginName?: string; expiresAt: number }
  > => ipcRenderer.invoke('endlesss-auth-status'),
  /** The session's username changed after an auth-status answer (its check
   * against Endlesss finished): ask endlesssAuthStatus again. */
  onEndlesssUsernameChanged: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('endlesss-username-changed', listener)
    return () => ipcRenderer.removeListener('endlesss-username-changed', listener)
  },
  /** The session ended without a logout (it expired, or Endlesss refused
   * it): ask endlesssAuthStatus again. */
  onEndlesssSessionEnded: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('endlesss-session-ended', listener)
    return () => ipcRenderer.removeListener('endlesss-session-ended', listener)
  },
  endlesssListJams: (): Promise<RiffLibraryJam[]> => ipcRenderer.invoke('endlesss-list-jams'),
  endlesssJamRiffCount: (jamId: string): Promise<number | null> =>
    ipcRenderer.invoke('endlesss-jam-riff-count', jamId),
  // Whether a login starts the library sync: `ask` until answered (@shared/loginSyncConsent).
  loginSyncConsent: (): Promise<LoginSyncConsent> => ipcRenderer.invoke('login-sync-consent'),
  setLoginSyncConsent: (consent: 'yes' | 'no'): Promise<void> =>
    ipcRenderer.invoke('set-login-sync-consent', consent),
  // Resolves when the sync ends, saying why when it stopped short for a
  // reason the user can act on (riffLibrarySync.ts's SyncOutcome).
  riffLibrarySyncStartSharedFeed: (userName: string): Promise<SyncOutcome> =>
    ipcRenderer.invoke('riff-library-sync-start-shared-feed', userName),
  riffLibrarySyncStartJam: (jamId: string, jamName: string): Promise<SyncOutcome> =>
    ipcRenderer.invoke('riff-library-sync-start-jam', jamId, jamName),
  riffLibrarySyncStatus: (
    jamCID: string
  ): Promise<{ riffCount: number; complete: boolean } | null> =>
    ipcRenderer.invoke('riff-library-sync-status', jamCID),
  // `key` must match syncsInFlight's own internal key convention in
  // riffLibrarySync.ts -- `shared:<username>` for a shared-feed sync (same
  // form as Jams/Riffs' OwnerJamCID storage), or the bare jamId for a
  // private jam. NOT the same as onRiffLibrarySyncProgress's own event
  // `key` field, which uses bare username for shared feed -- a separate,
  // decoupled convention chosen for the renderer's own per-jam display
  // state (syncingKeys/syncProgressByKey), see LibraryBrowser.tsx's
  // syncKeyFor. Resolves to false, not a rejection, if nothing was running
  // for that key.
  riffLibrarySyncAbort: (key: string): Promise<boolean> =>
    ipcRenderer.invoke('riff-library-sync-abort', key),
  // jamCID here uses the SAME convention as riffLibrarySyncAbort's own
  // `key` param just above (shared:<username> for shared feed, not the
  // bare form) -- matches Jams/Riffs.OwnerJamCID storage directly. Rejects
  // if a sync is currently running for it; the renderer's right-click menu
  // should offer abort first in that case.
  riffLibraryRemoveJamSync: (
    jamCID: string,
    deleteFiles: boolean
  ): Promise<{ riffsRemoved: number; filesDeleted: number }> =>
    ipcRenderer.invoke('riff-library-remove-jam-sync', jamCID, deleteFiles),
  onRiffLibrarySyncProgress: (
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
    ipcRenderer.on('riff-library-sync-progress', listener)
    return () => ipcRenderer.removeListener('riff-library-sync-progress', listener)
  }
}

contextBridge.exposeInMainWorld('rifffApi', api)

export type RifffApi = typeof api
