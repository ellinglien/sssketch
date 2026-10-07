import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { packagedAppProblems } = require('../build/packagedAppCheck.js') as {
  packagedAppProblems: (
    appPath: string,
    limits?: { maxAsarBytes?: number; minYamnetBytes?: number }
  ) => string[]
}

const LIMITS = { maxAsarBytes: 100, minYamnetBytes: 10 }
let dir = ''

function file(rel: string, bytes: number): void {
  const p = join(dir, 'sssketch.app', 'Contents', 'Resources', rel)
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, Buffer.alloc(bytes))
}

function completeApp(): string {
  dir = mkdtempSync(join(tmpdir(), 'sssketch-packaged-check-'))
  file('app.asar', 50)
  file('yamnet/yamnet.onnx', 20)
  file('rubberband/bin/rubberband', 1)
  file('native-engine/sssketch-engine.app/Contents/MacOS/sssketch-engine', 1)
  file('native-engine-bridge/sssketch-bridge.app/Contents/MacOS/sssketch-bridge', 1)
  file('demo-rifff/a.ogg', 1)
  return join(dir, 'sssketch.app')
}

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = ''
})

describe('packagedAppProblems', () => {
  it('passes a complete app', () => {
    expect(packagedAppProblems(completeApp(), LIMITS)).toEqual([])
  })

  it('names a missing YAMNet model (every release up to 1.4.0)', () => {
    const app = completeApp()
    rmSync(join(app, 'Contents/Resources/yamnet'), { recursive: true })
    expect(packagedAppProblems(app, LIMITS).join('\n')).toMatch(/yamnet\.onnx/)
  })

  it('names a truncated YAMNet model', () => {
    const app = completeApp()
    file('yamnet/yamnet.onnx', 3)
    expect(packagedAppProblems(app, LIMITS).join('\n')).toMatch(/yamnet\.onnx/)
  })

  it('names a missing engine, bridge or rubberband', () => {
    const app = completeApp()
    rmSync(join(app, 'Contents/Resources/native-engine'), { recursive: true })
    rmSync(join(app, 'Contents/Resources/native-engine-bridge'), { recursive: true })
    rmSync(join(app, 'Contents/Resources/rubberband'), { recursive: true })
    const problems = packagedAppProblems(app, LIMITS).join('\n')
    expect(problems).toMatch(/sssketch-engine/)
    expect(problems).toMatch(/sssketch-bridge/)
    expect(problems).toMatch(/rubberband/)
  })

  it('names an app.asar that has grown past the limit (the repo got bundled again)', () => {
    const app = completeApp()
    file('app.asar', 101)
    expect(packagedAppProblems(app, LIMITS).join('\n')).toMatch(/app\.asar/)
  })

  it('names resources/ unpacked from the asar (it ships through extraResources)', () => {
    const app = completeApp()
    file('app.asar.unpacked/resources/demo-rifff/a.ogg', 1)
    expect(packagedAppProblems(app, LIMITS).join('\n')).toMatch(/app\.asar\.unpacked\/resources/)
  })
})
