// src/shared/pluginSwitch.ts -- what the engine should be told about the project's plugins, as the
// advanced features switch's `plugins` (@shared/features) goes on and off, the chains change, the
// catalog changes and the engine answers. Pure: StoreContext feeds it events and sends what it
// says. It never touches the project's own slots (AppState's masterChain/channelPlugins).
//
// The rules that keep a project's plugin settings (the "pending" map, pluginStates.ts) safe:
// - A load goes out only with a real path. A plugin the catalog has no path for (never scanned,
//   or scanned on another machine) is left out, its saved settings kept, and loaded once the
//   catalog has it (catalog-changed, e.g. after a scan). The engine treats an empty path as "no
//   plugin" and reports success, so sending one would quietly drop the settings.
// - A slot's saved settings stay in the pending map until the engine reports a successful load of
//   that plugin, carrying them, as the LAST thing sent to that slot (`sent`, below). Until then a
//   save, or a capture coming back empty for that slot, still has them.
// - Turning off asks the engine for its live settings first and unloads only once they are back.
//   A failed capture unloads nothing (the engine keeps them, phase 'held'). Turning back on while
//   the capture is in flight waits for it and then keeps the engine's plugins as they are.
import { buildPluginStatesMap, stateForSlot, type PluginStatesMap } from './pluginStates'
import type { RawPluginStatesCapture } from './pluginStates'

export interface PluginChains {
  masterChain: (string | null)[]
  channelPlugins: Record<string, [string | null, string | null]>
}

export type PluginSlotTarget =
  { kind: 'master'; slot: number } | { kind: 'channel'; channelId: string; slot: number }

export interface PluginSlotLoad {
  slotKey: string
  target: PluginSlotTarget
  pluginId: string
  path: string
  stateBase64: string | null
}

/** 'off': the engine holds none of the project's plugins. 'live': it holds them, kept in step.
 * 'capturing': switched off, the engine's settings are being read back; it still holds them.
 * 'held': switched off, but that read failed, so they were left loaded rather than lost. */
export type PluginSwitchPhase = 'off' | 'live' | 'capturing' | 'held'

export interface PluginSwitchState {
  phase: PluginSwitchPhase
  /** 'capturing' only: the switch went back on before the capture came back. */
  resumeAfterCapture: boolean
  /** The chains as last reconciled with the engine: what it holds (bar `uncataloged`). Empty
   * while 'off'. */
  synced: PluginChains
  /** Occupied slots not loaded because the catalog has no path for their plugin. */
  uncataloged: string[]
  /** Per slot, every load or unload sent and not answered yet, oldest first. The engine answers
   * each, in order (pluginId '' for an unload). */
  sent: Record<string, { pluginId: string; stateBase64: string | null }[]>
}

export const EMPTY_PLUGIN_CHAINS: PluginChains = {
  masterChain: [null, null, null, null],
  channelPlugins: {}
}

export const initialPluginSwitchState: PluginSwitchState = {
  phase: 'off',
  resumeAfterCapture: false,
  synced: EMPTY_PLUGIN_CHAINS,
  uncataloged: [],
  sent: {}
}

export type PluginSwitchEvent =
  /** `on`: the plugins feature is on AND the catalog has been read (a slot's path comes from it). */
  | { type: 'switch'; on: boolean }
  | { type: 'chains-changed' }
  | { type: 'catalog-changed' }
  /** The engine's answer to the capture a 'switch' off asked for. `projectReplaced`: another
   * project was opened while it was in flight, so what came back belongs to the old one. */
  | { type: 'capture-done'; raw: RawPluginStatesCapture | null; projectReplaced: boolean }
  /** A master-/channel-plugin-loaded reply. pluginId '' answers an unload. */
  | { type: 'load-result'; slotKey: string; pluginId: string; success: boolean }
  /** The engine was respawned: nothing sent before will be answered. */
  | { type: 'engine-restarted' }

export interface PluginSwitchContext {
  /** The project's chains right now. */
  chains: PluginChains
  /** The project's saved plugin settings not yet handed to the engine. */
  pending: PluginStatesMap
  /** A plugin id's file path from the catalog, null when the catalog doesn't list it. */
  pathOf: (pluginId: string) => string | null
}

