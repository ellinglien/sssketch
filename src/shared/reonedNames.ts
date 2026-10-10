// What counts as naming a re-oned stem copy (decision D7 in the plan): its basename, anywhere.
// Copy names are 32-hex recipe names or legacy uuids, so a plain regex over raw JSON text needs
// no unescaping, and a project that names a copy under an old library root still protects it.
// EEEDIT's renders in `<library>/.shapes` follow the same rules (a lane render `<uuid>.shape.wav`,
// an intervention bake `<uuid>.shape-base.wav`): the cleanup's used set holds both kinds.

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

const SHAPE_FILE = /^[0-9A-Za-z_-]+\.shape(-base)?\.wav$/

/** An EEEDIT render the cleanup may remove from `.shapes` when unused. Not the preview cache's
 * own entries (`.shape-preview.wav` and kin), which that cache bounds by itself. */
export function isShapeAssetFileName(name: string): boolean {
  return SHAPE_FILE.test(name)
}

const SUFFIXES = ['.baked.wav', '.shape.wav', '.shape-base.wav']
/** Longer than any copy name's stem (32 hex, or a 36-character legacy uuid). */
const MAX_STEM_CHARS = 96

function isNameChar(code: number): boolean {
  return (
    (code >= 48 && code <= 57) || // 0-9
    (code >= 65 && code <= 90) || // A-Z
    (code >= 97 && code <= 122) || // a-z
    code === 95 || // _
    code === 45 // -
  )
}

/** Every copy name in `text`. Finds each suffix (`.baked.wav`, and EEEDIT's) and walks back over name characters, so
 * it stays linear in the text's length: a regex like NAME_SOURCE, run over a long run of name
 * characters (a base64 plugin state of zeros), backtracks quadratically and would block the
 * main thread for minutes on one project. */
export function reonedNamesInText(text: string, into: Set<string> = new Set()): Set<string> {
  for (const suffix of SUFFIXES) {
    for (let at = text.indexOf(suffix); at !== -1; at = text.indexOf(suffix, at + suffix.length)) {
      let start = at
      while (start > 0 && at - start < MAX_STEM_CHARS && isNameChar(text.charCodeAt(start - 1))) {
        start--
      }
      if (start < at) into.add(text.slice(start, at + suffix.length))
    }
  }
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
      if (value.includes('.baked.wav') || value.includes('.shape')) reonedNamesInText(value, into)
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
