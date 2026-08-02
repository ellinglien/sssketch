// src/main/runFullScan.ts
import { listPluginCandidates, scanOneCandidate, getMtimeMs } from './pluginScan'
import { loadCatalog, writeCatalog, type CatalogEntry, type PluginCatalog } from './pluginCatalog'

export interface ScanProgress {
  done: number
  total: number
}

// The 5 plugins the old hardcoded allowlist (src/shared/masterChainAllowlist.ts,
// deleted once this scan feature replaced it) used to reference by path.
// Duplicated here rather than shared, matching this codebase's existing
// hand-synced-twin-table convention (e.g. schedulePlayback.ts/
// SchedulePlayback.cpp) -- see StoreContext.tsx's OLD_ALLOWLIST_SLUG_TO_PATH
// for the renderer-side twin (that one resolves a stale project save's old
// slug; this one seeds default favourites so upgrading from the hardcoded-
// allowlist version doesn't silently leave every dropdown empty).
const OLD_ALLOWLIST_PATHS = [
  '/Library/Audio/Plug-Ins/VST3/Solid Bus Comp.vst3',
  '/Library/Audio/Plug-Ins/VST3/FabFilter Pro-Q 3.vst3',
  '/Library/Audio/Plug-Ins/VST3/soothe2.vst3',
  '/Library/Audio/Plug-Ins/VST3/SausageFattener.vst3',
  '/Library/Audio/Plug-Ins/VST3/TR5 Sunset Sound Studio Reverb.vst3'
]

/** Groups a catalog's entries by their bundle path -- a single bundle can
 * yield multiple entries (e.g. a multi-plugin VST3 bundle), so this is a
 * 1:many lookup, not 1:1. */
function groupByPath(entries: CatalogEntry[]): Map<string, CatalogEntry[]> {
  const map = new Map<string, CatalogEntry[]>()
  for (const entry of entries) {
    const list = map.get(entry.path) ?? []
    list.push(entry)
    map.set(entry.path, list)
  }
  return map
}

/** Runs a full VST3 + AU directory scan, one candidate at a time (sequential
 * -- see the design spec's rationale: simplest and safest for v1, avoids any
 * concurrency interaction with the per-candidate timeout/kill logic).
 * `onProgress` fires after each candidate finishes (success, cached, or not),
 * so the caller can push scan-progress over IPC without this module knowing
 * anything about IPC itself. Existing favourites are preserved for any
 * plugin id still found in this scan -- a scan is additive, never
 * destructive (see design spec's error-handling section).
 *
 * A candidate whose bundle mtime exactly matches every previously-scanned
 * entry at that path is reused without calling scanOneCandidate at all --
 * see docs/superpowers/specs/2026-08-02-plugin-rescan-caching-design.md.
 * getMtimeMs never throws; a stat failure (race condition, permissions)
 * just means this candidate can't be cache-matched and falls through to a
 * normal scan, same as if it had no previous entry at all. */
export async function runFullScan(
  onProgress: (progress: ScanProgress) => void
): Promise<PluginCatalog> {
  const candidates = listPluginCandidates()
  const previous = loadCatalog()
  const previousByPath = groupByPath(previous.plugins)
  const plugins: CatalogEntry[] = []

  for (let i = 0; i < candidates.length; i++) {
    const path = candidates[i]
    const mtimeMs = getMtimeMs(path)
    const cached = mtimeMs !== null ? previousByPath.get(path) : undefined
    const isUnchanged = cached !== undefined && cached.every((e) => e.mtimeMs === mtimeMs)

    if (isUnchanged) {
      plugins.push(...cached)
    } else {
      const result = await scanOneCandidate(path)
      if (result.success) {
        // Instruments (synths/samplers) are excluded from the catalog entirely --
        // this app hosts effects on stems/channels, never a sound source of its
        // own, so an instrument plugin would never be usable here anyway. Filtered
        // at scan time rather than just hidden in the browser, so it never takes
        // up space in the persisted catalog or a favourites list.
        for (const p of result.plugins.filter((p) => !p.isInstrument)) {
          plugins.push({
            id: p.identifierString,
            name: p.name,
            manufacturer: p.manufacturer,
            path,
            arch: p.arch,
            // 0 is a deliberate sentinel for "couldn't stat this time either" --
            // it will essentially never match a real future mtime, so this
            // candidate simply gets rescanned again next time too, rather than
            // silently caching against a wrong/missing value.
            mtimeMs: mtimeMs ?? 0
          })
        }
      }
    }
    onProgress({ done: i + 1, total: candidates.length })
  }

  // A favourite is NEVER dropped by a scan, whether or not this particular
  // scan found that plugin again -- a plugin can be temporarily unavailable
  // for reasons unrelated to being uninstalled (e.g. an external drive not
  // mounted). Only toggleFavourite (pluginCatalog.ts) ever removes one. See
  // the design spec's error-handling section.
  const favouriteIds = [...previous.favouriteIds]

  // One-time migration: the very first scan ever run (no catalog existed
  // before this one) auto-favourites any of the 5 old hardcoded-allowlist
  // plugins it finds, so upgrading from that version of the feature doesn't
  // silently leave every master-chain dropdown empty. Only on the first
  // scan -- a later rescan must never re-add a favourite the user
  // deliberately removed.
  if (previous.plugins.length === 0) {
    for (const plugin of plugins) {
      if (OLD_ALLOWLIST_PATHS.includes(plugin.path) && !favouriteIds.includes(plugin.id)) {
        favouriteIds.push(plugin.id)
      }
    }
  }

  const catalog: PluginCatalog = { plugins, favouriteIds }
  writeCatalog(catalog)
  return catalog
}
