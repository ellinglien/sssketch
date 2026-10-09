// What counts as naming a re-oned stem copy (decision D7 in the plan): its basename, anywhere.
// Copy names are 32-hex recipe names or legacy uuids, so a plain regex over raw JSON text needs
// no unescaping, and a project that names a copy under an old library root still protects it.

const NAME_SOURCE = '[0-9A-Za-z_-]+\\.baked\\.wav'
const COPY_FILE = new RegExp(`^${NAME_SOURCE}$`)
const TEMP_FILE = /^\..+\.baking\.wav$/

export function isReonedCopyFileName(name: string): boolean {
  return COPY_FILE.test(name)
}

/** A bake's unpublished temporary: a crash mid-bake leaves one (decision D11). */
export function isStaleTempFileName(name: string): boolean {
  return TEMP_FILE.test(name)
}

export function reonedNamesInText(text: string, into: Set<string> = new Set()): Set<string> {
  const pattern = new RegExp(NAME_SOURCE, 'g')
  for (const match of text.matchAll(pattern)) into.add(match[0])
  return into
}

/** Every copy name in a tree of plain values: the history's states (which share structure, so
 * each object is visited once), a Cross draft, Discover's slots. */
export function collectReonedNames(
  roots: readonly unknown[],
  into: Set<string> = new Set()
): Set<string> {
  const seen = new WeakSet<object>()
  const stack: unknown[] = [...roots]
  while (stack.length > 0) {
    const value = stack.pop()
    if (typeof value === 'string') {
      if (value.includes('.baked.wav')) reonedNamesInText(value, into)
      continue
    }
    if (value === null || typeof value !== 'object') continue
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) continue
    if (seen.has(value)) continue
    seen.add(value)
    if (Array.isArray(value)) {
      for (const item of value) stack.push(item)
    } else if (value instanceof Map) {
      for (const [k, v] of value) stack.push(k, v)
    } else if (value instanceof Set) {
      for (const item of value) stack.push(item)
    } else {
      for (const item of Object.values(value as Record<string, unknown>)) stack.push(item)
    }
  }
  return into
}
