import { memo, useEffect, useState } from 'react'
import { getWaveformMask, peekWaveformMask } from '../audio/waveformMaskCache'

// One element standing in for a whole row of tiled <Waveform>s (Elling,
// 2026-09-30: "i think it's slowing the app down having so many of them on
// there"). The stem's waveform is painted once, as a CSS mask
// (waveformMaskCache.ts), and repeated across the element every
// `tileWidthPct` percent of its width; the element's background is the
// colour, so a CSS variable (theme, stemColorVar) still works and a parent
// clipPath still clips it. The last repeat is cut off by the element's own
// edge, exactly as the overhanging last tile used to be.
//
// Renders nothing until the peaks are decoded, like <Waveform> does.
export const RepeatedWaveform = memo(function RepeatedWaveform({
  path,
  color,
  tileWidthPct,
  maskPositionPct = 0
}: {
  path: string
  color: string
  tileWidthPct: number
  maskPositionPct?: number
}): React.JSX.Element | null {
  const [loaded, setLoaded] = useState<{ path: string; url: string } | null>(null)
  // Warm peaks resolve synchronously, so a remount or a new stem never
  // blanks for a frame; the effect only matters on a real cache miss.
  const url = loaded?.path === path ? loaded.url : peekWaveformMask(path)

  useEffect(() => {
    if (url) return
    let cancelled = false
    getWaveformMask(path)
      .then((u) => {
        if (!cancelled) setLoaded({ path, url: u })
      })
      .catch((err) => {
        if (!cancelled) console.error(`RepeatedWaveform: failed to decode peaks for ${path}`, err)
      })
    return () => {
      cancelled = true
    }
  }, [path, url])

  if (!url) return null

  const mask = `url("${url}")`
  // CSS percentage mask-position is relative to the difference between the
  // container and image widths, so it cannot express a musical source
  // offset. Move and widen the masked element itself instead: both lengths
  // are percentages of the host, and the adjusted mask size preserves the
  // requested tile width in host pixels.
  const offset = Math.min(0, maskPositionPct)
  const widthPct = 100 - offset + tileWidthPct
  const size = `${(tileWidthPct / widthPct) * 100}% 100%`
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: `${offset}%`,
        width: `${widthPct}%`,
        background: color,
        maskImage: mask,
        maskRepeat: 'repeat-x',
        maskSize: size,
        maskPosition: '0 0',
        WebkitMaskImage: mask,
        WebkitMaskRepeat: 'repeat-x',
        WebkitMaskSize: size,
        WebkitMaskPosition: '0 0'
      }}
    />
  )
})
