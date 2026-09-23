import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  coachTensionPanelIsOpen,
  registerCoachTensionOp,
  requestCoachTensionOp,
  resetCoachTensionBridge
} from './coachTensionBridge'

describe('coachTensionBridge', () => {
  beforeEach(() => resetCoachTensionBridge())

  it('routes a request to the registered panel', () => {
    const handler = vi.fn()
    registerCoachTensionOp(handler)
    requestCoachTensionOp('add-all')
    expect(handler).toHaveBeenCalledWith('add-all')
  })

  it('drops a request with no panel open rather than queueing it', () => {
    expect(coachTensionPanelIsOpen()).toBe(false)
    expect(() => requestCoachTensionOp('listen')).not.toThrow()
  })

  it('lets a late teardown from the previous instance not unregister the live one', () => {
    const first = vi.fn()
    const second = vi.fn()
    const tearDownFirst = registerCoachTensionOp(first)
    registerCoachTensionOp(second)
    tearDownFirst()
    requestCoachTensionOp('listen')
    expect(second).toHaveBeenCalledWith('listen')
    expect(first).not.toHaveBeenCalled()
  })
})
