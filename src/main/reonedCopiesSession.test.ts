import { describe, expect, it } from 'vitest'
import { noteIssuedCopy, sessionIssuedNames, withReonedCopiesLock } from './reonedCopiesSession'

describe('withReonedCopiesLock', () => {
  it('runs one holder at a time, in call order, and survives a rejection', async () => {
    const order: string[] = []
    const slow = withReonedCopiesLock(async () => {
      order.push('a-start')
      await new Promise((r) => setTimeout(r, 20))
      order.push('a-end')
    })
    const failing = withReonedCopiesLock(async () => {
      order.push('b')
      throw new Error('boom')
    })
    const after = withReonedCopiesLock(async () => order.push('c'))
    await slow
    await expect(failing).rejects.toThrow('boom')
    await after
    expect(order).toEqual(['a-start', 'a-end', 'b', 'c'])
  })
})

describe('sessionIssuedNames', () => {
  it('remembers the basename of every copy handed out', () => {
    noteIssuedCopy('/lib/.bakes/0123abcd.baked.wav')
    expect(sessionIssuedNames().has('0123abcd.baked.wav')).toBe(true)
  })
})
