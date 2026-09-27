#!/usr/bin/env node
// scripts/merge-mac-update-feeds.mjs
//
// The macOS release is built as a two-leg matrix (see .github/workflows/
// release.yml), and each leg's own electron-builder run writes a
// dist/latest-mac.yml describing ONLY that leg's artifacts. Both legs upload
// it to the same GitHub release, so the second one to finish silently
// overwrites the first and the published update feed has only ever described
// one architecture -- verified against the real v1.1.22 (x64 only) and v1.3.0
// (arm64 only) feeds. An Intel Mac on v1.3.0 is currently being offered an
// arm64 build it cannot run.
//
// This merges the two legs' feeds into one that lists both, and verifies the
// result hard enough that the same bug cannot come back quietly. See
// docs/superpowers/specs/2026-09-27-mac-update-feed-both-arches-design.md for
// the full story, including the electron-updater source that decides which
// file a given Mac downloads.
//
// Zero dependencies, plain .mjs, run as `node scripts/merge-mac-update-feeds.mjs`:
// this runs in the one CI job that decides whether a release is correct, on a
// runner that already has node and gh, so it deliberately does not need an
// `npm ci` (a couple of minutes, plus a whole class of install flakiness, in
// exactly the place that must not flake). latest-mac.yml is machine-generated
// and has a fixed, tiny shape, so the parser below handles exactly that shape
// and throws on anything else rather than pulling in a YAML library to be
// liberal with.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

// --- parsing / serialising -------------------------------------------------

// Values are kept as their RAW yaml text (quotes and all) and re-emitted
// verbatim, so a merged feed is composed entirely of substrings of its
// inputs -- no re-quoting, no number reformatting, no chance of mangling a
// base64 sha512 on the way through.
function unquote(raw) {
  if (raw.length >= 2 && raw.startsWith("'") && raw.endsWith("'")) {
    return raw.slice(1, -1).replace(/''/g, "'")
  }
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    return JSON.parse(raw)
  }
  return raw
}

function splitScalar(line, context) {
  const at = line.indexOf(':')
  if (at === -1) {
    throw new Error(`${context}: expected "key: value", got ${JSON.stringify(line)}`)
  }
  const key = line.slice(0, at).trim()
  const raw = line.slice(at + 1).trim()
  if (key === '' || raw === '') {
    throw new Error(`${context}: expected a non-empty key and value, got ${JSON.stringify(line)}`)
  }
  return { key, raw }
}

/**
 * Parses electron-builder's latest-mac.yml. Returns
 * `{ top: [{key, raw} | {key: 'files'}], files: [{entries: [{key, raw}]}] }`
 * with source order preserved on both levels.
 */
export function parseUpdateFeed(text) {
  const top = []
  const files = []
  let inFiles = false
  const lines = text.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue
    const context = `line ${i + 1}`

    if (!line.startsWith(' ') && !line.startsWith('-')) {
      const at = line.indexOf(':')
      if (at !== -1 && line.slice(at + 1).trim() === '') {
        // A key with no scalar value -- only `files:` is expected here.
        const key = line.slice(0, at).trim()
        if (key !== 'files') {
          throw new Error(
            `${context}: unsupported block key ${JSON.stringify(key)} in a mac update feed`
          )
        }
        if (inFiles) throw new Error(`${context}: a second "files:" block`)
        inFiles = true
        top.push({ key: 'files' })
        continue
      }
      inFiles = false
      top.push(splitScalar(line, context))
      continue
    }

    if (!inFiles) {
      throw new Error(
        `${context}: indented line outside the "files:" block: ${JSON.stringify(line)}`
      )
    }
    const trimmed = line.trim()
    if (trimmed.startsWith('- ')) {
      files.push({ entries: [splitScalar(trimmed.slice(2), context)] })
      continue
    }
    if (files.length === 0) {
      throw new Error(`${context}: a file property before any "- " entry: ${JSON.stringify(line)}`)
    }
    files[files.length - 1].entries.push(splitScalar(trimmed, context))
  }

  if (!top.some((entry) => entry.key === 'files')) {
    throw new Error('update feed has no "files:" block')
  }
  if (files.length === 0) {
    throw new Error('update feed\'s "files:" block is empty')
  }
  return { top, files }
}

export function serializeUpdateFeed(feed) {
  const out = []
  for (const entry of feed.top) {
    if (entry.key === 'files' && entry.raw === undefined) {
      out.push('files:')
      for (const file of feed.files) {
        file.entries.forEach((property, index) => {
          out.push(`${index === 0 ? '  - ' : '    '}${property.key}: ${property.raw}`)
        })
      }
      continue
    }
    out.push(`${entry.key}: ${entry.raw}`)
  }
  return out.join('\n') + '\n'
}

function scalar(feed, key) {
  const entry = feed.top.find((it) => it.key === key && it.raw !== undefined)
  return entry === undefined ? undefined : unquote(entry.raw)
}

function fileProperty(file, key) {
  const entry = file.entries.find((it) => it.key === key)
  return entry === undefined ? undefined : unquote(entry.raw)
}

