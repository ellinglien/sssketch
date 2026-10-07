import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let appPath = ''
vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return false
    },
    getAppPath: () => appPath
  }
}))

beforeEach(() => {
  vi.resetModules()
  appPath = mkdtempSync(join(tmpdir(), 'yamnet-model-'))
})

afterEach(() => {
  rmSync(appPath, { recursive: true, force: true })
  vi.restoreAllMocks()
})

function vendorModel(): void {
  mkdirSync(join(appPath, 'resources', 'yamnet'), { recursive: true })
  writeFileSync(join(appPath, 'resources', 'yamnet', 'yamnet.onnx'), Buffer.from([1, 2, 3]))
}

describe('yamnetModelAvailable (share-readiness audit B3)', () => {
  it('is true when the model is there, and its bytes read', async () => {
    vendorModel()
    const { yamnetModelAvailable, readYamnetModelBytes } = await import('./yamnetModel')
    expect(yamnetModelAvailable()).toBe(true)
    expect(Array.from((await readYamnetModelBytes())!)).toEqual([1, 2, 3])
  })

  it('missing: false, logged once however often it is asked, and no bytes', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { yamnetModelAvailable, readYamnetModelBytes } = await import('./yamnetModel')
    for (let i = 0; i < 5; i++) expect(yamnetModelAvailable()).toBe(false)
    expect(await readYamnetModelBytes()).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toMatch(/yamnet\.onnx/)
  })

  it('is decided once per launch: the file appearing later does not flip it', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { yamnetModelAvailable } = await import('./yamnetModel')
    expect(yamnetModelAvailable()).toBe(false)
    vendorModel()
    expect(yamnetModelAvailable()).toBe(false)
  })
})
