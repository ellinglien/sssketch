// src/renderer/src/components/PluginCatalogBrowser.tsx
import { usePluginCatalog, usePluginCatalogActions } from '../state/StoreContext'

// See MasterChainPanel.tsx's own buttonStyle doc comment -- buttons in this
// app have no default chrome (global.css: `button { color: inherit }`, no
// background), so every button needs an explicit dark-theme style or it
// falls back to the browser's own near-invisible default control chrome.
function buttonStyle(disabled?: boolean): React.CSSProperties {
  return {
    fontFamily: 'inherit',
    fontSize: 10,
    padding: '3px 8px',
    background: 'var(--ra-bg-row-active)',
    border: `1px solid ${disabled ? 'var(--ra-border-soft)' : 'var(--ra-border)'}`,
    borderRadius: 2,
    color: disabled ? 'var(--ra-text-4)' : 'var(--ra-text-2)',
    cursor: disabled ? 'default' : 'pointer'
  }
}

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
          padding: 10,
          width: 380,
          // minHeight: 0 overrides the browser's default min-height: auto on
          // a flex child (this box is a child of the backdrop's own
          // display:flex) -- without it, a flex child ignores maxHeight and
          // just grows to fit all its content instead, so the list ran off
          // the bottom of the screen with no scrollbar and no way to reach
          // the rest, reading as "stuck"/"fixed" rather than actually
          // scrollable. maxHeight is viewport-relative (not a fixed 420px)
          // so it stays sane on a shorter window too.
          minHeight: 0,
          maxHeight: '70vh',
          overflowY: 'auto',
          fontSize: 11
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 8
          }}
        >
          <span style={{ color: 'var(--ra-text-2)' }}>all scanned plugins</span>
          <button onClick={onClose} aria-label="Close plugin catalog browser" style={buttonStyle()}>
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
                padding: '4px 0',
                opacity: loadable ? 1 : 0.5
              }}
            >
              <button
                onClick={() => toggleFavourite(entry.id)}
                aria-label={`${isFavourite ? 'unfavourite' : 'favourite'} ${entry.name}`}
                style={{
                  ...buttonStyle(),
                  padding: '2px 6px',
                  color: isFavourite ? 'var(--ra-stretch-on)' : 'var(--ra-text-2)'
                }}
              >
                {isFavourite ? '★' : '☆'}
              </button>
              <span style={{ flex: 1, color: 'var(--ra-text)' }}>{entry.name}</span>
              <span style={{ color: 'var(--ra-text-2)', fontSize: 9 }}>{entry.arch}</span>
              <button
                onClick={() => {
                  onSelect(entry.id)
                  onClose()
                }}
                disabled={!loadable}
                aria-label={`use ${entry.name}`}
                style={buttonStyle(!loadable)}
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
