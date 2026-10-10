import { describe, expect, it } from 'vitest'
import { createPublishGate } from './publishGate'

describe('createPublishGate (one EEEDIT publish at a time)', () => {
  it('settled() waits for the publish in flight, even one that fails', async () => {
    const gate = createPublishGate()
    let finish: () => void = () => {}
    const order: string[] = []
    void gate
      .track(() => new Promise<void>((resolve) => (finish = resolve)))
      .then(() => order.push('publish'))
    const waiting = gate.settled().then(() => order.push('save'))
    await Promise.resolve()
    expect(order).toEqual([])
    finish()
    await waiting
    expect(order).toEqual(['publish', 'save'])
    await expect(gate.track(() => Promise.reject(new Error('no')))).rejects.toThrow('no')
    await expect(gate.settled()).resolves.toBeUndefined()
  })

  it('settled() also waits for a publish started while it waited', async () => {
    const gate = createPublishGate()
    let finishFirst: () => void = () => {}
    let finishSecond: () => void = () => {}
    void gate.track(() => new Promise<void>((resolve) => (finishFirst = resolve)))
    let done = false
    const waiting = gate.settled().then(() => (done = true))
    finishFirst()
    void gate.track(() => new Promise<void>((resolve) => (finishSecond = resolve)))
    await Promise.resolve()
    await Promise.resolve()
    expect(done).toBe(false)
    finishSecond()
    await waiting
    expect(done).toBe(true)
  })
})
