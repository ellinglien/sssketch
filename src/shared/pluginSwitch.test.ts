import { describe, expect, it } from 'vitest'
import {
  initialPluginSwitchState,
  pluginSwitchStep,
  slotsEngineHolds,
  withFreshChoice,
  heldRetryDelayMs,
  unknownChannelRetryDelayMs,
  type PluginChains,
  type PluginSwitchContext,
  type PluginSwitchEvent,
  type PluginSwitchState,
  type PluginSwitchStep
} from './pluginSwitch'
import type { PluginStatesMap, RawPluginStatesCapture } from './pluginStates'

const CATALOG: Record<string, string> = {
  verb: '/Library/Audio/Plug-Ins/VST3/Verb.vst3',
  comp: '/Library/Audio/Plug-Ins/VST3/Comp.vst3',
  delay: '/Library/Audio/Plug-Ins/VST3/Delay.vst3'
}

function ctx(
  chains: PluginChains,
  pending: PluginStatesMap,
  catalog: Record<string, string> = CATALOG,
  generation = 0
): PluginSwitchContext {
  return { chains, pending, pathOf: (id) => catalog[id] ?? null, generation }
}

/** A capture-done answering the capture in flight (run() fills in its id). */
type TestEvent =
  | PluginSwitchEvent
  | { type: 'capture-done'; raw: RawPluginStatesCapture | null; captureId?: number }

function withCaptureId(event: TestEvent, state: PluginSwitchState): PluginSwitchEvent {
  if (event.type === 'capture-done' && event.captureId === undefined)
    return { ...event, captureId: state.captureId }
  return event as PluginSwitchEvent
}

const project: PluginChains = {
  masterChain: ['verb', null, 'comp', null],
  channelPlugins: { ch1: ['delay', null] }
}
const saved: PluginStatesMap = {
  'master:0': { pluginId: 'verb', stateBase64: 'VERB' },
  'master:2': { pluginId: 'comp', stateBase64: 'COMP' },
  'channel:ch1:0': { pluginId: 'delay', stateBase64: 'DELAY' }
}

/** Feeds events in order, threading the state and the pending map through, the way StoreContext
 * does; returns every step so a test can look at any of them. */
function run(
  events: TestEvent[],
  chains: PluginChains,
  pending: PluginStatesMap,
  catalog: Record<string, string> = CATALOG,
  start: PluginSwitchState = initialPluginSwitchState,
  generation = 0
): PluginSwitchStep[] {
  const steps: PluginSwitchStep[] = []
  let state = start
  let p = pending
  for (const event of events) {
    const step = pluginSwitchStep(
      state,
      withCaptureId(event, state),
      ctx(chains, p, catalog, generation)
    )
    steps.push(step)
    state = step.state
    p = step.pending
  }
  return steps
}

const liveCapture: RawPluginStatesCapture = {
  masterChain: ['VERB2', '', 'COMP2', ''],
  channelChains: [{ channelId: 'ch1', slots: ['DELAY2', ''] }]
}

describe('pluginSwitchStep: turning on', () => {
  it('loads every occupied slot with its saved settings, and keeps those settings until the load succeeds', () => {
    const [step] = run([{ type: 'switch', on: true }], project, saved)
    expect(step.state.phase).toBe('live')
    expect(step.loads).toEqual([
      {
        slotKey: 'master:0',
        target: { kind: 'master', slot: 0 },
        pluginId: 'verb',
        path: CATALOG.verb,
        stateBase64: 'VERB'
      },
      {
        slotKey: 'master:2',
        target: { kind: 'master', slot: 2 },
        pluginId: 'comp',
        path: CATALOG.comp,
        stateBase64: 'COMP'
      },
      {
        slotKey: 'channel:ch1:0',
        target: { kind: 'channel', channelId: 'ch1', slot: 0 },
        pluginId: 'delay',
        path: CATALOG.delay,
        stateBase64: 'DELAY'
      }
    ])
    expect(step.unloads).toEqual([])
    expect(step.pending).toEqual(saved)
  })

  it('never sends a load for a plugin the catalog has no path for, and keeps its saved settings', () => {
    const catalog = { comp: CATALOG.comp } // verb and delay not scanned (or the switch was off, empty catalog)
    const [step] = run([{ type: 'switch', on: true }], project, saved, catalog)
    expect(step.loads.map((l) => l.slotKey)).toEqual(['master:2'])
    expect(step.loads.every((l) => l.path !== '')).toBe(true)
    expect(step.unloads).toEqual([]) // the engine holds nothing in those slots
    expect(step.state.uncataloged.sort()).toEqual(['channel:ch1:0', 'master:0'])
    expect(step.missing).toEqual([
      { kind: 'master', slot: 0 },
      { kind: 'channel', channelId: 'ch1', slot: 0 }
    ])
    expect(step.pending).toEqual(saved)
  })

  it('a successful load drops that slot`s saved settings; a failed one, or an unload`s reply, keeps them', () => {
    const steps = run(
      [
        { type: 'switch', on: true },
        { type: 'load-result', slotKey: 'master:0', pluginId: 'verb', success: true },
        { type: 'load-result', slotKey: 'master:2', pluginId: 'comp', success: false },
        { type: 'load-result', slotKey: 'channel:ch1:0', pluginId: '', success: true }
      ],
      project,
      saved
    )
    expect(steps[3].pending).toEqual({
      'master:2': saved['master:2'],
      'channel:ch1:0': saved['channel:ch1:0']
    })
  })

  it('does nothing while the switch is off', () => {
    const [step] = run([{ type: 'switch', on: false }], project, saved)
    expect(step.state.phase).toBe('off')
    expect(step.loads).toEqual([])
    expect(step.capture).toBe(false)
  })
})

