// src/main/stemAutoClassifyScheduler.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mocked at the module boundary (not a real db/classifier) -- this file
// only needs to prove the scheduler's OWN timing/consent/idempotency
// logic is correct; classifyAutoCategoryBatch's real classification
// behavior is covered by stemAutoClassify.test.ts.
const classifyAutoCategoryBatch = vi.fn()
const loadDiscoverSettings = vi.fn()
const openOwnRiffLibraryDb = vi.fn(() => ({}) as never)
const candidateDbsForRiff = vi.fn(() => [] as never[])

vi.mock('./stemAutoClassify', () => ({ classifyAutoCategoryBatch }))
vi.mock('./riffLibrarySchema', () => ({ openOwnRiffLibraryDb }))
vi.mock('./discoverSettingsStore', () => ({ loadDiscoverSettings }))
vi.mock('./riffLibraryStore', () => ({ candidateDbsForRiff }))

// vi.resetModules() before each test, then a fresh dynamic import --
// startStemAutoClassifyScheduler's own idempotency guard (`started`) is
// module-level state, so each test needs its own fresh module instance to
// test starting it from a clean slate (same convention as
// riffLibrarySchema.test.ts's own dynamic-import-per-test pattern for
// similar module-level state).
beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  classifyAutoCategoryBatch.mockReset()
  loadDiscoverSettings.mockReset()
  openOwnRiffLibraryDb.mockClear()
  candidateDbsForRiff.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('startStemAutoClassifyScheduler', () => {
  it('does nothing while consent is withheld', async () => {
    loadDiscoverSettings.mockReturnValue({ consentedToLibraryScan: false })
    const { startStemAutoClassifyScheduler } = await import('./stemAutoClassifyScheduler')
    startStemAutoClassifyScheduler()

    await vi.advanceTimersByTimeAsync(1000)
    expect(classifyAutoCategoryBatch).not.toHaveBeenCalled()
  })

  it('classifies a batch once consent is granted, and reschedules quickly while work remains', async () => {
    loadDiscoverSettings.mockReturnValue({ consentedToLibraryScan: true })
    classifyAutoCategoryBatch.mockResolvedValue({ processed: 5, remaining: 10 })
    const { startStemAutoClassifyScheduler } = await import('./stemAutoClassifyScheduler')
    startStemAutoClassifyScheduler()

    await vi.advanceTimersByTimeAsync(3000) // BUSY_DELAY_MS, first tick
    expect(classifyAutoCategoryBatch).toHaveBeenCalledTimes(1)

    // remaining > 0 -- reschedules at BUSY_DELAY_MS (3000ms), not idle.
    await vi.advanceTimersByTimeAsync(3000)
    expect(classifyAutoCategoryBatch).toHaveBeenCalledTimes(2)
  })

  it('sleeps once a batch reports no remaining work -- no further calls until the safety interval', async () => {
    loadDiscoverSettings.mockReturnValue({ consentedToLibraryScan: true })
    classifyAutoCategoryBatch.mockResolvedValue({ processed: 0, remaining: 0 })
    const { startStemAutoClassifyScheduler } = await import('./stemAutoClassifyScheduler')
    startStemAutoClassifyScheduler()

    await vi.advanceTimersByTimeAsync(3000)
    expect(classifyAutoCategoryBatch).toHaveBeenCalledTimes(1)

    // Before B4 this polled every 30s; now nothing happens for minutes.
    await vi.advanceTimersByTimeAsync(9 * 60_000)
    expect(classifyAutoCategoryBatch).toHaveBeenCalledTimes(1)

    // Safety interval (10 min) -- one more batch, then asleep again.
    await vi.advanceTimersByTimeAsync(60_000)
    expect(classifyAutoCategoryBatch).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(classifyAutoCategoryBatch).toHaveBeenCalledTimes(2)
  })

  it('wakes from sleep when a new embedding/feature row is noted, coalescing a burst into one batch', async () => {
    loadDiscoverSettings.mockReturnValue({ consentedToLibraryScan: true })
    classifyAutoCategoryBatch.mockResolvedValue({ processed: 0, remaining: 0 })
    const { startStemAutoClassifyScheduler } = await import('./stemAutoClassifyScheduler')
    const wake = await import('./stemAutoClassifyWake')
    startStemAutoClassifyScheduler()
    await vi.advanceTimersByTimeAsync(3000)
    expect(classifyAutoCategoryBatch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_000)

    const db = {} as never
    wake.noteAutoClassifyInputRow(db, 'embedding', 's1')
    await vi.advanceTimersByTimeAsync(1000)
    wake.noteAutoClassifyInputRow(db, 'feature', 's2')
    wake.noteAutoClassifyInputRow(db, 'embedding', 's3')
    // Wake delay (3s) from the FIRST signal -- later ones don't push it out
    // or add batches.
    await vi.advanceTimersByTimeAsync(2000)
    expect(classifyAutoCategoryBatch).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(5000)
    expect(classifyAutoCategoryBatch).toHaveBeenCalledTimes(2)
  })

  it('wakes on a training change (confirmation / centroid retrain)', async () => {
    loadDiscoverSettings.mockReturnValue({ consentedToLibraryScan: true })
    classifyAutoCategoryBatch.mockResolvedValue({ processed: 0, remaining: 0 })
    const { startStemAutoClassifyScheduler } = await import('./stemAutoClassifyScheduler')
    const wake = await import('./stemAutoClassifyWake')
    startStemAutoClassifyScheduler()
    await vi.advanceTimersByTimeAsync(3000)
    expect(classifyAutoCategoryBatch).toHaveBeenCalledTimes(1)

    wake.noteAutoClassifyTrainingChanged()
    await vi.advanceTimersByTimeAsync(3000)
    expect(classifyAutoCategoryBatch).toHaveBeenCalledTimes(2)
  })

  it('does not sleep on a signal that arrived while its batch was running', async () => {
    loadDiscoverSettings.mockReturnValue({ consentedToLibraryScan: true })
    const wake = await import('./stemAutoClassifyWake')
    classifyAutoCategoryBatch.mockImplementation(async () => {
      if (classifyAutoCategoryBatch.mock.calls.length === 1) {
        wake.noteAutoClassifyInputRow({} as never, 'embedding', 'mid-batch')
      }
      return { processed: 0, remaining: 0 }
    })
    const { startStemAutoClassifyScheduler } = await import('./stemAutoClassifyScheduler')
    startStemAutoClassifyScheduler()

    await vi.advanceTimersByTimeAsync(3000)
    expect(classifyAutoCategoryBatch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(3000)
    expect(classifyAutoCategoryBatch).toHaveBeenCalledTimes(2)
    // Second batch saw no signal -- asleep now.
    await vi.advanceTimersByTimeAsync(60_000)
    expect(classifyAutoCategoryBatch).toHaveBeenCalledTimes(2)
  })

  it('a wake signal does not add calls while busy', async () => {
    loadDiscoverSettings.mockReturnValue({ consentedToLibraryScan: true })
    classifyAutoCategoryBatch.mockResolvedValue({ processed: 5, remaining: 10 })
    const { startStemAutoClassifyScheduler } = await import('./stemAutoClassifyScheduler')
    const wake = await import('./stemAutoClassifyWake')
    startStemAutoClassifyScheduler()
    await vi.advanceTimersByTimeAsync(3000)
    expect(classifyAutoCategoryBatch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1000)
    wake.noteAutoClassifyInputRow({} as never, 'embedding', 's1')
    wake.noteAutoClassifyTrainingChanged()
    await vi.advanceTimersByTimeAsync(2000)
    expect(classifyAutoCategoryBatch).toHaveBeenCalledTimes(2)
  })

  it('is idempotent -- calling it again starts no second timer chain', async () => {
    loadDiscoverSettings.mockReturnValue({ consentedToLibraryScan: true })
    classifyAutoCategoryBatch.mockResolvedValue({ processed: 0, remaining: 0 })
    const { startStemAutoClassifyScheduler } = await import('./stemAutoClassifyScheduler')
    startStemAutoClassifyScheduler()
    startStemAutoClassifyScheduler()
    startStemAutoClassifyScheduler()

    await vi.advanceTimersByTimeAsync(3000)
    // A second/third chain having started would show up as 2 or 3 here.
    expect(classifyAutoCategoryBatch).toHaveBeenCalledTimes(1)
  })

  it('re-checks consent on every tick, not just at start', async () => {
    loadDiscoverSettings.mockReturnValue({ consentedToLibraryScan: true })
    classifyAutoCategoryBatch.mockResolvedValue({ processed: 1, remaining: 5 })
    const { startStemAutoClassifyScheduler } = await import('./stemAutoClassifyScheduler')
    startStemAutoClassifyScheduler()

    await vi.advanceTimersByTimeAsync(3000)
    expect(classifyAutoCategoryBatch).toHaveBeenCalledTimes(1)

    // Consent revoked mid-flight (e.g. the settings-menu toggle).
    loadDiscoverSettings.mockReturnValue({ consentedToLibraryScan: false })
    await vi.advanceTimersByTimeAsync(1000)
    expect(classifyAutoCategoryBatch).toHaveBeenCalledTimes(1) // no new call
  })

  it('backs off to the idle delay, rather than retrying tightly, when a batch call throws', async () => {
    loadDiscoverSettings.mockReturnValue({ consentedToLibraryScan: true })
    classifyAutoCategoryBatch.mockRejectedValue(new Error('boom'))
    const { startStemAutoClassifyScheduler } = await import('./stemAutoClassifyScheduler')
    startStemAutoClassifyScheduler()

    await vi.advanceTimersByTimeAsync(3000)
    expect(classifyAutoCategoryBatch).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(2000)
    expect(classifyAutoCategoryBatch).toHaveBeenCalledTimes(1) // still backed off

    await vi.advanceTimersByTimeAsync(28000)
    expect(classifyAutoCategoryBatch).toHaveBeenCalledTimes(2)
  })
})
