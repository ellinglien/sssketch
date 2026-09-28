# Discover candidate pool — drawing a pick from memory instead of from SQLite

Date: 2026-09-28
Status: drafted after an investigation that changed the answer; three fixes already shipped ahead
of it (§1), the pool itself awaiting Elling's go-ahead

## What happened

Radio changed a layer and the new stem started about a second late. Four separate prefetch fixes
landed the same day — the rubberband render, the stretch-duration IPC round trip, the native
engine's own decoded buffer (a new `preload-stem` message), and the renderer's waveform peaks —
and **none of them moved it.**

His logs, from a session with 5,058 jams:

```
get-discover-candidates(lead):  listJamsWithDb -- 5058 jams in 0ms
get-discover-candidates(lead):  getDiscoverCandidates -- 538 candidates in 1873ms
get-discover-candidates(warm):  listJamsWithDb -- 5058 jams in 1365ms
get-discover-candidates(warm):  getDiscoverCandidates -- 330 candidates in 324ms
get-discover-candidates(drums): getDiscoverCandidates -- 725 candidates in 3076ms
get-discover-candidates(warm):  getDiscoverCandidates -- 305 candidates in 476ms
```

The brief was to design a warm candidate pool, in Elling's own framing:

> "what about having a cue section and a live section at all times? so then the loading happens
> in one and the playing in another?"

He aimed that at audio. The right target looked like the candidate search. It was worth
measuring before designing, and the measurement changed the answer.

---

## 0. The verdict, up front

> ### The pick was never what was late. **A pool would have hidden three real bugs and fixed none of them.** The three are now fixed (§1). The pool is still worth building — for the manual buttons and for robustness — but it is a **quality** improvement, and nobody should later read this document as the fix for the late start.

Everything below §1 was established against Elling's real data, read-only: the external archive
at `/Volumes/Elling-Lien/ENDLESSS/cache/common/warehouse.db3` (5,056 jams, 372,319 riffs, 367,019
stems, 541 MB) and the own warehouse at `~/Music/sssketch/library/cache/common/warehouse.db3`
(49,761 riffs, 53,686 stems, 13,934 `StemCategories`, 46,547 `StemAutoCategory`). Nothing was
written to either.

**The model reproduces his numbers exactly.** Replaying `buildMaskKindIndex`'s admission rule over
the 420,705 persisted instrument rows gives `drums:168030 bass:47622 lead:77622`, against his
logged counters `kind-list-rows 168029` (the drums roll) and `77622` (the lead roll). Same
library, same lists, to within one row. Every number in this document comes from that rig.

---

## 1. What shipped before this spec, and why it had to

Three commits, on `master`, each verified green:

| | commit | what |
|---|---|---|
| **1** | `705510a` | the next pick waits for the current change to reach the engine |
| **2** | `8d81f22` | the jam list is kept until the jams change, not for sixty seconds |
| **3** | `5b0a91b` | the scan target walk yields on a clock, not on a row count |

### 1.1 The late start was a renderer ordering bug (`705510a`)

This is the one that had been walked past all day, and it is not a performance problem at all.

In the radio position-tick effect (`DiscoverPanel.tsx`), one microtask did both of these:

```js
commitSlotPick(pending.slotId, pending.pick)   // setSlots -> render -> rAF -> engine push
...
void armRadioPick()                            // -> pickForSlot -> IPC fired THIS microtask
```

`pickForSlot` fires `get-discover-candidates` **before its first await**. The commit's own engine
push, by contrast, leaves a frame later — `setSlots`, a render, the row's resolve effect,
`reportSlotResolution`, then `scheduleSyncPreviewToEngine`'s `requestAnimationFrame`, and only
then `buildEngineProject`'s stretch lookups, `setRemoteLoop` and `engineLoadProject`.

So the **next** pick's 0.3–3.1 s of main-process work was already in flight before the **current**
change's three IPC round trips had even been sent. Electron's main process is one thread. All
three queued behind it.

That is why four prefetch fixes did nothing. **They warmed the data. What was late was the
channel.** The stem that lands late is made late by the pick for the one after it.

The fix defers `armRadioPick()` until the change's engine push has completed, with a 1500 ms
backstop timer so a committed change whose stem never resolves — which schedules no sync at all —
cannot silently drop the arm and make radio skip a change entirely. Waiting for completion rather
than dispatch costs nothing worth having: the chain is tens of milliseconds warm, against a radio
interval of 3 bars at the very fastest (~6 s at 120 bpm).

