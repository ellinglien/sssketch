// Review finding I1: a project that reaches the renderer (or is written) while a clean is running
// must keep its copies. The clean snapshots the renderer's names, the remembered projects and the
// files when it starts; what main hands out or writes after that is protected by the session's
// project names, which cleanBakes reads inside the `.bakes` lock.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let userDataDir: string
let musicDir: string
const dialogPick = vi.hoisted(() => ({ path: '' }))
vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'music' ? musicDir : userDataDir),
    getAppPath: () => process.cwd()
  },
  dialog: {
    showOpenDialog: async () => ({ canceled: false, filePaths: [dialogPick.path] }),
    showSaveDialog: async () => ({ canceled: false, filePath: dialogPick.path })
  }
}))

import type { BrowserWindow } from 'electron'
import {
  AUTOSAVE_FILENAME,
  AUTOSAVE_PREVIOUS_FILENAME,
  discardAutosave,
  loadAutosave,
  openProject,
  saveProjectInPlace
} from './projectFile'
import { cleanBakes, collectUsedNames, type UsedNameSources } from './reonedUsage'

const DAY = 24 * 60 * 60 * 1000
const now = Date.now()
// Distinct per test: the session's names live for the whole module, as they do in the app.
const name = (tag: string): string => `${tag.padStart(32, '0')}.baked.wav`
const win = {} as BrowserWindow
let dir: string
let root: string
let bakes: string

function oldCopy(n: string): string {
  const path = join(bakes, n)
  writeFileSync(path, Buffer.alloc(100))
  const t = (now - 2 * DAY) / 1000
  utimesSync(path, t, t)
  return path
}
function projectJson(...names: string[]): string {
  return JSON.stringify({ rifffs: { g: { stems: names.map((n) => ({ path: join(bakes, n) })) } } })
}
function sources(): UsedNameSources {
  return {
    libraryRoot: root,
    userDataFiles: [
      join(userDataDir, AUTOSAVE_FILENAME),
      join(userDataDir, AUTOSAVE_PREVIOUS_FILENAME)
    ],
    knownProjects: [],
    // What the renderer reported when the clean was clicked: nothing yet.
    inMemoryNames: [],
    sessionIssued: []
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sssketch-session-projects-'))
  userDataDir = join(dir, 'userData')
  musicDir = join(dir, 'Music')
  root = join(musicDir, 'sssketch', 'projects')
  bakes = join(root, '.bakes')
  mkdirSync(userDataDir, { recursive: true })
  mkdirSync(bakes, { recursive: true })
  // One library project, so the scan yields at least once.
  mkdirSync(join(root, 's'))
  writeFileSync(join(root, 's', 's.sssketchproj'), projectJson())
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('a project main hands out or writes during a clean keeps its copies', () => {
  it('an outside project opened during the scan', async () => {
    const copy = oldCopy(name('a1'))
    const ext = join(dir, 'elsewhere', 'x.sssketchproj')
    mkdirSync(join(dir, 'elsewhere'))
    writeFileSync(ext, projectJson(name('a1')))
    dialogPick.path = ext
    let opened = false
    const scan = await collectUsedNames(sources(), async () => {
      if (opened) return
      opened = true
      expect(await openProject(win)).not.toBeNull()
    })
    expect(opened).toBe(true)
    expect(scan.ok).toBe(true)
    if (!scan.ok) return
    await cleanBakes(bakes, scan.used, now)
    expect(existsSync(copy)).toBe(true)
  })

  it('a recovered autosave, deleted by the recover before the scan reads it', async () => {
    const copy = oldCopy(name('b1'))
    writeFileSync(join(userDataDir, AUTOSAVE_FILENAME), projectJson(name('b1')))
    // At launch the snapshot is offered (main hands its text to the renderer)...
    expect(loadAutosave()).not.toBeNull()
    // ...the clean is clicked (the renderer's names don't have it yet), and the recover lands
    // before the scan reaches the file: it is gone from disk.
    const src = sources()
    discardAutosave()
    const scan = await collectUsedNames(src)
    expect(scan.ok).toBe(true)
    if (!scan.ok) return
    await cleanBakes(bakes, scan.used, now)
    expect(existsSync(copy)).toBe(true)
  })

  it('an outside project saved during the scan', async () => {
    const copy = oldCopy(name('c1'))
    const ext = join(dir, 'elsewhere', 'y.sssketchproj')
    mkdirSync(join(dir, 'elsewhere'))
    let saved = false
    const scan = await collectUsedNames(sources(), async () => {
      if (saved) return
      saved = true
      saveProjectInPlace(ext, projectJson(name('c1')))
    })
    expect(saved).toBe(true)
    if (!scan.ok) return
    await cleanBakes(bakes, scan.used, now)
    expect(existsSync(copy)).toBe(true)
  })

  it('a copy no project names is still cleaned', async () => {
    const copy = oldCopy(name('d1'))
    const scan = await collectUsedNames(sources())
    if (!scan.ok) return
    await cleanBakes(bakes, scan.used, now)
    expect(existsSync(copy)).toBe(false)
  })
})
