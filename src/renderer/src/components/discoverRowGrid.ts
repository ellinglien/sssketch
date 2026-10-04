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
// The grid is the radio-off layout only, 15 tracks. While radio runs the rows use the radio
// layout (DiscoverSlotRow's, radio view plan Task 7), which has no grid: radio's hook and dig
// tracks (16-17) and fold's readout track (18) went with the grid's radio branches (Task 13).
export const DISCOVER_ROW_GRID_COLUMNS =
  '18px 18px 18px 18px 1fr 14px 110px 14px 1px 18px 18px 18px 18px 18px 18px'
export const DISCOVER_ROW_COLUMN_GAP = 8
export const DISCOVER_WAVEFORM_COLUMN = 5
export const DISCOVER_WAVEFORM_MIN_WIDTH = 140

// THE RADIO LAYOUT's row geometry (radio view design pass, Task 9). The waveform is the row's
// full width less these insets, and the one playhead overlay (DiscoverPanel) is inset by the same
// numbers: the row's 1px border plus 14px at the left (room for the holding bar) and 8px at the
// right. Change them here, never inline, or the playhead lands off the waveform.
export const RADIO_WAVEFORM_HEIGHT = 60
export const RADIO_ROW_INSET_LEFT = 15
export const RADIO_ROW_INSET_RIGHT = 9
