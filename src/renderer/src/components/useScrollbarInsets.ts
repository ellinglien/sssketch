import { useLayoutEffect, useState, type RefObject } from 'react'

export interface ScrollbarInsets {
  /** Width of the vertical scrollbar, 0 when there is none. */
  right: number
  /** Height of the horizontal scrollbar, 0 when there is none. */
  bottom: number
}

/**
 * How much of a scroll container its own scrollbars take up. The app styles
 * its scrollbars (global.css), so they're classic, space-taking bars rather
 * than macOS overlay ones, and they come and go as the content grows.
 *
 * Arrange's mixer rail needs this: the rows' controls stick to the
 * scrollport's right edge, which is just left of the vertical scrollbar, so
 * the rail drawn behind them must sit there too, not over the scrollbar.
 * Watches the container and its content, since either can make a scrollbar
 * appear.
 */
export function useScrollbarInsets(
  ref: RefObject<HTMLElement | null>,
  enabled: boolean
): ScrollbarInsets {
  const [insets, setInsets] = useState<ScrollbarInsets>({ right: 0, bottom: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!enabled || !el) return
    const measure = (): void => {
      const right = Math.max(0, el.offsetWidth - el.clientWidth)
      const bottom = Math.max(0, el.offsetHeight - el.clientHeight)
      setInsets((prev) =>
        prev.right === right && prev.bottom === bottom ? prev : { right, bottom }
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    if (el.firstElementChild) observer.observe(el.firstElementChild)
    return () => observer.disconnect()
  }, [ref, enabled])
  return insets
}
