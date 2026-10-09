import { describe, expect, it, vi } from 'vitest'
import {
  afterSaveBeforeQuit,
  awaitSaveBeforeQuit,
  beforeQuitPlan,
  type BeforeQuitState
} from './saveBeforeQuit'
import {
  initialRecoveryFileState,
  recoveryFileStep,
  type RecoveryFileEvent
} from './recoveryFileTracker'

describe('awaitSaveBeforeQuit', () => {
  it('reports the renderer result and unsubscribes', async () => {
    let complete: ((requestId: string, success: boolean) => void) | undefined
    const unsubscribe = vi.fn()
    const result = awaitSaveBeforeQuit(
      'request-1',
      (requestId) => complete?.(requestId, true),
      (callback) => {
        complete = callback
        return unsubscribe
      },
      1000
    )
    await expect(result).resolves.toBe('saved')
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('does not turn a failed save into permission to quit', async () => {
    let complete: ((requestId: string, success: boolean) => void) | undefined
    const result = awaitSaveBeforeQuit(
      'request-2',
      (requestId) => complete?.(requestId, false),
      (callback) => {
        complete = callback
        return () => {}
      },
      1000
    )
    await expect(result).resolves.toBe('failed')
  })

  it('reports timeout rather than treating a hung save as complete', async () => {
    vi.useFakeTimers()
    try {
      const unsubscribe = vi.fn()
      const result = awaitSaveBeforeQuit(
        'request-3',
        () => {},
        () => unsubscribe,
        5000
      )
      await vi.advanceTimersByTimeAsync(5000)
      await expect(result).resolves.toBe('timeout')
      expect(unsubscribe).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('ignores a late reply from an earlier timed-out request', async () => {
    let complete: ((requestId: string, success: boolean) => void) | undefined
    const result = awaitSaveBeforeQuit(
      'new-request',
      () => {
        complete?.('old-request', true)
        complete?.('new-request', false)
      },
      (callback) => {
        complete = callback
        return () => {}
      },
      1000
    )
    await expect(result).resolves.toBe('failed')
  })

  it('reports unreachable when the request cannot be sent at all', async () => {
    const unsubscribe = vi.fn()
    const result = awaitSaveBeforeQuit(
      'request-5',
      () => {
        throw new Error('render frame was disposed')
      },
      () => unsubscribe,
      1000
    )
    await expect(result).resolves.toBe('unreachable')
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})

describe('afterSaveBeforeQuit', () => {
  it('quits after a save that landed, quietly', () => {
    expect(afterSaveBeforeQuit('saved')).toEqual({ action: 'quit', notice: null })
  })

  it('stays open after a failed save, which the renderer has already explained', () => {
    expect(afterSaveBeforeQuit('failed')).toEqual({ action: 'stay', notice: null })
  })

  it('stays open on a timeout, and says so', () => {
    const next = afterSaveBeforeQuit('timeout')
    expect(next.action).toBe('stay')
    expect(next.notice?.detail).toContain('stayed open')
  })

  it('with no renderer to ask, quits keeping the recovery file, as before the save prompt waited', () => {
    const next = afterSaveBeforeQuit('unreachable')
    expect(next.action).toBe('quit')
    expect(next.notice?.detail).toContain('recovery')
  })

  it("never recommends Don't Save, which deletes the recovery file", () => {
    for (const result of ['saved', 'failed', 'timeout', 'unreachable'] as const) {
      expect(JSON.stringify(afterSaveBeforeQuit(result).notice)).not.toContain("Don't Save")
    }
  })
})

describe('beforeQuitPlan', () => {
  const recoveryAfter = (events: RecoveryFileEvent[]): BeforeQuitState['recovery'] =>
    events.reduce(recoveryFileStep, initialRecoveryFileState)

  it('asks before quitting a live window with unsaved work', () => {
    const plan = beforeQuitPlan({
      rendererDirty: true,
      windowLive: true,
      recovery: recoveryAfter(['window-created', 'autosave-written']),
      quittingAfterSavePrompt: false
    })
    expect(plan).toEqual({ kind: 'prompt' })
  })

  it('edit (autosave written), close the window, quit: no prompt, the recovery file is kept', () => {
    // index.ts resets rendererDirty when the window closes; the recovery file
    // is then the only copy of those edits, and nothing may offer Don't Save.
    const recovery = recoveryAfter(['window-created', 'saved', 'autosave-written'])
    expect(
      beforeQuitPlan({
        rendererDirty: false,
        windowLive: false,
        recovery,
        quittingAfterSavePrompt: false
      })
    ).toEqual({ kind: 'quit', clearRecovery: false })
  })

  it('a dirty flag left over from a closed window still neither asks nor clears', () => {
    const recovery = recoveryAfter(['window-created', 'saved', 'autosave-written'])
    expect(
      beforeQuitPlan({
        rendererDirty: true,
        windowLive: false,
        recovery,
        quittingAfterSavePrompt: false
      })
    ).toEqual({ kind: 'quit', clearRecovery: false })
  })

  it('a closed window whose last save followed its last write: the clean quit clears', () => {
    const recovery = recoveryAfter(['window-created', 'autosave-written', 'saved'])
    expect(
      beforeQuitPlan({
        rendererDirty: false,
        windowLive: false,
        recovery,
        quittingAfterSavePrompt: false
      })
    ).toEqual({ kind: 'quit', clearRecovery: true })
  })

  it('the quit re-issued after an unreachable save keeps the recovery file', () => {
    const recovery = recoveryAfter(['window-created', 'saved', 'autosave-written'])
    expect(afterSaveBeforeQuit('unreachable').action).toBe('quit')
    // index.ts sets quittingAfterSavePrompt and clears the dirty flag before re-quitting.
    expect(
      beforeQuitPlan({
        rendererDirty: false,
        windowLive: true,
        recovery,
        quittingAfterSavePrompt: true
      })
    ).toEqual({ kind: 'quit', clearRecovery: false })
  })
})