describe('pluginSwitchStep: the catalog arriving later', () => {
  it('loads an uncataloged slot, with its saved settings, once a scan finds it', () => {
    const steps = run(
      [{ type: 'switch', on: true }],
      project,
      saved,
      {} // nothing scanned yet
    )
    expect(steps[0].loads).toEqual([])
    const after = pluginSwitchStep(
      steps[0].state,
      { type: 'catalog-changed' },
      ctx(project, steps[0].pending)
    )
    expect(after.loads.map((l) => [l.slotKey, l.stateBase64])).toEqual([
      ['master:0', 'VERB'],
      ['master:2', 'COMP'],
      ['channel:ch1:0', 'DELAY']
    ])
    expect(after.state.uncataloged).toEqual([])
    expect(after.pending).toEqual(saved)
  })

  it('leaves a slot uncataloged while the new catalog still lacks it, and loads nothing twice', () => {
    const [on] = run([{ type: 'switch', on: true }], project, saved, { comp: CATALOG.comp })
    const partial = pluginSwitchStep(
      on.state,
      { type: 'catalog-changed' },
      ctx(project, on.pending, { comp: CATALOG.comp, verb: CATALOG.verb })
    )
    expect(partial.loads.map((l) => l.slotKey)).toEqual(['master:0'])
    expect(partial.state.uncataloged).toEqual(['channel:ch1:0'])
  })

  it('is ignored while off', () => {
    const step = pluginSwitchStep(
      initialPluginSwitchState,
      { type: 'catalog-changed' },
      ctx(project, saved)
    )
    expect(step.loads).toEqual([])
  })
})

describe('pluginSwitchStep: turning off', () => {
  it('captures first, then unloads the engine`s slots and keeps the captured settings', () => {
    const steps = run(
      [
        { type: 'switch', on: true },
        { type: 'load-result', slotKey: 'master:0', pluginId: 'verb', success: true },
        { type: 'load-result', slotKey: 'master:2', pluginId: 'comp', success: true },
        { type: 'load-result', slotKey: 'channel:ch1:0', pluginId: 'delay', success: true },
        { type: 'switch', on: false }
      ],
      project,
      saved
    )
    const off = steps[4]
    expect(off.capture).toBe(true)
    expect(off.unloads).toEqual([]) // not before the capture is back
    expect(off.state.phase).toBe('capturing')
    expect(off.pending).toEqual({})

    const done = pluginSwitchStep(
      off.state,
      { type: 'capture-done', raw: liveCapture, captureId: off.state.captureId },
      ctx(project, off.pending)
    )
    expect(done.state.phase).toBe('off')
    expect(done.unloads).toEqual([
      { kind: 'master', slot: 0 },
      { kind: 'master', slot: 2 },
      { kind: 'channel', channelId: 'ch1', slot: 0 }
    ])
    expect(done.pending).toEqual({
      'master:0': { pluginId: 'verb', stateBase64: 'VERB2' },
      'master:2': { pluginId: 'comp', stateBase64: 'COMP2' },
      'channel:ch1:0': { pluginId: 'delay', stateBase64: 'DELAY2' }
    })
  })

  it('a null capture unloads nothing and keeps the saved settings; turning back on loads nothing (the engine still has them)', () => {
    const steps = run(
      [
        { type: 'switch', on: true },
        { type: 'load-result', slotKey: 'master:0', pluginId: 'verb', success: true },
        { type: 'switch', on: false },
        { type: 'capture-done', raw: null },
        { type: 'switch', on: true }
      ],
      project,
      saved
    )
    const failed = steps[3]
    expect(failed.unloads).toEqual([])
    expect(failed.state.phase).toBe('held')
    expect(failed.pending).toEqual({
      'master:2': saved['master:2'],
      'channel:ch1:0': saved['channel:ch1:0']
    })
    const backOn = steps[4]
    expect(backOn.state.phase).toBe('live')
    expect(backOn.loads).toEqual([])
    expect(backOn.unloads).toEqual([])
  })

  it('a capture that came back empty for a slot whose load was still in flight keeps that slot`s saved settings', () => {
    const steps = run(
      [
        { type: 'switch', on: true },
        { type: 'switch', on: false },
        {
          type: 'capture-done',
          raw: { masterChain: ['', '', 'COMP2', ''], channelChains: [] }
        }
      ],
      project,
      saved
    )
    expect(steps[2].pending).toEqual({
      'master:0': saved['master:0'],
      'master:2': { pluginId: 'comp', stateBase64: 'COMP2' },
      'channel:ch1:0': saved['channel:ch1:0']
    })
    // The late reply of that load must not drop the settings now that the switch is off.
    const late = pluginSwitchStep(
      steps[2].state,
      { type: 'load-result', slotKey: 'master:0', pluginId: 'verb', success: true },
      ctx(project, steps[2].pending)
    )
    expect(late.pending['master:0']).toEqual(saved['master:0'])
  })

  it('does not unload uncataloged slots (the engine never had them)', () => {
    const steps = run(
      [
        { type: 'switch', on: true },
        { type: 'switch', on: false },
        { type: 'capture-done', raw: liveCapture }
      ],
      project,
      saved,
      { comp: CATALOG.comp }
    )
    expect(steps[2].unloads).toEqual([{ kind: 'master', slot: 2 }])
    // ...and their saved settings survive (the capture had nothing real for them to override,
    // the engine never loaded them).
    expect(steps[2].pending['master:0']).toEqual(saved['master:0'])
  })

  it('drops the capture when another project was opened while it was in flight', () => {
    const steps = run(
      [
        { type: 'switch', on: true },
        { type: 'switch', on: false }
      ],
      project,
      saved
    )
    // Same chains, but a newer project generation: what came back is the old project's.
    const done = pluginSwitchStep(
      steps[1].state,
      { type: 'capture-done', raw: liveCapture, captureId: steps[1].state.captureId },
      ctx(project, saved, CATALOG, 1)
    )
    expect(done.pending).toEqual(saved)
    expect(done.unloads.length).toBe(3)
  })
})

