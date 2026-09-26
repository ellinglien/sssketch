import { useEffect, useMemo, useRef, useState } from 'react'
import {
  COPIED_FEEDBACK_MS,
  copyLinkLabel,
  type CopyState,
  type PhoneRemoteModalView
} from '@shared/phoneRemoteView'
import { qrSvg } from '@shared/qrSvg'

/** The phone remote's address, QR code and pairing code, as a modal that
 * opens THE MOMENT THE REMOTE IS SWITCHED ON.
 *
 * It replaces three disabled rows in the gear menu, which is where this
 * information used to live and where it failed for real: switching the
 * remote on closes the menu, so the code only appeared if you happened to
 * reopen the gear -- "clicked phone but nothing prompted me with a code or
 * anything" (Elling, 2026-09-26). The one thing needed, at the one moment
 * it is needed, was invisible.
 *
 * Same modal shell as AudioDeviceModal.tsx (which itself copies
 * OnboardingModal.tsx's fixed-overlay + centered-card shape): no
 * click-outside dismiss, an explicit button instead, sharp corners,
 * lowercase copy.
 *
 * Whether this is on screen at all is phoneRemoteModalView()'s decision
 * (src/shared/phoneRemoteView.ts) -- this component renders a view it is
 * given and never asks whether there is one. */
export function PhoneRemoteModal({
  view,
  onClose,
  onTurnOff
}: {
  view: PhoneRemoteModalView
  /** Dismisses the card. Leaves the remote RUNNING -- see the two buttons
   * at the bottom, which is the whole reason they are worded the way they
   * are. */
  onClose: () => void
  onTurnOff: () => void
}): React.JSX.Element {
  const [copyState, setCopyState] = useState<CopyState>('idle')
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current !== null) clearTimeout(copiedTimerRef.current)
    }
  }, [])

  function flashCopyState(state: CopyState): void {
    setCopyState(state)
    if (copiedTimerRef.current !== null) clearTimeout(copiedTimerRef.current)
    copiedTimerRef.current = setTimeout(() => setCopyState('idle'), COPIED_FEEDBACK_MS)
  }

  function handleCopy(): void {
    // The paired link, not the bare address: an iPhone shares the Mac's
    // clipboard over Universal Clipboard, so copy here and paste into
    // Safari there is a second no-typing path that costs nothing to offer.
    void navigator.clipboard.writeText(view.pairedUrl).then(
      () => flashCopyState('copied'),
      (error: unknown) => {
        console.error('PhoneRemoteModal: clipboard write failed:', error)
        flashCopyState('failed')
      }
    )
  }

  // The QR encodes the paired link, so scanning it with the camera opens the
  // page and pairs in one motion, with nothing typed -- four characters
  // under time pressure on a phone was the worst part of this flow.
  const qr = useMemo(() => qrSvg(view.pairedUrl), [view.pairedUrl])

  const buttonStyle: React.CSSProperties = {
    height: 28,
    borderRadius: 0,
    padding: '0 14px',
    fontSize: 11,
    border: '1px solid var(--ra-border)',
    background: 'var(--ra-bg-row-active)',
    color: 'var(--ra-text)',
    cursor: 'pointer'
  }

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
          width: 'min(360px, 90vw)',
          maxHeight: '90vh',
          overflowY: 'auto',
          background: 'var(--ra-bg-bar)',
          border: '1px solid var(--ra-border)',
          borderRadius: 0,
          padding: 18,
          display: 'flex',
          flexDirection: 'column',
          gap: 14
        }}
      >
        <p style={{ margin: 0, fontSize: 11, color: 'var(--ra-text)' }}>phone remote</p>
        <p style={{ margin: 0, fontSize: 10, color: 'var(--ra-text-2)' }}>
          scan this with the phone camera, on the same wifi
        </p>

        <div
          style={{
            alignSelf: 'center',
            // Dark modules on a light plate, not the app's usual near-black
            // on near-black: a camera reads normal polarity everywhere, and
            // an inverted code is a coin toss per scanner app. Both values
            // are the app's own monochrome tokens -- no new colour, and the
            // bright square is the one thing on this card a lens has to see.
            background: 'var(--ra-text)',
            padding: 0,
            lineHeight: 0
          }}
        >
          <svg
            width={192}
            height={192}
            viewBox={`0 0 ${qr.size} ${qr.size}`}
            shapeRendering="crispEdges"
            role="img"
            aria-label="pairing link as a qr code"
          >
            <path d={qr.path} fill="var(--ra-bg-page)" />
          </svg>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ra-s-1)' }}>
          <span className="ra-eyebrow">pairing code</span>
          <div
            style={{
              border: '1px solid var(--ra-border)',
              background: 'var(--ra-bg-row-active)',
              padding: '10px 12px',
              textAlign: 'center',
              fontSize: 'var(--ra-fs-19)',
              fontWeight: 'var(--ra-fw-bold)',
              letterSpacing: '0.35em',
              // The letter-spacing is trailing space after the last
              // character; this pulls the block back to visually centred.
              textIndent: '0.35em',
              color: 'var(--ra-text)',
              userSelect: 'text'
            }}
          >
            {view.pairingCode}
          </div>
          <span style={{ fontSize: 10, color: 'var(--ra-text-2)' }}>
            or type it on the phone, if the camera is not to hand
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ra-s-1)' }}>
          <span className="ra-eyebrow">address</span>
          <span
            style={{
              fontSize: 'var(--ra-fs-16)',
              color: 'var(--ra-text)',
              wordBreak: 'break-all',
              userSelect: 'text'
            }}
          >
            {view.url}
          </span>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--ra-s-2)',
              flexWrap: 'wrap'
            }}
          >
            <button
              onClick={handleCopy}
              aria-label="copy the paired link"
              title="copies paired link"
              style={buttonStyle}
            >
              {copyLinkLabel(copyState)}
            </button>
            <span style={{ fontSize: 10, color: 'var(--ra-text-2)' }}>
              the copied link has the code in it
            </span>
          </div>
        </div>

        {view.pairingNote !== null && (
          <span style={{ fontSize: 10, color: 'var(--ra-text-2)' }}>{view.pairingNote}</span>
        )}

        {/* Two exits, worded so they cannot be confused: closing a window
         * must never silently kill the thing the window was describing. */}
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--ra-s-2)' }}>
          <button
            onClick={onTurnOff}
            aria-label="turn the phone remote off"
            title="stops the remote"
            style={{ ...buttonStyle, color: 'var(--ra-mute-on)' }}
          >
            turn off remote
          </button>
          <button
            onClick={onClose}
            aria-label="close this window and leave the remote on"
            title="leaves it running"
            style={{ ...buttonStyle, border: '1px solid var(--ra-border-strong)' }}
          >
            close, remote stays on
          </button>
        </div>
      </div>
    </div>
  )
}
