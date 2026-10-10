export function nativePlayDispatchPlan(
  wasPlaying: boolean,
  nativeStart?: { fromPos: number; fadeIn?: boolean }
): { playNow: boolean; suppressNextPlayingEffect: boolean } {
  return {
    playNow: nativeStart !== undefined,
    suppressNextPlayingEffect: nativeStart !== undefined && !wasPlaying
  }
}
