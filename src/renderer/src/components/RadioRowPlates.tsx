// src/renderer/src/components/RadioRowPlates.tsx
//
// The radio view's plates ON a row's waveform (spec 2026-10-03-sssketch-radio-view-design section
// 1.2; radio view plan Task 7): the web radio's full-mode row plates, from @shared/radioRowPlates.
// Info top left (label ellipsized, its tail kept whole), fold's `7 / 16` and its phase dot top
// right, and one bottom bar: the away hook's name at its left (the one real control here), the
// cue (flash and `next`) at its right. Rendered inside the waveform cell, which is
// `position: relative`. Monochrome chrome; everything but the away button ignores the pointer,
// so the gain drag underneath keeps working.
import { RADIO_HOOK_BRING_BACK_TOOLTIP } from '@shared/radioHooks'
import type { RadioRowPlates as RadioRowPlatesModel } from '@shared/radioRowPlates'

const PLATE: React.CSSProperties = {
  background: 'color-mix(in srgb, var(--ra-bg-page) 80%, transparent)',
  padding: '1px 3px',
  fontSize: 8,
  lineHeight: 1,
  whiteSpace: 'nowrap'
}

export function RadioRowPlates({
  plates,
  slotId,
  hookAwayName,
  onBringHookBack
}: {
  plates: RadioRowPlatesModel
  slotId: string
  hookAwayName: string | null
  onBringHookBack: () => void
}): React.JSX.Element {
  return (
    <>
      {plates.info !== null && (
        <div
          aria-hidden
          style={{
            ...PLATE,
            position: 'absolute',
            top: 2,
            left: 4,
            display: 'flex',
            maxWidth: 'calc(100% - 56px)',
            color: 'var(--ra-text)',
            pointerEvents: 'none'
          }}
        >
          <span
            style={{ flex: '0 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}
          >
            {plates.info.label}
          </span>
          <span style={{ flex: 'none' }}>{plates.info.tail}</span>
        </div>
      )}
      {/* Fold's readout and the phase dot. The dot is the same element the grid's readout cell
          carries (data-fold-dot): DiscoverPanel's sweep layout effect shows, hides and moves it
          under rowsRef, never render. */}
      {plates.fold !== null && (
        <div
          aria-hidden
          style={{
            ...PLATE,
            position: 'absolute',
            top: 2,
            right: 4,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            gap: 3,
            color: 'var(--ra-text-2)',
            pointerEvents: 'none'
          }}
        >
          <span>{plates.fold}</span>
          <span
            style={{ position: 'relative', width: 28, height: 1, background: 'var(--ra-text-3)' }}
          >
            <span
              data-fold-dot={slotId}
              style={{
                position: 'absolute',
                top: -1,
                width: 3,
                height: 3,
                marginLeft: -1,
                background: 'var(--ra-text)',
                display: 'none'
              }}
            />
          </span>
        </div>
      )}
      {(hookAwayName !== null || plates.cue !== null) && (
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 4,
            display: 'flex',
            alignItems: 'flex-end',
            gap: 6,
            pointerEvents: 'none'
          }}
        >
          {hookAwayName !== null && (
            // A transparent hit box around the name's plate: big enough to click, and the one
            // control on the waveform (its color and hover are the panel's .radio-plate-away).
            <button
              type="button"
              data-hook-away
              className="radio-plate-away"
              data-tooltip={RADIO_HOOK_BRING_BACK_TOOLTIP}
              aria-label={RADIO_HOOK_BRING_BACK_TOOLTIP}
              onClick={onBringHookBack}
              style={{
                flex: '0 1 auto',
                minWidth: 0,
                padding: '17px 8px 2px 4px',
                margin: 0,
                border: 'none',
                borderRadius: 0,
                background: 'transparent',
                font: 'inherit',
                pointerEvents: 'auto',
                cursor: 'pointer'
              }}
            >
              <span
                style={{
                  ...PLATE,
                  display: 'block',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}
              >
                {hookAwayName}
              </span>
            </button>
          )}
          {plates.cue !== null && (
            <div
              aria-hidden
              style={{
                ...PLATE,
                flex: 'none',
                margin: '0 0 2px auto',
                display: 'flex',
                gap: 6,
                color: 'var(--ra-text-2)'
              }}
            >
              {plates.cue.flash !== null && (
                <span style={{ color: 'var(--ra-text)', opacity: plates.cue.flash.opacity }}>
                  {plates.cue.flash.word}
                </span>
              )}
              {plates.cue.next !== null && <span>{plates.cue.next}</span>}
            </div>
          )}
        </div>
      )}
    </>
  )
}
