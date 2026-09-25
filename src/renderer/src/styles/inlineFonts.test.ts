import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import postcss from 'postcss'

/**
 * The two Silkscreen faces are embedded as base64 data URIs in the head of
 * src/renderer/index.html rather than linked from global.css, so that the
 * font exists before any script runs and costs no request at all.
 *
 * That buys a real startup win but creates one hazard: the .woff2 files under
 * src/renderer/src/assets/fonts/ stay the source of truth, and nothing in the
 * build reads them any more. Swap a face on disk and the app would keep
 * shipping the old bytes, silently, with no error anywhere. These tests are
 * the only thing that would notice.
 *
 * Also guarded here: font-src data: in the CSP. Without it the browser
 * refuses every data: URI font and the app renders in the ui-monospace
 * fallback with nothing but a console warning -- which is exactly how every
 * packaged build behaved before 2026-09-25.
 */

const rendererDir = join(__dirname, '..', '..')
const html = readFileSync(join(rendererDir, 'index.html'), 'utf-8')
const fontsDir = join(rendererDir, 'src', 'assets', 'fonts')

function base64OnDisk(file: string): string {
  return readFileSync(join(fontsDir, file)).toString('base64')
}

function inlinedFaceWeights(): string[] {
  return [...html.matchAll(/font-weight:\s*(\d+)/g)].map((m) => m[1])
}

describe('inline Silkscreen faces in index.html', (): void => {
  it('embeds exactly the two faces, regular and bold', (): void => {
    expect(inlinedFaceWeights()).toEqual(['400', '700'])
    expect([...html.matchAll(/@font-face/g)]).toHaveLength(2)
  })

  it.each([
    ['Silkscreen-Regular.woff2', '400'],
    ['Silkscreen-Bold.woff2', '700']
  ])('%s is embedded byte-for-byte as the weight-%s face', (file, weight): void => {
    const face = html.split('@font-face').find((block) => block.includes(`font-weight: ${weight}`))
    expect(face, `no @font-face block with font-weight: ${weight}`).toBeDefined()
    expect(face).toContain(`url(data:font/woff2;base64,${base64OnDisk(file)})`)
  })

  it('blocks rather than swaps, so no fallback face is ever painted', (): void => {
    expect([...html.matchAll(/font-display:\s*block/g)]).toHaveLength(2)
  })

  it('allows data: fonts in the CSP', (): void => {
    const csp = /content="([^"]*Content-Security|[^"]*default-src[^"]*)"/.exec(html)?.[1] ?? html
    expect(csp).toMatch(/font-src[^;"]*\bdata:/)
  })

  it('does not also declare the faces in global.css', (): void => {
    const css = readFileSync(join(__dirname, 'global.css'), 'utf-8')
    const faces: string[] = []
    postcss.parse(css, { from: 'global.css' }).walkAtRules('font-face', (rule): void => {
      faces.push(String(rule))
    })
    expect(faces).toEqual([])
  })
})
