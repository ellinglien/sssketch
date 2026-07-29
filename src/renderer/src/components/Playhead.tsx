import { usePos } from '../state/StoreContext'
import { PPB } from './Ruler'

export function Playhead(): React.JSX.Element {
  const pos = usePos()
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: pos * PPB,
        width: 1,
        background: 'var(--ra-playhead)',
        pointerEvents: 'none'
      }}
    />
  )
}
