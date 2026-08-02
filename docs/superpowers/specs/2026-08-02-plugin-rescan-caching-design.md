# Plugin Rescan Caching Design

## Background

`runFullScan()` (`src/main/runFullScan.ts`) is the only entry point for populating the
plugin catalog (`pluginCatalog.ts`), triggered by the "scan for plugins" button in
`MasterChainPanel.tsx`. Every invocation — first-ever scan or a later rescan after nothing
changed — walks the full candidate list (`listPluginCandidates()`, everything under
`/Library/Audio/Plug-Ins/VST3` and `/Library/Audio/Plug-Ins/Components`) and spawns a fresh,
isolated, timeout-guarded subprocess (`scanOneCandidate()`, up to 10s each) for every single
one, sequentially. There's no tracking of what a previous scan already found, so a rescan on
a machine with a large plugin collection costs the same as the very first scan, even when
nothing on disk has changed.

This adds a cache keyed on each candidate bundle's own mtime, so a rescan only pays the
subprocess cost for candidates that are new or have actually changed.

## Change detection

Each `CatalogEntry` (`pluginCatalog.ts`) gains one field: `mtimeMs: number` — the candidate
bundle path's own mtime (`fs.statSync(path).mtimeMs`) at the time it was scanned. This is the
same path already returned by `listPluginCandidates()` (the top-level `.vst3`/`.component`
bundle, not anything inside it) — no new directory walking.

This is a deliberate simplification: it does not walk inside a bundle to find the newest
file anywhere within it. An installer that edits files deep inside an existing bundle without
touching the bundle's own top-level directory entry (add/remove/rename a file directly inside
it) would not be detected as changed. In practice, plugin installers overwhelmingly replace
the whole bundle rather than editing it in place, so this is an accepted, uncommon edge case
rather than a correctness requirement — there is no "force full rescan" affordance in this
design (see Alternatives Considered) precisely because this edge case is expected to be rare
enough not to need a manual escape hatch.

## Scan algorithm

`runFullScan()` builds a lookup from the previous catalog's entries, grouped by `path` (a
single bundle can yield multiple `CatalogEntry` values, e.g. a multi-plugin VST3 bundle, so
this is a `Map<string, CatalogEntry[]>`, not a 1:1 map). For each candidate path in this
scan:

1. Stat the path. If the stat fails (race condition — e.g. the file vanished between
   `listPluginCandidates()` and now — or a permissions error), fall through to a normal scan
   for this candidate, exactly like today's `scanOneCandidate` failure handling; never throw.
2. If the previous catalog has entries for this exact path, and every one of those entries'
   stored `mtimeMs` equals the freshly-stat'd mtime, reuse those entries directly — push them
   onto this scan's `plugins` array unchanged, and skip calling `scanOneCandidate` for this
   candidate entirely.
3. Otherwise (new candidate, or mtime differs), scan normally via `scanOneCandidate`, and
   record the freshly-stat'd `mtimeMs` on each resulting `CatalogEntry`.

`onProgress` still fires exactly once per candidate either way (matching the existing
"reports progress once per candidate" contract), so the progress readout stays meaningful —
a scan with mostly-cached candidates will simply fly through most of its progress ticks
almost instantly.

Everything else about `runFullScan()` is unchanged: favourites are still carried forward
from the previous catalog regardless of whether a plugin was found in this scan (an
unavailable-but-previously-favourited plugin is untouched by this change, since "unavailable"
still means "not in `listPluginCandidates()` at all" — the cache only affects candidates that
*are* listed), the first-scan-ever old-allowlist auto-favourite migration is untouched (still
keyed on `previous.plugins.length === 0`), and instrument filtering is untouched.

## Backward compatibility

No migration code. A catalog written before this change has no `mtimeMs` on its entries
(`undefined`). `undefined !== <freshly-stat'd number>` is always false-equal (a mismatch), so
the very first rescan after upgrading naturally falls through to a full scan for every
candidate — exactly like today's behavior — and every rescan after that is fast. This matches
`pluginCatalog.ts`'s existing convention of not writing explicit migration code for additive
schema changes.

## UI

No changes. Same "scan for plugins" button, same `scanning... N/M` progress text
(`MasterChainPanel.tsx`) — it simply completes faster when most of the catalog is unchanged.

## Alternatives considered

**Recursive mtime (newest file anywhere inside the bundle).** Considered and rejected: walking
every file inside every candidate bundle to find its true newest-modified timestamp would
catch the in-place-edit edge case the chosen approach misses, but adds real, unbounded scan
cost of its own (some bundles are large), directly undercutting the speed win this feature
exists to deliver. Rejected in favor of the simpler top-level-mtime check.

**A separate "force full rescan" control.** Considered and rejected for this pass: the
in-place-edit edge case the simple mtime check can miss is expected to be rare (see "Change
detection" above), so a manual bypass isn't warranted yet. If it turns out to matter in
practice, it's a small, additive follow-up (e.g. a modifier-click on the existing scan
button) rather than something that needs to ship now.

## Testing

Extends `runFullScan.test.ts`, following its existing mocking convention
(`vi.mock('./pluginScan', ...)`):

- A candidate whose path's stat mtime matches its previous catalog entry's stored `mtimeMs`
  is reused without `scanOneCandidate` being called for it (assert on a call-tracking spy,
  not just the resulting catalog contents).
- A candidate whose stat mtime differs from its previous entry's stored `mtimeMs` is rescanned
  (`scanOneCandidate` is called for it), and the resulting entry's `mtimeMs` reflects the new
  stat.
- A candidate with no previous catalog entry at all (brand new plugin) is scanned normally.
- Progress still fires once per candidate in a scan that's a mix of cached and rescanned
  candidates.
- Existing tests (favourite preservation, first-scan auto-favourite, instrument filtering,
  progress-once-per-candidate on a scan with no previous catalog) continue to pass unmodified.

No manual verification checklist beyond running the existing "scan for plugins" button twice
in a row and confirming the second run visibly completes faster — this is main-process logic
with full unit coverage, not a rendering/gesture change.
