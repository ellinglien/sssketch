// src/renderer/src/state/appSoundDefaults.ts -- the app-wide default sound settings, as the
// renderer sees them (native radio sound plan, Task 2): fetched from main once
// (soundSettingsStore.ts, over `sound-settings:get`) and memoised. A new project starts from
// these, deserializeProject opens a project saved before the radio sound with them, the startup
// state adopts them (ADOPT_APP_SOUND_DEFAULTS), and SET_SOUND_SETTINGS on a state with none
// merges onto them.
import { normalizeSoundSettings, type SoundSettings } from '@shared/radioSound'

/** sound-settings:get through the preload bridge. Typed structurally rather than through
 * window.rifffApi's declaration: store.ts imports this module, and the main-process tsconfig
 * (which reaches store.ts through its AppState imports) has no renderer globals. */
function fetchFromMain(): Promise<unknown> {
  const bridge = (globalThis as { rifffApi?: { getSoundSettings(): Promise<unknown> } }).rifffApi
  if (!bridge) throw new Error('no window.rifffApi')
  return bridge.getSoundSettings()
}

let pending: Promise<SoundSettings> | null = null
/** What the fetch gave, once it has resolved; null before (and after a forget). */
let resolved: SoundSettings | null = null

/** The app-wide defaults, a fresh copy each call. The first call fetches them; a failed fetch
 * (a rejection, or a synchronous throw such as no window.rifffApi) gives everything on
 * (DEFAULT_SOUND_SETTINGS), never a rejection, so opening a project can't fail on it. */
export async function appSoundDefaults(
  fetch: () => Promise<unknown> = fetchFromMain
): Promise<SoundSettings> {
  if (pending === null) {
    const mine = Promise.resolve()
      .then(fetch)
      .then(
        (value) => normalizeSoundSettings(value),
        (err: unknown) => {
          console.error('appSoundDefaults: could not read the app-wide sound settings:', err)
          return normalizeSoundSettings(undefined)
        }
      )
      .then((settings) => {
        // a forget while this was in flight must not resurrect it
        if (pending === mine) resolved = settings
        return settings
      })
    pending = mine
  }
  return normalizeSoundSettings(await pending)
}

/** The app-wide defaults if a fetch has resolved, else everything on: for the places that
 * cannot wait (the reducer). A fresh copy. */
export function appSoundDefaultsNow(): SoundSettings {
  return normalizeSoundSettings(resolved ?? undefined)
}

/** Forget the memoised defaults, so the next call fetches again (after they are changed, and in
 * tests). */
export function forgetAppSoundDefaults(): void {
  pending = null
  resolved = null
}

/** The app-wide defaults have just been saved as `settings` (the sound panel's defaults mode,
 * Task 13): memoise them as if a fetch had returned them, so appSoundDefaultsNow() and the next
 * appSoundDefaults() see them at once, with no refetch gap. A fetch still in flight loses (its
 * `pending === mine` check fails). Keeps a copy. */
export function rememberAppSoundDefaults(settings: SoundSettings): void {
  const copy = normalizeSoundSettings(settings)
  pending = Promise.resolve(copy)
  resolved = copy
}