export interface PluginSwitchStep {
  state: PluginSwitchState
  pending: PluginStatesMap
  /** Send, in order: engineLoad*Plugin(target, pluginId, path, stateBase64). */
  loads: PluginSlotLoad[]
  /** Send, in order: engineLoad*Plugin(target, null, null, null). */
  unloads: PluginSlotTarget[]
  /** Occupied slots this step left unloaded because the catalog has no path for their plugin:
   * for the slot's status ("scan for plugins"). */
  missing: PluginSlotTarget[]
  /** Ask the engine for its live plugin settings, then feed back 'capture-done'. */
  capture: boolean
}

export function pluginSlotKey(target: PluginSlotTarget): string {
  return target.kind === 'master'
    ? `master:${target.slot}`
    : `channel:${target.channelId}:${target.slot}`
}

function occupant(chains: PluginChains, target: PluginSlotTarget): string | null {
  return target.kind === 'master'
    ? (chains.masterChain[target.slot] ?? null)
    : (chains.channelPlugins[target.channelId]?.[target.slot] ?? null)
}

/** Every slot of `chains`, master first, then each channel's. */
function slotsOf(chains: PluginChains): PluginSlotTarget[] {
  const targets: PluginSlotTarget[] = chains.masterChain.map((_, slot) => ({
    kind: 'master',
    slot
  }))
  for (const [channelId, slots] of Object.entries(chains.channelPlugins)) {
    slots.forEach((_, slot) => targets.push({ kind: 'channel', channelId, slot }))
  }
  return targets
}

function withSent(
  sent: PluginSwitchState['sent'],
  slotKey: string,
  entry: { pluginId: string; stateBase64: string | null }
): PluginSwitchState['sent'] {
  return { ...sent, [slotKey]: [...(sent[slotKey] ?? []), entry] }
}

interface Reconciled {
  state: PluginSwitchState
  loads: PluginSlotLoad[]
  unloads: PluginSlotTarget[]
  missing: PluginSlotTarget[]
}

/** Brings the engine from `from` (what it holds) to ctx.chains. A slot is (re)loaded when its
 * plugin changed, when it is in `force`, or when it has saved settings the engine hasn't been sent
 * yet (a project reopened with the same plugin in the same slot). A channel gone from ctx.chains
 * is left alone: the engine drops its chain with the channel. */
function reconcile(
  state: PluginSwitchState,
  from: PluginChains,
  ctx: PluginSwitchContext,
  force: ReadonlySet<string> = new Set()
): Reconciled {
  const loads: PluginSlotLoad[] = []
  const unloads: PluginSlotTarget[] = []
  const missing: PluginSlotTarget[] = []
  const uncataloged = new Set(state.uncataloged)
  let sent = state.sent
  for (const target of slotsOf(ctx.chains)) {
    const slotKey = pluginSlotKey(target)
    const prevId = occupant(from, target)
    const nextId = occupant(ctx.chains, target)
    const changed = prevId !== nextId
    if (nextId === null) {
      uncataloged.delete(slotKey)
      if (changed) {
        unloads.push(target)
        sent = withSent(sent, slotKey, { pluginId: '', stateBase64: null })
      }
      continue
    }
    const stored = stateForSlot(ctx.pending, slotKey, nextId) ?? null
    const queue = sent[slotKey] ?? []
    const last = queue[queue.length - 1]
    const storedNotSent =
      stored !== null &&
      !(last !== undefined && last.pluginId === nextId && last.stateBase64 === stored)
    if (!changed && !force.has(slotKey) && !storedNotSent) continue
    const path = ctx.pathOf(nextId)
    if (path === null) {
      uncataloged.add(slotKey)
      missing.push(target)
      // The engine may still hold the plugin this slot had before.
      if (changed && prevId !== null && !state.uncataloged.includes(slotKey)) {
        unloads.push(target)
        sent = withSent(sent, slotKey, { pluginId: '', stateBase64: null })
      }
      continue
    }
    uncataloged.delete(slotKey)
    loads.push({ slotKey, target, pluginId: nextId, path, stateBase64: stored })
    sent = withSent(sent, slotKey, { pluginId: nextId, stateBase64: stored })
  }
  return {
    state: { ...state, synced: ctx.chains, uncataloged: [...uncataloged], sent },
    loads,
    unloads,
    missing
  }
}