describe('pluginSwitchStep: off and quickly on again', () => {
  it('turning on while the capture is in flight waits for it, then keeps the engine`s plugins as they are', () => {
    const steps = run(
      [
        { type: 'switch', on: true },
        { type: 'load-result', slotKey: 'master:0', pluginId: 'verb', success: true },
        { type: 'load-result', slotKey: 'master:2', pluginId: 'comp', success: true },
        { type: 'load-result', slotKey: 'channel:ch1:0', pluginId: 'delay', success: true },
        { type: 'switch', on: false },
        { type: 'switch', on: true },
        { type: 'capture-done', raw: liveCapture }
      ],
      project,
      saved
    )
    const backOn = steps[5]
    expect(backOn.loads).toEqual([]) // no reload at the old saved (or default) settings
    expect(backOn.state.phase).toBe('capturing')
    const done = steps[6]
    expect(done.state.phase).toBe('live')
    expect(done.unloads).toEqual([])
    expect(done.loads).toEqual([])
    // Nothing pending: the engine still holds every slot's live settings.
    expect(done.pending).toEqual({})
  })

  it('off, on, off again before the capture is back still ends off, unloaded', () => {
    const steps = run(
      [
        { type: 'switch', on: true },
        { type: 'switch', on: false },
        { type: 'switch', on: true },
        { type: 'switch', on: false },
        { type: 'capture-done', raw: liveCapture }
      ],
      project,
      saved
    )
    expect(steps[3].capture).toBe(false) // one capture is already on its way
    expect(steps[4].state.phase).toBe('off')
    expect(steps[4].unloads.length).toBe(3)
  })

  it('a project opened while the capture was in flight is loaded once the switch is back on', () => {
    const other: PluginChains = { masterChain: ['delay', null, null, null], channelPlugins: {} }
    const otherSaved: PluginStatesMap = { 'master:0': { pluginId: 'delay', stateBase64: 'D' } }
    const first = run(
      [
        { type: 'switch', on: true },
        { type: 'switch', on: false },
        { type: 'switch', on: true }
      ],
      project,
      saved
    )
    const done = pluginSwitchStep(
      first[2].state,
      { type: 'capture-done', raw: liveCapture, captureId: first[2].state.captureId },
      ctx(other, otherSaved, CATALOG, 1)
    )
    expect(done.state.phase).toBe('live')
    expect(done.loads.map((l) => [l.slotKey, l.pluginId, l.stateBase64])).toEqual([
      ['master:0', 'delay', 'D']
    ])
    // And the old project's channel plugin, on a channel the other project has none on.
    expect(done.unloads).toEqual([
      { kind: 'master', slot: 2 },
      { kind: 'channel', channelId: 'ch1', slot: 0 }
    ])
    expect(done.pending).toEqual(otherSaved)
  })
})

describe('pluginSwitchStep: chain edits', () => {
  /** Live, with every load the switch sent answered. */
  function liveOn(chains: PluginChains, pending: PluginStatesMap): PluginSwitchStep {
    const [on] = run([{ type: 'switch', on: true }], chains, pending)
    let step = on
    for (const load of on.loads) {
      step = pluginSwitchStep(
        step.state,
        { type: 'load-result', slotKey: load.slotKey, pluginId: load.pluginId, success: true },
        ctx(chains, step.pending)
      )
    }
    return step
  }

  it('loads a newly picked plugin and unloads a cleared slot', () => {
    const on = liveOn(project, saved)
    const edited: PluginChains = {
      masterChain: [null, 'delay', 'comp', null],
      channelPlugins: { ch1: ['delay', null] }
    }
    const step = pluginSwitchStep(on.state, { type: 'chains-changed' }, ctx(edited, on.pending))
    expect(step.unloads).toEqual([{ kind: 'master', slot: 0 }])
    expect(step.loads.map((l) => [l.slotKey, l.pluginId, l.stateBase64])).toEqual([
      ['master:1', 'delay', null]
    ])
  })

  it('an uncataloged replacement unloads the old plugin and sends no load', () => {
    const on = liveOn(project, saved)
    const edited: PluginChains = {
      masterChain: ['ghost', null, 'comp', null],
      channelPlugins: { ch1: ['delay', null] }
    }
    const step = pluginSwitchStep(on.state, { type: 'chains-changed' }, ctx(edited, on.pending))
    expect(step.loads).toEqual([])
    expect(step.unloads).toEqual([{ kind: 'master', slot: 0 }])
    expect(step.state.uncataloged).toEqual(['master:0'])
  })

  it('reloads an unchanged slot to hand it a newly opened project`s settings -- once', () => {
    const on = liveOn(project, saved)
    const reopened: PluginStatesMap = { 'master:0': { pluginId: 'verb', stateBase64: 'OTHER' } }
    const first = pluginSwitchStep(on.state, { type: 'chains-changed' }, ctx(project, reopened))
    expect(first.loads.map((l) => [l.slotKey, l.stateBase64])).toEqual([['master:0', 'OTHER']])
    // Another edit before that load is answered must not send it again.
    const again = pluginSwitchStep(
      first.state,
      { type: 'chains-changed' },
      ctx(project, first.pending)
    )
    expect(again.loads).toEqual([])
  })

  it('a reply for an older load of the same slot does not drop the newer load`s settings', () => {
    const on = liveOn(project, {})
    const s1: PluginStatesMap = { 'master:0': { pluginId: 'verb', stateBase64: 'ONE' } }
    const first = pluginSwitchStep(on.state, { type: 'chains-changed' }, ctx(project, s1))
    const s2: PluginStatesMap = { 'master:0': { pluginId: 'verb', stateBase64: 'TWO' } }
    const second = pluginSwitchStep(first.state, { type: 'chains-changed' }, ctx(project, s2))
    expect(second.loads.map((l) => l.stateBase64)).toEqual(['TWO'])
    const reply1 = pluginSwitchStep(
      second.state,
      { type: 'load-result', slotKey: 'master:0', pluginId: 'verb', success: true },
      ctx(project, second.pending)
    )
    expect(reply1.pending).toEqual(s2)
    const reply2 = pluginSwitchStep(
      reply1.state,
      { type: 'load-result', slotKey: 'master:0', pluginId: 'verb', success: true },
      ctx(project, reply1.pending)
    )
    expect(reply2.pending).toEqual({})
  })

  it('are ignored while off', () => {
    const step = pluginSwitchStep(
      initialPluginSwitchState,
      { type: 'chains-changed' },
      ctx(project, saved)
    )
    expect(step.loads).toEqual([])
    expect(step.unloads).toEqual([])
  })
})

