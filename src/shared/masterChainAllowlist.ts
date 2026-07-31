/** Renderer twin of native-engine/Source/MasterChainAllowlist.h -- see that
 * file's own doc comment for the full rationale (curated, not scanned;
 * VST3-only; kept in sync by hand). Only `id` and `displayName` are needed
 * here -- the plugin's file path only matters to the native engine, which
 * does the actual loading. */
export interface MasterChainAllowlistEntry {
  id: string
  displayName: string
}

export const MASTER_CHAIN_ALLOWLIST: MasterChainAllowlistEntry[] = [
  { id: 'solid-bus-comp', displayName: 'Solid Bus Comp' },
  { id: 'pro-q-3', displayName: 'FabFilter Pro-Q 3' },
  { id: 'soothe2', displayName: 'soothe2' },
  { id: 'sausage-fattener', displayName: 'Sausage Fattener' },
  { id: 'sunset-sound-reverb', displayName: 'Sunset Sound Studio Reverb' }
]

export function findMasterChainPlugin(id: string): MasterChainAllowlistEntry | undefined {
  return MASTER_CHAIN_ALLOWLIST.find((p) => p.id === id)
}
