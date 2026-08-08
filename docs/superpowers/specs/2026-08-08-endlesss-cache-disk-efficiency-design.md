# Endlesss stem cache dedup + stretch-cache eviction — design

## Background

An on-disk audit of `~/Library/Application Support/sssketch-dev` (3.9GB total) found two
real, unbounded-growth problems, both raised by Elling after noticing disk usage climbing
as rifff counts grow:

1. **Duplicate stem storage.** `endlesssStemCachePath(source, riffCID, stemCID)`
   (`src/main/endlesssApi.ts`) partitions the Endlesss stem cache by `source`
   (`'shared' | 'jam'`) as the first path segment: `endlesss-cache/stems/<source>/<riffCID>/
   <stemCID>`. A riff that appears in *both* the account's shared feed and one of its
   private jams — a common case, since sharing to the feed usually originates from a jam —
   gets its stems downloaded and stored twice, once under each source. Confirmed on-disk:
   25 of 830 synced shared-feed riffs are also present in the synced jam cache; a sample of
   20 of those pairs used ~48MB combined, roughly half of it duplicate bytes.
2. **Unbounded stretch-cache growth.** `stretch-cache/` (`src/main/rubberband.ts`) renders
   and caches a tempo-stretched copy of a stem for every distinct `(stemPath, ratio)`
   combination ever requested — including transient values from dragging the tempo slider,
   never actually kept. Its own code comment already flags this: *"No eviction policy...
   grows unbounded across a session... worth revisiting before this ships broadly."* It's
   currently the second-largest consumer on disk at 811MB (21% of total app storage),
   larger than the stem-duplication problem.

Not real problems, ruled out during the audit: LORE's own OUROVEON warehouse cache
(`~/Library/Application Support/OUROVEON/cache/common/stem_v2/`) is a separate directory
tree from sssketch's `endlesss-cache/`, but empirically only 184K on this machine — no
meaningful double-storage against sssketch's own cache today. Re-baking a rifff's downbeat
(`bakeOffset.ts`) already overwrites `.baked.wav` in place rather than accumulating
versions. `stemFeaturesCache.ts` (BusClusterPhase2) is an in-memory `Map`, not disk-backed.

## Part A: content-addressed Endlesss stem cache

### The fix

