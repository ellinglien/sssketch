// src/main/runFullScan.ts
import { listPluginCandidates, scanOneCandidate } from './pluginScan'
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

/** Runs a full VST3 + AU directory scan, one candidate at a time (sequential
 * -- see the design spec's rationale: simplest and safest for v1, avoids any
 * concurrency interaction with the per-candidate timeout/kill logic).
 * `onProgress` fires after each candidate finishes (success or not), so the
 * caller can push scan-progress over IPC without this module knowing
 * anything about IPC itself. Existing favourites are preserved for any
 * plugin id still found in this scan -- a scan is additive, never
 * destructive (see design spec's error-handling section). */
export async function runFullScan(
  onProgress: (progress: ScanProgress) => void
): Promise<PluginCatalog> {
  const candidates = listPluginCandidates()
  const previous = loadCatalog()
  const plugins: CatalogEntry[] = []

  for (let i = 0; i < candidates.length; i++) {
    const result = await scanOneCandidate(candidates[i])
    if (result.success) {
      for (const p of result.plugins) {
        plugins.push({
          id: p.identifierString,
          name: p.name,
          manufacturer: p.manufacturer,
          path: candidates[i],
          arch: p.arch
        })
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
