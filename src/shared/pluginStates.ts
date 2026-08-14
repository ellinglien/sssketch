/** A single captured plugin's own parameter state, base64-encoded from
 * JUCE's getStateInformation() -- see native-engine/Source/PluginChain.cpp's
 * captureStateBase64. pluginId travels alongside the blob (not just implied
 * by whatever the slot's own masterChain/channelPlugins entry says right
 * now) specifically so stateForSlot below can refuse to apply a blob to a
 * DIFFERENT plugin that now happens to occupy the same slot number. */
export interface PluginStateEntry {
  pluginId: string
  stateBase64: string
}

/** Keyed by the same slot-addressing convention used everywhere else this
 * feature touches: `master:<slotIndex 0-3>` and `channel:<channelId>:<slotIndex 0-1>`.
 * Lives in the persisted .sssketchproj JSON but deliberately NOT in
 * AppState/the reducer -- see docs/superpowers/specs/
 * 2026-08-14-plugin-state-persistence-design.md's own explanation of why. */
export type PluginStatesMap = Record<string, PluginStateEntry>

/** What the engine's own get-plugin-states IPC reply looks like, before
 * this module cross-references it against AppState's own masterChain/
 * channelPlugins to attach real pluginIds -- see buildEngineProject.ts's
 * near-identical EngineProject.masterChain/channelChains shape, which this
 * intentionally mirrors. Every slot always has an entry (possibly ""); the
 * engine has no opinion on which pluginId occupies a slot, so it never
 * includes one in its own reply. */
export interface RawPluginStatesCapture {
  masterChain: string[] // length 4, "" = no plugin loaded or capture produced nothing
  channelChains: { channelId: string; slots: string[] }[] // slots length 2
}

/** Cross-references a raw engine capture (which only knows slot INDICES,
 * not pluginIds -- see RawPluginStatesCapture's own doc comment) against
 * AppState's own masterChain/channelPlugins (which DO know pluginIds) to
 * build the final map that gets embedded in the saved project JSON. A slot
 * is included only when BOTH a real pluginId (AppState's own knowledge)
 * AND a non-empty captured state (the engine's own knowledge) are present
 * -- either one being absent means there's nothing meaningful to persist
 * for that slot. */
export function buildPluginStatesMap(
  raw: RawPluginStatesCapture,
  masterChain: (string | null)[],
  channelPlugins: Record<string, [string | null, string | null]>
): PluginStatesMap {
  const map: PluginStatesMap = {}

  raw.masterChain.forEach((stateBase64, slot) => {
    const pluginId = masterChain[slot]
    if (pluginId && stateBase64) {
      map[`master:${slot}`] = { pluginId, stateBase64 }
    }
  })

  for (const chain of raw.channelChains) {
    const slots = channelPlugins[chain.channelId]
    if (slots === undefined) continue // AppState no longer knows this channel -- nothing to attach a pluginId to
    chain.slots.forEach((stateBase64, slot) => {
      const pluginId = slots[slot]
      if (pluginId && stateBase64) {
        map[`channel:${chain.channelId}:${slot}`] = { pluginId, stateBase64 }
      }
    })
  }

  return map
}

/** Restore-time lookup: returns the captured state blob for `slotKey` ONLY
 * if `pluginId` (the plugin actually being loaded into this slot right now)
 * matches what was captured there -- otherwise undefined, silently, not an
 * error (see the design doc's own restore-flow section: a mismatch is the
 * expected case for a newly-added plugin, a hand-edited project file, or a
 * user manually picking a different plugin into a slot that used to hold
 * something else). */
export function stateForSlot(
  pluginStates: PluginStatesMap,
  slotKey: string,
  pluginId: string | null
): string | undefined {
  if (!pluginId) return undefined
  const entry = pluginStates[slotKey]
  if (!entry || entry.pluginId !== pluginId) return undefined
  return entry.stateBase64
}
