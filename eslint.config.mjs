import { defineConfig } from 'eslint/config'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginReact from 'eslint-plugin-react'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh'

export default defineConfig(
  {
    ignores: [
      '**/node_modules',
      '**/dist',
      '**/out',
      '**/design',
      '**/docs',
      '**/fixtures',
      'native-engine/build',
      // The local-only x64 test build's own cross-compile output (see
      // scripts/build-x64-test.sh) -- never present in CI, only on a dev
      // machine that's run that script, but needs the same exclusion as
      // native-engine/build above once it exists locally.
      'native-engine/build-x64',
      'native-engine-bridge/build',
      'build',
      '.worktrees'
    ]
  },
  tseslint.configs.recommended,
  eslintPluginReact.configs.flat.recommended,
  eslintPluginReact.configs.flat['jsx-runtime'],
  {
    settings: {
      react: {
        version: 'detect'
      }
    }
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': eslintPluginReactHooks,
      'react-refresh': eslintPluginReactRefresh
    },
    rules: {
      ...eslintPluginReactHooks.configs.recommended.rules,
      ...eslintPluginReactRefresh.configs.vite.rules
    }
  },
  {
    // scripts/merge-mac-update-feeds.mjs is plain, dependency-free
    // JavaScript on purpose -- it runs under bare `node` in the release
    // workflow's merge job, on a runner with no npm install (see its own
    // doc comment). TypeScript's return-type rule has nothing to annotate
    // in a .js file, so it's off here rather than satisfied with JSDoc.
    files: ['scripts/*.mjs'],
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off'
    }
  },
  {
    // A bare `node scripts/generate-x64-test-config.js` CommonJS entry
    // point (see scripts/build-x64-test.sh) -- not part of the TS/ESM
    // build, so require() here is correct, not a style slip.
    files: ['scripts/generate-x64-test-config.js'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off'
    }
  },
  eslintConfigPrettier
)