/** Live, with every load the switch sent answered (the engine holds every slot). */
function allLoaded(
  chains: PluginChains,
  pending: PluginStatesMap,
  generation = 0
): PluginSwitchStep {
  const [on] = run([{ type: 'switch', on: true }], chains, pending, CATALOG, undefined, generation)
  let step = on
  for (const load of on.loads) {
    step = pluginSwitchStep(
      step.state,
      { type: 'load-result', slotKey: load.slotKey, pluginId: load.pluginId, success: true },
      ctx(chains, step.pending, CATALOG, generation)
    )
  }
  return step
}

const fallback: PluginStatesMap = {
  'master:0': { pluginId: 'verb', stateBase64: 'VERB-LATEST' },
  'master:2': { pluginId: 'comp', stateBase64: 'COMP-LATEST' },
  'channel:ch1:0': { pluginId: 'delay', stateBase64: 'DELAY-LATEST' }
}

describe('pluginSwitchStep: the engine restarting', () => {
  it('forgets what was sent, so its answers can never come and nothing waits on them', () => {
    const [on] = run([{ type: 'switch', on: true }], project, saved)
    expect(Object.keys(on.state.sent).length).toBe(3)
    const restarted = pluginSwitchStep(
      on.state,
      { type: 'engine-restarted', fallback: {} },
      ctx(project, on.pending)
    )
    // Only the reloads it sent itself are waited on.
    expect(restarted.loads.length).toBe(3)
    expect(Object.values(restarted.state.sent).every((q) => q.length === 1)).toBe(true)
    expect(restarted.pending).toEqual(saved)
  })

  it('reloads every slot while live, with the latest capture for settings already handed over', () => {
    const live = allLoaded(project, saved)
    expect(live.pending).toEqual({}) // dropped on each successful load
    const restarted = pluginSwitchStep(
      live.state,
      { type: 'engine-restarted', fallback },
      ctx(project, live.pending)
    )
    expect(restarted.state.phase).toBe('live')
    expect(restarted.unloads).toEqual([])
    expect(restarted.loads.map((l) => [l.slotKey, l.pluginId, l.stateBase64])).toEqual([
      ['master:0', 'verb', 'VERB-LATEST'],
      ['master:2', 'comp', 'COMP-LATEST'],
      ['channel:ch1:0', 'delay', 'DELAY-LATEST']
    ])
    // A save before those loads land still has them.
    expect(restarted.pending).toEqual(fallback)
  })

  it('prefers settings the engine was never handed over the fallback', () => {
    const [on] = run([{ type: 'switch', on: true }], project, saved) // nothing answered yet
    const restarted = pluginSwitchStep(
      on.state,
      { type: 'engine-restarted', fallback },
      ctx(project, on.pending)
    )
    expect(restarted.loads.map((l) => l.stateBase64)).toEqual(['VERB', 'COMP', 'DELAY'])
    expect(restarted.pending).toEqual(saved)
  })

  it('ignores a fallback entry for a plugin no longer in that slot', () => {
    const live = allLoaded(project, saved)
    const restarted = pluginSwitchStep(
      live.state,
      {
        type: 'engine-restarted',
        fallback: { 'master:0': { pluginId: 'delay', stateBase64: 'WRONG' } }
      },
      ctx(project, live.pending)
    )
    expect(restarted.loads.find((l) => l.slotKey === 'master:0')?.stateBase64).toBeNull()
    expect(restarted.pending).toEqual({})
  })

  it('mid off-capture: ends off with nothing to unload, keeps the fallback, and the dead capture never makes it held', () => {
    const live = allLoaded(project, saved)
    const off = pluginSwitchStep(live.state, { type: 'switch', on: false }, ctx(project, {}))
    expect(off.capture).toBe(true)
    const restarted = pluginSwitchStep(
      off.state,
      { type: 'engine-restarted', fallback },
      ctx(project, off.pending)
    )
    expect(restarted.state.phase).toBe('off')
    expect(restarted.unloads).toEqual([])
    expect(restarted.loads).toEqual([])
    expect(restarted.pending).toEqual(fallback)
    // The capture sent to the old engine times out afterwards.
    const timedOut = pluginSwitchStep(
      restarted.state,
      { type: 'capture-done', raw: null, captureId: off.state.captureId },
      ctx(project, restarted.pending)
    )
    expect(timedOut.state.phase).toBe('off')
    // Back on later: everything loads with the recovered settings.
    const backOn = pluginSwitchStep(
      timedOut.state,
      { type: 'switch', on: true },
      ctx(project, timedOut.pending)
    )
    expect(backOn.loads.map((l) => l.stateBase64)).toEqual([
      'VERB-LATEST',
      'COMP-LATEST',
      'DELAY-LATEST'
    ])
  })

  it('mid off-capture with the switch already back on: reloads everything', () => {
    const live = allLoaded(project, saved)
    const off = pluginSwitchStep(live.state, { type: 'switch', on: false }, ctx(project, {}))
    const on = pluginSwitchStep(off.state, { type: 'switch', on: true }, ctx(project, {}))
    const restarted = pluginSwitchStep(
      on.state,
      { type: 'engine-restarted', fallback },
      ctx(project, on.pending)
    )
    expect(restarted.state.phase).toBe('live')
    expect(restarted.loads.length).toBe(3)
  })

  it('held: the engine no longer holds them, so it is off, with the fallback kept', () => {
    const live = allLoaded(project, saved)
    const steps = run(
      [
        { type: 'switch', on: false },
        { type: 'capture-done', raw: null }
      ],
      project,
      live.pending,
      CATALOG,
      live.state
    )
    expect(steps[1].state.phase).toBe('held')
    const restarted = pluginSwitchStep(
      steps[1].state,
      { type: 'engine-restarted', fallback },
      ctx(project, steps[1].pending)
    )
    expect(restarted.state.phase).toBe('off')
    expect(restarted.unloads).toEqual([])
    expect(restarted.pending).toEqual(fallback)
  })
})

