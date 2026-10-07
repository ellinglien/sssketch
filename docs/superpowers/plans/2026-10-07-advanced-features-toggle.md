# Advanced features toggle

**Decision (Elling, 2026-10-07, for the public release):** "this thing has too many features! most
people won't need them." Five features go behind ONE switch in the gear menu, `advanced features`,
off for new installs. An install that already uses any of them starts with it on.

## Shape

- `src/shared/features.ts`: the list (`FEATURES`, each `advanced: true`), the settings shape
  (`AppFeatureSettings { advancedFeatures: boolean }`), the pure `featureEnabled(id, settings)`, the
  migration rule `advancedFeaturesDefault(signals)` and the hearts rule
  `heartsButtonShown(settings, keySet)`. Used by main and the renderer.
- `src/main/appFeaturesStore.ts`: `appFeatures.json` in userData. With no file yet, it detects
  earlier use (below), writes the decision once and returns it. `saveAppFeatures` writes.
- IPC: `get-app-features`, `set-advanced-features` (returns the settings; main also pushes
  `app-features-changed`). Preload: `getAppFeatures`, `setAdvancedFeatures`, `onAppFeaturesChanged`.
- `src/renderer/src/state/appFeatures.ts`: a module store (useSyncExternalStore) with
  `useFeatureEnabled(id)`, `useAppFeatures()`. False until main answers, so nothing advanced flashes
  up and no plugin loads before the answer.

## Migration (cheap, once, only when `appFeatures.json` is missing)

Any of these turns it on; each is one small file read in userData:
- `pluginCatalog.json` lists at least one plugin (a scan has run and found something);
- `phoneRemoteSettings.json` exists (an address was picked in the phone remote modal);
- `radio-hearts-key.enc` exists (a hearts key was saved);
- `autosave.sssketchproj` has a plugin in a master or channel slot, or a stem whose file is an
  engine take (`sssketch-recording-*` / `sssketch-gated-take-*`).

