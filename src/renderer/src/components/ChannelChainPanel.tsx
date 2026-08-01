// src/renderer/src/components/ChannelChainPanel.tsx
import { useState } from 'react'
import {
  useAppState,
  useDispatch,
  useChannelChainStatus,
  useChannelChainError,
  usePluginCatalog,
  usePluginScanState,
  usePluginCatalogActions
} from '../state/StoreContext'
import { PluginCatalogBrowser } from './PluginCatalogBrowser'

const SLOT_LABELS = ['1', '2'] as const

// See MasterChainPanel.tsx's own buttonStyle doc comment -- same reasoning,
// same convention, just duplicated here rather than shared since it's a
// small, self-contained styling helper (not worth a cross-component import
// for two functions).
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
  color: 'var(--ra-text)'
}

/** 2-slot version of MasterChainPanel, scoped to one channel's own plugin
 * chain -- see docs/superpowers/specs/2026-08-01-channel-plugin-inserts-design.md.
 * Reuses the master chain's own favourites-filtered dropdown, scan button
 * (shared across the whole app, not per-channel -- one catalog), status
 * dots, and "edit" button conventions, keyed by channelId+slot instead of
 * a fixed slot index. */
export function ChannelChainPanel({
  channelId,
  onClose
}: {
  channelId: string
  onClose: () => void
}): React.JSX.Element {
  const state = useAppState()
  const dispatch = useDispatch()
  const status = useChannelChainStatus()[channelId] ?? ['idle', 'idle']
  const error = useChannelChainError()[channelId] ?? [null, null]
  const catalog = usePluginCatalog()
  const { scanning, progress } = usePluginScanState()
  const { triggerScan } = usePluginCatalogActions()
  const favourites = catalog.plugins.filter((p) => catalog.favouriteIds.includes(p.id))
  const [browsingSlot, setBrowsingSlot] = useState<number | null>(null)
  const slots = state.channelPlugins[channelId] ?? [null, null]

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
          <span style={{ color: 'var(--ra-text-2)' }}>channel chain</span>
          <button onClick={onClose} aria-label="Close channel chain panel" style={buttonStyle()}>
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
          const pluginId = slots[slot]
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
                    type: 'SET_CHANNEL_CHAIN_PLUGIN',
                    channelId,
                    slot: slot as 0 | 1,
                    pluginId: e.target.value === '' ? null : e.target.value
                  })
                }}
                style={{ ...selectStyle, flex: 1 }}
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
                aria-label={`channel ${channelId} slot ${label} status: ${slotStatus}`}
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
                onClick={() => void window.rifffApi.engineOpenChannelPluginEditor(channelId, slot)}
                disabled={editDisabled}
                aria-label={`edit channel ${channelId} slot ${label} plugin`}
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
              type: 'SET_CHANNEL_CHAIN_PLUGIN',
              channelId,
              slot: browsingSlot as 0 | 1,
              pluginId: id
            })
          }
          onClose={() => setBrowsingSlot(null)}
        />
      )}
    </div>
  )
}
