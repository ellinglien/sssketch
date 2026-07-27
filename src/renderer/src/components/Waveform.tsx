import { useEffect, useState } from 'react'
import { linearWave } from '@shared/visuals'
import { getPeaks } from '../audio/peakCache'

export function Waveform({
  path,
  color,
  opacity = 0.75
}: {
  path: string
  color: string
  opacity?: number
}): React.JSX.Element | null {
  const [peaks, setPeaks] = useState<number[] | null>(null)

  useEffect(() => {
    let cancelled = false
    getPeaks(path).then((p) => {
      if (!cancelled) setPeaks(p)
    })
    return () => {
      cancelled = true
    }
  }, [path])

  if (!peaks) return null

  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 0 128 100"
      preserveAspectRatio="none"
      style={{ position: 'absolute', inset: 0 }}
    >
      <path d={linearWave(peaks)} fill={color} opacity={opacity} />
    </svg>
  )
}
