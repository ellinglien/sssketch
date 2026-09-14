import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  renderer: {
    resolve: { alias: { '@shared': resolve('src/shared') } },
    plugins: [react()],
    // onnxruntime-web/wasm (yamnetWorker.ts) locates its own .wasm binary at
    // runtime via `new URL("ort-wasm-simd-threaded.wasm", import.meta.url)`,
    // relative to wherever its own JS module actually loaded from -- see
    // yamnetWorker.ts's own doc comment for why the /wasm subpath (not the
    // bare package) is imported. In `npm run dev`, Vite's dependency
    // pre-bundler (esbuild) was folding that module into a single bundled
    // chunk under node_modules/.vite/deps/, which relocates import.meta.url
    // away from the real onnxruntime-web/dist/ directory the .wasm file
    // actually lives in -- the resulting request 404s (no such path under
    // .vite/deps/), and falls through to Vite's dev-server SPA fallback,
    // which serves index.html instead of a 404. onnxruntime-web then fails
    // to parse that HTML as WASM ("expected magic word... found 3c 21 64
    // 6f", i.e. the bytes for "<!do") -- confirmed via a real `npm run dev`
    // session, 2026-09-14. Excluding it from pre-bundling keeps it served
    // from its real package location, where the relative URL resolves
    // correctly (a production build was never affected -- Vite's static
    // asset bundler handles this correctly there, see yamnetWorker.ts).
    optimizeDeps: { exclude: ['onnxruntime-web'] }
  }
})
