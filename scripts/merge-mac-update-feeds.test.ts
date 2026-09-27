import { describe, expect, it, afterEach } from 'vitest'
import { createRequire } from 'node:module'
import {
  archOfArtifact,
  feedFileNames,
  mergeMacUpdateFeeds,
  parseUpdateFeed,
  serializeUpdateFeed,
  verifyReadmeDownloadLinks,
  verifyUpdateFeed
} from './merge-mac-update-feeds.mjs'

// The two real published feeds this bug was found in, byte for byte, fetched
// from the releases on 2026-09-27. v1.3.0's describes only arm64; v1.1.22's
// describes only x64. Keeping the real text (rather than a tidied-up
// invention) is the point: the parser has to survive electron-builder's
// actual output, quoted date and all.
const REAL_V130_ARM64_FEED = `version: 1.3.0
files:
  - url: sssketch-1.3.0-mac.zip
    sha512: UJn/LPgcfl3od0ZKnpQoaacGntcvPuGBngkmGlfrsrcIoxjXzNuNu5k/Qnvk/H1Itol0d3jeARQAqCiPO6AAVQ==
    size: 287573095
  - url: sssketch-1.3.0.dmg
    sha512: hgY9Md/u1pbfjaBeV3OMWt+LBI93qhkXJ7HJivhq6pYfiLfruCKlXoiz8ye+HhBtmy/nfuiTf23taiNrpm97bg==
    size: 287852496
path: sssketch-1.3.0-mac.zip
sha512: UJn/LPgcfl3od0ZKnpQoaacGntcvPuGBngkmGlfrsrcIoxjXzNuNu5k/Qnvk/H1Itol0d3jeARQAqCiPO6AAVQ==
releaseDate: '2026-09-27T20:51:42.001Z'
`

const REAL_V1122_X64_FEED = `version: 1.1.22
files:
  - url: sssketch-1.1.22-x64-mac.zip
    sha512: ilMnNXe5ZDSihS13lqHinfahyAZ4pJ4ENlTsxCZMA1PXxA8yQhZVOSh2+febJ2DBfAuerLKV/GG9D6vfXysAKA==
    size: 257586978
  - url: sssketch-1.1.22-x64.dmg
    sha512: cls2N8Mh4z4pg37Zt6fvH+//bNaLC81F7EASy8K1/zhGeFgw80wQ6y8+hsOQxKFXlrupX3D6uUNVP+1RdTOTEw==
    size: 257832642
path: sssketch-1.1.22-x64-mac.zip
sha512: ilMnNXe5ZDSihS13lqHinfahyAZ4pJ4ENlTsxCZMA1PXxA8yQhZVOSh2+febJ2DBfAuerLKV/GG9D6vfXysAKA==
releaseDate: '2026-09-01T17:04:54.917Z'
`

// What the two legs will write once mac.artifactName carries the arch.
function legFeed(arch: 'arm64' | 'x64', version = '1.3.1'): string {
  return `version: ${version}
files:
  - url: sssketch-${version}-${arch}.zip
    sha512: zip-${arch}-sha==
    size: 28757${arch === 'arm64' ? 3095 : 4111}
  - url: sssketch-${version}-${arch}.dmg
    sha512: dmg-${arch}-sha==
    size: 28785${arch === 'arm64' ? 2496 : 5222}
path: sssketch-${version}-${arch}.zip
sha512: zip-${arch}-sha==
releaseDate: '2026-09-27T2${arch === 'arm64' ? '0' : '1'}:51:42.001Z'
`
}

// The script is plain .mjs, so everything it exports arrives untyped here.
type Feed = ReturnType<typeof parseUpdateFeed>

const MERGED_ASSET_NAMES = [
  'sssketch-1.3.1-arm64.zip',
  'sssketch-1.3.1-arm64.dmg',
  'sssketch-1.3.1-x64.zip',
  'sssketch-1.3.1-x64.dmg',
  'latest-mac.yml'
]

