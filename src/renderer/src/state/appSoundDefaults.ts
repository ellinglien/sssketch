// src/renderer/src/state/appSoundDefaults.ts -- the app-wide default sound settings, as the
// renderer sees them (native radio sound plan, Task 2): fetched from main once
// (soundSettingsStore.ts, over `sound-settings:get`) and memoised. A new project starts from
// these, and deserializeProject opens a project saved before the radio sound with them.
import { normalizeSoundSettings, type SoundSettings } from '@shared/radioSound'

let pending: Promise<SoundSettings> | null = null

/** The app-wide defaults, a fresh copy each call. The first call fetches them; a failed fetch
 * gives everything on (DEFAULT_SOUND_SETTINGS), never a rejection, so opening a project can't
 * fail on it. */
export async function appSoundDefaults(
  fetch: () => Promise<unknown> = () => window.rifffApi.getSoundSettings()
): Promise<SoundSettings> {
  pending ??= fetch().then(
    (value) => normalizeSoundSettings(value),
    (err: unknown) => {
      console.error('appSoundDefaults: could not read the app-wide sound settings:', err)
      return normalizeSoundSettings(undefined)
    }
  )
  return normalizeSoundSettings(await pending)
}

/** Forget the memoised defaults, so the next call fetches again (after they are changed, and in
 * tests). */
export function forgetAppSoundDefaults(): void {
  pending = null
}
