// src/shared/radioHearts.ts
//
// "fetch radio hearts": the crowd's hearted mixes on ell.ing/radio, brought
// home as kept riffs and stem favourites. This is the pure half -- what to
// import, given what the server says, what is already here and which stems
// have local audio. The fetch and every write live in
// src/main/radioHeartsImport.ts.
// ell.ing/radio docs/specs/2026-09-30-radio-controls-and-hearts-design.md §2.4.

/** The private endpoint. Bearer key only; without it, 401. */
export const RADIO_HEARTS_URL = 'https://ell.ing/radio/api/hearts.json'

/** One hearted combination, exactly as hearts.json sends it. `combo` is the
 * sorted stem ids joined by commas -- the server's own key, and the one we
 * remember imports by. bpm and loopBars are the FIRST heart's. */
export interface RadioHeartCombo {
  combo: string
  stems: string[]
  bpm: number
  loopBars: number
  /** Visitors who hearted it. */
  count: number
  /** Epoch ms of the first and latest heart. */
  first: number
  last: number
}

export interface PlannedHeartCombo<M> {
  heart: RadioHeartCombo
  /** One per stem that has local audio, in the combo's own order. */
  members: M[]
  /** Stems of this combo with no local audio -- skipped, and logged. */
  missing: string[]
  /** This combo's stems to star once it has actually SAVED: its stems with
   * local audio, minus those already starred. Always empty for a combo too
   * small to keep. Not de-duplicated against other combos -- a combo whose
   * save fails must not take a shared stem's star with it, and starring is
   * idempotent anyway (addStemFavourites). */
  stars: string[]
}

export interface HeartImportPlan<M> {
  /** New combos with at least 2 resolvable stems: each becomes a kept riff. */
  combosToKeep: PlannedHeartCombo<M>[]
  /** New combos left with fewer than 2 stems once missing audio is dropped.
   * Not saved and NOT recorded as imported, so a later fetch tries again
   * once the audio is here. */
  tooFew: PlannedHeartCombo<M>[]
  /** Combos a previous fetch already brought home -- not kept again, but
   * their heart count may have moved, so the caller refreshes the label. */
  alreadyImported: RadioHeartCombo[]
  /** Every combo-to-keep's stars, each once: the most a fetch could star
   * if every save succeeds. The caller stars per combo, after its save. */
  favouritesToAdd: string[]
  /** Every stem id without local audio, each once. */
  missingStems: string[]
}

/** A stem needs a partner to be a mix. */
const MIN_STEMS = 2

/** Plans one fetch.
 *
 * Stars come only from combos being kept now. A stem he has un-starred
 * since the last fetch stays un-starred unless the crowd hearts it in a NEW
 * combination that gets kept -- a fetch should never quietly undo his own
 * choice. A combo too small to keep stars nothing: it is not recorded, so
 * it comes round again, and starring its lone stem each time would undo an
 * un-star just as surely. Only stems with local audio are starred, the
 * same rule as saving.
 *
 * `resolve` is called at most once per stem id. */
export function planHeartImport<M>(
  hearts: readonly RadioHeartCombo[],
  alreadyImported: ReadonlySet<string>,
  favourites: ReadonlySet<string>,
  resolve: (stemCID: string) => M | null
): HeartImportPlan<M> {
  const resolved = new Map<string, M | null>()
  const resolveOnce = (stemCID: string): M | null => {
    if (!resolved.has(stemCID)) resolved.set(stemCID, resolve(stemCID))
    return resolved.get(stemCID) ?? null
  }

  const plan: HeartImportPlan<M> = {
    combosToKeep: [],
    tooFew: [],
    alreadyImported: [],
    favouritesToAdd: [],
    missingStems: []
  }
  const seen = new Set<string>()
  const toStar = new Set<string>()
  const missingAll = new Set<string>()

  for (const heart of hearts) {
    if (seen.has(heart.combo)) continue
    seen.add(heart.combo)
    if (alreadyImported.has(heart.combo)) {
      plan.alreadyImported.push(heart)
      continue
    }
    const members: M[] = []
    const missing: string[] = []
    const stars: string[] = []
    for (const stemCID of heart.stems) {
      const member = resolveOnce(stemCID)
      if (member === null) {
        missing.push(stemCID)
        missingAll.add(stemCID)
        continue
      }
      members.push(member)
      if (!favourites.has(stemCID)) stars.push(stemCID)
    }
    if (members.length >= MIN_STEMS) {
      plan.combosToKeep.push({ heart, members, missing, stars })
      for (const stemCID of stars) toStar.add(stemCID)
    } else {
      plan.tooFew.push({ heart, members, missing, stars: [] })
    }
  }

  plan.favouritesToAdd = [...toStar]
  plan.missingStems = [...missingAll]
  return plan
}

function isFinitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function isHeartRow(row: unknown): row is RadioHeartCombo {
  if (typeof row !== 'object' || row === null) return false
  const r = row as Record<string, unknown>
  return (
    typeof r.combo === 'string' &&
    r.combo !== '' &&
    Array.isArray(r.stems) &&
    r.stems.every((s) => typeof s === 'string' && s !== '') &&
    isFinitePositive(r.bpm) &&
    isFinitePositive(r.loopBars) &&
    isFinitePositive(r.count) &&
    typeof r.first === 'number' &&
    typeof r.last === 'number'
  )
}

/** hearts.json's body, or null if it is not one. A malformed row is dropped
 * on its own; it never costs the rest. */
export function parseHeartsResponse(body: unknown): RadioHeartCombo[] | null {
  if (typeof body !== 'object' || body === null) return null
  const hearts = (body as { hearts?: unknown }).hearts
  if (!Array.isArray(hearts)) return null
  return hearts.filter(isHeartRow).map((h) => ({
    combo: h.combo,
    stems: [...h.stems],
    bpm: h.bpm,
    loopBars: h.loopBars,
    count: h.count,
    first: h.first,
    last: h.last
  }))
}

/** "♥ 3 · misty kestrel". `friendly` is friendlyRiffName's whole string
 * ("misty kestrel 1a2b3c4d library"); only the pair is kept, the same trim
 * keep's own flash uses. */
export function heartRiffName(count: number, friendly: string): string {
  return `♥ ${count} · ${friendly.replace(/ \w{8} \w+$/, '')}`
}

export type RadioHeartsFailure =
  | 'no key'
  | 'key refused'
  | 'unreachable'
  | 'bad response'
  /** The configured LORE archive is away (drive unmounted, file gone):
   * nothing is imported rather than a half-import recorded as done. */
  | 'archive not mounted'
  /** Anything unexpected -- the last-resort catch. */
  | 'import failed'

export type RadioHeartsResult =
  | {
      ok: true
      /** New kept riffs. */
      kept: number
      /** Combos whose exact stem set was already kept (by hand, say). */
      alreadyKept: number
      /** Combos a previous fetch already brought home. */
      skipped: number
      /** Combos with fewer than 2 stems on this machine. */
      tooFew: number
      /** Stems newly starred. */
      favourited: number
      /** Hearted stems with no local audio. */
      missingStems: number
    }
  | { ok: false; reason: RadioHeartsFailure }

/** What the settings modal is told about the key -- never the key. */
export type RadioHeartsKeyStatus = 'none' | 'saved' | 'session'

/** What the button says for a moment afterwards. */
export function heartFetchLabel(result: RadioHeartsResult): string {
  if (!result.ok) {
    switch (result.reason) {
      case 'no key':
        return 'no key · see settings'
      case 'unreachable':
        return 'radio unreachable'
      default:
        return result.reason
    }
  }
  const parts: string[] = []
  if (result.kept > 0) parts.push(`♥ ${result.kept} kept`)
  if (result.favourited > 0) parts.push(`${result.favourited} starred`)
  return parts.length > 0 ? parts.join(' · ') : 'nothing new'
}
