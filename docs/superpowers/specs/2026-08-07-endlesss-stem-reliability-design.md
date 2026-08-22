# Endlesss Direct: Stem Download Reliability & An Ahead-of-Time Local Sync — Design

**Status:** Drafted solo while Elling was away, per his explicit "spec it out" request. Revised
in place once background research into OUROVEON's actual source landed (Grounding section below
now has real citations, not placeholders) and once Elling — still away, following along async —
redirected the goal mid-draft: rather than only chasing "prefetch enough to feel instant,"
**"a full ahead of time local sync is doable for rifff feed and private jam"** — his words. That
became this spec's primary proposal (Part B). The reliability fixes originally proposed for the
on-demand path (Part A) are **already implemented and shipped** as of this revision — they're
recorded here for context and because the sync in Part B reuses them directly, not as
still-open work.

## Background

sssketch's direct-Endlesss import (`docs/superpowers/specs/2026-08-07-endlesss-direct-import-design.md`)
browses a person's own shared feed and private jam(s) without requiring LORE, resolving and
downloading stem audio **on demand** the moment a riff is clicked. Live testing this session
surfaced two related but distinct problems:

1. **Inconsistent download success.** Some riffs resolve with every stem cached, some with a
   handful of `N` failing out of `M`, some with zero. This was initially invisible (no error
   shown at all) — fixed this session by tying the "no audio available" message to whether
   playback was actually attempted-and-failed (`previewAttemptedForCID`), rather than a
   heuristic that missed partial-failure cases. That fix made failures *visible*; Part A below
   is what actually reduces how often they happen.
2. **Playback isn't instant the way LORE's own browser is.** Elling's own framing: "make the
   riff playing instantaneous... incorporate that into the shared feed and private jam
   sections... we'll need to replicate a bunch of what lore does."

It's worth being precise about *why* LORE is instant, because it bounds what's actually
replicable. LORE's speed has nothing to do with a clever runtime trick — it's architectural: a
separate, long-running sync tool downloads a person's entire accessible history (riffs + stems)
into a local SQLite warehouse and a local stem-audio cache **ahead of time**. By the time someone
browses in LORE's own UI, every stem it shows is already sitting on disk. Playback is "instant"
because there's nothing left to fetch. The Grounding section below confirms this isn't just an
inference — OUROVEON's own source has no per-click prefetch trick either; its "instant" is
entirely a product of pre-existing local state.

