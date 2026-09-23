import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import postcss from 'postcss'

/**
 * Every stylesheet must actually parse.
 *
 * Nothing else in this repo's checks reads CSS at all -- tsc does not, eslint
 * does not, and vitest never imports it -- so a malformed stylesheet passes a
 * completely green `typecheck` + `lint` + `vitest` run and then takes the whole
 * app down at dev-server startup with a postcss error overlay.
 *
 * That is not hypothetical. It happened: a comment above @keyframes
 * sssketchy-bob contained the literal text `--ra-dur-*` followed by a slash,
 * and that slash-star pair CLOSED THE COMMENT early, so the remaining English
 * prose was parsed as declarations ("Unknown word motion"). Prose about CSS is
 * unusually likely to contain a star-slash by accident, which makes this the
 * one file type here where a comment can break the build.
 */
describe('stylesheets', () => {
  const stylesDir = __dirname
  const files = readdirSync(stylesDir).filter((f) => f.endsWith('.css'))

  it('finds the stylesheets to check', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it.each(files)('%s parses', (file) => {
    const css = readFileSync(join(stylesDir, file), 'utf-8')
    expect(() => postcss.parse(css, { from: file })).not.toThrow()
  })
})
