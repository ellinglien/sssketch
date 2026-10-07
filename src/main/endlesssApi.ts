import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type {
  EndlesssFetchFailure,
  RiffLibraryJam,
  RiffLibraryResolvedRiff,
  RiffLibraryResolvedStem,
  RiffLibraryRiffSummary,
  RiffFilters,
  RiffPage
} from '@shared/riffLibraryTypes'
import { computeOwnerFraction, resolveKeyName, stemDownloadUrl } from '@shared/riffLibraryTypes'
import { isUsableStemFile } from './stemFile'
import { canonicalUsernameCandidates, normalizeEndlesssUsername } from '@shared/endlesssUsername'

const API_HOST = 'https://api.endlesss.fm'
export const DATA_HOST = 'https://data.endlesss.fm'

/** Injectable fetch seam, matching this codebase's existing
 * binaryPathOverride-style convention (see pluginScan.ts/engineProcess.ts) --
 * tests supply a fake implementation instead of hitting the real network. */
export type FetchLike = typeof fetch

export interface EndlesssSession {
  token: string
  /** The session-scoped credential returned alongside token -- NOT the
   * literal account password the person typed (see the design spec's
   * grounding section). Paired with token for both Basic auth against
   * data.endlesss.fm and Bearer auth against api.endlesss.fm. */
  password: string
  userId: string
  /** The username/email actually typed at login -- persisted alongside the
   * session because some endpoints (jam membership) key off the username,
   * not the opaque user_id, and the login response doesn't echo it back. */
  username: string
  /** The account's real Endlesss username (its user_appdata db), checked
   * against Endlesss by ensureCanonicalUsername -- `username` above is
   * whatever was typed, and Endlesss accepts an email there. Absent until
   * checked (and on every session saved before 2026-10-07). */
  canonicalUsername?: string
  /** Unix milliseconds. */
  expires: number
}

interface EndlesssLoginResponse {
  token: string
  password: string
  user_id: string
  expires: number
}

const SESSION_FILENAME = 'endlesss-session.enc'

function sessionFilePath(): string {
  return join(app.getPath('userData'), SESSION_FILENAME)
}

let currentSession: EndlesssSession | null = null
let sessionLoadAttempted = false

/** Encrypts and writes the session to disk. If safeStorage encryption isn't
 * available on this platform/environment, the session simply isn't
 * persisted -- requiring login every launch is a safer failure mode than
 * ever writing these credentials in plaintext. */
function persistSession(session: EndlesssSession): void {
  if (!safeStorage.isEncryptionAvailable()) return
  const encrypted = safeStorage.encryptString(JSON.stringify(session))
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(sessionFilePath(), encrypted)
}

function loadPersistedSession(): EndlesssSession | null {
  if (!safeStorage.isEncryptionAvailable()) return null
  const path = sessionFilePath()
  if (!existsSync(path)) return null
  try {
    const decrypted = safeStorage.decryptString(readFileSync(path))
    const parsed = JSON.parse(decrypted) as Partial<EndlesssSession>
    if (
      typeof parsed.token !== 'string' ||
      typeof parsed.password !== 'string' ||
      typeof parsed.userId !== 'string' ||
      typeof parsed.username !== 'string' ||
      typeof parsed.expires !== 'number'
    ) {
      return null
    }
    if (typeof parsed.canonicalUsername !== 'string' || parsed.canonicalUsername === '') {
      delete parsed.canonicalUsername
    }
    return parsed as EndlesssSession
  } catch (err) {
    console.error('endlesssApi: failed to load persisted session:', err)
    return null
  }
}

/** Lazily loads whatever session was persisted from a previous launch, at
 * most once per process lifetime -- every other call just reads the
 * in-memory currentSession, which loginWithCredentials/logout also keep in
 * sync. */
function ensureSessionLoaded(): void {
  if (sessionLoadAttempted) return
  sessionLoadAttempted = true
  currentSession = loadPersistedSession()
}

/** The live session, or null if there isn't one / it's expired. Every
 * network function in this module that needs auth calls this rather than
 * reading currentSession directly, so expiry is checked in exactly one
 * place. */
function activeSession(): EndlesssSession | null {
  ensureSessionLoaded()
  if (!currentSession || currentSession.expires <= Date.now()) return null
  return currentSession
}

/** The session's Endlesss username: the checked one, else the typed login
 * name when it could be a username (lowercased; an email is not one). ''
 * when unknown -- an email login that couldn't be checked yet. */
function sessionUsername(session: EndlesssSession): string {
  return session.canonicalUsername ?? normalizeEndlesssUsername(session.username)
}

/** `username` is the account's Endlesss username ('' when unknown: an
 * email login not yet checked); `loginName` is what was typed at login, for
 * display. */
export function getAuthStatus():
  | { loggedIn: false }
  | { loggedIn: true; userId: string; username: string; loginName: string; expiresAt: number } {
  const session = activeSession()
  if (!session) return { loggedIn: false }
  return {
    loggedIn: true,
    userId: session.userId,
    username: sessionUsername(session),
    loginName: session.username,
    expiresAt: session.expires
  }
}

/** A check that couldn't reach Endlesss (offline, or a 5xx/429) is tried
 * again after this long, not on every auth-status ask. */
const CANONICAL_RETRY_MS = 60_000
/** Per candidate. Short: an email login's auth status waits on the check. */
const CANONICAL_CHECK_TIMEOUT_MS = 5000
/** The membership view's answers that mean "not this account": no access, or
 * no such user_appdata db. Every other non-ok status is an outage. */
const CANDIDATE_REFUSED_STATUSES = new Set([401, 403, 404])
/** The current session's check: `allFailed` once Endlesss answered no to
 * every candidate -- an answer, not an outage, so it is kept for the session
 * and never asked again (a new login is a new session, checked afresh). */
let canonicalCheck: {
  session: EndlesssSession
  at: number
  done: Promise<void>
  allFailed: boolean
} | null = null

