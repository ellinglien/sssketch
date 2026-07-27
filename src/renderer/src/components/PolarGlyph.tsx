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

  useEffect(() => {
    let cancelled = false
    Promise.all(stems.map((s) => getPeaks(s.path).then((p) => [s.path, p] as const))).then(
      (entries) => {
        if (!cancelled) setPeaksByPath(Object.fromEntries(entries))
      }
    )
    return () => {
      cancelled = true
    }
  }, [stems])

  const rings = stems
    .map((stem, i) => {
      const peaks = peaksByPath[stem.path]
      if (!peaks) return null
      const r0 = 17 + i * 2.5
      const amp = 10 + 15 * Math.min(1, 1 + 0.1) // volume wiring lands in Task 14; assume unity for now
      return { path: polarGlyph(peaks, r0, amp, 16), amp, color: typeColorVar(stem.type) }
    })
    .filter((r): r is { path: string; amp: number; color: string } => r !== null)
    .sort((a, b) => b.amp - a.amp)

  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      {rings.map((r, i) => (
        <path key={i} d={r.path} fill={r.color} opacity={0.55} />
      ))}
      <circle cx={50} cy={50} r={9} fill={identityColor} opacity={0.85} />
    </svg>
  )
}
