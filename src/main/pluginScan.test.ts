import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isVst3Candidate, scanOneCandidate } from './pluginScan'

const realBinaryPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../native-engine/build/ssstitch_engine_artefacts/ssstitch-engine.app/Contents/MacOS/ssstitch-engine'
)

describe('isVst3Candidate', () => {
  it('accepts .vst3, case-insensitively', () => {
    expect(isVst3Candidate('Foo.vst3')).toBe(true)
    expect(isVst3Candidate('Foo.VST3')).toBe(true)
  })

  it('rejects everything else', () => {
    expect(isVst3Candidate('readme.txt')).toBe(false)
    expect(isVst3Candidate('Foo.component')).toBe(false)
    expect(isVst3Candidate('.DS_Store')).toBe(false)
  })
})

describe('scanOneCandidate', () => {
  it('resolves with the found plugin(s) for a real installed VST3', async () => {
    const result = await scanOneCandidate('/Library/Audio/Plug-Ins/VST3/Solid Bus Comp.vst3', {
      binaryPathOverride: realBinaryPath,
      timeoutMs: 10000
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.plugins[0].name).toBe('Solid Bus Comp')
      expect(result.plugins[0].arch).toMatch(/arm64|universal/)
    }
  })

  it('resolves with success:false for a path with no loadable plugin type', async () => {
    const result = await scanOneCandidate('/no/such/plugin.vst3', {
      binaryPathOverride: realBinaryPath,
      timeoutMs: 10000
    })
    expect(result.success).toBe(false)
  })

  it('kills a hung probe after the timeout and resolves with success:false', async () => {
    // A fake "binary" that just sleeps -- proves the timeout+kill path works
    // without needing a real plugin that actually hangs (none of this
    // machine's installed plugins are known to hang, only some AU bundles
    // are per PHASE0_FINDINGS.md, and this app only scans VST3 anyway).
    const dir = mkdtempSync(join(tmpdir(), 'ssstitch-scan-test-'))
    const fakeBinary = join(dir, 'hang.sh')
    writeFileSync(fakeBinary, '#!/bin/sh\nsleep 30\n', { mode: 0o755 })
    try {
      const result = await scanOneCandidate('/fake/path.vst3', {
        binaryPathOverride: fakeBinary,
        timeoutMs: 300
      })
      expect(result.success).toBe(false)
      if (!result.success) expect(result.error).toMatch(/timed out/i)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
