import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

export interface PhoneRemoteSettings {
  /** Which of this machine's addresses to serve the phone remote on, when
   * he has picked one. Null means "whatever the default ranking says",
   * which is the ordinary case.
   *
   * A PER-MACHINE PREFERENCE, NOT PROJECT DATA -- it describes his network,
   * not his music, so it lives here in userData beside discoverSettings.json
   * rather than in a .sssketchproj. The remote itself is still off by
   * default and per-session: this remembers WHICH ADDRESS to use if it is
   * switched on, never that it was on.
   *
   * Kept even when the address is not currently present (Tailscale quit, he
   * left that network). resolveRemoteAddress falls back to the default for
   * as long as it is missing and comes straight back to this the moment it
   * returns -- a preference that erased itself the first time a VPN was off
   * would have to be set again every session. */
  preferredAddress: string | null
}

const STORE_FILENAME = 'phoneRemoteSettings.json'

function storePath(): string {
  return join(app.getPath('userData'), STORE_FILENAME)
}

const DEFAULT_SETTINGS: PhoneRemoteSettings = { preferredAddress: null }

/** Mirrors discoverSettingsStore.ts's loadDiscoverSettings -- a default
 * result (never a thrown error), both when nothing has been saved yet and
 * when reading fails. A settings file must never be able to stop the
 * feature it configures from starting. */
export function loadPhoneRemoteSettings(): PhoneRemoteSettings {
  const path = storePath()
  if (!existsSync(path)) return { ...DEFAULT_SETTINGS }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<PhoneRemoteSettings>
    return {
      preferredAddress:
        typeof parsed.preferredAddress === 'string' && parsed.preferredAddress !== ''
          ? parsed.preferredAddress
          : null
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`loadPhoneRemoteSettings: failed to read ${path}: ${message}`)
    return { ...DEFAULT_SETTINGS }
  }
}

export function savePhoneRemoteSettings(settings: PhoneRemoteSettings): void {
  try {
    writeFileSync(storePath(), JSON.stringify(settings, null, 2), 'utf-8')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`savePhoneRemoteSettings: failed to write ${storePath()}: ${message}`)
  }
}

/** The remote server started: makes sure this file exists, keeping a chosen address. Its
 * existence is what the advanced features migration reads as "the phone remote was used"
 * (appFeaturesStore.ts) -- before this, only picking an address wrote it, and nothing else of the
 * remote outlives a session (pairing is per session, its temp files are swept on stop). */
export function recordPhoneRemoteStarted(): void {
  if (existsSync(storePath())) return
  savePhoneRemoteSettings({ ...DEFAULT_SETTINGS })
}
