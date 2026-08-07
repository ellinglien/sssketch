# Endlesss Direct: Stem Download Reliability & Faster Playback — Design

**Status:** Drafted solo while Elling stepped away, per his explicit "spec it out" request,
following "whatever you find, try to think about how we can integrate it into the rifff feed
and private jam stuff in the sssketch app, without a lore library." A background research pass
into OUROVEON's actual LORE source (retry logic, auth headers, stem URL construction) was still
running when this was written. Sections that depend on those findings are marked **PENDING**
below and will be filled in — with citations, not guesses — and this spec updated once that
research lands, before any of the still-open items get implemented. Everything NOT marked
PENDING is either already shipped (this session) or a low-risk, evidence-independent fix that's
safe to describe now.

## Background

sssketch's direct-Endlesss import (`docs/superpowers/specs/2026-08-07-endlesss-direct-import-design.md`)
browses a person's own shared feed and private jam(s) without requiring LORE, resolving and
downloading stem audio **on demand** the moment a riff is clicked. Live testing this session
surfaced two related but distinct problems:

1. **Inconsistent download success.** Some riffs resolve with every stem cached, some with a
   handful of `N` failing out of `M`, some with zero. This was initially invisible (no error
   shown at all) — already partially fixed this session by tying the "no audio available"
   message to whether playback was actually attempted-and-failed (`previewAttemptedForCID`),
   rather than a heuristic that missed partial-failure cases. That fix makes failures *visible*;
   it doesn't reduce how often they happen.
2. **Playback isn't instant the way LORE's own browser is.** Elling's own framing: "make the
   riff playing instantaneous... incorporate that into the shared feed and private jam
   sections... we'll need to replicate a bunch of what lore does."

It's worth being precise about *why* LORE is instant, because it bounds what's actually
replicable here. LORE's speed has nothing to do with a clever runtime trick — it's architectural:
a separate, long-running sync tool downloads a person's entire accessible history (riffs +
stems) into a local SQLite warehouse and a local stem-audio cache **ahead of time**, over
however long that takes (hours, for a large account). By the time someone browses in LORE's own
UI, every stem it shows is already sitting on disk. Playback is "instant" because there's
nothing left to fetch.

sssketch's direct-Endlesss path is deliberately **not** that — the whole point (per the original
design spec's own framing) is letting someone browse their own riffs *without* installing and
running LORE first. So "make it instantaneous like LORE" can't mean "build a second LORE." It
has to mean one of two things instead:

- **Fix whatever's causing avoidable download failures** (a correctness bug, not an
  architecture problem) — every riff that plays cleanly now was always going to; getting
  legitimately-downloadable stems to actually download reliably is pure upside.
- **Prefetch far enough ahead of an actual click** that, for content someone is already looking
  at (a currently-visible page of riffs, not their entire history), the audio is already on
  disk by the time they click it — the same *effect* as LORE's pre-sync, deliberately scoped
  down to "what's on screen right now" instead of "everything the account has ever touched."

## Goals

- Eliminate or substantially reduce avoidable stem download failures.
- Get "time from click to first sound" close to zero for riffs that have had a chance to
  prefetch (i.e., most riffs on an already-open page), without turning this feature into a bulk
  historical sync.
- Do this entirely within `src/main/endlesssApi.ts` / `EndlesssLibraryBrowser.tsx` — no new
  dependency on LORE, no local warehouse, no requirement that LORE ever be installed.

## Non-goals

- A second local warehouse / full offline sync of a person's entire Endlesss history. That's
  LORE's job; this feature exists specifically so people who don't want to run LORE still get
  something.
- 100% download success. Stems that are genuinely FLAC-only (no `oggAudio` attachment at all)
  are undownloadable given this app's current OGG-only decode pipeline — that's a real content
  limitation, not a bug, and already has its own accurate UI message
  ("stems failed to download" vs. "cached but failed to play" now distinguishes this).
- Browsing outside the two already-approved scopes (own shared feed, own private jam(s)) — no
  wider prefetch of public/other-people's content just because it'd be "nice to have cached."

## Already shipped this session (context, not new work)

These are already live and form the base this spec builds on:

- `PREFETCH_COUNT = 3`: selecting a riff also kicks off resolve+download for the next 3 riffs in
  list order, in the background, fire-and-forget.
- Upfront ownership fetch (`listRiffOwnership`) per loaded page, batched into exactly 2
  `_all_docs` round trips regardless of page size, serialized to at most one in flight at a time
  (`ownershipInFlightRef`/queue) — added after live testing showed repeated "load more" clicks
  stacking concurrent heavy requests that starved the actual click-to-play request.