The same hazard existed in the **course-change** branch and is fixed the same way — more
importantly there, since a course change commits every eligible layer at once and its push is the
biggest one radio ever makes. The **drop-out** arm is not affected: it only writes refs and
schedules a sync, and it already runs before the arm.

### 1.2 `listJamsWithDb` 0 ms / 1365 ms / 0 ms was a 60-second TTL (`8d81f22`)

Nothing exotic was tripping it. A module-level cache, `JAMS_WITH_DB_CACHE_TTL_MS = 60_000`,
invalidated only by `closeRiffLibraryDb()` (a root switch). 0 ms is a hit; 1365 ms is the TTL
expiring between two calls — which is exactly what the log shows, because the `lead` call's own
1873 ms straddled the boundary.

The cold build is genuinely slow, and measured:

```
listJams('') EXTERNAL run0   1389 ms   (cold OS page cache)
listJams('') EXTERNAL run1     41 ms
listJams('') EXTERNAL run2     48 ms
```

The query plan is fine — `SCAN j USING INDEX Jams_IndexJam` plus a covering index on the join. The
34× spread is I/O, and the reason is worth naming because it recurs throughout this document:
**the archive is a USB / ExFAT volume** (`diskutil`: `Protocol: USB`, `File System Personality:
ExFAT`). macOS does not hold on to its pages, so a cache that throws its answer away every sixty
seconds reliably pays a cold re-read of a 541 MB file.

Now kept until the tables it was built from actually move, at most one cheap signal query per db
and table per 30 s (1–7 ms warm, 300 ms cold for the external `Riffs` count). Exactly the
treatment background efficiency B3 already gave the riff-index and instrument-row caches, which
had the same expire-on-a-timer problem. The check itself moved out to
`src/main/tableChangeSignal.ts` on the way past — a core library store should not have to import
the Discover candidate query to ask whether a table changed.

### 1.3 The scan-target walk yielded on a row count (`5b0a91b`)

`listLibraryScanTargets` yielded every 200 stems. A row count is a guess about how long 200 rows
take, and it is only right on the machine that made it. Replayed against his own library (425,813
cached pairs across both dbs), the count-based policy gave a fine median and a bad tail:

| | count-based (every 200) | budget (8 ms) |
|---|---|---|
| own db — total / slices | 252 ms / 268 | 252 ms / **30** |
| own db — max slice | **102 ms** | **9.8 ms** |
| external db — total / slices | 717 ms / 1835 | 724 ms / **89** |
| external db — max slice | **43.8 ms** | **12.0 ms** |

Same total wall clock, ~15× fewer yields, and the tail — which is what anything waiting on the
main process actually feels — bounded. This one has the widest blast radius of the three: it is
what *every* main-process consumer was queueing behind, not just Discover.

**What it does not fix, and cannot:** one `readdirSync` of a large shard folder on that USB volume
was measured at **626 ms cold**, and no yield policy can subdivide one syscall. That needs an
async listing (`fs.promises.readdir`), which changes `existsFn`'s signature from sync to async and
ripples through `listLibraryScanTargets` and its tests. Deliberately left alone and written down
here rather than widened silently. See §8.

---

## 2. Where the time actually goes

Every step, measured at real scale on the real data (node with the repo's own better-sqlite3; the
yield benchmark in a real Electron main process):

| step | measured |
|---|---|
| 420,705 instrument rows, in memory (WeakMap) | 0 ms (153 ms once, from the persisted table at startup) |
| `readClassificationSignature` | 5–13 ms |
| **`buildMaskKindIndex`, full rebuild over all 420,705 rows** | **37–69 ms JS + 31 ms SQL** |
| per-roll `getMaskKindStemMasks` walk — drums (168,030 admitted) | 30 ms |
| per-roll walk — lead (77,622) | 20 ms |
| per-roll walk — bass (47,622) | 10 ms |
| eligible filter + `[...keys()]`, drums | 27 ms |
| external `Stems WHERE StemCID IN (200)` × 5 (the 1000-cap pool) | 273 ms warm |
| 2,104 `setImmediate` yields, real Electron main | 17 ms (8 µs each) |

**Total own cost for a drums roll, including a full kind-index rebuild: roughly 300–450 ms.**
Observed in his log: 3,076 ms.