export function pluginSwitchStep(
  state: PluginSwitchState,
  event: PluginSwitchEvent,
  ctx: PluginSwitchContext
): PluginSwitchStep {
  const nothing: PluginSwitchStep = {
    state,
    pending: ctx.pending,
    loads: [],
    unloads: [],
    missing: [],
    capture: false
  }
  switch (event.type) {
    case 'switch': {
      if (event.on) {
        if (state.phase === 'off') {
          const r = reconcile(
            { ...state, phase: 'live', uncataloged: [] },
            EMPTY_PLUGIN_CHAINS,
            ctx
          )
          return { ...nothing, ...r }
        }
        if (state.phase === 'held') {
          // The engine kept them: only what changed meanwhile (another project opened) goes out.
          const r = reconcile({ ...state, phase: 'live' }, state.synced, ctx)
          return { ...nothing, ...r }
        }
        if (state.phase === 'capturing') {
          return { ...nothing, state: { ...state, resumeAfterCapture: true } }
        }
        return nothing
      }
      if (state.phase === 'live') {
        return {
          ...nothing,
          state: { ...state, phase: 'capturing', resumeAfterCapture: false },
          capture: true
        }
      }
      if (state.phase === 'capturing') {
        return { ...nothing, state: { ...state, resumeAfterCapture: false } }
      }
      return nothing
    }

    case 'chains-changed': {
      if (state.phase !== 'live') return nothing
      const r = reconcile(state, state.synced, ctx)
      return { ...nothing, ...r }
    }

    case 'catalog-changed': {
      if (state.phase !== 'live' || state.uncataloged.length === 0) return nothing
      const r = reconcile(state, state.synced, ctx, new Set(state.uncataloged))
      return { ...nothing, ...r }
    }

    case 'capture-done': {
      if (state.phase !== 'capturing') return nothing
      if (state.resumeAfterCapture) {
        // Back on: the engine still holds every plugin with its live settings. Nothing is merged
        // into pending (it would only reload them); only what changed meanwhile goes out.
        const r = reconcile(
          { ...state, phase: 'live', resumeAfterCapture: false },
          state.synced,
          ctx
        )
        return { ...nothing, ...r }
      }
      if (event.raw === null) {
        // Unloading now would lose the live settings: leave them in the engine.
        return { ...nothing, state: { ...state, phase: 'held' } }
      }
      const uncataloged = new Set(state.uncataloged)
      let pending = ctx.pending
      if (!event.projectReplaced) {
        const captured = buildPluginStatesMap(
          event.raw,
          state.synced.masterChain,
          state.synced.channelPlugins
        )
        // An uncataloged slot was never loaded: whatever the engine has there isn't its plugin.
        for (const slotKey of uncataloged) delete captured[slotKey]
        // A slot that came back empty (a load still in flight, say) keeps its saved settings.
        pending = { ...ctx.pending, ...captured }
      }
      const unloads: PluginSlotTarget[] = []
      let sent = state.sent
      for (const target of slotsOf(state.synced)) {
        const slotKey = pluginSlotKey(target)
        if (occupant(state.synced, target) === null || uncataloged.has(slotKey)) continue
        unloads.push(target)
        sent = withSent(sent, slotKey, { pluginId: '', stateBase64: null })
      }
      return {
        ...nothing,
        state: {
          ...state,
          phase: 'off',
          resumeAfterCapture: false,
          synced: EMPTY_PLUGIN_CHAINS,
          uncataloged: [],
          sent
        },
        pending,
        unloads
      }
    }

    case 'load-result': {
      const queue = state.sent[event.slotKey] ?? []
      const head = queue[0]
      if (head === undefined || head.pluginId !== event.pluginId) return nothing
      const rest = queue.slice(1)
      const sent = { ...state.sent }
      if (rest.length === 0) delete sent[event.slotKey]
      else sent[event.slotKey] = rest
      let pending = ctx.pending
      const entry = pending[event.slotKey]
      if (
        event.success &&
        event.pluginId !== '' &&
        rest.length === 0 &&
        entry !== undefined &&
        entry.pluginId === head.pluginId &&
        entry.stateBase64 === head.stateBase64
      ) {
        pending = { ...pending }
        delete pending[event.slotKey]
      }
      return { ...nothing, state: { ...state, sent }, pending }
    }

    case 'engine-restarted':
      return { ...nothing, state: { ...state, sent: {} } }
  }
}
