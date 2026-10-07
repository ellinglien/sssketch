// src/shared/features.ts -- the "advanced features" switch.
//
// Elling, 2026-10-07, for the public release: "this thing has too many features! most people
// won't need them." Five features go behind ONE switch in the gear menu, off for a new install.
// See docs/superpowers/plans/2026-10-07-advanced-features-toggle.md for every place each one
// reaches.
//
// Pure, and imported by both main (which skips the plugin scan, the microphone and the phone
// remote's server while off) and the renderer (which hides the UI).

export type FeatureId = 'phoneRemote' | 'recording' | 'plugins' | 'soundDefaults' | 'radioHeartsKey'

export interface FeatureInfo {
  id: FeatureId
  /** Lowercase, as the gear menu's tooltip lists it. */
  label: string
  /** Behind the advanced features switch. Every feature listed today is; a future one that is
   * not would be on for everyone. */
  advanced: boolean
}

export const FEATURES: readonly FeatureInfo[] = [
  { id: 'phoneRemote', label: 'phone remote', advanced: true },
  { id: 'recording', label: 'recording', advanced: true },
  { id: 'plugins', label: 'plugins', advanced: true },
  { id: 'soundDefaults', label: 'sound defaults', advanced: true },
  { id: 'radioHeartsKey', label: 'hearts key', advanced: true }
]

/** Saved in userData as appFeatures.json (src/main/appFeaturesStore.ts). App-wide, per machine,
 * never in a project. */
export interface AppFeatureSettings {
  advancedFeatures: boolean
}

export const ADVANCED_FEATURES_OFF: AppFeatureSettings = { advancedFeatures: false }

/** Whether `id` is available. `null` settings means main has not answered yet: read as off, so
 * nothing advanced flashes up, and no plugin loads, before the answer. */
export function featureEnabled(id: FeatureId, settings: AppFeatureSettings | null): boolean {
  const feature = FEATURES.find((f) => f.id === id)
  if (feature === undefined || !feature.advanced) return true
  return settings?.advancedFeatures === true
}

/** What an install has already used, each read cheaply (appFeaturesStore.ts): small files in
 * userData, plus a bounded number of the project library's newest projects. */
export interface AdvancedUseSignals {
  /** pluginCatalog.json lists at least one plugin. */
  pluginsScanned: boolean
  /** A project in the library (or the autosave, rarely there: it is deleted on every save) has a
   * plugin in a master or channel slot. */
  projectUsesPlugins: boolean
  /** phoneRemoteSettings.json exists: an address was picked in the phone remote's modal, or (from
   * now on) the remote server has run. */
  phoneRemoteUsed: boolean
  /** A radio hearts key is saved. */
  heartsKeySet: boolean
  /** A project in the library (or the autosave) holds an engine take. */
  recordingsMade: boolean
  /** soundSettings.json exists: sound defaults were saved (it is only written then). */
  soundDefaultsSet: boolean
}

/** The migration rule: an install that has used ANY of the five starts with the switch on, so
 * nothing disappears for someone already relying on it. `because` names the signals, in the
 * order AdvancedUseSignals lists them, for the stored file and the log. */
export function advancedFeaturesDefault(signals: AdvancedUseSignals): {
  on: boolean
  because: (keyof AdvancedUseSignals)[]
} {
  const order: (keyof AdvancedUseSignals)[] = [
    'pluginsScanned',
    'projectUsesPlugins',
    'phoneRemoteUsed',
    'heartsKeySet',
    'recordingsMade',
    'soundDefaultsSet'
  ]
  const because = order.filter((k) => signals[k])
  return { on: because.length > 0, because }
}

/** Discover's and radio's `fetch hearts`: only with a key set AND the switch on. Without a key
 * the button can only answer "no key"; the hearts are visitors' hearts on Elling's own web
 * radio. */
export function heartsButtonShown(settings: AppFeatureSettings | null, keySet: boolean): boolean {
  return keySet && featureEnabled('radioHeartsKey', settings)
}

/** A project has an add-on plugin in some master or channel slot. Both fields are optional so a
 * raw, older project file can be asked too. */
export function projectUsesPlugins(
  masterChain: readonly (string | null)[] | undefined,
  channelPlugins: Readonly<Record<string, readonly (string | null)[]>> | undefined
): boolean {
  if ((masterChain ?? []).some((id) => id !== null && id !== '')) return true
  return Object.values(channelPlugins ?? {}).some((slots) =>
    slots.some((id) => id !== null && id !== '')
  )
}

/** Leaves out what belongs to a feature that is off (the key gestures list, for one). */
export function visibleForFeatures<T extends { feature?: FeatureId }>(
  items: readonly T[],
  settings: AppFeatureSettings | null
): T[] {
  return items.filter(
    (item) => item.feature === undefined || featureEnabled(item.feature, settings)
  )
}
