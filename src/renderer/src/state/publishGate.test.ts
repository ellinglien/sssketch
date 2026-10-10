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

  it('settled() also waits for a publish queued while it waited', async () => {
    const gate = createPublishGate()
    let finishFirst: () => void = () => {}
    let finishSecond: () => void = () => {}
    const firstDone = new Promise<void>((resolve) => (finishFirst = resolve))
    const secondDone = new Promise<void>((resolve) => (finishSecond = resolve))
    void gate.track(() => firstDone)
    let done = false
    const waiting = gate.settled().then(() => (done = true))
    finishFirst()
    void gate.track(() => secondDone)
    for (let i = 0; i < 5; i++) await Promise.resolve()
    expect(done).toBe(false)
    finishSecond()
    await waiting
    expect(done).toBe(true)
  })
})

describe('createPublishGate is a lock', () => {
  it('runs two publishes one after the other, even when both ask in the same tick', async () => {
    const gate = createPublishGate()
    const events: string[] = []
    let finishFirst: () => void = () => {}
    const first = gate.track(async () => {
      events.push('first starts')
      await new Promise<void>((resolve) => (finishFirst = resolve))
      events.push('first ends')
    })
    const second = gate.track(async () => {
      events.push('second starts')
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(events).toEqual(['first starts'])
    finishFirst()
    await Promise.all([first, second])
    expect(events).toEqual(['first starts', 'first ends', 'second starts'])
  })

  it('a failed publish still lets the next one run', async () => {
    const gate = createPublishGate()
    await expect(gate.track(() => Promise.reject(new Error('no')))).rejects.toThrow('no')
    await expect(gate.track(async () => 'ran')).resolves.toBe('ran')
  })
})