describe('parseUpdateFeed / serializeUpdateFeed', () => {
  it('round-trips the real published feeds byte for byte', () => {
    expect(serializeUpdateFeed(parseUpdateFeed(REAL_V130_ARM64_FEED))).toBe(REAL_V130_ARM64_FEED)
    expect(serializeUpdateFeed(parseUpdateFeed(REAL_V1122_X64_FEED))).toBe(REAL_V1122_X64_FEED)
  })

  it('reads the file list in order', () => {
    expect(feedFileNames(parseUpdateFeed(REAL_V130_ARM64_FEED))).toEqual([
      'sssketch-1.3.0-mac.zip',
      'sssketch-1.3.0.dmg'
    ])
  })

  it('throws on a block key it does not understand rather than dropping it', () => {
    expect(() =>
      parseUpdateFeed('version: 1.0.0\npackages:\n  x64:\n    path: a\nfiles:\n  - url: a\n')
    ).toThrow(/unsupported block key/)
  })

  it('throws on a feed with no files', () => {
    expect(() => parseUpdateFeed('version: 1.0.0\npath: a\n')).toThrow(/no "files:" block/)
  })
})

describe('archOfArtifact', () => {
  it('reads the arch out of the new names', () => {
    expect(archOfArtifact('sssketch-1.3.1-arm64.zip')).toBe('arm64')
    expect(archOfArtifact('sssketch-1.3.1-x64.dmg')).toBe('x64')
  })

  it('returns null for the old unsuffixed arm64 names', () => {
    expect(archOfArtifact('sssketch-1.3.0-mac.zip')).toBeNull()
    expect(archOfArtifact('sssketch-1.3.0.dmg')).toBeNull()
  })
})

describe('mergeMacUpdateFeeds', () => {
  it('lists both architectures, arm64 first, keeping every sha512 and size', () => {
    const merged = mergeMacUpdateFeeds([
      parseUpdateFeed(legFeed('x64')),
      parseUpdateFeed(legFeed('arm64'))
    ])
    expect(feedFileNames(merged)).toEqual([
      'sssketch-1.3.1-arm64.zip',
      'sssketch-1.3.1-arm64.dmg',
      'sssketch-1.3.1-x64.zip',
      'sssketch-1.3.1-x64.dmg'
    ])
    expect(serializeUpdateFeed(merged)).toContain('sha512: dmg-x64-sha==')
    expect(serializeUpdateFeed(merged)).toContain('size: 287852496')
  })

  it('repoints the legacy path/sha512 at the first merged file', () => {
    const text = serializeUpdateFeed(
      mergeMacUpdateFeeds([parseUpdateFeed(legFeed('x64')), parseUpdateFeed(legFeed('arm64'))])
    )
    expect(text).toContain('path: sssketch-1.3.1-arm64.zip')
    expect(text.trimEnd().endsWith("releaseDate: '2026-09-27T20:51:42.001Z'")).toBe(true)
  })

  it('refuses two legs that built different versions', () => {
    expect(() =>
      mergeMacUpdateFeeds([
        parseUpdateFeed(legFeed('arm64', '1.3.1')),
        parseUpdateFeed(legFeed('x64', '1.3.2'))
      ])
    ).toThrow(/disagree about the version/)
  })

  it('refuses a duplicate entry', () => {
    expect(() =>
      mergeMacUpdateFeeds([parseUpdateFeed(legFeed('arm64')), parseUpdateFeed(legFeed('arm64'))])
    ).toThrow(/refusing to merge a feed with duplicate entries/)
  })
})

