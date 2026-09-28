import { describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { bumpTableWriteVersion, getTableWriteVersion } from './tableWriteVersion'

// No database is opened here on purpose: this module only ever uses the
// Database object as a WeakMap key, never as a connection. Keeping the
// real addon out means this file does NOT have to join
// vitest.config.ts's CI exclusion list (see its own doc comment for why
// every better-sqlite3-touching test file is excluded there).
function fakeDb(): Database.Database {
  return {} as Database.Database
}

describe('tableWriteVersion', () => {
  it('starts at zero for a db it has never seen', () => {
    expect(getTableWriteVersion(fakeDb(), 'Jams')).toBe(0)
  })

  it('counts writes per table, not per connection', () => {
    const db = fakeDb()
    bumpTableWriteVersion(db, 'Jams')
    bumpTableWriteVersion(db, 'Jams')
    bumpTableWriteVersion(db, 'Riffs')
    expect(getTableWriteVersion(db, 'Jams')).toBe(2)
    expect(getTableWriteVersion(db, 'Riffs')).toBe(1)
    // The whole point of this module: a write to one table must leave
    // every other table's version alone. `total_changes()` -- what this
    // replaces -- could not do that, because it counts every row the
    // CONNECTION has ever modified, across all tables.
    expect(getTableWriteVersion(db, 'Stems')).toBe(0)
  })

  it('counts writes per db, not globally', () => {
    const a = fakeDb()
    const b = fakeDb()
    bumpTableWriteVersion(a, 'Jams')
    expect(getTableWriteVersion(a, 'Jams')).toBe(1)
    expect(getTableWriteVersion(b, 'Jams')).toBe(0)
  })
})
