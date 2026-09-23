import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  coachExportIsReachable,
  registerCoachExport,
  requestCoachExport,
  resetCoachExportBridge
} from './coachExportBridge'

describe('coachExportBridge', () => {
  beforeEach(() => resetCoachExportBridge())

  it('routes a request to the registered export menu', () => {
    const handler = vi.fn()
    registerCoachExport(handler)
    requestCoachExport('mix')
    expect(handler).toHaveBeenCalledWith('mix')
  })

  it('drops a request with nothing registered rather than queueing it', () => {
    expect(coachExportIsReachable()).toBe(false)
    expect(() => requestCoachExport('project')).not.toThrow()
  })

  it('lets a late teardown from the previous instance not unregister the live one', () => {
    const first = vi.fn()
    const second = vi.fn()
    const tearDownFirst = registerCoachExport(first)
    registerCoachExport(second)
    tearDownFirst()
    requestCoachExport('project')
    expect(second).toHaveBeenCalledWith('project')
    expect(first).not.toHaveBeenCalled()
  })
})