The missing ~2.6 s was not Discover's work. It was other main-process work running at the pick's
own yield points — a mask-kind pick reaches 200–3,000 of them, and at each one it hands the single
thread to whatever else is queued. During that session that was the library scan's slices
(§1.3) and the background classifier's 3-second batches.

So the honest decomposition of a "3-second pick" is:

- **~350 ms** of its own work, dominated by external-volume `IN` queries and the mask walk,
- **~2.6 s** of politely standing aside for other work at yield points,
- plus **1.4 s** once a minute from the TTL, on whichever pick was unlucky.

Fixes 2 and 3 attack the second and third of those. The pool attacks the first, by moving it off
the moment it is needed.

### 2.1 The `engine-load-project` question is settled

The open question from the investigation — whether that handler's own cost is material or whether
it is purely queueing latency — was measured with a temporary log in the real app (since removed).

```
engine-load-project: handler 0ms, 329 bytes
engine-load-project: handler 0ms, 342 bytes
engine-load-project: handler 0ms, 342 bytes
```

The handler is `playbackEngine?.sendLoadProject(project)`, which is `JSON.stringify` plus a
fire-and-forget `socket.write`. It never waits for the engine. At realistic preview sizes
`JSON.stringify` is 0.003 ms for an 8-stem project (1,815 bytes) and 0.010 ms for a 32-stem one
(7,070 bytes).

**It is purely queueing latency.** Which is what makes §1.1 the whole of that bug: there was
nothing to make faster, only something to stop standing in front of.

---

## 3. What is already cached, and why it is not enough

There are three layers already, and a fourth beside them would be the wrong move. Naming them is
half the design.

1. **`riffIndexCache` / `instrumentRowsCache`** — per db connection, `WeakMap`, the whole `Riffs`
   and `Stems` tables read once with no `WHERE` clause and held. Persisted across launches in
   `DiscoverRiffIndexCache` / `DiscoverInstrumentRowsCache` on the own db (420,705 rows each), so
   a fresh launch loads in 153 ms instead of re-scanning. Measured cost of the live scan it
   avoids: **26 seconds** for the external `Stems` table alone. This layer is excellent and does
   its job.
2. **`maskKindIndexCache`** — per db, the three mask kinds' admitted lists precomputed in one pass
   (background efficiency B2). Rebuild is 37–69 ms.
3. **`traitQuantileCache`'s tables + the in-memory trait value table** (B1) — library percentiles
   and per-stem trait values, built once.

**Why they are not enough:** all three cache the *inputs*. None of them caches an *answer*. Every
roll still re-derives, from those warm inputs: the classification signature (a query), the
confirmed-role query, the per-kind admitted walk (10–30 ms of JS over up to 168k rows), the
eligibility filter, a random sample of 1,000, and then **five real `IN (200)` queries against a
541 MB db on a USB volume** (273 ms warm). That last one is the single largest remaining item and
no existing layer touches it.

So the pool is not a fourth cache beside three. It is **the first cache of the output**, and it is
the only one that can make a pick cost nothing.

### 3.1 A finding worth naming: the classifier invalidates the kind index every 3 seconds

`upsertStemAutoCategory` calls `bumpStemClassificationVersion(ownDb)` **per row**
(`stemAutoCategoryStore.ts:162`). `readClassificationSignature` reads that counter on every roll,
and any change invalidates `maskKindIndexCache`. The background classifier runs a batch every
`BUSY_DELAY_MS = 3000` while it has a backlog, writing up to 200 rows per batch.

So while classification is catching up, **the mask-kind index is thrown away roughly every three
seconds**, and the next mask roll rebuilds it over all 420,705 rows.

This is real waste and it is worth fixing. It is **not** the bug: a rebuild is 37–69 ms, not
seconds. I formed the opposite hypothesis early from the counter `kind-index-rows 420705` and
disproved it by measuring, and it is recorded here so nobody re-derives the wrong version of it.
An incremental patch is the natural fix — a new `StemAutoCategory` row only matters for a stem the
mask cannot place and which is not already claimed, so it can be applied to the existing index
directly instead of triggering a full rebuild. **Not in this spec's scope** (§9).

---

## 4. Where the pool lives: the main process

The choice is main (beside the query) or renderer (no IPC at all on a draw). **Main.** The
argument, since the brief asked for one rather than an assertion:

