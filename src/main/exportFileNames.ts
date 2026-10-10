import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

function sanitizeFileNamePart(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '_').trim() || 'stem'
}

/** Allocates complete filenames, not just duplicate-base counters. This
 * prevents a generated suffix (A, A -> A-2) from colliding with a later
 * source whose real name is already A-2. Matching is case-insensitive for
 * the default macOS and Windows filesystems. */
export interface StemExportFileNameAllocator {
  (rifffName: string, stemName: string, variant?: string): string
  reserve(fileName: string): void
}

export function createStemExportFileNameAllocator(): StemExportFileNameAllocator {
  const reserved = new Set<string>()
  const normalized = (fileName: string): string => fileName.normalize('NFC').toLowerCase()
  const allocate = ((rifffName: string, stemName: string, variant?: string) => {
    const variantPart = variant ? `-${sanitizeFileNamePart(variant)}` : ''
    const base = `${sanitizeFileNamePart(rifffName)}-${sanitizeFileNamePart(stemName)}${variantPart}`
    let suffix = 1
    let candidate = `${base}.wav`
    while (reserved.has(normalized(candidate))) {
      suffix += 1
      candidate = `${base}-${suffix}.wav`
    }
    reserved.add(normalized(candidate))
    return candidate
  }) as StemExportFileNameAllocator
  allocate.reserve = (fileName) => reserved.add(normalized(fileName))
  return allocate
}

export type ExternalDawFolder = 'Ableton' | 'Reaper' | 'Stems'

/** Gives each external sketch its own DAW export directory. The directory
 * may have existed before sssketch, so callers must not recursively clear it
 * without a separate ownership marker. */
export function externalDawExportLocation(
  sourcePath: string,
  dawFolder: ExternalDawFolder
): { projectName: string; outputDir: string } {
  const projectName = basename(sourcePath).replace(/\.sssketchproj$/i, '')
  return {
    projectName,
    outputDir: join(dirname(sourcePath), dawFolder, projectName)
  }
}

/** Written into an external sketch's stems folder when sssketch creates it
 * (or finds it empty): the proof of ownership that lets a later stems export
 * clear it. */
export const STEMS_FOLDER_MARKER = '.sssketch-stems'

/** The folder a stems export of an external sketch writes into,
 * `<source directory>/Stems/<project name>/`, ready to write. It replaces the
 * previous export (stale files from a removed bus or the other stems variant)
 * only when sssketch's own marker shows it made the folder: a sibling sketch's
 * stems, files the user keeps in `Stems/`, and a same-named folder that held
 * files before sssketch first wrote there are all left alone. */
export function prepareExternalStemsDir(sourcePath: string): {
  projectName: string
  outputDir: string
} {
  const location = externalDawExportLocation(sourcePath, 'Stems')
  const marker = join(location.outputDir, STEMS_FOLDER_MARKER)
  if (existsSync(marker)) rmSync(location.outputDir, { recursive: true, force: true })
  mkdirSync(location.outputDir, { recursive: true })
  if (readdirSync(location.outputDir).length === 0) writeFileSync(marker, '')
  return location
}
