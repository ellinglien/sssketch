import { createHash, randomUUID } from 'node:crypto'
import {
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

interface StemRecord {
  slot: number
  path: string
  durationSec: number
  barLength: number
  phaseSourcePath?: string
  phaseBars?: number
}

interface RifffRecord {
  name?: string
  stems: StemRecord[]
}

interface ProjectRecord {
  off?: Record<string, number>
  rifffs: Record<string, RifffRecord>
}

function fail(message: string): never {
  throw new Error(message)
}

function cloneOrCopy(source: string, destination: string): void {
  try {
    copyFileSync(source, destination, constants.COPYFILE_FICLONE)
  } catch {
    copyFileSync(source, destination)
  }
}

function stableAssetName(source: string, discriminator: string, suffix: string): string {
  const digest = createHash('sha256')
    .update(source)
    .update('\0')
    .update(discriminator)
    .digest('hex')
    .slice(0, 16)
  return `${basename(source).replace(/\.baked\.wav$/i, '')}-${digest}${suffix}`
}

function usage(): never {
  fail(
    'usage: recoverLegacyPhaseProject <source.sssketchproj> <new-project-folder> <reference-phase-bars>'
  )
}

const [, , sourceArg, destinationArg, phaseArg] = process.argv
if (!sourceArg || !destinationArg || !phaseArg) usage()

const sourceProjectPath = resolve(sourceArg)
const destinationDir = resolve(destinationArg)
const phaseBars = Number(phaseArg)
if (!Number.isFinite(phaseBars) || phaseBars <= 0) fail('reference-phase-bars must be positive')
if (!existsSync(sourceProjectPath)) fail(`source project does not exist: ${sourceProjectPath}`)
if (existsSync(destinationDir)) fail(`destination already exists: ${destinationDir}`)

const sourceBytes = readFileSync(sourceProjectPath)
const sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex')
const project = JSON.parse(sourceBytes.toString('utf8')) as ProjectRecord
const nonzeroOffsets = Object.entries(project.off ?? {}).filter(([, value]) => value !== 0)
if (nonzeroOffsets.length > 0) {
  fail(
    `project has ${nonzeroOffsets.length} nonzero runtime offsets; refusing an ambiguous recovery`
  )
}

const parentDir = dirname(destinationDir)
const buildingDir = join(parentDir, `.${basename(destinationDir)}.building-${randomUUID()}`)
const finalAudioDir = join(destinationDir, 'Recovered Audio')
const buildingAudioDir = join(buildingDir, 'Recovered Audio')
const frozenLegacy = new Map<string, string>()
let rawDiscoverStemsLeftUntouched = 0

try {
  mkdirSync(buildingAudioDir, { recursive: true })

  for (const rifff of Object.values(project.rifffs)) {
    for (const stem of rifff.stems) {
      if (!stem.path.toLowerCase().endsWith('.baked.wav')) continue
      if (!existsSync(stem.path)) fail(`referenced legacy bake is missing: ${stem.path}`)
      const legacyPath = stem.path
      let recovered = frozenLegacy.get(legacyPath)
      if (!recovered) {
        const filename = stableAssetName(legacyPath, 'frozen-legacy', '.baked.wav')
        recovered = join(finalAudioDir, filename)
        cloneOrCopy(legacyPath, join(buildingAudioDir, filename))
        frozenLegacy.set(legacyPath, recovered)
      }
      stem.path = recovered
      const pristinePath = legacyPath.replace(/\.baked\.wav$/i, '')
      stem.phaseSourcePath = existsSync(pristinePath) ? pristinePath : legacyPath
      stem.phaseBars = phaseBars
    }
  }

  for (const rifff of Object.values(project.rifffs)) {
    const hasFrozenLegacy = rifff.stems.some((stem) => stem.path.startsWith(finalAudioDir))
    const rawStems = rifff.stems.filter((stem) => !stem.path.startsWith(finalAudioDir))
    if (!hasFrozenLegacy) continue
    // A Discover riff deliberately mixes already-corrected imported stems
    // with candidates whose own files already begin at their own musical
    // one. The original working project referenced those candidate files
    // directly. Rotating them by the imported riff's correction changes the
    // relative timing the user auditioned, so recovery freezes only legacy
    // baked assets and leaves these raw candidates byte-for-byte untouched.
    for (const stem of rawStems) {
      if (!existsSync(stem.path)) fail(`referenced raw stem is missing: ${stem.path}`)
      rawDiscoverStemsLeftUntouched += 1
    }
  }

  const destinationProjectPath = join(destinationDir, `${basename(destinationDir)}.sssketchproj`)
  const buildingProjectPath = join(buildingDir, `${basename(destinationDir)}.sssketchproj`)
  writeFileSync(buildingProjectPath, `${JSON.stringify(project, null, 2)}\n`)
  writeFileSync(
    join(buildingDir, 'phase-recovery-report.json'),
    `${JSON.stringify(
      {
        createdAt: new Date().toString(),
        sourceProjectPath,
        sourceProjectSha256: sourceSha256,
        recoveredProjectPath: destinationProjectPath,
        referencePhaseBars: phaseBars,
        frozenLegacyAssets: frozenLegacy.size,
        newRotatedAssets: 0,
        materializedStemReferences: [],
        rawDiscoverStemsLeftUntouched
      },
      null,
      2
    )}\n`
  )
  renameSync(buildingDir, destinationDir)
  process.stdout.write(
    `${JSON.stringify({
      destinationProjectPath,
      sourceSha256,
      frozenLegacyAssets: frozenLegacy.size,
      newRotatedAssets: 0,
      materializedStemReferences: 0,
      rawDiscoverStemsLeftUntouched
    })}\n`
  )
} catch (error) {
  rmSync(buildingDir, { recursive: true, force: true })
  throw error
}
