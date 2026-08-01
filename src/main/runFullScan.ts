// src/main/runFullScan.ts
import { listVst3Candidates, scanOneCandidate } from './pluginScan'
import { loadCatalog, writeCatalog, type CatalogEntry, type PluginCatalog } from './pluginCatalog'

export interface ScanProgress {
  done: number
  total: number
}

/** Runs a full VST3 directory scan, one candidate at a time (sequential --
 * see the design spec's rationale: simplest and safest for v1, avoids any
 * concurrency interaction with the per-candidate timeout/kill logic).
 * `onProgress` fires after each candidate finishes (success or not), so the
 * caller can push scan-progress over IPC without this module knowing
 * anything about IPC itself. Existing favourites are preserved for any
 * plugin id still found in this scan -- a scan is additive, never
 * destructive (see design spec's error-handling section). */
export async function runFullScan(
  onProgress: (progress: ScanProgress) => void
): Promise<PluginCatalog> {
  const candidates = listVst3Candidates()
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
  const catalog: PluginCatalog = { plugins, favouriteIds: previous.favouriteIds }
  writeCatalog(catalog)
  return catalog
}
