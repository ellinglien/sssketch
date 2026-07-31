import { useEffect, useRef } from 'react'
import type { Spectrogram } from '@shared/spectrogram'

/** Canvas pixel writes need actual RGB numbers, not a CSS `var(...)`
 * reference — this resolves one via a throwaway DOM read (setting the
 * canvas's own `color` and reading back getComputedStyle) rather than
 * hand-maintaining a second color table alongside tokens.css/typeColor.ts's
 * existing one (see typeColorVar's own doc comment on why that's avoided). */
function resolveCssColorToRgb(el: HTMLElement, cssColor: string): [number, number, number] {
  el.style.color = cssColor
  const computed = getComputedStyle(el).color
  const match = computed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  if (!match) return [255, 255, 255]
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

/**
 * Renders a Spectrogram (see @shared/spectrogram) as a single stem-colored
 * image: the stem's own identity color at increasing opacity for louder
 * energy, transparent (showing whatever's behind) for silence — same
 * "color spent only on things that carry information" convention as
 * PolarGlyph's own rings. Drawn at the spectrogram's own native
 * frame-count x freq-bin-count resolution into an off-DOM-sized canvas
 * buffer, then CSS-scaled to fill its container — far cheaper than a
 * per-pixel React render, and the browser's own bilinear scaling smooths
 * the small bin count into a reasonably clean image at typical display
 * sizes.
 */
export function SpectrogramCanvas({
  spectrogram,
  color,
  height
}: {
  spectrogram: Spectrogram
  /** A CSS color value — typically typeColorVar(stem.type)'s var(...)
   * reference. */
  color: string
  height: number
}): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const { numFrames, numFreqBins, data } = spectrogram
    if (numFrames === 0 || numFreqBins === 0) return

    canvas.width = numFrames
    canvas.height = numFreqBins
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const [r, g, b] = resolveCssColorToRgb(canvas, color)
    const imageData = ctx.createImageData(numFrames, numFreqBins)
    for (let t = 0; t < numFrames; t++) {
      for (let f = 0; f < numFreqBins; f++) {
        const intensity = data[t * numFreqBins + f]
        // freqBin 0 in `data` is the LOWEST frequency, but canvases draw
        // top-to-bottom — flipped here so low frequencies sit at the
        // bottom, matching a piano-roll/traditional spectrogram
        // orientation instead of upside down.
        const pixelRow = numFreqBins - 1 - f
        const idx = (pixelRow * numFrames + t) * 4
        imageData.data[idx] = r
        imageData.data[idx + 1] = g
        imageData.data[idx + 2] = b
        imageData.data[idx + 3] = Math.round(intensity * 255)
      }
    }
    ctx.putImageData(imageData, 0, 0)
  }, [spectrogram, color])

  return <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height }} />
}
