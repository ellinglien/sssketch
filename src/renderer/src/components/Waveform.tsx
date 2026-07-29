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
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    getPeaks(path)
      .then((p) => {
        if (!cancelled) setPeaks(p)
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

  if (failed || !peaks) return null

  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 0 128 100"
      preserveAspectRatio="none"
      style={{ position: 'absolute', inset: 0 }}
    >
      <path d={linearWave(peaks)} fill={color} opacity={opacity} shapeRendering="crispEdges" />
    </svg>
  )
}
