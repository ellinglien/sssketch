import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  registerCoachSectionOp,
  requestCoachSectionOp,
  resetCoachSectionBridge
} from './coachSectionBridge'

describe('coachSectionBridge', () => {
  beforeEach(() => resetCoachSectionBridge())

  it('routes a request to the registered panel', () => {
    const handler = vi.fn()
    registerCoachSectionOp(handler)
    requestCoachSectionOp('preview')
    expect(handler).toHaveBeenCalledWith('preview')
  })

  it('drops a request with no panel mounted rather than queueing it', () => {
    // Unlike the Discover bridge, there is nothing to open and wait for:
    // the panel is on screen exactly when these steps are current, so a
    // request that arrives with no handler is a request that should not
    // have been made.
    expect(() => requestCoachSectionOp('place')).not.toThrow()
  })

  it('a late teardown never unregisters the live panel', () => {
    const first = vi.fn()
    const second = vi.fn()
    const teardownFirst = registerCoachSectionOp(first)
    registerCoachSectionOp(second)
    teardownFirst()
    requestCoachSectionOp('drop-suggested')
    expect(second).toHaveBeenCalledWith('drop-suggested')
    expect(first).not.toHaveBeenCalled()
  })
})
