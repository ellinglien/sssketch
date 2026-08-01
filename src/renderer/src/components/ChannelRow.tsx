import { useState } from 'react'
import type { Rifff } from '@shared/types'
import { RifffBlockRow } from './RifffBlockRow'
import { ChannelChainPanel } from './ChannelChainPanel'

/** One arranger row, hosting every clip currently assigned to this channel
 * (see channelOf in store.ts) — could be exactly one clip (today's default,
 * unchanged visually) or several sharing the row, each still positioned by
 * its own clipGeometry exactly as RifffBlockRow already does; if two
 * overlap in time they'll visually overlap too; z-order (which one's on
 * top) follows plain array order, matching the design spec.
 *
 * This component owns the row's own onDrop, stopping propagation so a drop
 * landing here reassigns the dragged clip's channel to THIS one (see
 * App.tsx's Timeline, which supplies onDropOnChannel) rather than falling
 * through to the Timeline container's own fallback (which always means
 * "give it a brand new channel instead").
 *
 * Also owns a small "fx" button opening this channel's own 2-slot plugin
 * chain panel (see docs/superpowers/specs/2026-08-01-channel-plugin-inserts-design.md)
 * -- pinned to the row's own top-left corner since this app's channels have
 * no persistent header/gutter area today; it may visually sit near a bar-0
 * clip's own corner, an accepted v1 simplification rather than a bug. */
export function ChannelRow({
  channelId,
  rifffs,
  onOpenContextMenu,
  onDropOnChannel
}: {
  channelId: string
  rifffs: Rifff[]
  onOpenContextMenu: (x: number, y: number, groupId: string) => void
  onDropOnChannel: (e: React.DragEvent<HTMLDivElement>, channelId: string) => void
}): React.JSX.Element {
  const [chainPanelOpen, setChainPanelOpen] = useState(false)

  return (
    <div
      data-channel-id={channelId}
      onDrop={(e) => onDropOnChannel(e, channelId)}
      style={{ position: 'relative' }}
    >
      <button
        onClick={(e) => {
          e.stopPropagation()
          setChainPanelOpen(true)
        }}
        aria-label={`channel ${channelId} plugin chain`}
        title="channel plugin chain"
        style={{
          position: 'absolute',
          top: 2,
          left: 2,
          zIndex: 5,
          fontSize: 9,
          padding: '1px 4px',
          fontFamily: 'inherit',
          background: 'var(--ra-bg-row-active)',
          border: '1px solid var(--ra-border)',
          borderRadius: 2,
          color: 'var(--ra-text-2)',
          cursor: 'pointer'
        }}
      >
        fx
      </button>
      {rifffs.map((rifff) => (
        <RifffBlockRow
          key={rifff.groupId}
          groupId={rifff.groupId}
          onOpenContextMenu={onOpenContextMenu}
        />
      ))}
      {chainPanelOpen && (
        <ChannelChainPanel channelId={channelId} onClose={() => setChainPanelOpen(false)} />
      )}
    </div>
  )
}
