import { useEffect, useRef, useState } from 'react'
import {
  DRAW_ARRANGE_SECTIONS,
  movesFromDrawnGrid,
  type ArrangeMoveRecord
} from '@shared/autoArrangeApply'

export interface GridStem {
  stemKey: string
  label: string
  typeColor: string
}

interface Props {
  stems: GridStem[]
  onApply: (moves: ArrangeMoveRecord[], totalSteps: number) => void
  onCancel: () => void
}

// Two-button mode switch (draw / erase) -- deliberately its own tiny local
// helper rather than reusing autoArrangeStyles.ts's playButtonStyle, since
// this component has no audio preview at all (see this file's own module
// doc comment) and "is this the current mode" is a different kind of
// on/off than "is this stem currently playing." Visual contrast mirrors
// playButtonStyle's own anyway: bright --ra-stretch-on border/text for the
// active one, dim --ra-border/--ra-text-2 for the other -- kept as a plain
// non-exported function (not a second file) since react-refresh's
// only-export-components rule only bites a file that ALSO exports a
// component, and this one doesn't export this helper.
function modeButtonStyle(active: boolean): React.CSSProperties {
  return {
    flex: 1,
    height: 24,
    borderRadius: 0,
    fontSize: 10,
    fontFamily: 'inherit',
    fontWeight: active ? 700 : 400,
    border: `1px solid ${active ? 'var(--ra-stretch-on)' : 'var(--ra-border)'}`,
    background: active ? 'var(--ra-stretch-on-bg)' : 'transparent',
    color: active ? 'var(--ra-stretch-on)' : 'var(--ra-text-2)',
    cursor: 'pointer'
  }
}

const CELL_SIZE = 18

/** Second step of the Draw Arrangement wizard (after DrawArrangeWizard.tsx's
 * own role-confirmation step, which reuses AutoArrangeRoleStep.tsx) -- a
 * fixed DRAW_ARRANGE_SECTIONS-column grid, one row per included stem, where
 * the user directly paints which 4-bar section each stem is active in,
 * rather than stepping through autoArrangeEngine.ts's weighted-candidate
 * flow (AutoArrangeBuildStep.tsx). Phase-free and fill-free by design -- see
 * the approved design spec's non-goals: a cell is only ever active/inactive,
 * full stop, and movesFromDrawnGrid (autoArrangeApply.ts) only ever emits
 * 'enter'/'exit' moves from it, never 'fill'.
 *
 * `stems` is already the wizard's own filtered/included list -- this
 * component doesn't know about StemRoleInfo/engine-shaped types at all, on
 * purpose, so it stays a pure drawing surface reusable outside the
 * auto-arrange role-confirmation flow if that's ever wanted.
 *
 * Styled after AutoArrangeBuildStep.tsx / AutoArrangeRoleStep.tsx's shared
 * conventions: see docs/design.md. The build-progress grid in
 * AutoArrangeBuildStep.tsx is this component's closest visual reference --
 * same left-label-column + colored-square-per-active-section language, just
 * editable here instead of read-only. */