let usernameChangedListener: (() => void) | null = null

/** Called whenever a check changes the live session's username (index.ts
 * tells the renderer, which asks auth status again). Null: nobody. */
export function setUsernameChangedListener(listener: (() => void) | null): void {
  usernameChangedListener = listener
}

/** Works out the logged-in account's real username once (and saves it with
 * the session, so later launches need no network): the first candidate --
 * the login's user_id, then the typed login name, never an email -- whose
 * own user_appdata membership view the session can read. Fixes an email
 * login (Endlesss accepts one) being taken as the username, which matched
 * nothing (2026-10-07); works for a session saved before this, with no new
 * login. Never throws. A check Endlesss couldn't be reached for leaves the
 * session as it was and is retried after CANONICAL_RETRY_MS; one where every
 * candidate was refused is not retried this session. An answer that arrives
 * after a logout (or a new login) is dropped. */
export async function ensureCanonicalUsername(fetchImpl: FetchLike = fetch): Promise<void> {
  const session = activeSession()
  if (!session || session.canonicalUsername) return
  const now = Date.now()
  if (canonicalCheck && canonicalCheck.session === session) {
    if (canonicalCheck.allFailed) return
    if (now - canonicalCheck.at < CANONICAL_RETRY_MS) return canonicalCheck.done
  }
  const check: NonNullable<typeof canonicalCheck> = {
    session,
    at: now,
    done: Promise.resolve(),
    allFailed: false
  }
  check.done = (async (): Promise<void> => {
    for (const candidate of canonicalUsernameCandidates(session.username, session.userId)) {
      let res: Response
      try {
        res = await fetchWithTimeout(
          fetchImpl,
          `${DATA_HOST}/user_appdata$${escapeCouchIdSegment(candidate)}/_design/membership/_view/getMembership?limit=0`,
          { headers: { Authorization: basicAuthHeader(session), 'User-Agent': userAgent() } },
          CANONICAL_CHECK_TIMEOUT_MS
        )
      } catch (err) {
        console.error('endlesssApi: could not check the account username:', err)
        return
      }
      // Logged out (or in again) while this was out: not this session's to change.
      if (currentSession !== session) return
      if (!res.ok) {
        // Only these are Endlesss saying "not this account's db": the next
        // candidate is asked. A 5xx, a 429 or anything else is Endlesss being
        // unwell, not an answer: left for the retry after CANONICAL_RETRY_MS,
        // never counted toward allFailed (review of 8d003738).
        if (CANDIDATE_REFUSED_STATUSES.has(res.status)) continue
        console.error(`endlesssApi: the account username check got HTTP ${res.status}`)
        return
      }
      const before = sessionUsername(session)
      session.canonicalUsername = candidate
      persistSession(session)
      if (candidate !== before) usernameChangedListener?.()
      return
    }
    check.allFailed = true
  })()
  canonicalCheck = check
  return check.done
}

/** Auth status for the renderer. Answers at once when the session already
 * has a usable name (a typed username): the check runs behind it, and a
 * changed name is announced (setUsernameChangedListener). Only a session
 * with no usable name yet (an email login) waits for the check, which a
 * session asks Endlesss at most once a minute, and never again once refused. */
export async function authStatusWithUsername(
  fetchImpl: FetchLike = fetch
): Promise<ReturnType<typeof getAuthStatus>> {
  const session = activeSession()
  if (session && !session.canonicalUsername) {
    const check = ensureCanonicalUsername(fetchImpl)
    if (sessionUsername(session) === '') await check
  }
  return getAuthStatus()
}

export function logout(): void {
  currentSession = null
  sessionLoadAttempted = true
  const path = sessionFilePath()
  if (existsSync(path)) {
    try {
      unlinkSync(path)
    } catch (err) {
      console.error('endlesssApi: failed to remove persisted session on logout:', err)
    }
  }
}

function userAgent(): string {
  try {
    return `sssketch/${app.getVersion()}`
  } catch {
    return 'sssketch'
  }
}

// "Being a good citizen" per the design spec: OUROVEON's own rAPI config
// caps timeouts at 3-8s depending on connection quality. This module
// doesn't distinguish connection quality, so it uses the more conservative
// (unstable-connection) end of that range as a single fixed timeout, rather
// than letting a hung request wait forever. Deliberately no multi-attempt
// retry loop -- the UI's own error handling already surfaces a failure
// clearly, and the person can just retry the action by hand, which is a
// simpler and equally effective substitute for automatic retries in a
// feature that isn't hit at any real frequency.
const REQUEST_TIMEOUT_MS = 8000

// Stem audio is legitimately larger/slower than a JSON response, so this is
// far more generous than REQUEST_TIMEOUT_MS -- but it must still be finite.
// A real sync hung indefinitely on a packaged build with no error surfaced
// and no way to recover short of relaunching, root-caused to exactly one
// stem's fetch() call never settling (TCP connection opens, response never
// arrives) with nothing bounding it: downloadMissingStemsFor's Promise.all
// waited on it forever, which meant runWithConcurrency's own lane never
// advanced, which meant syncSharedFeed's top-level await never returned,
// which meant the renderer's "syncing…" state (driven by that promise
// resolving) never cleared. STEM_DOWNLOAD_RETRIES's own retry loop can't
// help either -- it only runs after a rejection/non-ok response, neither of
// which a hung request ever produces. 60s comfortably covers even a large
// stem over a slow connection while guaranteeing the retry loop actually
// gets a turn.
const STEM_DOWNLOAD_TIMEOUT_MS = 60000