Given that, "make it instantaneous like LORE" genuinely does mean building an equivalent of the
piece that makes LORE instant — an ahead-of-time local sync — just **scoped down** to exactly
the two sources this feature already targets (a person's own shared feed and private jam(s)),
never the wider community/public-discovery scope LORE's own sync can reach. That's Part B.

## Grounding: OUROVEON's actual stem-download, auth, and prefetch behavior

Traced directly from a fresh clone of `https://github.com/OUROcorp/OUROVEON`, not guessed — every
claim below cites the real file and function it came from.

**Stem audio download is triggered per-riff, on demand — never during the warehouse sync.**
`toolkit.warehouse.cpp` (the SQLite sync, 3600+ lines) never downloads audio bytes; its worker
thread (`Warehouse::threadWorker`) only ever populates `warehouse.db3` with riff/stem
*documents* via metadata tasks (`GetStemData`, `GetRiffDataTask`, `JamSnapshotTask`). Actual
audio download lives in `endlesss::live::Stem::fetch()` (`live.stem.cpp:114`), called from the
playback pipeline (`live.riff.cpp`, `toolkit.riff.pipeline.cpp`) only once a riff is actually
being resolved for playback — the same shape sssketch's own on-demand resolve already has.

**Retry loop** (`live.stem.cpp:176-216`), entered only if nothing usable is already cached on
disk:

```cpp
for ( auto remoteFetchAttempst = 0; remoteFetchAttempst < ncfg.getRequestRetries(); remoteFetchAttempst++ )
{
    const auto fetchDelayMs = std::min( lRng.genInt32( 0, 500 ) + ( remoteFetchAttempst * 250 ), 1000 );
    std::this_thread::sleep_for( std::chrono::milliseconds( fetchDelayMs ) );
    if ( !attemptRemoteFetch( ncfg, lRng.genUInt32(), audioMemory ) )
    { /* log, will retry */ }
    else { stemFetchSuccess = true; break; }
}
```

`getRequestRetries()` (`api.h:134-142`) returns `3` on a stable connection (`6` in an
"unstable network" mode) — comment: *"things can take a while to propogate to the CDN; wait
longer each cycle and try repeatedly."* This is CDN-propagation-delay tolerance, not generic
flakiness tolerance, hence the escalating jittered delay rather than a fixed one.

**CDN request headers** (`live.stem.cpp:641-663`, `Stem::attemptRemoteFetch`):

```cpp
cdnClient->set_default_headers({
    { "Host",            httpUrl },
    { "User-Agent",      ncfg.api().userAgentApp.c_str() },
    { "Accept",          "audio/ogg" },
    { "Accept-Encoding", "gzip, deflate, br" }
});
```

**No Authorization header at all** — the stem CDN URLs are unauthenticated regardless of
Endlesss login state. `Accept: audio/ogg` is sent unconditionally, even when the format chosen
is actually FLAC — a fixed header, not format-conditional.

**URL construction** — `types::Stem::fullEndpoint()` (`core.types.h:298-304`):

```cpp
inline std::string fullEndpoint() const
{
    if ( fileBucket.empty() ) return fileEndpoint;
    return fmt::format( "{}.{}", fileBucket, fileEndpoint );
}
```

...followed by a GET against `/{fileKey}`. **This is exactly what
`@shared/loreLibrary.ts`'s `stemDownloadUrl(fileEndpoint, fileBucket, fileKey)` already
does** — confirmed identical, not just similar. Critically, the reference client **never reads
an embedded `url` field from the CDN attachment doc at all** — `fileEndpoint`/`fileBucket`/
`fileKey` are populated straight from the raw doc (`core.types.cpp:19-44`) and reconstructed
into a URL every time. This was the single most likely root cause of sssketch's inconsistent
downloads: the on-demand path was trusting `cdn_attachments.oggAudio.url` directly instead of
reconstructing it.

**Format preference**: `ResultStemDocument::CDNAttachments::getAudioFormat()`
(`core.types.h:172-180`) prefers **FLAC over OGG whenever a FLAC attachment is present**
(`bHasFLAC = flacAudio.getLength() > 0`), falling back to OGG only when there's no FLAC. sssketch
deliberately keeps preferring/requiring OGG regardless, since its decode pipeline has no FLAC
support — this is a real, permanent scope limit, not a bug to fix. Comment at
`core.types.h:160-166` describes ogg-missing-entirely as *"very rare,"* and FLAC as *"a recent
addition"* to the platform — consistent with sssketch's own existing doc comment.

**Correction (2026-08-22):** the "no FLAC support" premise above was wrong — both actual decode
surfaces (the native engine's JUCE `AudioFormatManager`, and the renderer's Web Audio
`decodeAudioData`) are format-agnostic and were already decoding real FLAC-content stems in
production (the Ableton-export bake-stem path). The OGG-only restriction was never a decode
limitation, just an unverified assumption in `buildResolvedStem` (`src/main/endlesssApi.ts`).
Fixed: sssketch now prefers `flacAudio` over `oggAudio` too, matching OUROVEON's own client.

**No eager/hover/visible-content prefetch exists anywhere in OUROVEON.** Two distinct mechanisms
cover all bulk-download behavior, and neither is automatic-on-browse:

1. The in-memory `RiffCacheLRU` — caches already-resolved `live::Riff` *objects* for the current
   session only (replaying something already loaded is instant; browsing something new is not).
2. `src/r4.toolbox/ux/jam.precache.cpp` (`JamPrecacheState`) — an **explicit, opt-in, manual**
   tool. Its own UI copy: *"This tool allows you to download every stem associated with the
   chosen jam... for playback... completely offline."* The user has to open a dialog and click
   "Fetch Stem Workload" → "Begin Download." It fans out via a user-adjustable concurrency slider
   (`m_maximumDownloadsInFlight`, default `OURO_THREAD_LIMIT` = 10 release / 30 debug) through
   the shared Taskflow executor, calling the exact same `Stem::fetch()` used by normal playback.

**Conclusion**: even OUROVEON itself, with a stem cache that's expected to grow to cover a whole
jam's history, treats *bulk* downloading as something the user explicitly asks for — never
something that happens silently just because content became visible. That precedent directly
informs Part B's own trigger design below.

**Auth (confirms earlier suspicion)**: `config::endlesss::Auth`'s `password` field (`config.h`)
is populated straight from the `/auth/login` response body via cereal's `CEREAL_NVP(password)` —
comment above the struct: *"extraction of the default web login response, to gather login
tokens."* It is a server-issued, session-scoped credential, not an echo of the typed password.
`token:password` forms the credential pair for both Basic auth (data.endlesss.fm) and a Bearer
token whose *value* is the literal string `"{token}:{password}"` (api.endlesss.fm authenticated
calls) — sssketch's existing implementation already matches this.

## Goals

- Eliminate or substantially reduce avoidable stem download failures. **(Done — Part A.)**
- Get "time from click to first sound" close to zero for a person's own shared feed and private
  jam(s), the same way LORE achieves it for its own (much broader) scope — via a real
  ahead-of-time local sync, not a bigger prefetch window pretending to be one. **(Proposed —
  Part B.)**
- Stay entirely within sssketch's own process — no new dependency on LORE, no requirement that
  LORE ever be installed, and critically, **no scope creep toward "a second LORE"**: only the
  account's own shared feed and private jam(s), same boundary the original feature spec drew.

## Non-goals

- Syncing anything outside the two already-approved scopes (own shared feed, own private
  jam(s)) — no public discovery feed, no other people's jams, no "every jam I've ever joined."
- 100% download success. ~~Stems that are genuinely FLAC-only (no `oggAudio` attachment at all)
  remain undownloadable given sssketch's OGG-only decode pipeline — a real content limit, not a
  bug, and already has its own accurate UI message.~~ **Correction (2026-08-22):** no longer
  true — sssketch now downloads `flacAudio` directly (preferring it over `oggAudio`, matching
  OUROVEON), so a FLAC-only stem is no longer undownloadable. See the Format-preference
  correction above.
- An automatic, silent, unbounded background sync the moment someone logs in. See Part B's
  trigger discussion — OUROVEON's own precedent (explicit opt-in bulk download) argues against
  this, and it's the same class of thing ("uncapped background fetching") that already caused a
  real regression once this session.

## Part A — On-demand reliability fixes (done, shipped this session)

All three implemented in `src/main/endlesssApi.ts`, TDD'd against `endlesssApi.test.ts`, and
already committed:

1. **Reconstruct the stem download URL from endpoint/bucket/key** via the existing
   `stemDownloadUrl()` helper, instead of trusting the embedded `cdn_attachments.oggAudio.url`
   field — matching the Grounding section's URL-construction finding exactly. Falls back to the
   embedded `url` only if `key` is unexpectedly absent.
2. **Bounded retry** (`STEM_DOWNLOAD_RETRIES = 3`) with the same jittered/escalating delay
   formula (`[0,500) + attempt*250`ms, capped at 1000ms) as the reference client, for the same
   stated reason (CDN propagation lag).
3. **Matching CDN request headers** — `User-Agent` (this app's own, via the existing
   `userAgent()` helper), `Accept: audio/ogg`, `Accept-Encoding: gzip, deflate, br`, and
   deliberately no `Authorization` header.

These also directly benefit Part B, since the sync below downloads stems through this exact same
function.

## Part B — Ahead-of-time local sync (proposed, not yet implemented)

### What gets synced, and where it lives

Exactly the two sources already in scope for this feature:

- The account's own shared-riff feed (`listSharedFeed`, walked front-to-back).
- The account's own private jam(s) — now that jam-name filtering is exact-match
  (`isPersonalJamName`), this is realistically one or two jams, not dozens.

Two local artifacts, both already-established locations, no new dependency:

- **Stem audio**: the existing `endlesss-cache/stems/<source>/<riffCID>/<stemCID>` directory —
  already exactly what a sync would populate; no format change needed.
- **A lightweight local index** of what's already been synced — riff summaries (the same shape
  `listSharedFeed`/`listRiffsInJam` already return) plus a per-riff "fully synced" flag, so a
  later sync run can skip work already done and the browser UI can tell "already local" apart
  from "needs a network round trip." Proposed as a **flat JSON file** per source
  (`endlesss-cache/sync-index/shared.json`, `endlesss-cache/sync-index/jam-<jamId>.json`) rather
  than a second SQLite database: the realistic scale here (one account's own shares + one or two
  personal jams — hundreds to low thousands of riffs, not LORE's tens-of-thousands-across-every-
  jam) doesn't need SQL's query power, and a flat JSON index avoids taking on schema/migration
  concerns for a warehouse-equivalent LORE already solves for the cases that actually need it.
  (If real usage ever proves this wrong, swapping to `better-sqlite3` — already a dependency,
  already used for the read-only LORE path — is a contained change, not a rewrite.)

