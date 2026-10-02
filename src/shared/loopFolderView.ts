// src/shared/loopFolderView.ts
import { formatBpm } from './format'
import type { LoopEntry } from './loopFolderTypes'

/** A row's tempo text. A guess is marked by a `~` and, in the component,
 * dimmer text (var(--ra-text-3)) -- never a colour (spec, "Visuals"). */
export function loopTempoLabel(loop: Pick<LoopEntry, 'bpm' | 'source'>): {
  text: string
  guessed: boolean
} {
  if (loop.bpm === null) return { text: '?', guessed: true }
  if (loop.source === 'filename' || loop.source === 'user') {
    return { text: formatBpm(loop.bpm), guessed: false }
  }
  return { text: `~${Math.round(loop.bpm)}`, guessed: true }
}

export function loopBarsLabel(loop: Pick<LoopEntry, 'bars'>): string {
  if (loop.bars === null) return '? bars'
  return loop.bars === 1 ? '1 bar' : `${loop.bars} bars`
}

/** The anchor drives preview, as selectedRiffCID does for rifffs. */
export interface LoopSelection {
  anchor: string | null
  selected: ReadonlySet<string>
}

export const EMPTY_LOOP_SELECTION: LoopSelection = { anchor: null, selected: new Set() }

/** The same file-browser convention as LibraryBrowser's handleRiffClick:
 * a plain click selects one and anchors it; shift extends a range from a
 * fixed anchor over the on-screen order; cmd/ctrl toggles one and moves
 * the anchor to it. */
export function nextLoopSelection(
  prev: LoopSelection,
  clickedId: string,
  orderedIds: string[],
  mods: { shift: boolean; toggle: boolean }
): LoopSelection {
  if (mods.shift && prev.anchor !== null) {
    const anchorIndex = orderedIds.indexOf(prev.anchor)
    const clickedIndex = orderedIds.indexOf(clickedId)
    if (anchorIndex === -1 || clickedIndex === -1) {
      return { anchor: clickedId, selected: new Set([clickedId]) }
    }
    const [start, end] =
      anchorIndex < clickedIndex ? [anchorIndex, clickedIndex] : [clickedIndex, anchorIndex]
    return { anchor: prev.anchor, selected: new Set(orderedIds.slice(start, end + 1)) }
  }
  if (mods.toggle) {
    const next = new Set(prev.selected)
    if (next.has(clickedId)) next.delete(clickedId)
    else next.add(clickedId)
    return { anchor: clickedId, selected: next }
  }
  return { anchor: clickedId, selected: new Set([clickedId]) }
}
