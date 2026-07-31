// src/renderer/src/components/MasterChainPanel.tsx
import {
  useAppState,
  useDispatch,
  useMasterChainStatus,
  useMasterChainError
} from '../state/StoreContext'
import { MASTER_CHAIN_ALLOWLIST } from '@shared/masterChainAllowlist'

const SLOT_LABELS = ['1', '2', '3', '4'] as const

export function MasterChainPanel({ onClose }: { onClose: () => void }): React.JSX.Element {
  const state = useAppState()
  const dispatch = useDispatch()
  const status = useMasterChainStatus()
  const error = useMasterChainError()

  return (
    <div
      style={{
        position: 'absolute',
        top: 32,
        right: 8,
        zIndex: 20,
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
              onChange={(e) =>
                dispatch({
                  type: 'SET_MASTER_CHAIN_PLUGIN',
                  slot: slot as 0 | 1 | 2 | 3,
                  pluginId: e.target.value === '' ? null : e.target.value
                })
              }
              style={{ flex: 1, fontSize: 11 }}
            >
              <option value="">none</option>
              {MASTER_CHAIN_ALLOWLIST.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.displayName}
                </option>
              ))}
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
  )
}
