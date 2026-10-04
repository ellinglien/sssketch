// src/renderer/src/components/RadioStartPrompt.tsx
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  RADIO_DENSITY_OPTIONS,
  radioDensityOf,
  radioPaceLevelOf,
  type RadioSettings
} from '@shared/radioSchedule'
import {
  DEFAULT_RADIO_PACE_LEVEL,
  RADIO_PACE_LABEL,
  RADIO_PACE_TOOLTIP,
  radioPaceLabel
} from '@shared/radioPace'
import { RADIO_CHANNEL_OPTIONS } from '@shared/radioStripModel'
import { ControlField, SegmentBar, Segmented } from './RadioControls'

/** Radio's start prompt: what the radio button opens while radio is off. Position, dismissal and
 * chip styling mirror DiscoverKindPicker.tsx.
 *
 * From one direct instruction (2026-09-28): "the initial prompt should be slow mid fast so the
 * app knows how to start everything." Pace is a PROMPT: the slider and a `start` chip, which
 * starts radio at the slider's position (2026-10-03; three chips did it before the slider).
 * Density, and channels while density is off, sit beside it because they are the other things
 * decided at the starting moment (channels sizes the bed radio lays down). Escape or a click
 * outside cancels, which is why it is a popover and not a dialog with an OK.
 *
 * This was the old radio menu's `start` mode. Its `running` mode (every other radio setting,
 * behind a chevron) became the radio view's strip (RadioStrip, spec
 * 2026-10-03-sssketch-radio-view-design section 1.3), always in view while radio runs. */
export function RadioStartPrompt({
  x,
  y,
  settings,
  onChange,
  onStart,
  onClose,
  ignoreRef
}: {
  x: number
  y: number
  settings: RadioSettings
  onChange: (patch: Partial<RadioSettings>) => void
  /** The `start` chip: radio starts at this pace level (the slider's position, which may not
   * have persisted yet -- the panel must not read it back from settings). */
  onStart: (level: number) => void
  onClose: () => void
  ignoreRef: React.RefObject<HTMLElement | null>
}): React.JSX.Element {
  const promptRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: x, top: y })
  // Where the pace slider is, for the start chip: the draft while dragging, else the setting.
  const [paceDraft, setPaceDraft] = useState<number | null>(null)

  useLayoutEffect(() => {
    const el = promptRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const margin = 8
    const left = Math.max(margin, Math.min(x, window.innerWidth - rect.width - margin))
    const top = Math.max(margin, Math.min(y, window.innerHeight - rect.height - margin))
    setPosition({ left, top })
  }, [x, y])

  useEffect(() => {
    function handleDismiss(e: MouseEvent): void {
      if (promptRef.current?.contains(e.target as Node)) return
      if (ignoreRef.current?.contains(e.target as Node)) return
      onClose()
    }
    // Escape closes ONLY this prompt: capture phase, propagation stopped, so
    // LibraryBrowser's window-level Escape (close the whole library) never
    // sees it.
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    const id = setTimeout(() => {
      window.addEventListener('click', handleDismiss, true)
    }, 0)
    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      clearTimeout(id)
      window.removeEventListener('click', handleDismiss, true)
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [onClose, ignoreRef])

  // THE PACE BAR (2026-10-03): one value, 0..100, whose readout says slow, mid, fast or
  // ludicrous at those positions and the bars between; committed on release. The `start` button
  // starts radio at the bar's position.
  const paceLevel = radioPaceLevelOf(settings)
  // `density: arc` (@shared/radioDensity) grows and thins the rows itself, starting from two on
  // an empty panel, so `channels` -- the size of the starting bed -- is greyed unless it is off.
  const density = radioDensityOf(settings)

  const paceShown = paceDraft ?? paceLevel
  const paceReadout = radioPaceLabel(paceShown, { fold: settings.foldMode })

  return (
    <div
      ref={promptRef}
      role="dialog"
      aria-label="start radio"
      style={{
        position: 'fixed',
        left: position.left,
        top: position.top,
        zIndex: 1200,
        width: 380,
        boxSizing: 'border-box',
        background: 'var(--ra-bg-bar)',
        border: '1px solid var(--ra-border-strong)',
        padding: 18,
        display: 'flex',
        flexDirection: 'column',
        gap: 18
      }}
    >
      <span style={{ fontSize: 'var(--ra-fs-13)', color: 'var(--ra-text)' }}>start radio</span>
      <ControlField label={RADIO_PACE_LABEL} tooltip={RADIO_PACE_TOOLTIP} readout={paceReadout}>
        <SegmentBar
          label={RADIO_PACE_LABEL}
          value={paceLevel}
          size="control"
          cellHeight="var(--ra-h-control)"
          defaultValue={DEFAULT_RADIO_PACE_LEVEL}
          ariaValueText={paceReadout}
          tooltip={RADIO_PACE_TOOLTIP}
          onChange={() => {}}
          onDraft={setPaceDraft}
          onCommit={(v) => onChange({ paceLevel: v })}
        />
      </ControlField>
      <ControlField label="density">
        <Segmented
          ariaLabel="density"
          size="control"
          options={RADIO_DENSITY_OPTIONS.map((d) => ({
            label: d,
            on: density === d,
            onClick: () => onChange({ density: d })
          }))}
        />
      </ControlField>
      {/* Greyed, not hidden, while density arc sizes the rows itself (Elling, 2026-10-04). */}
      <ControlField
        label="channels"
        disabled={density !== 'off'}
        tooltip={density !== 'off' ? 'with density off' : undefined}
      >
        <Segmented
          ariaLabel="channels"
          size="control"
          disabled={density !== 'off'}
          options={RADIO_CHANNEL_OPTIONS.map((n) => ({
            label: String(n),
            on: settings.channels === n,
            onClick: () => onChange({ channels: n })
          }))}
        />
      </ControlField>
      <button
        type="button"
        className="radio-fire"
        onClick={() => {
          const level = paceDraft ?? paceLevel
          // Written only when it moved: the slider's own release usually persisted it already.
          if (level !== settings.paceLevel) onChange({ paceLevel: level })
          onStart(level)
        }}
        style={{
          width: '100%',
          height: 'var(--ra-h-transport)',
          fontFamily: 'inherit',
          fontSize: 'var(--ra-fs-13)',
          background: 'transparent',
          color: 'var(--ra-text)',
          border: '1px solid var(--ra-text)',
          cursor: 'pointer'
        }}
      >
        start
      </button>
    </div>
  )
}
