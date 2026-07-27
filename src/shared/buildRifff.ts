import { parseStemFilename } from './parseFilename'
import { readWavDurationSeconds } from './wavDuration'
import type { Rifff, Stem } from './types'

export interface ScannedFile {
  filename: string
  path: string
  bytes: Uint8Array
}

function mode(nums: number[]): number {
  const counts = new Map<number, number>()
  let best = nums[0]
  let bestCount = 0
  for (const n of nums) {
    const c = (counts.get(n) ?? 0) + 1
    counts.set(n, c)
    if (c > bestCount) {
      bestCount = c
      best = n
    }
  }
  return best
}

function barsForDuration(durationSec: number, bpm: number): number {
  const secPerBar = (60 / bpm) * 4
  return Math.max(1, Math.round(durationSec / secPerBar))
}

function stripTrailingStemsSuffix(folderName: string): string {
  return folderName.replace(/\s+Stems$/, '')
}

export function buildRifff(
  folderPath: string,
  folderName: string,
  files: ScannedFile[]
): Rifff | null {
  const stems: Stem[] = []
  const bpms: number[] = []

  for (const file of files) {
    const parsed = parseStemFilename(file.filename)
    if (!parsed) continue
    const durationSec = readWavDurationSeconds(file.bytes)
    bpms.push(parsed.bpm)
    stems.push({
      slot: parsed.slot,
      author: parsed.author,
      name: parsed.stemName,
      type: 'fx',
      path: file.path,
      durationSec,
      barLength: barsForDuration(durationSec, parsed.bpm)
    })
  }

  if (stems.length === 0) return null

  stems.sort((a, b) => a.slot - b.slot)

  return {
    groupId: crypto.randomUUID(),
    name: stripTrailingStemsSuffix(folderName),
    bpm: mode(bpms),
    barLength: Math.max(...stems.map((s) => s.barLength)),
    folderPath,
    stems
  }
}
