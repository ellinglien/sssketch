// src/renderer/src/audio/artistScanQueueEvent.ts
//
// DiscoverPanel's "analyse overnight" -> DiscoverLibraryScan: stems were
// just queued, so the scan shows the new queue size and stops resting.
// Fired on `window` with `{ size }`, the whole queue's new size.
export const ARTIST_SCAN_QUEUED_EVENT = 'discover-artist-scan-queued'

export function announceArtistScanQueued(size: number): void {
  window.dispatchEvent(new CustomEvent(ARTIST_SCAN_QUEUED_EVENT, { detail: { size } }))
}
