import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  dspNames,
  GENERATED_DIR,
  generateAll,
  installedVersion,
  PINNED_VERSION
} from './build-faust-cpp.mjs'

const version = installedVersion()
if (version === null) {
  console.warn(
    `buildFaustCpp.test.ts: skipped -- no \`faust\` on PATH (want ${PINNED_VERSION}: brew install faust && brew pin faust)`
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
