// src/shared/artistSelection.ts
//
// Combine artists (docs/superpowers/specs/2026-10-06-combine-artists-design.md): Discover and its
// radio play several artists at once, the picks shared evenly between them (artistShare.ts). This
// module is the selection and everything the panel derives from it.
//
// THE ONE GUARANTEE: a one-member selection is today's single artist, exactly. Every function here
// hands a one-member selection straight to the @shared/discoverArtist function it replaces and
// returns that function's answer untouched (artistSelection.test.ts pins it, input by input).
import {
  artistFieldLabel,
  artistMode,
  artistNotice,
  artistTurnoverIds,
  pickMatchesSelection,
  rollFilterForArtist,
  type ArtistMode,
  type ArtistRollFilter
} from './discoverArtist'

/** One chosen artist: an Endlesss username, or null for `me`. */
export type ArtistMember = string | null

/** The chosen artists, in the order they were added. Never empty (`[null]` is `me`), no
 * duplicates, at most MAX_COMBINED_ARTISTS. Build one with normalizeArtistSelection. */
export type ArtistSelection = readonly ArtistMember[]

/** Six at most, `me` included. discoverArtistStems.ts caches 8 artists per db, so a whole
 * selection's stem lists stay cached while it plays (discoverArtistStems.test.ts pins 8 >= 6). */
export const MAX_COMBINED_ARTISTS = 6

export const ME_SELECTION: ArtistSelection = Object.freeze([null])

/** `me`'s key wherever members key a map: no Endlesss username starts with a colon. */
export const ME_MEMBER_KEY = ':me'

export function memberKey(member: ArtistMember): string {
  return member === null ? ME_MEMBER_KEY : member
}

/** A selection from anything: today's single value (`string | null`, the shape the IPC and any
 * older caller still send), an array of them, or junk. Names are trimmed; a blank or the own
 * username is `me`; a repeat is dropped (the first kept); the list is capped; empty is `me`.
 *
 * Without an own username, `me` cannot be combined: in a combination `me` means the stems you
 * made, and there is no name to match them by. It is dropped from any selection that has someone
 * else in it (the picker greys its `+`). Alone, it is today's `me`. */
export function normalizeArtistSelection(value: unknown, ownUsername: string): ArtistSelection {
  const own = ownUsername.trim()
  const raw: unknown[] = Array.isArray(value) ? value : [value]
  const out: ArtistMember[] = []
  const seen = new Set<string>()
  for (const v of raw) {
    if (v !== null && typeof v !== 'string') continue
    const name = (v ?? '').trim()
    const member: ArtistMember = name === '' || (own !== '' && name === own) ? null : name
    const key = memberKey(member)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(member)
    if (out.length === MAX_COMBINED_ARTISTS) break
  }
  const kept = own === '' && out.length > 1 ? out.filter((m) => m !== null) : out
  return kept.length === 0 ? ME_SELECTION : kept
}

export function isCombined(selection: ArtistSelection): boolean {
  return selection.length > 1
}

export function selectionHasMe(selection: ArtistSelection): boolean {
  return selection.includes(null)
}

/** The named members (everyone but `me`), in selection order. */
export function selectionOthers(selection: ArtistSelection): string[] {
  return selection.filter((m): m is string => m !== null)
}

/** 'own' only for `[me]` (or the own name, which normalizes to it); a combination always has
 * someone else in it. */
export function selectionMode(selection: ArtistSelection, ownUsername: string): ArtistMode {
  if (selection.length === 1) return artistMode(selection[0], ownUsername)
  return 'other'
}

function memberName(member: ArtistMember, ownUsername: string): string {
  if (member !== null) return member
  const own = ownUsername.trim()
  return own !== '' ? own : 'me'
}

/** The header's and the strip's field: today's `artist: name` for one; `artist: a + b` for two;
 * `artist: a + 2 more` beyond. */
export function artistSelectionLabel(selection: ArtistSelection, ownUsername: string): string {
  if (selection.length === 1) return artistFieldLabel(selection[0], ownUsername)
  const first = memberName(selection[0], ownUsername)
  if (selection.length === 2) return `artist: ${first} + ${memberName(selection[1], ownUsername)}`
  return `artist: ${first} + ${selection.length - 1} more`
}

export const ARTIST_FIELD_TOOLTIP = 'whose stems discover plays'

/** The field's tooltip: today's for one; every name, in order, for a combination. */
export function artistSelectionTooltip(selection: ArtistSelection, ownUsername: string): string {
  if (selection.length === 1) return ARTIST_FIELD_TOOLTIP
  return `picks shared evenly: ${selection.map((m) => memberName(m, ownUsername)).join(', ')}`
}

/** `a's`, `a's and b's`, `a's, b's and c's`. */
function possessives(names: readonly string[]): string {
  const each = names.map((n) => `${n}'s`)
  return each.length <= 1 ? (each[0] ?? '') : `${each.slice(0, -1).join(', ')} and ${each.at(-1)}`
}

/** The quiet line under the field, or null when it shows nothing (`me`). One other artist is
 * today's artistNotice word for word; a combination names its others (never `me`). */
export function artistSelectionNotice(
  selection: ArtistSelection,
  ownUsername: string
): string | null {
  if (selectionMode(selection, ownUsername) === 'own') return null
  const others = selectionOthers(selection)
  if (others.length === 1) return artistNotice(others[0])
  return `listening to ${possessives(others)} stems. to use them in your own work, ask them first.`
}

/** What one member's turn sends main. One member: today's rollFilterForArtist, untouched (`me`
 * keeps the `my sounds` toggle). In a combination, `me` is the stems you made -- the `my sounds`
 * path whatever the toggle says -- so every turn is one person's; anyone else is their own
 * artist-mode filter. */
