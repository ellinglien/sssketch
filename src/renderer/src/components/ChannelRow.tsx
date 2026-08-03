import { useMemo, useState } from 'react'
import type { Rifff } from '@shared/types'
import { stemKey } from '@shared/types'
import { RifffBlockRow } from './RifffBlockRow'
import { ChannelChainPanel } from './ChannelChainPanel'
import { useAppSelector, useDispatch } from '../state/StoreContext'

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
 * Also owns the channel's M/S/fx button stack (mute/solo the whole channel
 * at once via SET_CHANNEL_MUTE/SOLO_CHANNEL, plus the "fx" button opening
 * this channel's own 2-slot plugin chain panel — see
 * docs/superpowers/specs/2026-08-01-channel-plugin-inserts-design.md).
 * Pinned to the row's own right edge with position:sticky so it stays on
 * screen while the timeline scrolls horizontally, rather than the clip
 * title (which lives at the LEFT of each clip, per RifffBlockRow) ever
 * being covered. The sticky element itself has height:0 so it never adds
 * to the row's own flow height -- the actual visible buttons hang off it
 * via an absolutely-positioned child, a standard "zero-size sticky anchor"
 * technique for pinning an overlay to a scrolling viewport's edge without
 * disturbing surrounding layout. */
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
  const dispatch = useDispatch()
  // Read as whole maps, not per-key -- the solo check below genuinely needs
  // every rifff/mute entry in the project, not just this channel's own. This
  // still helps: this component now only re-renders when mute state or the
  // rifffs map actually changes, not on every dispatch anywhere (a volume
  // drag, fade adjustment, tempo change, etc. no longer touches it). See
  // docs/superpowers/specs/2026-08-03-fine-grained-state-selectors-design.md.
  const mute = useAppSelector((s) => s.mute)
  const rifffsMap = useAppSelector((s) => s.rifffs)

  const allMuted = useMemo(
    () =>
      rifffs.length > 0 &&
      rifffs.every((r) => r.stems.every((s) => mute[stemKey(r.groupId, s.slot)])),
    [rifffs, mute]
  )

  // Mirrors SOLO_GROUP/SOLO_CHANNEL's own "alreadySoloed" definition in
  // store.ts: every stem in this channel unmuted, every stem in every other
  // PLACED channel muted. When there's only one channel on the timeline
  // this is trivially true even with nothing "soloed" -- same accepted edge
  // case the pre-existing SOLO_GROUP check already has, not a new one.
  //
  // Scans EVERY rifff in the whole project, not just this channel's own --
  // memoized so that scan only re-runs when mute state or the project's own
  // rifff set actually changes.
  const soloed = useMemo(() => {
    const channelGroupIds = new Set(rifffs.map((r) => r.groupId))
    return Object.values(rifffsMap).every((r) => {
      if (r.startBar === undefined) return true
      const inThisChannel = channelGroupIds.has(r.groupId)
      return r.stems.every((s) => !!mute[stemKey(r.groupId, s.slot)] === !inThisChannel)
    })
  }, [rifffs, rifffsMap, mute])

  const baseButtonStyle: React.CSSProperties = {
    fontSize: 9,
    padding: '1px 4px',
    fontFamily: 'inherit',
    borderRadius: 2,
    cursor: 'pointer'
  }

  // Matches StemWaveformRow's own mute-active treatment: a filled reddish
  // background rather than just a colored border, so a muted channel reads
  // clearly even at this stack's small size.
  const muteButtonStyle: React.CSSProperties = {
    ...baseButtonStyle,
    background: allMuted ? 'var(--ra-mute-on)' : 'var(--ra-bg-row-active)',
    border: `1px solid ${allMuted ? 'var(--ra-mute-on)' : 'var(--ra-border)'}`,
    color: allMuted ? 'var(--ra-mute-on-ink)' : 'var(--ra-text-2)'
  }

  // Matches Inspector's own stretch-toggle treatment: a soft tinted
  // background with the accent color on border/text, not a hard fill.
  const soloButtonStyle: React.CSSProperties = {
    ...baseButtonStyle,
    background: soloed ? 'var(--ra-stretch-on-bg)' : 'var(--ra-bg-row-active)',
    border: `1px solid ${soloed ? 'var(--ra-stretch-on)' : 'var(--ra-border)'}`,
    color: soloed ? 'var(--ra-stretch-on)' : 'var(--ra-text-2)'
  }

  const fxButtonStyle: React.CSSProperties = {
    ...baseButtonStyle,
    background: 'var(--ra-bg-row-active)',
    border: '1px solid var(--ra-border)',
    color: 'var(--ra-text-2)'
  }

  return (
    <div
      data-channel-id={channelId}
      onDrop={(e) => onDropOnChannel(e, channelId)}
      style={{ position: 'relative' }}
    >
      <div style={{ position: 'sticky', right: 0, top: 0, height: 0, zIndex: 5 }}>
        <div
          style={{
            position: 'absolute',
            right: 4,
            top: 4,
            display: 'flex',
            flexDirection: 'column',
            gap: 2
          }}
        >
          <button
            onClick={(e) => {
              e.stopPropagation()
              dispatch({ type: 'SET_CHANNEL_MUTE', channelId, muted: !allMuted })
            }}
            aria-label={`mute channel ${channelId}`}
            title="mute channel"
            style={muteButtonStyle}
          >
            m
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              dispatch({ type: 'SOLO_CHANNEL', channelId })
            }}
            aria-label={`solo channel ${channelId}`}
            title="solo channel"
            style={soloButtonStyle}
          >
            s
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              setChainPanelOpen(true)
            }}
            aria-label={`channel ${channelId} plugin chain`}
            title="channel plugin chain"
            style={fxButtonStyle}
          >
            fx
          </button>
        </div>
      </div>
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
