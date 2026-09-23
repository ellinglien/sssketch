import { riserEndBar, risersOnChannel } from '@shared/riser'
import { sectionLaneChannelIds } from '@shared/coachSections'
import type { MapClip } from '@shared/coachMapEdit'
import type { ArrangeRole } from '@shared/stemRole'
import { stemKey, type SoundType, type Stem } from '@shared/types'
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
 * - **stem** -- a row whose material names a SINGLE stem, so the map knows
 *   which stem belongs on it and can put one back. Toggleable. One rule for
 *   both maps: a guided lane qualifies because the builder laid one stem out
 *   on it, and a hand-made channel qualifies for exactly the same reason --
 *   see `source` below.
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
  /** The row's FALLBACK label, and only that: the riser's own (editable)
   * name for a 'riser' row, otherwise the stem's name, otherwise the path.
   *
   * **./coachMapRowLabels.ts decides the string actually drawn**, from the
   * full chain -- confirmed role out of the global StemCategories table ->
   * the climax `role` below -> this. It lives there rather than here because
   * the first link is an async read the renderer does and a pure function
   * over AppState cannot.
   *
   * Why a role is preferred at all, and worth not re-deriving: real Endlesss
   * material is recorded through audio-in, so a stem's name and its
   * SoundType both read "audio in" on nearly every row at once and the map
   * ends up saying nothing (direct report, 2026-09-23: "instead of showing
   * the categorized information from the initial auto arrange step it just
   * shows 'audio in' for most of the clips"). The role IS that categorized
   * information. */
  label: string
  /** The single stem this row's material names, or the climax stem it was
   * laid out for. null for a riser row and for a row whose clips name
   * several stems. */
  path: string | null
  /** The stem a toggle on this row would put back, and the gain it is
   * playing at.
   *
   * ONE RULE FOR BOTH MAPS (spec): **a row is toggleable when its material
   * names a single stem.** For a guided map that is every lane the builder
   * made, unchanged. For an unguided one it is every channel holding one
   * stem's clips -- which, in practice, is most of them, because that is
   * what the arranger's rows already are.
   *
   * Read from the row's OWN material first, and only then from the locked
   * climax. The climax used to be the only source (buildCellToggleActions
   * looked the path up in climax.stems), which is why an unguided map could
   * not be edited at all; it survives here purely as a fallback for a
   * guided row whose remaining clips no longer agree on one stem. Without
   * that fallback, emptying a guided row would make it permanently
   * un-refillable, which is exactly the one-way door the spec rejects under
   * "off-only editing". Nothing else in the map consults the climax any
   * more.
   *
   * null for a riser row (toggling one ON would mean INVENTING a riser,
   * which is the map spec's own named bad line) and for a mixed row (there
   * is no single stem the map could honestly put back). */
  source: { stem: Omit<Stem, 'slot'>; gain: number } | null
  /** The role the user confirmed for this row's stem in the auto-arrange
   * wizard, carried verbatim on the locked climax. null on an unguided map,
   * where nobody was asked. The SECOND link of the label chain -- see
   * ./coachMapRowLabels.ts, which owns the final string. */
  role: ArrangeRole | null
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

    // A riser-only row reports and never acts -- decided before anything
    // else, so no later branch can hand one a stem.
    if (channel.rifffs.length === 0 && channelRisers.length > 0) {
      return {
        channelId: channel.channelId,
        kind: 'riser',
        label: channelRisers[0].name,
        path: null,
        source: null,
        role: null,
        soundType: null,
        clips
      }
    }

    // Every distinct stem path this row's own clips name, with one real
    // occurrence kept per path so a single-stem row can place from it.
    const byPath = new Map<string, { stem: Stem; groupId: string }>()
    for (const rifff of channel.rifffs) {
      for (const stem of rifff.stems) {
        if (!byPath.has(stem.path)) byPath.set(stem.path, { stem, groupId: rifff.groupId })
      }
    }

    const lanePath = pathByChannel[channel.channelId] ?? null
    let source: CoachMapRow['source'] = null
    if (byPath.size === 1) {
      const [{ stem, groupId }] = [...byPath.values()]
      // Listed explicitly rather than spread-minus-slot, for the same
      // reason coachMapPlacement's stemFromClimax is: whatever ends up in
      // `source` is placed into a real Rifff, and `slot` is the one field
      // that must come from the new assembly rather than the old clip.
      source = {
        stem: {
          author: stem.author,
          name: stem.name,
          type: stem.type,
          path: stem.path,
          durationSec: stem.durationSec,
          barLength: stem.barLength
        },
        gain: state.vol[stemKey(groupId, stem.slot)] ?? 1
      }
    } else if (lanePath !== null) {
      // The guided fallback: this lane was laid out for one climax stem and
      // its clips no longer agree on one. The climax still knows.
      const climaxStem = state.coach?.lockedClimax?.stems.find((s) => s.path === lanePath)
      if (climaxStem !== undefined) {
        source = {
          stem: {
            author: climaxStem.author,
            name: climaxStem.name,
            type: climaxStem.type,
            path: climaxStem.path,
            durationSec: climaxStem.durationSec,
            barLength: climaxStem.barLength
          },
          gain: climaxStem.gain
        }
      }
    }

    const first = byPath.size === 1 ? [...byPath.values()][0].stem : channel.rifffs[0]?.stems[0]
    return {
      channelId: channel.channelId,
      kind: source === null ? 'other' : 'stem',
      label: first?.name ?? channel.rifffs[0]?.name ?? channel.channelId,
      path: source?.stem.path ?? lanePath,
      source,
      role: lanePath === null ? null : (roleByPath.get(lanePath) ?? null),
      soundType: source?.stem.type ?? first?.type ?? null,
      clips
    }
  })
}
