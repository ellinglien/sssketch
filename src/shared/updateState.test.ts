import { describe, expect, it } from 'vitest'
import { nextUpdateState, type UpdateState } from './updateState'

const idle: UpdateState = { state: 'idle' }

describe('nextUpdateState', () => {
  it('update-available moves idle to available, carrying the version', () => {
    const next = nextUpdateState(idle, { type: 'update-available', version: '1.2.0' })
    expect(next).toEqual({ state: 'available', version: '1.2.0' })
  })

  it('confirm-install moves available to downloading at 0 percent', () => {
    const available: UpdateState = { state: 'available', version: '1.2.0' }
    const next = nextUpdateState(available, { type: 'confirm-install' })
    expect(next).toEqual({ state: 'downloading', version: '1.2.0', percent: 0 })
  })

  it('confirm-install is a no-op from any state other than available', () => {
    const next = nextUpdateState(idle, { type: 'confirm-install' })
    expect(next).toEqual(idle)
  })

  it('download-progress updates percent while downloading', () => {
    const downloading: UpdateState = { state: 'downloading', version: '1.2.0', percent: 10 }
    const next = nextUpdateState(downloading, { type: 'download-progress', percent: 42 })
    expect(next).toEqual({ state: 'downloading', version: '1.2.0', percent: 42 })
  })

  it('download-progress is a no-op outside downloading', () => {
    const next = nextUpdateState(idle, { type: 'download-progress', percent: 42 })
    expect(next).toEqual(idle)
  })

  it('update-downloaded moves downloading to installing, keeping the version', () => {
    const downloading: UpdateState = { state: 'downloading', version: '1.2.0', percent: 100 }
    const next = nextUpdateState(downloading, { type: 'update-downloaded' })
    expect(next).toEqual({ state: 'installing', version: '1.2.0' })
  })

  it('update-downloaded is a no-op outside downloading', () => {
    const next = nextUpdateState(idle, { type: 'update-downloaded' })
    expect(next).toEqual(idle)
  })

  it('error moves a non-idle state to error, carrying the message', () => {
    const downloading: UpdateState = { state: 'downloading', version: '1.2.0', percent: 42 }
    const next = nextUpdateState(downloading, { type: 'error', error: 'network unreachable' })
    expect(next).toEqual({ state: 'error', error: 'network unreachable' })
  })

  it('error is a no-op from idle -- a background/periodic check failing must not surface a dialog nobody asked for', () => {
    const next = nextUpdateState(idle, { type: 'error', error: 'network unreachable' })
    expect(next).toEqual(idle)
  })

  it('dismiss resets any state to idle', () => {
    const error: UpdateState = { state: 'error', error: 'network unreachable' }
    expect(nextUpdateState(error, { type: 'dismiss' })).toEqual(idle)

    const available: UpdateState = { state: 'available', version: '1.2.0' }
    expect(nextUpdateState(available, { type: 'dismiss' })).toEqual(idle)
  })

  it('update-available while already downloading/installing does not interrupt it -- a second poll finding the same or a different version mid-flight should not reset progress', () => {
    const downloading: UpdateState = { state: 'downloading', version: '1.2.0', percent: 42 }
    const next = nextUpdateState(downloading, { type: 'update-available', version: '1.2.0' })
    expect(next).toEqual(downloading)
  })
})
