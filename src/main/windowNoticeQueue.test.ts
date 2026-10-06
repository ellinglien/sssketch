import { describe, expect, it } from 'vitest'
import { createWindowNoticeQueue } from './windowNoticeQueue'

interface FakeWindow {
  name: string
}

describe('windowNoticeQueue', () => {
  it('holds a notice posted before any window is ready, and shows it on the window once it is', () => {
    const queue = createWindowNoticeQueue<FakeWindow>()
    const shown: string[] = []
    queue.post('a', (win) => shown.push(`a on ${win.name}`))
    expect(shown).toEqual([])
    queue.windowReady({ name: 'main' })
    expect(shown).toEqual(['a on main'])
    // Shown once: a second ready window does not show it again.
    queue.windowReady({ name: 'second' })
    expect(shown).toEqual(['a on main'])
  })

  it('shows a notice at once on a ready window', () => {
    const queue = createWindowNoticeQueue<FakeWindow>()
    const shown: string[] = []
    queue.windowReady({ name: 'main' })
    queue.post('a', (win) => shown.push(`a on ${win.name}`))
    expect(shown).toEqual(['a on main'])
  })

  it('a notice already waiting is not queued twice under the same key', () => {
    const queue = createWindowNoticeQueue<FakeWindow>()
    const shown: string[] = []
    queue.post('a', () => shown.push('a'))
    queue.post('b', () => shown.push('b'))
    queue.post('a', () => shown.push('a again'))
    queue.windowReady({ name: 'main' })
    expect(shown).toEqual(['a', 'b'])
  })

  it('after the window is gone, notices wait for the next one', () => {
    const queue = createWindowNoticeQueue<FakeWindow>()
    const shown: string[] = []
    const main = { name: 'main' }
    queue.windowReady(main)
    queue.windowGone(main)
    queue.post('a', (win) => shown.push(`a on ${win.name}`))
    expect(shown).toEqual([])
    queue.windowReady({ name: 'reopened' })
    expect(shown).toEqual(['a on reopened'])
  })

  it('an older window going away does not unset a newer ready one', () => {
    const queue = createWindowNoticeQueue<FakeWindow>()
    const shown: string[] = []
    const old = { name: 'old' }
    queue.windowReady(old)
    queue.windowReady({ name: 'new' })
    queue.windowGone(old)
    queue.post('a', (win) => shown.push(`a on ${win.name}`))
    expect(shown).toEqual(['a on new'])
  })
})
