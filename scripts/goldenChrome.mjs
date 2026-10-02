// scripts/goldenChrome.mjs -- the harness the browser-rendered goldens share
// (golden-master-chain.mjs, golden-dub-delay.mjs): it serves ell.ing/radio through the radio's own
// vite config and dev server, runs a page module (the golden's own code, importing the radio's
// modules by their paths in its root) in headless Chrome, and hands the page's result back.
//
//   RADIO_DIR=/path/to/radio  (default ../ell.ing/radio)
//   CHROME=/path/to/chrome    (default the macOS Google Chrome app)
//   GOLDEN_PORT=5198
//   GOLDEN_ALLOW_DIRTY=1      render from a radio checkout with uncommitted changes (the commit
//                             is then recorded as `git describe --always --dirty`, ending -dirty)
//
// The page fetches its inputs from /__golden/<name> and reports with a POST to
// /__golden/result?<params> (the body is the result) or /__golden/error (the body is the
// message). Every exit (success, a page error, Chrome failing to start or exiting early, a vite
// error, the timeout, a signal) kills Chrome, waits for it, closes vite and removes the temp
// profile. Nothing is added to or changed in the radio repo.
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const GOLDEN = join(ROOT, 'native-engine', 'test', 'golden')
const RADIO = process.env.RADIO_DIR
  ? resolve(process.env.RADIO_DIR)
  : resolve(ROOT, '..', 'ell.ing', 'radio')
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = Number(process.env.GOLDEN_PORT ?? 5198)

/**
 * Renders `page` (a module's source) in headless Chrome, served by the radio's vite. `inputs`
 * maps a name to the bytes served at /__golden/<name>. `onResult(body, params, radioCommit)` is
 * awaited with the POSTed result; the process then exits 0 (or 1 if it throws). Never returns.
 */
export async function renderInRadioChrome({
  tag,
  page,
  inputs = {},
  onResult,
  timeoutMs = 120000
}) {
  const git = (...args) =>
    execFileSync('git', ['-C', RADIO, ...args])
      .toString()
      .trim()
  const dirty = git('status', '--porcelain')
  if (dirty && process.env.GOLDEN_ALLOW_DIRTY !== '1') {
    console.error(
      `${RADIO} has uncommitted changes, so the golden would not match any commit:\n${dirty}\n` +
        'commit or stash them, or set GOLDEN_ALLOW_DIRTY=1 to render anyway (recorded as -dirty)'
    )
    process.exit(1)
  }
  const radioCommit = git('describe', '--always', '--dirty')

  const { createServer } = await import(
    pathToFileURL(join(RADIO, 'node_modules', 'vite', 'dist', 'node', 'index.js')).href
  )

  let chrome
  let server
  let finishing = false
  const userDir = mkdtempSync(join(tmpdir(), `golden-${tag}-`))
  /** Every exit goes through here: Chrome killed, vite closed, the temp profile removed. */
  const finish = async (code) => {
    if (finishing) return
    finishing = true
    // kill Chrome and wait for it to be gone (a few seconds at most), so its profile is no
    // longer being written when it is removed below
    if (
      chrome &&
      chrome.exitCode === null &&
      chrome.signalCode === null &&
      chrome.pid !== undefined
    ) {
      const gone = new Promise((ok) => chrome.once('exit', ok))
      chrome.kill()
      await Promise.race([gone, new Promise((ok) => setTimeout(ok, 5000))])
    }
    try {
      await server?.close()
    } catch (e) {
      console.error('closing vite:', e)
    }
    // a straggling Chrome helper may still touch it: retry, then say so
    try {
      rmSync(userDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    } catch (e) {
      console.error(`could not remove ${userDir}:`, e)
    }
    process.exit(code)
  }
  process.on('SIGINT', () => void finish(130))
  process.on('SIGTERM', () => void finish(143))
  process.on('uncaughtException', (e) => {
    console.error(e)
    void finish(1)
  })
  process.on('unhandledRejection', (e) => {
    console.error(e)
    void finish(1)
  })

  const readBody = (req) =>
    new Promise((ok) => {
      const parts = []
      req.on('data', (c) => parts.push(c))
      req.on('end', () => ok(Buffer.concat(parts)))
    })

  const virtualId = `virtual:golden-${tag}`
  const resolvedId = `\0golden-${tag}`
  try {
    server = await createServer({
      root: RADIO,
      configFile: join(RADIO, 'vite.config.ts'),
      logLevel: 'warn',
      server: { port: PORT, strictPort: true },
      plugins: [
        {
          name: `golden-${tag}`,
          resolveId: (id) => (id === virtualId ? resolvedId : undefined),
          load: (id) => (id === resolvedId ? page : undefined),
          configureServer(s) {
            s.middlewares.use('/__golden', async (req, res) => {
              const url = new URL(req.url ?? '/', 'http://x')
              const name = url.pathname.slice(1)
              if (url.pathname === '/page') {
                res.setHeader('content-type', 'text/html')
                // the module through vite's /@id/ route, under whatever base the radio's config sets
                const base = s.config.base.endsWith('/') ? s.config.base : s.config.base + '/'
                res.end(
                  `<!doctype html><script type="module" src="${base}@id/__x00__golden-${tag}"></script>`
                )
              } else if (Object.prototype.hasOwnProperty.call(inputs, name)) {
                res.setHeader('content-type', 'application/octet-stream')
                res.end(inputs[name])
              } else if (url.pathname === '/result') {
                const body = await readBody(req)
                res.end('ok')
                try {
                  await onResult(body, url.searchParams, radioCommit)
                } catch (e) {
                  console.error(e)
                  return finish(1)
                }
                return finish(0)
              } else if (url.pathname === '/error') {
                console.error((await readBody(req)).toString())
                res.end('ok')
                return finish(1)
              } else {
                res.statusCode = 404
                res.end()
              }
            })
          }
        }
      ]
    })
    await server.listen()
  } catch (e) {
    console.error('vite:', e)
    await finish(1)
  }
  chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--mute-audio',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=${userDir}`,
      `http://localhost:${PORT}/__golden/page`
    ],
    { stdio: 'ignore' }
  )
  chrome.on('error', (e) => {
    console.error(`could not start Chrome (${CHROME}; set CHROME=...):`, e.message)
    void finish(1)
  })
  chrome.on('exit', (code) => {
    if (!finishing) {
      console.error(`Chrome exited (${code}) before the page reported back`)
      void finish(1)
    }
  })
  setTimeout(() => {
    console.error('timed out')
    void finish(1)
  }, timeoutMs)
  return new Promise(() => {})
}
