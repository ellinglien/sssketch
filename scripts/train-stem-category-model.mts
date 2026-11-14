// scripts/train-stem-category-model.mts
//
// Trains src/shared/stemCategoryModel.json from a COPY of a riff library db
// (docs/superpowers/specs/2026-11-14-four-categories-design.md, "One model"):
//
//   sqlite3 ~/Music/sssketch/library/cache/common/warehouse.db3 ".backup /tmp/x/warehouse.db3"
//   node --experimental-strip-types scripts/train-stem-category-model.mts --db /tmp/x/warehouse.db3 \
//     [--stems-db /tmp/x/lore.db3]   (a COPY of a LORE archive's warehouse.db3, for its stems' jams)
//
// Prints a cross-validated report (folds grouped by jam) and writes the weights only if they
// clear FLOOR. --dry-run reports without writing. Weights are numbers; no names leave the db.
import Database from 'better-sqlite3'
import { writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  crossValidate,
  fitStemCategoryModel,
  meetsFloor,
  type TrainingSample
} from '../src/shared/stemCategoryTraining.ts'

const ROLE_CATEGORY: Record<string, TrainingSample['category']> = {
  drums: 'drums',
  fill: 'drums',
  bass: 'bass',
  backing: 'back',
  aux: 'back',
  textureFx: 'back',
  lead: 'front',
  vocal: 'front'
}

const args = process.argv.slice(2)
const arg = (name: string): string | undefined => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const dbPath = arg('--db')
if (!dbPath) throw new Error('--db <path to a COPY of warehouse.db3> is required')
const here = dirname(fileURLToPath(import.meta.url))
const outPath = arg('--out') ?? resolve(here, '../src/shared/stemCategoryModel.json')
// Chosen 2026-11-14 on the owner's library (25 jams): grouped front/back 0.62, every floor cleared.
const l2 = Number(arg('--l2') ?? 0.003)
const iterations = Number(arg('--iterations') ?? 1000)
const dryRun = args.includes('--dry-run')

// A LORE archive's stems have their Stems row (and so their jam) only in the archive's db:
// without it each such stem is its own fold group, and its jam-mates leak across folds.
const stemsDbPath = arg('--stems-db')

const db = new Database(dbPath, { readonly: true, fileMustExist: true })
if (stemsDbPath) db.prepare(`ATTACH DATABASE ? AS lore`).run(stemsDbPath)
type Row = {
  StemCID: string
  Role: string
  EmbeddingJSON: string
  Jam: string | null
  Source: string
}
const rows = db
  .prepare(
    `SELECT c.StemCID, COALESCE(c.ArrangeRole, c.BusId) AS Role, e.EmbeddingJSON,
            ${stemsDbPath ? 'COALESCE(s.OwnerJamCID, ls.OwnerJamCID)' : 's.OwnerJamCID'} AS Jam,
            c.Source
     FROM StemCategories c
     JOIN StemEmbeddingCache e ON e.StemCID = c.StemCID
     LEFT JOIN Stems s ON s.StemCID = c.StemCID
     ${stemsDbPath ? 'LEFT JOIN lore.Stems ls ON ls.StemCID = c.StemCID' : ''}
     WHERE COALESCE(c.ArrangeRole, c.BusId) IS NOT NULL`
  )
  .all() as Row[]

const toSample = (r: Row): TrainingSample | null => {
  const category = ROLE_CATEGORY[r.Role]
  if (!category) return null
  const embedding = JSON.parse(r.EmbeddingJSON) as number[]
  if (embedding.length !== 1024 || !embedding.every(Number.isFinite)) return null
  // A stem with no Stems row in either db is its own group.
  return { embedding, category, group: r.Jam ?? r.StemCID }
}

const human = rows
  .filter((r) => r.Source !== 'instrumentMask')
  .map(toSample)
  .filter((s) => s !== null)
const count = (c: string): number => human.filter((s) => s.category === c).length
// Endlesss-tagged drums/bass top those classes up to the larger of back/front, never more:
// thousands of tagged rows against a hundred back/front stems was the old guesser's bug.
const target = Math.max(count('back'), count('front'))
const tagged = rows
  .filter((r) => r.Source === 'instrumentMask')
  .map(toSample)
  .filter((s) => s !== null)
const extra: TrainingSample[] = []
for (const category of ['drums', 'bass'] as const) {
  const need = Math.max(0, target - count(category))
  const pool = tagged.filter((s) => s.category === category)
  // Deterministic sample: every k-th row.
  const step = Math.max(1, Math.floor(pool.length / Math.max(1, need)))
  for (
    let i = 0;
    i < pool.length && extra.filter((s) => s.category === category).length < need;
    i += step
  )
    extra.push(pool[i])
}
const samples = [...human, ...extra]
console.log(
  `samples: ${samples.length} (human ${human.length}: drums ${count('drums')}, bass ${count('bass')}, ` +
    `back ${count('back')}, front ${count('front')}; tagged extra ${extra.length})`
)

const report = crossValidate(samples, { folds: 5, l2, iterations })
console.log(JSON.stringify(report, null, 2))
const verdict = meetsFloor(report)
if (!verdict.ok) {
  console.error(`refusing to write weights: ${verdict.reasons.join('; ')}`)
  process.exit(1)
}
if (dryRun) process.exit(0)
const model = fitStemCategoryModel(samples, { version: Date.now(), l2, iterations })
const round = (v: number): number => Math.round(v * 1e5) / 1e5
writeFileSync(
  outPath,
  JSON.stringify({
    ...model,
    mean: model.mean.map(round),
    scale: model.scale.map(round),
    weights: model.weights.map((row) => row.map(round)),
    bias: model.bias.map(round),
    report: { ...report, trainedAt: new Date().toISOString(), samples: samples.length }
  }) + '\n'
)
console.log(`wrote ${outPath}`)
