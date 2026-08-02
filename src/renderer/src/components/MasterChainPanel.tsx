// src/renderer/src/components/MasterChainPanel.tsx
import { useState } from 'react'
import {
  useAppState,
  useDispatch,
  useMasterChainStatus,
  useMasterChainError,
  usePluginCatalog,
  usePluginScanState,
  usePluginCatalogActions
} from '../state/StoreContext'
import { PluginCatalogBrowser } from './PluginCatalogBrowser'

const SLOT_LABELS = ['1', '2', '3', '4'] as const

// This app's buttons render with no default chrome of their own (see
// global.css: `button { color: inherit }`, no background) -- every button
// here needs an explicit dark-theme style or it falls back to the browser's
// own default control chrome (light background, near-white inherited text
// = nearly invisible). Matches the button convention already used
// elsewhere (e.g. TransportBar's snap-grid button). A disabled button gets
// a visibly dimmer treatment since setting an explicit background/color
// overrides the browser's own automatic disabled-button styling.
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

const selectStyle: React.CSSProperties = {
  fontFamily: 'inherit',
  fontSize: 11,
  padding: '3px 4px',
  background: 'var(--ra-bg-row)',
  border: '1px solid var(--ra-border)',
  borderRadius: 2,
  color: 'var(--ra-text)',
  // A flex item's default min-width is its content's intrinsic width, not 0
  // -- without this, a long plugin name (e.g. "SAUSAGEFATTENER") stops this
  // select from shrinking, overflowing the row and pushing the status dot
  // and edit button past the panel's own right padding.
  minWidth: 0
}

export function MasterChainPanel({ onClose }: { onClose: () => void }): React.JSX.Element {
  const state = useAppState()
  const dispatch = useDispatch()
  const status = useMasterChainStatus()
  const error = useMasterChainError()
  const catalog = usePluginCatalog()
  const { scanning, progress } = usePluginScanState()
  const { triggerScan } = usePluginCatalogActions()
  const favourites = catalog.plugins.filter((p) => catalog.favouriteIds.includes(p.id))
  const [browsingSlot, setBrowsingSlot] = useState<number | null>(null)

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
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
          width: 300,
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
          <span style={{ color: 'var(--ra-text-2)' }}>master chain</span>
          <button onClick={onClose} aria-label="Close master chain panel" style={buttonStyle()}>
            ×
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <button onClick={triggerScan} disabled={scanning} style={buttonStyle(scanning)}>
            {scanning
              ? `scanning... ${progress ? `${progress.done}/${progress.total}` : ''}`
              : 'scan for plugins'}
          </button>
        </div>
        {SLOT_LABELS.map((label, slot) => {
          const pluginId = state.masterChain[slot]
          const slotStatus = status[slot]
          const slotError = error[slot]
          const editDisabled = slotStatus !== 'loaded'
          return (
            <div
              key={slot}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0' }}
              title={slotError ?? undefined}
            >
              <span style={{ color: 'var(--ra-text-2)', width: 12 }}>{label}</span>
              <select
                value={pluginId ?? ''}
                onChange={(e) => {
                  if (e.target.value === '__browse__') {
                    setBrowsingSlot(slot)
                    return
                  }
                  dispatch({
                    type: 'SET_MASTER_CHAIN_PLUGIN',
                    slot: slot as 0 | 1 | 2 | 3,
                    pluginId: e.target.value === '' ? null : e.target.value
                  })
                }}
                style={{ ...selectStyle, flex: 1 }}
              >
                <option value="">none</option>
                {favourites.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                    {entry.arch === 'x86_64' ? ' (bridged)' : ''}
                  </option>
                ))}
                <option value="__browse__">browse all...</option>
              </select>
              <span
                aria-label={`slot ${label} status: ${slotStatus}`}
                title={slotStatus}
                style={{
                  width: 9,
                  height: 9,
                  flexShrink: 0,
                  borderRadius: '50%',
                  background:
                    slotStatus === 'loaded'
                      ? 'var(--ra-stretch-on)'
                      : slotStatus === 'error'
                        ? 'var(--ra-mute-on)'
                        : slotStatus === 'loading'
                          ? 'var(--ra-type-notes)'
                          : 'var(--ra-border-strong)'
                }}
              />
              <button
                onClick={() => void window.rifffApi.engineOpenMasterPluginEditor(slot)}
                disabled={editDisabled}
                aria-label={`edit slot ${label} plugin`}
                style={buttonStyle(editDisabled)}
              >
                edit
              </button>
            </div>
          )
        })}
      </div>
      {browsingSlot !== null && (
        <PluginCatalogBrowser
          onSelect={(id) =>
            dispatch({
              type: 'SET_MASTER_CHAIN_PLUGIN',
              slot: browsingSlot as 0 | 1 | 2 | 3,
              pluginId: id
            })
          }
          onClose={() => setBrowsingSlot(null)}
        />
      )}
    </div>
  )
}