export function feedVersion(feed) {
  return scalar(feed, 'version')
}

export function feedFileNames(feed) {
  return feed.files.map((file) => fileProperty(file, 'url'))
}

// --- architecture -----------------------------------------------------------

// Deliberately the same substring test electron-updater itself uses
// (MacUpdater.filterFilesForArch: `file.url.pathname.includes("arm64")`), so
// this can never disagree with the thing actually choosing the download.
export function archOfArtifact(name) {
  const isArm64 = name.includes('arm64')
  const isX64 = name.includes('x64')
  if (isArm64 && isX64) return 'ambiguous'
  if (isArm64) return 'arm64'
  if (isX64) return 'x64'
  return null
}

// --- merging ----------------------------------------------------------------

export function mergeMacUpdateFeeds(feeds) {
  if (feeds.length < 2) {
    throw new Error(`expected at least two feeds to merge, got ${feeds.length}`)
  }
  const versions = feeds.map(feedVersion)
  if (new Set(versions).size !== 1) {
    throw new Error(
      `the legs' feeds disagree about the version: ${versions.join(', ')} -- did one leg build a different commit?`
    )
  }

  const merged = []
  const seen = new Set()
  // arm64 first, then x64, then anything unrecognised (which verify rejects).
  // Order is load-bearing on Apple Silicon whenever a file name carries no
  // arch: electron-updater's findFile falls through to `filteredFiles.shift()`
  // there, i.e. to whatever is listed first. With arch-suffixed names it does
  // not matter -- this keeps the safe answer first anyway.
  for (const wanted of ['arm64', 'x64', null, 'ambiguous']) {
    for (const feed of feeds) {
      for (const file of feed.files) {
        const url = fileProperty(file, 'url')
        if (url === undefined) throw new Error('a "files:" entry has no url')
        if (archOfArtifact(url) !== wanted) continue
        if (seen.has(url)) {
          throw new Error(
            `two legs both produced ${url} -- refusing to merge a feed with duplicate entries`
          )
        }
        seen.add(url)
        merged.push(file)
      }
    }
  }

  // The top-level scalars come from whichever leg contributed the first file,
  // so `path`/`sha512` (the legacy single-file fields, still read by old
  // updaters via getFileList) describe that same first entry and stay
  // self-consistent. releaseDate is that leg's too -- the two legs finish
  // minutes apart and nothing reads it for anything but display.
  const first = merged[0]
  const firstUrl = fileProperty(first, 'url')
  const firstSha = fileProperty(first, 'sha512')
  const base = feeds.find((feed) => feed.files.includes(first))
  const top = base.top.map((entry) => {
    if (entry.raw === undefined) return entry
    if (entry.key === 'path') return { key: 'path', raw: firstUrl }
    if (entry.key === 'sha512') return { key: 'sha512', raw: firstSha }
    return entry
  })
  return { top, files: merged }
}

// --- verifying --------------------------------------------------------------

/**
 * Returns a list of human-readable problems; empty means the feed is good.
 * `assetNames` is the real asset list of the release the feed was published
 * to (pass null to skip that cross-check).
 */
export function verifyUpdateFeed(feed, { expectedVersion, assetNames }) {
  const problems = []
  const version = feedVersion(feed)
  if (version === undefined) {
    problems.push('the feed has no "version"')
  } else if (expectedVersion !== undefined && version !== expectedVersion) {
    problems.push(`the feed says version ${version}, but this release is ${expectedVersion}`)
  }

  const byArch = { arm64: [], x64: [] }
  for (const file of feed.files) {
    const url = fileProperty(file, 'url')
    if (url === undefined) {
      problems.push('a "files:" entry has no url')
      continue
    }
    const sha512 = fileProperty(file, 'sha512')
    if (!sha512) problems.push(`${url} has no sha512`)
    const size = Number(fileProperty(file, 'size'))
    if (!Number.isFinite(size) || size <= 0) problems.push(`${url} has no usable size`)

    const arch = archOfArtifact(url)
    if (arch === null) {
      // The actual regression guard. electron-updater picks a download purely
      // by looking for an arch in the file name; a name without one makes an
      // Apple Silicon Mac fall back to "whichever entry is listed first".
      problems.push(
        `${url} has no architecture in its name -- electron-updater cannot tell the builds apart (see mac.artifactName in electron-builder.yml)`
      )
      continue
    }
    if (arch === 'ambiguous') {
      problems.push(`${url} names two architectures`)
      continue
    }
    byArch[arch].push(url)
    if (assetNames !== null && assetNames !== undefined && !assetNames.includes(url)) {
      problems.push(`${url} is listed in the feed but is not an asset on the release`)
    }
  }

  for (const arch of ['arm64', 'x64']) {
    const names = byArch[arch]
    const zips = names.filter((name) => name.endsWith('.zip'))
    const dmgs = names.filter((name) => name.endsWith('.dmg'))
    if (names.length === 0) {
      problems.push(
        `the feed describes no ${arch} build at all -- every ${arch} Mac would be offered the wrong architecture`
      )
      continue
    }
    // The zip is the file the updater actually downloads (MacUpdater:
    // `findFile(files, "zip", ["pkg", "dmg"])`), so exactly one per arch.
    if (zips.length !== 1) {
      problems.push(
        `the feed has ${zips.length} ${arch} zips, expected exactly 1: ${zips.join(', ') || '(none)'}`
      )
    }
    if (dmgs.length === 0) {
      problems.push(`the feed has no ${arch} dmg`)
    }
  }
  return problems
}

