import { describe, expect, it, vi } from 'vitest'
import { loadLastSelectedImportJam, storeLastSelectedImportJam } from './libraryBrowserSelection'

function memoryStorage(initial: string | null = null): Pick<Storage, 'getItem' | 'setItem'> {
  let value = initial
  return {
    getItem: vi.fn(() => value),
    setItem: vi.fn((_key: string, next: string) => {
      value = next
    })
  }
}

describe('Import browser jam selection persistence', () => {
  it('restores the last selected jam', () => {
    const storage = memoryStorage('jam-42')
    expect(loadLastSelectedImportJam(storage)).toBe('jam-42')
  })

  it('treats an absent or empty stored value as no selection', () => {
    expect(loadLastSelectedImportJam(memoryStorage())).toBeNull()
    expect(loadLastSelectedImportJam(memoryStorage('   '))).toBeNull()
  })

  it('stores concrete jam choices but keeps the last jam when a loop folder is selected', () => {
    const storage = memoryStorage('jam-old')
    storeLastSelectedImportJam('jam-new', storage)
    expect(loadLastSelectedImportJam(storage)).toBe('jam-new')
    storeLastSelectedImportJam(null, storage)
    expect(loadLastSelectedImportJam(storage)).toBe('jam-new')
  })

  it('fails open when localStorage is unavailable', () => {
    const storage = {
      getItem: vi.fn(() => {
        throw new Error('storage unavailable')
      }),
      setItem: vi.fn(() => {
        throw new Error('storage unavailable')
      })
    }
    expect(loadLastSelectedImportJam(storage)).toBeNull()
    expect(() => storeLastSelectedImportJam('jam-1', storage)).not.toThrow()
  })
})
