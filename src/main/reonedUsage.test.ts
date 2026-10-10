import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

// bakeOffset (the reuse-between-scan-and-delete case) only bakes WAVs here; its native path,
// which reads app.getAppPath(), is never reached.
vi.mock('electron', () => ({ app: { getAppPath: () => process.cwd() } }))

import {
  cleanBakes,
  cleanShapes,
  collectUsedNames,
  isReadByLibraryWalk,
  surveyBakes,
  surveyShapes,
  type UsedNameSources
} from './reonedUsage'
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

  it('reads the autosave before the library (I1)', async () => {
    // A recover deletes the autosave; reading it first leaves the library's walk no chance to
    // let one in before it is read.
    project(join(root, 's', 's.sssketchproj'), 1)
    project(join(userData, 'autosave.sssketchproj'), 3)
    const scan = await collectUsedNames(sources(), async () => {
      rmSync(join(userData, 'autosave.sssketchproj'), { force: true })
    })
    expect(scan.ok && sorted(scan.used)).toEqual([name(1), name(3)])
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

// Review finding I2: projectFile.ts's isInsideLibrary counts any path under the root as a library
// project (so it isn't remembered), so the scan must find a project anywhere under the root.
describe('collectUsedNames: the whole library tree', () => {
  it('a project two or more folders deep (a sketch name with a slash), and its backups', async () => {
    project(join(root, 'a', 'b', 'a', 'b.sssketchproj'), 1)
    project(join(root, 'a', 'b', '.backups', 'b-2026-10-01.sssketchproj'), 2)
    project(join(root, 'x', 'y', 'z', 'deep.sssketchproj'), 3)
    const scan = await collectUsedNames(sources())
    expect(scan.ok && sorted(scan.used)).toEqual([name(1), name(2), name(3)])
  })

  it('a dot-named sketch folder', async () => {
    project(join(root, '.hidden', '.hidden.sssketchproj'), 4)
    project(join(root, '.hidden', '.backups', '.hidden-1.sssketchproj'), 5)
    const scan = await collectUsedNames(sources())
    expect(scan.ok && sorted(scan.used)).toEqual([name(4), name(5)])
  })

  it('every file in a .backups folder, whatever it is named', async () => {
    project(join(root, 's', '.backups', 'kept-by-hand.json'), 6)
    const scan = await collectUsedNames(sources())
    expect(scan.ok && sorted(scan.used)).toEqual([name(6)])
  })

  it('a symlinked folder is followed, and a cycle back up the tree ends', async () => {
    const outside = join(dir, 'outside')
    project(join(outside, 'p', 'p.sssketchproj'), 7)
    symlinkSync(outside, join(root, 'linked'))
    // Back to the library root, and to itself: each folder is walked once.
    symlinkSync(root, join(outside, 'up'))
    symlinkSync(join(outside, 'p'), join(outside, 'p', 'self'))
    const scan = await collectUsedNames(sources())
    expect(scan.ok && sorted(scan.used)).toEqual([name(7)])
  })

  it('a symlinked project file is read', async () => {
    project(join(dir, 'outside', 'q.sssketchproj'), 8)
    mkdirSync(join(root, 'q'))
    symlinkSync(join(dir, 'outside', 'q.sssketchproj'), join(root, 'q', 'q.sssketchproj'))
    const scan = await collectUsedNames(sources())
    expect(scan.ok && sorted(scan.used)).toEqual([name(8)])
  })

  it('stops at a symlink whose target is away (it may be a folder of projects)', async () => {
    symlinkSync(join(dir, 'unplugged', 'projects'), join(root, 'away'))
    const scan = await collectUsedNames(sources())
    expect(scan).toEqual({ ok: false, path: join(root, 'away') })
  })

  it.skipIf(process.getuid?.() === 0)(
    'stops at a folder that cannot be listed, and names it',
    async () => {
      mkdirSync(join(root, 'locked'))
      chmodSync(join(root, 'locked'), 0o000)
      try {
        const scan = await collectUsedNames(sources())
        expect(scan).toEqual({ ok: false, path: join(root, 'locked') })
      } finally {
        chmodSync(join(root, 'locked'), 0o755)
      }
    }
  )

  it("skips the app's own caches: .bakes and .samples-cache are never read", async () => {
    project(join(root, '.samples-cache', 'odd.sssketchproj'), 1)
    project(join(bakes, 'odd.sssketchproj'), 2)
    const scan = await collectUsedNames(sources())
    expect(scan.ok && sorted(scan.used)).toEqual([])
  })

  it('yields between folders, so a big tree never blocks the main thread', async () => {
    for (let i = 0; i < 20; i++) mkdirSync(join(root, `sketch-${i}`, 'Stems'), { recursive: true })
    let yields = 0
    const scan = await collectUsedNames(sources(), async () => void yields++)
    expect(scan.ok).toBe(true)
    expect(yields).toBeGreaterThanOrEqual(40)
  })
})

describe('isReadByLibraryWalk: what projectFile.ts counts as inside the library', () => {
  it('agrees with the walk', () => {
    const lib = '/lib'
    expect(isReadByLibraryWalk('/lib/s/s.sssketchproj', lib)).toBe(true)
    expect(isReadByLibraryWalk('/lib/a/b/a/b.sssketchproj', lib)).toBe(true)
    expect(isReadByLibraryWalk('/lib/.hidden/.hidden.sssketchproj', lib)).toBe(true)
    expect(isReadByLibraryWalk('/lib/s/.backups/whatever', lib)).toBe(true)
    expect(isReadByLibraryWalk('/lib/top.sssketchproj', lib)).toBe(true)
    // Not read by the walk, so remembered instead.
    expect(isReadByLibraryWalk('/lib/.bakes/x.sssketchproj', lib)).toBe(false)
    expect(isReadByLibraryWalk('/lib/.samples-cache/x.sssketchproj', lib)).toBe(false)
    expect(isReadByLibraryWalk('/lib/s/notes.json', lib)).toBe(false)
    expect(isReadByLibraryWalk('/library/x.sssketchproj', lib)).toBe(false)
    expect(isReadByLibraryWalk('/lib/../x.sssketchproj', lib)).toBe(false)
    expect(isReadByLibraryWalk('/lib', lib)).toBe(false)
    expect(isReadByLibraryWalk('/lib/..odd/x.sssketchproj', lib)).toBe(true)
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
    // The survey sees copy 1 as old and unused...
    const survey = await surveyBakes(bakes, new Set(), now)
    expect(survey.unused.map((f) => f.name)).toContain(name(1))
    // ...then something writes it again (a rebuild landing on the same name) before the clean.
    age(join(bakes, name(1)), 0)
    const result = await cleanBakes(bakes, new Set(), now, () => [])
    expect(result.deletedCount).toBe(8)
    expect(readdirSync(bakes)).toEqual([name(1)])
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

describe('surveyShapes and cleanShapes: EEEDIT renders follow the same rules', () => {
  const lane = (n: number): string =>
    `${String(n).padStart(8, '0')}-aaaa-bbbb-cccc-dddddddddddd.shape.wav`
  const base = (n: number): string =>
    `${String(n).padStart(8, '0')}-aaaa-bbbb-cccc-dddddddddddd.shape-base.wav`
  let shapes: string
  function file(path: string, ageMs = 2 * DAY, bytes = 1000): void {
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, Buffer.alloc(bytes))
    age(path, ageMs)
  }
  beforeEach(() => {
    shapes = join(root, '.shapes')
    file(join(shapes, lane(1)))
    file(join(shapes, lane(2)))
    file(join(shapes, base(3)))
    file(join(shapes, lane(4)), DAY - 60_000)
    file(join(shapes, 'notes.txt'))
    file(join(shapes, '.preview-cache', 'abc.shape-preview.wav'))
    file(join(shapes, '.job-1-uuid', '1.rendering.wav'), 2 * DAY, 300)
    age(join(shapes, '.job-1-uuid'), 2 * DAY)
    file(join(shapes, '.preview-cache', '.job-2-uuid', '1.rendering.wav'), 2 * DAY, 200)
    age(join(shapes, '.preview-cache', '.job-2-uuid'), 2 * DAY)
    file(join(shapes, '.job-3-uuid', '1.rendering.wav'), 0, 100)
  })

  it('unused renders and stale staging folders more than a day old, nothing else', async () => {
    const used = new Set([lane(1)])
    const survey = await surveyShapes(shapes, used, now)
    expect(survey.unusedBytes).toBe(1000 + 1000 + 300 + 200)
    const result = await cleanShapes(shapes, used, now, () => [])
    expect(result).toEqual({ freedBytes: 2500, deletedCount: 4, failedCount: 0 })
    expect(readdirSync(shapes).sort()).toEqual(
      ['.job-3-uuid', '.preview-cache', lane(1), lane(4), 'notes.txt'].sort()
    )
    expect(readdirSync(join(shapes, '.preview-cache'))).toEqual(['abc.shape-preview.wav'])
  })

  it('keeps a render this session handed out, read inside the lock', async () => {
    const result = await cleanShapes(shapes, new Set(), now, () => [lane(2), base(3)])
    expect(existsSync(join(shapes, lane(2)))).toBe(true)
    expect(existsSync(join(shapes, base(3)))).toBe(true)
    expect(existsSync(join(shapes, lane(1)))).toBe(false)
    expect(result.deletedCount).toBe(3)
  })

  it('no .shapes folder at all: nothing unused, nothing cleaned', async () => {
    rmSync(shapes, { recursive: true })
    expect(await surveyShapes(shapes, new Set(), now)).toEqual({ unused: [], unusedBytes: 0 })
  })

  it('the library walk never reads inside .shapes', async () => {
    project(join(shapes, 'stray.sssketchproj'), 1)
    const scan = await collectUsedNames(sources())
    expect(scan.ok && sorted(scan.used)).toEqual([])
    expect(isReadByLibraryWalk(join(shapes, 'stray.sssketchproj'), root)).toBe(false)
  })
})
