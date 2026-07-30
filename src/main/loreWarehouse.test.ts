import { describe, expect, it, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { warehouseAvailable, resolveStemPath, setWarehouseRootForTests } from './loreWarehouse'

function createFixtureWarehouse(root: string): void {
  mkdirSync(join(root, 'cache', 'common'), { recursive: true })
  const db = new Database(join(root, 'cache', 'common', 'warehouse.db3'))
  db.exec(`
    CREATE TABLE "Jams" ("JamCID" TEXT NOT NULL UNIQUE, "PublicName" TEXT NOT NULL, PRIMARY KEY("JamCID"));
    CREATE TABLE "Riffs" (
      "RiffCID" TEXT NOT NULL UNIQUE, "OwnerJamCID" TEXT NOT NULL, "CreationTime" INTEGER,
      "BPMrnd" REAL, "BarLength" INTEGER, "UserName" TEXT,
      "StemCID_1" TEXT, "StemCID_2" TEXT, "StemCID_3" TEXT, "StemCID_4" TEXT,
      "StemCID_5" TEXT, "StemCID_6" TEXT, "StemCID_7" TEXT, "StemCID_8" TEXT,
      "GainsJSON" TEXT, PRIMARY KEY("RiffCID")
    );
    CREATE TABLE "Stems" (
      "StemCID" TEXT NOT NULL UNIQUE, "OwnerJamCID" TEXT NOT NULL, "CreatorUserName" TEXT,
      "PresetName" TEXT, "Instrument" INTEGER, "BPMrnd" REAL, "BarLength" REAL, PRIMARY KEY("StemCID")
    );
  `)
  db.close()
}

describe('loreWarehouse', () => {
  let root: string

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
  })

  it('warehouseAvailable() is false when the root directory does not exist', () => {
    setWarehouseRootForTests('/no/such/path/at/all')
    expect(warehouseAvailable()).toBe(false)
  })

  it('warehouseAvailable() is true when a real warehouse.db3 exists at the expected path', () => {
    root = mkdtempSync(join(tmpdir(), 'ssstitch-lore-test-'))
    createFixtureWarehouse(root)
    setWarehouseRootForTests(root)
    expect(warehouseAvailable()).toBe(true)
  })

  it('resolveStemPath shards by the first hex character of the StemCID', () => {
    setWarehouseRootForTests('/Volumes/Elling-Lien/ENDLESSS')
    const path = resolveStemPath('bandABC123', 'dc857530d08e11ecb5304f35d712ecc6')
    expect(path).toBe(
      '/Volumes/Elling-Lien/ENDLESSS/cache/common/stem_v2/bandABC123/d/dc857530d08e11ecb5304f35d712ecc6'
    )
  })
})
