import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { sqrtGain } from '../src/shared/mixGain'

interface StemRecord {
  slot: number
  path: string
  phaseSourcePath?: string
  phaseBars?: number
}

interface RifffRecord {
  groupId: string
  name: string
  startBar?: number
  barLength: number
  stems: StemRecord[]
}

interface ProjectRecord {
  rifffs: Record<string, RifffRecord>
  vol: Record<string, number>
  off: Record<string, number>
  stretch: Record<string, boolean>
  channelOrder: string[]
  channelOf: Record<string, string>
  sel: string | null
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

const [, , sourceArg, destinationArg, databaseArg] = process.argv
if (!sourceArg || !destinationArg || !databaseArg) {
  fail(
    'usage: createProvenanceVerificationProject <recovered.sssketchproj> <new-project-folder> <warehouse.db3>'
  )
}

const sourcePath = resolve(sourceArg)
const destinationDir = resolve(destinationArg)
const databasePath = resolve(databaseArg)
if (!existsSync(sourcePath)) fail(`source project does not exist: ${sourcePath}`)
if (!existsSync(databasePath)) fail(`warehouse does not exist: ${databasePath}`)
if (existsSync(destinationDir)) fail(`destination already exists: ${destinationDir}`)

const sourceBytes = readFileSync(sourcePath)
const project = JSON.parse(sourceBytes.toString('utf8')) as ProjectRecord
const controls = Object.values(project.rifffs)
  .filter(
    (rifff) =>
      / [0-9a-f]{8} library$/i.test(rifff.name) &&
      rifff.stems.length > 0 &&
      rifff.stems.every((stem) => stem.phaseSourcePath && existsSync(stem.phaseSourcePath))
  )
  .sort((a, b) => (a.startBar ?? 0) - (b.startBar ?? 0))
if (controls.length === 0) fail('no placed library riffs with complete provenance were found')

const db = new Database(databasePath, { readonly: true, fileMustExist: true })
const lookup = db.prepare(
  `SELECT RiffCID, GainsJSON
     FROM Riffs
    WHERE RiffCID LIKE ?
    ORDER BY CreationTime DESC
    LIMIT 2`
)

const rifffs: Record<string, RifffRecord> = {}
const vol: Record<string, number> = {}
const off: Record<string, number> = {}
const stretch: Record<string, boolean> = {}
const provenance: Array<{ groupId: string; riffCID: string; name: string }> = []

for (const [index, control] of controls.entries()) {
  const prefix = control.name.match(/ ([0-9a-f]{8}) library$/i)?.[1]
  if (!prefix) fail(`could not read riff CID prefix from ${control.name}`)
  const matches = lookup.all(`${prefix}%`) as RiffRow[]
  if (matches.length !== 1) fail(`riff CID prefix ${prefix} matched ${matches.length} rows`)
  const row = matches[0]
  const gains = row.GainsJSON ? (JSON.parse(row.GainsJSON) as Record<string, number>) : {}
  const headroom = sqrtGain(control.stems.length)
  const stems = control.stems.map((stem) => {
    const source = stem.phaseSourcePath
    if (!source) fail(`missing provenance source for ${control.name}, slot ${stem.slot}`)
    vol[`${control.groupId}:${stem.slot}`] = headroom * (gains[String(stem.slot)] ?? 1)
    const clean = { ...stem, path: source }
    delete clean.phaseSourcePath
    delete clean.phaseBars
    return clean
  })
  rifffs[control.groupId] = { ...control, startBar: index * control.barLength, stems }
  off[control.groupId] = 0
  stretch[control.groupId] = true
  provenance.push({ groupId: control.groupId, riffCID: row.RiffCID, name: control.name })
}
db.close()

project.rifffs = rifffs
project.vol = vol
project.off = off
project.stretch = stretch
project.channelOrder = controls.map((riff) => riff.groupId)
project.channelOf = Object.fromEntries(controls.map((riff) => [riff.groupId, riff.groupId]))
project.sel = controls[0].groupId
delete project.sound

const buildingDir = join(dirname(destinationDir), `.${basename(destinationDir)}.building-${randomUUID()}`)
try {
  mkdirSync(buildingDir, { recursive: true })
  const destinationProjectPath = join(destinationDir, `${basename(destinationDir)}.sssketchproj`)
  writeFileSync(
    join(buildingDir, `${basename(destinationDir)}.sssketchproj`),
    `${JSON.stringify(project, null, 2)}\n`
  )
  writeFileSync(
    join(buildingDir, 'provenance-verification-report.json'),
    `${JSON.stringify(
      {
        createdAt: new Date().toString(),
        sourceProjectPath: sourcePath,
        sourceProjectSha256: createHash('sha256').update(sourceBytes).digest('hex'),
        recoveredProjectPath: destinationProjectPath,
        purpose:
          'Dry timing control: original jam stem files, original riff gains with shared preview headroom, and no Discover sound processing.',
        provenance
      },
      null,
      2
    )}\n`
  )
  renameSync(buildingDir, destinationDir)
  process.stdout.write(`${JSON.stringify({ destinationProjectPath, controls: controls.length })}\n`)
} catch (error) {
  rmSync(buildingDir, { recursive: true, force: true })
  throw error
}
