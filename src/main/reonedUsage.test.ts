import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

// bakeOffset (the reuse-between-scan-and-delete case) only bakes WAVs here; its native path,
// which reads app.getAppPath(), is never reached.
vi.mock('electron', () => ({ app: { getAppPath: () => process.cwd() } }))

import { cleanBakes, collectUsedNames, surveyBakes, type UsedNameSources } from './reonedUsage'
import { bakeOffset } from './bakeOffset'
import { resolveRecipe } from './reonedRecipe'
import { sessionIssuedNames } from './reonedCopiesSession'

const DAY = 24 * 60 * 60 * 1000
const name = (n: number): string => `${String(n).padStart(32, '0')}.baked.wav`
let dir: string
let root: string
let bakes: string
let userData: string
const now = Date.now()

function age(path: string, ageMs: number): void {
  const t = (now - ageMs) / 1000
  utimesSync(path, t, t)
}
function copy(n: number, ageMs = 2 * DAY, bytes = 1000): void {
  const path = join(bakes, name(n))
  writeFileSync(path, Buffer.alloc(bytes))
  age(path, ageMs)
}
function project(path: string, ...names: number[]): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(
    path,
    JSON.stringify({
      rifffs: { g: { stems: names.map((n) => ({ path: `/anywhere/.bakes/${name(n)}` })) } }
    })
  )
}
function sources(over: Partial<UsedNameSources> = {}): UsedNameSources {
  return {
    libraryRoot: root,
    userDataFiles: [
      join(userData, 'autosave.sssketchproj'),
      join(userData, 'autosave.previous.sssketchproj')
    ],
    knownProjects: [],
    inMemoryNames: [],
    sessionIssued: [],
    ...over
  }
}
const sorted = (set: Set<string>): string[] => [...set].sort()

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sssketch-usage-'))
  root = join(dir, 'lib')
  bakes = join(root, '.bakes')
  userData = join(dir, 'userData')
  mkdirSync(bakes, { recursive: true })
  mkdirSync(userData)
  for (let n = 1; n <= 9; n++) copy(n)
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('collectUsedNames: each source on its own keeps a copy', () => {
  it('library projects, their backups, autosave and the aside snapshot', async () => {
    project(join(root, 's', 's.sssketchproj'), 1)
    project(join(root, 's', '.backups', 's-2026-10-01.sssketchproj'), 2)
    project(join(userData, 'autosave.sssketchproj'), 3)
    project(join(userData, 'autosave.previous.sssketchproj'), 4)
    const scan = await collectUsedNames(sources())
    expect(scan.ok && sorted(scan.used)).toEqual([name(1), name(2), name(3), name(4)])
  })

  it('a remembered outside project: read when it is there, remembered names when it is not', async () => {
    const ext = join(dir, 'elsewhere', 'x.sssketchproj')
    project(ext, 5)
    const scan = await collectUsedNames(
      sources({
        knownProjects: [
          { path: ext, names: [], at: 1 },
          { path: join(dir, 'unplugged', 'y.sssketchproj'), names: [name(6)], at: 2 }
        ]
      })
    )
    expect(scan.ok && sorted(scan.used)).toEqual([name(5), name(6)])
  })

  it('the in-memory project, undo, cross and discover (reported by the renderer), and this session', async () => {
    const scan = await collectUsedNames(
      sources({ inMemoryNames: [name(7)], sessionIssued: [name(8)] })
    )
    expect(scan.ok && sorted(scan.used)).toEqual([name(7), name(8)])
  })

  it('a project too big for one slice still yields between chunks, and finds a name across a cut', async () => {
    const big = join(root, 'big', 'big.sssketchproj')
    mkdirSync(join(root, 'big'))
    // Lands name(9) across the 1 MB slice boundary.
    writeFileSync(
      big,
      `{"pad":"${'x'.repeat(999_990)}","p":"${name(9)}","q":"${'y'.repeat(2_000_000)}"}`
    )
    let yields = 0
    const scan = await collectUsedNames(sources(), async () => void yields++)
    expect(scan.ok && scan.used.has(name(9))).toBe(true)
    expect(yields).toBeGreaterThanOrEqual(3)
  })

  it.skipIf(process.getuid?.() === 0)(
    'stops when a library project cannot be read (D10)',
    async () => {
      project(join(root, 's', 's.sssketchproj'), 1)
      chmodSync(join(root, 's', 's.sssketchproj'), 0o000)
      try {
        const scan = await collectUsedNames(sources())
        expect(scan).toEqual({ ok: false, path: join(root, 's', 's.sssketchproj') })
      } finally {
        chmodSync(join(root, 's', 's.sssketchproj'), 0o644)
      }
    }
  )

  it('stops when the library itself cannot be listed (an unplugged drive)', async () => {
    const scan = await collectUsedNames(sources({ libraryRoot: join(dir, 'unplugged') }))
    expect(scan.ok).toBe(false)
  })
})

