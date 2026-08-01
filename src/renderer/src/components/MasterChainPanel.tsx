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
          padding: 8,
          width: 260,
          fontSize: 11
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ color: 'var(--ra-text-2)' }}>master chain</span>
          <button onClick={onClose} aria-label="Close master chain panel">
            ×
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <button
            onClick={triggerScan}
            disabled={scanning}
            style={{ fontSize: 10, padding: '2px 6px' }}
          >
            {scanning
              ? `scanning... ${progress ? `${progress.done}/${progress.total}` : ''}`
              : 'scan for plugins'}
          </button>
        </div>
        {SLOT_LABELS.map((label, slot) => {
          const pluginId = state.masterChain[slot]
          const slotStatus = status[slot]
          const slotError = error[slot]
          return (
            <div
              key={slot}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0' }}
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
                style={{ flex: 1, fontSize: 11 }}
              >
                <option value="">none</option>
                {favourites.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
                <option value="__browse__">browse all...</option>
              </select>
              <span
                aria-label={`slot ${label} status: ${slotStatus}`}
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background:
                    slotStatus === 'loaded'
                      ? 'var(--ra-stretch-on)'
                      : slotStatus === 'error'
                        ? '#e05555'
                        : slotStatus === 'loading'
                          ? '#d9c34f'
                          : 'var(--ra-border)'
                }}
              />
              <button
                onClick={() => void window.rifffApi.engineOpenMasterPluginEditor(slot)}
                disabled={slotStatus !== 'loaded'}
                aria-label={`edit slot ${label} plugin`}
                style={{ fontSize: 10, padding: '1px 6px' }}
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
