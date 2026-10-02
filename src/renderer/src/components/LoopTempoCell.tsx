// src/renderer/src/components/LoopTempoCell.tsx
import { useState } from 'react'
import type { LoopEntry } from '@shared/loopFolderTypes'
import { loopTempoLabel, parseTempoInput } from '@shared/loopFolderView'

/** A loop row's tempo, editable in place. A guess reads `~165` in dimmer
 * text; a corrected tempo reads plainly, like a filename tempo. */
export function LoopTempoCell({
  loop,
  onSetTempo
}: {
  loop: LoopEntry
  onSetTempo: (bpm: number | null) => Promise<void>
}): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const tempo = loopTempoLabel(loop)

  async function commit(): Promise<void> {
    const parsed = parseTempoInput(draft)
    // An unusable entry keeps the box open with the text in it, so it reads
    // as not taken rather than silently dropped.
    if (parsed === 'invalid') return
    setEditing(false)
    await onSetTempo(parsed)
  }

  if (!editing) {
    return (
      <span
        data-tooltip="set tempo"
        onClick={(e) => {
          e.stopPropagation()
          setDraft(loop.source === 'user' && loop.bpm !== null ? String(loop.bpm) : '')
          setEditing(true)
        }}
        style={{
          width: 44,
          textAlign: 'right',
          cursor: 'text',
          color: tempo.guessed ? 'var(--ra-text-3)' : 'inherit'
        }}
      >
        {tempo.text}
      </span>
    )
  }

  return (
    <input
      autoFocus
      type="text"
      inputMode="decimal"
      value={draft}
      placeholder={tempo.text}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') void commit()
        if (e.key === 'Escape') {
          // Cancels this box only: LibraryBrowser closes itself on a window
          // Escape, which this keypress must not reach.
          e.stopPropagation()
          setEditing(false)
        }
      }}
      onBlur={() => setEditing(false)}
      style={{
        width: 44,
        height: 20,
        fontSize: 11,
        fontFamily: 'inherit',
        textAlign: 'right',
        background: 'var(--ra-bg-row-active)',
        color: 'var(--ra-text)',
        border: '1px solid var(--ra-border)',
        borderRadius: 0,
        padding: '0 4px',
        boxSizing: 'border-box'
      }}
    />
  )
}
