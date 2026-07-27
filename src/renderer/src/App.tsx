import { StoreProvider, useAppState } from './state/StoreContext'
import { Titlebar } from './components/Titlebar'
import { TransportBar } from './components/TransportBar'
import { Ruler } from './components/Ruler'
import { Shelf } from './components/Shelf'
import { Inspector } from './components/Inspector'

function Frame(): React.JSX.Element {
  const state = useAppState()
  return (
    <div className="ra-frame">
      <Titlebar
        rifffCount={Object.keys(state.rifffs).length}
        stemCount={Object.values(state.rifffs).reduce((n, r) => n + r.stems.length, 0)}
      />
      <Shelf />
      <TransportBar />
      <div style={{ display: 'flex' }}>
        <div style={{ flex: 1 }}>
          <Ruler />
          {/* rifff block rows land here in Task 11 */}
        </div>
        <Inspector />
      </div>
    </div>
  )
}

export default function App(): React.JSX.Element {
  return (
    <StoreProvider>
      <Frame />
    </StoreProvider>
  )
}
