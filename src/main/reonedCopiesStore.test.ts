import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
  setNotNow,
  type KnownProject
} from './reonedCopiesStore'

const NAME = '0123456789abcdef0123456789abcdef.baked.wav'

/** The remembered projects, failing the test if the store isn't readable. */
function known(): KnownProject[] {
  const read = knownProjects()
  if (!read.ok) throw new Error(`store unreadable: ${read.path}`)
  return read.projects
}

beforeEach(() => {
  userDataDir = mkdtempSync(join(tmpdir(), 'sssketch-reoned-store-'))
})
afterEach(() => rmSync(userDataDir, { recursive: true, force: true }))

describe('remembered external projects', () => {
  it('keeps the path and the copies it named, newest first, once per path', () => {
    rememberExternalProject('/ext/a.sssketchproj', `{"path":"/lib/.bakes/${NAME}"}`, 1)
    rememberExternalProject('/ext/b.sssketchproj', '{}', 2)
    rememberExternalProject('/ext/a.sssketchproj', `{"path":"/lib/.bakes/${NAME}"}`, 3)
    expect(known()).toEqual([
      { path: '/ext/a.sssketchproj', names: [NAME], at: 3 },
      { path: '/ext/b.sssketchproj', names: [], at: 2 }
    ])
  })

  it(`caps at ${MAX_KNOWN_PROJECTS}, dropping the oldest`, () => {
    for (let i = 0; i < MAX_KNOWN_PROJECTS + 5; i++) {
      rememberExternalProject(`/ext/${i}.sssketchproj`, '{}', i)
    }
    const list = known()
    expect(list).toHaveLength(MAX_KNOWN_PROJECTS)
    expect(list.at(-1)?.path).toBe('/ext/5.sssketchproj')
  })

  it('follows a rename', () => {
    rememberExternalProject('/ext/a.sssketchproj', `"${NAME}"`, 1)
    renameKnownProject('/ext/a.sssketchproj', '/ext/b.sssketchproj')
    expect(known()).toEqual([{ path: '/ext/b.sssketchproj', names: [NAME], at: 1 }])
  })

  it('a missing file reads as empty', () => {
    expect(known()).toEqual([])
    expect(notNowUntil()).toBeNull()
  })

  // Review finding M1: a corrupt store may have been the only record of a project on an
  // unplugged drive, so the cleanup stops, and the file is moved aside, never overwritten.
  it('a corrupt file stops the cleanup and is moved aside, not overwritten by the next write', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const corrupt = `{"version":1,"knownProjects":[{"path":"/ext/a.sssketchproj","names":["${NAME}"`
    writeFileSync(join(userDataDir, 'reonedCopies.json'), corrupt)
    const read = knownProjects()
    expect(read.ok).toBe(false)
    const aside = readdirSync(userDataDir).filter((f) => f.startsWith('reonedCopies.corrupt-'))
    expect(aside).toHaveLength(1)
    expect(read).toEqual({ ok: false, path: join(userDataDir, aside[0]) })
    expect(readFileSync(join(userDataDir, aside[0]), 'utf-8')).toBe(corrupt)
    // Saves and opens still remember, in a fresh store; the moved-aside file is untouched and
    // keeps the cleanup stopped until someone deletes it.
    rememberExternalProject('/ext/b.sssketchproj', '{}', 1)
    setNotNow(1000)
    expect(readFileSync(join(userDataDir, aside[0]), 'utf-8')).toBe(corrupt)
    expect(knownProjects().ok).toBe(false)
    rmSync(join(userDataDir, aside[0]))
    expect(known()).toEqual([{ path: '/ext/b.sssketchproj', names: [], at: 1 }])
    expect(notNowUntil()).toBe(1000 + 7 * 24 * 60 * 60 * 1000)
    log.mockRestore()
  })

  it('a store that is valid JSON but not what this writes counts as corrupt', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    writeFileSync(
      join(userDataDir, 'reonedCopies.json'),
      JSON.stringify({ version: 1, knownProjects: [{ path: '/ext/a.sssketchproj' }] })
    )
    expect(knownProjects().ok).toBe(false)
    log.mockRestore()
  })

  it.skipIf(process.getuid?.() === 0)(
    'a store that cannot be read stops the cleanup and is left alone',
    () => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => {})
      const path = join(userDataDir, 'reonedCopies.json')
      writeFileSync(path, JSON.stringify({ version: 1, knownProjects: [] }))
      chmodSync(path, 0o000)
      try {
        expect(knownProjects()).toEqual({ ok: false, path })
        rememberExternalProject('/ext/a.sssketchproj', '{}', 1)
      } finally {
        chmodSync(path, 0o644)
        log.mockRestore()
      }
      expect(JSON.parse(readFileSync(path, 'utf-8'))).toEqual({ version: 1, knownProjects: [] })
    }
  )

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
    expect(known()).toHaveLength(1)
  })
})