**For the renderer:** a draw becomes a synchronous array shift with no IPC boundary at all. That
is genuinely the fastest possible answer and it is tempting.

**Against, decisively:**

- **A draw is not on the critical path any more.** After `705510a` the pick no longer races the
  engine push, and an IPC round trip to a main process that is *not* doing 350 ms of SQL is well
  under a millisecond. The renderer's advantage is real and worth approximately nothing.
- **The pool must survive a panel remount.** `DiscoverPanel` unmounts whenever Discover is closed.
  A renderer pool would be rebuilt from cold every time the panel is reopened — which is exactly
  the moment the user is most likely to start clicking reroll.
- **Refill belongs next to the thing it refills from.** The pool's whole job is to run the query
  at a time nobody is waiting. In the renderer that means an IPC call whose *result* is the
  refill, which is the same main-process work at the same cost, plus a structured-clone of up to
  1,000 candidates across the boundary each time. In main it is a function call.
- **Invalidation signals are all main-side** (§6): sync writes, rescans, classification changes.
  A renderer pool would need each of them relayed over IPC as a new channel. A main pool reads
  them where they already are.
- **One pool, not one per window.** The phone remote (`remotePage.ts`) and any future surface get
  the same warm pool for free.

It lives in a new `src/main/discoverCandidatePool.ts`, between `index.ts`'s IPC handler and
`discoverCandidates.ts`'s query. `discoverCandidates.ts` stays a pure-ish query module that knows
nothing about pooling — it is already the most-tested file in this area and should not grow a
second responsibility.

---

## 5. Shape: keyed, drawn-from, topped up

### 5.1 The key

`slotKindsKey(kinds)` — `normalizeSlotKinds(kinds).join('+')` (`discoverSlotKind.ts:183`). That is
already what decides the SQL pool today, and reusing it means the pool can never disagree with the
query about what a slot is asking for.

The key must also include the roll options that change the answer: `onlyOwnStems`, `targetUser`,
and the `soundSource` filter. A pool drawn under "endlesss only" must not be served to a roll that
has since turned audio-in back on. Full key:

```
`${slotKindsKey(kinds)}|${onlyOwnStems ? targetUser ?? '' : ''}|${soundSource.endlesss ? 'e' : ''}${soundSource.audioIn ? 'a' : ''}`
```

### 5.2 Sizes

The sizes follow from one observed fact: **a query yields 305–725 candidates** on his library
(`warm` 305/330, `lead` 538, `drums` 725). So the pool cannot be sized independently of what a
refill can actually put in it, and a fixed high-water mark above ~300 would simply never be
reached for the leaner kinds.

- **A fill takes whatever the query returns**, capped at 1,000 (the query's own
  `MAX_CANDIDATE_RESOLUTION_POOL`). No separate high-water mark — the kind's own richness sets it.
- **Draw size: 100.** The refill cadence then follows the kind: `warm` gets ~3 draws per fill,
  `lead` ~5, `drums` ~7.
- **Low-water mark: 100** — one draw's worth. Falling to or below it schedules a refill.
- **Key cap: 8, LRU.** This is the important cap and it is not the per-key one. A kind set is any
  subset of 3 mask + 4 trait kinds, so there are up to 127 possible keys; times the roll-option
  axes, more. Unbounded, that is ~111 MB. A real session uses the handful of keys its slots are
  set to.

### 5.3 A draw

`pickForSlot`'s IPC handler asks the pool first. A **hit** takes a fresh random sample of up to
100 from the pool **and removes it**. A **miss** — cold key, or an empty pool — falls straight
through to `getDiscoverCandidates` exactly as today, and seeds the pool from that result. **There
is no path where a draw fails and the user sees nothing**; the worst case is today's behaviour.

A draw must return **a set, not one candidate**. `pickForSlot` does real work on the returned
array — `applyTraitBar`, `rankCandidates` against the project BPM and favourites, and `pickReroll`
with the chaos slider. Handing it a single pre-picked candidate would move ranking into main and
quietly change what the chaos dial means.

**Sampling and removing, rather than returning the whole pool, is what preserves variety.** Today
every roll re-samples the library, so two consecutive rolls rank genuinely different sets and the
chaos dial has something to work with. A pool that returned its full contents unchanged would hand
the renderer an identical ranked list every time, and a low chaos setting would pick the same top
candidate repeatedly. Sampling reproduces today's per-roll randomness; removing guarantees no
repeat within a pool generation.

