import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let userDataDir: string
vi.mock('electron', () => ({ app: { getPath: () => userDataDir } }))

import {
  MAX_KNOWN_PROJECTS,
  knownProjects,
  notNowUntil,
  rememberExternalProject,
  renameKnownProject,
  setNotNow
} from './reonedCopiesStore'

const NAME = '0123456789abcdef0123456789abcdef.baked.wav'

beforeEach(() => {
  userDataDir = mkdtempSync(join(tmpdir(), 'sssketch-reoned-store-'))
})
afterEach(() => rmSync(userDataDir, { recursive: true, force: true }))

describe('remembered external projects', () => {
  it('keeps the path and the copies it named, newest first, once per path', () => {
    rememberExternalProject('/ext/a.sssketchproj', `{"path":"/lib/.bakes/${NAME}"}`, 1)
    rememberExternalProject('/ext/b.sssketchproj', '{}', 2)
    rememberExternalProject('/ext/a.sssketchproj', `{"path":"/lib/.bakes/${NAME}"}`, 3)
    expect(knownProjects()).toEqual([
      { path: '/ext/a.sssketchproj', names: [NAME], at: 3 },
      { path: '/ext/b.sssketchproj', names: [], at: 2 }
    ])
  })

  it(`caps at ${MAX_KNOWN_PROJECTS}, dropping the oldest`, () => {
    for (let i = 0; i < MAX_KNOWN_PROJECTS + 5; i++) {
      rememberExternalProject(`/ext/${i}.sssketchproj`, '{}', i)
    }
    const list = knownProjects()
    expect(list).toHaveLength(MAX_KNOWN_PROJECTS)
    expect(list.at(-1)?.path).toBe('/ext/5.sssketchproj')
  })

  it('follows a rename', () => {
    rememberExternalProject('/ext/a.sssketchproj', `"${NAME}"`, 1)
    renameKnownProject('/ext/a.sssketchproj', '/ext/b.sssketchproj')
    expect(knownProjects()).toEqual([{ path: '/ext/b.sssketchproj', names: [NAME], at: 1 }])
  })

  it('a missing or corrupt file reads as empty, and the next write replaces it', () => {
    expect(knownProjects()).toEqual([])
    writeFileSync(join(userDataDir, 'reonedCopies.json'), '{not json')
    expect(knownProjects()).toEqual([])
    expect(notNowUntil()).toBeNull()
    rememberExternalProject('/ext/a.sssketchproj', '{}', 1)
    expect(knownProjects()).toHaveLength(1)
  })

  it('a write that fails is logged, never thrown into a save or an open', () => {
    userDataDir = join(userDataDir, 'no', 'such', 'folder')
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => rememberExternalProject('/ext/a.sssketchproj', '{}', 1)).not.toThrow()
    expect(log).toHaveBeenCalled()
    log.mockRestore()
  })
})

describe('not now', () => {
  it('is stored as a time, and absent by default', () => {
    expect(notNowUntil()).toBeNull()
    setNotNow(1000)
    expect(notNowUntil()).toBe(1000 + 7 * 24 * 60 * 60 * 1000)
  })

  it('survives remembering a project, and remembering survives it', () => {
    setNotNow(1000)
    rememberExternalProject('/ext/a.sssketchproj', '{}', 1)
    setNotNow(2000)
    expect(notNowUntil()).toBe(2000 + 7 * 24 * 60 * 60 * 1000)
    expect(knownProjects()).toHaveLength(1)
  })
})