describe('surveyBakes and cleanBakes', () => {
  it('a copy younger than a day is never unused (the grace day)', async () => {
    copy(10, DAY - 60_000)
    const survey = await surveyBakes(bakes, new Set(), now)
    expect(survey.unused.map((f) => f.name)).not.toContain(name(10))
    expect(survey.unused).toHaveLength(9)
  })

  it('counts stale temporaries; deletes only unused files; reports the freed size', async () => {
    const temp = join(bakes, `.${name(1)}.abcd.baking.wav`)
    writeFileSync(temp, Buffer.alloc(500))
    age(temp, 2 * DAY)
    writeFileSync(join(bakes, 'notes.txt'), 'not ours')
    age(join(bakes, 'notes.txt'), 2 * DAY)
    const used = new Set([name(1), name(2)])
    const survey = await surveyBakes(bakes, used, now)
    expect(survey.unusedBytes).toBe(7 * 1000 + 500)
    const result = await cleanBakes(bakes, used, now, () => [])
    expect(result).toEqual({ freedBytes: 7500, deletedCount: 8, failedCount: 0 })
    expect(readdirSync(bakes).sort()).toEqual([name(1), name(2), 'notes.txt'].sort())
  })

  it('re-checks age right before deleting: a copy refreshed since the survey stays', async () => {
    // "now" too early: nothing is old enough.
    const result = await cleanBakes(bakes, new Set(), now - 3 * DAY, () => [])
    expect(result.deletedCount).toBe(0)
  })

  it('no .bakes folder at all: nothing unused, nothing cleaned', async () => {
    rmSync(bakes, { recursive: true })
    expect(await surveyBakes(bakes, new Set(), now)).toEqual({ unused: [], unusedBytes: 0 })
    expect(await cleanBakes(bakes, new Set(), now, () => [])).toEqual({
      freedBytes: 0,
      deletedCount: 0,
      failedCount: 0
    })
  })

  it('a copy a bake reuses between the scan and the delete is kept: issued names are read inside the lock', async () => {
    // An old, unused copy under its recipe name, put there by an earlier session (so not in
    // this session's issued names).
    const source = join(dir, 'source.wav')
    const wav = Buffer.alloc(44 + 2000)
    wav.write('RIFF', 0)
    wav.writeUInt32LE(36 + 2000, 4)
    wav.write('WAVE', 8)
    wav.write('fmt ', 12)
    wav.writeUInt32LE(16, 16)
    wav.writeUInt16LE(1, 20)
    wav.writeUInt16LE(1, 22)
    wav.writeUInt32LE(1000, 24)
    wav.writeUInt32LE(2000, 28)
    wav.writeUInt16LE(2, 32)
    wav.writeUInt16LE(16, 34)
    wav.write('data', 36)
    wav.writeUInt32LE(2000, 40)
    writeFileSync(source, wav)
    const made = { bakedPath: join(bakes, (await resolveRecipe(source, 0.25)).name) }
    writeFileSync(made.bakedPath, wav)
    age(made.bakedPath, 2 * DAY)
    expect(sessionIssuedNames().has(basename(made.bakedPath))).toBe(false)
    // The scan ran before anything handed the copy out: as far as it knows, it is unused.
    const scannedUsed = new Set<string>()
    // Then a re-one reuses it (queued on the lock first), and the clean runs.
    const reuse = bakeOffset([{ path: source, rotationSec: 0.25 }], bakes)
    const clean = cleanBakes(bakes, scannedUsed, now)
    expect((await reuse)[0].bakedPath).toBe(made.bakedPath)
    await clean
    expect(existsSync(made.bakedPath)).toBe(true)
    expect(readdirSync(bakes)).toContain(basename(made.bakedPath))
  })
})