describe('pluginSwitchStep: held retries', () => {
  it('retry-capture asks again; an answer to the failed capture is ignored', () => {
    const live = allLoaded(project, saved)
    const steps = run(
      [
        { type: 'switch', on: false },
        { type: 'capture-done', raw: null }
      ],
      project,
      live.pending,
      CATALOG,
      live.state
    )
    const firstId = steps[0].state.captureId
    const retry = pluginSwitchStep(
      steps[1].state,
      { type: 'retry-capture' },
      ctx(project, steps[1].pending)
    )
    expect(retry.capture).toBe(true)
    expect(retry.state.phase).toBe('capturing')
    expect(retry.state.captureId).not.toBe(firstId)
    const stale = pluginSwitchStep(
      retry.state,
      { type: 'capture-done', raw: liveCapture, captureId: firstId },
      ctx(project, retry.pending)
    )
    expect(stale.state.phase).toBe('capturing')
    const done = pluginSwitchStep(
      retry.state,
      { type: 'capture-done', raw: liveCapture, captureId: retry.state.captureId },
      ctx(project, retry.pending)
    )
    expect(done.state.phase).toBe('off')
    expect(done.unloads.length).toBe(3)
    expect(done.pending['master:0']).toEqual({ pluginId: 'verb', stateBase64: 'VERB2' })
  })

  it('is ignored unless held', () => {
    const live = allLoaded(project, saved)
    const step = pluginSwitchStep(live.state, { type: 'retry-capture' }, ctx(project, {}))
    expect(step.capture).toBe(false)
    expect(step.state.phase).toBe('live')
  })
})

describe('slotsEngineHolds', () => {
  it('lists every occupied slot whose plugin the engine has loaded for this project', () => {
    const live = allLoaded(project, saved)
    expect([...slotsEngineHolds(live.state, project, 0)].sort()).toEqual([
      'channel:ch1:0',
      'master:0',
      'master:2'
    ])
  })

  it('leaves out a slot whose load is still in flight', () => {
    const [on] = run([{ type: 'switch', on: true }], project, saved)
    const step = pluginSwitchStep(
      on.state,
      { type: 'load-result', slotKey: 'master:0', pluginId: 'verb', success: true },
      ctx(project, on.pending)
    )
    expect([...slotsEngineHolds(step.state, project, 0)]).toEqual(['master:0'])
  })

  it('is empty while off or held, and while a project opened since the last sync is not yet loaded', () => {
    const live = allLoaded(project, saved)
    expect(slotsEngineHolds(initialPluginSwitchState, project, 0).size).toBe(0)
    const steps = run(
      [
        { type: 'switch', on: false },
        { type: 'capture-done', raw: null }
      ],
      project,
      live.pending,
      CATALOG,
      live.state
    )
    // Capturing (unloading): it still holds them.
    expect(slotsEngineHolds(steps[0].state, project, 0).size).toBe(3)
    // ...unless another project (same plugins, same slots) was opened meanwhile.
    expect(slotsEngineHolds(steps[0].state, project, 1).size).toBe(0)
    // Held: the switch is off; a save must not take the engine's word for this project.
    expect(slotsEngineHolds(steps[1].state, project, 0).size).toBe(0)
  })

  it('leaves out a slot edited but not yet synced, an uncataloged one and a failed one', () => {
    const live = allLoaded(project, saved)
    const edited: PluginChains = { ...project, masterChain: ['comp', null, 'comp', null] }
    expect(slotsEngineHolds(live.state, edited, 0).has('master:0')).toBe(false)

    const [partial] = run([{ type: 'switch', on: true }], project, saved, { comp: CATALOG.comp })
    const answered = pluginSwitchStep(
      partial.state,
      { type: 'load-result', slotKey: 'master:2', pluginId: 'comp', success: true },
      ctx(project, partial.pending, { comp: CATALOG.comp })
    )
    expect([...slotsEngineHolds(answered.state, project, 0)]).toEqual(['master:2'])

    const failed = pluginSwitchStep(
      answered.state,
      { type: 'load-result', slotKey: 'master:2', pluginId: 'comp', success: false },
      ctx(project, answered.pending, { comp: CATALOG.comp })
    )
    // (that reply matches nothing in flight, so it changes nothing)
    expect(failed.state).toEqual(answered.state)
  })
})

describe('pluginSwitchStep: opening another project', () => {
  it('reloads every occupied slot, even with the same plugin, so the old project`s settings never carry over', () => {
    const live = allLoaded(project, saved)
    const step = pluginSwitchStep(
      live.state,
      { type: 'chains-changed' },
      ctx(project, {}, CATALOG, 1)
    )
    expect(step.loads.map((l) => [l.slotKey, l.stateBase64])).toEqual([
      ['master:0', null],
      ['master:2', null],
      ['channel:ch1:0', null]
    ])
    expect(slotsEngineHolds(step.state, project, 1).size).toBe(0) // until answered
  })
})

describe('pluginSwitchStep: undo after removing or replacing a plugin', () => {
  it('a removed plugin comes back with the settings it had when it went', () => {
    const live = allLoaded(project, saved)
    const removed: PluginChains = { ...project, masterChain: [null, null, 'comp', null] }
    const rm = pluginSwitchStep(live.state, { type: 'chains-changed' }, ctx(removed, {}))
    expect(rm.unloads).toEqual([{ kind: 'master', slot: 0 }])
    const answered = pluginSwitchStep(
      rm.state,
      {
        type: 'load-result',
        slotKey: 'master:0',
        pluginId: '',
        success: true,
        previousState: 'VERB-TWEAKED'
      },
      ctx(removed, rm.pending)
    )
    // Not written to a save while the slot is empty.
    expect(answered.pending).toEqual({})
    const undone = pluginSwitchStep(
      answered.state,
      { type: 'chains-changed' },
      ctx(project, answered.pending)
    )
    expect(undone.loads.map((l) => [l.slotKey, l.pluginId, l.stateBase64])).toEqual([
      ['master:0', 'verb', 'VERB-TWEAKED']
    ])
    // Kept until that load lands, like any saved settings.
    expect(undone.pending['master:0']).toEqual({ pluginId: 'verb', stateBase64: 'VERB-TWEAKED' })
  })

  it('a replaced plugin comes back with its settings too', () => {
    const live = allLoaded(project, saved)
    const replaced: PluginChains = { ...project, masterChain: ['delay', null, 'comp', null] }
    const rp = pluginSwitchStep(live.state, { type: 'chains-changed' }, ctx(replaced, {}))
    const answered = pluginSwitchStep(
      rp.state,
      {
        type: 'load-result',
        slotKey: 'master:0',
        pluginId: 'delay',
        success: true,
        previousState: 'VERB-TWEAKED'
      },
      ctx(replaced, rp.pending)
    )
    const undone = pluginSwitchStep(
      answered.state,
      { type: 'chains-changed' },
      ctx(project, answered.pending)
    )
    expect(undone.loads.map((l) => [l.pluginId, l.stateBase64])).toEqual([['verb', 'VERB-TWEAKED']])
  })

  it('never carries a plugin`s settings into another project', () => {
    const live = allLoaded(project, saved)
    const removed: PluginChains = { ...project, masterChain: [null, null, 'comp', null] }
    const rm = pluginSwitchStep(live.state, { type: 'chains-changed' }, ctx(removed, {}))
    // Another project opens (generation 1) before the unload's reply comes back.
    const late = pluginSwitchStep(
      rm.state,
      {
        type: 'load-result',
        slotKey: 'master:0',
        pluginId: '',
        success: true,
        previousState: 'VERB-TWEAKED'
      },
      ctx(removed, {}, CATALOG, 1)
    )
    const other = pluginSwitchStep(
      late.state,
      { type: 'chains-changed' },
      ctx(project, {}, CATALOG, 1)
    )
    expect(other.loads.find((l) => l.slotKey === 'master:0')?.stateBase64).toBeNull()
  })
})

