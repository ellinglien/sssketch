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
    // Root-caused via a real CI run: loreWarehouse.test.ts (the only file
    // using the better-sqlite3 native addon) crashed its whole vitest
    // worker on GitHub's macOS runner even run completely alone, during
    // the IMPORT phase (0 tests started) -- not resource contention (ruled
    // out: capping maxWorkers didn't help) and not a binding/ABI mismatch
    // (better-sqlite3 loads fine via a bare top-level `node -e require`
    // on that same runner). That combination -- fine in the main process,
    // crashes the instant it's loaded inside a forked child -- is the
    // classic signature of a native addon that isn't fork-safe (internal
    // locks/threading state initialized before fork() can leave the child
    // in a broken state immediately). vitest's default 'forks' pool uses
    // child_process.fork() for worker isolation; 'threads' uses
    // worker_threads instead, which share the process rather than forking
    // it, sidestepping this whole class of problem.
    pool: 'threads'
  }
})
