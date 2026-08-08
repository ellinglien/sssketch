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
    // Root-caused via 2 real CI runs: loreWarehouse.test.ts (the only file
    // using the better-sqlite3 native addon) crashes on GitHub's macOS
    // runner even run completely alone, during the IMPORT phase -- not
    // resource contention (capping maxWorkers didn't help) and not a
    // binding/ABI mismatch (better-sqlite3 loads fine via a bare top-level
    // `node -e require` on that same runner). Switching vitest's pool from
    // 'forks' to 'threads' made it categorically worse (a full process
    // segfault instead of one worker dying), proving this isn't a
    // fork-vs-thread mechanism problem -- it crashes under both pooling
    // strategies, but not as a bare unmanaged process. The common factor is
    // Vitest's own module transform/SSR pipeline touching the native
    // addon; explicitly externalizing it (plain require(), never
    // transformed/bundled) is the standard fix for exactly this signature.
    server: {
      deps: {
        external: ['better-sqlite3']
      }
    }
  }
})
