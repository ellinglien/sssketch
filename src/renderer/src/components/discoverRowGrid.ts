// The Discover row grid, shared by DiscoverSlotRow and DiscoverPanel's playhead overlay (moved verbatim from DiscoverPanel.tsx, radio view plan Task 4).

// This row's own waveform button's real pixel height -- the vertical-drag
// gain gesture below divides its own deltaY by this, same
// "deltaY / ROW_HEIGHT" scale StemWaveformRow.tsx's own handleVolumeStart
// uses for its analogous drag on the real timeline.
export const DISCOVER_WAVEFORM_HEIGHT = 40

// THE ROW GRID, shared by every DiscoverSlotRow AND by the one-playhead
// overlay DiscoverPanel draws above the row list (2026-09-30). The overlay
// is its own grid with these same tracks, gap and (zero) horizontal
// padding, so its waveform column is the rows' waveform column: every
// track but the 1fr waveform is a fixed pixel width, and the waveform
// cell's min-width is the same in both, so the leftover width the 1fr
// track gets is identical. Change the template HERE, never inline -- see
// the long comment where the row applies it for why each track is what
// it is.
// 2026-10-03, radio fold v2: a track after 👎, 44px, for fold mode's readout (`3½ / 16`), only
// while the mode is on (discoverRowGridColumns), so it takes no width otherwise. It is the last
// track, so every other track keeps its number either way: 16 when it was added, 18 since radio's
// role tracks (16-17, below) came before it.
export const DISCOVER_ROW_GRID_COLUMNS =
  '18px 18px 18px 18px 1fr 14px 110px 14px 1px 18px 18px 18px 18px 18px 18px'
export const DISCOVER_FOLD_READOUT_TRACK = '44px'
// 2026-10-03, radio anointed stems (planning decision 7): while radio runs, tracks 16 and 17 for
// the row's hook and dig toggles (RadioRoleButtons), after 👎; fold's readout moves to 18, still
// last. The radio-view spec (c3ff2dd) later moves the two buttons into its radio-role slot.
export const DISCOVER_RADIO_ROLE_TRACKS = '18px 18px'
/** The row template, with radio's role tracks while radio runs and fold mode's readout track
 * while the mode is on (only ever with radio on): the rows and the playhead overlay both take it
 * from here, with the same flags, so their columns stay one grid. */
export function discoverRowGridColumns(o: { radio: boolean; fold: boolean }): string {
  return [
    DISCOVER_ROW_GRID_COLUMNS,
    ...(o.radio || o.fold ? [DISCOVER_RADIO_ROLE_TRACKS] : []),
    ...(o.fold ? [DISCOVER_FOLD_READOUT_TRACK] : [])
  ].join(' ')
}
export const DISCOVER_ROW_COLUMN_GAP = 8
export const DISCOVER_WAVEFORM_COLUMN = 5
export const DISCOVER_WAVEFORM_MIN_WIDTH = 140
