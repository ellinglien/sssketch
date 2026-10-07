import { describe, expect, it } from 'vitest'
import {
  ownUsernameAfterReport,
  ownUsernameReportFrom,
  parseOwnUsernameReport,
  resolveOwnUsername
} from './ownUsernameReport'

describe('resolveOwnUsername (the one rule for "me")', () => {
  it('nothing typed and no login: nobody', () => {
    expect(resolveOwnUsername(null, null)).toBe('')
    expect(resolveOwnUsername(null, '   ')).toBe('')
  })

  it("nothing typed: the Endlesss login's username, trimmed", () => {
    expect(resolveOwnUsername(null, ' elling ')).toBe('elling')
  })

  it('a typed name wins over the login, trimmed', () => {
    expect(resolveOwnUsername(' someone ', 'elling')).toBe('someone')
    expect(resolveOwnUsername('someone', null)).toBe('someone')
  })

  it('a typed empty name is a deliberate "nobody", even when logged in', () => {
    expect(resolveOwnUsername('', 'elling')).toBe('')
    expect(resolveOwnUsername('  ', null)).toBe('')
  })

  it('an email (typed, or the login name of an email login) is never "me"', () => {
    expect(resolveOwnUsername(null, 'someone@example.org')).toBe('')
    expect(resolveOwnUsername('someone@example.org', 'elling')).toBe('')
  })

  it('lowercases: Endlesss stores every username lowercase', () => {
    expect(resolveOwnUsername('Elling', null)).toBe('elling')
    expect(resolveOwnUsername(null, 'ELLING')).toBe('elling')
  })

  it('never invents a default identity', () => {
    for (const typed of [null, '', ' ']) {
      for (const session of [null, '', ' ']) {
        expect(resolveOwnUsername(typed, session)).toBe('')
      }
    }
  })

  it('agrees with what the renderer reports to main whenever the session is known', () => {
    const typedCases = [null, '', ' elling ', 'someone']
    const authCases = [{ loggedIn: false }, { loggedIn: true, username: 'elling' }]
    for (const typed of typedCases) {
      for (const auth of authCases) {
        const me = resolveOwnUsername(typed, auth.loggedIn ? (auth.username ?? null) : null)
        const report = ownUsernameReportFrom(typed, auth, true)
        expect(report).toEqual(me === '' ? { kind: 'none' } : { kind: 'name', name: me })
      }
    }
  })
})

describe('parseOwnUsernameReport normalises', () => {
  it('lowercases a name, and an email is not one', () => {
    expect(parseOwnUsernameReport({ kind: 'name', name: ' Elling ' })).toEqual({
      kind: 'name',
      name: 'elling'
    })
    expect(parseOwnUsernameReport({ kind: 'name', name: 'someone@example.org' })).toEqual({
      kind: 'unknown'
    })
  })
})

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