describe('pluginSwitchStep: a load that fails', () => {
  function replacedWithFailingComp(): PluginSwitchStep {
    const live = allLoaded(project, saved)
    const replaced: PluginChains = { ...project, masterChain: ['comp', null, 'comp', null] }
    const rp = pluginSwitchStep(
      live.state,
      { type: 'chains-changed' },
      ctx(replaced, { 'master:0': { pluginId: 'comp', stateBase64: 'C0' } })
    )
    return pluginSwitchStep(
      rp.state,
      {
        type: 'load-result',
        slotKey: 'master:0',
        pluginId: 'comp',
        success: false,
        previousState: 'VERB-TWEAKED'
      },
      ctx(replaced, rp.pending)
    )
  }
  const replaced: PluginChains = { ...project, masterChain: ['comp', null, 'comp', null] }

  it('keeps the slot and its saved settings, marks it failed, and empties the engine`s slot', () => {
    const failed = replacedWithFailingComp()
    expect(failed.state.failed).toEqual(['master:0'])
    expect(failed.pending['master:0']).toEqual({ pluginId: 'comp', stateBase64: 'C0' })
    // The engine still had the verb there: it goes, so what plays matches the slot.
    expect(failed.unloads).toEqual([{ kind: 'master', slot: 0 }])
    expect(slotsEngineHolds(failed.state, replaced, 0).has('master:0')).toBe(false)
  })

  it('is not retried by every later edit', () => {
    const failed = replacedWithFailingComp()
    const edit = pluginSwitchStep(
      failed.state,
      { type: 'chains-changed' },
      ctx(replaced, failed.pending)
    )
    expect(edit.loads).toEqual([])
    expect(edit.unloads).toEqual([])
  })

  it('is retried after a scan, and with a successful load it is no longer failed', () => {
    const failed = replacedWithFailingComp()
    const unloaded = pluginSwitchStep(
      failed.state,
      { type: 'load-result', slotKey: 'master:0', pluginId: '', success: true },
      ctx(replaced, failed.pending)
    )
    const scan = pluginSwitchStep(
      unloaded.state,
      { type: 'catalog-changed' },
      ctx(replaced, unloaded.pending)
    )
    expect(scan.loads.map((l) => [l.slotKey, l.stateBase64])).toEqual([['master:0', 'C0']])
    const ok = pluginSwitchStep(
      scan.state,
      { type: 'load-result', slotKey: 'master:0', pluginId: 'comp', success: true },
      ctx(replaced, scan.pending)
    )
    expect(ok.state.failed).toEqual([])
    expect(ok.pending['master:0']).toBeUndefined()
  })

  it('picking another plugin there clears it', () => {
    const failed = replacedWithFailingComp()
    const other: PluginChains = { ...project, masterChain: ['delay', null, 'comp', null] }
    const pick = pluginSwitchStep(
      failed.state,
      { type: 'chains-changed' },
      ctx(other, failed.pending)
    )
    expect(pick.loads.map((l) => l.pluginId)).toEqual(['delay'])
    expect(pick.state.failed).toEqual([])
  })
})

describe('pluginSwitchStep: retry-failed', () => {
  it('reloads failed slots only (a channel the engine had not been told about yet, say)', () => {
    const [on] = run([{ type: 'switch', on: true }], project, saved)
    const failed = pluginSwitchStep(
      on.state,
      { type: 'load-result', slotKey: 'channel:ch1:0', pluginId: 'delay', success: false },
      ctx(project, on.pending)
    )
    expect(failed.state.failed).toEqual(['channel:ch1:0'])
    const retry = pluginSwitchStep(
      failed.state,
      { type: 'retry-failed', slotKeys: ['channel:ch1:0'] },
      ctx(project, failed.pending)
    )
    expect(retry.loads.map((l) => [l.slotKey, l.stateBase64])).toEqual([['channel:ch1:0', 'DELAY']])
    expect(retry.missing).toEqual([])
  })

  it('does nothing with no failed slot, or while not live', () => {
    const live = allLoaded(project, saved)
    expect(
      pluginSwitchStep(
        live.state,
        { type: 'retry-failed', slotKeys: ['master:0'] },
        ctx(project, {})
      ).loads
    ).toEqual([])
  })
})

describe('pluginSwitchStep: retry-failed for named slots', () => {
  it('retries only the named slots that are still failed (a broken plugin elsewhere is left alone)', () => {
    const [on] = run([{ type: 'switch', on: true }], project, saved)
    let step = pluginSwitchStep(
      on.state,
      { type: 'load-result', slotKey: 'channel:ch1:0', pluginId: 'delay', success: false },
      ctx(project, on.pending)
    )
    step = pluginSwitchStep(
      step.state,
      { type: 'load-result', slotKey: 'master:0', pluginId: 'verb', success: false },
      ctx(project, step.pending)
    )
    expect([...step.state.failed].sort()).toEqual(['channel:ch1:0', 'master:0'])
    const retry = pluginSwitchStep(
      step.state,
      { type: 'retry-failed', slotKeys: ['channel:ch1:0', 'master:2'] },
      ctx(project, step.pending)
    )
    expect(retry.loads.map((l) => l.slotKey)).toEqual(['channel:ch1:0'])
    expect(retry.state.failed).toEqual(['master:0'])
  })
})

