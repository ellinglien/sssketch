// src/shared/waveformMaskSvg.ts
//
// One stem's waveform as a standalone SVG document -- white bars on
// transparent -- for use as a CSS mask-image. Discover's rows used to mount
// one <Waveform> per tile, twice per row (grey + colour), up to 32 tiles:
// thousands of <rect>s per row. A mask built from this string is drawn once
// per stem and repeated by CSS (mask-repeat), so a row is two plain divs.
//
// Same geometry as Waveform.tsx: linearWaveBars on a 128x100 viewBox,
// stretched with preserveAspectRatio="none", each bar's opacity
// 0.4 + brightness * 0.6 (Waveform's own formula at opacity=1, which is
// what Discover passes). A mask reads alpha, so the brightness treatment
// survives as fill-opacity and the layer's own background colour -- still a
// CSS variable -- shows through at exactly that strength.

import { linearWaveBars } from './visuals'

const r = (v: number): string => String(Math.round(v * 1000) / 1000)

export function waveformMaskSvg(peaks: number[], brightness: number[]): string {
  const rects = linearWaveBars(peaks)
    .map((bar, i) => {
      const o = 0.4 + (brightness[i] ?? 0) * 0.6
      return (
        `<rect x="${r(bar.x)}" y="${r(bar.y)}" width="${r(bar.width)}" ` +
        `height="${r(bar.height)}" fill-opacity="${r(o)}"/>`
      )
    })
    .join('')
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 100" ' +
    'preserveAspectRatio="none" shape-rendering="crispEdges" fill="#fff">' +
    rects +
    '</svg>'
  )
}

/** The same SVG as a `data:` URL, ready for `url(...)` in a style. */
export function waveformMaskDataUrl(peaks: number[], brightness: number[]): string {
  return `data:image/svg+xml,${encodeURIComponent(waveformMaskSvg(peaks, brightness))}`
}
