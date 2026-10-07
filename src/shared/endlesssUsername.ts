// src/shared/endlesssUsername.ts
//
// What counts as an Endlesss username. Endlesss accepts an email at login,
// and until 2026-10-07 the app took whatever was typed there as the username:
// logging in with an email made "me" the email address, which matches no
// riff or stem, so "only my jams" hid every jam and `mine` found nothing,
// and the login auto-synced a shared feed for the email (an empty second
// "Shared Feed" row in the jam list).
//
// Endlesss stores usernames lowercase: Elling's LORE archive, read-only
// 2026-10-07, has 6,802 distinct riff authors and 6,506 distinct stem
// creators, none with an uppercase letter or an '@'. So "me" is normalised
// here once, to lowercase, rather than every query comparing
// case-insensitively (which would also lose the Stems_IndexUser index).

/** The username `raw` names: trimmed and lowercased; '' (nobody) for
 * nothing, or for an email address. */
export function normalizeEndlesssUsername(raw: string | null | undefined): string {
  const name = (raw ?? '').trim().toLowerCase()
  return name.includes('@') ? '' : name
}

/** Which names to check, in order, for the logged-in account's canonical
 * username (endlesssApi.ts ensureCanonicalUsername): the login's user_id,
 * then the typed login name -- each only if it could be a username at all. */
export function canonicalUsernameCandidates(loginName: string, userId: string): string[] {
  const out: string[] = []
  for (const raw of [userId, loginName]) {
    const name = normalizeEndlesssUsername(raw)
    if (name !== '' && !out.includes(name)) out.push(name)
  }
  return out
}

/** Whether a `shared:<username>` jam key could name a real username -- not
 * one an email login once synced (an empty duplicate "Shared Feed"), and not
 * nobody. Case is not checked: a feed synced under a login typed with a
 * capital (`shared:Elling`) is a real feed, folded into its lowercase key by
 * the next sync (riffLibraryWriter.ts mergeSharedFeedCaseVariants). */
export function isValidSharedFeedKey(jamCID: string): boolean {
  if (!jamCID.startsWith('shared:')) return false
  const name = jamCID.slice('shared:'.length).trim()
  return name !== '' && !name.includes('@')
}
