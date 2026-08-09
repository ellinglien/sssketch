import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let userDataDir: string

vi.mock('electron', () => ({
  app: {
    getPath: () => userDataDir
  }
}))

describe('loreWarehouseSchema', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'sssketch-warehouse-schema-test-'))
  })

  afterEach(async () => {
    const { closeOwnWarehouseDb } = await import('./loreWarehouseSchema')
    closeOwnWarehouseDb()
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it("ownWarehouseDbPath lives under cache/common, matching loreWarehouse.ts's own join convention", async () => {
    const { ownWarehouseDbPath } = await import('./loreWarehouseSchema')
    expect(ownWarehouseDbPath()).toBe(
      join(userDataDir, 'lore-warehouse', 'cache', 'common', 'warehouse.db3')
    )
  })

  it('openOwnWarehouseDb creates the db file and every expected table', async () => {
    const { openOwnWarehouseDb, ownWarehouseDbPath } = await import('./loreWarehouseSchema')
    const db = openOwnWarehouseDb()
    expect(existsSync(ownWarehouseDbPath())).toBe(true)
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
      .all() as { name: string }[]
    expect(tables.map((t) => t.name)).toEqual(['Jams', 'Riffs', 'StemLedger', 'Stems', 'Tags'])
  })

  it('opening twice returns the same cached connection, not a second one', async () => {
    const { openOwnWarehouseDb } = await import('./loreWarehouseSchema')
    const first = openOwnWarehouseDb()
    const second = openOwnWarehouseDb()
    expect(first).toBe(second)
  })

  it('closeOwnWarehouseDb followed by a re-open works (re-creates the schema idempotently)', async () => {
    const { openOwnWarehouseDb, closeOwnWarehouseDb } = await import('./loreWarehouseSchema')
    openOwnWarehouseDb()
    closeOwnWarehouseDb()
    expect(() => openOwnWarehouseDb()).not.toThrow()
  })
})
