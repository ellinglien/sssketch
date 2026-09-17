import { useEffect, useState } from 'react'
import { linearWaveBars, linearPitchLine } from '@shared/visuals'
import { getPeaks, getBrightness, peekPeaks, peekBrightness } from '../audio/peakCache'
import { getPitchContour } from '../audio/pitchCache'

// Same bassline/melody range PolarGlyph.tsx uses for its own pitch-line
// overlay — kept identical so a stem's melody reads at a consistent
// "height" whether you're looking at its clip waveform or its glyph ring.
const PITCH_MIN_HZ = 40
const PITCH_MAX_HZ = 1000

export function Waveform({
  path,
  color,
  opacity = 0.75,
  showPitchLine = false
}: {
  path: string
  color: string
  opacity?: number
  /** Draws the guessed-pitch melody line on top of this instance.
   * StemWaveformRow.tsx renders two stacked Waveform layers (a dim
   * always-visible one, a full-color one on top) per tile — only the
   * full-color layer should set this, otherwise the line gets drawn twice
   * on top of itself for no visual benefit. Default false. */
  showPitchLine?: boolean
}): React.JSX.Element | null {
  // Lazy initializers (not plain `null`) -- direct report, 2026-09-17
  // ("i still notice some blinking when loading"): a brand new <Waveform>
  // instance (e.g. one more tile added when Discover's shared loop-length
  // reference grows as another slot resolves) used to always render null
  // for its own first frame, even when this exact path had already been
  // decoded by a sibling tile moments earlier -- getPeaks/getBrightness
  // only ever resolve on a later microtask, cache hit or not. Seeding
  // from peekPeaks/peekBrightness's synchronous cache peek (peakCache.ts)
  // skips that gap whenever the data's already there; the effect below
  // still runs and (redundantly, harmlessly) confirms/updates it either
  // way, and still does the real async work on an actual cache miss.
  const [peaks, setPeaks] = useState<number[] | null>(() => peekPeaks(path))
  const [brightness, setBrightness] = useState<number[] | null>(() => peekBrightness(path))
  const [freqHz, setFreqHz] = useState<number[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([getPeaks(path), getBrightness(path)])
      .then(([p, b]) => {
        if (!cancelled) {
          setPeaks(p)
          setBrightness(b)
        }
      })
      .catch((err) => {
        if (cancelled) return
        console.error(`Waveform: failed to decode peaks for ${path}`, err)
        setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [path])

  useEffect(() => {
    if (!showPitchLine) return
    let cancelled = false
    getPitchContour(path)
      .then((pitch) => {
        if (!cancelled) setFreqHz(Array.from(pitch.freqHz))
      })
      .catch((err) => {
        // Pitch is a purely decorative overlay here — a failed analysis just
        // means no melody line, not a broken waveform, so this doesn't set
        // `failed` the way the peaks/brightness decode above does.
        if (!cancelled) console.error(`Waveform: failed to analyze pitch for ${path}`, err)
      })
    return () => {
      cancelled = true
    }
  }, [path, showPitchLine])

  if (failed || !peaks || !brightness) return null

  const bars = linearWaveBars(peaks)
  const pitchPath = freqHz ? linearPitchLine(freqHz, PITCH_MIN_HZ, PITCH_MAX_HZ) : ''

  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 0 128 100"
      preserveAspectRatio="none"
      style={{ position: 'absolute', inset: 0 }}
    >
      {bars.map((bar, i) => (
        <rect
          key={i}
          x={bar.x}
          y={bar.y}
          width={bar.width}
          height={bar.height}
          fill={color}
          opacity={opacity * (0.4 + (brightness[i] ?? 0) * 0.6)}
          shapeRendering="crispEdges"
        />
      ))}
      {pitchPath && (
        <>
          {/* Same black-halo/cyan double-stroke BeatPicker.tsx already draws
              for its own melody contour — a fixed accent here (not the
              stem's hue, unlike PolarGlyph's version) since only one stem's
              waveform is ever visible in this box at a time, so there's no
              ambiguity to resolve by color. */}
          <path
            d={pitchPath}
            stroke="black"
            strokeOpacity={0.45}
            strokeWidth={2.2}
            strokeLinejoin="round"
            strokeLinecap="round"
            fill="none"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={pitchPath}
            stroke="#5ec8ff"
            strokeOpacity={0.9}
            strokeWidth={0.9}
            strokeLinejoin="round"
            strokeLinecap="round"
            fill="none"
            vectorEffect="non-scaling-stroke"
          />
        </>
      )}
    </svg>
  )
}
