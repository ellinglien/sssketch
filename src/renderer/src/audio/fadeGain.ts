export interface FadeConfig {
  fadeInBars: number
  fadeOutBars: number
  secPerBar: number
}

// A minimal shape (not Pick<AudioParam, ...>) so a plain call-recording fake in
// tests doesn't have to match AudioParam's real (chainable, AudioParam-returning)
// method signatures — this function never uses the return value anyway.
export interface RampableParam {
  setValueAtTime(value: number, time: number): unknown
  linearRampToValueAtTime(value: number, time: number): unknown
}

/**
 * Schedules fade-in/fade-out gain automation onto a per-segment GainNode, for
 * whichever segment sits at the very start/end of a clip's overall span — not
 * each internal tiling repetition, which would sound like tremolo rather than a
 * clean loop. Each fade is clamped to at most half the segment's own duration,
 * so an oversized fade value can never invert or overlap the other edge.
 */
export function applyFade(
  gainParam: RampableParam,
  when: number,
  duration: number,
  isFirstSegment: boolean,
  isLastSegment: boolean,
  // false when resuming mid-segment (a live reschedule) — a fresh fade-in ramp
  // would incorrectly re-fade audio that's already past its fade-in window.
  isFreshStart: boolean,
  config: FadeConfig
): void {
  if (isFirstSegment && isFreshStart && config.fadeInBars > 0) {
    const fadeInSec = Math.min(config.fadeInBars * config.secPerBar, duration / 2)
    gainParam.setValueAtTime(0, when)
    gainParam.linearRampToValueAtTime(1, when + fadeInSec)
  }
  if (isLastSegment && config.fadeOutBars > 0) {
    const fadeOutSec = Math.min(config.fadeOutBars * config.secPerBar, duration / 2)
    const endTime = when + duration
    gainParam.setValueAtTime(1, Math.max(when, endTime - fadeOutSec))
    gainParam.linearRampToValueAtTime(0, endTime)
  }
}
