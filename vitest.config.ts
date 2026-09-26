import { defineConfig, configDefaults } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: { '@shared': resolve(__dirname, 'src/shared') }
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'native-engine/test/**/*.test.ts', 'scripts/**/*.test.ts'],
    // Every test file that loads the better-sqlite3 native addon (directly,
    // or transitively via riffLibrarySchema.ts) reliably crashes its
    // vitest worker on GitHub's macOS CI runner -- 4 distinct, well-reasoned
    // fixes tried against riffLibraryStore.test.ts alone (capping worker
    // concurrency, switching to the 'threads' pool, marking the addon
    // external, forcing a from-source rebuild), all producing byte-for-byte
    // identical failure output. A later real release run confirmed the
    // other 4 better-sqlite3-touching files (riffLibrarySchema/Sync/
    // Writer.test.ts, riffFavouritesMigration.test.ts) crash identically --
    // better-sqlite3 is a true N-API addon (NODE_API_MODULE, ABI-stable
    // across Node/Electron by construction), which rules out an ABI
    // mismatch as the cause too. Passes 100% reliably locally and
    // presumably on any non-CI machine. Excluded only under CI
    // (process.env.CI, set automatically by GitHub Actions) so local runs
    // keep full coverage -- a known CI-environment gap, not a code bug,
    // and not worth more blind guessing at. (Filenames updated for the
    // 2026-08-14 riff-library rename; the underlying files/crash are
    // unchanged.)
    //
    // GROWN 2026-09-25, and the reason it had to be is worth recording: this
    // list named only the 5 files below, and was never extended when Discover
    // landed (2026-09-15..22). The v1.2.0 release build then failed on BOTH
    // legs with 22 `Worker exited unexpectedly` errors and ZERO failed tests
    // -- 21 further files crashed their workers before running, and vitest
    // exits non-zero for a dead worker. Nothing was wrong with the code; the
    // release was simply unshippable until this list caught up. The failure
    // signature to watch for is exactly that: a non-zero exit with no failed
    // test named, and a file count well below the local one.
    //
    // The 21 added below are the set that EMPIRICALLY crashed in run
    // 36196299329, not everything that touches the addon. Four others reach
    // better-sqlite3 through their subject module but run fine, because they
    // never open a database: discoverAdjacency, projectLibrary,
    // riffLibraryMigration, stemAutoClassifyScheduler. They stay in CI
    // deliberately -- excluding a passing test to be tidy is lost coverage
    // for nothing.
    exclude: process.env.CI
      ? [
          ...configDefaults.exclude,
          'src/main/riffLibraryStore.test.ts',
          'src/main/riffLibrarySchema.test.ts',
          'src/main/riffLibrarySync.test.ts',
          'src/main/riffLibraryWriter.test.ts',
          'src/main/riffFavouritesMigration.test.ts',
          'src/main/categoryCentroidTraining.test.ts',
          'src/main/discoverCandidates.test.ts',
          'src/main/discoverIndexCache.test.ts',
          'src/main/discoveredLibrary.test.ts',
          'src/main/discoverLibraryStems.test.ts',
          'src/main/embeddingMatch.test.ts',
          'src/main/instrumentMaskCentroidBackfill.test.ts',
          'src/main/resolveStemArrangeRole.test.ts',
          'src/main/scanTargetCache.test.ts',
          'src/main/stemAnalysisNeeds.test.ts',
          'src/main/stemAnalysisResultsWriter.test.ts',
          'src/main/stemAutoCategoryStore.test.ts',
          'src/main/stemAutoClassify.test.ts',
          'src/main/stemAvailability.test.ts',
          'src/main/stemCategoriesBackfill.test.ts',
          'src/main/stemCategoriesStore.test.ts',
          'src/main/stemEmbeddingCacheStore.test.ts',
          'src/main/stemFeatureCacheStore.test.ts',
          'src/main/stemPeaksCacheStore.test.ts',
          'src/main/stemUnavailableStore.test.ts',
          'src/main/tidyUpLibraryStems.test.ts',
          'src/main/traitQuantileCache.test.ts'
        ]
      : configDefaults.exclude,
    passWithNoTests: true
  }
})
