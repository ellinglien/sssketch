// Review finding M4: one clean resolves the library root once and uses it for both the scan and
// the delete. If the root is re-read for the delete, a library repointed mid-clean has its copies
// deleted against the old library's projects.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let userDataDir: string
vi.mock('electron', () => ({
  app: { getPath: () => userDataDir, getAppPath: () => process.cwd() }
}))

// Each read of the library root answers the next of `roots`, then the last one for good.
const rootReads = vi.hoisted(() => ({ roots: [] as string[], count: 0 }))
vi.mock('./projectLibrary', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./projectLibrary')>()
  const libraryRootPath = (): string =>
    rootReads.roots[Math.min(rootReads.count++, rootReads.roots.length - 1)]
  return {
    ...actual,
    libraryRootPath,
    bakeAssetsDir: (root: string = libraryRootPath()) => join(root, '.bakes')
  }
})

import type { IpcMain } from 'electron'
import { registerReonedCopiesIpc } from './reonedCopiesIpc'

const COPY = '0123456789abcdef0123456789abcdef.baked.wav'
type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>
let handlers: Map<string, Handler>
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sssketch-reoned-ipc-'))
  userDataDir = join(dir, 'userData')
  mkdirSync(userDataDir)
  handlers = new Map()
  registerReonedCopiesIpc({
    handle: (channel: string, fn: Handler) => handlers.set(channel, fn)
  } as unknown as IpcMain)
  rootReads.count = 0
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('reoned-copies-clean', () => {
  it('scans and deletes in the one library it resolved, even if the root changes meanwhile', async () => {
    // Library A: no projects, no copies. Library B: a project naming an old copy.
    const a = join(dir, 'A')
    const b = join(dir, 'B')
    mkdirSync(join(a, '.bakes'), { recursive: true })
    mkdirSync(join(b, '.bakes'), { recursive: true })
    mkdirSync(join(b, 's'))
    writeFileSync(join(b, 's', 's.sssketchproj'), JSON.stringify({ path: `/x/.bakes/${COPY}` }))
    const copy = join(b, '.bakes', COPY)
    writeFileSync(copy, Buffer.alloc(100))
    const old = (Date.now() - 3 * 24 * 60 * 60 * 1000) / 1000
    utimesSync(copy, old, old)
    // The root reads A for the clean's first two reads, then B (repointed mid-clean).
    rootReads.roots = [a, a, b]
    const result = await handlers.get('reoned-copies-clean')!({}, [])
    expect(result).toMatchObject({ status: 'ok', deletedCount: 0 })
    expect(existsSync(copy)).toBe(true)
  })
})

describe('EEEDIT renders in .shapes', () => {
  it('the survey counts and the clean deletes an unused old render, keeping one a project names', async () => {
    const lib = join(dir, 'L')
    const shapes = join(lib, '.shapes')
    mkdirSync(join(lib, 's'), { recursive: true })
    mkdirSync(shapes)
    const kept = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.shape.wav'
    const unused = 'ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee.shape-base.wav'
    writeFileSync(join(lib, 's', 's.sssketchproj'), JSON.stringify({ path: `/x/.shapes/${kept}` }))
    const old = (Date.now() - 3 * 24 * 60 * 60 * 1000) / 1000
    for (const name of [kept, unused]) {
      writeFileSync(join(shapes, name), Buffer.alloc(100))
      utimesSync(join(shapes, name), old, old)
    }
    rootReads.roots = [lib]
    const survey = await handlers.get('reoned-copies-survey')!({}, { inMemoryNames: [] })
    expect(survey).toMatchObject({ status: 'ok', unusedBytes: 100, unusedCount: 1 })
    const result = await handlers.get('reoned-copies-clean')!({}, [])
    expect(result).toMatchObject({ status: 'ok', freedBytes: 100, deletedCount: 1 })
    expect(existsSync(join(shapes, kept))).toBe(true)
    expect(existsSync(join(shapes, unused))).toBe(false)
  })
})
