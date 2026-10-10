import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'os'
import { join } from 'path'

vi.mock('electron', () => ({ app: { getPath: vi.fn() } }))

// A disk that fills up midway through the next write: part of the data lands, then it throws.
const disk = vi.hoisted(() => ({ full: false }))
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    writeFileSync: (...args: Parameters<typeof actual.writeFileSync>): void => {
      if (!disk.full) return actual.writeFileSync(...args)
      actual.writeFileSync(args[0], String(args[1]).slice(0, 5))
      throw Object.assign(new Error('no space left on device'), { code: 'ENOSPC' })
    }
  }
})

describe('previewLevelStore', () => {
  let dir: string

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'preview-level-test-'))
    const { app } = await import('electron')
    vi.mocked(app.getPath).mockReturnValue(dir)
  })

  afterEach(() => {
    disk.full = false
    rmSync(dir, { recursive: true, force: true })
    vi.resetModules()
  })

  it('is 100% before anything was saved', async () => {
    const { loadPreviewLevel } = await import('./previewLevelStore')
    expect(loadPreviewLevel()).toBe(100)
  })

  it('remembers a saved level across loads (a restart reads the file again)', async () => {
    const { savePreviewLevel } = await import('./previewLevelStore')
    savePreviewLevel(35)
    expect(JSON.parse(readFileSync(join(dir, 'previewLevel.json'), 'utf-8'))).toEqual({
      previewLevel: 35
    })
    vi.resetModules()
    const fresh = await import('./previewLevelStore')
    expect(fresh.loadPreviewLevel()).toBe(35)
  })

  it('saves 0, a real level, not "unset"', async () => {
    const { loadPreviewLevel, savePreviewLevel } = await import('./previewLevelStore')
    savePreviewLevel(0)
    expect(loadPreviewLevel()).toBe(0)
  })

  it('cleans what it saves', async () => {
    const { loadPreviewLevel, savePreviewLevel } = await import('./previewLevelStore')
    savePreviewLevel(180)
    expect(loadPreviewLevel()).toBe(100)
  })

  it('reads an unreadable or odd file as 100%, never throwing', async () => {
    const { loadPreviewLevel } = await import('./previewLevelStore')
    writeFileSync(join(dir, 'previewLevel.json'), '{ not json')
    expect(loadPreviewLevel()).toBe(100)
    writeFileSync(join(dir, 'previewLevel.json'), JSON.stringify({ previewLevel: 'loud' }))
    expect(loadPreviewLevel()).toBe(100)
  })

  it('a write that dies midway (a full disk) leaves the saved level whole, and no temp file', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { savePreviewLevel } = await import('./previewLevelStore')
    savePreviewLevel(35)
    disk.full = true
    savePreviewLevel(60)
    disk.full = false
    vi.resetModules()
    const fresh = await import('./previewLevelStore')
    expect(fresh.loadPreviewLevel()).toBe(35)
    expect(readdirSync(dir)).toEqual(['previewLevel.json'])
  })
})