- `AUTO_FILL_MAX_RIFFS = 120` cap on the auto-load-more-until-the-grid-fills effect, for the
  same reason (uncapped background fetching competing with foreground clicks).
- `previewAttemptedForCID`: the "no audio available" message now reflects a real playback
  outcome (attempted, no sources produced) instead of a cache-count heuristic that missed
  partial-failure cases.

## PENDING — OUROVEON source research

Background research task (still running as of this draft) is reading OUROVEON's actual sync
implementation to answer, with file/function citations:

1. Does LORE's own stem downloader retry failed downloads? How many attempts, what
   backoff/timeout?
2. What HTTP headers (if any) does it send when fetching the actual stem *audio* bytes (not
   metadata) — Authorization, User-Agent, Referer?
3. How does it construct the stem's download URL from the raw doc fields — does it trust an
   embedded `url` field directly, or reconstruct from endpoint/bucket/key components (the way
   `@shared/loreLibrary.ts`'s own `stemDownloadUrl()` already does, verified working for the
   LORE path)?
4. Is there a concurrency cap on simultaneous stem downloads during a sync?
5. Does it ever fall back to `flacAudio` when `oggAudio` is missing, or treat that the same way
   this app currently does (undownloadable)?

**This spec will be updated in place once that research returns**, with the findings recorded
the same way the original import spec's "Grounding" section did (direct file/function citations,
not summaries) — and the "Proposed changes" section below revised to match what's actually true
of the reference implementation, rather than what seemed plausible in advance.

## Proposed changes (draft — items 1–2 are evidence-dependent and may change once research lands; items 3–4 are safe regardless)

1. **Retry failed stem downloads.** `downloadOneEndlesssStem` currently makes exactly one
   attempt and gives up on any failure (network error or non-2xx). This module's own metadata
   calls already document a "conservative retry/timeout budget" philosophy (OUROVEON's own
   3–6 retries / 3–8s timeouts) but that was never actually applied to the audio-download path
   itself — only to the JSON/metadata calls via `fetchWithTimeout`. A bounded retry (a small
   fixed count, short backoff) for transient failures is a safe, self-contained fix regardless
   of what the OUROVEON research finds, since "retry a failed download a couple of times before
   giving up" is uncontroversially reasonable — the *exact* count/backoff should still match
   whatever the research confirms LORE itself does, for consistency, once that's known.
2. **Verify (and if needed, fix) stem URL construction.** The current code trusts
   `stem.cdn_attachments.oggAudio.url` directly. The LORE path instead reconstructs a stem's URL
   from `FileEndpoint`/`FileBucket`/`FileKey` via `stemDownloadUrl()`, verified empirically
   against real data to produce a working, unauthenticated HTTPS URL. Whether the embedded `url`
   field from the shared-feed/CouchDB stem docs is equally reliable, or whether it's sometimes
   stale/signed/differently-hosted than what reconstruction would produce, is exactly the kind
   of thing worth confirming against the real client's own behavior before changing — this is
   the single most likely root cause of inconsistent downloads, but shouldn't be changed on a
   guess.
3. **Widen prefetch to cover a full visible page, not just 3 riffs past the click.** Once a
   riff is *selected*, its next 3 neighbors already prefetch. But a freshly-opened page of, say,
   30–120 riffs (per the existing `AUTO_FILL_MAX_RIFFS` cap) has had zero prefetching done for
   anything the person hasn't clicked near yet — so the *first* click on a page is never
   instant, only subsequent nearby ones are. Prefetching real stem audio (not just the
   already-added ownership metadata) for every riff on a freshly-loaded page, bounded by the
   same page-size caps already in place, would make "click something you can already see"
   consistently fast — at the cost of real bandwidth/disk for riffs that never get clicked.
   Needs a concurrency cap (item 4) to avoid re-triggering the contention bug just fixed.
4. **Concurrency cap on prefetch downloads.** Directly required by item 3: if prefetch widens
   to "the whole visible page," downloads must be capped to a small number in flight at once
   (a simple worker-pool/queue, mirroring the `ownershipInFlightRef` single-flight pattern
   already used for ownership fetches) — otherwise this reintroduces exactly the
   "background fetching starves the actual click" regression that was root-caused and fixed
   earlier this session.

## Testing

- `endlesssApi.test.ts`: new cases for retry behavior (fake `fetchImpl` that fails N times then
  succeeds; assert the stem still ends up cached) and, if URL construction changes, a case
  asserting the reconstructed URL is used over/instead-of the raw `url` field.
- Manual live-testing walkthrough against the real Endlesss backend, same as every other part of
  this feature — download reliability specifically can't be verified any other way, since it
  depends on the real CDN's actual behavior, not anything mockable in a unit test.