/** Wraps `fetchImpl` with a hard timeout via AbortController -- every
 * network call in this module goes through this rather than calling
 * `fetchImpl` directly, so the "no hung request" guarantee applies
 * everywhere without each call site re-implementing it. `timeoutMs`
 * defaults to REQUEST_TIMEOUT_MS (right for small JSON responses);
 * downloadOneEndlesssStem passes STEM_DOWNLOAD_TIMEOUT_MS instead, since
 * audio payloads are legitimately larger/slower.
 *
 * `externalSignal`, when given, is combined with this function's own
 * timeout-abort via AbortSignal.any -- lets loreWarehouseSync.ts's abort
 * button actually cancel an in-flight request (not just stop new ones from
 * starting), rather than only ever timing out on its own. Omitted call
 * sites (one-off UI resolves with nothing to cancel against) keep working
 * exactly as before. */
async function fetchWithTimeout(
  fetchImpl: FetchLike,
  url: string,
  init?: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS,
  externalSignal?: AbortSignal
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const signal = externalSignal
    ? AbortSignal.any([externalSignal, controller.signal])
    : controller.signal
  try {
    return await fetchImpl(url, { ...init, signal })
  } finally {
    clearTimeout(timer)
  }
}

/** POSTs real login credentials to Endlesss's own login endpoint and returns
 * the resulting session, or a user-facing error string. The literal typed
 * password is used exactly once, right here -- never persisted, never sent
 * again (see saveSession/EndlesssSession's own doc comment). */
