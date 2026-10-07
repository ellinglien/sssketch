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
//   the capture is in flight waits for it and then keeps the engine's plugins as they are. A
//   capture that failed is retried ('retry-capture', StoreContext's timer).
// - Opening another project (a new `generation`) reloads every occupied slot, even one holding
//   the same plugin, so the old project's settings never carry over, and unloads every slot of
//   the old project the new one leaves out (a channel it has no plugins on); nothing read back
//   from the engine is taken as the new project's until it has (slotsEngineHolds).
// - An engine restart leaves the engine holding nothing: every slot is reloaded, settings already
//   handed over coming from the latest capture (the save's and the autosave's, the `fallback`).
// - A load that fails keeps the slot and its saved settings ('failed', shown on the slot); it is
//   retried after a scan, a restart, or the switch going on, never by every later edit.
// - The engine reports the settings of a plugin it unloads or replaces (`previousState`); they
//   are kept per slot and plugin (`parked`), so undoing a removal brings the plugin back as it was.
//   An undo that lands before that reply waits for it (`awaiting`) rather than loading the plugin
//   at its defaults. A plugin picked fresh (the browser, the slot's menu: withFreshChoice) starts
//   at its defaults instead: parked settings are for an undo only.
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
 * 'held': switched off, but that read failed, so they were left loaded rather than lost (retried). */
export type PluginSwitchPhase = 'off' | 'live' | 'capturing' | 'held'

/** One load (pluginId) or unload (pluginId '') sent to a slot and not answered yet. */
export interface SentEntry {
  pluginId: string
  stateBase64: string | null
  /** What the engine held in that slot when this request reached it (null: nothing). */
  outgoing: string | null
  /** The project generation it was sent for. */
  generation: number
  /** The project generation `outgoing` was loaded for: what the engine reports of it
   * (previousState) is kept for an undo only when that is the current project. */
  outgoingGeneration: number
}

export interface PluginSwitchState {
  phase: PluginSwitchPhase
  /** 'capturing' only: the switch went back on before the capture came back. */
  resumeAfterCapture: boolean
  /** The chains as last reconciled with the engine: what it holds (bar `uncataloged` and
   * `failed`). Empty while 'off'. */
  synced: PluginChains
  /** The project generation `synced` belongs to (@renderer pendingPluginStates' counter). */
  syncedGeneration: number
  /** Occupied slots not loaded because the catalog has no path for their plugin. */
  uncataloged: string[]
  /** Occupied slots whose plugin failed to load (the engine holds nothing there). */
  failed: string[]
  /** Per slot, every load or unload sent and not answered yet, oldest first. The engine answers
   * each, in order (pluginId '' for an unload). */
  sent: Record<string, SentEntry[]>
  /** Per slot, per plugin id: the settings a plugin had when the engine unloaded or replaced it
   * there, for when it comes back (an undo). This project's only. */
  parked: Record<string, Record<string, string>>
  /** The capture in flight (or the last one): an answer to any other is ignored. */
  captureId: number
  /** Per slot: the plugin an undo brought back while the engine had not yet reported the
   * settings it left with (a reply still in flight whose `outgoing` is that plugin). Its load
   * goes out with them once the slot's replies are all in. */
  awaiting: Record<string, string>
  /** Slots whose plugin was just picked fresh (withFreshChoice): their next load starts at the
   * plugin's defaults, never from `parked` and never `awaiting`. */
  fresh: string[]
}

export const EMPTY_PLUGIN_CHAINS: PluginChains = {
  masterChain: [null, null, null, null],
  channelPlugins: {}
}

export const initialPluginSwitchState: PluginSwitchState = {
  phase: 'off',
  resumeAfterCapture: false,
  synced: EMPTY_PLUGIN_CHAINS,
  syncedGeneration: 0,
  uncataloged: [],
  failed: [],
  sent: {},
  parked: {},
  captureId: 0,
  awaiting: {},
  fresh: []
}

export type PluginSwitchEvent =
  /** `on`: the plugins feature is on AND the catalog has been read (a slot's path comes from it). */
  | { type: 'switch'; on: boolean }
  | { type: 'chains-changed' }
  | { type: 'catalog-changed' }
  /** The engine's answer to capture `captureId` (null: it failed or timed out). */
  | { type: 'capture-done'; captureId: number; raw: RawPluginStatesCapture | null }
  /** 'held': ask for the settings again. */
  | { type: 'retry-capture' }
  /** Reload the named slots that are still failed (a load that failed for a passing reason: a
   * channel the engine had not been told about yet). Only those: another slot's plugin may be
   * genuinely broken. */
  | { type: 'retry-failed'; slotKeys: string[] }
  /** A master-/channel-plugin-loaded reply. pluginId '' answers an unload. `previousState`: the
   * settings of what the slot held before (the engine reads them before acting). */
  | {
      type: 'load-result'
      slotKey: string
      pluginId: string
      success: boolean
      previousState?: string
    }
  /** The engine was respawned: it holds nothing, and nothing sent before will be answered.
   * `fallback`: the latest capture of this project's plugin settings (a save's or the
   * autosave's), for slots whose saved settings were already handed over. */
  | { type: 'engine-restarted'; fallback: PluginStatesMap }

