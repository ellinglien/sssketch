/**
 * A node in REAPER's own `.rpp` project-state text format: a "field" line
 * (`TAG param1 param2 ...`, `children` undefined) or a "block"
 * (`<TAG param1 ...` / one indented line per child / `>`, `children` a
 * possibly-empty array). This module's role for RPP text is the same one
 * alsXmlHelpers.ts plays for Ableton's XML tree.
 */
export interface RppNode {
  tag: string
  /** Field values already formatted exactly as they should appear in the
   * output line (numbers as plain strings via String(), a string value
   * pre-wrapped via quote()) -- this module doesn't know which fields are
   * "supposed" to be numbers vs strings, so formatting is the caller's job
   * (mirrors alsXmlHelpers.ts's setAttr taking an already-string value). */
  params: string[]
  /** undefined for a plain field line (leaf, no brackets). Present
   * (possibly `[]`) for a block. */
  children?: RppNode[]
}

export function rppField(tag: string, ...params: (string | number)[]): RppNode {
  return { tag, params: params.map(String) }
}

export function rppBlock(tag: string, params: (string | number)[], children: RppNode[]): RppNode {
  return { tag, params: params.map(String), children }
}

/** REAPER's own string-quoting convention: double quotes around the value.
 * A literal embedded double-quote is replaced with a single quote rather
 * than implementing REAPER's full alternate-quoting scheme (backtick/
 * single-quote fallback for values containing every quote character) --
 * sssketch's real content (rifff/stem names, file paths) essentially never
 * contains a literal double-quote, and a stray single-quote substitution
 * is a harmless cosmetic difference, not a corrupt file. */
export function quote(value: string): string {
  return `"${value.replace(/"/g, "'")}"`
}

export function serializeRpp(root: RppNode): string {
  const lines: string[] = []
  function write(node: RppNode, depth: number): void {
    const indent = '  '.repeat(depth)
    const header = [node.tag, ...node.params].join(' ')
    if (node.children === undefined) {
      lines.push(`${indent}${header}`)
      return
    }
    lines.push(`${indent}<${header}`)
    for (const child of node.children) write(child, depth + 1)
    lines.push(`${indent}>`)
  }
  write(root, 0)
  return lines.join('\n')
}

/** Splits one line into its tag and params, treating a double-quoted span
 * (however it contains spaces) as a single param -- e.g. `NAME "a b c"`
 * splits into `['NAME', '"a b c"']`, not four separate tokens. Every space
 * seen outside quotes ends a token -- including one that produces an empty
 * token (e.g. a trailing space after the tag, from a param that serialized
 * to `''`) -- so an empty-string param round-trips instead of silently
 * vanishing. This relies on the caller not having trimmed trailing
 * whitespace off `line` first (see parseRpp's use of trimStart, not trim). */
function splitLine(line: string): { tag: string; params: string[] } {
  const tokens: string[] = []
  let current = ''
  let inQuotes = false
  for (const ch of line) {
    if (ch === '"') {
      inQuotes = !inQuotes
      current += ch
      continue
    }
    if (ch === ' ' && !inQuotes) {
      tokens.push(current)
      current = ''
      continue
    }
    current += ch
  }
  tokens.push(current)
  const [tag, ...params] = tokens
  return { tag, params }
}

/** Parses serializeRpp's own output back into a tree. Test-only in
 * practice (buildRppProject.ts itself only ever serializes, never
 * re-parses its own output), but exported since it's a genuinely reusable,
 * self-contained capability, not a test-internal helper.
 *
 * Uses trimStart (not trim) when reading each line: only the leading
 * indentation is structural, and a trailing space can itself be meaningful
 * (see splitLine's empty-token handling) -- trimming it away would silently
 * drop an empty-string param. */
export function parseRpp(text: string): RppNode {
  const lines = text.split('\n')
  let i = 0
  function parseNode(): RppNode {
    const raw = lines[i].trimStart()
    i++
    if (raw.startsWith('<')) {
      const { tag, params } = splitLine(raw.slice(1))
      const children: RppNode[] = []
      while (lines[i] !== undefined && lines[i].trimStart() !== '>') {
        children.push(parseNode())
      }
      if (lines[i] === undefined) {
        throw new Error(
          `parseRpp: block "${tag}" is missing its closing '>' (reached end of input)`
        )
      }
      i++ // consume the closing '>'
      return { tag, params, children }
    }
    const { tag, params } = splitLine(raw)
    return { tag, params }
  }
  return parseNode()
}

/** First direct child tagged `tag`, or undefined -- also correctly
 * undefined for a field node (no `children` array to search at all). */
export function findChild(node: RppNode, tag: string): RppNode | undefined {
  return node.children?.find((c) => c.tag === tag)
}

/** Every direct child tagged `tag`, in document order. */
export function findAllChildren(node: RppNode, tag: string): RppNode[] {
  return node.children?.filter((c) => c.tag === tag) ?? []
}
