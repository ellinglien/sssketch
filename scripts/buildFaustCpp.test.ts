import { createHash } from 'node:crypto'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  dspNames,
  FAUST_DIR,
  GENERATED_DIR,
  generateAll,
  installedVersion,
  PINNED_VERSION
} from './build-faust-cpp.mjs'

const version = installedVersion()
if (version === null) {
  console.warn(
    `buildFaustCpp.test.ts: the regenerate-and-compare drift check is skipped -- no \`faust\` on PATH. ` +
      `Expected in CI (its runners have no faust): CI checks the .dsp hashes only; the full drift check and ` +
      `the bit-exact FaustStageTests run locally (want faust ${PINNED_VERSION}: brew install faust && brew pin faust)`
  )
}

describe.skipIf(version === null)(
  'generated Faust C++ (native-engine/Source/dsp/faust/generated)',
  () => {
    const tmp = mkdtempSync(join(tmpdir(), 'faust-cpp-'))
    afterAll(() => rmSync(tmp, { recursive: true, force: true }))

    it('the installed compiler is the pinned one', () => {
      expect(version).toBe(PINNED_VERSION)
    })

    it('the committed headers are exactly what the pinned compiler makes of each .dsp', () => {
      // Fails when a .dsp was edited without `node scripts/build-faust-cpp.mjs`, or the compiler moved.
      generateAll(tmp)
      const names = dspNames()
      expect(names.length).toBeGreaterThan(0)
      expect(readdirSync(GENERATED_DIR).sort()).toEqual(names.map((n) => `${n}.h`).sort())
      for (const name of names) {
        expect(readFileSync(join(GENERATED_DIR, `${name}.h`), 'utf8'), `${name}.h`).toBe(
          readFileSync(join(tmp, `${name}.h`), 'utf8')
        )
      }
    }, 60_000)

    it('no GRAME architecture code and no machine path is in the output', () => {
      for (const name of dspNames()) {
        const text = readFileSync(join(GENERATED_DIR, `${name}.h`), 'utf8')
        expect(text).not.toMatch(/FAUST Architecture File|BEGIN dsp\.h|BEGIN UI\.h|BEGIN meta\.h/)
        expect(text).not.toMatch(/\/Users\/|\/home\/|\/private\/|\/tmp\//)
        expect(text).toMatch(/namespace sssketch::faust/)
      }
    })
  }
)

// Needs no compiler, so it runs in CI too: each .dsp is the one the committed C++ was generated
// from (line 2 of generated/<name>.h) and the one the golden vectors were rendered from
// (native-engine/test/golden/manifest.json). An edited .dsp without a regenerate fails here.
describe('the .dsp files, the generated C++ and the golden vectors agree (hashes; no faust needed)', () => {
  const sha = (p: string): string => createHash('sha256').update(readFileSync(p)).digest('hex')
  const manifest = JSON.parse(
    readFileSync(join(FAUST_DIR, '..', '..', '..', 'test', 'golden', 'manifest.json'), 'utf8')
  ) as { dsps: Record<string, { dspSha256: string }> }

  it('every .dsp has a header and a golden render', () => {
    expect(Object.keys(manifest.dsps).sort()).toEqual(dspNames())
  })

  for (const name of dspNames()) {
    it(`${name}.dsp`, () => {
      const dsp = sha(join(FAUST_DIR, `${name}.dsp`))
      const line2 = readFileSync(join(GENERATED_DIR, `${name}.h`), 'utf8').split('\n')[1]
      expect(/sha256 ([0-9a-f]{64})/.exec(line2)?.[1], `generated/${name}.h line 2`).toBe(dsp)
      expect(manifest.dsps[name]?.dspSha256, 'manifest.json').toBe(dsp)
    })
  }
})
