// src/shared/loginSyncConsent.ts -- whether logging into Endlesss starts the library sync.
//
// Share readiness S4 (2026-10-07). A login used to start syncing the account's shared feed and
// its own private jam at once, stem audio included, into ~/Music/sssketch/library: for an active
// Endlesss user that can be gigabytes, with no word. Now the login panel asks once and the answer
// is kept (loginSyncConsentStore.ts). An install that has synced before -- Elling's -- has
// already said yes, so nothing changes for it.

/** `ask`: the login panel asks. `no`: nothing syncs by itself; the panel offers it, and any jam
 * still syncs from its own sync button. */
export type LoginSyncConsent = 'yes' | 'no' | 'ask'

/** `saved` is loginSync.json as read (anything); `hasEarlierSync` whether the own riff library
 * already holds a synced riff (the discovered room aside). */
export function resolveLoginSyncConsent(saved: unknown, hasEarlierSync: boolean): LoginSyncConsent {
  const consent = (saved as { consent?: unknown } | null)?.consent
  if (consent === 'yes' || consent === 'no') return consent
  return hasEarlierSync ? 'yes' : 'ask'
}

/** The panel's question. `ownJamRiffs` is the account's own jam's riff count, when known; the
 * shared feed has no count to ask for (its listing carries none). */
export function loginSyncPromptText(ownJamRiffs: number | null): string {
  if (ownJamRiffs === null) return 'sync your jams now? (your shared feed and your own jam)'
  return `sync your jams now? (about ${ownJamRiffs} riff${ownJamRiffs === 1 ? '' : 's'} + your shared feed)`
}
