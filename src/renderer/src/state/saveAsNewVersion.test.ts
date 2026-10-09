import { describe, expect, it, vi, type Mock } from 'vitest'
import { saveAsNewVersion } from './saveAsNewVersion'

interface FakeDeps {
  serialize: Mock<() => Promise<string>>
  saveOriginal: Mock<(name: string, json: string) => Promise<void>>
  writeCopy: Mock<(name: string, json: string) => Promise<{ name: string } | null>>
  calls: string[]
}

function deps(): FakeDeps {
  const calls: string[] = []
  const serialize = vi.fn<() => Promise<string>>(async () => {
    calls.push('serialize')
    return '{"live":true}'
  })
  const saveOriginal = vi.fn<(name: string, json: string) => Promise<void>>(async (name) => {
    calls.push(`save ${name}`)
  })
  const writeCopy = vi.fn<(name: string, json: string) => Promise<{ name: string } | null>>(
    async (name) => {
      calls.push(`copy ${name}`)
      return { name: `${name} 2` }
    }
  )
  return { serialize, saveOriginal, writeCopy, calls }
}

describe('saveAsNewVersion', () => {
  it('saves the original first, then writes the copy, both with the save JSON', async () => {
    const d = deps()
    const outcome = await saveAsNewVersion('misty kestrel', d)
    expect(d.calls).toEqual(['serialize', 'save misty kestrel', 'copy misty kestrel'])
    expect(d.saveOriginal).toHaveBeenCalledWith('misty kestrel', '{"live":true}')
    expect(d.writeCopy).toHaveBeenCalledWith('misty kestrel', '{"live":true}')
    expect(outcome).toEqual({
      kind: 'done',
      copyName: 'misty kestrel 2',
      notice: "you're now working in misty kestrel 2 · misty kestrel was saved first"
    })
  })

  it('makes no copy when saving the original fails, and says the save failed', async () => {
    const d = deps()
    d.saveOriginal.mockRejectedValueOnce(new Error('disk full'))
    const outcome = await saveAsNewVersion('misty kestrel', d)
    expect(d.writeCopy).not.toHaveBeenCalled()
    expect(outcome).toEqual({ kind: 'save-failed', alert: 'save failed: disk full' })
  })

  it('writes nothing when the save JSON cannot be made (a plugin capture refused)', async () => {
    const d = deps()
    d.serialize.mockRejectedValueOnce(new Error('failed to read current plugin state'))
    const outcome = await saveAsNewVersion('misty kestrel', d)
    expect(d.saveOriginal).not.toHaveBeenCalled()
    expect(d.writeCopy).not.toHaveBeenCalled()
    expect(outcome).toEqual({
      kind: 'save-failed',
      alert: 'save failed: failed to read current plugin state'
    })
  })

  it('reports a failed copy after the original saved, so the original still counts as saved', async () => {
    const d = deps()
    d.writeCopy.mockRejectedValueOnce(new Error('permission denied'))
    const outcome = await saveAsNewVersion('misty kestrel', d)
    expect(outcome).toEqual({
      kind: 'copy-failed',
      alert: 'misty kestrel was saved, but the new version failed: permission denied'
    })
  })

  it('treats a copy that could not be made (no such sketch) as a failed copy', async () => {
    const d = deps()
    d.writeCopy.mockResolvedValueOnce(null)
    const outcome = await saveAsNewVersion('misty kestrel', d)
    expect(outcome).toEqual({
      kind: 'copy-failed',
      alert: "misty kestrel was saved, but the new version couldn't be made"
    })
  })
})
