import { useEffect, useState } from 'react'
import { polarGlyph, polarPitchLine } from '@shared/visuals'
import { getBandEnergy } from '../audio/bandEnergyCache'
import { getPitchContour } from '../audio/pitchCache'
import type { Stem } from '@shared/types'
import { typeColorVar } from '../theme/typeColor'

// Bassline/melody range for the pitch-line overlay — narrower than
// pitchContour.ts's own 60-2000Hz default search range, since the visible
// radius span here only needs to usefully separate "low" from "high," not
// resolve every octave a lead melody might reach.
const PITCH_MIN_HZ = 40
const PITCH_MAX_HZ = 1000

interface StemGlyph {
  amp: number
  color: string
  /** Three concentric band rings (bass/mid/treble), same hue, decreasing
   * opacity outward — see the spectral-visualization mockup this
   * implements. Replaces the single flat-amplitude ring this component
   * used to draw per stem. */
  bandPaths: { d: string; opacity: number }[]
  /** Melody line traced from a guessed pitch (see pitchContour.ts) —
   * empty string when the stem has no confident pitch anywhere (fully
   * percussive/unpitched), in which case nothing is drawn. */
  pitchPath: string
}

export function PolarGlyph({
  stems,
  identityColor,
  size
}: {
  stems: Stem[]
  identityColor: string
  size: number
}): React.JSX.Element {
  const [glyphDataByPath, setGlyphDataByPath] = useState<
    Record<string, { bass: number[]; mid: number[]; treble: number[]; freqHz: number[] }>
  >({})
  // Paths whose decode rejected — kept distinct from "not in glyphDataByPath yet"
  // (still loading) so a failed stem doesn't look indistinguishable from one that
  // just hasn't resolved yet (not currently rendered differently, but available to
  // a future UI, and it's what keeps the rejection from going unhandled below).
  const [failedPaths, setFailedPaths] = useState<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    // Decode+analyze each stem independently so one bad file doesn't block the
    // others' rings from ever appearing — Promise.allSettled rather than
    // Promise.all, matching this component's own pre-existing convention.
    Promise.allSettled(
      stems.map((s) =>
        Promise.all([getBandEnergy(s.path), getPitchContour(s.path)]).then(
          ([band, pitch]) =>
            [
              s.path,
              {
                bass: Array.from(band.bass),
                mid: Array.from(band.mid),
                treble: Array.from(band.treble),
                freqHz: Array.from(pitch.freqHz)
              }
            ] as const
        )
      )
    ).then((results) => {
      if (cancelled) return
      const entries: Array<
        readonly [string, { bass: number[]; mid: number[]; treble: number[]; freqHz: number[] }]
      > = []
      const failed = new Set<string>()
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') {
          entries.push(r.value)
        } else {
          console.error(`PolarGlyph: failed to analyze ${stems[i].path}`, r.reason)
          failed.add(stems[i].path)
        }
      })
      setGlyphDataByPath(Object.fromEntries(entries))
      setFailedPaths(failed)
    })
    return () => {
      cancelled = true
    }
  }, [stems])

  const glyphs = stems
    .filter((stem) => !failedPaths.has(stem.path))
    .map((stem, i) => {
      const data = glyphDataByPath[stem.path]
      if (!data) return null
      const r0 = 17 + i * 2.5
      const amp = 25 // unity stand-in, volume wiring lands in Task 14
      const color = typeColorVar(stem.type)
      const bandPaths = [
        { arr: data.bass, r0, amp: amp * 0.5, opacity: 0.6 },
        { arr: data.mid, r0: r0 + amp * 0.35, amp: amp * 0.45, opacity: 0.4 },
        { arr: data.treble, r0: r0 + amp * 0.65, amp: amp * 0.35, opacity: 0.25 }
      ].map(({ arr, r0: bandR0, amp: bandAmp, opacity }) => ({
        d: polarGlyph(arr, bandR0, bandAmp, 16),
        opacity
      }))
      const pitchPath = polarPitchLine(data.freqHz, r0, amp, PITCH_MIN_HZ, PITCH_MAX_HZ)
      const glyph: StemGlyph = { amp, color, bandPaths, pitchPath }
      return glyph
    })
    .filter((g): g is StemGlyph => g !== null)
    .sort((a, b) => b.amp - a.amp)

  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      {glyphs.map((g, i) => (
        <g key={i}>
          {g.bandPaths.map((b, j) => (
            <path key={j} d={b.d} fill={g.color} opacity={b.opacity} shapeRendering="crispEdges" />
          ))}
          {g.pitchPath && (
            <>
              {/* Black halo underneath, same double-stroke technique
                  BeatPicker.tsx uses for its own melody contour — keeps the
                  thin line legible over any band fill it crosses. The bright
                  stroke uses the stem's OWN hue (not BeatPicker's fixed cyan)
                  since multiple stems' pitch lines can be layered here at
                  once — a shared cyan would make them indistinguishable. */}
              <path
                d={g.pitchPath}
                stroke="black"
                strokeOpacity={0.45}
                strokeWidth={1.4}
                strokeLinejoin="round"
                strokeLinecap="round"
                fill="none"
                vectorEffect="non-scaling-stroke"
              />
              <path
                d={g.pitchPath}
                stroke={g.color}
                strokeOpacity={0.95}
                strokeWidth={0.6}
                strokeLinejoin="round"
                strokeLinecap="round"
                fill="none"
                vectorEffect="non-scaling-stroke"
              />
            </>
          )}
        </g>
      ))}
      <circle
        cx={50}
        cy={50}
        r={9}
        fill={identityColor}
        opacity={0.85}
        shapeRendering="crispEdges"
      />
    </svg>
  )
}
