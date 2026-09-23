import { riserEndBar, risersOnChannel } from '@shared/riser'
import { sectionLaneChannelIds } from '@shared/coachSections'
import type { MapClip } from '@shared/coachMapEdit'
import type { SoundType } from '@shared/types'
import { channelsInOrder, resolvePlayedBars } from './selectors'
import type { AppState } from './store'

/**
 * The arranger's rows, as the map needs to see them.
 *
 * A PLAIN FUNCTION over AppState, not a hook, deliberately:
 * usePlacedFlatStems.ts's own doc comment records the same choice being
 * forced once already ("it needs to be a plain function testable directly
 * against an AppState in selectors.test.ts without React"). The map's read
 * path is the riskiest thing in this feature and it has to be testable
 * without mounting anything.
 *
 * Rows come from channelsInOrder(state), which is what the arranger itself
 * draws -- "rows are the arranger's own channel rows" (spec). Three kinds,
 * and the difference is only about what the map may DO to them:
 *
 * - **stem** -- a row the guided map laid out, so the map knows which stem
 *   belongs on it and can put one back. Toggleable.
 * - **riser** -- a row whose content is a riser. READ-ONLY, and monochrome:
 *   a riser has no SoundType and RiserBlock.tsx is explicit that it "must
 *   not be given one just to have a hue". Toggling one on would mean
 *   INVENTING a riser, which is the spec's own named bad line ("add a riser
 *   at bar 48"). Risers arrive at the joins, in the tension pass, on a
 *   click.
 * - **other** -- clips the map did not lay out. Shown, because the map
 *   showing the whole song at once is what makes the pre-fill legitimate,
 *   but read-only: there is no stem the map could honestly put back.
 */
export type CoachMapRowKind = 'stem' | 'riser' | 'other'

export interface CoachMapRow {
  channelId: string
  kind: CoachMapRowKind
  /** The row's own label -- the stem's name, the riser's name, or the first
   * clip's name. */
  label: string
  /** The climax stem this row was laid out for. null for riser and other
   * rows, which is exactly what makes them read-only. */
  path: string | null
  /** For the one legitimate colour on the map (typeColorVar). null for a
   * riser, which has no sound type and must not be given one. */
  soundType: SoundType | null
  /** Every piece of material on this row, as bar windows. leftCrop is
   * already applied to startBar; mute and muteRegions deliberately are not
   * (see coachMapRead.ts's module doc). */
  clips: MapClip[]
}

export function coachMapRows(state: AppState): CoachMapRow[] {
  const lanes = sectionLaneChannelIds(state.coach?.sections ?? [])
  const pathByChannel: Record<string, string> = {}
  for (const [path, channelId] of Object.entries(lanes)) pathByChannel[channelId] = path

  return channelsInOrder(state).map((channel): CoachMapRow => {
    const channelRisers = risersOnChannel(state.risers, channel.channelId)
    const clips: MapClip[] = channel.rifffs
      .filter((rifff) => rifff.startBar !== undefined)
      .map((rifff): MapClip => {
        const startBar = (rifff.startBar ?? 0) + (state.leftCrop[rifff.groupId] ?? 0)
        return {
          groupId: rifff.groupId,
          startBar,
          endBar: (rifff.startBar ?? 0) + resolvePlayedBars(state, rifff.groupId)
        }
      })
    for (const riser of channelRisers) {
      clips.push({ groupId: riser.id, startBar: riser.startBar, endBar: riserEndBar(riser) })
    }

    const path = pathByChannel[channel.channelId]
    if (path !== undefined) {
      const stem =
        channel.rifffs[0]?.stems.find((s) => s.path === path) ?? channel.rifffs[0]?.stems[0]
      return {
        channelId: channel.channelId,
        kind: 'stem',
        label: stem?.name ?? path,
        path,
        soundType: stem?.type ?? null,
        clips
      }
    }
    if (channel.rifffs.length === 0 && channelRisers.length > 0) {
      return {
        channelId: channel.channelId,
        kind: 'riser',
        label: channelRisers[0].name,
        path: null,
        soundType: null,
        clips
      }
    }
    return {
      channelId: channel.channelId,
      kind: 'other',
      label: channel.rifffs[0]?.name ?? channel.channelId,
      path: null,
      soundType: channel.rifffs[0]?.stems[0]?.type ?? null,
      clips
    }
  })
}