export function DrawArrangeGridStep({ stems, onApply, onCancel }: Props): React.JSX.Element {
  const [grid, setGrid] = useState<Record<string, boolean[]>>(() =>
    Object.fromEntries(stems.map((s) => [s.stemKey, new Array(DRAW_ARRANGE_SECTIONS).fill(false)]))
  )
  const [mode, setMode] = useState<'draw' | 'erase'>('draw')

  // Tracks an in-progress click-and-drag paint gesture. A ref, not state --
  // this never needs to trigger a re-render on its own (only the grid
  // content changing does), and using state here would mean every
  // pointerenter during a drag re-renders the WHOLE component twice (once
  // for the drag flag, once for the cell value) for no benefit.
  const isDraggingRef = useRef(false)

  // Document-level, not a plain onPointerUp on the grid element -- the
  // pointer can be released outside the grid's own bounds (dragged off the
  // edge while painting a run of cells) and the drag still needs to end
  // cleanly in that case, or a later pointerenter somewhere else entirely
  // would keep painting. See this task's own spec for why this is a
  // deliberate, already-decided implementation choice.
  useEffect(() => {
    function handlePointerUp(): void {
      isDraggingRef.current = false
    }
    document.addEventListener('pointerup', handlePointerUp)
    return () => document.removeEventListener('pointerup', handlePointerUp)
  }, [])

  // Applying a value to a cell always uses the CURRENT mode's value --
  // never inferred from the cell's own starting state -- so a drag that
  // crosses already-active and already-inactive cells alike paints them
  // all the same way in one consistent stroke.
  function paintCell(stemKey: string, index: number): void {
    const value = mode === 'draw'
    setGrid((prev) => {
      const row = prev[stemKey]
      if (!row || row[index] === value) return prev
      const nextRow = row.slice()
      nextRow[index] = value
      return { ...prev, [stemKey]: nextRow }
    })
  }

  const nothingDrawn = Object.values(grid).every((cells) => cells.every((c) => !c))

  function handleApply(): void {
    if (nothingDrawn) return
    onApply(movesFromDrawnGrid(grid), DRAW_ARRANGE_SECTIONS)
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <div
        style={{
          background: 'var(--ra-bg-bar)',
          border: '1px solid var(--ra-border-strong)',
          borderRadius: 0,
          padding: 20,
          width: 520,
          maxHeight: '80vh',
          overflowY: 'auto'
        }}
      >
        <div className="ra-eyebrow" style={{ marginBottom: 8 }}>
          draw arrangement
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 12, maxWidth: 200 }}>
          <button style={modeButtonStyle(mode === 'draw')} onClick={() => setMode('draw')}>
            draw
          </button>
          <button style={modeButtonStyle(mode === 'erase')} onClick={() => setMode('erase')}>
            erase
          </button>
        </div>
        {stems.length === 0 ? (
          <div style={{ fontSize: 11, color: 'var(--ra-text-2)', marginBottom: 10 }}>
            no stems to draw an arrangement for
          </div>
        ) : (
          <div style={{ overflowX: 'auto', marginBottom: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, width: 'fit-content' }}>
              {stems.map((stem) => {
                const cells = grid[stem.stemKey] ?? []
                return (
                  <div key={stem.stemKey} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <div
                      style={{
                        width: 90,
                        flexShrink: 0,
                        fontSize: 9,
                        color: 'var(--ra-text-2)',
                        textAlign: 'right',
                        paddingRight: 6,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}
                      title={stem.label}
                    >
                      {stem.label}
                    </div>
                    <div style={{ display: 'flex', gap: 2 }}>
                      {cells.map((active, i) => (
                        <div
                          key={i}
                          title={`section ${i + 1}`}
                          onPointerDown={() => {
                            isDraggingRef.current = true
                            paintCell(stem.stemKey, i)
                          }}
                          onPointerEnter={() => {
                            if (isDraggingRef.current) paintCell(stem.stemKey, i)
                          }}
                          style={{
                            width: CELL_SIZE,
                            height: CELL_SIZE,
                            flexShrink: 0,
                            borderRadius: 0,
                            cursor: 'pointer',
                            background: active ? stem.typeColor : 'transparent',
                            border: `1px solid ${active ? stem.typeColor : 'var(--ra-border)'}`,
                            touchAction: 'none'
                          }}
                        />
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={handleApply}
            disabled={nothingDrawn}
            title={nothingDrawn ? 'draw at least one active section first' : 'apply arrangement'}
            style={{
              height: 22,
              borderRadius: 0,
              padding: '0 10px',
              fontSize: 10,
              fontWeight: 700,
              border: '1px solid var(--ra-stretch-on)',
              background: 'var(--ra-stretch-on)',
              color: 'var(--ra-play-on-ink)',
              // This app's disabled convention (docs/design.md): dim to 30%
              // opacity + not-allowed cursor, rather than a separate
              // disabled color palette.
              cursor: nothingDrawn ? 'not-allowed' : 'pointer',
              opacity: nothingDrawn ? 0.3 : 1
            }}
          >
            apply arrangement
          </button>
          <div style={{ flex: 1 }} />
          <button
            onClick={onCancel}
            style={{
              height: 22,
              borderRadius: 0,
              padding: '0 10px',
              fontSize: 10,
              border: '1px solid var(--ra-border)',
              background: 'var(--ra-bg-row-active)',
              color: 'var(--ra-text-2)'
            }}
          >
            cancel
          </button>
        </div>
      </div>
    </div>
  )
}
