import type { LoreJam, LoreResolvedRiff, RiffFilters, RiffPage } from '@shared/loreLibrary'

/** Satisfied by both the LORE warehouse and "my private jams" -- anything
 * that's browsed jam-first, riffs-second. */
export interface JamRiffSource {
  label: string
  available(): Promise<boolean>
  listJams(filterText: string): Promise<LoreJam[]>
  listRiffs(jamId: string, filters: RiffFilters): Promise<RiffPage>
  resolveRiff(jamId: string, riffCID: string): Promise<LoreResolvedRiff | null>
}

/** Satisfied by "my shared feed" -- a flat, already-paginated list with no
 * jam-selection step. Deliberately NOT the same shape as JamRiffSource
 * (see the design spec's Architecture section on why forcing a fake single
 * "jam" onto the feed would be worse than admitting there are two natural
 * shapes here). */
export interface FeedRiffSource {
  label: string
  available(): Promise<boolean>
  listRiffs(userName: string, offset: number, count: number): Promise<RiffPage>
  resolveRiff(riffCID: string): Promise<LoreResolvedRiff | null>
}

export const loreRiffSource: JamRiffSource = {
  label: 'lore library',
  available: () => window.rifffApi.loreWarehouseAvailable(),
  listJams: (filterText) => window.rifffApi.loreListJams(filterText),
  listRiffs: (jamId, filters) => window.rifffApi.loreListRiffs(jamId, filters),
  resolveRiff: (_jamId, riffCID) => window.rifffApi.loreResolveRiff(riffCID)
}

export const endlesssJamRiffSource: JamRiffSource = {
  label: 'my private jams',
  available: async () => (await window.rifffApi.endlesssAuthStatus()).loggedIn,
  listJams: () => window.rifffApi.endlesssListJams(),
  listRiffs: (jamId, filters) => window.rifffApi.endlesssListRiffs(jamId, filters),
  resolveRiff: (jamId, riffCID) => window.rifffApi.endlesssResolveRiff(jamId, riffCID)
}

export const endlesssFeedRiffSource: FeedRiffSource = {
  label: 'my shared feed',
  // Always "available" -- unlike private jams, the feed works logged out
  // too (see EndlesssLoginPanel's username-only quick path). The browser
  // component itself handles the "no username entered yet" empty state.
  available: async () => true,
  listRiffs: (userName, offset, count) =>
    window.rifffApi.endlesssListSharedFeed(userName, offset, count),
  resolveRiff: (riffCID) => window.rifffApi.endlesssResolveSharedFeedRiff(riffCID)
}
