export type LibraryPreviewClickAction = 'select-and-play' | 'stop' | 'restart'

/** Plain-click behavior for an Import-view riff circle. Selection and
 * playback are independent: the selected+playing circle stops, while the
 * same selected circle starts again after it has been stopped. */
export function libraryPreviewClickAction(
  selectedRiffCID: string | null,
  playingRiffCID: string | null,
  clickedRiffCID: string
): LibraryPreviewClickAction {
  if (selectedRiffCID !== clickedRiffCID) return 'select-and-play'
  return playingRiffCID === clickedRiffCID ? 'stop' : 'restart'
}
