// src/main/pluginScan.ts
import { spawn } from 'node:child_process'
import { readdirSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

export interface ScannedPlugin {
  name: string
  manufacturer: string
  identifierString: string
  arch: 'arm64' | 'x86_64' | 'universal' | 'unknown'
  isInstrument: boolean
}

export type ScanOneResult =
  | { success: true; plugins: ScannedPlugin[] }
  // `arch` is only ever present here when the native side could still
  // determine it despite the scan itself failing (e.g. it could read the
  // Mach-O header via `file` even though it couldn't dlopen the plugin's
  // own code to enumerate its types) -- see scanOneCandidate's own bridge
  // fallback below, which is the reason this needs to be readable at all.
  | { success: false; error: string; arch?: 'arm64' | 'x86_64' | 'universal' | 'unknown' }

export function isVst3Candidate(filename: string): boolean {
  return filename.toLowerCase().endsWith('.vst3')
}

export function isAuCandidate(filename: string): boolean {
  return filename.toLowerCase().endsWith('.component')
}

const VST3_DIRECTORY = '/Library/Audio/Plug-Ins/VST3'
const AU_DIRECTORY = '/Library/Audio/Plug-Ins/Components'

/** Lists candidate .vst3 bundle paths under the fixed VST3 plugin directory.
 * Pure directory listing -- no plugin code runs, so this carries none of the
 * hang/crash risk documented in native-engine/PHASE0_FINDINGS.md; that risk
 * only exists once a plugin's own code actually gets loaded, which is
 * scanOneCandidate's job below, always in its own isolated subprocess. */
export function listVst3Candidates(): string[] {
  let entries: string[]
  try {
    entries = readdirSync(VST3_DIRECTORY)
  } catch {
    return [] // no VST3 directory on this machine -- not an error, just nothing to scan
  }
  return entries.filter(isVst3Candidate).map((name) => join(VST3_DIRECTORY, name))
}

/** Lists candidate .component bundle paths under the fixed AU plugin
 * directory. Same pure-directory-listing reasoning as listVst3Candidates
 * above -- the real risk (PHASE0_FINDINGS.md documents a real infinite
 * assertion loop in JUCE's AU scanner against some system-style multi-type
 * component bundles) only exists once a candidate's plugin code actually
 * loads, which scanOneCandidate isolates per-candidate with a hard timeout.
 * That's what makes scanning this directory safe now, unlike the naive
 * whole-directory sweep PHASE0_FINDINGS.md was written against. */
export function listAuCandidates(): string[] {
  let entries: string[]
  try {
    entries = readdirSync(AU_DIRECTORY)
  } catch {
    return [] // no Components directory on this machine -- not an error, just nothing to scan
  }
  return entries.filter(isAuCandidate).map((name) => join(AU_DIRECTORY, name))
}

/** Every scan candidate across both supported formats -- the single entry
 * point runFullScan.ts uses. */
export function listPluginCandidates(): string[] {
  return [...listVst3Candidates(), ...listAuCandidates()]
}

/** A candidate bundle's own mtime, in milliseconds -- `null` on any stat
 * failure (doesn't exist, permission error, race condition against
 * listPluginCandidates' own directory listing). Never throws. Used by
 * runFullScan.ts to skip re-scanning a candidate whose bundle hasn't
 * changed since the last scan -- see
 * docs/superpowers/specs/2026-08-02-plugin-rescan-caching-design.md. */
export function getMtimeMs(path: string): number | null {
  try {
    return statSync(path).mtimeMs
  } catch {
    return null
  }
}

function defaultBinaryPath(): string {
  // Mirrors engineProcess.ts's own defaultBinaryPath() dev-vs-packaged
  // branch exactly. Packaged mode: the engine bundle ships as an
  // extraResources copy (see electron-builder.yml) under the app's own
  // Resources directory. This function previously always used the dev-mode
  // path below, even when packaged -- meaning every scan candidate spawned
  // against a nonexistent binary in a packaged build, and a full plugin scan
  // silently found nothing.
  if (app.isPackaged) {
    return join(
      process.resourcesPath,
      'native-engine/sssketch-engine.app/Contents/MacOS/sssketch-engine'
    )
  }
  return join(
    app.getAppPath(),
    'native-engine/build/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine'
  )
}

/** Mirrors engineProcess.ts's own defaultBridgeBinaryPath() -- kept as a
 * separate, independently-resolved function here rather than imported,
 * matching this file's own existing convention of resolving its engine
 * binary path locally (defaultBinaryPath above) instead of sharing
 * engineProcess.ts's. */
function defaultBridgeBinaryPath(): string {
  if (app.isPackaged) {
    return join(
      process.resourcesPath,
      'native-engine-bridge/sssketch-bridge.app/Contents/MacOS/sssketch-bridge'
    )
  }
  return join(
    app.getAppPath(),
    'native-engine-bridge/build/sssketch_bridge_artefacts/sssketch-bridge.app/Contents/MacOS/sssketch-bridge'
  )
}

export interface ScanOneOptions {
  binaryPathOverride?: string
  bridgeBinaryPathOverride?: string
  timeoutMs?: number
}

/** One spawn+timeout+parse cycle against a given binary -- shared by
 * scanOneCandidate's primary (arm64) attempt and its bridge (x86_64)
 * retry below, which are otherwise identical in shape. */
function spawnScanOneJson(
  binaryPath: string,
  path: string,
  timeoutMs: number
): Promise<ScanOneResult> {
  return new Promise((resolve) => {
    const proc = spawn(binaryPath, ['--scan-one-json', path])
    let settled = false
    let stdout = ''

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      proc.kill('SIGKILL')
      resolve({ success: false, error: `scan timed out after ${timeoutMs}ms` })
    }, timeoutMs)

    proc.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })

    proc.once('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ success: false, error: err.message })
    })

    proc.once('exit', () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        const parsed = JSON.parse(stdout.trim()) as ScanOneResult
        resolve(parsed)
      } catch {
        resolve({ success: false, error: 'scan subprocess produced no valid output' })
      }
    })
  })
}

