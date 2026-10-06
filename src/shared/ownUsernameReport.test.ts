import { describe, expect, it } from 'vitest'
import {
  ownUsernameAfterReport,
  ownUsernameReportFrom,
  parseOwnUsernameReport
} from './ownUsernameReport'

describe('ownUsernameReportFrom (what the renderer can say about "me")', () => {
  it('a typed username wins, trimmed, whatever the session says', () => {
    expect(ownUsernameReportFrom('  elling ', 'failed', false)).toEqual({
      kind: 'name',
      name: 'elling'
    })
    expect(ownUsernameReportFrom('elling', { loggedIn: false }, true)).toEqual({
      kind: 'name',
      name: 'elling'
    })
  })

  it('a typed empty username is a deliberate "nobody"', () => {
    expect(ownUsernameReportFrom('', { loggedIn: true, username: 'x' }, false)).toEqual({
      kind: 'none'
    })
    expect(ownUsernameReportFrom('   ', 'failed', false)).toEqual({ kind: 'none' })
  })

  it("nothing typed: the Endlesss session's username", () => {
    expect(ownUsernameReportFrom(null, { loggedIn: true, username: ' elling ' }, false)).toEqual({
      kind: 'name',
      name: 'elling'
    })
  })

  it('a session lookup that failed says nothing', () => {
    expect(ownUsernameReportFrom(null, 'failed', false)).toEqual({ kind: 'unknown' })
    expect(ownUsernameReportFrom(null, 'failed', true)).toEqual({ kind: 'unknown' })
  })

  it('no session: nobody only right after a logout, otherwise unknown', () => {
    expect(ownUsernameReportFrom(null, { loggedIn: false }, true)).toEqual({ kind: 'none' })
    expect(ownUsernameReportFrom(null, { loggedIn: false }, false)).toEqual({ kind: 'unknown' })
    expect(ownUsernameReportFrom(null, { loggedIn: true, username: '' }, false)).toEqual({
      kind: 'unknown'
    })
  })
})

describe('ownUsernameAfterReport', () => {
  it('a name replaces, none clears, unknown keeps', () => {
    expect(ownUsernameAfterReport('elling', { kind: 'name', name: 'other' })).toBe('other')
    expect(ownUsernameAfterReport(null, { kind: 'name', name: 'elling' })).toBe('elling')
    expect(ownUsernameAfterReport('elling', { kind: 'none' })).toBeNull()
    expect(ownUsernameAfterReport('elling', { kind: 'unknown' })).toBe('elling')
    expect(ownUsernameAfterReport(null, { kind: 'unknown' })).toBeNull()
  })
})

describe('parseOwnUsernameReport (the IPC boundary)', () => {
  it('passes the three shapes through, trimming a name', () => {
    expect(parseOwnUsernameReport({ kind: 'name', name: ' elling ' })).toEqual({
      kind: 'name',
      name: 'elling'
    })
    expect(parseOwnUsernameReport({ kind: 'none' })).toEqual({ kind: 'none' })
    expect(parseOwnUsernameReport({ kind: 'unknown' })).toEqual({ kind: 'unknown' })
  })

  it('anything else (an old bare string or null, a blank name, junk) is unknown: it clears nothing', () => {
    expect(parseOwnUsernameReport(null)).toEqual({ kind: 'unknown' })
    expect(parseOwnUsernameReport('elling')).toEqual({ kind: 'unknown' })
    expect(parseOwnUsernameReport({ kind: 'name', name: '  ' })).toEqual({ kind: 'unknown' })
    expect(parseOwnUsernameReport({ kind: 'name', name: 42 })).toEqual({ kind: 'unknown' })
    expect(parseOwnUsernameReport({ kind: 'clear' })).toEqual({ kind: 'unknown' })
    expect(parseOwnUsernameReport(undefined)).toEqual({ kind: 'unknown' })
  })
})
