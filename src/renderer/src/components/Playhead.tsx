import { useAppState } from '../state/StoreContext'
import { PPB } from './Ruler'

export function Playhead(): React.JSX.Element {
  const state = useAppState()
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: state.pos * PPB,
        width: 1,
        background: 'var(--ra-playhead)',
        pointerEvents: 'none'
      }}
    />
  )
}