Not walked: `~/Music/sssketch Library` (23k folders on Elling's machine) or the sketch library. A
recording is only found if the autosave holds one; the catalog is the strong signal for plugins.

## Touch points, per feature

### 1. Phone remote
- `TransportBar.tsx`: the gear menu's `phone remote…` entry; `PhoneRemoteModal` only while on.
- `src/main/index.ts` `start-phone-remote`: refuses (returns the stopped status) while off.
- `set-advanced-features` off: stops a running remote and pushes `phone-remote-status`.
- Untouched: DiscoverPanel's push effects (`set-remote-state` etc.) only feed a server that is not
  running.

### 2. In-app recording
- `TransportBar.tsx`: the gated-record button, the `add channel` (mic plus) button, the `audio in`
  row of `AudioDeviceModal`.
- `ChannelRow.tsx`: the arm (R) button. The remove-channel button stays, so a project's old
  recording channel can still be removed.
- `App.tsx`: the `/` (add channel) key; the effect that always adds a recording channel.
- `useGatedRecordingControls.ts`: `enableGatedRecording` (the `\` key and the button) and
  `targetRifffForRecording` (double-click a name bar) do nothing while off.
- `keyGestures.ts` / `KeyGesturesModal.tsx`: `/`, `\` and "double-click the name bar" carry
  `feature: 'recording'` and are left out while off.
- **Microphone:** today the engine opens 1 input channel at launch
  (`Transport::openDefaultDevice`, `initialiseWithDefaultDevices(1, 2)`), which is what asks for the
  mic. New engine flag `--no-audio-input` opens output only. `spawnEngine` gets `audioInput`
  (default false: the short-lived engines in `bakeOffset.ts` and `exportAudioMaterialization.ts`
  never record), and `startPlaybackEngine` reads the setting at each spawn (respawns included).
  Turned on mid-session, the input opens at the first arm (`setRecordingInputDevice` already names
  the device and channels). Turned off mid-session, the open input is released at the next launch
  (the tooltip says so).
- **Info.plist:** `NSMicrophoneUsageDescription` stays in both bundles (the app's
  `electron-builder.yml` and the engine's `MICROPHONE_PERMISSION_*`). macOS shows it only when access
  is requested, and advanced users need it, or a signed build records silence (see
  engine_subprocess_needs_own_mic_plist_entry). `NSCameraUsageDescription` is removed: nothing uses
  the camera.

### 3. Plugins and plugin scanning
- Scanning is already user-triggered only (`scan for plugins` in `MasterChainPanel` /
  `ChannelChainPanel` -> `scan-plugins`); there is no startup or background scan today. Main's
  `scan-plugins` refuses while off (returns the stored catalog), so nothing can start one.
- UI: `TransportBar.tsx` master chain button and panel; `ChannelRow.tsx` channel fx button (already
  hidden by `CHANNEL_FX_BUTTON_ENABLED = false`; now also needs the feature). The plugin browser and
  both scan buttons live only inside those panels.
- Hearing them: `StoreContext.tsx`'s master/channel diffing effects send no
  `engineLoad*Plugin` while off; the stale-slug migration effect does not run while off. Turning on
  (or main answering "on" at startup, once the catalog has loaded) loads every occupied slot with
  its pending saved state. Turning off captures the live states into the pending map first, then
  unloads the engine's slots; a failed load or unload while off never clears a slot from state.
- Exports: `nativeExport.ts` resolves plugin paths through a catalog that is empty while off, so an
  offline render matches what is heard (no plugin code loaded).
- **Keeping the data:** `state.masterChain` / `channelPlugins` are never touched while off. Saving
  (`App.tsx` `handleSave`) merges the pending saved states (`mergePendingPluginStates`,
  `pluginStates.ts`) for any slot the engine has not loaded, so a save while off writes the same
  blobs it read.
- **Notice:** `PluginsOffNotice.tsx`, a pill like `StemsUnavailableIndicator`:
  `this project uses plugins · turn on advanced features to hear them`. Shown when a project with
  plugins is opened (`restoreState`) while off; hides after a while or on click.
  `projectUsesPlugins(masterChain, channelPlugins)` in `features.ts`.

### 4. Sound defaults
- It is the gear menu's `sound defaults…` (`TransportBar.tsx`), which opens
  `SoundSettingsPanel mode="defaults"`: the app-wide saturation / pump / echo / level etc. a new
  project starts from (`soundSettingsStore.ts`, `appSoundDefaults.ts`). Only that menu item hides.
- Untouched: the transport's `sound` button (this project's sound panel, including its
  "make this project's the default" bridge) and the radio strip's `sound` column, which edits the
  project's sound, not the defaults. The stored defaults keep applying.

### 5. Radio hearts key
- `TransportBar.tsx`: the gear menu's `radio hearts key…` hides while off.
- `DiscoverPanel.tsx`: both `fetch hearts` buttons (the radio top line via `RadioMixBundle.hearts`,
  now optional, and the plain Discover action row) show only when `heartsButtonShown`: a key is
  set AND advanced is on. The key status comes from `radioHeartsKeyStatus`, refreshed when the key
  modal saves.
- Strip coverage: `radioStripModel` keeps `fetch-hearts` in its `mix` group (the model lists what
  the strip CAN draw, and its tests pin that); `RadioMixActions` draws it only when the bundle
  carries it. A comment at the model entry says so.

## The toggle

Gear menu, `advanced features: on|off` (the menu's `discover trait match: …` pattern). Tooltip:
`phone remote, recording, plugins, sound defaults, hearts key · turning off frees the mic at the
next launch`.

## Tests
- `features.test.ts`: `featureEnabled`, `advancedFeaturesDefault`, `heartsButtonShown`,
  `projectUsesPlugins`, `visibleKeyGestures`.
- `appFeaturesStore.test.ts`: default off on a fresh dir; each signal turns it on; decided once
  (written, not re-detected); save round trip; a corrupt file reads as off.
- `engineProcess.test.ts`: `engineServeArgs` adds `--no-audio-input` unless input is asked for.
- Main gates: `scanPluginsUnlessOff` and `phoneRemoteStartAllowed` (in `appFeaturesStore.ts`).
- `pluginStates.test.ts`: `mergePendingPluginStates`.
- Native: `--no-audio-input` parsing is trivial; engine `--test` suite rerun after the change.
