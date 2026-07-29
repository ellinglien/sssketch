import { useEffect, useState } from 'react'
import { polarGlyph } from '@shared/visuals'
import { getPeaks } from '../audio/peakCache'
import type { Stem } from '@shared/types'
import { typeColorVar } from '../theme/typeColor'

export function PolarGlyph({
  stems,
  identityColor,
  size
}: {
  stems: Stem[]
  identityColor: string
  size: number
}): React.JSX.Element {
  const [peaksByPath, setPeaksByPath] = useState<Record<string, number[]>>({})
  // Paths whose decode rejected — kept distinct from "not in peaksByPath yet" (still
  // loading) so a failed stem doesn't look indistinguishable from one that just
  // hasn't resolved yet (not currently rendered differently, but available to a
  // future UI, and it's what keeps the rejection from going unhandled below).
  const [failedPaths, setFailedPaths] = useState<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    // Decode each stem independently so one bad file doesn't block the others'
    // rings from ever appearing — Promise.allSettled rather than Promise.all.
    Promise.allSettled(stems.map((s) => getPeaks(s.path).then((p) => [s.path, p] as const))).then(
      (results) => {
        if (cancelled) return
        const entries: Array<readonly [string, number[]]> = []
        const failed = new Set<string>()
        results.forEach((r, i) => {
          if (r.status === 'fulfilled') {
            entries.push(r.value)
          } else {
            console.error(`PolarGlyph: failed to decode peaks for ${stems[i].path}`, r.reason)
            failed.add(stems[i].path)
          }
        })
        setPeaksByPath(Object.fromEntries(entries))
        setFailedPaths(failed)
      }
    )
    return () => {
      cancelled = true
    }
  }, [stems])

  const rings = stems
    .filter((stem) => !failedPaths.has(stem.path))
    .map((stem, i) => {
      const peaks = peaksByPath[stem.path]
      if (!peaks) return null
      const r0 = 17 + i * 2.5
      const amp = 25 // unity stand-in, volume wiring lands in Task 14
      return { path: polarGlyph(peaks, r0, amp, 16), amp, color: typeColorVar(stem.type) }
    })
    .filter((r): r is { path: string; amp: number; color: string } => r !== null)
    .sort((a, b) => b.amp - a.amp)

  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      {rings.map((r, i) => (
        <path key={i} d={r.path} fill={r.color} opacity={0.55} shapeRendering="crispEdges" />
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
