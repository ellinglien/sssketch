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
      '.worktrees',
      // Vendored, gitignored third-party runtime files (onnxruntime-web's
      // own WASM binaries + minified JS glue, copied verbatim by
      // scripts/vendor-onnxruntime-wasm.sh) -- not this project's own
      // source, and the minified .mjs files there trip lint rules
      // (explicit-function-return-type etc.) meant for hand-written code.
      'src/renderer/public'
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
