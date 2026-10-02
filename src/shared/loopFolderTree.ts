// src/shared/loopFolderTree.ts

/** The formats IMPORT lists from a linked folder. REX2 and other closed
 * formats are out of scope (spec), so a pack's REX2/ copies simply never
 * show. Every one of these is decoded by the native engine's JUCE readers. */
export const PLAYABLE_LOOP_EXTENSIONS: readonly string[] = [
  '.wav',
  '.aif',
  '.aiff',
  '.flac',
  '.mp3',
  '.ogg'
]

/** Folders that only say what format sits inside them. A pack that ships
 * WAV/ and REX2/ side by side is one set of loops, not two groups. */
const FORMAT_ONLY_FOLDER_NAMES = new Set([
  'wav',
  'aiff',
  'mp3',
  'flac',
  'ogg',
  'rex',
  'rex2',
  'audio'
])

/** Dot entries: .DS_Store, and the ._ AppleDouble companions macOS writes
 * beside every file on an ExFAT volume -- each one a fake ".wav". */
export function isHiddenEntry(name: string): boolean {
  return name.startsWith('.')
}

export function isPlayableLoopFile(fileName: string): boolean {
  if (isHiddenEntry(fileName)) return false
  const dot = fileName.lastIndexOf('.')
  return dot > 0 && PLAYABLE_LOOP_EXTENSIONS.includes(fileName.slice(dot).toLowerCase())
}

export function isFormatOnlyFolder(name: string): boolean {
  return FORMAT_ONLY_FOLDER_NAMES.has(name.toLowerCase())
}

/** A file's folder segments below the linked root, with format folders
 * flattened into their parent. */
export function loopGroupPath(relativeDirSegments: string[]): string[] {
  return relativeDirSegments.filter((segment) => !isFormatOnlyFolder(segment))
}

export function loopDisplayName(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? fileName.slice(0, dot) : fileName
}

export interface LoopGroupNode<T> {
  /** JSON of the group path; '[]' for the root. Stable across rescans. */
  key: string
  name: string
  /** 0 for the root (the linked folder itself), 1 for its groups, ... */
  depth: number
  loops: T[]
  children: LoopGroupNode<T>[]
}

function naturalOrder(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

function sortTree<T extends { name: string }>(node: LoopGroupNode<T>): void {
  node.loops.sort((a, b) => naturalOrder(a.name, b.name))
  node.children.sort((a, b) => naturalOrder(a.name, b.name))
  for (const child of node.children) sortTree(child)
}

/** Groups exist only where loops are, so a REX2-only folder, or one holding
 * nothing playable, never appears. */
export function buildLoopGroupTree<T extends { name: string; groupPath: string[] }>(
  loops: T[]
): LoopGroupNode<T> {
  const root: LoopGroupNode<T> = { key: '[]', name: '', depth: 0, loops: [], children: [] }
  for (const loop of loops) {
    let node = root
    for (let i = 0; i < loop.groupPath.length; i++) {
      const key = JSON.stringify(loop.groupPath.slice(0, i + 1))
      let child = node.children.find((c) => c.key === key)
      if (!child) {
        child = { key, name: loop.groupPath[i], depth: i + 1, loops: [], children: [] }
        node.children.push(child)
      }
      node = child
    }
    node.loops.push(loop)
  }
  sortTree(root)
  return root
}

/** The loops in on-screen order, which is the order shift-click ranges
 * over. The root is always open; a collapsed group hides its whole subtree. */
export function flattenLoopTreeOrder<T>(
  node: LoopGroupNode<T>,
  isExpanded: (key: string) => boolean
): T[] {
  if (node.depth > 0 && !isExpanded(node.key)) return []
  return [
    ...node.loops,
    ...node.children.flatMap((child) => flattenLoopTreeOrder(child, isExpanded))
  ]
}

export function countLoopsInGroup<T>(node: LoopGroupNode<T>): number {
  return node.loops.length + node.children.reduce((n, child) => n + countLoopsInGroup(child), 0)
}

/** Groups start collapsed, so opening a big pack does not decode a
 * waveform for every loop at once. The exception is a folder with a single
 * top-level group, where collapsing would only add a click. */
export function defaultExpandedGroupKeys<T>(root: LoopGroupNode<T>): string[] {
  if (root.children.length !== 1) return []
  const keys: string[] = []
  const walk = (node: LoopGroupNode<T>): void => {
    for (const child of node.children) {
      keys.push(child.key)
      walk(child)
    }
  }
  walk(root)
  return keys
}
