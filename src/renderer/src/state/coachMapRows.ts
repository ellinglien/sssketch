import { riserEndBar, risersOnChannel } from '@shared/riser'
import { sectionLaneChannelIds } from '@shared/coachSections'
import type { MapClip } from '@shared/coachMapEdit'
import type { ArrangeRole } from '@shared/stemRole'
import type { SoundType } from '@shared/types'
import { stemLabelsByKey } from '../components/autoArrangeLabels'
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
  /** The row's own label.
   *
   * For a 'stem' row this is THE ROLE THE USER CONFIRMED in
   * AutoArrangeRoleStep, carried verbatim on the locked climax
   * (LockedClimaxStem.role) and spelled with the same ROLE_LABELS vocabulary
   * every other picker in the app uses. Not the stem's name and not its
   * SoundType: real Endlesss material is recorded through audio-in, so both
   * of those read "audio in" on nearly every row at once and the map ends up
   * saying nothing (direct report, 2026-09-23: "instead of showing the
   * categorized information from the initial auto arrange step it just shows
   * 'audio in' for most of the clips"). The role IS that categorized
   * information, and it is one step upstream already.
   *
   * Rows sharing a role are numbered ("drums 1", "drums 2") by
   * stemLabelsByKey, the same numbering DrawArrangeWizard's grid rows use --
   * two identical labels would re-lose exactly what this fixed.
   *
   * Falls back to the stem's name, then the path, when the climax has no
   * role for that path. A 'riser' row keeps the riser's own (editable) name
   * and an 'other' row its first clip's name: neither is a climax stem, so
   * there is no confirmed role to show and nothing may be invented. */
  label: string
  /** The climax stem this row was laid out for. null for riser and other
   * rows, which is exactly what makes them read-only. */
  path: string | null
  /** For the one legitimate colour on the map (typeColorVar). null for a
   * riser, which has no sound type and must not be given one.
   *
   * Deliberately still the STEM'S OWN SoundType, not the confirmed role the
   * label now uses, even though that means an all-audio-in climax colours
   * every row alike. ArrangeRole does not invert onto SoundType cleanly:
   * SOUND_TYPE_TO_ARRANGE_ROLE (stemRole.ts) sends both 'fx' and 'extFx' to
   * 'textureFx' and sends nothing at all to 'aux', so a Record<ArrangeRole,
   * SoundType> would have to make two colour assignments up. That is the
   * second colour table CLAUDE.md names as a mistake. The other tempting
   * source, busColorHex(ARRANGE_ROLE_TO_BUS[role]), is total and already
   * exists -- but it is the TIDIED view's palette, it flattens four of the
   * eight roles onto aux's taupe, and it would make a map row disagree in
   * colour with the very clip it points at in the arranger. Colour stays
   * where it is until there is a real mapping to use. */
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

  const channels = channelsInOrder(state)
  const roleByPath = new Map<string, ArrangeRole>()
  for (const stem of state.coach?.lockedClimax?.stems ?? []) roleByPath.set(stem.path, stem.role)

  // Numbered in ROW order, not in the climax's own order, so the "drums 1"
  // above "drums 2" on screen is always the earlier of the two.
  const roled: { stemKey: string; role: ArrangeRole; included: boolean }[] = []
  for (const channel of channels) {
    const path = pathByChannel[channel.channelId]
    if (path === undefined) continue
    const role = roleByPath.get(path)
    if (role === undefined) continue
    roled.push({ stemKey: path, role, included: true })
  }
  const labelByPath = stemLabelsByKey(roled)

  return channels.map((channel): CoachMapRow => {
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
        label: labelByPath.get(path) ?? stem?.name ?? path,
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
