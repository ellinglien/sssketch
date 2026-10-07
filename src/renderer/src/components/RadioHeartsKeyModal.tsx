import { useEffect, useState } from 'react'
import type { RadioHeartsKeyStatus } from '@shared/radioHearts'
import { refreshRadioHeartsKeyStatus } from '../state/appFeatures'

/** Settings menu's "radio hearts key…" entry -- the key Discover's "fetch
 * hearts" sends to ell.ing/radio's private hearts.json. Main keeps it
 * encrypted (radioHeartsKeyStore.ts) and never sends it back here, so this
 * only ever shows WHETHER one is set -- and says so when it is held for
 * this session only (no keychain). Typing a new one replaces it.
 *
 * Same modal shell as KeyGesturesModal.tsx / AudioDeviceModal.tsx; the
 * input is EndlesssLoginPanel.tsx's password field. */
export function RadioHeartsKeyModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [status, setStatus] = useState<RadioHeartsKeyStatus | null>(null)
  const keySet = status === 'saved' || status === 'session'
  const [draft, setDraft] = useState('')

  useEffect(() => {
    let cancelled = false
    void window.rifffApi.radioHeartsKeyStatus().then((next) => {
      if (!cancelled) setStatus(next)
    })
    return () => {
      cancelled = true
    }
  }, [])

  async function save(key: string | null): Promise<void> {
    setStatus(await window.rifffApi.setRadioHeartsKey(key))
    setDraft('')
    // Discover's `fetch hearts` buttons show only with a key (appFeatures.ts).
    refreshRadioHeartsKeyStatus()
  }

  const buttonStyle = {
    height: 28,
    borderRadius: 0,
    padding: '0 14px',
    fontSize: 11,
    border: '1px solid var(--ra-border)',
    background: 'var(--ra-bg-row-active)',
    color: 'var(--ra-text)',
    cursor: 'pointer'
  } as const

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--ra-backdrop)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 'var(--ra-z-modal)'
      }}
    >
      <div
        style={{
          width: 'min(420px, 90vw)',
          background: 'var(--ra-bg-bar)',
          border: '1px solid var(--ra-border)',
          borderRadius: 0,
          padding: 18,
          display: 'flex',
          flexDirection: 'column',
          gap: 16
        }}
      >
        <p style={{ margin: 0, fontSize: 11, color: 'var(--ra-text)' }}>radio hearts key</p>
        <span style={{ fontSize: 10, color: 'var(--ra-text-2)' }}>
          {status === null
            ? '…'
            : status === 'saved'
              ? 'a key is set'
              : status === 'session'
                ? 'a key is set (this session only)'
                : 'no key set'}
        </span>
        <input
          type="password"
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          placeholder={keySet ? 'new key' : 'key'}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft.trim() !== '') void save(draft)
            if (e.key === 'Escape') onClose()
          }}
          style={{
            height: 22,
            fontSize: 10,
            background: 'var(--ra-bg-row-active)',
            color: 'var(--ra-text)',
            border: '1px solid var(--ra-border)',
            borderRadius: 0,
            padding: '0 6px'
          }}
        />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          {keySet && (
            <button onClick={() => void save(null)} style={buttonStyle}>
              clear
            </button>
          )}
          <button
            onClick={() => void save(draft)}
            disabled={draft.trim() === ''}
            style={{
              ...buttonStyle,
              color: draft.trim() === '' ? 'var(--ra-text-4)' : 'var(--ra-text)',
              cursor: draft.trim() === '' ? 'default' : 'pointer'
            }}
          >
            save
          </button>
          <button onClick={onClose} style={buttonStyle}>
            close
          </button>
        </div>
      </div>
    </div>
  )
}
