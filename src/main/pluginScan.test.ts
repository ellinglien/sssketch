import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isVst3Candidate, isAuCandidate, scanOneCandidate } from './pluginScan'

const realBinaryPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../native-engine/build/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine'
)

const realBridgeBinaryPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../native-engine-bridge/build/sssketch_bridge_artefacts/sssketch-bridge.app/Contents/MacOS/sssketch-bridge'
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

describe('isAuCandidate', () => {
  it('accepts .component, case-insensitively', () => {
    expect(isAuCandidate('Foo.component')).toBe(true)
    expect(isAuCandidate('Foo.COMPONENT')).toBe(true)
  })

  it('rejects everything else', () => {
    expect(isAuCandidate('readme.txt')).toBe(false)
    expect(isAuCandidate('Foo.vst3')).toBe(false)
    expect(isAuCandidate('.DS_Store')).toBe(false)
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

  it('retries via the bridge binary for a real x86_64-only plugin the arm64 host cannot even scan', async () => {
    // FabFilter Pro-Q 3 -- confirmed x86_64-only on this machine (no arm64
    // Mach-O slice at all). The primary (arm64) scan can't even identify
    // its plugin type, let alone load it -- this is the whole reason the
    // bridge retry exists.
    const result = await scanOneCandidate('/Library/Audio/Plug-Ins/VST3/FabFilter Pro-Q 3.vst3', {
      binaryPathOverride: realBinaryPath,
      bridgeBinaryPathOverride: realBridgeBinaryPath,
      timeoutMs: 10000
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.plugins[0].name).toBe('FabFilter Pro-Q 3')
      expect(result.plugins[0].arch).toBe('x86_64')
    }
  })

  it('does not retry via the bridge when the primary failure is unrelated to architecture', async () => {
    const result = await scanOneCandidate('/no/such/plugin.vst3', {
      binaryPathOverride: realBinaryPath,
      bridgeBinaryPathOverride: realBridgeBinaryPath,
      timeoutMs: 10000
    })
    expect(result.success).toBe(false)
  })

  it('falls back to the arm64 failure result when no bridge binary is available', async () => {
    const result = await scanOneCandidate('/Library/Audio/Plug-Ins/VST3/FabFilter Pro-Q 3.vst3', {
      binaryPathOverride: realBinaryPath,
      bridgeBinaryPathOverride: '/no/such/bridge/binary',
      timeoutMs: 10000
    })
    expect(result.success).toBe(false)
  })

  it('kills a hung probe after the timeout and resolves with success:false', async () => {
    // A fake "binary" that just sleeps -- proves the timeout+kill path works
    // without needing a real plugin that actually hangs. Some AU bundles ARE
    // known to hang a naive full-directory scan (see PHASE0_FINDINGS.md) --
    // this per-candidate isolated-subprocess-with-timeout architecture is
    // exactly what makes scanning AU safe despite that (a hang here only
    // costs one candidate's timeout, never blocks the rest of the scan).
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-scan-test-'))
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
