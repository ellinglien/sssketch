/** Settings menu's "audio…" entry — replaces the two always-visible input/
 * output <select> dropdowns that used to sit directly in the transport bar
 * with a single modal, per direct feedback. All the actual device state,
 * fetch/restore logic, and localStorage persistence stays owned by
 * TransportBar.tsx (unchanged) — this component is just the two dropdowns'
 * presentation, lifted into a modal shell matching this app's other small
 * modals (OnboardingModal.tsx's own fixed-overlay + centered-card shape). */
export function AudioDeviceModal({
  onClose,
  availableInputDevices,
  selectedInputDevice,
  onChangeInput,
  isAnyChannelArmed,
  availableOutputDevices,
  selectedOutputDevice,
  onChangeOutput
}: {
  onClose: () => void
  availableInputDevices: string[]
  /** Already restored by the time this modal can even be opened —
   * TransportBar.tsx's own mount-time fetch/restore effects run well
   * before the settings menu is reachable, so this reflects the real
   * current device, not a placeholder, the instant the modal appears. */
  selectedInputDevice: string | null
  onChangeInput: (device: string | null) => void
  isAnyChannelArmed: boolean
  availableOutputDevices: string[]
  selectedOutputDevice: string | null
  onChangeOutput: (device: string | null) => void
}): React.JSX.Element {
  const selectStyle: React.CSSProperties = {
    fontFamily: 'inherit',
    fontSize: 11,
    color: 'var(--ra-text)',
    background: 'var(--ra-bg-row-active)',
    border: '1px solid var(--ra-border)',
    borderRadius: 0,
    padding: '6px 8px'
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 500
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(340px, 90vw)',
          background: 'var(--ra-bg-bar)',
          border: '1px solid var(--ra-border-strong)',
          borderRadius: 0,
          padding: 18,
          display: 'flex',
          flexDirection: 'column',
          gap: 16
        }}
      >
        <span className="ra-eyebrow">audio</span>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 10, color: 'var(--ra-text-2)' }}>audio in</span>
          <select
            value={selectedInputDevice ?? ''}
            disabled={isAnyChannelArmed}
            title={
              isAnyChannelArmed
                ? 'disarm the current recording before changing the input device'
                : undefined
            }
            onChange={(e) => onChangeInput(e.target.value || null)}
            style={{ ...selectStyle, cursor: isAnyChannelArmed ? 'not-allowed' : 'pointer' }}
          >
            <option value="">
              {availableInputDevices.length === 0
                ? 'no input devices found'
                : 'select input device...'}
            </option>
            {availableInputDevices.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 10, color: 'var(--ra-text-2)' }}>audio out</span>
          <select
            value={selectedOutputDevice ?? ''}
            onChange={(e) => onChangeOutput(e.target.value || null)}
            style={{ ...selectStyle, cursor: 'pointer' }}
          >
            <option value="">
              {availableOutputDevices.length === 0
                ? 'no output devices found'
                : 'select output device...'}
            </option>
            {availableOutputDevices.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>

        <button
          onClick={onClose}
          style={{
            alignSelf: 'flex-end',
            height: 28,
            borderRadius: 0,
            padding: '0 14px',
            fontSize: 11,
            fontWeight: 700,
            border: '1px solid var(--ra-border-strong)',
            background: 'var(--ra-bg-row-active)',
            color: 'var(--ra-text)',
            cursor: 'pointer'
          }}
        >
          close
        </button>
      </div>
    </div>
  )
}
