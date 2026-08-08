import { XMLParser, XMLBuilder } from 'fast-xml-parser'

/**
 * A node in fast-xml-parser's `preserveOrder` document shape: an object with
 * exactly one tag-name key (whose value is the array of child nodes) plus an
 * optional `:@` key holding that element's attributes. A parsed document is
 * an array of these. preserveOrder (not the default object-collapsing mode)
 * is used because .als has many repeated sibling tags (AudioTrack,
 * WarpMarker, ...) that the default mode can't represent without
 * array/object ambiguity -- see docs/superpowers/specs/
 * 2026-08-04-ableton-export-design.md.
 */
export type AlsNode = {
  [tag: string]: AlsNode[] | Record<string, string> | undefined
}

const XML_OPTIONS = {
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '@_'
} as const

export function parseAls(xmlText: string): AlsNode[] {
  return new XMLParser(XML_OPTIONS).parse(xmlText) as AlsNode[]
}

export function serializeAls(doc: AlsNode[]): string {
  return new XMLBuilder({ ...XML_OPTIONS, format: false }).build(doc) as string
}

/** First direct child tagged `tag`, or undefined if none exists. */
export function findChild(nodes: AlsNode[], tag: string): AlsNode | undefined {
  return nodes.find((n) => n[tag] !== undefined)
}

/** Every direct child tagged `tag`, in document order. */
export function findAllChildren(nodes: AlsNode[], tag: string): AlsNode[] {
  return nodes.filter((n) => n[tag] !== undefined)
}

/** `node`'s own children array under `tag` -- callers only reach for this
 * once they already know (via findChild/findAllChildren) that `node` really
 * is a `tag` element, so the cast is safe. */
export function childArray(node: AlsNode, tag: string): AlsNode[] {
  return node[tag] as AlsNode[]
}

/** `node`'s attribute map, or an empty object if it has none. */
export function attrs(node: AlsNode): Record<string, string> {
  return (node[':@'] as Record<string, string> | undefined) ?? {}
}

/** Sets (or adds) one attribute on `node`. */
export function setAttr(node: AlsNode, name: string, value: string): void {
  const existing = node[':@'] as Record<string, string> | undefined
  if (existing) existing[name] = value
  else node[':@'] = { [name]: value }
}

/** Sets a track/group/clip's `<Color Value="N" />` child to one of Ableton's
 * own fixed palette indices (0-69ish) -- the same self-closing
 * `<Tag Value="..." />` shape as CurrentStart/IsWarped/etc, so this is just
 * setAttr on the Color child, named separately since "which node has a
 * Color child" is a distinct enough concept from an arbitrary attribute set
 * to be worth its own name at call sites (see buildAlsXml.ts's bus-color
 * coding). */
export function setColor(nodeBody: AlsNode[], colorIndex: number): void {
  setAttr(findChild(nodeBody, 'Color')!, '@_Value', String(colorIndex))
}

/** Deep-clones a node subtree -- used to duplicate the template's canonical
 * AudioTrack/GroupTrack once per stem/channel. structuredClone is safe here
 * because every value in this document shape (strings, plain objects,
 * arrays) is structured-clone-able -- there are no functions, class
 * instances, or other exotic values anywhere in a parsed .als document. */
export function cloneNode(node: AlsNode): AlsNode {
  return structuredClone(node)
}

/**
 * Recursively replaces every `@_Id` attribute found anywhere within `node`'s
 * subtree (not just on `node` itself) with a freshly allocated value from
 * `nextId`. Necessary because cloning a template track via cloneNode also
 * duplicates every internal automation-target/pointee/clip-slot Id it
 * contains -- the reference template's own single canonical AudioTrack has
 * 69 of them. Confirmed empirically (see the design spec) that the original,
 * real, Ableton-produced reference file already reuses small Id values
 * across unrelated elements without apparent problems, so this is defensive
 * rather than a fix for a confirmed bug.
 *
 * This function went through several wrong, `TrackSendHolder`-specific
 * shapes before landing back here in its original, fully-unconditional
 * form -- see docs/superpowers/specs/2026-08-04-ableton-export-design.md's
 * "Known risks" section for the full history. None of those Id-renumbering
 * schemes were ever actually the problem: the real fix was to stop cloning
 * `<Sends>`'s contents into new tracks at all, and to drop `<ReturnTrack>`s
 * from the export entirely (see `buildAlsXml.ts`), sidestepping Ableton's
 * still-not-fully-understood per-track send-knob validation rather than
 * continuing to search for the exact scheme it wants.
 */
export function renumberIds(node: AlsNode, nextId: () => number): void {
  const nodeAttrs = node[':@'] as Record<string, string> | undefined
  if (nodeAttrs && '@_Id' in nodeAttrs) {
    nodeAttrs['@_Id'] = String(nextId())
  }
  for (const key of Object.keys(node)) {
    if (key === ':@') continue
    const children = node[key]
    if (!Array.isArray(children)) continue
    for (const child of children) renumberIds(child, nextId)
  }
}
