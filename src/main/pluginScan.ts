// src/main/pluginScan.ts
import { spawn } from 'node:child_process'
import { readdirSync } from 'node:fs'
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
  { success: true; plugins: ScannedPlugin[] } | { success: false; error: string }

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

function defaultBinaryPath(): string {
  return join(
    app.getAppPath(),
    'native-engine/build/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine'
  )
}

export interface ScanOneOptions {
  binaryPathOverride?: string
  timeoutMs?: number
}

/** Probes a single candidate plugin path in a fresh, isolated, short-lived
 * subprocess (native-engine's own --scan-one-json mode) with a hard
 * timeout. A hang, crash, or non-zero exit is reported as success:false and
 * never throws -- this function is called once per candidate across a
 * whole-directory scan, and one bad plugin must never take down the rest of
 * the scan. Matches native-engine/PHASE0_FINDINGS.md's own explicit
 * recommendation: "scan each plugin candidate in an isolated subprocess
 * with a timeout." */
export function scanOneCandidate(
  path: string,
  options: ScanOneOptions = {}
): Promise<ScanOneResult> {
  const binaryPath = options.binaryPathOverride ?? defaultBinaryPath()
  const timeoutMs = options.timeoutMs ?? 10000

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
