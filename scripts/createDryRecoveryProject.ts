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
import Database from 'better-sqlite3'
import { sqrtGain } from '../src/shared/mixGain'

interface StemRecord {
  slot: number
  path: string
}

interface RifffRecord {
  groupId: string
  name: string
  stems: StemRecord[]
}

interface ProjectRecord {
  rifffs: Record<string, RifffRecord>
  vol: Record<string, number>
  sound?: unknown
  [key: string]: unknown
}

interface RiffRow {
  RiffCID: string
  GainsJSON: string | null
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

const [, , sourceArg, destinationArg, databaseArg] = process.argv
if (!sourceArg || !destinationArg || !databaseArg) {
  fail(
    'usage: createDryRecoveryProject <recovered.sssketchproj> <new-project-folder> <warehouse.db3>'
  )
}

const sourcePath = resolve(sourceArg)
const sourceDir = dirname(sourcePath)
const destinationDir = resolve(destinationArg)
const databasePath = resolve(databaseArg)
if (!existsSync(sourcePath)) fail(`source project does not exist: ${sourcePath}`)
if (!existsSync(databasePath)) fail(`warehouse does not exist: ${databasePath}`)
if (existsSync(destinationDir)) fail(`destination already exists: ${destinationDir}`)

const sourceBytes = readFileSync(sourcePath)
const project = JSON.parse(sourceBytes.toString('utf8')) as ProjectRecord
const db = new Database(databasePath, { readonly: true, fileMustExist: true })
const lookup = db.prepare(
  `SELECT RiffCID, GainsJSON
     FROM Riffs
    WHERE RiffCID LIKE ?
    ORDER BY CreationTime DESC
    LIMIT 2`
)

let correctedLibraryRiffs = 0
for (const rifff of Object.values(project.rifffs)) {
  const prefix = rifff.name.match(/ ([0-9a-f]{8}) library$/i)?.[1]
  if (!prefix) continue
  const rows = lookup.all(`${prefix}%`) as RiffRow[]
  if (rows.length !== 1) fail(`riff CID prefix ${prefix} matched ${rows.length} rows`)
  const gains = rows[0].GainsJSON
    ? (JSON.parse(rows[0].GainsJSON as string) as Record<string, number>)
    : {}
  const headroom = sqrtGain(rifff.stems.length)
  for (const stem of rifff.stems) {
    project.vol[`${rifff.groupId}:${stem.slot}`] = headroom * (gains[String(stem.slot)] ?? 1)
  }
  correctedLibraryRiffs += 1
}
db.close()

// The clean provenance audition established that the source timing is good.
// An absent sound block is the engine's dry path, so recovery starts from the
// original mix rather than globally applying Discover's room/pump/panning.
delete project.sound

const buildingDir = join(dirname(destinationDir), `.${basename(destinationDir)}.building-${randomUUID()}`)
const buildingAudioDir = join(buildingDir, 'Recovered Audio')
const finalAudioDir = join(destinationDir, 'Recovered Audio')
const copied = new Map<string, string>()

try {
  mkdirSync(buildingAudioDir, { recursive: true })
  for (const rifff of Object.values(project.rifffs)) {
    for (const stem of rifff.stems) {
      if (!stem.path.startsWith(`${sourceDir}/Recovered Audio/`)) continue
      let destination = copied.get(stem.path)
      if (!destination) {
        if (!existsSync(stem.path)) fail(`recovered asset is missing: ${stem.path}`)
        const filename = basename(stem.path)
        destination = join(finalAudioDir, filename)
        cloneOrCopy(stem.path, join(buildingAudioDir, filename))
        copied.set(stem.path, destination)
      }
      stem.path = destination
    }
  }

  const destinationProjectPath = join(destinationDir, `${basename(destinationDir)}.sssketchproj`)
  writeFileSync(
    join(buildingDir, `${basename(destinationDir)}.sssketchproj`),
    `${JSON.stringify(project, null, 2)}\n`
  )
  writeFileSync(
    join(buildingDir, 'dry-recovery-report.json'),
    `${JSON.stringify(
      {
        createdAt: new Date().toString(),
        sourceProjectPath: sourcePath,
        sourceProjectSha256: createHash('sha256').update(sourceBytes).digest('hex'),
        recoveredProjectPath: destinationProjectPath,
        correctedLibraryRiffs,
        copiedRecoveredAssets: copied.size,
        discoverSoundProcessingRemoved: true
      },
      null,
      2
    )}\n`
  )
  renameSync(buildingDir, destinationDir)
  process.stdout.write(
    `${JSON.stringify({ destinationProjectPath, correctedLibraryRiffs, copiedRecoveredAssets: copied.size })}\n`
  )
} catch (error) {
  rmSync(buildingDir, { recursive: true, force: true })
  throw error
}
