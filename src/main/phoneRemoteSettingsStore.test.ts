import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

vi.mock('electron', () => ({ app: { getPath: vi.fn() } }))

describe('phoneRemoteSettingsStore', () => {
  let dir: string

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'phone-remote-settings-test-'))
    const { app } = await import('electron')
    vi.mocked(app.getPath).mockReturnValue(dir)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    vi.resetModules()
  })

  it('has no preferred address until one is chosen', async () => {
    const { loadPhoneRemoteSettings } = await import('./phoneRemoteSettingsStore')
    expect(loadPhoneRemoteSettings()).toEqual({ preferredAddress: null })
  })

  it('remembers a chosen address across a save/load round trip', async () => {
    const { loadPhoneRemoteSettings, savePhoneRemoteSettings } =
      await import('./phoneRemoteSettingsStore')
    savePhoneRemoteSettings({ preferredAddress: '100.66.121.12' })
    expect(loadPhoneRemoteSettings()).toEqual({ preferredAddress: '100.66.121.12' })
  })

  it('forgets the choice when it is cleared', async () => {
    const { loadPhoneRemoteSettings, savePhoneRemoteSettings } =
      await import('./phoneRemoteSettingsStore')
    savePhoneRemoteSettings({ preferredAddress: '100.66.121.12' })
    savePhoneRemoteSettings({ preferredAddress: null })
    expect(loadPhoneRemoteSettings()).toEqual({ preferredAddress: null })
  })

  it('defaults (not throws) when the file is corrupted', async () => {
    const { loadPhoneRemoteSettings, savePhoneRemoteSettings } =
      await import('./phoneRemoteSettingsStore')
    savePhoneRemoteSettings({ preferredAddress: '100.66.121.12' })
    const { writeFileSync } = await import('fs')
    writeFileSync(join(dir, 'phoneRemoteSettings.json'), 'not valid json{{{', 'utf-8')
    expect(() => loadPhoneRemoteSettings()).not.toThrow()
    expect(loadPhoneRemoteSettings()).toEqual({ preferredAddress: null })
  })

  it('ignores a stored value that is not a string', async () => {
    const { loadPhoneRemoteSettings } = await import('./phoneRemoteSettingsStore')
    const { writeFileSync } = await import('fs')
    writeFileSync(join(dir, 'phoneRemoteSettings.json'), '{"preferredAddress":17}', 'utf-8')
    expect(loadPhoneRemoteSettings()).toEqual({ preferredAddress: null })
  })

  // Its existence is the advanced features migration's sign that the remote was used
  // (appFeaturesStore.ts): written on the first start, so a start alone leaves that trace.
  it('records the first start of the remote by writing the file, keeping a chosen address', async () => {
    const { existsSync } = await import('fs')
    const { loadPhoneRemoteSettings, recordPhoneRemoteStarted, savePhoneRemoteSettings } =
      await import('./phoneRemoteSettingsStore')
    const path = join(dir, 'phoneRemoteSettings.json')
    expect(existsSync(path)).toBe(false)
    recordPhoneRemoteStarted()
    expect(existsSync(path)).toBe(true)
    expect(loadPhoneRemoteSettings()).toEqual({ preferredAddress: null })
    savePhoneRemoteSettings({ preferredAddress: '100.66.121.12' })
    recordPhoneRemoteStarted()
    expect(loadPhoneRemoteSettings()).toEqual({ preferredAddress: '100.66.121.12' })
  })
})
