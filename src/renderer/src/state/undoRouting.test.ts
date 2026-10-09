import { describe, expect, it, vi } from 'vitest'
import { createUndoRouter, undoShortcutFor } from './undoRouting'

const key = (
  k: string,
  mods: { meta?: boolean; ctrl?: boolean; shift?: boolean } = {},
  target: { tagName: string; type?: string } | null = null
): Parameters<typeof undoShortcutFor>[0] => ({
  key: k,
  metaKey: mods.meta ?? false,
  ctrlKey: mods.ctrl ?? false,
  shiftKey: mods.shift ?? false,
  target
})

describe('undoShortcutFor', () => {
  it('reads cmd+z as undo and cmd+shift+z as redo', () => {
    expect(undoShortcutFor(key('z', { meta: true }))).toBe('undo')
    expect(undoShortcutFor(key('Z', { meta: true, shift: true }))).toBe('redo')
  })

  it('keeps the ctrl spellings, ctrl+y included', () => {
    expect(undoShortcutFor(key('z', { ctrl: true }))).toBe('undo')
    expect(undoShortcutFor(key('y', { ctrl: true }))).toBe('redo')
  })

  it('ignores a bare z and other keys', () => {
    expect(undoShortcutFor(key('z'))).toBeNull()
    expect(undoShortcutFor(key('x', { meta: true }))).toBeNull()
  })

  it('leaves a text field its own undo', () => {
    expect(undoShortcutFor(key('z', { meta: true }, { tagName: 'INPUT', type: 'text' }))).toBeNull()
    expect(undoShortcutFor(key('z', { meta: true }, { tagName: 'TEXTAREA' }))).toBeNull()
  })

  it('still undoes after a slider, checkbox or radio kept focus', () => {
    for (const type of ['range', 'checkbox', 'radio']) {
      expect(undoShortcutFor(key('z', { meta: true }, { tagName: 'INPUT', type }))).toBe('undo')
    }
  })
})

describe('createUndoRouter', () => {
  const owner = (): { undo: () => void; redo: () => void } => ({ undo: vi.fn(), redo: vi.fn() })

  it('has no owner by default, so the project keeps cmd+z', () => {
    expect(createUndoRouter().current()).toBeNull()
  })

  it('hands cmd+z to an open panel until it lets go', () => {
    const router = createUndoRouter()
    const discover = owner()
    const release = router.claim(discover)
    expect(router.current()).toBe(discover)
    release()
    expect(router.current()).toBeNull()
  })

  it('gives it to the newest claim, and back to the older one when that closes', () => {
    const router = createUndoRouter()
    const discover = owner()
    const cross = owner()
    const releaseDiscover = router.claim(discover)
    const releaseCross = router.claim(cross)
    expect(router.current()).toBe(cross)
    releaseCross()
    expect(router.current()).toBe(discover)
    releaseDiscover()
    expect(router.current()).toBeNull()
  })

  it('lets an older claim go without disturbing the newer one', () => {
    const router = createUndoRouter()
    const releaseDiscover = router.claim(owner())
    const cross = owner()
    router.claim(cross)
    releaseDiscover()
    expect(router.current()).toBe(cross)
  })

  it('treats a second release as a no-op', () => {
    const router = createUndoRouter()
    const discover = owner()
    router.claim(discover)
    const release = router.claim(owner())
    release()
    release()
    expect(router.current()).toBe(discover)
  })
})
