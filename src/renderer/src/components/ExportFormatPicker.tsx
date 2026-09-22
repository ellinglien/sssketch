import { useState } from 'react'
import type { ToolkitExportMode } from '@shared/toolkit'

/** Small format-choice modal for the "export project…" menu item -- shown
 * before dispatching to whichever format's own dialog/library/
 * next-to-source entry-point logic (see App.tsx's ProjectMenu component).
 * Stems export lives as its own top-level "export stems" menu item instead
 * (right next to "export mix"), not here -- only the two real DAW-project
 * formats need a "which one" choice. Styled to match TidyUpNudgeModal.tsx's
 * own dimmed-backdrop-plus-panel convention.
 *
 * When the project actually uses the built-in sound toolkit
 * (projectUsesToolkit, which the caller asks), the modal also carries the
 * bake/automation choice from the toolkit spec's section 4. It appears ONLY
 * then: a project with nothing drawn on it has nothing to choose between,
 * and would just be reading two paragraphs about a feature it isn't using. */
export function ExportFormatPicker({
  onChoose,
  onCancel,
  toolkitInUse = false
}: {
  onChoose: (format: 'ableton' | 'reaper', toolkitMode: ToolkitExportMode) => void
  onCancel: () => void
  toolkitInUse?: boolean
}): React.JSX.Element {
  const [toolkitMode, setToolkitMode] = useState<ToolkitExportMode>('bake')

  const buttonStyle = {
    display: 'block',
    width: '100%',
    textAlign: 'left' as const,
    height: 26,
    borderRadius: 0,
    padding: '0 10px',
    marginBottom: 6,
    fontSize: 11,
    border: '1px solid var(--ra-border)',
    background: 'var(--ra-bg-row-active)',
    color: 'var(--ra-text-2)',
    cursor: 'pointer'
  }

  function modeButtonStyle(mode: ToolkitExportMode): React.CSSProperties {
    const on = toolkitMode === mode
    return {
      ...buttonStyle,
      height: 'auto',
      padding: '6px 10px',
      marginBottom: 4,
      border: `1px solid ${on ? 'var(--ra-text-2)' : 'var(--ra-border)'}`,
      color: on ? 'var(--ra-text)' : 'var(--ra-text-3)'
    }
  }

  const noteStyle: React.CSSProperties = {
    display: 'block',
    marginTop: 3,
    fontSize: 9,
    lineHeight: 1.4,
    color: 'var(--ra-text-3)'
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--ra-backdrop)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 'var(--ra-z-modal)'
      }}
    >
      <div
        style={{
          width: toolkitInUse ? 'min(320px, 92vw)' : 'min(260px, 90vw)',
          background: 'var(--ra-bg-bar)',
          border: '1px solid var(--ra-border)',
          borderRadius: 0,
          padding: 16
        }}
      >
        <p style={{ margin: 0, fontSize: 11, color: 'var(--ra-text)' }}>export as</p>
        {toolkitInUse && (
          <div style={{ marginTop: 12 }}>
            <p style={{ margin: 0, fontSize: 10, color: 'var(--ra-text-2)' }}>
              the filter, reverb and volume you drew
            </p>
            <div style={{ marginTop: 6 }}>
              <button style={modeButtonStyle('bake')} onClick={() => setToolkitMode('bake')}>
                bake it into the audio
                <span style={noteStyle}>
                  sounds exactly like it does here, but the shapes can&apos;t be changed over there
                </span>
              </button>
              <button
                style={modeButtonStyle('automation')}
                onClick={() => setToolkitMode('automation')}
              >
                export it as automation
                <span style={noteStyle}>
                  dry audio with editable envelopes on stock devices, one track per clip
                </span>
              </button>
            </div>
            <p style={{ margin: '6px 0 0', fontSize: 9, color: 'var(--ra-text-3)' }}>
              risers always come out as audio
            </p>
          </div>
        )}
        <div style={{ marginTop: toolkitInUse ? 14 : 10 }}>
          <button style={buttonStyle} onClick={() => onChoose('ableton', toolkitMode)}>
            ableton project
          </button>
          <button
            style={{ ...buttonStyle, marginBottom: 0 }}
            onClick={() => onChoose('reaper', toolkitMode)}
          >
            reaper project
          </button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
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
