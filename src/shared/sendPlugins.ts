/** Renderer twin of native-engine/Source/SendPluginAllowlist.h — see that
 * file's own doc comment for the full rationale (curated, not scanned;
 * VST3-only; kept in sync by hand). Only `id` and `displayName` are needed
 * here — the plugin's file path only matters to the native engine, which
 * does the actual loading. */
export interface SendPluginAllowlistEntry {
  id: string
  displayName: string
}

export const SEND_PLUGIN_ALLOWLIST: SendPluginAllowlistEntry[] = [
  { id: 'solid-bus-comp', displayName: 'Solid Bus Comp' },
  { id: 'pro-q-3', displayName: 'FabFilter Pro-Q 3' },
  { id: 'soothe2', displayName: 'soothe2' },
  { id: 'sausage-fattener', displayName: 'Sausage Fattener' },
  { id: 'sunset-sound-reverb', displayName: 'Sunset Sound Studio Reverb' }
]

export function findSendPlugin(id: string): SendPluginAllowlistEntry | undefined {
  return SEND_PLUGIN_ALLOWLIST.find((p) => p.id === id)
}