`stemCID` is Endlesss's own content identifier — the same audio always carries the same
`stemCID` regardless of which riff or jam referenced it. The `source` partition exists only
to avoid an unlikely `riffCID` collision between the shared-feed and jam listing spaces (see
the current code's own comment) — but keying storage by `source` at all is what causes the
duplication. The fix re-keys the cache by `stemCID` alone:

```
endlesss-cache/stems/<stemCID>          (current, source-partitioned)
     ↓
endlesss-cache/stems/<stemCID[0]>/<stemCID>   (new, content-addressed, one-hex-char shard)
```

The one-hex-char shard directly mirrors LORE's own warehouse convention
(`resolveStemPath` in `loreWarehouse.ts`: `cache/common/stem_v2/<JamCID>/<first-hex-char>/
<StemCID>`) rather than inventing a new scheme.

**Code changes** (`src/main/endlesssApi.ts`):
- `endlesssStemCachePath(source, riffCID, stemCID)` → `endlesssStemCachePath(stemCID)`.
- `downloadMissingStemsFor(source, riffCID, resolved, fetchImpl)` →
  `downloadMissingStemsFor(resolved, fetchImpl)` — `source`/`riffCID` become dead
  parameters once the cache path no longer needs them (neither is used anywhere else in
  the function).
- Exactly 3 call sites update to match: two in `endlesssApi.ts` (the shared-feed and
  jam resolve paths), one in `endlesssSync.ts`'s `syncSharedFeed`.

### Migration

Existing cached stems sit at the old `stems/<source>/<riffCID>/<stemCID>` paths. Some of
those exact path strings are already baked as literal `stem.path` values inside **saved
project files** (`.sssketchproj` JSON) — a project doesn't re-resolve a stem's path
dynamically, it remembers wherever the file was at import time. Simply moving/deleting the
old files would silently break playback for any already-saved sketch that imported one of
those stems.

The migration handles this safely: for every file found under the old `stems/shared/` or
`stems/jam/` trees,
1. Compute its new content-addressed path from the `stemCID` (the old path's last segment).
2. If nothing exists yet at the new path, move the file there. If something already exists
   there (the *other* source's copy of the same `stemCID`, i.e. a real duplicate), delete
   this copy instead — the new path already holds the content.
3. Replace the old path with a symlink pointing at the new path.

This reclaims the duplicate bytes immediately (both old paths for a shared `stemCID` end up
pointing at one real file) while leaving every existing saved project's recorded path
working exactly as before, transparently, via the symlink. New downloads go straight to the
new content-addressed path and never touch the old tree.

The migration is idempotent and runs once at app startup (`app.whenReady()` in
`src/main/index.ts`, alongside the existing playback-engine startup sequence): it checks
each entry under the old trees via `lstatSync` and skips anything that's already a symlink
(already migrated), so a second run after the first is a fast no-op scan. No separate
"has migration run" marker file is needed — the old trees themselves record migration state
via their contents (real file = not yet migrated, symlink = migrated).

## Part B: stretch-cache size-capped LRU eviction

`renderStretched` (`src/main/rubberband.ts`) already checks `existsSync(outPath)` before
rendering and returns the cached file on a hit. Two additions:

- **On a cache hit**, touch the file's mtime (`utimesSync`) to mark it as recently used.
  Without this, LRU-by-mtime would evict frequently-*reused*-but-never-*re-rendered* files
  first, since their mtime never updates on a hit — backwards from correct LRU behavior.
- **After a cache miss writes a new render**, scan `stretch-cache/`'s entries, sort by
  mtime, and delete the oldest ones until total size is back under a cap
  (`MAX_STRETCH_CACHE_BYTES`, 1GB — a fixed constant, matching this codebase's existing
  convention of hardcoded tuning constants like `STEM_DOWNLOAD_RETRIES` rather than adding
  settings UI for it).

The scan only runs on a cache miss (a genuinely new tempo/stem combination), not on every
render call or every playback tick, so the added I/O cost is proportional to how often new
tempo values are actually tried, not to normal playback.

## Testing

- **Endlesss cache re-keying**: existing `endlesssApi.test.ts` coverage of stem downloading
  updates to the new single-argument `endlesssStemCachePath`/`downloadMissingStemsFor`
  signatures.
- **Migration**: new `stemCacheMigration.test.ts`, following this codebase's real-temp-
  directory convention (`mkdtempSync`/`rmSync`, no fs mocking) — creates fake old-style
  files (including a genuine `stemCID` duplicate across `shared/` and `jam/`), runs the
  migration, asserts: new content-addressed paths exist with correct content, old paths are
  now symlinks resolving to the same content, the duplicate case produced exactly one real
  file on disk, and a second migration run is a no-op (idempotency).
- **Stretch-cache eviction**: new tests in `rubberband.test.ts` for the pure eviction logic
  (given a set of fake cache entries with known sizes/mtimes and a size cap, asserts which
  entries get deleted) — kept separate from `renderStretched` itself, which isn't unit
  tested today since it shells out to the real `rubberband` binary.

## Non-goals

- No settings UI for cache size limits (matches existing "deferred" precedent for
  configurable buffer size).
- No change to LORE's own warehouse cache (`~/Library/Application Support/OUROVEON/`) —
  it's a separate, OUROVEON-managed system this app only reads from.
- No general-purpose "clear cache" button or orphaned-project-stem cleanup — out of scope
  for this pass; the two fixes here address the specific unbounded-growth mechanisms found
  during the audit, not a full cache-management UI.
