import { parseStemFilename } from './parseFilename'
import { readWavDurationSeconds } from './wavDuration'
import type { Rifff, Stem } from './types'

export interface ScannedFile {
  filename: string
  path: string
  bytes: Uint8Array
}

// Ties are broken by first-encountered value, i.e. file traversal order (whatever
// order the caller's ScannedFile[] happens to be in) — not numerically or by any
// other stable rule. Fine for our case (mistagged BPM is rare and any of the tied
// values is a reasonable answer), but worth knowing if this ever needs to be
// deterministic across differently-ordered scans of the same folder.
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

// Endlesss folder names conventionally end in " Stems" (e.g. "my jam 150 Stems"); that
// suffix is scanner noise, not part of the rifff's actual name, so strip it. Anchored
// to the end (`$`) and requires a preceding space so a name that merely *contains*
// "Stems" mid-string (e.g. "Stems of Consciousness") is left untouched.
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
  const seenSlots = new Map<number, string>() // slot -> filename that claimed it

  for (const file of files) {
    const parsed = parseStemFilename(file.filename)
    if (!parsed) {
      console.warn(
        `buildRifff: skipping "${file.filename}" — doesn't match the expected ` +
          `"<slot> - <author> - <name> - <bpm>BPM - <timestamp>.wav" naming pattern`
      )
      continue
    }

    // A corrupt or truncated WAV shouldn't take down the whole batch — Task 6 made
    // readWavDurationSeconds throw by design for exactly this case. Skip just this
    // file and keep processing the rest of the folder.
    let durationSec: number
    try {
      durationSec = readWavDurationSeconds(file.bytes)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn(`buildRifff: skipping unreadable WAV "${file.filename}": ${message}`)
      continue
    }

    // Downstream code treats slot as a de facto primary key (map lookups, React list
    // keys), so a duplicate slot would silently break things later in a way that's
    // hard to trace back here. Keep the first-encountered file for a given slot and
    // warn about the rest — deterministic, simple, no need for anything fancier.
    const existingFilename = seenSlots.get(parsed.slot)
    if (existingFilename !== undefined) {
      console.warn(
        `buildRifff: duplicate slot ${parsed.slot} — keeping "${existingFilename}", skipping "${file.filename}"`
      )
      continue
    }
    seenSlots.set(parsed.slot, file.filename)

    bpms.push(parsed.bpm)
    stems.push({
      slot: parsed.slot,
      author: parsed.author,
      name: parsed.stemName,
      // Sound-type isn't encoded in Endlesss filenames, so every stem defaults to
      // 'fx' here. This is deliberate, not a placeholder bug — Task 13 makes it
      // user-editable via a click-to-cycle control in the UI.
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