**The honest cost:** ranking breadth drops from today's 305–725 to 100. That is the one real
behaviour change in this design, and it is the first number to revisit if picks start feeling
narrower (§12).

---

## 6. Staleness, repetition, and invalidation

### 6.1 Repetition is the real risk, not staleness

> Radio must not loop through the same twelve stems all evening.

A drawn candidate **leaves the pool.** Draws are destructive; there is no "mark as used" flag to
get wrong. With a 100-candidate sampled draw feeding a ranking that picks one, and a refill that
pulls a fresh random sample from a 168,030-stem admitted list, the odds of recycling are governed
by the underlying library sample, not by the pool.

Two further guards:

- **A refill never simply appends.** It drops what is left and replaces it. A pool that is topped
  up by appending drifts toward whatever the first sample happened to contain; replacing keeps
  every refill an independent draw from the library.
- **An age ceiling: 10 minutes.** A pool older than that is discarded on next access even if it is
  still above the low mark. This is the only time-based rule in the design and it exists purely so
  that a long session cannot end up serving one lucky sample for an hour. It is a repetition
  guard, not a correctness one.

### 6.2 What drops the pool entirely, and what merely tops it up

**Drops every key** (the answer could be different for anything):

| event | signal |
|---|---|
| riff archive root switched | `closeRiffLibraryDb()` — already the invalidation point for the jam list |
| library rescan / feature version bump | the same trigger that forces a rescan today |
| the user changes a slot's kinds | no drop needed — it is simply a different key |

**Drops one key:** nothing. Kind sets do not become individually wrong; the inputs do.

**Tops up (a refill, not a drop):**

| event | why not a drop |
|---|---|
| new stems arrive from a sync | additive. The current pool's candidates are all still valid; they are just missing the new arrivals. A refill picks them up on the next low-water crossing. |
| classification changes a stem's kind | one stem moving between kinds cannot make 300 others wrong. |
| the background classifier's batch writes | the same, ×200, every 3 s — see §3.1. Treating these as a drop would mean never having a warm pool at all while classification is catching up, which is precisely the state his library is in. |

The distinction is the whole of the invalidation design: **a drop is for "the world changed
shape", a refill is for "the world grew".** Getting this wrong in the eager direction is the
failure mode that would make the pool useless, because his library is under continuous background
classification.

Consequence, stated plainly: **a stem that syncs or is reclassified can take until the next refill
to become reachable from a pooled roll.** Bounded by the low-water crossing and the 10-minute
ceiling. For a feature whose job is "find me something I have not heard", that is not a defect.

---

## 7. Keeping it warm without becoming the problem

A background refill still runs the same 300–450 ms query. If it runs at the wrong moment it
recreates the bug one layer up.

**Reuse the classifier's scheduling posture rather than inventing a second loop.**
`stemAutoClassifyScheduler.ts` already has the right shape and it is already tuned against real
complaints about sustained background CPU: `BUSY_DELAY_MS = 3000` between batches with work
pending, sleeps when caught up, woken by `stemAutoClassifyWake.ts`, a long `SAFETY_INTERVAL_MS`
backstop, and a live-read consent gate (`loadDiscoverSettings().consentedToLibraryScan`).

The pool's refill:

- is **scheduled, never synchronous with a draw** — a draw that misses falls through to the query
  and returns; it does not wait for a refill,
- runs **at most one refill at a time, process-wide**, so several keys going low together queue
  rather than pile up,
- **defers while radio is within one second of a boundary.** Radio already knows when its next
  change lands; main does not. A tiny `engine`-adjacent hint from the renderer (`radio-boundary-
  soon`) is cheaper and more honest than main guessing. **If that turns out to be awkward, drop it
  rather than approximate it** — after `705510a` a refill colliding with a boundary costs a
  frame's worth of queueing, not a second,
- is **not consent-gated.** This is a deliberate difference from the classifier and worth stating:
  the classifier reads audio and computes over the whole library, which is what Elling consented
  to. A refill runs the identical query a manual reroll runs, over data already on disk, only
  earlier. Gating it would mean a user who declined the library scan gets a slower reroll for no
  privacy gain.

---

## 8. Should the query be made faster too?

**Yes, and after the pool, not before.** The three shipped fixes already removed the two worst
non-query items. What remains, in order of size:

