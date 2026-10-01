import { describe, expect, it } from 'vitest'
import { StemNotDownloadedError, isStemNotDownloadedError } from './stemNotDownloaded'

describe('StemNotDownloadedError', () => {
  it('names the path in one short line', () => {
    const err = new StemNotDownloadedError('/a/b/cid')
    expect(err.message).toBe('stem not downloaded (0 bytes or missing): /a/b/cid')
    expect(err.path).toBe('/a/b/cid')
    expect(isStemNotDownloadedError(err)).toBe(true)
  })

  // Electron's ipcRenderer.invoke rejects with a plain Error whose message
  // wraps the main-side one, so instanceof is gone by then.
  it('is still recognised after crossing IPC', () => {
    const wrapped = new Error(
      "Error invoking remote method 'render-stretched': Error: stem not downloaded (0 bytes or missing): /x"
    )
    expect(isStemNotDownloadedError(wrapped)).toBe(true)
  })

  it('does not match other errors', () => {
    expect(isStemNotDownloadedError(new Error('Unable to decode audio data'))).toBe(false)
    expect(isStemNotDownloadedError('stem not downloaded')).toBe(false)
    expect(isStemNotDownloadedError(null)).toBe(false)
  })
})
