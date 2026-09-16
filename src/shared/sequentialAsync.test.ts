import { describe, expect, it } from 'vitest'
import { createSequentialRunner } from './sequentialAsync'

describe('createSequentialRunner', () => {
  it('runs a single task and resolves with its result', async () => {
    const runner = createSequentialRunner()
    const result = await runner.run(async () => 42)
    expect(result).toBe(42)
  })

  it('does not start a second task until the first has settled', async () => {
    const runner = createSequentialRunner()
    const order: string[] = []
    let resolveFirst: (() => void) | undefined
    const first = runner.run(async () => {
      order.push('first-start')
      await new Promise<void>((resolve) => {
        resolveFirst = resolve
      })
      order.push('first-end')
    })
    const second = runner.run(async () => {
      order.push('second-start')
    })
    // The first task is blocked on its own manually-controlled promise --
    // the second task must not have started yet, however many microtasks
    // are given a chance to run.
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(order).toEqual(['first-start'])
    resolveFirst?.()
    await first
    await second
    expect(order).toEqual(['first-start', 'first-end', 'second-start'])
  })

  it('a rejecting task does not break the queue for later tasks', async () => {
    const runner = createSequentialRunner()
    await expect(
      runner.run(async () => {
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')
    const result = await runner.run(async () => 'still works')
    expect(result).toBe('still works')
  })

  it("each call's own returned promise reflects only that call's own result", async () => {
    const runner = createSequentialRunner()
    const a = runner.run(async () => 'a')
    const b = runner.run(async () => 'b')
    expect(await a).toBe('a')
    expect(await b).toBe('b')
  })
})
