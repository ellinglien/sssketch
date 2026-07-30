import { usePos } from '../state/StoreContext'
import { PPB } from './Ruler'

export function Playhead({ ppb = PPB }: { ppb?: number } = {}): React.JSX.Element {
  const pos = usePos()
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: pos * ppb,
        width: 1,
        background: 'var(--ra-playhead)',
        pointerEvents: 'none'
      }}
    />
  )
}
