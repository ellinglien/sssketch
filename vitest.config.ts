import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: { '@shared': resolve(__dirname, 'src/shared') }
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'native-engine/test/**/*.test.ts', 'scripts/**/*.test.ts'],
    passWithNoTests: true,
    // A handful of test files (playbackEngineLifecycle, engineProcess,
    // liveReschedule, ipc-roundtrip, bakeOffset, render-parity) each spawn a
    // real subprocess (the JUCE engine binary, or the rubberband CLI) --
    // vitest's default fork pool runs many test files concurrently across
    // workers, and on a CPU-constrained CI runner that's enough concurrent
    // real subprocess spawning to crash an entire worker fork outright (no
    // test-level error, just "Worker exited unexpectedly") -- confirmed via
    // a real release build: better-sqlite3 (the native addon in the test
    // file whose worker died) loads perfectly fine standalone on that exact
    // runner, ruling out a binding/ABI mismatch. Capping concurrency trades
    // some wall-clock time for not overwhelming a small number of cores.
    maxWorkers: 4
  }
})
