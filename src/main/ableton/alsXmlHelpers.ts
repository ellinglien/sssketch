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
 * rather than a fix for a confirmed bug -- but it's free, and matches the
 * spirit of the template's own NextPointeeId field (Ableton's own "next
 * safe Id to hand out" counter).
 *
 * One real exception was found and fixed differently, not here:
 * `<TrackSendHolder>` (a track's per-return-track send knob) turned out to
 * be genuinely unsafe to touch in EITHER direction -- renumbering it (or
 * its own nested Ids) produces *"Track has more send knobs than set has
 * return tracks"*, but leaving it frozen produces *"non-unique Pointee
 * IDs"* once the same frozen subtree gets duplicated across many cloned
 * tracks. Since sssketch has no concept of "send level to a return track"
 * at all, the actual fix is to never carry this substructure into a cloned
 * track in the first place -- see buildAlsXml.ts's own handling of
 * `<Sends>` on each clone -- rather than teach this generic helper about
 * one specific tag's own idiosyncratic Id rules.
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
