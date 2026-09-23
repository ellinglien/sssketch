import { useEffect, useState } from 'react'
import type { SssketchyAnimation } from '@shared/coach'
import climb1 from '../assets/sssketchy/climb1.png'
import climb2 from '../assets/sssketchy/climb2.png'
import climb3 from '../assets/sssketchy/climb3.png'
import climb4 from '../assets/sssketchy/climb4.png'
import hit1 from '../assets/sssketchy/hit1.png'
import hit2 from '../assets/sssketchy/hit2.png'
import hit3 from '../assets/sssketchy/hit3.png'
import hit4 from '../assets/sssketchy/hit4.png'
import idle from '../assets/sssketchy/idle.png'
import jump from '../assets/sssketchy/jump.png'
import walk1 from '../assets/sssketchy/walk1.png'
import walk2 from '../assets/sssketchy/walk2.png'
import walk3 from '../assets/sssketchy/walk3.png'
import walk4 from '../assets/sssketchy/walk4.png'

/** The committed frames, by animation. These are 80x80 PNGs already drawn in
 * the app's own greyscale palette, so this component never tints or colours
 * anything: colour in this app is spent only on things that carry audio
 * information, and a cartoon guy is not one of them. Vite resolves each
 * import to a URL string (src/renderer/src/env.d.ts already references
 * vite/client). */
const FRAMES: Record<SssketchyAnimation, readonly string[]> = {
  idle: [idle],
  walk: [walk1, walk2, walk3, walk4],
  jump: [jump],
  hit: [hit1, hit2, hit3, hit4],
  climb: [climb1, climb2, climb3, climb4]
}

/** Slow enough to read as a deliberate pixel-art flipbook rather than a
 * flicker, at the 4-frame cycle lengths this sprite sheet ships. */
const FRAME_MS = 140

/**
 * One animation's flipbook, and nothing else.
 *
 * Split out from SssketchySprite below purely so the caller can give it a
 * `key` of the animation name: a new animation is a REMOUNT, which restarts
 * the cycle at frame 0 for free. That matters (a walk must never pick up
 * mid-stride from wherever the previous cycle happened to be) and the
 * obvious alternative -- setFrameIndex(0) inside the interval effect -- is
 * a lint error in this repo (react-hooks/set-state-in-effect) as well as
 * a real cascading re-render. The <button> stays in the parent so that
 * remount never steals keyboard focus off the sprite.
 */
function SssketchyFrames({
  frames,
  size,
  bob
}: {
  frames: readonly string[]
  size: number
  bob: boolean
}): React.JSX.Element {
  const [frameIndex, setFrameIndex] = useState(0)

  useEffect(() => {
    if (frames.length < 2) return undefined
    const id = window.setInterval(
      () => setFrameIndex((index) => (index + 1) % frames.length),
      FRAME_MS
    )
    return () => window.clearInterval(id)
  }, [frames])

  return (
    <img
      src={frames[Math.min(frameIndex, frames.length - 1)]}
      width={size}
      height={size}
      alt=""
      style={{
        display: 'block',
        imageRendering: 'pixelated',
        animation: bob ? 'sssketchy-bob 1.6s steps(1, end) infinite' : undefined
      }}
    />
  )
}

/**
 * sssketchy himself: one 80x80 pixel-art frame, cycled.
 *
 * Presentational only -- it knows nothing about the flow. WHICH animation to
 * play is decided by coachAnimation (@shared/coach), which is pure and
 * tested; this just plays what it is handed.
 *
 * Rendered as a <button> because clicking the sprite is a real, distinct
 * gesture: it opens the full checklist, deliberately separate from the
 * bubble's own next/skip/do-it-for-me/stuck buttons "so the two never
 * compete" (spec).
 */
export function SssketchySprite({
  animation,
  size = 64,
  onClick,
  title
}: {
  animation: SssketchyAnimation
  size?: number
  onClick: () => void
  title: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      style={{
        border: 'none',
        borderRadius: 0,
        background: 'transparent',
        padding: 0,
        lineHeight: 0,
        cursor: 'pointer'
      }}
    >
      <SssketchyFrames
        key={animation}
        frames={FRAMES[animation]}
        size={size}
        bob={animation === 'idle'}
      />
    </button>
  )
}
