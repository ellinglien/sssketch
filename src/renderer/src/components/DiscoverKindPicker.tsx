// src/renderer/src/components/DiscoverKindPicker.tsx
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  DISCOVER_MASK_SLOT_KINDS,
  DISCOVER_SLOT_KIND_LABEL,
  DISCOVER_TRAIT_SLOT_KINDS,
  slotKindsKey,
  toggleSlotKind,
  type DiscoverSlotKind
} from '@shared/discoverSlotKind'

/** Combination slots (docs/superpowers/specs/2026-09-21-discover-combo-
 * slot-kinds-design.md, mockup option B): opened from a slot's own kind
 * label. Two chip rows -- instrument (OR filter) and trait (AND ranking).
 * Every toggle calls onChange immediately (the panel rerolls the slot);
 * the picker stays open so several chips can be tried in a row. Position +
 * dismissal mirror DiscoverNearbyPopover.tsx / ContextMenu.tsx. */
export function DiscoverKindPicker({
  x,
  y,
  kinds,
  maskKindsDisabled,
  onChange,
  onClose,
  ignoreRef
}: {
  x: number
  y: number
  kinds: DiscoverSlotKind[]
  /** DiscoverPanel's "endlesss" checkbox is off -- instrument kinds are
   * Endlesss content by definition, so they can't be picked. */
  maskKindsDisabled: boolean
  onChange: (kinds: DiscoverSlotKind[]) => void
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

  function chip(kind: DiscoverSlotKind): React.JSX.Element {
    const on = kinds.includes(kind)
    // maskKindsDisabled only blocks turning a mask chip ON -- an already-ON
    // one (e.g. a 'drums' slot after "endlesss" gets unticked) must stay
    // toggleable OFF, or the picker becomes a dead end: no way to remove
    // the one kind that's no longer selectable at all (the last-chip guard
    // below still stops it being the very last kind on the slot).
    const disabled = maskKindsDisabled && !on && DISCOVER_MASK_SLOT_KINDS.includes(kind)
    const isLastOn = on && kinds.length === 1
    return (
      <button
        key={kind}
        disabled={disabled}
        aria-pressed={on}
        data-tooltip={
          disabled ? 'needs endlesss on' : isLastOn ? 'a slot needs at least one kind' : undefined
        }
        onClick={() => {
          const next = toggleSlotKind(kinds, kind)
          if (slotKindsKey(next) !== slotKindsKey(kinds)) onChange(next)
        }}
        style={{
          fontFamily: 'inherit',
          fontSize: 9,
          padding: 'var(--ra-s-0) 8px',
          background: on ? 'var(--ra-bg-row-active)' : 'transparent',
          border: `1px solid ${on ? 'var(--ra-text)' : 'var(--ra-border)'}`,
          color: on ? 'var(--ra-text)' : 'var(--ra-text-2)',
          opacity: disabled ? 0.3 : 1,
          cursor: disabled ? 'not-allowed' : 'pointer'
        }}
      >
        {DISCOVER_SLOT_KIND_LABEL[kind]}
      </button>
    )
  }

  function row(label: string, list: DiscoverSlotKind[]): React.JSX.Element {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span
          style={{
            width: 76,
            fontSize: 9,
            color: 'var(--ra-text-3)',
            textTransform: 'uppercase',
            letterSpacing: 'var(--ra-track-eyebrow)'
          }}
        >
          {label}
        </span>
        {list.map(chip)}
      </div>
    )
  }

  return (
    <div
      ref={menuRef}
      role="dialog"
      aria-label="slot kinds"
      style={{
        position: 'fixed',
        left: position.left,
        top: position.top,
        zIndex: 1200,
        background: 'var(--ra-bg-bar)',
        border: '1px solid var(--ra-border-strong)',
        padding: 8,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        boxShadow: '0 6px 20px rgba(0,0,0,0.4)'
      }}
    >
      {row('instrument', DISCOVER_MASK_SLOT_KINDS)}
      {row('trait', DISCOVER_TRAIT_SLOT_KINDS)}
      <span style={{ fontSize: 9, color: 'var(--ra-text-3)' }}>
        changing kinds rerolls this slot
      </span>
    </div>
  )
}