describe('pluginSwitchStep: opening another project with fewer plugins', () => {
  const bChains: PluginChains = {
    masterChain: [null, null, null, null],
    channelPlugins: { ch2: ['comp', null] }
  }

  it('unloads the old project`s plugins on a channel the new one has none on', () => {
    const live = allLoaded(project, saved)
    const step = pluginSwitchStep(
      live.state,
      { type: 'chains-changed' },
      ctx(bChains, {}, CATALOG, 1)
    )
    expect(step.unloads).toEqual(
      expect.arrayContaining([
        { kind: 'master', slot: 0 },
        { kind: 'master', slot: 2 },
        { kind: 'channel', channelId: 'ch1', slot: 0 }
      ])
    )
    expect(step.unloads).toHaveLength(3)
    expect(step.loads.map((l) => l.slotKey)).toEqual(['channel:ch2:0'])
  })

  it('never keeps what those unloads report as the new project`s (no undo brings A`s settings into B)', () => {
    const live = allLoaded(project, saved)
    const open = pluginSwitchStep(
      live.state,
      { type: 'chains-changed' },
      ctx(bChains, {}, CATALOG, 1)
    )
    let step = open
    for (const [slotKey, previousState] of [
      ['master:0', 'VERB-A'],
      ['master:2', 'COMP-A'],
      ['channel:ch1:0', 'DELAY-A']
    ]) {
      step = pluginSwitchStep(
        step.state,
        { type: 'load-result', slotKey, pluginId: '', success: true, previousState },
        ctx(bChains, step.pending, CATALOG, 1)
      )
    }
    expect(step.state.parked).toEqual({})
    expect(step.state.sent['channel:ch1:0']).toBeUndefined()
  })

  it('within one project, a channel removed from it is left to the engine (it drops the chain)', () => {
    const live = allLoaded(project, saved)
    const noCh1: PluginChains = { ...project, channelPlugins: {} }
    const step = pluginSwitchStep(live.state, { type: 'chains-changed' }, ctx(noCh1, {}))
    expect(step.unloads).toEqual([])
  })
})

describe('pluginSwitchStep: undo before the engine has answered the removal', () => {
  it('an undo of a removal waits for the unload`s reply, then loads the plugin as it was', () => {
    const live = allLoaded(project, saved)
    const removed: PluginChains = { ...project, masterChain: [null, null, 'comp', null] }
    const rm = pluginSwitchStep(live.state, { type: 'chains-changed' }, ctx(removed, {}))
    const undone = pluginSwitchStep(rm.state, { type: 'chains-changed' }, ctx(project, rm.pending))
    expect(undone.loads).toEqual([]) // not at its defaults
    expect(slotsEngineHolds(undone.state, project, 0).has('master:0')).toBe(false)
    const answered = pluginSwitchStep(
      undone.state,
      {
        type: 'load-result',
        slotKey: 'master:0',
        pluginId: '',
        success: true,
        previousState: 'VERB-TWEAKED'
      },
      ctx(project, undone.pending)
    )
    expect(answered.loads.map((l) => [l.slotKey, l.pluginId, l.stateBase64])).toEqual([
      ['master:0', 'verb', 'VERB-TWEAKED']
    ])
    expect(answered.pending['master:0']).toEqual({ pluginId: 'verb', stateBase64: 'VERB-TWEAKED' })
    const landed = pluginSwitchStep(
      answered.state,
      { type: 'load-result', slotKey: 'master:0', pluginId: 'verb', success: true },
      ctx(project, answered.pending)
    )
    expect(slotsEngineHolds(landed.state, project, 0).has('master:0')).toBe(true)
    expect(landed.pending['master:0']).toBeUndefined()
  })

  it('an undo of a replacement waits for the new plugin`s reply, then brings the old one back as it was', () => {
    const live = allLoaded(project, saved)
    const replaced: PluginChains = { ...project, masterChain: ['delay', null, 'comp', null] }
    const rp = pluginSwitchStep(live.state, { type: 'chains-changed' }, ctx(replaced, {}))
    const undone = pluginSwitchStep(rp.state, { type: 'chains-changed' }, ctx(project, rp.pending))
    expect(undone.loads).toEqual([])
    const answered = pluginSwitchStep(
      undone.state,
      {
        type: 'load-result',
        slotKey: 'master:0',
        pluginId: 'delay',
        success: true,
        previousState: 'VERB-TWEAKED'
      },
      ctx(project, undone.pending)
    )
    expect(answered.loads.map((l) => [l.pluginId, l.stateBase64])).toEqual([
      ['verb', 'VERB-TWEAKED']
    ])
  })

  it('a reply without settings loads it at its defaults rather than never', () => {
    const live = allLoaded(project, saved)
    const removed: PluginChains = { ...project, masterChain: [null, null, 'comp', null] }
    const rm = pluginSwitchStep(live.state, { type: 'chains-changed' }, ctx(removed, {}))
    const undone = pluginSwitchStep(rm.state, { type: 'chains-changed' }, ctx(project, rm.pending))
    const answered = pluginSwitchStep(
      undone.state,
      { type: 'load-result', slotKey: 'master:0', pluginId: '', success: true },
      ctx(project, undone.pending)
    )
    expect(answered.loads.map((l) => [l.pluginId, l.stateBase64])).toEqual([['verb', null]])
  })

  it('switched off before the reply: the settings it reports are kept for the save and the switch going on', () => {
    const live = allLoaded(project, saved)
    const removed: PluginChains = { ...project, masterChain: [null, null, 'comp', null] }
    const rm = pluginSwitchStep(live.state, { type: 'chains-changed' }, ctx(removed, {}))
    const undone = pluginSwitchStep(rm.state, { type: 'chains-changed' }, ctx(project, rm.pending))
    const off = pluginSwitchStep(undone.state, { type: 'switch', on: false }, ctx(project, {}))
    const captured = pluginSwitchStep(
      off.state,
      {
        type: 'capture-done',
        captureId: off.state.captureId,
        raw: {
          masterChain: ['', '', 'COMP2', ''],
          channelChains: [{ channelId: 'ch1', slots: ['DELAY2', ''] }]
        }
      },
      ctx(project, off.pending)
    )
    expect(captured.state.phase).toBe('off')
    let step = captured
    for (const [pluginId, previousState] of [
      ['', 'VERB-TWEAKED'], // the removal's reply
      ['', undefined] // the switch-off's own unload of that slot
    ] as const) {
      step = pluginSwitchStep(
        step.state,
        { type: 'load-result', slotKey: 'master:0', pluginId, success: true, previousState },
        ctx(project, step.pending)
      )
    }
    expect(step.loads).toEqual([])
    expect(step.pending['master:0']).toEqual({ pluginId: 'verb', stateBase64: 'VERB-TWEAKED' })
  })

  it('an engine restart meanwhile reloads it from the fallback, and nothing waits any more', () => {
    const live = allLoaded(project, saved)
    const removed: PluginChains = { ...project, masterChain: [null, null, 'comp', null] }
    const rm = pluginSwitchStep(live.state, { type: 'chains-changed' }, ctx(removed, {}))
    const undone = pluginSwitchStep(rm.state, { type: 'chains-changed' }, ctx(project, rm.pending))
    const restarted = pluginSwitchStep(
      undone.state,
      { type: 'engine-restarted', fallback },
      ctx(project, undone.pending)
    )
    expect(restarted.loads.find((l) => l.slotKey === 'master:0')?.stateBase64).toBe('VERB-LATEST')
    expect(restarted.state.awaiting).toEqual({})
  })
})

