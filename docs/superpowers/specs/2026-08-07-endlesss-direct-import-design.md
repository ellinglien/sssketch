# Direct Endlesss Import (no LORE required) — Design

**Status:** Drafted solo while Elling was away, per his explicit "go as deep as you can, draft
up a spec" request. Normal brainstorming would have walked through clarifying questions one at
a time; instead every open decision below was made with a stated rationale so it's easy to
accept, argue with, or override on review. Nothing has been implemented — this is spec-only.

## Background

sssketch's only existing Endlesss integration (`src/main/loreWarehouse.ts`) reads a local
`warehouse.db3` SQLite file that a separate tool, [OUROVEON](https://github.com/OUROcorp/OUROVEON)
(specifically its LORE module), syncs from Endlesss's own backend. That path is entirely
offline/read-only from sssketch's point of view — it never talks to Endlesss directly. Anyone
who wants to browse their riffs in sssketch today has to first install and run LORE separately
to build that local database.

This session's research thread (starting from "is there a way to explore Endlesss without the
LORE integration?") worked out, from OUROVEON's own real source, that the underlying Endlesss
API is directly reachable with nothing more than a real Endlesss account's username/password —
no separate app install required. Elling's stated goal, narrowed down over the conversation:

> "allow folks who don't want to install lore a fun way to explore riffs they've made
> themselves. especially their own private jam, that's probably the most lucrative goal. not
> necessarily the whole db"

Narrowed further once the API surface was actually mapped out:

> "ideal targets: shared rifff feed from the user and the user's private jam.. those would be
> the two highest impact spots to pull from"

So the feature targets exactly two data sources, both scoped to "content this account made or
shared" — never someone else's jam, never the general public discovery feed:

1. **The account's own shared-riff feed** — the riffs they've explicitly shared out from
   Endlesss, the same content visible at `endlesss.fm/listen` under their own name.
2. **The account's own private jam(s)** — content that's never public at all, and the case
   LORE-install friction blocks hardest.

This is explicitly **not** "build a second LORE" — no bulk historical sync, no local warehouse,
no general public chart/discovery-feed browsing (other people's jams). It's a lightweight,
on-demand, "log in with your own account and look at what you've made" feature, sized to fit
inside sssketch's existing library browser rather than becoming its own subsystem.

## Grounding: the real Endlesss API surface

Traced directly from OUROVEON's actual source this session (not guessed — file/line references
below are all things that were actually fetched and read). This is the load-bearing research
for the whole design, so it's recorded here in full rather than summarized away.

**Login** (`src/r4.toolbox/app/ouro.cpp`, the toolbox app's own login button handler):

```
POST https://api.endlesss.fm/auth/login
Content-Type: application/json
Body: { "username": "<account email/username>", "password": "<account password>" }
```

The response body is a JSON document that OUROVEON deserializes directly into its `Auth` config
struct (`src/r3.endlesss/endlesss/config.h`):

```cpp
OURO_CONFIG( Auth )
{
    std::string     token;      // NOT the literal typed password — a session credential
    std::string     password;   // paired with token for basic-auth; also session-scoped
    std::string     user_id;
    uint64_t        expires = 0;   // unix milliseconds
};
```

The comment directly above it: *"extraction of the default web login response, to gather login
tokens"* — confirming `token`/`password`/`user_id`/`expires` come back from Endlesss's own login
endpoint, not from a source Elling would have to type in himself. The literal account password
is used exactly once, in the login POST, and never appears again.

**Authenticating subsequent requests** (`src/r3.endlesss/endlesss/api.cpp`) — there are two
distinct mechanisms, both built from the same `token`/`password` pair, used against two
different hosts:

- CouchDB-backed calls against `data.endlesss.fm` use HTTP **Basic Auth**, `token` as username:
  ```cpp
  dataClient->set_basic_auth( ncfg.auth().token.c_str(), ncfg.auth().password.c_str() );
  ```
- REST/web calls against `api.endlesss.fm` (the shared-feed endpoint below is one of these) use
  a **Bearer** header instead, per the code's own comment: *"some of the web APIs can accept
  Bearer to access per-user private data (eg. private shared riffs), formed out of
  `token:password`"* — i.e. the same credential pair, packaged differently for this host.

**Listing the account's own shared-riff feed** (`SharedRiffsByUser::fetch()`) — this is the
first of the two priority targets:

```
GET https://api.endlesss.fm/api/v3/feed/shared_by/{userName}?size={count}&from={offset}
```

Notable: this endpoint **works with or without authentication**. OUROVEON's own code picks the
auth mode based on what it has available: *"can use either auth or not, depending on what we
have in the configuration; no-auth just means you won't see your own private stuff, as
everything else is available via public calls."* Practically, that means sssketch could let
someone preview their own **public** shared riffs with zero login at all, and only need a real
session to also surface anything they shared **privately**. Worth designing the UI so an
unauthenticated shared-feed peek is possible (see Architecture below), even though login is
still the primary path for the private-jam target.

One real parsing gotcha documented directly in OUROVEON's source, worth carrying forward rather
than rediscovering the hard way: this endpoint's JSON response can contain literal `null`
entries inside its `loops` array (Endlesss backend quirk, not a bug in OUROVEON), which breaks
naive JSON parsing. OUROVEON pre-processes the raw response body to strip `null,` entries before
parsing for exactly this reason — sssketch's own parsing code needs the equivalent tolerance
(filter out non-object entries from that array) rather than assuming every array element is a
well-formed riff.

**Listing the account's own jams** (`SubscribedJams::fetch()`) — the second priority target,
covering private jams:

```
GET https://data.endlesss.fm/user_appdata${userName}/_design/membership/_view/getMembership
```

(hyphens in `userName` are escaped as `(2d)` for CouchDB path compatibility). This is scoped to
whatever jams the authenticated account is actually a member of — private jams included, and
with no separate "is this private" flag needed on sssketch's side, since the endpoint itself
only ever returns jams that account has access to.

**Listing riffs inside one jam** (`JamLatestState`/riff-listing queries):

```
GET https://data.endlesss.fm/user_appdata${jamID}/_design/types/_view/rifffLoopsByCreateTime?descending=true[&limit=N]
```

**Fetching a batch of specific riff documents by ID** (`RiffDetails::fetch()`):

```
POST https://data.endlesss.fm/user_appdata${jamID}/_all_docs?include_docs=true
Body: { "keys": ["riffID1", "riffID2", ...] }
```

**Stem metadata** is fetched the same batch way (`StemDetails::fetchBatch()`), against stem
document IDs referenced from a riff's own doc.

**Stem audio download requires no Endlesss auth at all.** This was already known from
sssketch's own code — `src/shared/loreLibrary.ts`'s `stemDownloadUrl()` doc comment records that
this was verified empirically against real warehouse data: stem blobs live at public,
unauthenticated DigitalOcean Spaces URLs built from a `FileEndpoint`/`FileBucket`/`FileKey`
triple. Only the *metadata* API (discovering which jams/riffs/stems exist and what their IDs
are) is gated behind login — the actual audio bytes are not. This means the new direct-API path
and the existing LORE path can end up sharing the exact same download primitive once a stem doc
is in hand, provided the live CouchDB stem doc exposes the same three fields (flagged as an
assumption to verify below — the SQLite `Stems` table's `FileEndpoint`/`FileBucket`/`FileKey`
columns were themselves populated by LORE's own sync of these same docs, so this is a reasonable
bet, not a leap).

## Goals

- Let someone use sssketch's riff-import experience against their **own** Endlesss account,
  entering their own credentials, with zero LORE install required.
- Two priority targets, both scoped to content the account itself made/shared: the account's
  own **shared-riff feed**, and the account's own **private jam(s)**. Both are "riffs they've
  made themselves," just surfaced through different Endlesss mechanisms.
- Feel like the same "fun to browse" experience the LORE browser already offers, not a
  second, worse UI bolted on beside it.
- Be a good citizen of someone else's unofficial, reverse-engineered backend: conservative
  request rates, honest identification, read-only (no writes back to Endlesss, ever).

## Non-goals (v1)

- **No bulk sync / no local warehouse.** Nothing is downloaded and retained beyond what's
  needed to preview or import the specific riffs someone actually looks at. If someone wants a
  full offline archive of a jam's entire history, that's what LORE is already for — this
  feature is explicitly the lighter-weight complement to it, not a replacement.
- **No general public chart/discovery-feed browsing** — i.e. no browsing *other people's* jams
  or the site-wide `endlesss.fm/listen?tab=chart` feed. `SharedRiffsByUser` is in scope, but
  strictly pinned to the logged-in (or explicitly entered) account's own `userName` — never used
  as a general-purpose "look up anyone's shared riffs" feature. That distinction is the whole
  difference between "riffs they've made themselves" (the ask) and a public content browser
  (not the ask).
- **No write operations.** OUROVEON's API surface includes a `push` namespace
  (`ShareRiffOnFeed`, `RiffCopy`) for posting content back to Endlesss. sssketch has no reason to
  ever call these and won't.
- **No multi-account / team features.** One logged-in account at a time, matching how the rest
  of sssketch (a single-user, single-machine app per its own LORE integration's own comments)
  already works.

## Approaches considered

**A. New parallel main-process module, on-demand fetch, reusing the browser UI shell.**
(Recommended — detailed below.) A new `src/main/endlesssApi.ts` alongside the existing
`loreWarehouse.ts`, talking to Endlesss live over plain `fetch()` calls (Node's own, already
used by `loreWarehouse.ts`'s `downloadOneStem`). The existing `LoreLibraryBrowser.tsx` UI gains
a source switcher rather than being duplicated.

**B. Push the networking into the native engine (JUCE/C++) instead of main-process TS.**
Rejected. `native-engine/` has no existing HTTP/JSON client dependency, and this is exactly the
kind of plain networked I/O Node's own `fetch` already handles well — `loreWarehouse.ts`
already proves that pattern out for stem downloads. Adding a whole new native networking stack
for this would be pure added surface area with no corresponding benefit; the native engine's job
is audio, not HTTP.

**C. Manual credential paste instead of a real login form** (mirroring how a developer might
copy OUROVEON's own `endlesss.auth.json` by hand). Rejected — it directly undermines the "don't
need to install/run a separate tool" goal, since producing that file by hand still effectively
requires understanding OUROVEON's own tooling or writing throwaway scripts. A real in-app
login form is a small amount of extra work for a much more honest "fun to explore" experience.

## Architecture

### New files

- **`src/main/endlesssApi.ts`** (new) — the direct-API equivalent of `loreWarehouse.ts`:
  login/session management, shared-feed fetching, jam listing, riff listing, riff resolution
  (batch doc fetch + stem metadata), and stem downloading. Read-only against Endlesss's backend
  — no calls into any `push`-namespace-equivalent endpoint ever get added here.
- **`src/renderer/src/data/riffSource.ts`** (new) — two small adapter interfaces, not one,
  since the three tabs genuinely split into two shapes: a **jam-based** `JamRiffSource`
  (`listJams`, `listRiffs`, `resolveRiff`, `downloadMissingStems`) satisfied by both "lore
  library" and "my private jams," and a **flat** `FeedRiffSource` (`listRiffs`, `resolveRiff`,
  `downloadMissingStems` — no `listJams`, no jam-selection step) satisfied by "my shared feed."
  Forcing all three into one jam-shaped interface would mean inventing a fake single "jam" for
  the shared feed just to satisfy a method it doesn't conceptually have — worse than admitting
  there are two natural shapes. Both interfaces share a `label`/`available` pair for UI display.
  This is what lets `LoreLibraryBrowser.tsx` stay one component with a source switch instead of
  forking into three near-duplicate browsers — the underlying riff-list/preview/import UI
  genuinely doesn't care which backend produced the data, only whether it's browsing "a jam" or
  "a flat feed," which the component already has to branch on for the tab layout anyway.
  (Renderer-only, deliberately — main process keeps `loreWarehouse.ts` and `endlesssApi.ts` as
  two independent, unrelated modules; there's no shared main-process interface forcing a shape
  neither backend naturally has.)
- **`src/renderer/src/components/EndlesssLoginPanel.tsx`** (new) — covers both auth paths in one
  small panel: a username/password "log in" form (unlocks private jams *and* private shares),
  plus — since the shared-feed target explicitly doesn't require a session — a lighter
  username-only field for "just show me `<username>`'s public shared feed" without logging in
  at all. Session status line (who's logged in, when it expires) and a "log out" button once
  authenticated. Rendered inline at the top of the library browser modal when the Endlesss
  source is selected.

### Modified files

- **`src/renderer/src/components/LoreLibraryBrowser.tsx`** — gains a top-level source switcher
  (lowercase tabs, styled per existing design tokens, no new visual language): "lore library" /
  "my shared feed" / "my private jams". The latter two are both Endlesss-direct, but kept as
  separate tabs rather than nested under one "endlesss" tab, because their access requirements
  genuinely differ (shared feed: optional login; private jams: always requires login) and
  collapsing them into a sub-toggle would just relocate the same decision one level deeper for
  no benefit. Everything below the switcher — riff list, filters, preview, import button — keeps
  working exactly as today, just fed through the `RiffSource` adapter for whichever source is
  active ("my shared feed" and "my private jams" both implement it; "lore library" already does
  implicitly via the existing LORE IPC calls). If, once actually built, the backends' filter
  capabilities turn out to diverge enough to make one shared filter bar awkward (see "Open
  questions" below), forking into dedicated sibling components per source is an acceptable,
  explicitly-sanctioned fallback — not a failure of this design, just a concrete detail to
  settle during implementation rather than guess now.
- **`src/main/index.ts`** — new `ipcMain.handle` channels, named to mirror the existing LORE
  ones so the pattern stays obvious to a future reader grepping this file (per CLAUDE.md's own
  note that this is the full IPC surface and the first place to look):
  - `endlesss-login(username, password)` → `{ ok: true } | { ok: false, error: string }`
  - `endlesss-logout()` → `void`
  - `endlesss-auth-status()` → `{ loggedIn: false } | { loggedIn: true, userId: string, expiresAt: number }`
  - `endlesss-list-shared-feed(userName, offset, count)` → `RiffPage`-shaped result. Works with
    an empty/no session — `userName` is a plain text field in the UI when logged out (typing
    your own Endlesss username, no password), and switches to the logged-in session's own
    `user_id` automatically once authenticated (which additionally unlocks privately-shared
    riffs per the Bearer-vs-public distinction above).
  - `endlesss-list-jams()` → `LoreJam[]`-shaped list (same shared type, see below). Always
    requires a valid session — private jams have no unauthenticated path.
  - `endlesss-list-riffs(jamId, filters)` → `RiffPage`-shaped result
  - `endlesss-resolve-riff(jamId, riffId)` → `LoreResolvedRiff`-shaped result (triggers on-demand
    stem download for anything not already cached, same as the existing
    `downloadMissingStems` behavior)
- **`src/preload/index.ts`** — matching bridge methods on `window.rifffApi`, same 1:1 mirroring
  convention the LORE channels already use.
- **`src/shared/loreLibrary.ts`** — no changes to existing exports; the new module reuses
  `LoreJam`, `LoreRiffSummary`, `LoreResolvedRiff`, `LoreResolvedStem`, `stemDownloadUrl`, and
  `computeOwnerFraction` as-is (all backend-agnostic already — none of them mention SQLite or
  the filesystem in their shape, only in `loreWarehouse.ts`'s own implementation). This is the
  detail that makes approach A cheap: the *data shapes* were already backend-agnostic before
  this feature existed.

### Session / credential storage

The literal typed account password is used exactly once (the login POST) and is never written
to disk. What *does* need to persist (so someone isn't re-logging-in every app launch) is the
login response: `token`, `password` (the session-scoped credential, not the real one),
`user_id`, `expires`.

This is a secret, so it should not follow OUROVEON's own approach of a plain-JSON file on disk.
Electron's `safeStorage` API (OS-keychain-backed encryption, already the standard tool for this
exact problem in Electron apps) should wrap it: `safeStorage.encryptString(JSON.stringify(session))`
written to a file under `app.getPath('userData')` (e.g. `endlesss-session.enc`), decrypted back
on app start to check `expires` against the current time. If `safeStorage.isEncryptionAvailable()`
is false on some platform/environment, fall back to not persisting the session at all (require
login every launch) rather than ever writing the secret in plaintext — a safer failure mode than
a silent plaintext fallback.

On startup, if a session exists and `expires` is in the future, treat it as logged in
immediately (no network call needed just to check). Once expired, the login panel reappears
with a "your session expired, log in again" message rather than a bare empty form.

### Local stem cache

A new, small, disposable cache directory — deliberately **not** attempting to reuse LORE's own
`stem_v2/<jam>/<hex-shard>/<stem>` layout, since sssketch doesn't own that format and has no
reason to interoperate with a real LORE install's folder (this feature exists specifically for
people who *don't* have one). Something like
`app.getPath('userData')/endlesss-cache/stems/<jamId>/<stemId>` (no file extension, matching the
existing convention) is enough. No LRU eviction or size cap in v1 — YAGNI given the explicit
"not the whole db" scope keeps this cache inherently small (only riffs someone actually previews
or imports ever get a file written); worth revisiting only if real usage shows otherwise.

### UI/UX flow

1. Open the library browser (however it's reached today for LORE) → see the three-tab source
   switcher at the top: "lore library" / "my shared feed" / "my private jams".
2. **"my shared feed":** if no session exists yet, a single username field ("show my shared
   riffs — no login needed") is enough to browse that account's *public* shares immediately via
   `endlesss-list-shared-feed`. A "log in for private shares too" link sits alongside it for
   anyone who wants the fuller picture — logging in swaps the plain username lookup for the
   authenticated session automatically, no separate toggle needed. Either way, riffs page in
   directly (no jam-selection step — the shared feed is already a flat list).
3. **"my private jams":** always needs a session. If none exists, `EndlesssLoginPanel` shows the
   username/password form. Submit → `endlesss-login` → on success, the jam list appears —
   subscribed jams for the account, same click-into-a-jam, scroll/paginate riffs,
   filter-by-date/bpm/username interaction the LORE browser already has.
4. Selecting a riff (from either tab) triggers `endlesss-resolve-riff`, which returns stem
   metadata plus already-downloaded local paths for anything cached, and kicks off downloads for
   the rest — mirrors `downloadMissingStems`'s existing behavior/contract exactly, so the
   riff-preview and import UI code paths need effectively no new logic here. (The shared-feed
   response may turn out to already embed enough riff/stem detail inline to skip a separate
   resolve call for that tab specifically — see Open Questions.)
5. Import button works exactly as it does for a LORE-sourced riff today, since by this point
   the data shape (`LoreResolvedRiff` with local `path`s) is identical regardless of source.
6. Logging in from either Endlesss tab logs in for both — one session, shared across "my shared
   feed" and "my private jams," since it's the same account either way.

## Error handling

- **Bad credentials at login:** `/auth/login` returns a non-2xx or an unparseable body → surface
  a plain "couldn't log in — check your username and password" message in the login panel, not
  a raw error dump. (OUROVEON's own code shows the failure response can include a `message`
  field — worth surfacing that verbatim if present, since it's genuinely more specific than
  anything sssketch could invent.)
- **Session expires mid-browse:** a metadata call suddenly 401s → treat exactly like "no valid
  session," drop back to the login panel with the "session expired" messaging, and don't lose
  the person's place any more than necessary (remembering which jam/tab was open is a nice
  touch, not required for v1).
- **Network failure / Endlesss backend down:** any fetch failing outright (not just a 401) shows
  a distinct "couldn't reach Endlesss right now" message — don't conflate "your login is stale"
  with "the internet/backend is unavailable," those need different next actions from the user.
- **A riff references a stem whose download 404s or times out:** same behavior LORE's own
  `downloadOneStem` already has — log it, leave that one stem's `path` null, don't fail the
  whole riff. The existing import UI already has to tolerate partially-cached riffs (LORE's own
  `cachedStemCount` field exists for exactly this reason).

## Being a good citizen of an unofficial API

Directly relevant to the "is this kosher" conversation this spec grew out of: OUROVEON's own
`rAPI` config caps retries at 3–6 attempts and timeouts at 3–8 seconds, and ships a distinct,
honest `User-Agent` string rather than impersonating the official Endlesss app. sssketch's
client should do the same — conservative retry/timeout budgets, a `User-Agent` that honestly
identifies itself (e.g. `sssketch/<version>`), and strictly read-only calls. This isn't a legal
requirement anyone here has verified, it's a design default in the same spirit as the actual
open-source project this technique is drawn from — being no more aggressive against someone
else's backend than the tool this was learned from already chooses to be.

## Testing strategy

Following this codebase's established convention (per CLAUDE.md: avoid mocking `electron`
wholesale; where a function needs a real external dependency, use an injectable override rather
than a fake): `endlesssApi.ts`'s functions should take an injectable `fetchOverride` parameter
(defaulting to global `fetch`), the same seam-injection shape `pluginScan.ts`/`engineProcess.ts`
already use for `binaryPathOverride`. Tests then supply a fake `fetch` returning canned JSON
fixtures (a captured real login response shape, a real membership-view response shape, etc. —
redacted of any real credentials/IDs) and assert `endlesssApi.ts`'s parsing, pagination, and
session-expiry logic against them, with zero real network calls. `safeStorage`-backed session
persistence gets the same narrow-mock treatment `pluginCatalog.test.ts` already established for
`app.getPath(...)` — mock only `safeStorage`'s two methods actually used, nothing broader.

Renderer-side (`RiffSource` adapter, `EndlesssLoginPanel.tsx`, browser source-switcher): per
this codebase's own convention, React components here aren't unit-tested directly — verified via
typecheck + lint plus manual walkthrough, same as everywhere else in sssketch.

## Open questions / assumptions to verify during implementation

These are places where OUROVEON's own source didn't give a 100%-confirmed answer from what was
read this session, or where a real decision got made without the normal back-and-forth — flagged
explicitly rather than silently assumed away:

1. **Jam ID mapping.** The `getMembership` view's exact response shape (specifically: does each
   entry directly give the CouchDB database ID needed for the riff-listing endpoint, or does
   that require a second lookup?) wasn't confirmed from source read this session — worth a
   small manual spike (log in, hit the real endpoint, look at the actual JSON) before writing
   `endlesssApi.ts`'s jam-listing code for real, rather than guessing the shape.
2. **Live stem doc field names.** `stemDownloadUrl()` expects `FileEndpoint`/`FileBucket`/
   `FileKey` — those are sssketch's own SQLite column names (i.e., LORE's own sync process's
   naming choices), not necessarily the literal field names on a live CouchDB stem document.
   Needs the same kind of real-response spike as #1 before assuming the existing helper can be
   reused verbatim.
3. **What "session-scoped password" actually is.** The login response's `password` field isn't
   necessarily the literal typed password (OUROVEON's own field naming suggests it's something
   else returned alongside the token) — worth confirming from a real response before writing the
   Basic Auth code, so the right field ends up in the right place.
4. **Shared vs. forked browser UI.** The plan above bets on `LoreLibraryBrowser.tsx` absorbing a
   source switch cleanly. If the two backends' filter/pagination shapes turn out to diverge more
   than expected once real code is written, forking into a dedicated `EndlesssLibraryBrowser.tsx`
   is a pre-approved fallback (see "Approaches considered" / modified-files section) — not a
   sign the design was wrong, just a normal implementation-time judgment call.
5. **Rate limits.** No documented Endlesss rate limit was found anywhere in OUROVEON's source or
   README this session — the "being a good citizen" retry/timeout numbers above are OUROVEON's
   own defensive defaults, not a confirmed published limit. Treat them as a floor, not a
   guarantee of safety.
6. **Shared-feed response richness.** The `shared_by/{userName}` response's `loops` array
   entries showed at least `_id`, `_rev`, and a `cdn_attachments` block in the one real fragment
   seen this session (in the context of the `null`-filtering code, not a full schema dump) —
   which hints the feed response might already carry enough riff/stem detail to skip a separate
   `endlesss-resolve-riff` round trip for shared-feed riffs specifically, unlike the private-jam
   path which genuinely needs the list→resolve two-step. Worth checking against a real response
   before assuming either way; if true, it simplifies (not complicates) the shared-feed code
   path relative to what's written above.
7. **`shared_by` null-array parsing.** Covered above in Grounding, repeated here as an
   implementation checklist item: don't assume every entry in that response's `loops` array is a
   riff object — filter out non-object entries first, matching OUROVEON's own documented
   workaround for this exact backend quirk.

None of these block writing the plan — they're the kind of thing a first implementation task
("spike: confirm real API response shapes against a live account") resolves in minutes once
someone's actually logged in, not open design questions.
