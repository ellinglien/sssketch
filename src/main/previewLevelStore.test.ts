import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

vi.mock('electron', () => ({ app: { getPath: vi.fn() } }))

describe('previewLevelStore', () => {
  let dir: string

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'preview-level-test-'))
    const { app } = await import('electron')
    vi.mocked(app.getPath).mockReturnValue(dir)
  })

  afterEach(() => {
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
})
