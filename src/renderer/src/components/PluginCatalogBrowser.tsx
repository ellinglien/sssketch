// src/renderer/src/components/PluginCatalogBrowser.tsx
import { usePluginCatalog, usePluginCatalogActions } from '../state/StoreContext'

export function PluginCatalogBrowser({
  onSelect,
  onClose
}: {
  onSelect: (id: string) => void
  onClose: () => void
}): React.JSX.Element {
  const catalog = usePluginCatalog()
  const { toggleFavourite } = usePluginCatalogActions()

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 110,
        background: 'rgba(0, 0, 0, 0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--ra-bg-row-active)',
          border: '1px solid var(--ra-border)',
          borderRadius: 4,
          padding: 8,
          width: 360,
          maxHeight: 420,
          overflowY: 'auto',
          fontSize: 11
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ color: 'var(--ra-text-2)' }}>all scanned plugins</span>
          <button onClick={onClose} aria-label="Close plugin catalog browser">
            ×
          </button>
        </div>
        {catalog.plugins.length === 0 && (
          <div style={{ color: 'var(--ra-text-2)', padding: '8px 0' }}>
            no plugins scanned yet -- try &quot;scan for plugins&quot; first
          </div>
        )}
        {catalog.plugins.map((entry) => {
          const loadable = entry.arch === 'arm64' || entry.arch === 'universal'
          const isFavourite = catalog.favouriteIds.includes(entry.id)
          return (
            <div
              key={entry.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '3px 0',
                opacity: loadable ? 1 : 0.5
              }}
            >
              <button
                onClick={() => toggleFavourite(entry.id)}
                aria-label={`${isFavourite ? 'unfavourite' : 'favourite'} ${entry.name}`}
                style={{ fontSize: 10, padding: '1px 4px' }}
              >
                {isFavourite ? '★' : '☆'}
              </button>
              <span style={{ flex: 1 }}>{entry.name}</span>
              <span style={{ color: 'var(--ra-text-2)', fontSize: 9 }}>{entry.arch}</span>
              <button
                onClick={() => {
                  onSelect(entry.id)
                  onClose()
                }}
                disabled={!loadable}
                aria-label={`use ${entry.name}`}
                style={{ fontSize: 10, padding: '1px 6px' }}
              >
                use
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