export interface PluginSwitchContext {
  /** The project's chains right now. */
  chains: PluginChains
  /** The project's saved plugin settings not yet handed to the engine. */
  pending: PluginStatesMap
  /** A plugin id's file path from the catalog, null when the catalog doesn't list it. */
  pathOf: (pluginId: string) => string | null
  /** Bumped every time a project is opened or a new one started. */
  generation: number
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
  /** Ask the engine for its live plugin settings, then feed back 'capture-done' with
   * state.captureId. */
  capture: boolean
}

export function pluginSlotKey(target: PluginSlotTarget): string {
  return target.kind === 'master'
    ? `master:${target.slot}`
    : `channel:${target.channelId}:${target.slot}`
}

function targetOfSlotKey(slotKey: string): PluginSlotTarget {
  const slot = Number(slotKey.slice(slotKey.lastIndexOf(':') + 1))
  if (slotKey.startsWith('master:')) return { kind: 'master', slot }
  return {
    kind: 'channel',
    channelId: slotKey.slice('channel:'.length, slotKey.lastIndexOf(':')),
    slot
  }
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
  entry: SentEntry
): PluginSwitchState['sent'] {
  return { ...sent, [slotKey]: [...(sent[slotKey] ?? []), entry] }
}

/** What the engine will hold in a slot once everything sent there so far has landed, and the
 * project generation it was loaded for. `syncedId`: the slot's plugin in `state.synced`. */
function engineWillHold(
  state: PluginSwitchState,
  slotKey: string,
  syncedId: string | null,
  sent: PluginSwitchState['sent'] = state.sent
): { pluginId: string | null; generation: number } {
  const queue = sent[slotKey] ?? []
  const last = queue[queue.length - 1]
  if (last !== undefined)
    return { pluginId: last.pluginId === '' ? null : last.pluginId, generation: last.generation }
  const held =
    syncedId !== null && !state.uncataloged.includes(slotKey) && !state.failed.includes(slotKey)
  return { pluginId: held ? syncedId : null, generation: state.syncedGeneration }
}

/** A plugin picked fresh for `slotKey` (the browser, the slot's menu -- not an undo): its next
 * load starts at its defaults, not with settings parked there by an earlier removal. Only the
 * picked plugin's parked settings are dropped (reconcile, when it loads): another plugin removed
 * from that slot keeps its own, for an undo past this pick. */
export function withFreshChoice(state: PluginSwitchState, slotKey: string): PluginSwitchState {
  const awaiting = { ...state.awaiting }
  delete awaiting[slotKey]
  return {
    ...state,
    awaiting,
    fresh: state.fresh.includes(slotKey) ? state.fresh : [...state.fresh, slotKey]
  }
}

/** The slots of `chains` whose plugin the engine has loaded, for this project, with nothing in
 * flight: the only slots where what a capture reads back is the project's own settings. While
 * the switch is off or held, after another project was opened (same plugins or not) and until it
 * is synced, for a slot edited but not synced, a load not answered yet, an uncataloged plugin or
 * a failed load, a save takes the project's saved settings instead. */
export function slotsEngineHolds(
  state: PluginSwitchState,
  chains: PluginChains,
  generation: number
): Set<string> {
  const held = new Set<string>()
  if (state.phase !== 'live' && state.phase !== 'capturing') return held
  if (state.syncedGeneration !== generation) return held
  for (const target of slotsOf(chains)) {
    const slotKey = pluginSlotKey(target)
    const id = occupant(chains, target)
    if (id === null || occupant(state.synced, target) !== id) continue
    if ((state.sent[slotKey] ?? []).length > 0) continue
    if (state.uncataloged.includes(slotKey) || state.failed.includes(slotKey)) continue
    held.add(slotKey)
  }
  return held
}

