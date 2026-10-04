// src/renderer/src/components/RadioRowPlates.tsx
//
// The radio view's plates ON a row's waveform (spec 2026-10-03-sssketch-radio-view-design section
// 1.2; radio view plan Task 7): the web radio's full-mode row plates, from @shared/radioRowPlates.
// Two flex bars (design pass 2026-10-04, decision 11), so plates never collide on a busy row.
// The top bar: info at the left (label ellipsized, its tail kept whole), the cue at the right
// (the flash word, and `next · ...` inverted). The bottom bar: the away hook's name at the left
// (the one real control here), fold's `7 / 16` with its phase dot at the right. Rendered inside
// the waveform cell, which is `position: relative`. Monochrome chrome; everything but the away
// button ignores the pointer, so the gain drag underneath keeps working.
import { RADIO_HOOK_BRING_BACK_TOOLTIP } from '@shared/radioHooks'
import type { RadioRowPlates as RadioRowPlatesModel } from '@shared/radioRowPlates'

const PLATE: React.CSSProperties = {
  background: 'var(--ra-bg-page)',
  border: '1px solid var(--ra-border)',
  padding: '3px 6px',
  fontSize: 'var(--ra-fs-9)',
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
      {(plates.info !== null || plates.cue !== null) && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 'var(--ra-s-1)',
            pointerEvents: 'none'
          }}
        >
          {plates.info !== null && (
            <div
              aria-hidden
              style={{
                ...PLATE,
                display: 'flex',
                flex: '0 1 auto',
                minWidth: 0,
                color: 'var(--ra-text)'
              }}
            >
              <span
                style={{
                  flex: '0 1 auto',
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}
              >
                {plates.info.label}
              </span>
              <span style={{ flex: 'none' }}>{plates.info.tail}</span>
            </div>
          )}
          {plates.cue !== null && (
            <div
              aria-hidden
              style={{
                marginLeft: 'auto',
                display: 'flex',
                gap: 'var(--ra-s-1)',
                flex: 'none'
              }}
            >
              {plates.cue.flash !== null && (
                <span
                  style={{
                    ...PLATE,
                    color: 'var(--ra-text)',
                    opacity: plates.cue.flash.opacity
                  }}
                >
                  {plates.cue.flash.word}
                </span>
              )}
              {plates.cue.next !== null && (
                <span
                  style={{
                    ...PLATE,
                    background: 'var(--ra-text)',
                    color: 'var(--ra-bg-page)',
                    borderColor: 'var(--ra-text)'
                  }}
                >
                  {plates.cue.next}
                </span>
              )}
            </div>
          )}
        </div>
      )}
      {(hookAwayName !== null || plates.fold !== null) && (
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            display: 'flex',
            alignItems: 'flex-end',
            gap: 'var(--ra-s-1)',
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
                padding: '17px 8px 0 0',
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
          {/* Fold's readout and the phase dot. The dot is the same element the grid's readout
              cell carries (data-fold-dot): DiscoverPanel's sweep layout effect shows, hides and
              moves it under rowsRef, never render. */}
          {plates.fold !== null && (
            <div
              aria-hidden
              style={{
                ...PLATE,
                marginLeft: 'auto',
                flex: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                color: 'var(--ra-text-2)'
              }}
            >
              <span>{plates.fold}</span>
              <span
                style={{
                  position: 'relative',
                  width: 28,
                  height: 1,
                  background: 'var(--ra-text-3)'
                }}
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
        </div>
      )}
    </>
  )
}