### Sync process

A new main-process function per source, e.g. `syncSharedFeed()` / `syncJam(jamId)`:

1. Walk pages via the existing `listSharedFeed`/`listRiffsInJam` from the front (newest first,
   matching their existing sort) until either `hasMore` is false or a riff already marked fully
   synced in the local index is reached — the second condition is what makes a *repeat* sync
   fast (only fetch what's new since last time), matching the "incremental" behavior LORE's own
   sync has.
2. For each riff summary encountered, resolve it (existing `resolveSharedFeedRiff`/
   `resolveJamRiff`, already fixed by Part A) and mark it synced in the local index once every
   downloadable stem has either succeeded or exhausted its retries — a riff with a permanently
   undownloadable stem (FLAC-only) still counts as "synced" so it isn't retried forever, it just
   never gets a `path` for that one stem.
3. **Concurrency-capped**, not one riff at a time and not unbounded — a small worker pool (e.g.
   3-4 concurrent riff resolves), mirroring the `ownershipInFlightRef` single-flight pattern
   already proven this session for the ownership-fetch queue, and roughly matching OUROVEON's
   own per-riff parallelism (its 8-stems-per-riff cap, further bounded by a ≤10-thread pool in
   release builds). This existing codebase already root-caused what happens without a cap
   (uncapped background fetching starving the actual click-to-play request) — the sync absolutely
   needs the same discipline, at even greater importance since it's now doing this for hundreds
   of riffs, not a handful of prefetch neighbors.
4. Interruptible/resumable by construction: since progress is persisted to the local index
   per-riff (not just at the end), quitting mid-sync and running it again later just continues
   from wherever the index says work stopped — no separate checkpoint mechanism needed.

### How the browser UI changes

Once a source has *any* synced state, `EndlesssLibraryBrowser.tsx` should prefer reading riff
summaries from the local index (instant, no network) over calling `listSharedFeed`/
`listRiffsInJam` live — falling back to the live on-demand path for anything the index doesn't
have yet (new content since last sync, or a source that's never been synced at all). This is
additive, not a rewrite: the existing on-demand resolve/download/preview machinery (Part A's
fixes included) stays exactly as the fallback path, and becomes what fills in the local index in
the first place during a sync run.

### Trigger: explicit, opt-in only (confirmed)

Per the Grounding section, even OUROVEON's own tool — covering more risk surface than this
feature ever will — treats bulk stem downloading as something the person explicitly asks for,
never something that happens silently on login or on scroll. **Confirmed with Elling**: a
clearly-labeled, opt-in action per source (e.g. "sync my shared feed for instant playback" /
"sync this jam"), with visible progress (X of Y riffs synced) while it runs — never an automatic
background sync that starts the moment someone logs in or opens a tab. This avoids surprising
someone with bandwidth/disk usage they didn't ask for, and avoids the same "uncapped background
work competing with foreground clicks" class of bug already root-caused once this session.

### Scope discipline (why this isn't "building a second LORE")

- Two sources only, both already gated behind "this account's own content" — never widened to
  "everything the account can see," which is what makes LORE's own scope so much bigger.
- No new install, no separate tool, no separate config format — lives entirely inside sssketch's
  existing `endlesssApi.ts`/cache-directory conventions.
- The local index is disposable and rebuildable from the live API at any time (it's a cache of
  what the API would return anyway, not a second source of truth) — deleting it and re-syncing
  is always a safe, correct recovery path, unlike LORE's warehouse which represents potentially
  irreplaceable historical state (jams the account may no longer have access to).

## Testing

- **Part A** (done): `endlesssApi.test.ts` — retry-then-succeed, retry-exhaustion, and CDN-header
  assertions, all using `vi.useFakeTimers()`/`vi.runAllTimersAsync()` to avoid real delays; a
  dedicated URL-reconstruction test using a stem doc whose embedded `url` deliberately disagrees
  with its endpoint/bucket/key, asserting the reconstructed URL wins.
- **Part B** (once implemented): unit tests for the local-index read/write logic and the
  "resume from where the index says we stopped" behavior against a fake `fetchImpl`, plus a
  concurrency-cap test (assert no more than N resolve calls are ever in flight at once, mirroring
  however the ownership-fetch queue's own test coverage — if any — is structured). Manual
  live-testing walkthrough for the actual sync-to-completion experience against the real
  backend, same as everything else in this feature.
