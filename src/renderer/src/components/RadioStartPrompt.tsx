// src/renderer/src/components/RadioStartPrompt.tsx
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  RADIO_DENSITY_OPTIONS,
  radioDensityOf,
  radioPaceLevelOf,
  type RadioSettings
} from '@shared/radioSchedule'
import { RADIO_PACE_LABEL, RADIO_PACE_TOOLTIP } from '@shared/radioPace'
import { RADIO_CHANNEL_OPTIONS } from '@shared/radioStripModel'
import { PaceSlider, StripChip } from './RadioControls'

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

  function row(label: string, chips: React.JSX.Element[], tooltip?: string): React.JSX.Element {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span
          data-tooltip={tooltip}
          style={{
            width: 92,
            flexShrink: 0,
            fontSize: 9,
            color: 'var(--ra-text-3)',
            textTransform: 'uppercase',
            letterSpacing: 'var(--ra-track-eyebrow)'
          }}
        >
          {label}
        </span>
        {chips}
      </div>
    )
  }

  // THE PACE SLIDER (2026-10-03): one value, 0..100, whose readout says slow, mid, fast or
  // ludicrous at those positions and the bars between; committed on release. The `start` chip
  // beside it starts radio at the slider's position.
  const paceLevel = radioPaceLevelOf(settings)
  // `density: arc` (@shared/radioDensity) grows and thins the rows itself, starting from two on
  // an empty panel, so `channels` -- the size of the starting bed -- only shows while it is off.
  const density = radioDensityOf(settings)

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
        background: 'var(--ra-bg-bar)',
        border: '1px solid var(--ra-border-strong)',
        padding: 8,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        boxShadow: '0 6px 20px rgba(0,0,0,0.4)'
      }}
    >
      {row(
        RADIO_PACE_LABEL,
        [
          <PaceSlider
            key="pace"
            value={paceLevel}
            fold={settings.foldMode}
            onCommit={(v) => onChange({ paceLevel: v })}
            onDraft={setPaceDraft}
          />,
          <StripChip
            key="start"
            label="start"
            on={false}
            onClick={() => {
              const level = paceDraft ?? paceLevel
              // Written only when it moved: the slider's own release usually persisted it already.
              if (level !== settings.paceLevel) onChange({ paceLevel: level })
              onStart(level)
            }}
          />
        ],
        RADIO_PACE_TOOLTIP
      )}
      {row(
        'density',
        RADIO_DENSITY_OPTIONS.map((d) => (
          <StripChip
            key={d}
            label={d}
            on={density === d}
            onClick={() => onChange({ density: d })}
          />
        ))
      )}
      {density === 'off' &&
        row(
          'channels',
          RADIO_CHANNEL_OPTIONS.map((n) => (
            <StripChip
              key={n}
              label={String(n)}
              on={settings.channels === n}
              onClick={() => onChange({ channels: n })}
            />
          ))
        )}
      <span style={{ fontSize: 9, color: 'var(--ra-text-3)', maxWidth: 260 }}>
        set a pace and start
      </span>
    </div>
  )
}
