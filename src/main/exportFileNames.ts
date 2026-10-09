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

export type ExternalDawFolder = 'Ableton' | 'Reaper'

/** Gives each external sketch its own DAW export directory. The directory
 * may have existed before sssketch, so callers must not recursively clear it
 * without a separate ownership marker. */
export function externalDawExportLocation(
  sourcePath: string,
  dawFolder: ExternalDawFolder
): { projectName: string; outputDir: string } {
  const projectName = basename(sourcePath, '.sssketchproj')
  return {
    projectName,
    outputDir: join(dirname(sourcePath), dawFolder, projectName)
  }
}