export async function loginWithCredentials(
  username: string,
  password: string,
  fetchImpl: FetchLike = fetch
): Promise<{ ok: true; session: EndlesssSession } | { ok: false; error: string }> {
  let res: Response
  try {
    res = await fetchWithTimeout(fetchImpl, `${API_HOST}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': userAgent() },
      body: JSON.stringify({ username, password })
    })
  } catch {
    return { ok: false, error: "couldn't reach Endlesss — check your connection" }
  }

  let body: unknown
  try {
    body = await res.json()
  } catch {
    body = null
  }

  if (!res.ok) {
    const message = (body as { message?: unknown } | null)?.message
    return {
      ok: false,
      error:
        typeof message === 'string' && message.trim() !== ''
          ? message
          : "couldn't log in — check your username and password"
    }
  }

  const parsed = body as Partial<EndlesssLoginResponse> | null
  if (
    !parsed ||
    typeof parsed.token !== 'string' ||
    typeof parsed.password !== 'string' ||
    typeof parsed.user_id !== 'string' ||
    typeof parsed.expires !== 'number'
  ) {
    return { ok: false, error: 'unexpected response from Endlesss — try again' }
  }

  const session: EndlesssSession = {
    token: parsed.token,
    password: parsed.password,
    userId: parsed.user_id,
    username,
    expires: parsed.expires
  }
  currentSession = session
  sessionLoadAttempted = true
  persistSession(session)
  return { ok: true, session }
}

/** Both Basic (data.endlesss.fm) and Bearer (api.endlesss.fm) auth are built
 * from the same token:password pair, base64-encoded -- per OUROVEON's own
 * comment ("Bearer ... formed out of token:password"), the Bearer variant
 * uses the identical encoding Basic auth would, just under a different
 * header scheme. */
function credentialsBase64(session: EndlesssSession): string {
  return Buffer.from(`${session.token}:${session.password}`).toString('base64')
}

function bearerAuthHeader(session: EndlesssSession): string {
  return `Bearer ${credentialsBase64(session)}`
}

function basicAuthHeader(session: EndlesssSession): string {
  return `Basic ${credentialsBase64(session)}`
}

// ---- raw wire shapes, field names traced from OUROVEON's own CEREAL_NVP
// declarations (see the design spec's Addendum) -- not guessed. ----

interface RawStemDoc {
  _id: string
  cdn_attachments: {
    oggAudio?: { bucket?: string; endpoint: string; key?: string; url: string; length: number }
    flacAudio?: { endpoint: string; key: string; length: number; url: string }
  }
  bps: number
  length16ths: number
  presetName: string
  creatorUserName: string
  isDrum?: boolean
  isNote?: boolean
  isBass?: boolean
  isMic?: boolean
}

interface RawRiffSlot {
  slot: { current?: { on: boolean; currentLoop?: string; gain: number } }
}

interface RawRiffDoc {
  _id: string
  state: { bps: number; barLength: number; playback: RawRiffSlot[] }
  userName: string
  created: number
  root: number
  scale: number
}

interface RawSharedRiffEntry {
  _id: string
  doc_id: string
  action_timestamp: number
  rifff: RawRiffDoc
  loops: (RawStemDoc | null)[]
  private?: boolean
}

interface RawSharedFeedResponse {
  data: RawSharedRiffEntry[]
}

// Matches OUROVEON's own BPStoRoundedBPM: ceil (not round) to 2 decimal
// places -- kept identical so tempo values displayed here match what the
// official ecosystem would show for the same riff.
function bpsToRoundedBpm(bps: number): number {
  return Math.ceil(bps * 60 * 100) / 100
}

function stemFlagsToMask(stem: RawStemDoc): number {
  let mask = 0
  if (stem.isDrum) mask |= 1 << 1
  if (stem.isNote) mask |= 1 << 2
  if (stem.isBass) mask |= 1 << 3
  if (stem.isMic) mask |= 1 << 4
  return mask
}

interface ChosenAudio {
  endpoint: string
  bucket: string
  key: string | undefined
  url: string
  length: number
}

// Prefers flacAudio over oggAudio whenever both are present, matching
// OUROVEON's own client (ResultStemDocument::CDNAttachments::
// getAudioFormat()). Previously hardcoded to ogg only, on the assumption
// the decode pipeline couldn't handle FLAC -- turned out to be wrong: the
// native engine's JUCE AudioFormatManager already registers FLAC via
// registerBasicFormats() with no restricting build flags, and was already
// decoding real FLAC-content LORE stems in production (the Ableton-export
// bake-stem path). The renderer's Web Audio decodeAudioData has no format
// gate either. Normalizes flacAudio's shape (no `bucket` field at all) and
// oggAudio's shape (optional `bucket`) into one common shape so the caller
// doesn't need to know which format won.
function chosenAudio(cdn: RawStemDoc['cdn_attachments']): ChosenAudio | null {
  if (cdn.flacAudio) {
    const f = cdn.flacAudio
    return { endpoint: f.endpoint, bucket: '', key: f.key, url: f.url, length: f.length }
  }
  if (cdn.oggAudio) {
    const o = cdn.oggAudio
    return {
      endpoint: o.endpoint,
      bucket: o.bucket ?? '',
      key: o.key,
      url: o.url,
      length: o.length
    }
  }
  return null
}

// downloadUrl is RECONSTRUCTED from endpoint/bucket/key via the same
// stemDownloadUrl() the LORE path already uses -- not read from the raw
// `url` field embedded in the doc. Traced directly from OUROVEON's own
// client (types::Stem::fullEndpoint() + a GET against `/{fileKey}`,
// live.stem.cpp): it never trusts an embedded url field at all, only ever
// builds the request URL from these three components. Falls back to the
// embedded url only if `key` is missing (shouldn't happen in practice, but
// cheaper than risking a null download for a defensively-optional field).
function buildResolvedStem(stem: RawStemDoc, slot: number, gain: number): RiffLibraryResolvedStem {
  const bpm = bpsToRoundedBpm(stem.bps)
  const barLength = stem.length16ths / 16
  const audio = chosenAudio(stem.cdn_attachments)
  const downloadUrl =
    audio == null
      ? null
      : audio.key
        ? stemDownloadUrl(audio.endpoint, audio.bucket, audio.key)
        : (audio.url ?? null)
  return {
    stemCID: stem._id,
    slot,
    path: null,
    gain,
    creatorUserName: stem.creatorUserName,
    presetName: stem.presetName,
    instrumentMask: stemFlagsToMask(stem),
    durationSec: barLength * (60 / bpm) * 4,
    barLength,
    bpm,
    downloadUrl,
    fileEndpoint: audio?.endpoint,
    fileBucket: audio?.bucket,
    fileKey: audio?.key,
    sizeBytes: audio?.length
  }
}

function buildResolvedRiff(
  riffCID: string,
  riffDoc: RawRiffDoc,
  stemDocs: (RawStemDoc | null)[]
): RiffLibraryResolvedRiff {
  const stems: RiffLibraryResolvedStem[] = []
  riffDoc.state.playback.forEach((slotWrapper, index) => {
    const current = slotWrapper.slot?.current
    if (!current || !current.on || !current.currentLoop) return
    const stemDoc = stemDocs.find((s) => s?._id === current.currentLoop)
    if (!stemDoc) return
    stems.push(buildResolvedStem(stemDoc, index + 1, current.gain))
  })
  return {
    riffCID,
    bpm: bpsToRoundedBpm(riffDoc.state.bps),
    barLength: riffDoc.state.barLength,
    key: resolveKeyName(riffDoc.root, riffDoc.scale),
    root: riffDoc.root,
    scale: riffDoc.scale,
    stems
  }
}

function summarizeResolvedRiff(
  riffCID: string,
  userName: string,
  creationTime: number,
  resolved: RiffLibraryResolvedRiff,
  ownerFraction: number
): RiffLibraryRiffSummary {
  return {
    riffCID,
    creationTime,
    bpm: resolved.bpm,
    barLength: resolved.barLength,
    userName,
    stemCount: resolved.stems.length,
    cachedStemCount: 0, // nothing downloaded yet -- listing never touches disk
    ownerFraction
  }
}

// One-hex-char shard, mirroring LORE's own warehouse convention
// (resolveStemPath in loreWarehouse.ts: cache/common/stem_v2/<JamCID>/
// <first-hex-char>/<StemCID>) rather than inventing a new scheme. Keyed by
// stemCID alone -- it's Endlesss's own content identifier, so the same
// audio always lands at the same path regardless of which riff or jam
// referenced it, unlike the old source-partitioned scheme this replaces
// (see docs/superpowers/specs/2026-08-08-endlesss-cache-disk-efficiency-design.md).
function endlesssStemCachePath(stemCID: string): string {
  return join(app.getPath('userData'), 'endlesss-cache', 'stems', stemCID.slice(0, 1), stemCID)
}

/** Deletes each of `stemCIDs`' downloaded audio from this content-addressed
 * cache -- called from loreWarehouseSync.ts's removeJamSync, ONLY with
 * stemCIDs that deleteJamRows (loreWarehouseWriter.ts) already confirmed
 * aren't referenced by any riff in ANY other synced jam, since this cache
 * is keyed by stemCID alone (not partitioned per jam -- see this
 * function's own path convention just above), so the same file can be the
 * only copy backing playback for other jams' riffs too. Missing files are
 * silently skipped (nothing to delete is not an error here); returns how
 * many were actually removed. */
export function deleteStemFiles(stemCIDs: string[]): number {
  let deleted = 0
  for (const stemCID of stemCIDs) {
    const path = endlesssStemCachePath(stemCID)
    if (existsSync(path)) {
      unlinkSync(path)
      deleted++
    }
  }
  return deleted
}

// Matches OUROVEON's own stem-audio retry loop (endlesss::live::Stem::fetch,
// live.stem.cpp) on a stable connection: 3 total attempts. Its own comment
// on why: "things can take a while to propogate to the CDN; wait longer
// each cycle and try repeatedly" -- this is CDN-propagation-delay
// tolerance, not generic flakiness tolerance, so the delay between
// attempts escalates rather than staying fixed.
const STEM_DOWNLOAD_RETRIES = 3

/** Jittered, escalating delay between stem download attempts, matching
 * OUROVEON's own formula exactly: a random 0-500ms plus 250ms per prior
 * attempt, capped at 1000ms. */
function stemRetryDelayMs(attempt: number): number {
  return Math.min(Math.random() * 500 + attempt * 250, 1000)
}

/** Downloads one stem's audio to its cache path, writing via a
 * `.downloading` sibling then renaming into place so a killed/failed
 * download never leaves a corrupt partial file -- same pattern as
 * loreWarehouse.ts's own downloadOneStem. Returns null (never throws) if
 * every attempt fails, or the real downloaded byte count on success (used
 * by downloadMissingStemsFor's own onStemDownloaded callback for live
 * data-amount progress -- see loreWarehouseSync.ts's SyncProgress.bytesDone).
 * Goes through fetchWithTimeout with STEM_DOWNLOAD_TIMEOUT_MS (not the
 * default REQUEST_TIMEOUT_MS) -- see that constant's own doc comment for why
 * an earlier version of this function used no timeout at all, and why that
 * turned out to be a real bug rather than a safe simplification.
 *
 * `signal`, when given and already aborted, skips straight to returning null
 * without starting (or retrying) a request -- lets an in-progress sync's
 * abort button actually stop between-retry, not just between-riff (combined
 * with fetchWithTimeout's own signal handling, it also cancels whichever
 * request is currently in flight).
 *
 * Headers and retry behavior traced directly from OUROVEON's own CDN fetch
 * (Stem::attemptRemoteFetch, live.stem.cpp) -- no Authorization header (the
 * stem CDN URLs are unauthenticated regardless of Endlesss login state),
 * just Host/User-Agent/Accept/Accept-Encoding. `fetch` sets Host itself
 * from the URL, so it's not set explicitly here. */
async function downloadOneEndlesssStem(
  path: string,
  downloadUrl: string,
  fetchImpl: FetchLike,
  signal?: AbortSignal
): Promise<number | null> {
  for (let attempt = 0; attempt < STEM_DOWNLOAD_RETRIES; attempt++) {
    if (signal?.aborted) return null
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, stemRetryDelayMs(attempt)))
    }
    try {
      const res = await fetchWithTimeout(
        fetchImpl,
        downloadUrl,
        {
          headers: {
            'User-Agent': userAgent(),
            Accept: 'audio/ogg',
            'Accept-Encoding': 'gzip, deflate, br'
          }
        },
        STEM_DOWNLOAD_TIMEOUT_MS,
        signal
      )
      if (!res.ok) {
        console.error(
          `endlesssApi: stem download failed: HTTP ${res.status} (attempt ${attempt + 1}/${STEM_DOWNLOAD_RETRIES})`
        )
        continue
      }
      const bytes = Buffer.from(await res.arrayBuffer())
      // An empty body is not audio: writing it would lay down exactly the
      // 0-byte placeholder isUsableStemFile exists to see through.
      if (bytes.length === 0) {
        console.error(
          `endlesssApi: stem download failed: empty response (attempt ${attempt + 1}/${STEM_DOWNLOAD_RETRIES})`
        )
        continue
      }
      mkdirSync(dirname(path), { recursive: true })
      const tmpPath = `${path}.downloading`
      writeFileSync(tmpPath, bytes)
      renameSync(tmpPath, path)
      return bytes.length
    } catch (err) {
      console.error(
        `endlesssApi: stem download failed (attempt ${attempt + 1}/${STEM_DOWNLOAD_RETRIES}):`,
        err
      )
    }
  }
  return null
}

/** Downloads every not-yet-cached stem in `resolved` (path === null but a
 * downloadUrl exists), returning a new RiffLibraryResolvedRiff with paths filled
 * in for whichever succeeded. Shared by both the shared-feed and
 * private-jam resolve paths. Exported for loreWarehouseSync.ts's own use --
 * see peekSharedFeedCache's doc comment for why syncSharedFeed needs to
 * call this directly rather than going through resolveSharedFeedRiff.
 *
 * `signal` is threaded down to each real download's own fetch (see
 * downloadOneEndlesssStem) for cancellation. `onStemDownloaded`, when given,
 * fires once per stem that was ACTUALLY downloaded this call (not for one
 * that was already cached, or had no downloadUrl at all) with its real byte
 * count -- loreWarehouseSync.ts uses this to accumulate a running
 * bytes-transferred total for its own progress reporting, deliberately
 * counting only genuine network transfer, not "bytes now available
 * locally" (which already-cached stems would inflate without actually
 * costing any time or bandwidth this run). */
export async function downloadMissingStemsFor(
  resolved: RiffLibraryResolvedRiff,
  fetchImpl: FetchLike,
  signal?: AbortSignal,
  onStemDownloaded?: (bytes: number) => void
): Promise<RiffLibraryResolvedRiff> {
  const stems = await Promise.all(
    resolved.stems.map(async (stem) => {
      if (stem.path !== null || !stem.downloadUrl) return stem
      const path = endlesssStemCachePath(stem.stemCID)
      // Not existsSync: a 0-byte file there is a placeholder, downloaded
      // over in place (the rename below replaces it).
      if (isUsableStemFile(path)) return { ...stem, path }
      const downloadedBytes = await downloadOneEndlesssStem(
        path,
        stem.downloadUrl,
        fetchImpl,
        signal
      )
      if (downloadedBytes === null) return stem
      onStemDownloaded?.(downloadedBytes)
      return { ...stem, path }
    })
  )
  return { ...resolved, stems }
}

// Populated by listSharedFeed, read by peekSharedFeedCache -- avoids a
// second network round trip for shared-feed riffs specifically, since the
// listing response already embeds full riff+stem detail (unlike the
// private-jam path, which genuinely needs list-then-resolve). Cleared and
// repopulated on every listSharedFeed call; a resolve for a riff outside the
// most recently listed page returns null rather than guessing stale data.
//
// This single-page-lifetime cache is exactly right for on-demand UI use
// (resolve whatever's on the page currently being browsed) but WRONG for
// syncSharedFeed's own multi-page walk: each listSharedFeed call during the
// walk overwrites this cache with just that page's entries, so by the time
// the walk finishes and a later resolve phase runs, only the LAST walked
// page's riffs are still present here -- every earlier page's riffs
// silently fail to resolve. Confirmed live: a first-ever sync walked all
// the way to the true end of the account's history (correctly reaching
// June/July 2020), but only that final, oldest page's ~46 riffs actually
// ended up in the synced index, with `complete` wrongly left true --
// permanently hiding everything more recent behind a "fully synced" index
// that was nowhere close. peekSharedFeedCache lets syncSharedFeed snapshot
// each page's entries into ITS OWN accumulator immediately after listing
// that page, before the next page's listSharedFeed call evicts them here.
let sharedFeedCache = new Map<string, RiffLibraryResolvedRiff>()

/** Snapshots whichever of `riffCIDs` are currently present in the
 * shared-feed listing cache -- see sharedFeedCache's own doc comment for
 * why this exists. Read-only; does not affect the cache or trigger any
 * network activity. */
export function peekSharedFeedCache(riffCIDs: string[]): Map<string, RiffLibraryResolvedRiff> {
  const result = new Map<string, RiffLibraryResolvedRiff>()
  for (const riffCID of riffCIDs) {
    const cached = sharedFeedCache.get(riffCID)
    if (cached) result.set(riffCID, cached)
  }
  return result
}

/** The page listSharedFeed/listRiffsInJam return when the request never
 * produced one (cancelled, timed out, network error, HTTP error, malformed
 * body, not logged in). Empty like the feed's real end, so it is marked
 * `failed`: a sync that took it as the end marked the jam fully synced and
 * never fetched the riffs past it. */
function failedPage(offset: number, failure: EndlesssFetchFailure): RiffPage {
  return { riffs: [], hasMore: false, nextOffset: offset, failed: failure }
}

const ERROR: EndlesssFetchFailure = { reason: 'error' }
const LOGGED_OUT: EndlesssFetchFailure = { reason: 'logged-out' }

/** A request that threw: the caller's own cancel when its signal is
 * aborted, anything else (a timeout included) an error. */
function thrownFailure(signal?: AbortSignal): EndlesssFetchFailure {
  return signal?.aborted ? { reason: 'cancelled' } : ERROR
}

/** A response that wasn't ok: a 429 is Endlesss asking to slow down (with
 * its Retry-After, seconds or a date, when it gave one), a 401 a session it
 * no longer takes. */
function statusFailure(res: Response): EndlesssFetchFailure {
  if (res.status === 401) return LOGGED_OUT
  if (res.status !== 429) return ERROR
  const header = res.headers.get('Retry-After')
  if (header === null) return { reason: 'rate-limited' }
  const seconds = Number(header)
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now()
  return Number.isFinite(ms) && ms > 0
    ? { reason: 'rate-limited', retryAfterMs: ms }
    : { reason: 'rate-limited' }
}

export async function listSharedFeed(
  userName: string,
  offset: number,
  count: number,
  fetchImpl: FetchLike = fetch,
  signal?: AbortSignal
): Promise<RiffPage> {
  const session = activeSession()
  const headers: Record<string, string> = { 'User-Agent': userAgent() }
  if (session) headers.Authorization = bearerAuthHeader(session)

  let res: Response
  try {
    res = await fetchWithTimeout(
      fetchImpl,
      `${API_HOST}/api/v3/feed/shared_by/${encodeURIComponent(userName)}?size=${count}&from=${offset}`,
      { headers },
      undefined,
      signal
    )
  } catch (err) {
    console.error('endlesssApi: listSharedFeed network failure:', err)
    return failedPage(offset, thrownFailure(signal))
  }
  if (!res.ok) {
    console.error(`endlesssApi: listSharedFeed HTTP ${res.status}`)
    return failedPage(offset, statusFailure(res))
  }

  let body: RawSharedFeedResponse
  try {
    body = (await res.json()) as RawSharedFeedResponse
  } catch (err) {
    console.error('endlesssApi: listSharedFeed malformed JSON:', err)
    return failedPage(offset, thrownFailure(signal))
  }

  const newCache = new Map<string, RiffLibraryResolvedRiff>()
  const summaries: RiffLibraryRiffSummary[] = []
  for (const entry of body.data ?? []) {
    // entry.loops can contain literal nulls for unused slots -- a documented
    // Endlesss backend quirk (see the design spec's grounding section), not
    // something to treat as malformed data.
    const stemDocs = (entry.loops ?? []).filter((s): s is RawStemDoc => s !== null)
    const resolved = buildResolvedRiff(entry.doc_id, entry.rifff, stemDocs)
    newCache.set(entry.doc_id, resolved)
    // The shared-feed listing response embeds full stem docs (unlike the
    // private-jam list-then-resolve path), so ownerFraction can be computed
    // right here rather than staying flat -- `userName` is the account whose
    // feed is being browsed, which per EndlesssLibraryBrowser's own
    // effectiveUsername logic is always the logged-in viewer's own username
    // once authenticated, so "fraction authored by userName" reads as
    // "fraction authored by you" in the common case.
    const ownerFraction = computeOwnerFraction(
      stemDocs.map((s) => s.creatorUserName),
      userName
    )
    summaries.push(
      summarizeResolvedRiff(
        entry.doc_id,
        entry.rifff.userName,
        Math.floor(entry.action_timestamp / 1000),
        resolved,
        ownerFraction
      )
    )
  }
  sharedFeedCache = newCache

  return {
    riffs: summaries,
    hasMore: summaries.length === count,
    nextOffset: offset + summaries.length
  }
}

interface RawMembershipRow {
  id: string
  key: string
}

interface RawMembershipResponse {
  total_rows: number
  rows: RawMembershipRow[]
}

// CouchDB path-segment escaping for usernames/jam IDs containing hyphens --
// traced from OUROVEON's own escaping (hyphens become "(2d)").
function escapeCouchIdSegment(id: string): string {
  return id.replace(/-/g, '(2d)')
}

async function fetchJamDisplayName(
  jamId: string,
  session: EndlesssSession,
  fetchImpl: FetchLike
): Promise<string> {
  try {
    const res = await fetchWithTimeout(
      fetchImpl,
      `${DATA_HOST}/user_appdata$${escapeCouchIdSegment(jamId)}/Profile`,
      { headers: { Authorization: basicAuthHeader(session), 'User-Agent': userAgent() } }
    )
    if (!res.ok) return jamId
    const body = (await res.json()) as { displayName?: unknown }
    return typeof body.displayName === 'string' && body.displayName.trim() !== ''
      ? body.displayName
      : jamId
  } catch (err) {
    console.error(`endlesssApi: failed to fetch display name for jam ${jamId}:`, err)
    return jamId
  }
}

/** Lists the account's subscribed jams -- private and public alike, since
 * this endpoint only ever returns jams the authenticated account actually
 * has access to (see the design spec's grounding section). Requires a
 * session; returns [] if not logged in rather than throwing, matching this
 * module's "never throws" convention elsewhere. `lastRiffTime` is left at 0
 * (unlike LORE's own listJams, which derives it from synced riff data this
 * module doesn't have) -- the UI can sort jams alphabetically or by join
 * order instead. */
export async function listJams(fetchImpl: FetchLike = fetch): Promise<RiffLibraryJam[]> {
  const session = activeSession()
  if (!session) return []
  // The account's own db: never the typed login name, which can be an email.
  const username = sessionUsername(session)
  if (username === '') return []

  let res: Response
  try {
    res = await fetchWithTimeout(
      fetchImpl,
      `${DATA_HOST}/user_appdata$${escapeCouchIdSegment(username)}/_design/membership/_view/getMembership`,
      { headers: { Authorization: basicAuthHeader(session), 'User-Agent': userAgent() } }
    )
  } catch (err) {
    console.error('endlesssApi: listJams network failure:', err)
    return []
  }
  if (!res.ok) {
    console.error(`endlesssApi: listJams HTTP ${res.status}`)
    return []
  }

  let body: RawMembershipResponse
  try {
    body = (await res.json()) as RawMembershipResponse
  } catch (err) {
    console.error('endlesssApi: listJams malformed JSON:', err)
    return []
  }

  return Promise.all(
    (body.rows ?? []).map(async (row) => ({
      jamCID: row.id,
      name: await fetchJamDisplayName(row.id, session, fetchImpl),
      lastRiffTime: 0
    }))
  )
}

interface RawRiffListRow {
  id: string
  key: number
  value: string[]
}

interface RawRiffListResponse {
  total_rows: number
  rows: RawRiffListRow[]
}

const DEFAULT_RIFF_PAGE_SIZE = 200

/** Lists riffs in one jam via the same rifffLoopsByCreateTime CouchDB view
 * OUROVEON itself uses -- lightweight (id/creation-time/stem-IDs only, no
 * per-riff metadata), matching the two-step "list then resolve" shape this
 * whole path already uses. `key` was assumed (per ResultRiffAndStemIDs' own
 * comment, see the design spec's Addendum) to be unix NANOSECONDS -- real
 * live testing against an actual jam showed every riff rendering as
 * 12/31/1969 (epoch), meaning that assumption was wrong; the real unit is
 * unix MILLISECONDS (JS's own standard `Date.now()` convention), so this
 * divides by 1000 to match RiffLibraryRiffSummary's unix-SECONDS convention, not
 * 1e9. Client-side filters
 * (date/bpm/userName) from RiffFilters are NOT applied here -- the raw view
 * doesn't expose that metadata without a per-riff resolve, unlike LORE's own
 * SQL-backed listRiffs. This is a deliberate v1 scope trim (see the
 * implementation plan) -- filtering can be layered on by resolving visible
 * riffs client-side in a later pass if it turns out to matter in practice. */
export async function listRiffsInJam(
  jamId: string,
  filters: RiffFilters,
  fetchImpl: FetchLike = fetch,
  signal?: AbortSignal
): Promise<RiffPage> {
  const offset = filters.offset ?? 0
  const limit = filters.limit ?? DEFAULT_RIFF_PAGE_SIZE

  const session = activeSession()
  if (!session) return failedPage(offset, LOGGED_OUT)

  let res: Response
  try {
    res = await fetchWithTimeout(
      fetchImpl,
      `${DATA_HOST}/user_appdata$${escapeCouchIdSegment(jamId)}/_design/types/_view/rifffLoopsByCreateTime?descending=true&limit=${limit}&skip=${offset}`,
      { headers: { Authorization: basicAuthHeader(session), 'User-Agent': userAgent() } },
      undefined,
      signal
    )
  } catch (err) {
    console.error('endlesssApi: listRiffsInJam network failure:', err)
    return failedPage(offset, thrownFailure(signal))
  }
  if (!res.ok) {
    console.error(`endlesssApi: listRiffsInJam HTTP ${res.status}`)
    return failedPage(offset, statusFailure(res))
  }

  let body: RawRiffListResponse
  try {
    body = (await res.json()) as RawRiffListResponse
  } catch (err) {
    console.error('endlesssApi: listRiffsInJam malformed JSON:', err)
    return failedPage(offset, thrownFailure(signal))
  }

  const rows = body.rows ?? []
  const riffs: RiffLibraryRiffSummary[] = rows.map((row) => ({
    riffCID: row.id,
    creationTime: Math.floor(row.key / 1000),
    bpm: 0,
    barLength: 0,
    userName: '',
    stemCount: row.value.length,
    cachedStemCount: 0,
    ownerFraction: 0
  }))

  return {
    riffs,
    hasMore: rows.length === limit,
    nextOffset: offset + rows.length,
    totalCount: body.total_rows
  }
}

/** How many riffs a private jam has, without paging through any of them --
 * a bare limit:1 listRiffsInJam call, keeping only its totalCount (the
 * CouchDB view's own total_rows, free on every call regardless of page
 * size). Used to warn before starting a sync on a particularly large jam;
 * returns null if the count isn't available (not logged in, network
 * failure -- listRiffsInJam's own "never throws" convention means an empty
 * page with no totalCount is indistinguishable from "truly zero riffs"
 * here, so callers should treat null as "unknown," not "empty"). */
export async function jamRiffCount(
  jamId: string,
  fetchImpl: FetchLike = fetch
): Promise<number | null> {
  const page = await listRiffsInJam(jamId, { limit: 1 }, fetchImpl)
  return page.totalCount ?? null
}

interface RawDocsRow<T> {
  id: string
  doc: T
}

interface RawDocsResponse<T> {
  total_rows: number
  rows: RawDocsRow<T>[]
}

/** The docs found for `keys`, by id (a key with no doc is absent), or why
 * the lookup failed. A failure is never an empty map: the stem lookup's
 * used to be, and resolveJamRiff built the riff with no stems -- which the
 * sync saved as resolved, for good. */
async function fetchDocsByKeys<T>(
  jamId: string,
  keys: string[],
  session: EndlesssSession,
  fetchImpl: FetchLike,
  signal?: AbortSignal
): Promise<{ docs: Map<string, T> } | { failure: EndlesssFetchFailure }> {
  const result = new Map<string, T>()
  if (keys.length === 0) return { docs: result }
  let res: Response
  try {
    res = await fetchWithTimeout(
      fetchImpl,
      `${DATA_HOST}/user_appdata$${escapeCouchIdSegment(jamId)}/_all_docs?include_docs=true`,
      {
        method: 'POST',
        headers: {
          Authorization: basicAuthHeader(session),
          'Content-Type': 'application/json',
          'User-Agent': userAgent()
        },
        body: JSON.stringify({ keys })
      },
      undefined,
      signal
    )
  } catch (err) {
    console.error('endlesssApi: fetchDocsByKeys network failure:', err)
    return { failure: thrownFailure(signal) }
  }
  if (!res.ok) {
    console.error(`endlesssApi: fetchDocsByKeys HTTP ${res.status}`)
    return { failure: statusFailure(res) }
  }
  let body: RawDocsResponse<T>
  try {
    body = (await res.json()) as RawDocsResponse<T>
  } catch (err) {
    console.error('endlesssApi: fetchDocsByKeys malformed JSON:', err)
    return { failure: thrownFailure(signal) }
  }
  for (const row of body.rows ?? []) {
    if (row.doc) result.set(row.id, row.doc)
  }
  return { docs: result }
}

/** Resolves one riff within a private jam: fetches the riff doc, extracts
 * its referenced stem IDs from state.playback, batch-fetches those stem
 * docs, then downloads whatever stems aren't already cached locally --
 * mirroring downloadMissingStems' existing LORE-path contract exactly.
 * `signal`/`onStemDownloaded` are passed straight through to
 * fetchDocsByKeys/downloadMissingStemsFor -- see their own doc comments.
 * Null when the riff can't be resolved whole (resolveJamRiffOrFailure). */
export async function resolveJamRiff(
  jamId: string,
  riffCID: string,
  fetchImpl: FetchLike = fetch,
  signal?: AbortSignal,
  onStemDownloaded?: (bytes: number) => void
): Promise<RiffLibraryResolvedRiff | null> {
  const result = await resolveJamRiffOrFailure(jamId, riffCID, fetchImpl, signal, onStemDownloaded)
  return 'riff' in result ? result.riff : null
}

/** resolveJamRiff, saying why when it fails -- the sync stops on a 429 or
 * no session, and goes on past anything else. A riff is resolved only
 * whole: every active slot (one that is on, with a stem in it -- the same
 * slots buildResolvedRiff keeps) needs its stem record. A riff whose stem
 * lookup failed, or came back short, is a failure, never a riff with fewer
 * stems; a riff with no active slots is a real empty riff. */
export async function resolveJamRiffOrFailure(
  jamId: string,
  riffCID: string,
  fetchImpl: FetchLike = fetch,
  signal?: AbortSignal,
  onStemDownloaded?: (bytes: number) => void
): Promise<{ riff: RiffLibraryResolvedRiff } | { failure: EndlesssFetchFailure }> {
  const session = activeSession()
  if (!session) return { failure: LOGGED_OUT }

  const riffDocs = await fetchDocsByKeys<RawRiffDoc>(jamId, [riffCID], session, fetchImpl, signal)
  if ('failure' in riffDocs) return riffDocs
  const riffDoc = riffDocs.docs.get(riffCID)
  if (!riffDoc) return { failure: ERROR }

  const stemIds = riffDoc.state.playback
    .map((slot) => slot.slot?.current)
    .filter(
      (current): current is { on: boolean; currentLoop?: string; gain: number } => !!current?.on
    )
    .map((current) => current.currentLoop)
    .filter((id): id is string => typeof id === 'string' && id !== '')
  const uniqueStemIds = [...new Set(stemIds)]

  const stemDocs = await fetchDocsByKeys<RawStemDoc>(
    jamId,
    uniqueStemIds,
    session,
    fetchImpl,
    signal
  )
  if ('failure' in stemDocs) return stemDocs
  if (uniqueStemIds.some((id) => !stemDocs.docs.has(id))) {
    console.error(
      `endlesssApi: riff ${riffCID} in ${jamId}: ${stemDocs.docs.size} of ` +
        `${uniqueStemIds.length} stem records came back`
    )
    return { failure: ERROR }
  }
  const resolved = buildResolvedRiff(riffCID, riffDoc, [...stemDocs.docs.values()])
  return { riff: await downloadMissingStemsFor(resolved, fetchImpl, signal, onStemDownloaded) }
}