describe('verifyUpdateFeed', () => {
  const good = (): Feed =>
    mergeMacUpdateFeeds([parseUpdateFeed(legFeed('arm64')), parseUpdateFeed(legFeed('x64'))])

  it('passes a correctly merged feed', () => {
    expect(
      verifyUpdateFeed(good(), { expectedVersion: '1.3.1', assetNames: MERGED_ASSET_NAMES })
    ).toEqual([])
  })

  it('rejects the half feed this bug actually shipped', () => {
    const problems = verifyUpdateFeed(parseUpdateFeed(REAL_V1122_X64_FEED), {
      expectedVersion: '1.1.22',
      assetNames: ['sssketch-1.1.22-x64-mac.zip', 'sssketch-1.1.22-x64.dmg']
    })
    expect(problems).toContain(
      'the feed describes no arm64 build at all -- every arm64 Mac would be offered the wrong architecture'
    )
  })

  it('rejects the unsuffixed arm64 names, naming the file', () => {
    const problems = verifyUpdateFeed(parseUpdateFeed(REAL_V130_ARM64_FEED), {
      expectedVersion: '1.3.0',
      assetNames: ['sssketch-1.3.0-mac.zip', 'sssketch-1.3.0.dmg']
    })
    expect(
      problems.some((p: string) =>
        p.startsWith('sssketch-1.3.0-mac.zip has no architecture in its name')
      )
    ).toBe(true)
  })

  it('rejects a feed whose version is not the one being released', () => {
    expect(
      verifyUpdateFeed(good(), { expectedVersion: '1.3.2', assetNames: MERGED_ASSET_NAMES })
    ).toContain('the feed says version 1.3.1, but this release is 1.3.2')
  })

  it('rejects a file the release does not actually have', () => {
    const assets = MERGED_ASSET_NAMES.filter((name) => name !== 'sssketch-1.3.1-x64.zip')
    expect(verifyUpdateFeed(good(), { expectedVersion: '1.3.1', assetNames: assets })).toContain(
      'sssketch-1.3.1-x64.zip is listed in the feed but is not an asset on the release'
    )
  })

  it('rejects a feed with two zips for one arch', () => {
    const feed = parseUpdateFeed(
      serializeUpdateFeed(good()).replace(
        'sssketch-1.3.1-arm64.dmg',
        'sssketch-1.3.1-arm64-extra.zip'
      )
    )
    expect(
      verifyUpdateFeed(feed, {
        expectedVersion: '1.3.1',
        assetNames: [...MERGED_ASSET_NAMES, 'sssketch-1.3.1-arm64-extra.zip']
      })
    ).toContain(
      'the feed has 2 arm64 zips, expected exactly 1: sssketch-1.3.1-arm64.zip, sssketch-1.3.1-arm64-extra.zip'
    )
  })

  it('rejects an entry with no sha512 or size', () => {
    const feed = parseUpdateFeed(`version: 1.3.1
files:
  - url: sssketch-1.3.1-arm64.zip
    sha512: ''
    size: 0
path: sssketch-1.3.1-arm64.zip
`)
    const problems = verifyUpdateFeed(feed, { expectedVersion: '1.3.1', assetNames: null })
    expect(problems).toContain('sssketch-1.3.1-arm64.zip has no sha512')
    expect(problems).toContain('sssketch-1.3.1-arm64.zip has no usable size')
  })
})

// The check that actually matters: not "does our merge look right to us", but
// "does the installed electron-updater, running its own code, hand each Mac
// the right zip". Imported straight out of node_modules (electron-updater
// 6.8.9) rather than reimplemented -- this codebase's convention is to test
// against the real artifact, and a reimplementation of the selection rule
// would be the exact thing that can drift. process.arch is forced to each
// value in turn because findFile reads it, so the answer must not depend on
// which machine runs the suite.
describe('the real electron-updater, fed our merged feed', () => {
  const require = createRequire(import.meta.url)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { MacUpdater } = require('electron-updater/out/MacUpdater.js') as any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { resolveFiles, findFile } = require('electron-updater/out/providers/Provider.js') as any
  const baseUrl = new URL('https://github.com/ellinglien/sssketch/releases/download/v1.3.1/')

  const realArch = process.arch
  afterEach(() => {
    Object.defineProperty(process, 'arch', { value: realArch, configurable: true })
  })

  function zipChosenBy(feedText: string, mac: 'arm64' | 'x64', host: 'arm64' | 'x64'): string {
    Object.defineProperty(process, 'arch', { value: host, configurable: true })
    const info = {
      version: '1.3.1',
      files: parseUpdateFeed(feedText).files.map(
        (file: { entries: { key: string; raw: string }[] }) =>
          Object.fromEntries(file.entries.map((entry) => [entry.key, entry.raw]))
      )
    }
    const files = resolveFiles(info, baseUrl)
    const forThisMac = MacUpdater.filterFilesForArch(files, mac === 'arm64')
    return findFile(forThisMac, 'zip', ['pkg', 'dmg']).url.pathname.split('/').pop()
  }

  const mergedWithArchNames = serializeUpdateFeed(
    mergeMacUpdateFeeds([parseUpdateFeed(legFeed('arm64')), parseUpdateFeed(legFeed('x64'))])
  )

  for (const host of ['arm64', 'x64'] as const) {
    it(`offers each Mac its own zip (checked on a ${host} host)`, () => {
      expect(zipChosenBy(mergedWithArchNames, 'arm64', host)).toBe('sssketch-1.3.1-arm64.zip')
      expect(zipChosenBy(mergedWithArchNames, 'x64', host)).toBe('sssketch-1.3.1-x64.zip')
    })
  }

  // Why the artifacts had to be renamed, in executable form: merging the two
  // legs' file lists is NOT enough on its own. With today's unsuffixed arm64
  // names, filterFilesForArch finds no arm64 file to prefer and findFile finds
  // no "arm64" to match, so an Apple Silicon Mac takes whichever zip happens
  // to be listed first -- reorder the merge and it silently downloads Intel.
  const mergedWithOldNames = `version: 1.3.1
files:
  - url: sssketch-1.3.1-x64-mac.zip
    sha512: a==
    size: 1
  - url: sssketch-1.3.1-mac.zip
    sha512: b==
    size: 2
path: sssketch-1.3.1-x64-mac.zip
`
  it('would hand an Apple Silicon Mac the Intel zip if the names carried no arch', () => {
    expect(zipChosenBy(mergedWithOldNames, 'arm64', 'arm64')).toBe('sssketch-1.3.1-x64-mac.zip')
  })
})

