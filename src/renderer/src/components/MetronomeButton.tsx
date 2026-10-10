import { startPointerDrag } from './dragUtils'
import { metronomeVolumeFromDrag } from './metronomeVolume'

function MetronomeIcon(): React.JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor">
      <path d="M5 14 L8 2 L11 14 Z" strokeWidth="1.4" strokeLinejoin="round" />
      <line x1="8" y1="12" x2="11" y2="4" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="9.7" cy="7" r="1" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function MetronomeButton({
  enabled,
  volume,
  onToggle,
  onVolumeChange
}: {
  enabled: boolean
  volume: number
  onToggle: () => void
  onVolumeChange: (volume: number) => void
}): React.JSX.Element {
  return (
    <button
      onClick={onToggle}
      onMouseDown={(event) => {
        const startVolume = volume
        startPointerDrag(event, (_deltaX, deltaY) => {
          onVolumeChange(metronomeVolumeFromDrag(startVolume, deltaY))
        })
      }}
      aria-label="Toggle metronome"
      title={`${enabled ? 'metronome: on' : 'metronome: off'} · ${Math.round(volume * 100)}% · drag up/down for volume`}
      style={{
        height: 26,
        width: 26,
        flex: 'none',
        padding: 0,
        borderRadius: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: enabled ? 'var(--ra-stretch-on-bg)' : 'var(--ra-bg-row-active)',
        border: `1px solid ${enabled ? 'var(--ra-stretch-on)' : 'var(--ra-border)'}`,
        color: enabled ? 'var(--ra-stretch-on)' : 'var(--ra-text-2)',
        position: 'relative',
        cursor: 'pointer'
      }}
    >
      <MetronomeIcon />
      <span
        aria-hidden
        style={{
          position: 'absolute',
          right: 1,
          bottom: 1,
          width: 2,
          height: `${Math.round((volume / 2) * 22)}px`,
          maxHeight: 22,
          background: 'currentColor',
          pointerEvents: 'none'
        }}
      />
    </button>
  )
}