// --- README download links --------------------------------------------------

/**
 * The README's install section links directly at release assets, pinned to a
 * version. Those links are as capable of going quietly wrong as the update
 * feed is -- a dead front-page download is the same class of failure -- and
 * the release run is the one moment that knows what the real asset names are.
 *
 * Checked by name against the release's own asset list rather than by fetching
 * the URLs: while the release is still a draft (it is, until Elling un-drafts
 * it) the public /releases/download/<tag>/<asset> URL 404s for everyone, so a
 * curl here would fail on a perfectly good link.
 */
export function verifyReadmeDownloadLinks(markdown, { tag, version, assetNames }) {
  const problems = []
  const linkPattern =
    /\[([^\]]*)\]\((https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/download\/([^/]+)\/([^)]+))\)/g
  const links = [...markdown.matchAll(linkPattern)].map((match) => ({
    text: match[1].replace(/\*\*/g, '').trim(),
    tag: match[3],
    asset: match[4]
  }))

  if (links.length === 0) {
    problems.push('the README has no release download links at all')
  }
  for (const link of links) {
    if (link.tag !== tag) {
      problems.push(`the README still links at ${link.tag}/${link.asset}; this release is ${tag}`)
      continue
    }
    if (!assetNames.includes(link.asset)) {
      problems.push(`the README links at ${link.asset}, which this release does not have`)
    }
    if (/\.(dmg|zip)$/.test(link.text) && link.text !== link.asset) {
      problems.push(`the README's link text says ${link.text} but the link goes to ${link.asset}`)
    }
  }

  const linkedArches = new Set(
    links
      .filter((link) => link.tag === tag && link.asset.endsWith('.dmg'))
      .map((link) => archOfArtifact(link.asset))
  )
  for (const arch of ['arm64', 'x64']) {
    if (!linkedArches.has(arch)) {
      problems.push(`the README offers no ${arch} dmg download for ${tag}`)
    }
  }
  if (version !== undefined && !markdown.includes(`**${version}**`)) {
    problems.push(`the README does not name ${version} as the latest version`)
  }
  return problems
}

// --- cli --------------------------------------------------------------------

function flag(argv, name) {
  const at = argv.indexOf(name)
  return at === -1 ? undefined : argv[at + 1]
}

function fail(headline, problems) {
  console.error(`\n${headline}\n`)
  for (const problem of problems) console.error(`  - ${problem}`)
  console.error('')
  process.exit(1)
}

function readAssetNames(path) {
  if (path === undefined) return null
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
}

function main(argv) {
  const [mode, ...rest] = argv
  if (mode === 'merge') {
    const out = flag(rest, '--out')
    const inputs = rest.filter((arg, index) => !arg.startsWith('--') && rest[index - 1] !== '--out')
    if (out === undefined || inputs.length < 2) {
      throw new Error('usage: merge <feed.yml> <feed.yml> [...] --out <merged.yml>')
    }
    const merged = mergeMacUpdateFeeds(
      inputs.map((path) => parseUpdateFeed(readFileSync(path, 'utf8')))
    )
    const text = serializeUpdateFeed(merged)
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, text)
    console.log(`merged ${inputs.length} feeds into ${out}:`)
    console.log(text)
    return
  }
  if (mode === 'verify') {
    const [path] = rest
    const feed = parseUpdateFeed(readFileSync(path, 'utf8'))
    const problems = verifyUpdateFeed(feed, {
      expectedVersion: flag(rest, '--expect-version'),
      assetNames: readAssetNames(flag(rest, '--assets'))
    })
    if (problems.length > 0) fail(`the update feed at ${path} is NOT safe to publish:`, problems)
    console.log(`${path} describes both architectures and every file it names exists:`)
    for (const name of feedFileNames(feed)) console.log(`  - ${name} (${archOfArtifact(name)})`)
    return
  }
  if (mode === 'verify-readme') {
    const [path] = rest
    const problems = verifyReadmeDownloadLinks(readFileSync(path, 'utf8'), {
      tag: flag(rest, '--expect-tag'),
      version: flag(rest, '--expect-version'),
      assetNames: readAssetNames(flag(rest, '--assets')) ?? []
    })
    if (problems.length > 0) fail(`${path}'s download links do not match this release:`, problems)
    console.log(`${path} points at this release's real assets, for both architectures`)
    return
  }
  throw new Error(`unknown mode ${JSON.stringify(mode)} -- expected merge, verify or verify-readme`)
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2))
}
