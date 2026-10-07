import { describe, expect, it } from 'vitest'
import {
  initialPluginSwitchState,
  pluginSwitchStep,
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
  catalog: Record<string, string> = CATALOG
): PluginSwitchContext {
  return { chains, pending, pathOf: (id) => catalog[id] ?? null }
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
  events: PluginSwitchEvent[],
  chains: PluginChains,
  pending: PluginStatesMap,
  catalog: Record<string, string> = CATALOG,
  start: PluginSwitchState = initialPluginSwitchState
): PluginSwitchStep[] {
  const steps: PluginSwitchStep[] = []
  let state = start
  let p = pending
  for (const event of events) {
    const step = pluginSwitchStep(state, event, ctx(chains, p, catalog))
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
      { type: 'capture-done', raw: liveCapture, projectReplaced: false },
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
        { type: 'capture-done', raw: null, projectReplaced: false },
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
          raw: { masterChain: ['', '', 'COMP2', ''], channelChains: [] },
          projectReplaced: false
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
        { type: 'capture-done', raw: liveCapture, projectReplaced: false }
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
        { type: 'switch', on: false },
        { type: 'capture-done', raw: liveCapture, projectReplaced: true }
      ],
      project,
      saved
    )
    expect(steps[2].pending).toEqual(saved)
    expect(steps[2].unloads.length).toBe(3)
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
        { type: 'capture-done', raw: liveCapture, projectReplaced: false }
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
        { type: 'capture-done', raw: liveCapture, projectReplaced: false }
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
      { type: 'capture-done', raw: liveCapture, projectReplaced: true },
      ctx(other, otherSaved)
    )
    expect(done.state.phase).toBe('live')
    expect(done.loads.map((l) => [l.slotKey, l.pluginId, l.stateBase64])).toEqual([
      ['master:0', 'delay', 'D']
    ])
    expect(done.unloads).toEqual([{ kind: 'master', slot: 2 }])
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

describe('pluginSwitchStep: the engine restarting', () => {
  it('forgets what was sent, so its answers can never come and nothing waits on them', () => {
    const [on] = run([{ type: 'switch', on: true }], project, saved)
    expect(Object.keys(on.state.sent).length).toBe(3)
    const restarted = pluginSwitchStep(
      on.state,
      { type: 'engine-restarted' },
      ctx(project, on.pending)
    )
    expect(restarted.state.sent).toEqual({})
    expect(restarted.pending).toEqual(saved)
  })
})
