import { describe, expect, it, vi } from 'vitest'
import { subscribeToState, getStateSnapshot, __setStateForTest } from './StoreContext'
import { nativePlayDispatchPlan } from './nativePlayDispatch'

describe('subscribeToState / getStateSnapshot', () => {
  it('getStateSnapshot returns the current mirrored state', () => {
    const fakeState = { bpm: 140 } as ReturnType<typeof getStateSnapshot>
    __setStateForTest(fakeState)
    expect(getStateSnapshot()).toBe(fakeState)
  })

  it('calls a subscribed listener when notified', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeToState(listener)
    __setStateForTest({ bpm: 150 } as ReturnType<typeof getStateSnapshot>)
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it('stops calling a listener after it unsubscribes', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeToState(listener)
    unsubscribe()
    __setStateForTest({ bpm: 160 } as ReturnType<typeof getStateSnapshot>)
    expect(listener).not.toHaveBeenCalled()
  })

  it('supports multiple independent subscribers', () => {
    const listenerA = vi.fn()
    const listenerB = vi.fn()
    const unsubscribeA = subscribeToState(listenerA)
    const unsubscribeB = subscribeToState(listenerB)
    __setStateForTest({ bpm: 170 } as ReturnType<typeof getStateSnapshot>)
    expect(listenerA).toHaveBeenCalledTimes(1)
    expect(listenerB).toHaveBeenCalledTimes(1)
    unsubscribeA()
    unsubscribeB()
  })
})

describe('nativePlayDispatchPlan', () => {
  it('starts a stopped faded preview exactly once, with no generic follow-up play', () => {
    const plan = nativePlayDispatchPlan(false, { fromPos: 3.5, fadeIn: true })
    expect(plan).toEqual({ playNow: true, suppressNextPlayingEffect: true })
  })

  it('leaves an ordinary stopped Play to the standard playing effect', () => {
    expect(nativePlayDispatchPlan(false)).toEqual({
      playNow: false,
      suppressNextPlayingEffect: false
    })
  })
})
