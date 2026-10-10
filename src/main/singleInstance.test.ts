import { describe, expect, it, vi } from 'vitest'
import { claimSingleInstance } from './singleInstance'

function fakeApp(gotLock: boolean): {
  requestSingleInstanceLock: () => boolean
  exit: (exitCode?: number) => void
  on: (event: 'second-instance', listener: () => void) => unknown
  exits: (number | undefined)[]
  listeners: [string, () => void][]
} {
  const exits: (number | undefined)[] = []
  const listeners: [string, () => void][] = []
  return {
    requestSingleInstanceLock: () => gotLock,
    exit: (exitCode) => void exits.push(exitCode),
    on: (event, listener) => listeners.push([event, listener]),
    exits,
    listeners
  }
}

describe('claimSingleInstance', () => {
  it('the first launch keeps running and listens for later launches', () => {
    const app = fakeApp(true)
    const focus = vi.fn()
    expect(claimSingleInstance(app, focus)).toBe(true)
    expect(app.exits).toEqual([])
    expect(app.listeners).toEqual([['second-instance', focus]])
  })

  it('a later launch exits at once, without waiting for ready', () => {
    const app = fakeApp(false)
    expect(claimSingleInstance(app, vi.fn())).toBe(false)
    expect(app.exits).toEqual([0])
    expect(app.listeners).toEqual([])
  })
})
