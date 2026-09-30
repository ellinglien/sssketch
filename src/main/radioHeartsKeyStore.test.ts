import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let userDataDir: string
let encryptionAvailable = true

// A reversible stand-in for the keychain -- just enough to prove the file
// on disk is never the plaintext key.
vi.mock('electron', () => ({
  app: { getPath: () => userDataDir },
  safeStorage: {
    isEncryptionAvailable: () => encryptionAvailable,
    encryptString: (s: string) => Buffer.from([...Buffer.from(s)].reverse()),
    decryptString: (b: Buffer) => Buffer.from([...b].reverse()).toString()
  }
}))

describe('radioHeartsKeyStore', () => {
  beforeEach(async () => {
    userDataDir = mkdtempSync(join(tmpdir(), 'sssketch-radio-key-test-'))
    encryptionAvailable = true
    const { resetRadioHeartsKeyForTests } = await import('./radioHeartsKeyStore')
    resetRadioHeartsKeyForTests()
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('has no key until one is set', async () => {
    const { loadRadioHeartsKey, hasRadioHeartsKey, radioHeartsKeyStatus } =
      await import('./radioHeartsKeyStore')
    expect(loadRadioHeartsKey()).toBeNull()
    expect(hasRadioHeartsKey()).toBe(false)
    expect(radioHeartsKeyStatus()).toBe('none')
  })

  it('persists the key encrypted, and reads it back after a restart', async () => {
    const { saveRadioHeartsKey, loadRadioHeartsKey, resetRadioHeartsKeyForTests } =
      await import('./radioHeartsKeyStore')
    saveRadioHeartsKey('  sekrit-key  ')
    const onDisk = readFileSync(join(userDataDir, 'radio-hearts-key.enc'))
    expect(onDisk.toString()).not.toContain('sekrit-key')
    resetRadioHeartsKeyForTests()
    expect(loadRadioHeartsKey()).toBe('sekrit-key')
    const { radioHeartsKeyStatus } = await import('./radioHeartsKeyStore')
    expect(radioHeartsKeyStatus()).toBe('saved')
  })

  it('clears with an empty string', async () => {
    const { saveRadioHeartsKey, loadRadioHeartsKey, resetRadioHeartsKeyForTests } =
      await import('./radioHeartsKeyStore')
    saveRadioHeartsKey('k')
    saveRadioHeartsKey('')
    expect(existsSync(join(userDataDir, 'radio-hearts-key.enc'))).toBe(false)
    resetRadioHeartsKeyForTests()
    expect(loadRadioHeartsKey()).toBeNull()
  })

  it('never writes plaintext when encryption is unavailable -- session only', async () => {
    const { saveRadioHeartsKey, loadRadioHeartsKey, resetRadioHeartsKeyForTests } =
      await import('./radioHeartsKeyStore')
    encryptionAvailable = false
    saveRadioHeartsKey('k')
    expect(loadRadioHeartsKey()).toBe('k')
    const { radioHeartsKeyStatus } = await import('./radioHeartsKeyStore')
    expect(radioHeartsKeyStatus()).toBe('session')
    expect(existsSync(join(userDataDir, 'radio-hearts-key.enc'))).toBe(false)
    resetRadioHeartsKeyForTests()
    expect(loadRadioHeartsKey()).toBeNull()
  })
})