/** `fallback` entries for slots with no pending entry, whose plugin is still the slot's. */
function withFallback(
  pending: PluginStatesMap,
  fallback: PluginStatesMap,
  chains: PluginChains
): PluginStatesMap {
  const merged: PluginStatesMap = { ...pending }
  for (const target of slotsOf(chains)) {
    const slotKey = pluginSlotKey(target)
    const entry = fallback[slotKey]
    if (merged[slotKey] !== undefined || entry === undefined) continue
    if (entry.pluginId === occupant(chains, target)) merged[slotKey] = entry
  }
  return merged
}

interface Reconciled {
  state: PluginSwitchState
  pending: PluginStatesMap
  loads: PluginSlotLoad[]
  unloads: PluginSlotTarget[]
  missing: PluginSlotTarget[]
}

/** Brings the engine from `from` (what it holds) to ctx.chains. A slot is (re)loaded when its
 * plugin changed, when it is in `force`, when another project was opened since the last sync, or
 * when it has saved settings the engine hasn't been sent yet (a project reopened with the same
 * plugin in the same slot) -- but a failed slot only when changed, forced or reopened. A channel
 * gone from ctx.chains is left alone within a project (the engine drops its chain with the
 * channel); after another project was opened, every slot of `from` it leaves out is unloaded
 * (the new project may have that channel with no plugins on it). */
