import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  COACH_PENDING_ADD_LIMIT,
  coachDiscoverIsOpen,
  registerCoachAddSlot,
  requestCoachAddSlot,
  resetCoachDiscoverBridge
} from './coachDiscoverBridge'

describe('the coach -> Discover bridge', () => {
  beforeEach(() => resetCoachDiscoverBridge())

  it('knows whether Discover is on screen', () => {
    expect(coachDiscoverIsOpen()).toBe(false)
    const unregister = registerCoachAddSlot(vi.fn())
    expect(coachDiscoverIsOpen()).toBe(true)
    unregister()
    expect(coachDiscoverIsOpen()).toBe(false)
  })

  it('passes a request straight through while Discover is open', () => {
    const addSlot = vi.fn()
    registerCoachAddSlot(addSlot)
    requestCoachAddSlot(['bass'])
    expect(addSlot).toHaveBeenCalledWith(['bass'])
  })

  it('queues a request made before Discover opens, and flushes it on register', () => {
    requestCoachAddSlot(['bass'])
    requestCoachAddSlot(['drums'])
    const addSlot = vi.fn()
    registerCoachAddSlot(addSlot)
    expect(addSlot.mock.calls).toEqual([[['bass']], [['drums']]])
    // Flushed, not replayed on the next register.
    const second = vi.fn()
    registerCoachAddSlot(second)
    expect(second).not.toHaveBeenCalled()
  })

  it('caps the queue rather than growing forever while Discover stays shut', () => {
    for (let i = 0; i < COACH_PENDING_ADD_LIMIT + 3; i += 1) requestCoachAddSlot(['bass'])
    const addSlot = vi.fn()
    registerCoachAddSlot(addSlot)
    expect(addSlot).toHaveBeenCalledTimes(COACH_PENDING_ADD_LIMIT)
  })

  it('only the current registration is unregistered by its own teardown', () => {
    const first = vi.fn()
    const unregisterFirst = registerCoachAddSlot(first)
    const second = vi.fn()
    registerCoachAddSlot(second)
    unregisterFirst()
    expect(coachDiscoverIsOpen()).toBe(true)
    requestCoachAddSlot(['bass'])
    expect(second).toHaveBeenCalledWith(['bass'])
  })
})
