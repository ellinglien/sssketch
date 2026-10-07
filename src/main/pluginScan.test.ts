import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import {
  isVst3Candidate,
  isAuCandidate,
  scanOneCandidate,
  getMtimeMs,
  listPluginCandidates,
  pluginDirectories
} from './pluginScan'

const realBinaryPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../native-engine/build/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine'
)

const realBridgeBinaryPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../native-engine-bridge/build/sssketch_bridge_artefacts/sssketch-bridge.app/Contents/MacOS/sssketch-bridge'
)

// These two are real, specific, commercially-licensed plugins installed on
// this machine's own system-wide VST3 folder -- not something a fresh clone
// (including CI) has any way to have present. Matches this codebase's own
// documented convention (see CLAUDE.md's Testing Conventions): real plugin
// scanning against whatever's actually installed has no portable automated
// test, verified by manual walkthrough instead. Skipping (not deleting)
// keeps these as real regression coverage on a machine that DOES have them.
const SOLID_BUS_COMP_PATH = '/Library/Audio/Plug-Ins/VST3/Solid Bus Comp.vst3'
const FABFILTER_PROQ3_PATH = '/Library/Audio/Plug-Ins/VST3/FabFilter Pro-Q 3.vst3'
const hasSolidBusComp = existsSync(SOLID_BUS_COMP_PATH)
const hasFabFilterProQ3 = existsSync(FABFILTER_PROQ3_PATH)

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

// Share readiness S3 (2026-10-07): many plugins, most free ones, install per user into
// ~/Library/Audio/Plug-Ins. The scan reads both roots.
describe('pluginDirectories', () => {
  it('lists the system folders first, then the home folders, for both formats', () => {
    expect(pluginDirectories('/Users/someone')).toEqual({
      vst3: ['/Library/Audio/Plug-Ins/VST3', '/Users/someone/Library/Audio/Plug-Ins/VST3'],
      au: ['/Library/Audio/Plug-Ins/Components', '/Users/someone/Library/Audio/Plug-Ins/Components']
    })
  })
})

describe('listPluginCandidates', () => {
  it('finds bundles in every folder, once per bundle name (the system copy wins)', () => {
    const root = mkdtempSync(join(tmpdir(), 'sssketch-plugin-dirs-'))
    try {
      const dir = (...parts: string[]): string => {
        const d = join(root, ...parts)
        mkdirSync(d, { recursive: true })
        return d
      }
      const sysVst3 = dir('sys', 'VST3')
      const homeVst3 = dir('home', 'VST3')
      const homeAu = dir('home', 'Components')
      mkdirSync(join(sysVst3, 'Shared.vst3'))
      mkdirSync(join(homeVst3, 'Shared.vst3'))
      mkdirSync(join(homeVst3, 'Free.vst3'))
      writeFileSync(join(homeVst3, 'readme.txt'), 'x')
      mkdirSync(join(homeAu, 'Free.component'))
      const found = listPluginCandidates({
        vst3: [sysVst3, homeVst3],
        au: [join(root, 'sys', 'Components'), homeAu]
      })
      expect(found).toEqual([
        join(sysVst3, 'Shared.vst3'),
        join(homeVst3, 'Free.vst3'),
        join(homeAu, 'Free.component')
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('getMtimeMs', () => {
  it('returns the mtime (in ms) of a file that exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-mtime-test-'))
    try {
      const path = join(dir, 'fake.vst3')
      writeFileSync(path, 'x')
      const mtimeMs = getMtimeMs(path)
      expect(mtimeMs).not.toBeNull()
      expect(mtimeMs).toBeGreaterThan(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('returns null for a path that does not exist', () => {
    expect(getMtimeMs('/no/such/plugin.vst3')).toBeNull()
  })
})

describe('scanOneCandidate', () => {
  it.skipIf(!hasSolidBusComp)(
    'resolves with the found plugin(s) for a real installed VST3',
    async () => {
      const result = await scanOneCandidate(SOLID_BUS_COMP_PATH, {
        binaryPathOverride: realBinaryPath,
        timeoutMs: 10000
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.plugins[0].name).toBe('Solid Bus Comp')
        expect(result.plugins[0].arch).toMatch(/arm64|universal/)
      }
    }
  )

  it('resolves with success:false for a path with no loadable plugin type', async () => {
    const result = await scanOneCandidate('/no/such/plugin.vst3', {
      binaryPathOverride: realBinaryPath,
      timeoutMs: 10000
    })
    expect(result.success).toBe(false)
  })

  it.skipIf(!hasFabFilterProQ3)(
    'retries via the bridge binary for a real x86_64-only plugin the arm64 host cannot even scan',
    async () => {
      // FabFilter Pro-Q 3 -- confirmed x86_64-only on this machine (no arm64
      // Mach-O slice at all). The primary (arm64) scan can't even identify
      // its plugin type, let alone load it -- this is the whole reason the
      // bridge retry exists.
      const result = await scanOneCandidate(FABFILTER_PROQ3_PATH, {
        binaryPathOverride: realBinaryPath,
        bridgeBinaryPathOverride: realBridgeBinaryPath,
        timeoutMs: 10000
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.plugins[0].name).toBe('FabFilter Pro-Q 3')
        expect(result.plugins[0].arch).toBe('x86_64')
      }
    }
  )

  it('does not retry via the bridge when the primary failure is unrelated to architecture', async () => {
    const result = await scanOneCandidate('/no/such/plugin.vst3', {
      binaryPathOverride: realBinaryPath,
      bridgeBinaryPathOverride: realBridgeBinaryPath,
      timeoutMs: 10000
    })
    expect(result.success).toBe(false)
  })

  it.skipIf(!hasFabFilterProQ3)(
    'falls back to the arm64 failure result when no bridge binary is available',
    async () => {
      const result = await scanOneCandidate(FABFILTER_PROQ3_PATH, {
        binaryPathOverride: realBinaryPath,
        bridgeBinaryPathOverride: '/no/such/bridge/binary',
        timeoutMs: 10000
      })
      expect(result.success).toBe(false)
    }
  )

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
