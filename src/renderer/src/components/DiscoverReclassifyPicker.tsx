// src/renderer/src/components/DiscoverReclassifyPicker.tsx
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ArrangeRole } from '@shared/stemRole'
import { DISCOVER_RECLASSIFY_ROLES } from '@shared/discoverMatchMeter'
import { ROLE_LABELS } from '@shared/autoArrangeLabels'

/** Match meter reclassify (docs/superpowers/specs/2026-09-22-discover-
 * promise-vs-delivery-design.md, Phase 2): opened from a mask kind's source
 * word on a slot's meter. Lists every Tidy Up role. Picking one calls onPick
 * (the caller records a Tidy Up-style confirmation) and closes; the slot
 * keeps its stem. Position + dismissal mirror DiscoverKindPicker.tsx /
 * DiscoverNearbyPopover.tsx.
 *
 * **Kind names describe a SLOT; role names describe a STEM.** This picker
 * writes an ArrangeRole onto a file, so it says the ROLE's name
 * (ROLE_LABELS) -- it used to say discoverRoleLabel(role, ROLE_LABELS),
 * which prefers a mask kind's playful name where one exists, so picking
 * "drummy" wrote arrangeRole: 'drums'. That is the two vocabularies leaking
 * into each other at the one place a user is making a claim about a file.
 * The match meter, which is explaining why a SLOT admitted a stem, keeps
 * the kind names -- that is what it is talking about, and
 * discoverRoleLabel still serves it (DiscoverPanel.tsx). */
export function DiscoverReclassifyPicker({
  x,
  y,
  currentRole,
  onPick,
  onClose,
  ignoreRef
}: {
  x: number
  y: number
  /** Highlighted as the current choice -- the role the clicked entry
   * stands for; null when unknown. */
  currentRole: ArrangeRole | null
  onPick: (role: ArrangeRole) => void
  onClose: () => void
  ignoreRef: React.RefObject<HTMLElement | null>
}): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: x, top: y })

  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const margin = 8
    const left = Math.max(margin, Math.min(x, window.innerWidth - rect.width - margin))
    const top = Math.max(margin, Math.min(y, window.innerHeight - rect.height - margin))
    setPosition({ left, top })
  }, [x, y])

  useEffect(() => {
    function handleDismiss(e: MouseEvent): void {
      if (menuRef.current?.contains(e.target as Node)) return
      if (ignoreRef.current?.contains(e.target as Node)) return
      onClose()
    }
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    const id = setTimeout(() => {
      window.addEventListener('click', handleDismiss, true)
    }, 0)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      clearTimeout(id)
      window.removeEventListener('click', handleDismiss, true)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose, ignoreRef])

  return (
    <div
      ref={menuRef}
      role="dialog"
      aria-label="reclassify stem"
      style={{
        position: 'fixed',
        left: position.left,
        top: position.top,
        zIndex: 1200,
        maxWidth: 260,
        background: 'var(--ra-bg-bar)',
        border: '1px solid var(--ra-border-strong)',
        padding: 8,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        boxShadow: '0 6px 20px rgba(0,0,0,0.4)'
      }}
    >
      <span
        style={{
          fontSize: 9,
          color: 'var(--ra-text-3)',
          textTransform: 'uppercase',
          letterSpacing: 'var(--ra-track-eyebrow)'
        }}
      >
        this stem is
      </span>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {DISCOVER_RECLASSIFY_ROLES.map((role) => {
          const on = role === currentRole
          return (
            <button
              key={role}
              aria-pressed={on}
              onClick={() => {
                onPick(role)
                onClose()
              }}
              style={{
                fontFamily: 'inherit',
                fontSize: 9,
                padding: 'var(--ra-s-0) 8px',
                background: on ? 'var(--ra-bg-row-active)' : 'transparent',
                border: `1px solid ${on ? 'var(--ra-text)' : 'var(--ra-border)'}`,
                color: on ? 'var(--ra-text)' : 'var(--ra-text-2)',
                cursor: 'pointer'
              }}
            >
              {ROLE_LABELS[role] ?? role}
            </button>
          )
        })}
      </div>
      <span style={{ fontSize: 9, color: 'var(--ra-text-3)' }}>
        saved like a tidy up confirmation · the slot keeps this stem
      </span>
    </div>
  )
}
