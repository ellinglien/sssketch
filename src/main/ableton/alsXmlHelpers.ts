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

/** Tags whose own `@_Id` must never be renumbered, because it's a small
 * positional index scoped to the parent track (matching the ordinal
 * position of a corresponding element elsewhere in the Set), not a
 * document-wide identity pointer like every other Id in this format.
 * `TrackSendHolder` is the confirmed case: a track's Nth `TrackSendHolder`
 * always has `Id="N"` (0, 1, ...), matching the Set's Nth `ReturnTrack` --
 * this holds in every real Ableton-produced file, INCLUDING ones with many
 * duplicated tracks (confirmed by decompiling a real Live Set with a track
 * duplicated 6 times: every single duplicate's two `TrackSendHolder`s were
 * `Id="0"`/`"1"`, never renumbered, while their NESTED
 * `AutomationTarget`/`ModulationTarget` Ids -- the actual "send knob"
 * parameters -- were all freshly unique per duplicate). Renumbering
 * `TrackSendHolder`'s own Id breaks that positional correlation and
 * produces *"Track has more send knobs than set has return tracks"*. */
const SKIP_OWN_ID_TAGS = new Set(['TrackSendHolder'])

/**
 * Recursively replaces every `@_Id` attribute found anywhere within `node`'s
 * subtree (not just on `node` itself) with a freshly allocated value from
 * `nextId` -- EXCEPT a tag listed in SKIP_OWN_ID_TAGS keeps its own Id as-is
 * (recursion into its children still proceeds normally, so anything nested
 * inside it still gets fresh unique Ids). Necessary because cloning a
 * template track via cloneNode also duplicates every internal
 * automation-target/pointee/clip-slot Id it contains -- the reference
 * template's own single canonical AudioTrack has 69 of them. Confirmed
 * empirically (see the design spec) that the original, real,
 * Ableton-produced reference file already reuses small Id values across
 * many unrelated elements without apparent problems, so renumbering most of
 * them is defensive rather than a fix for a confirmed bug -- but
 * `TrackSendHolder`'s own Id is a real, confirmed exception (see
 * SKIP_OWN_ID_TAGS's own doc comment), not a hypothetical one.
 *
 * This function went through several wrong shapes before landing here --
 * see docs/superpowers/specs/2026-08-04-ableton-export-design.md's "Known
 * risks" section for the full history (freezing TrackSendHolder's whole
 * subtree avoided the send-knob-count error but produced document-wide
 * duplicate Ids once cloned many times over; emptying `<Sends>` entirely
 * avoided both but crashed Ableton outright, since every track is expected
 * to have exactly one TrackSendHolder per ReturnTrack as a hard structural
 * invariant). This shape -- skip only the outer Id, keep recursing into
 * children -- is the one confirmed to match what real Ableton itself
 * produces when duplicating a track.
 */
export function renumberIds(node: AlsNode, nextId: () => number): void {
  const tag = Object.keys(node).find((key) => key !== ':@')
  const skipOwnId = tag !== undefined && SKIP_OWN_ID_TAGS.has(tag)

  const nodeAttrs = node[':@'] as Record<string, string> | undefined
  if (nodeAttrs && '@_Id' in nodeAttrs && !skipOwnId) {
    nodeAttrs['@_Id'] = String(nextId())
  }
  for (const key of Object.keys(node)) {
    if (key === ':@') continue
    const children = node[key]
    if (!Array.isArray(children)) continue
    for (const child of children) renumberIds(child, nextId)
  }
}