function reconcile(
  state: PluginSwitchState,
  from: PluginChains,
  ctx: PluginSwitchContext,
  force: ReadonlySet<string> = new Set()
): Reconciled {
  const reopened = state.syncedGeneration !== ctx.generation
  const loads: PluginSlotLoad[] = []
  const unloads: PluginSlotTarget[] = []
  const missing: PluginSlotTarget[] = []
  const uncataloged = new Set(state.uncataloged)
  const failed = new Set(reopened ? [] : state.failed)
  let parked = reopened ? {} : state.parked
  const awaiting = reopened ? {} : { ...state.awaiting }
  const fresh = new Set(reopened ? [] : state.fresh)
  let pending = ctx.pending
  let sent = state.sent
  for (const target of slotsOf(ctx.chains)) {
    const slotKey = pluginSlotKey(target)
    const prevId = occupant(from, target)
    const nextId = occupant(ctx.chains, target)
    const changed = prevId !== nextId
    const queue = sent[slotKey] ?? []
    const last = queue[queue.length - 1]
    // What the engine will hold there once everything sent so far has landed.
    const holds = engineWillHold(state, slotKey, prevId, sent)
    const engineHas = holds.pluginId
    const send = (pluginId: string, stateBase64: string | null): void => {
      sent = withSent(sent, slotKey, {
        pluginId,
        stateBase64,
        outgoing: engineHas,
        generation: ctx.generation,
        outgoingGeneration: holds.generation
      })
    }
    const freshPick = fresh.delete(slotKey)
    if (awaiting[slotKey] !== undefined && awaiting[slotKey] !== nextId) delete awaiting[slotKey]
    if (nextId === null) {
      uncataloged.delete(slotKey)
      failed.delete(slotKey)
      if (changed && engineHas !== null) {
        unloads.push(target)
        send('', null)
      }
      continue
    }
    if (changed) failed.delete(slotKey)
    let stored = stateForSlot(pending, slotKey, nextId) ?? null
    const storedNotSent =
      stored !== null &&
      !(last !== undefined && last.pluginId === nextId && last.stateBase64 === stored)
    if (!changed && !reopened && !force.has(slotKey) && (failed.has(slotKey) || !storedNotSent))
      continue
    const path = ctx.pathOf(nextId)
    if (path === null) {
      uncataloged.add(slotKey)
      missing.push(target)
      delete awaiting[slotKey]
      // The engine may still hold the plugin this slot had before.
      if ((changed || reopened) && engineHas !== null) {
        unloads.push(target)
        send('', null)
      }
      continue
    }
    if (stored === null && freshPick) {
      // Picked fresh: at its defaults, whatever an earlier removal left parked.
      if (parked[slotKey]?.[nextId] !== undefined) {
        const restOfSlot = { ...parked[slotKey] }
        delete restOfSlot[nextId]
        parked = { ...parked, [slotKey]: restOfSlot }
      }
    } else if (stored === null) {
      // Back in a slot it was unloaded from (an undo): with the settings it left with.
      const blob = parked[slotKey]?.[nextId]
      if (blob !== undefined) {
        stored = blob
        pending = { ...pending, [slotKey]: { pluginId: nextId, stateBase64: blob } }
        const restOfSlot = { ...parked[slotKey] }
        delete restOfSlot[nextId]
        parked = { ...parked, [slotKey]: restOfSlot }
      } else if (
        !reopened &&
        queue.some((e) => e.outgoing === nextId && e.outgoingGeneration === ctx.generation)
      ) {
        // An undo that beat the engine's reply: that reply carries the settings it left with.
        // Load it then (load-result), not now at its defaults.
        uncataloged.delete(slotKey)
        awaiting[slotKey] = nextId
        continue
      }
    }
    uncataloged.delete(slotKey)
    failed.delete(slotKey)
    loads.push({ slotKey, target, pluginId: nextId, path, stateBase64: stored })
    send(nextId, stored)
  }
  if (reopened) {
    // The old project's slots the new one leaves out (a channel with no plugins in it).
    const kept = new Set(slotsOf(ctx.chains).map(pluginSlotKey))
    for (const target of slotsOf(from)) {
      const slotKey = pluginSlotKey(target)
      if (kept.has(slotKey)) continue
      uncataloged.delete(slotKey)
      const holds = engineWillHold(state, slotKey, occupant(from, target), sent)
      if (holds.pluginId === null) continue
      unloads.push(target)
      sent = withSent(sent, slotKey, {
        pluginId: '',
        stateBase64: null,
        outgoing: holds.pluginId,
        generation: ctx.generation,
        outgoingGeneration: holds.generation
      })
    }
  }
  return {
    state: {
      ...state,
      synced: ctx.chains,
      syncedGeneration: ctx.generation,
      uncataloged: [...uncataloged],
      failed: [...failed],
      sent,
      parked,
      awaiting,
      fresh: [...fresh]
    },
    pending,
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
            { ...state, phase: 'live', uncataloged: [], failed: [] },
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
          state: {
            ...state,
            phase: 'capturing',
            resumeAfterCapture: false,
            captureId: state.captureId + 1
          },
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
      const retry = [...state.uncataloged, ...state.failed]
      if (state.phase !== 'live' || retry.length === 0) return nothing
      const r = reconcile(state, state.synced, ctx, new Set(retry))
      return { ...nothing, ...r }
    }

    case 'retry-failed': {
      const retry = state.failed.filter((slotKey) => event.slotKeys.includes(slotKey))
      if (state.phase !== 'live' || retry.length === 0) return nothing
      const r = reconcile(state, state.synced, ctx, new Set(retry))
      return { ...nothing, ...r }
    }

    case 'retry-capture': {
      if (state.phase !== 'held') return nothing
      return {
        ...nothing,
        state: {
          ...state,
          phase: 'capturing',
          resumeAfterCapture: false,
          captureId: state.captureId + 1
        },
        capture: true
      }
    }

    case 'capture-done': {
      if (state.phase !== 'capturing' || event.captureId !== state.captureId) return nothing
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
      // Another project opened while it was in flight: what came back is the old one's.
      const projectReplaced = state.syncedGeneration !== ctx.generation
      const skip = new Set([...state.uncataloged, ...state.failed])
      let pending = ctx.pending
      if (!projectReplaced) {
        const captured = buildPluginStatesMap(
          event.raw,
          state.synced.masterChain,
          state.synced.channelPlugins
        )
        // An uncataloged or failed slot was never loaded: whatever the engine has there isn't
        // its plugin.
        for (const slotKey of skip) delete captured[slotKey]
        // A slot that came back empty (a load still in flight, say) keeps its saved settings.
        pending = { ...ctx.pending, ...captured }
      }
      const unloads: PluginSlotTarget[] = []
      let sent = state.sent
      for (const target of slotsOf(state.synced)) {
        const slotKey = pluginSlotKey(target)
        const id = occupant(state.synced, target)
        if (id === null || skip.has(slotKey)) continue
        const holds = engineWillHold(state, slotKey, id)
        unloads.push(target)
        sent = withSent(sent, slotKey, {
          pluginId: '',
          stateBase64: null,
          outgoing: holds.pluginId,
          generation: state.syncedGeneration,
          outgoingGeneration: holds.generation
        })
      }
      return {
        ...nothing,
        state: {
          ...state,
          phase: 'off',
          resumeAfterCapture: false,
          synced: EMPTY_PLUGIN_CHAINS,
          uncataloged: [],
          failed: [],
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
      let sent = { ...state.sent }
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
      let parked = state.parked
      if (
        event.previousState &&
        head.outgoing !== null &&
        head.outgoing !== head.pluginId &&
        head.outgoingGeneration === ctx.generation &&
        state.syncedGeneration === ctx.generation
      ) {
        parked = {
          ...parked,
          [event.slotKey]: { ...parked[event.slotKey], [head.outgoing]: event.previousState }
        }
      }
      let failed = state.failed
      const unloads: PluginSlotTarget[] = []
      if (event.pluginId !== '' && rest.length === 0) {
        if (event.success) {
          failed = failed.filter((k) => k !== event.slotKey)
        } else if (state.phase === 'live' && !failed.includes(event.slotKey)) {
          // The slot keeps its plugin and saved settings, marked failed. The engine left the slot
          // as it was: empty it, so what plays matches the slot.
          failed = [...failed, event.slotKey]
          if (head.outgoing !== null) {
            unloads.push(targetOfSlotKey(event.slotKey))
            sent = withSent(sent, event.slotKey, {
              pluginId: '',
              stateBase64: null,
              outgoing: head.outgoing,
              generation: head.generation,
              outgoingGeneration: head.outgoingGeneration
            })
          }
        }
      }
      // An undo waiting on this slot's replies (awaiting): they are all in, so the settings the
      // plugin left with are parked (or never came). Load it with them -- or, switched off
      // meanwhile, keep them as saved settings.
      let awaiting = state.awaiting
      const loads: PluginSlotLoad[] = []
      const missing: PluginSlotTarget[] = []
      let uncataloged = state.uncataloged
      const waiting = awaiting[event.slotKey]
      if (waiting !== undefined && (sent[event.slotKey] ?? []).length === 0) {
        awaiting = { ...awaiting }
        delete awaiting[event.slotKey]
        const target = targetOfSlotKey(event.slotKey)
        const blob = parked[event.slotKey]?.[waiting]
        if (blob !== undefined) {
          const restOfSlot = { ...parked[event.slotKey] }
          delete restOfSlot[waiting]
          parked = { ...parked, [event.slotKey]: restOfSlot }
        }
        const stillThere =
          state.syncedGeneration === ctx.generation && occupant(ctx.chains, target) === waiting
        if (stillThere && blob !== undefined)
          pending = { ...pending, [event.slotKey]: { pluginId: waiting, stateBase64: blob } }
        const path = ctx.pathOf(waiting)
        if (stillThere && state.phase === 'live' && path === null) {
          uncataloged = [...uncataloged, event.slotKey]
          missing.push(target)
        } else if (stillThere && state.phase === 'live' && path !== null) {
          const stateBase64 = blob ?? null
          loads.push({ slotKey: event.slotKey, target, pluginId: waiting, path, stateBase64 })
          // The engine holds what this reply left there: the answered request's plugin, or, for a
          // failed load, what it held before.
          const nowHeld = event.success ? event.pluginId || null : head.outgoing
          const nowHeldGeneration = event.success ? head.generation : head.outgoingGeneration
          sent = withSent(sent, event.slotKey, {
            pluginId: waiting,
            stateBase64,
            outgoing: nowHeld,
            generation: ctx.generation,
            outgoingGeneration: nowHeldGeneration
          })
        }
      }
      return {
        ...nothing,
        state: { ...state, sent, parked, failed, awaiting, uncataloged },
        pending,
        unloads,
        loads,
        missing
      }
    }

    case 'engine-restarted': {
      // The new engine holds nothing. Settings already handed over come back from the fallback;
      // any capture sent to the old engine is not waited on.
      const pending = withFallback(ctx.pending, event.fallback, ctx.chains)
      const base: PluginSwitchState = {
        ...state,
        sent: {},
        uncataloged: [],
        failed: [],
        awaiting: {},
        captureId: state.captureId + 1
      }
      const reload =
        state.phase === 'live' || (state.phase === 'capturing' && state.resumeAfterCapture)
      if (reload) {
        const r = reconcile(
          { ...base, phase: 'live', resumeAfterCapture: false, synced: EMPTY_PLUGIN_CHAINS },
          EMPTY_PLUGIN_CHAINS,
          { ...ctx, pending }
        )
        return { ...nothing, ...r }
      }
      return {
        ...nothing,
        state: { ...base, phase: 'off', resumeAfterCapture: false, synced: EMPTY_PLUGIN_CHAINS },
        pending
      }
    }
  }
}

/** How long 'held' (a switch-off whose capture failed, the plugins left loaded) waits before its
 * `attempt`th retry-capture (0 first): 5 s, doubling, at most a minute; null after six tries, when
 * it stops asking and the UI says the plugins are still loaded. */
export function heldRetryDelayMs(attempt: number): number | null {
  if (attempt >= 6) return null
  return Math.min(5000 * 2 ** attempt, 60_000)
}

/** How long a slot whose channel plugin load failed with "unknown channel" (its load reached the
 * engine before the project that creates the channel) waits before its `attempt`th retry (0
 * first), per slot and per project: a second more each time, five times; null after. */
export function unknownChannelRetryDelayMs(attempt: number): number | null {
  if (attempt >= 5) return null
  return 1000 * (attempt + 1)
}