/** Probes a single candidate plugin path in a fresh, isolated, short-lived
 * subprocess (native-engine's own --scan-one-json mode) with a hard
 * timeout. A hang, crash, or non-zero exit is reported as success:false and
 * never throws -- this function is called once per candidate across a
 * whole-directory scan, and one bad plugin must never take down the rest of
 * the scan. Matches native-engine/PHASE0_FINDINGS.md's own explicit
 * recommendation: "scan each plugin candidate in an isolated subprocess
 * with a timeout."
 *
 * The arm64 main engine can't even IDENTIFY an x86_64-only plugin's type
 * (dlopen-ing foreign-architecture code fails outright, not just
 * instantiating it) -- when that's exactly what happened (failure with
 * arch === 'x86_64'), this retries the identical scan through the x86_64
 * bridge binary instead, which can. See
 * docs/superpowers/specs/2026-08-01-x86-plugin-bridge-design.md's
 * follow-up. A missing/unbuilt bridge binary just means the original
 * arm64 failure stands -- never a hard error. */
export async function scanOneCandidate(
  path: string,
  options: ScanOneOptions = {}
): Promise<ScanOneResult> {
  const binaryPath = options.binaryPathOverride ?? defaultBinaryPath()
  const timeoutMs = options.timeoutMs ?? 10000

  const result = await spawnScanOneJson(binaryPath, path, timeoutMs)
  if (result.success || result.arch !== 'x86_64') return result

  const bridgeBinaryPath = options.bridgeBinaryPathOverride ?? defaultBridgeBinaryPath()
  if (!existsSync(bridgeBinaryPath)) return result

  return spawnScanOneJson(bridgeBinaryPath, path, timeoutMs)
}