export function rollFilterForMember(
  member: ArtistMember,
  selection: ArtistSelection,
  ownUsername: string,
  onlyOwnStems: boolean
): ArtistRollFilter {
  const own = ownUsername.trim()
  if (selection.length === 1 || member !== null || own === '') {
    return rollFilterForArtist(member, ownUsername, onlyOwnStems)
  }
  return { onlyOwnStems: true, targetUser: own, artist: undefined }
}

/** The creator filter for the riff-neighbour lookups (nearby popover, adjacent, dig): today's
 * single creator (or none, for `me`) for one member; for a combination every member's name, `me`
 * as the own username. */
export function selectionCreatorFilter(
  selection: ArtistSelection,
  ownUsername: string
): string | readonly string[] | undefined {
  if (selection.length === 1) return rollFilterForArtist(selection[0], ownUsername, false).artist
  return selection.map((m) => memberName(m, ownUsername))
}

/** A neighbour-lookup candidate tagged for a combination, by its creator: the own user's stem is
 * `me`'s (untagged, as a `me` roll is); a named member's carries that name (pickedUnderArtist).
 * Anything else is returned untouched. Never used for a one-member selection: those tag with
 * tagPickedUnderArtist as today. */
export function tagByCreator<T extends { creatorUserName?: string | null }>(
  candidate: T,
  selection: ArtistSelection,
  ownUsername: string
): T | (T & { pickedUnderArtist: string }) {
  const creator = candidate.creatorUserName ?? null
  if (creator === null || creator === ownUsername.trim()) return candidate
  return selection.includes(creator) ? { ...candidate, pickedUnderArtist: creator } : candidate
}

/** Which member a landed pick counts for: its pickedUnderArtist when that is a member, `me` (null)
 * when it has none and `me` is a member; undefined when it belongs to no member (rolled under an
 * earlier selection). */
export function memberOfPick(
  candidate: { pickedUnderArtist?: string } | null | undefined,
  selection: ArtistSelection
): ArtistMember | undefined {
  if (!candidate) return undefined
  const tag = candidate.pickedUnderArtist
  if (tag === undefined) return selection.includes(null) ? null : undefined
  return selection.includes(tag) ? tag : undefined
}

/** Whether a pick belongs to the current selection (the turnover's "this row has turned over").
 * One member: today's pickMatchesSelection. */
export function pickMatchesArtistSelection(
  candidate: { pickedUnderArtist?: string } | null | undefined,
  selection: ArtistSelection
): boolean {
  if (selection.length === 1) return pickMatchesSelection(candidate, selection[0])
  return memberOfPick(candidate, selection) !== undefined
}

/** Rows a mid-radio selection change turns over. One member: today's artistTurnoverIds. A
 * combination: every row holding a stem by nobody in it (`me` as the own username). Adding an
 * artist therefore turns nothing over -- the share brings them in pick by pick -- and removing one
 * turns over that artist's rows. */
export function selectionTurnoverIds(
  slots: readonly { id: string; creator: string | null }[],
  selection: ArtistSelection,
  ownUsername: string
): Set<string> {
  if (selection.length === 1) return artistTurnoverIds(slots, selection[0], ownUsername)
  const creators = new Set(selection.map((m) => memberName(m, ownUsername)))
  return new Set(
    slots.filter((s) => s.creator !== null && !creators.has(s.creator)).map((s) => s.id)
  )
}

/** Identity for "picked under the same selection" (a sized build's spare still fits): the
 * selection and the `my sounds` toggle, which together decide every member's filter. */
export function artistSelectionKey(selection: ArtistSelection, onlyOwnStems: boolean): string {
  return JSON.stringify({ selection, onlyOwnStems })
}

export function selectionsEqual(a: ArtistSelection, b: ArtistSelection): boolean {
  return a.length === b.length && a.every((m, i) => m === b[i])
}

/** Whether the picker's `+` can add `member`: not at the cap, and `me` only with an own username
 * (normalizeArtistSelection). A member already in can always be removed. */
export function canAddMember(
  selection: ArtistSelection,
  member: ArtistMember,
  ownUsername: string
): boolean {
  if (selection.includes(member)) return true
  if (selection.length >= MAX_COMBINED_ARTISTS) return false
  return member !== null || ownUsername.trim() !== ''
}

/** The picker's two gestures. `only`: this artist alone (a click or Enter -- today's pick).
 * `toggle`: add or remove it, keeping the rest (`+`/`-`, Shift+click, Shift+Enter). Removing the
 * last member leaves `me`; an add the selection cannot take (canAddMember) changes nothing. */
export function applyArtistPick(
  selection: ArtistSelection,
  member: ArtistMember,
  how: 'only' | 'toggle',
  ownUsername: string
): ArtistSelection {
  if (how === 'only') return normalizeArtistSelection([member], ownUsername)
  if (selection.includes(member)) {
    return normalizeArtistSelection(
      selection.filter((m) => m !== member),
      ownUsername
    )
  }
  if (!canAddMember(selection, member, ownUsername)) return selection
  return normalizeArtistSelection([...selection, member], ownUsername)
}

/** The flash on a row whose turn's artist had nothing for it (radio only, like `no fave fits`):
 * the name cut to fit the row's word budget. */
export function artistSkipWord(member: ArtistMember, ownUsername: string): string {
  const name = memberName(member, ownUsername)
  const cut = name.length > 10 ? `${name.slice(0, 9)}…` : name
  return `no ${cut} fits`
}