describe('pluginSwitchStep: a plugin picked fresh (the browser or the slot`s menu)', () => {
  it('starts at its defaults, even right after the same plugin was removed from that slot', () => {
    const live = allLoaded(project, saved)
    const removed: PluginChains = { ...project, masterChain: [null, null, 'comp', null] }
    const rm = pluginSwitchStep(live.state, { type: 'chains-changed' }, ctx(removed, {}))
    const answered = pluginSwitchStep(
      rm.state,
      {
        type: 'load-result',
        slotKey: 'master:0',
        pluginId: '',
        success: true,
        previousState: 'VERB-TWEAKED'
      },
      ctx(removed, rm.pending)
    )
    const picked = pluginSwitchStep(
      withFreshChoice(answered.state, 'master:0'),
      { type: 'chains-changed' },
      ctx(project, answered.pending)
    )
    expect(picked.loads.map((l) => [l.pluginId, l.stateBase64])).toEqual([['verb', null]])
    expect(picked.state.fresh).toEqual([])
  })

  it('keeps the settings of another plugin removed from that slot: remove, pick, undo, undo', () => {
    const live = allLoaded(project, saved)
    const removed: PluginChains = { ...project, masterChain: [null, null, 'comp', null] }
    const rm = pluginSwitchStep(live.state, { type: 'chains-changed' }, ctx(removed, {}))
    const rmAnswered = pluginSwitchStep(
      rm.state,
      {
        type: 'load-result',
        slotKey: 'master:0',
        pluginId: '',
        success: true,
        previousState: 'VERB-TWEAKED'
      },
      ctx(removed, rm.pending)
    )
    // Another plugin picked fresh in the same slot.
    const other: PluginChains = { ...project, masterChain: ['delay', null, 'comp', null] }
    const picked = pluginSwitchStep(
      withFreshChoice(rmAnswered.state, 'master:0'),
      { type: 'chains-changed' },
      ctx(other, rmAnswered.pending)
    )
    expect(picked.loads.map((l) => [l.pluginId, l.stateBase64])).toEqual([['delay', null]])
    const pickAnswered = pluginSwitchStep(
      picked.state,
      { type: 'load-result', slotKey: 'master:0', pluginId: 'delay', success: true },
      ctx(other, picked.pending)
    )
    // Undo the pick: the slot is empty again.
    const undo1 = pluginSwitchStep(
      pickAnswered.state,
      { type: 'chains-changed' },
      ctx(removed, pickAnswered.pending)
    )
    const undo1Answered = pluginSwitchStep(
      undo1.state,
      {
        type: 'load-result',
        slotKey: 'master:0',
        pluginId: '',
        success: true,
        previousState: 'DELAY-X'
      },
      ctx(removed, undo1.pending)
    )
    // Undo the removal: the first plugin comes back as it was.
    const undo2 = pluginSwitchStep(
      undo1Answered.state,
      { type: 'chains-changed' },
      ctx(project, undo1Answered.pending)
    )
    expect(undo2.loads.map((l) => [l.pluginId, l.stateBase64])).toEqual([['verb', 'VERB-TWEAKED']])
  })

  it('does not wait for a removal still in flight', () => {
    const live = allLoaded(project, saved)
    const removed: PluginChains = { ...project, masterChain: [null, null, 'comp', null] }
    const rm = pluginSwitchStep(live.state, { type: 'chains-changed' }, ctx(removed, {}))
    const picked = pluginSwitchStep(
      withFreshChoice(rm.state, 'master:0'),
      { type: 'chains-changed' },
      ctx(project, rm.pending)
    )
    expect(picked.loads.map((l) => [l.pluginId, l.stateBase64])).toEqual([['verb', null]])
  })
})

describe('heldRetryDelayMs', () => {
  it('backs off from 5 s, doubling, to at most a minute, then gives up', () => {
    const delays: (number | null)[] = []
    for (let attempt = 0; attempt < 8; attempt++) delays.push(heldRetryDelayMs(attempt))
    expect(delays).toEqual([5000, 10000, 20000, 40000, 60000, 60000, null, null])
  })
})

describe('unknownChannelRetryDelayMs', () => {
  it('waits a little longer each time, a few times only', () => {
    const delays: (number | null)[] = []
    for (let attempt = 0; attempt < 7; attempt++) delays.push(unknownChannelRetryDelayMs(attempt))
    expect(delays).toEqual([1000, 2000, 3000, 4000, 5000, null, null])
  })
})
