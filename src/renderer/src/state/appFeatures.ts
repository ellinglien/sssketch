// src/renderer/src/state/appFeatures.ts -- the advanced features switch, as the renderer sees it.
//
// One module store (useSyncExternalStore), not a context: TransportBar, ChannelRow, App,
// StoreContext and DiscoverPanel all read it, and none of them sits above the others. Main owns
// the value (src/main/appFeaturesStore.ts); this asks once, follows `app-features-changed`, and
// reads as "not known yet" (null) until main answers -- featureEnabled() reads null as off, so
// nothing advanced flashes up and no plugin loads before the answer.
//
// It also holds whether a radio hearts key is set, because the `fetch hearts` buttons are a
// feature rule (heartsButtonShown: a key AND the switch). RadioHeartsKeyModal reports a save
// here, so the buttons follow without a restart.
import { useSyncExternalStore } from 'react'
import { featureEnabled, type AppFeatureSettings, type FeatureId } from '@shared/features'

interface Snapshot {
  settings: AppFeatureSettings | null
  heartsKeySet: boolean
}

let snapshot: Snapshot = { settings: null, heartsKeySet: false }
const listeners = new Set<() => void>()
let started = false

function publish(next: Partial<Snapshot>): void {
  snapshot = { ...snapshot, ...next }
  for (const listener of listeners) listener()
}

function start(): void {
  if (started) return
  started = true
  void window.rifffApi
    .getAppFeatures()
    .then((settings) => publish({ settings }))
    .catch((err) => console.error('appFeatures: getAppFeatures failed:', err))
  window.rifffApi.onAppFeaturesChanged((settings) => publish({ settings }))
  refreshRadioHeartsKeyStatus()
}

function subscribe(listener: () => void): () => void {
  start()
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const getSnapshot = (): Snapshot => snapshot

/** The switch's settings; null until main answers. */
export function useAppFeatures(): AppFeatureSettings | null {
  return useSyncExternalStore(subscribe, getSnapshot).settings
}

/** Whether `id` is available now (false until main answers). */
export function useFeatureEnabled(id: FeatureId): boolean {
  return featureEnabled(id, useAppFeatures())
}

/** Whether a radio hearts key is saved (or held for this session). */
export function useRadioHeartsKeySet(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot).heartsKeySet
}

/** The gear menu's switch. Main saves it and pushes `app-features-changed` back. */
export async function setAdvancedFeatures(on: boolean): Promise<void> {
  publish({ settings: await window.rifffApi.setAdvancedFeatures(on) })
}

/** Re-asks main whether a hearts key is set (after the key modal saves). */
export function refreshRadioHeartsKeyStatus(): void {
  void window.rifffApi
    .radioHeartsKeyStatus()
    .then((status) => publish({ heartsKeySet: status === 'saved' || status === 'session' }))
    .catch((err) => console.error('appFeatures: radioHeartsKeyStatus failed:', err))
}