describe('verifyReadmeDownloadLinks', () => {
  const readme = (version: string, tag: string, arm: string, intel: string): string =>
    `## Installing\n\nLatest version: **${version}**\n\n` +
    `- [**${arm}**](https://github.com/ellinglien/sssketch/releases/download/${tag}/${arm}) — Apple Silicon (M1/M2/M3/M4)\n` +
    `- [**${intel}**](https://github.com/ellinglien/sssketch/releases/download/${tag}/${intel}) — Intel\n`

  const assets = MERGED_ASSET_NAMES

  it("passes a README pointing at this release's real assets", () => {
    expect(
      verifyReadmeDownloadLinks(
        readme('1.3.1', 'v1.3.1', 'sssketch-1.3.1-arm64.dmg', 'sssketch-1.3.1-x64.dmg'),
        {
          tag: 'v1.3.1',
          version: '1.3.1',
          assetNames: assets
        }
      )
    ).toEqual([])
  })

  it('catches a README left pointing at the previous release', () => {
    expect(
      verifyReadmeDownloadLinks(
        readme('1.3.0', 'v1.3.0', 'sssketch-1.3.0.dmg', 'sssketch-1.3.0-x64.dmg'),
        {
          tag: 'v1.3.1',
          version: '1.3.1',
          assetNames: assets
        }
      )
    ).toContain('the README still links at v1.3.0/sssketch-1.3.0.dmg; this release is v1.3.1')
  })

  it('catches a link to an asset this release does not have', () => {
    expect(
      verifyReadmeDownloadLinks(
        readme('1.3.1', 'v1.3.1', 'sssketch-1.3.1.dmg', 'sssketch-1.3.1-x64.dmg'),
        {
          tag: 'v1.3.1',
          version: '1.3.1',
          assetNames: assets
        }
      )
    ).toContain('the README links at sssketch-1.3.1.dmg, which this release does not have')
  })

  it('catches link text that disagrees with where the link goes', () => {
    const markdown = readme(
      '1.3.1',
      'v1.3.1',
      'sssketch-1.3.1-arm64.dmg',
      'sssketch-1.3.1-x64.dmg'
    ).replace('[**sssketch-1.3.1-x64.dmg**]', '[**sssketch-1.3.1-arm64.dmg**]')
    expect(
      verifyReadmeDownloadLinks(markdown, { tag: 'v1.3.1', version: '1.3.1', assetNames: assets })
    ).toContain(
      "the README's link text says sssketch-1.3.1-arm64.dmg but the link goes to sssketch-1.3.1-x64.dmg"
    )
  })

  it('catches an install section that offers only one architecture', () => {
    const markdown = `Latest version: **1.3.1**\n\n- [**sssketch-1.3.1-arm64.dmg**](https://github.com/ellinglien/sssketch/releases/download/v1.3.1/sssketch-1.3.1-arm64.dmg)\n`
    expect(
      verifyReadmeDownloadLinks(markdown, { tag: 'v1.3.1', version: '1.3.1', assetNames: assets })
    ).toContain('the README offers no x64 dmg download for v1.3.1')
  })
})
