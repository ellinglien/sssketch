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

// An always-on, user-invisible safety net — independent of whatever
// fadeInBars/fadeOutBars the user has (or hasn't) set. Starting or stopping
// a sample stream at a non-zero-crossing sample produces an audible click
// at that exact edge; 3ms is far too short to read as an intentional fade
// (nothing like the musical fades fadeInBars/fadeOutBars produce), just
// enough to smooth the discontinuity. Kept in lockstep with FadeGain.cpp's
// identical kMicroFadeSec — see that file's own doc comment.
const MICRO_FADE_SEC = 0.003

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
  if (isFirstSegment && isFreshStart) {
    const halfDuration = duration / 2
    const fadeInSec = Math.max(
      Math.min(config.fadeInBars * config.secPerBar, halfDuration),
      Math.min(MICRO_FADE_SEC, halfDuration)
    )
    if (fadeInSec > 0) {
      gainParam.setValueAtTime(0, when)
      gainParam.linearRampToValueAtTime(1, when + fadeInSec)
    }
  }
  if (isLastSegment) {
    const halfDuration = duration / 2
    const fadeOutSec = Math.max(
      Math.min(config.fadeOutBars * config.secPerBar, halfDuration),
      Math.min(MICRO_FADE_SEC, halfDuration)
    )
    if (fadeOutSec > 0) {
      const endTime = when + duration
      gainParam.setValueAtTime(1, Math.max(when, endTime - fadeOutSec))
      gainParam.linearRampToValueAtTime(0, endTime)
    }
  }
}