1. **The five external `IN (200)` queries, 273 ms warm.** This is the biggest single remaining
   item in a pick. It is the `Stems` lookup for `PresetName` / `CreatorUserName` on the sampled
   candidates. Those two columns could be carried in the persisted `DiscoverInstrumentRowsCache`
   on the own db — which is already keyed by `StemCID` and already holds a row per stem — turning
   five USB-volume queries into a Map lookup. That is the highest-value remaining query fix and it
   is a natural follow-on.
2. **The per-kind admitted walk, 10–30 ms.** Fine as it is.
3. **The 626 ms cold `readdirSync`** (§1.3). Not a Discover query at all, but the largest single
   blocking event found anywhere in this investigation. Worth its own small piece of work.

Sequencing them after the pool is deliberate: **once a pick draws from memory, none of these is on
a path anyone is waiting on**, which makes them ordinary optimisations to do calmly rather than
urgent ones to do now. The exception is (3), which blocks everything and is not helped by pooling.

---

## 9. What this fixes beyond radio

This is most of the honest value, and it is why the pool is worth building even though it is not
the fix for the late start.

| path | IPC | pooled? |
|---|---|---|
| radio's armed pick | `get-discover-candidates` | **yes** — but it already had a whole interval to hide in |
| **`similar`** (the per-slot reroll button) | `get-discover-candidates` | **yes** |
| **`rerollAll`** | `get-discover-candidates`, **once per unlocked slot, sequentially** | **yes — the biggest win** |
| a new slot's first roll (`addSlot`) | `get-discover-candidates` | **yes** |
| `random` | `get-random-discover-candidate` (`getRandomLibraryCandidate` — one random jam) | **no** — a different query with a different shape; it was already the fast one |
| `adjacent` | `get-adjacent-discover-candidates` | **no** — anchored on the clicked candidate's own `riffCID`, so there is nothing to draw ahead of time |

**`rerollAll` is the case that has no interval to hide in and pays the cost N times.** A four-layer
bed at 350 ms a roll is 1.4 s of dead button, serialised, with the whole main process stalled
through it. That is the user-visible thing the pool actually fixes.

---

## 10. Memory

Measured, with a realistic candidate (three 40-char CIDs, preset name, creator, both trait maps,
kind sources): **874 bytes each.**

- Realistic: a fill holds 305–725 (§5.2), so 8 keys ≈ **2.1–5.1 MB**.
- Worst case at the 1,000 cap × 8 keys = **6.7 MB**. That is the number to hold the design to.
- Unbounded keys is the risk, not unbounded depth: 127 kind sets × 1,000 = ~111 MB. Hence the LRU
  cap on keys in §5.2.

---

## 11. Not now

Explicitly out, so the plan has a boundary:

- **Pooling `random` or `adjacent`.** §9 — one is already fast, the other cannot be pre-drawn.
- **Fixing the classifier's per-row version bump** (§3.1). Real waste, ~40–70 ms a rebuild, its
  own small piece of work.
- **Carrying `PresetName`/`CreatorUserName` in the instrument-row cache** (§8.1). The best
  remaining query fix, deliberately sequenced after the pool.
- **Async directory listing for the scan-target walk** (§1.3, §8.3). Changes `existsFn`'s
  signature and ripples.
- **Persisting the pool across launches.** The inputs are already persisted; the output is cheap
  to regenerate once they are warm, and a stale pool on disk is a new class of bug for no gain.
- **Any prediction of which key will be needed next.** The pool warms the keys that have been
  asked for. Guessing ahead is a different feature.
- **Anything in `native-engine/`.** Nothing here reaches it.

---

## 12. Open questions

- **The radio-boundary hint in §7.** Whether it is worth a channel at all, given `705510a` already
  removed the collision that made it matter. Build the pool without it first and measure.
- **Whether a 100-candidate draw is enough ranking breadth.** This is the one real behaviour
  change in the design (§5.3) and the number most likely to need moving. It is reasoned from the
  observed 305–725 per query, not tuned against a real session. If picks start feeling narrow or
  same-y, raise the draw before touching anything else.
- **Whether a draw should be destructive across keys.** Two slots set to `drums` draw from one
  pool, which is correct, but `pickForSlot` also dedupes against what other slots currently hold.
  Those two mechanisms have not been reasoned about together and may interact at small pool sizes.
