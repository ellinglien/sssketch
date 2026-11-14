// scripts/train-stem-category-model.mts
//
// Trains src/shared/stemCategoryModel.json from a COPY of a riff library db
// (docs/superpowers/specs/2026-11-14-four-categories-design.md, "One model"):
//
//   sqlite3 ~/Music/sssketch/library/cache/common/warehouse.db3 ".backup /tmp/x/warehouse.db3"
//   node --experimental-strip-types scripts/train-stem-category-model.mts --db /tmp/x/warehouse.db3
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
const l2 = Number(arg('--l2') ?? 0.01)
const dryRun = args.includes('--dry-run')

const db = new Database(dbPath, { readonly: true, fileMustExist: true })
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
            s.OwnerJamCID AS Jam, c.Source
     FROM StemCategories c
     JOIN StemEmbeddingCache e ON e.StemCID = c.StemCID
     LEFT JOIN Stems s ON s.StemCID = c.StemCID
     WHERE COALESCE(c.ArrangeRole, c.BusId) IS NOT NULL`
  )
  .all() as Row[]

const toSample = (r: Row): TrainingSample | null => {
  const category = ROLE_CATEGORY[r.Role]
  if (!category) return null
  const embedding = JSON.parse(r.EmbeddingJSON) as number[]
  if (embedding.length !== 1024 || !embedding.every(Number.isFinite)) return null
  // shortcut: a stem with no Stems row here (LORE-only) is its own group; pass the archive's
  // Stems rows in if jam leakage ever matters.
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

const report = crossValidate(samples, { folds: 5, l2 })
console.log(JSON.stringify(report, null, 2))
const verdict = meetsFloor(report)
if (!verdict.ok) {
  console.error(`refusing to write weights: ${verdict.reasons.join('; ')}`)
  process.exit(1)
}
if (dryRun) process.exit(0)
const model = fitStemCategoryModel(samples, { version: Date.now(), l2 })
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
