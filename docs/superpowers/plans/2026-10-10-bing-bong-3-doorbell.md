# bing bong 3: the doorbell — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a player starts a bing bong or ends a turn, the other player's doorbell rings by
email. The email goes through the sender's own SMTP server (Gmail or iCloud app password, or
Elling and Ben's RPM SES user). With no server set up, or when sending fails, it falls back to a
ready-made draft in the sender's own mail app. A poke rings once, for plan 4.

**Spec:** `docs/superpowers/specs/2026-10-10-bing-bong-design.md`, "The doorbell". Plan 3 of 4;
plans 1 and 2 must be merged first.

**Architecture:**
- `src/shared/bingBongDoorbell.ts` holds the words: subject, text and html for a turn, the invite
  and a poke, the `mailto:` draft, and the SMTP presets.
- `src/main/bingBongMail.ts` holds the server settings (userData JSON) and the password, encrypted
  with `safeStorage` the way `radioHeartsKeyStore.ts` keeps its key. Neither ever goes to the
  renderer or a shared folder. Its `ringDoorbell` sends through nodemailer, or opens the draft
  with `shell.openExternal`.
- `src/main/bingBongRing.ts` decides who the doorbell rings and what it says. The address is the
  other player's `players/<them>.json` email, or the invite address until they join. The words
  are sssketchy's line about what changed (`describeTurn`) plus the chat line.
- IPC: `bingbong:start` and `bingbong:end-turn` ring after the turn is written, and return what
  the doorbell did. `bingbong:poke`, `bingbong:mail-status`, `bingbong:mail-save` and
  `bingbong:mail-test` are new.
- Renderer: a "doorbell email…" settings modal in the bing bong menu, and one line on the bar
  saying what the doorbell did.

**Changes from the spec:**
- The email has no sssketchy sprite: plain text plus a minimal html version.
- Turn 1 rings as the invite (it carries the join steps).

**New dependency:** `nodemailer@10.0.10` (MIT, no dependencies, ships its own types; released
2026-09-14). Main only; `externalizeDepsPlugin` leaves it to electron-builder, which packages
production dependencies.

**Tech stack:** TypeScript, vitest, React, Electron, nodemailer.

**Repo:** `/Users/nickel/Claudecode/sssketch`. **Branch:** `bing-bong-3-doorbell`, from plan 2's.

**Commits:** every commit message ends with exactly these two lines, after a blank line:

```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015GgVLoMfDYXWtBAGJo23dn
```

Commit each task's own files only (`git commit --only <paths>`).

## How this plan's code was checked

Every code block is a file or `git diff` from the same scratch copy as plans 1 and 2 (base
`ffc83fd1`, plans 1 and 2 applied), with nodemailer 10.0.10 installed beside it, after
`prettier --write`. The new tests pass, and `tsc` (web and node) and `eslint` pass on every
touched file. No email was actually sent: the SMTP path is only tested with a fake sender.
Task 8 is Elling's.

---

### Task 1: Add nodemailer

- [ ] **Step 1:** `npm install nodemailer@10.0.10`
- [ ] **Step 2:** `node -e "console.log(require('nodemailer/package.json').version)"` prints `10.0.10`.
- [ ] **Step 3: Commit** (`--only package.json package-lock.json`): `deps: nodemailer, for the bing bong doorbell`.

### Task 2: The doorbell's words

**Files:** Create `src/shared/bingBongDoorbell.ts`, `src/shared/bingBongDoorbell.test.ts`

- [ ] **Step 1: Write the failing tests.** Create `src/shared/bingBongDoorbell.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { doorbellMessage, mailtoUrl } from './bingBongDoorbell'

describe('doorbellMessage', () => {
  it('rings for a turn with the line and what changed', () => {
    const m = doorbellMessage({
      kind: 'turn',
      from: 'elling',
      name: 'elling-and-ben',
      turn: 7,
      summary: 'elling swapped your bass. kept your drums.',
      chat: 'wonky bass, sorry'
    })
    expect(m.subject).toBe('bing bong: elling played turn 7')
    expect(m.text).toBe(
      '“wonky bass, sorry”\nelling swapped your bass. kept your drums.\n\nopen sssketch to play your turn.\n'
    )
  })

  it('invites with the steps to join', () => {
    const m = doorbellMessage({ kind: 'invite', from: 'elling', name: 'elling-and-ben' })
    expect(m.subject).toBe('bing bong: elling started a bing bong with you')
    expect(m.text).toContain('bing bong → join a bing bong…')
    expect(m.text).toContain('“elling-and-ben”')
  })

  it('pokes', () => {
    expect(doorbellMessage({ kind: 'poke', from: 'ben', name: 'x' }).subject).toBe(
      'bing bong: ben is waiting on you'
    )
  })

  it('escapes the chat line in html', () => {
    const m = doorbellMessage({ kind: 'turn', from: 'b', name: 'n', turn: 2, chat: '<b>hi</b>' })
    expect(m.html).toContain('<p>“&lt;b&gt;hi&lt;/b&gt;”</p>')
  })
})

describe('mailtoUrl', () => {
  it('encodes the subject and body', () => {
    expect(mailtoUrl('ben@x.y', { subject: 'a b', text: 'c\nd', html: '' })).toBe(
      'mailto:ben@x.y?subject=a%20b&body=c%0Ad'
    )
  })
})
```

- [ ] **Step 2: Run to see them fail.** `npx vitest run src/shared/bingBongDoorbell.test.ts`, FAIL.

- [ ] **Step 3: Implement.** Create `src/shared/bingBongDoorbell.ts`:

```ts
// src/shared/bingBongDoorbell.ts -- the doorbell's words: the email a turn, an invite or a poke
// sends, and the mailto: draft used when no email server is set up. Pure. Spec:
// docs/superpowers/specs/2026-10-10-bing-bong-design.md ("The doorbell").

export type DoorbellKind = 'turn' | 'invite' | 'poke'

export interface DoorbellInput {
  kind: DoorbellKind
  /** The sender's name as shown. */
  from: string
  /** The bing bong's name (its folder's name). */
  name: string
  /** Turn number (kind 'turn'). */
  turn?: number
  /** sssketchy's line about the turn (@shared/bingBongDiff describeTurn). */
  summary?: string
  chat?: string
}

export interface DoorbellMessage {
  subject: string
  text: string
  html: string
}

/** SMTP presets the settings offer. Port 587 upgrades to TLS (STARTTLS), so `secure` is false. */
export const MAIL_PRESETS = {
  gmail: { label: 'gmail (app password)', host: 'smtp.gmail.com', port: 587, secure: false },
  icloud: {
    label: 'icloud (app-specific password)',
    host: 'smtp.mail.me.com',
    port: 587,
    secure: false
  }
} as const

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function lines(input: DoorbellInput): { subject: string; body: string[] } {
  const said = input.chat ? [`“${input.chat}”`] : []
  const summary = input.summary ? [input.summary] : []
  switch (input.kind) {
    case 'turn':
      return {
        subject: `bing bong: ${input.from} played turn ${input.turn ?? ''}`.trim(),
        body: [...said, ...summary, '', 'open sssketch to play your turn.']
      }
    case 'invite':
      return {
        subject: `bing bong: ${input.from} started a bing bong with you`,
        body: [
          ...summary,
          '',
          `1. ${input.from} shares a folder called “${input.name}” with you (google drive, dropbox…).`,
          '2. in google drive, add it to my drive so it syncs to your mac.',
          '3. in sssketch: bing bong → join a bing bong…, and pick that folder.'
        ]
      }
    case 'poke':
      return {
        subject: `bing bong: ${input.from} is waiting on you`,
        body: [`it's your turn in ${input.name}.`, '', 'open sssketch to play it.']
      }
  }
}

export function doorbellMessage(input: DoorbellInput): DoorbellMessage {
  const { subject, body } = lines(input)
  return {
    subject,
    text: `${body.join('\n')}\n`,
    html: body.map((line) => (line === '' ? '<br>' : `<p>${escapeHtml(line)}</p>`)).join('\n')
  }
}

/** A draft in the user's own mail app, for when no email server is set up. */
export function mailtoUrl(address: string, message: DoorbellMessage): string {
  const query = `subject=${encodeURIComponent(message.subject)}&body=${encodeURIComponent(message.text)}`
  // An address keeps its @ (some mail apps don't decode %40); anything unusual is encoded.
  const to = address.replace(/[^A-Za-z0-9@._+-]/g, (c) => encodeURIComponent(c))
  return `mailto:${to}?${query}`
}
```

- [ ] **Step 4: Run the tests.** PASS (5 tests); eslint clean.

- [ ] **Step 5: Commit** (`--only` both files): `bing bong: the doorbell's words`.

### Task 3: The email server, its password, and ringing

**Files:** Create `src/main/bingBongMail.ts`, `src/main/bingBongMail.test.ts`

- [ ] **Step 1: Write the failing tests.** Create `src/main/bingBongMail.test.ts`. The keychain
mock is `radioHeartsKeyStore.test.ts`'s:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let userDataDir: string
let encryptionAvailable = true

vi.mock('electron', () => ({
  app: { getPath: () => userDataDir },
  safeStorage: {
    isEncryptionAvailable: () => encryptionAvailable,
    encryptString: (s: string) => Buffer.from([...Buffer.from(s)].reverse()),
    decryptString: (b: Buffer) => Buffer.from([...b].reverse()).toString()
  }
}))

const SETTINGS = {
  host: 'email-smtp.us-east-1.amazonaws.com',
  port: 587,
  secure: false,
  user: 'AKIAEXAMPLE',
  from: 'bingbong@rpmchallenge.com'
}

const MESSAGE = { subject: 'bing bong: elling played turn 2', text: 'hi\n', html: '<p>hi</p>' }

beforeEach(async () => {
  userDataDir = mkdtempSync(join(tmpdir(), 'sssketch-bingbong-mail-test-'))
  encryptionAvailable = true
  const { resetMailPasswordForTests } = await import('./bingBongMail')
  resetMailPasswordForTests()
})

afterEach(() => {
  rmSync(userDataDir, { recursive: true, force: true })
})

describe('mail settings', () => {
  it('has none until saved, then reads them back', async () => {
    const { loadMailSettings, saveMailSettings, mailStatus } = await import('./bingBongMail')
    expect(loadMailSettings()).toBeNull()
    saveMailSettings(SETTINGS)
    expect(loadMailSettings()).toEqual(SETTINGS)
    expect(mailStatus()).toEqual({ settings: SETTINGS, hasPassword: false, passwordSaved: false })
  })

  it('refuses incomplete settings', async () => {
    const { saveMailSettings } = await import('./bingBongMail')
    expect(() => saveMailSettings({ ...SETTINGS, from: 'nope' })).toThrow()
  })

  it('keeps the password encrypted, never in plaintext', async () => {
    const { saveMailPassword, loadMailPassword, resetMailPasswordForTests, mailStatus } =
      await import('./bingBongMail')
    saveMailPassword('s3cret')
    const onDisk = readFileSync(join(userDataDir, 'bingbong-mail-password.enc')).toString()
    expect(onDisk).not.toContain('s3cret')
    resetMailPasswordForTests()
    expect(loadMailPassword()).toBe('s3cret')
    expect(mailStatus().passwordSaved).toBe(true)
  })

  it('keeps the password in memory only without a keychain', async () => {
    encryptionAvailable = false
    const { saveMailPassword, mailStatus } = await import('./bingBongMail')
    saveMailPassword('s3cret')
    expect(existsSync(join(userDataDir, 'bingbong-mail-password.enc'))).toBe(false)
    expect(mailStatus()).toMatchObject({ hasPassword: true, passwordSaved: false })
  })

  it('clearing the settings clears the password too', async () => {
    const { saveMailSettings, saveMailPassword, mailStatus } = await import('./bingBongMail')
    saveMailSettings(SETTINGS)
    saveMailPassword('s3cret')
    saveMailSettings(null)
    expect(mailStatus()).toEqual({ settings: null, hasPassword: false, passwordSaved: false })
  })
})

describe('ringDoorbell', () => {
  it('sends through the configured server', async () => {
    const { saveMailSettings, saveMailPassword, ringDoorbell } = await import('./bingBongMail')
    saveMailSettings(SETTINGS)
    saveMailPassword('s3cret')
    const send = vi.fn(async () => {})
    const openExternal = vi.fn(async () => {})
    expect(await ringDoorbell('ben@x.y', MESSAGE, { send, openExternal })).toEqual({ kind: 'sent' })
    expect(send).toHaveBeenCalledWith(SETTINGS, 's3cret', {
      from: 'bingbong@rpmchallenge.com',
      to: 'ben@x.y',
      ...MESSAGE
    })
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('drafts in the mail app when there is no server', async () => {
    const { ringDoorbell } = await import('./bingBongMail')
    const openExternal = vi.fn<(url: string) => Promise<void>>(async () => {})
    expect(await ringDoorbell('ben@x.y', MESSAGE, { send: vi.fn(), openExternal })).toEqual({
      kind: 'drafted'
    })
    expect(openExternal.mock.calls[0][0]).toMatch(/^mailto:ben@x\.y\?subject=bing%20bong/)
  })

  it('drafts, and says why, when sending fails', async () => {
    const { saveMailSettings, saveMailPassword, ringDoorbell } = await import('./bingBongMail')
    saveMailSettings(SETTINGS)
    saveMailPassword('s3cret')
    const send = vi.fn(async () => {
      throw new Error('535 Authentication Credentials Invalid')
    })
    const openExternal = vi.fn(async () => {})
    expect(await ringDoorbell('ben@x.y', MESSAGE, { send, openExternal })).toEqual({
      kind: 'drafted',
      error: '535 Authentication Credentials Invalid'
    })
    expect(openExternal).toHaveBeenCalledOnce()
  })

  it('has nobody to ring without an address', async () => {
    const { ringDoorbell } = await import('./bingBongMail')
    expect(
      await ringDoorbell(undefined, MESSAGE, { send: vi.fn(), openExternal: vi.fn() })
    ).toEqual({ kind: 'no-address' })
  })
})
```

- [ ] **Step 2: Run to see them fail.** FAIL.

- [ ] **Step 3: Implement.** Create `src/main/bingBongMail.ts`:

```ts
// src/main/bingBongMail.ts -- bing bong's doorbell: the sender's own email server, and ringing.
// Spec: docs/superpowers/specs/2026-10-10-bing-bong-design.md ("The doorbell").
//
// The server settings live in userData as JSON. The password is a secret, kept as
// radioHeartsKeyStore.ts keeps its key: encrypted with safeStorage (the macOS keychain), never in
// plaintext, never in a project or a shared folder, never sent to the renderer. Where encryption
// is unavailable it lives in memory for the session only.
//
// Ringing never blocks a turn: with no server set up, or when sending fails, the doorbell opens a
// draft in the user's own mail app instead.

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import { createTransport } from 'nodemailer'
import { mailtoUrl, type DoorbellMessage } from '@shared/bingBongDoorbell'

export interface MailSettings {
  host: string
  port: number
  /** true: TLS from the start (port 465). false: STARTTLS (port 587). */
  secure: boolean
  user: string
  /** The From address, e.g. bingbong@rpmchallenge.com. */
  from: string
}

export interface MailStatus {
  settings: MailSettings | null
  hasPassword: boolean
  /** False when the password is only in memory (no keychain): gone next launch. */
  passwordSaved: boolean
}

export type DoorbellOutcome =
  { kind: 'sent' } | { kind: 'drafted'; error?: string } | { kind: 'no-address' }

const SETTINGS_FILENAME = 'bingbong-mail.json'
const PASSWORD_FILENAME = 'bingbong-mail-password.enc'

function settingsPath(): string {
  return join(app.getPath('userData'), SETTINGS_FILENAME)
}

function passwordPath(): string {
  return join(app.getPath('userData'), PASSWORD_FILENAME)
}

function isMailSettings(value: unknown): value is MailSettings {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.host === 'string' &&
    v.host !== '' &&
    Number.isInteger(v.port) &&
    (v.port as number) > 0 &&
    (v.port as number) < 65536 &&
    typeof v.secure === 'boolean' &&
    typeof v.user === 'string' &&
    typeof v.from === 'string' &&
    v.from.includes('@')
  )
}

export function loadMailSettings(): MailSettings | null {
  if (!existsSync(settingsPath())) return null
  try {
    const parsed: unknown = JSON.parse(readFileSync(settingsPath(), 'utf-8'))
    return isMailSettings(parsed) ? parsed : null
  } catch (err) {
    console.error('bingBongMail: failed to read settings:', err)
    return null
  }
}

/** Saves the settings, or clears them (and the password) with null. Throws on bad settings. */
export function saveMailSettings(settings: MailSettings | null): void {
  if (settings === null) {
    rmSync(settingsPath(), { force: true })
    saveMailPassword(null)
    return
  }
  if (!isMailSettings(settings)) throw new Error('incomplete email settings')
  mkdirSync(app.getPath('userData'), { recursive: true })
  const temp = `${settingsPath()}.${process.pid}.tmp`
  writeFileSync(temp, JSON.stringify(settings))
  renameSync(temp, settingsPath())
}

let sessionPassword: string | null = null
let passwordPersisted = false
let passwordLoaded = false

export function loadMailPassword(): string | null {
  if (passwordLoaded) return sessionPassword
  passwordLoaded = true
  if (!safeStorage.isEncryptionAvailable() || !existsSync(passwordPath())) return sessionPassword
  try {
    const password = safeStorage.decryptString(readFileSync(passwordPath()))
    sessionPassword = password === '' ? null : password
    passwordPersisted = sessionPassword !== null
  } catch (err) {
    console.error('bingBongMail: failed to read the password:', err)
  }
  return sessionPassword
}

/** Sets the password, or clears it with null / an empty string. */
export function saveMailPassword(password: string | null): void {
  sessionPassword = password === null || password === '' ? null : password
  passwordPersisted = false
  passwordLoaded = true
  try {
    if (sessionPassword === null) {
      rmSync(passwordPath(), { force: true })
      return
    }
    if (!safeStorage.isEncryptionAvailable()) return
    mkdirSync(app.getPath('userData'), { recursive: true })
    writeFileSync(passwordPath(), safeStorage.encryptString(sessionPassword))
    passwordPersisted = true
  } catch (err) {
    console.error('bingBongMail: failed to write the password:', err)
  }
}

export function mailStatus(): MailStatus {
  const hasPassword = loadMailPassword() !== null
  return {
    settings: loadMailSettings(),
    hasPassword,
    passwordSaved: hasPassword && passwordPersisted
  }
}

export interface MailEnvelope {
  from: string
  to: string
  subject: string
  text: string
  html: string
}

export type SendMail = (
  settings: MailSettings,
  password: string,
  mail: MailEnvelope
) => Promise<void>

/** nodemailer over SMTP, with a short timeout so a dead server doesn't hang end turn. */
export const smtpSend: SendMail = async (settings, password, mail) => {
  const transport = createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    auth: { user: settings.user, pass: password },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 20_000
  })
  try {
    await transport.sendMail(mail)
  } finally {
    transport.close()
  }
}

export interface DoorbellDeps {
  send: SendMail
  openExternal: (url: string) => Promise<void>
}

/** Rings `address`: by email through the configured server, or as a draft in the user's own
 * mail app when there's no server or it fails. */
export async function ringDoorbell(
  address: string | undefined,
  message: DoorbellMessage,
  deps: DoorbellDeps
): Promise<DoorbellOutcome> {
  if (!address) return { kind: 'no-address' }
  const settings = loadMailSettings()
  const password = loadMailPassword()
  let error: string | undefined
  if (settings && password) {
    try {
      await deps.send(settings, password, { from: settings.from, to: address, ...message })
      return { kind: 'sent' }
    } catch (err) {
      console.error('bingBongMail: sending failed:', err)
      error = err instanceof Error ? err.message : String(err)
    }
  }
  try {
    await deps.openExternal(mailtoUrl(address, message))
  } catch (err) {
    console.error('bingBongMail: opening the draft failed:', err)
  }
  return error ? { kind: 'drafted', error } : { kind: 'drafted' }
}

/** Test-only: forget the in-memory password so the next load reads disk. */
export function resetMailPasswordForTests(): void {
  sessionPassword = null
  passwordPersisted = false
  passwordLoaded = false
}
```

- [ ] **Step 4: Run the tests.** PASS (9 tests); `npm run typecheck`; eslint clean.

- [ ] **Step 5: Commit** (`--only` both files): `bing bong: the doorbell's email server, its password, and ringing`.

### Task 4: Who it rings and what it says

**Files:** Create `src/main/bingBongRing.ts`, `src/main/bingBongRing.test.ts`

- [ ] **Step 1: Write the failing tests.** Create `src/main/bingBongRing.test.ts`:

```ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { Rifff } from '@shared/types'
import type { SendMail } from './bingBongMail'

let root: string

vi.mock('electron', () => ({
  app: { getPath: () => join(root, 'userData') },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString()
  }
}))

function riff(path: string, name: string): Rifff {
  return {
    groupId: 'g',
    name: 'g',
    bpm: 100,
    barLength: 4,
    folderPath: root,
    stems: [{ slot: 1, author: 'x', name, type: 'drums', path, durationSec: 9.6, barLength: 4 }]
  }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bing-bong-ring-test-'))
  mkdirSync(join(root, 'drive'))
  writeFileSync(join(root, 'drums.wav'), 'drums')
  writeFileSync(join(root, 'bass.wav'), 'bass')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

async function started(otherEmail?: string, meEmail?: string): Promise<string> {
  const { startBingBong } = await import('./bingBongActions')
  const r = await startBingBong({
    parentFolder: join(root, 'drive'),
    name: 'elling-and-ben',
    me: 'elling',
    other: 'ben',
    ...(otherEmail ? { otherEmail } : {}),
    ...(meEmail ? { meEmail } : {}),
    rifff: riff(join(root, 'drums.wav'), 'drums'),
    vol: {},
    mute: {}
  })
  if (!r.ok) throw new Error(r.error)
  return r.folder
}

function deps(): {
  send: Mock<SendMail>
  openExternal: Mock<(url: string) => Promise<void>>
} {
  return {
    send: vi.fn<SendMail>(),
    openExternal: vi.fn<(url: string) => Promise<void>>(async () => {})
  }
}

describe('ringForTurn', () => {
  it('turn 1 invites the other player at their invite address', async () => {
    const folder = await started('ben@x.y')
    const { readBingBong } = await import('./bingBongActions')
    const { ringForTurn } = await import('./bingBongRing')
    const read = readBingBong(folder)
    if (!read.ok) throw new Error(read.error)
    const d = deps()
    const outcome = await ringForTurn(folder, 'elling', read.snapshot.resolution.applied[0], d)
    expect(outcome).toEqual({ kind: 'drafted' })
    const url = decodeURIComponent(d.openExternal.mock.calls[0][0])
    expect(url).toContain('mailto:ben@x.y?subject=bing bong: elling started a bing bong with you')
    expect(url).toContain('elling started with drums.')
  })

  it('rings the other player, at the address they joined with once they have', async () => {
    const folder = await started('invite@x.y', 'elling@x.y')
    const { endTurn, joinBingBong } = await import('./bingBongActions')
    const { ringForTurn } = await import('./bingBongRing')
    joinBingBong(folder, 'ben', 'ben@joined.y')
    const t2 = await endTurn({
      folder,
      me: 'ben',
      rifff: riff(join(root, 'bass.wav'), 'bass'),
      vol: {},
      mute: {},
      chat: 'bass instead'
    })
    if (!t2.ok) throw new Error(t2.error)
    const d = deps()
    await ringForTurn(folder, 'ben', t2.turn, d)
    const toElling = decodeURIComponent(d.openExternal.mock.calls[0][0])
    expect(toElling).toContain('mailto:elling@x.y?subject=bing bong: ben played turn 2')
    expect(toElling).toContain('“bass instead”')
    expect(toElling).toContain('ben swapped your drums')

    const t3 = await endTurn({
      folder,
      me: 'elling',
      rifff: riff(join(root, 'drums.wav'), 'drums'),
      vol: {},
      mute: {},
      chat: ''
    })
    if (!t3.ok) throw new Error(t3.error)
    await ringForTurn(folder, 'elling', t3.turn, d)
    expect(decodeURIComponent(d.openExternal.mock.calls[1][0])).toContain('mailto:ben@joined.y?')
  })

  it('has nobody to ring without an address', async () => {
    const folder = await started()
    const { readBingBong } = await import('./bingBongActions')
    const { ringForTurn } = await import('./bingBongRing')
    const read = readBingBong(folder)
    if (!read.ok) throw new Error(read.error)
    expect(
      await ringForTurn(folder, 'elling', read.snapshot.resolution.applied[0], deps())
    ).toEqual({ kind: 'no-address' })
  })
})

describe('ringPoke', () => {
  it('pokes the other player', async () => {
    const folder = await started('ben@x.y')
    const { ringPoke } = await import('./bingBongRing')
    const d = deps()
    await ringPoke(folder, 'elling', d)
    expect(decodeURIComponent(d.openExternal.mock.calls[0][0])).toContain(
      'subject=bing bong: elling is waiting on you'
    )
  })
})
```

- [ ] **Step 2: Run to see them fail.** FAIL.

- [ ] **Step 3: Implement.** Create `src/main/bingBongRing.ts`:

```ts
// src/main/bingBongRing.ts -- who the doorbell rings and what it says, for a turn, the invite and
// a poke. The address is the other player's own (players/<them>.json), or the invite address
// until they've joined. Spec: docs/superpowers/specs/2026-10-10-bing-bong-design.md.

import { describeTurn } from '@shared/bingBongDiff'
import { doorbellMessage, type DoorbellInput } from '@shared/bingBongDoorbell'
import type { BingBongTurnFile } from '@shared/bingBongFormat'
import { otherPlayer } from '@shared/bingBongRules'
import { readBingBong, type BingBongSnapshot } from './bingBongActions'
import { ringDoorbell, type DoorbellDeps, type DoorbellOutcome } from './bingBongMail'

function addressOf(snapshot: BingBongSnapshot, username: string): string | undefined {
  return (
    snapshot.players[username]?.email ??
    snapshot.file.players.find((p) => p.username === username)?.inviteEmail
  )
}

async function ring(
  folder: string,
  me: string,
  input: (snapshot: BingBongSnapshot) => DoorbellInput,
  deps: DoorbellDeps
): Promise<DoorbellOutcome> {
  const read = readBingBong(folder)
  if (!read.ok) return { kind: 'no-address' }
  const address = addressOf(read.snapshot, otherPlayer(read.snapshot.file, me))
  return ringDoorbell(address, doorbellMessage(input(read.snapshot)), deps)
}

/** After my turn: "elling played turn 7", with my line and what changed. */
export function ringForTurn(
  folder: string,
  me: string,
  turn: BingBongTurnFile,
  deps: DoorbellDeps
): Promise<DoorbellOutcome> {
  return ring(
    folder,
    me,
    (snapshot) => {
      const prev = snapshot.resolution.applied.find((t) => t.turn === turn.turn - 1)
      return {
        kind: turn.turn === 1 ? 'invite' : 'turn',
        from: me,
        name: snapshot.file.name,
        turn: turn.turn,
        summary: describeTurn(me, prev?.riff ?? null, turn.riff),
        chat: turn.chat
      }
    },
    deps
  )
}

/** "ben is waiting on you". */
export function ringPoke(folder: string, me: string, deps: DoorbellDeps): Promise<DoorbellOutcome> {
  return ring(
    folder,
    me,
    (snapshot) => ({ kind: 'poke', from: me, name: snapshot.file.name }),
    deps
  )
}
```

- [ ] **Step 4: Run the tests.** PASS (4 tests); typecheck; eslint clean.

- [ ] **Step 5: Commit** (`--only` both files): `bing bong: who the doorbell rings, and what it says`.

### Task 5: IPC

**Files:** Modify `src/main/bingBongIpc.ts`, `src/preload/index.ts`

- [ ] **Step 1: Ring after start and end turn; poke; the mail settings.**

```diff
--- a/src/main/bingBongIpc.ts
+++ b/src/main/bingBongIpc.ts
@@ -1,9 +1,10 @@
 // src/main/bingBongIpc.ts -- bing bong's IPC surface (spec:
 // docs/superpowers/specs/2026-10-10-bing-bong-design.md). The renderer picks the folder with the
 // existing 'pick-folder' and says who "me" is from the bing bong's own link; everything that
-// touches the shared folder happens here.
+// touches the shared folder, the email server or its password happens here.
 
-import type { IpcMain } from 'electron'
+import { shell, type IpcMain } from 'electron'
+import { doorbellMessage } from '@shared/bingBongDoorbell'
 import {
   endTurn,
   joinBingBong,
@@ -12,6 +13,17 @@ import {
   type EndTurnRequest,
   type StartRequest
 } from './bingBongActions'
+import {
+  mailStatus,
+  ringDoorbell,
+  saveMailPassword,
+  saveMailSettings,
+  smtpSend,
+  type DoorbellDeps,
+  type MailSettings,
+  type MailStatus
+} from './bingBongMail'
+import { ringForTurn, ringPoke } from './bingBongRing'
 
 function isNonEmptyString(value: unknown): value is string {
   return typeof value === 'string' && value !== ''
@@ -19,6 +31,11 @@ function isNonEmptyString(value: unknown): value is string {
 
 const NOT_A_FOLDER = { ok: false as const, error: 'no folder given' }
 
+const doorbell: DoorbellDeps = {
+  send: smtpSend,
+  openExternal: (url) => shell.openExternal(url)
+}
+
 export function registerBingBongIpc(
   ipcMain: IpcMain,
   deps: { ownUsername: () => string | null }
@@ -29,9 +46,14 @@ export function registerBingBongIpc(
     isNonEmptyString(folder) ? readBingBong(folder) : NOT_A_FOLDER
   )
 
-  ipcMain.handle('bingbong:start', (_event, request: StartRequest) =>
-    isNonEmptyString(request?.parentFolder) ? startBingBong(request) : NOT_A_FOLDER
-  )
+  ipcMain.handle('bingbong:start', async (_event, request: StartRequest) => {
+    if (!isNonEmptyString(request?.parentFolder)) return NOT_A_FOLDER
+    const started = await startBingBong(request)
+    if (!started.ok) return started
+    // Turn 1 rings as the invite.
+    const rang = await ringForTurn(started.folder, request.me, started.turn, doorbell)
+    return { ...started, doorbell: rang }
+  })
 
   ipcMain.handle('bingbong:join', (_event, folder: unknown, me: unknown, email: unknown) => {
     if (!isNonEmptyString(folder)) return NOT_A_FOLDER
@@ -39,7 +61,48 @@ export function registerBingBongIpc(
     return joinBingBong(folder, me, isNonEmptyString(email) ? email : undefined)
   })
 
-  ipcMain.handle('bingbong:end-turn', (_event, request: EndTurnRequest) =>
-    isNonEmptyString(request?.folder) ? endTurn(request) : NOT_A_FOLDER
+  ipcMain.handle('bingbong:end-turn', async (_event, request: EndTurnRequest) => {
+    if (!isNonEmptyString(request?.folder)) return NOT_A_FOLDER
+    const ended = await endTurn(request)
+    if (!ended.ok) return ended
+    // The turn is written whatever the doorbell does.
+    const rang = await ringForTurn(request.folder, request.me, ended.turn, doorbell)
+    return { ...ended, doorbell: rang }
+  })
+
+  ipcMain.handle('bingbong:poke', (_event, folder: unknown, me: unknown) =>
+    isNonEmptyString(folder) && isNonEmptyString(me)
+      ? ringPoke(folder, me, doorbell)
+      : { kind: 'no-address' as const }
+  )
+
+  ipcMain.handle('bingbong:mail-status', (): MailStatus => mailStatus())
+
+  /** `password`: a new one, null to clear it, undefined to keep the saved one. */
+  ipcMain.handle(
+    'bingbong:mail-save',
+    (_event, settings: MailSettings | null, password: string | null | undefined) => {
+      try {
+        saveMailSettings(settings)
+      } catch (err) {
+        return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
+      }
+      if (password !== undefined) saveMailPassword(password)
+      return { ok: true as const, status: mailStatus() }
+    }
   )
+
+  /** Sends a test to the From address itself. */
+  ipcMain.handle('bingbong:mail-test', async () => {
+    const settings = mailStatus().settings
+    if (!settings) return { kind: 'no-address' as const }
+    return ringDoorbell(
+      settings.from,
+      {
+        ...doorbellMessage({ kind: 'poke', from: 'sssketch', name: 'a test' }),
+        subject: 'bing bong: test'
+      },
+      doorbell
+    )
+  })
 }
```

- [ ] **Step 2: Expose them.**

```diff
--- a/src/preload/index.ts
+++ b/src/preload/index.ts
@@ -28,6 +28,7 @@ import type {
   StartRequest
 } from '../main/bingBongActions'
 import type { BingBongFile, BingBongTurnFile } from '@shared/bingBongFormat'
+import type { DoorbellOutcome, MailSettings, MailStatus } from '../main/bingBongMail'
 import type { DiscoverCandidate } from '../main/discoverCandidates'
 import type { ArtistIndex, ArtistMode, KeepRefused } from '@shared/discoverArtist'
 import type { ArtistScanBatch } from '../main/discoverArtistScanQueue'
@@ -130,16 +131,33 @@ const api = {
     ipcRenderer.invoke('bingbong:read', folder),
   bingBongStart: (
     request: StartRequest
-  ): Promise<Outcome<{ folder: string; file: BingBongFile; turn: BingBongTurnFile }>> =>
-    ipcRenderer.invoke('bingbong:start', request),
+  ): Promise<
+    Outcome<{
+      folder: string
+      file: BingBongFile
+      turn: BingBongTurnFile
+      doorbell: DoorbellOutcome
+    }>
+  > => ipcRenderer.invoke('bingbong:start', request),
   bingBongJoin: (
     folder: string,
     me: string,
     email: string | null
   ): Promise<Outcome<{ snapshot: BingBongSnapshot }>> =>
     ipcRenderer.invoke('bingbong:join', folder, me, email),
-  bingBongEndTurn: (request: EndTurnRequest): Promise<Outcome<{ turn: BingBongTurnFile }>> =>
+  bingBongEndTurn: (
+    request: EndTurnRequest
+  ): Promise<Outcome<{ turn: BingBongTurnFile; doorbell: DoorbellOutcome }>> =>
     ipcRenderer.invoke('bingbong:end-turn', request),
+  bingBongPoke: (folder: string, me: string): Promise<DoorbellOutcome> =>
+    ipcRenderer.invoke('bingbong:poke', folder, me),
+  bingBongMailStatus: (): Promise<MailStatus> => ipcRenderer.invoke('bingbong:mail-status'),
+  bingBongMailSave: (
+    settings: MailSettings | null,
+    password: string | null | undefined
+  ): Promise<{ ok: true; status: MailStatus } | { ok: false; error: string }> =>
+    ipcRenderer.invoke('bingbong:mail-save', settings, password),
+  bingBongMailTest: (): Promise<DoorbellOutcome> => ipcRenderer.invoke('bingbong:mail-test'),
   pickRifffImportPaths: (): Promise<string[]> => ipcRenderer.invoke('pick-rifff-import-paths'),
   // Linked loop folders -- see the loop-folders-* handlers in main/index.ts.
   // Pick with pickFolder above, then link the path.
```

- [ ] **Step 3: Typecheck and lint** both files.

- [ ] **Step 4: Commit** (`--only` both files): `bing bong: ring the doorbell after a turn`.

### Task 6: The settings modal, and what the doorbell did

**Files:** Create `src/renderer/src/state/bingBongDoorbellNote.ts`, `.test.ts`,
`src/renderer/src/components/BingBongMailModal.tsx`

- [ ] **Step 1: Write the failing test.** Create `src/renderer/src/state/bingBongDoorbellNote.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { doorbellNote } from './bingBongDoorbellNote'

describe('doorbellNote', () => {
  it('says what the doorbell did', () => {
    expect(doorbellNote({ kind: 'sent' }, 'ben')).toBe('bing bong: emailed ben.')
    expect(doorbellNote({ kind: 'drafted' }, 'ben')).toBe(
      "there's a draft to ben in your mail app: send it to ring their doorbell."
    )
    expect(doorbellNote({ kind: 'drafted', error: '535 bad login' }, 'ben')).toBe(
      "couldn't send (535 bad login), so there's a draft to ben in your mail app."
    )
    expect(doorbellNote({ kind: 'no-address' }, 'ben')).toBe(
      'no email for ben, so no doorbell this time.'
    )
  })
})
```

- [ ] **Step 2: Implement.** Create `src/renderer/src/state/bingBongDoorbellNote.ts`:

```ts
// What the doorbell did, as the one line the bar and the email settings show.
import type { DoorbellOutcome } from '../../../main/bingBongMail'

export function doorbellNote(outcome: DoorbellOutcome, who: string): string {
  switch (outcome.kind) {
    case 'sent':
      return `bing bong: emailed ${who}.`
    case 'drafted':
      return outcome.error
        ? `couldn't send (${outcome.error}), so there's a draft to ${who} in your mail app.`
        : `there's a draft to ${who} in your mail app: send it to ring their doorbell.`
    case 'no-address':
      return `no email for ${who}, so no doorbell this time.`
  }
}
```

- [ ] **Step 3: The modal.** Create `src/renderer/src/components/BingBongMailModal.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { MAIL_PRESETS } from '@shared/bingBongDoorbell'
import type { MailStatus } from '../../../main/bingBongMail'
import { doorbellNote } from '../state/bingBongDoorbellNote'

const inputStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  marginTop: 4,
  height: 24,
  padding: '0 8px',
  fontSize: 11,
  border: '1px solid var(--ra-border)',
  background: 'var(--ra-bg-row)',
  color: 'var(--ra-text)'
}

const buttonStyle: React.CSSProperties = {
  height: 22,
  borderRadius: 0,
  padding: '0 10px',
  fontSize: 10,
  border: '1px solid var(--ra-border)',
  background: 'var(--ra-bg-row-active)',
  color: 'var(--ra-text-2)'
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  placeholder
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: 'text' | 'password' | 'number'
  placeholder?: string
}): React.JSX.Element {
  return (
    <label style={{ display: 'block', marginTop: 10, fontSize: 10, color: 'var(--ra-text)' }}>
      {label}
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={inputStyle}
      />
    </label>
  )
}

/** bing bong → doorbell email…: the sender's own email server (spec:
 * docs/superpowers/specs/2026-10-10-bing-bong-design.md, "The doorbell"). Main keeps the
 * password encrypted (bingBongMail.ts) and never sends it back, so this only shows whether one
 * is set; typing a new one replaces it. Without a server, the doorbell opens a draft in your own
 * mail app instead. */
export function BingBongMailModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [status, setStatus] = useState<MailStatus | null>(null)
  const [host, setHost] = useState('')
  const [port, setPort] = useState('587')
  const [secure, setSecure] = useState(false)
  const [user, setUser] = useState('')
  const [from, setFrom] = useState('')
  const [password, setPassword] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    void window.rifffApi.bingBongMailStatus().then((next) => {
      if (cancelled) return
      setStatus(next)
      if (next.settings) {
        setHost(next.settings.host)
        setPort(String(next.settings.port))
        setSecure(next.settings.secure)
        setUser(next.settings.user)
        setFrom(next.settings.from)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  function applyPreset(key: keyof typeof MAIL_PRESETS): void {
    const preset = MAIL_PRESETS[key]
    setHost(preset.host)
    setPort(String(preset.port))
    setSecure(preset.secure)
  }

  async function save(): Promise<boolean> {
    const result = await window.rifffApi.bingBongMailSave(
      { host: host.trim(), port: Number(port), secure, user: user.trim(), from: from.trim() },
      password === '' ? undefined : password
    )
    if (!result.ok) {
      setNote(result.error)
      return false
    }
    setStatus(result.status)
    setPassword('')
    return true
  }

  async function saveAndTest(): Promise<void> {
    setBusy(true)
    try {
      if (!(await save())) return
      setNote(doorbellNote(await window.rifffApi.bingBongMailTest(), 'yourself'))
    } finally {
      setBusy(false)
    }
  }

  async function clear(): Promise<void> {
    const result = await window.rifffApi.bingBongMailSave(null, null)
    if (result.ok) setStatus(result.status)
    setHost('')
    setUser('')
    setFrom('')
    setPassword('')
    setNote('cleared. the doorbell will open a draft in your mail app.')
  }

  const passwordLine = !status?.hasPassword
    ? 'no password set'
    : status.passwordSaved
      ? 'a password is saved (encrypted by macos)'
      : 'a password is set for this session only'

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--ra-backdrop)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 'var(--ra-z-modal)'
      }}
    >
      <div
        style={{
          width: 'min(400px, 90vw)',
          background: 'var(--ra-bg-bar)',
          border: '1px solid var(--ra-border)',
          padding: 16
        }}
      >
        <p style={{ margin: 0, fontSize: 11, color: 'var(--ra-text)' }}>doorbell email</p>
        <p style={{ margin: '6px 0 0', fontSize: 10, color: 'var(--ra-text-2)' }}>
          when you end a turn, sssketch emails the other player from your own email account. leave
          it empty and it opens a ready-made email in your mail app instead.
        </p>
        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          <button style={buttonStyle} onClick={() => applyPreset('gmail')}>
            {MAIL_PRESETS.gmail.label}
          </button>
          <button style={buttonStyle} onClick={() => applyPreset('icloud')}>
            {MAIL_PRESETS.icloud.label}
          </button>
        </div>
        <Field label="server" value={host} onChange={setHost} placeholder="smtp.gmail.com" />
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <Field label="port" value={port} onChange={setPort} type="number" />
          </div>
          <label style={{ fontSize: 10, color: 'var(--ra-text)', paddingBottom: 6 }}>
            <input type="checkbox" checked={secure} onChange={(e) => setSecure(e.target.checked)} />{' '}
            tls from the start (port 465)
          </label>
        </div>
        <Field label="username" value={user} onChange={setUser} />
        <Field
          label={`password (${passwordLine})`}
          value={password}
          onChange={setPassword}
          type="password"
          placeholder="type to replace"
        />
        <Field label="send from" value={from} onChange={setFrom} placeholder="you@example.com" />
        {note && (
          <p style={{ margin: '10px 0 0', fontSize: 10, color: 'var(--ra-text)' }}>{note}</p>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14 }}>
          <button style={buttonStyle} onClick={() => void clear()} disabled={busy}>
            clear
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={buttonStyle} onClick={onClose} disabled={busy}>
              close
            </button>
            <button style={buttonStyle} onClick={() => void saveAndTest()} disabled={busy}>
              {busy ? '…' : 'save and send a test'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run, typecheck, lint.** PASS (1 test).

- [ ] **Step 5: Commit** (`--only` the three files): `bing bong: doorbell email settings`.

### Task 7: Wire it in

**Files:** Modify `src/renderer/src/components/BingBongBar.tsx`, `src/renderer/src/App.tsx`,
`README.md`

- [ ] **Step 1: The bar shows what the doorbell did.**

```diff
--- a/src/renderer/src/components/BingBongBar.tsx
+++ b/src/renderer/src/components/BingBongBar.tsx
@@ -29,7 +29,8 @@ export function BingBongBar({
   bringOptions,
   defaultBring,
   onTakeTurn,
-  onEndTurn
+  onEndTurn,
+  note
 }: {
   link: BingBongLink
   status: BingBongStatus | null
@@ -39,6 +40,8 @@ export function BingBongBar({
   onTakeTurn: (bring: string) => void
   /** Resolves true when the turn was taken. */
   onEndTurn: (chat: string) => Promise<boolean>
+  /** What the doorbell did after my last move (bingBongDoorbellNote.ts). */
+  note?: string | null
 }): React.JSX.Element {
   const [bring, setBring] = useState(defaultBring)
   const [chat, setChat] = useState('')
@@ -85,6 +88,7 @@ export function BingBongBar({
         {' — '}
         {bingBongStatusLine(link, status)}
       </div>
+      {note && <div>{note}</div>}
       {theirLine && (
         <div style={{ fontStyle: 'italic' }}>
           “{theirLine}” — {link.other}
```

- [ ] **Step 2: The menu item, the modal, and the note.**

```diff
--- a/src/renderer/src/App.tsx
+++ b/src/renderer/src/App.tsx
@@ -108,6 +108,8 @@ import { ReoneNotice } from './components/ReoneNotice'
 import { SaveCopyNotice } from './components/SaveCopyNotice'
 import { LockedNotice } from './components/LockedNotice'
 import { BingBongBar } from './components/BingBongBar'
+import { BingBongMailModal } from './components/BingBongMailModal'
+import { doorbellNote } from './state/bingBongDoorbellNote'
 import {
   BingBongDialog,
   type BingBongJoinForm,
@@ -707,7 +709,8 @@ function ProjectMenu({
   onOpenAutoArrange,
   onOpenDrawArrange,
   onStartBingBong,
-  onJoinBingBong
+  onJoinBingBong,
+  onOpenBingBongMail
 }: {
   currentSketch: CurrentSketch
   setCurrentSketch: (sketch: CurrentSketch) => void
@@ -746,6 +749,7 @@ function ProjectMenu({
    * selected riff, or join one someone shared. Both open BingBongDialog in Frame. */
   onStartBingBong: () => void
   onJoinBingBong: () => void
+  onOpenBingBongMail: () => void
 }): React.JSX.Element {
   const state = useAppState()
   const dispatch = useDispatch()
@@ -1142,7 +1146,8 @@ function ProjectMenu({
               disabled: !canStartBingBong,
               title: canStartBingBong ? undefined : 'select the riff to start with first'
             },
-            { label: 'join a bing bong…', onClick: onJoinBingBong }
+            { label: 'join a bing bong…', onClick: onJoinBingBong },
+            { label: 'doorbell email…', onClick: onOpenBingBongMail }
           ]}
           onClose={() => setBingBongMenu(null)}
         />
@@ -1415,6 +1420,9 @@ function Frame(): React.JSX.Element {
   const getBingBongState = useCallback((): AppState => stateRef.current, [])
   useBingBongSync(state.bingBong, getBingBongState, dispatch)
   const bingBongStatus = useBingBongStatus()
+  const [bingBongMailOpen, setBingBongMailOpen] = useState(false)
+  // What the doorbell did after my last start or end turn, shown on the bar until the next one.
+  const [bingBongNote, setBingBongNote] = useState<string | null>(null)
   const [bingBongDialog, setBingBongDialog] = useState<{
     mode: 'start' | 'join'
     knownMe: string | null
@@ -1877,6 +1885,7 @@ function Frame(): React.JSX.Element {
     })
     if (!result.ok) return bingBongDialogFailed(result.error)
     setBingBongDialog(null)
+    setBingBongNote(doorbellNote(result.doorbell, form.other))
     if (!(await leaveForBingBong())) {
       window.alert(`the bing bong is started. open it any time: bing bong → join a bing bong…`)
       return
@@ -2004,6 +2013,7 @@ function Frame(): React.JSX.Element {
       window.alert(`your turn wasn't sent: ${result.error}`)
       return false
     }
+    setBingBongNote(doorbellNote(result.doorbell, link.other))
     const append = appendTurnsAction(
       stateRef.current,
       [result.turn],
@@ -4081,6 +4091,7 @@ function Frame(): React.JSX.Element {
               onOpenDrawArrange={() => setDrawArrangeOpen(true)}
               onStartBingBong={() => void openBingBongDialog('start')}
               onJoinBingBong={() => void openBingBongDialog('join')}
+              onOpenBingBongMail={() => setBingBongMailOpen(true)}
             />
           </div>
         </div>
@@ -4428,8 +4439,10 @@ function Frame(): React.JSX.Element {
             defaultBring={lastTurnBy(true) ? 'my-last' : 'nothing'}
             onTakeTurn={takeBingBongTurn}
             onEndTurn={endBingBongTurn}
+            note={bingBongNote}
           />
         )}
+        {bingBongMailOpen && <BingBongMailModal onClose={() => setBingBongMailOpen(false)} />}
         {bingBongDialog && (
           <BingBongDialog
             mode={bingBongDialog.mode}
```

- [ ] **Step 3: Say what goes over the network.** In `README.md`, "What goes over the network",
add after the phone remote bullet:

```markdown
- **Your own email server**, only if you set one up for bing bong's doorbell (`bing bong → doorbell email…`). When you start a bing bong or end a turn, sssketch emails the other player through it: who played, your one line, and what changed. Never any audio. Your password is encrypted by macOS. Without a server, sssketch opens a ready-made email in your own mail app instead, and you decide whether to send it.
- **The bing bong folder**, if you play bing bong: it's a folder you and a friend share (Google Drive, Dropbox…). sssketch reads and writes files there and nothing else; the sharing is your cloud service's.
```

- [ ] **Step 4: Typecheck, lint, test.** `npm run typecheck && npx eslint src/renderer/src/App.tsx src/renderer/src/components/BingBongBar.tsx && npx vitest run src/renderer`.

- [ ] **Step 5: Commit** (`--only` the three files): `bing bong: the doorbell in the app`.

### Task 8: By hand (Elling)

- [ ] **Make the SES user.** In AWS IAM, a new user `bingbong-smtp` with this inline policy, then
  SES → SMTP settings → create SMTP credentials for it. Never reuse the RPM site's credentials, and
  don't leave the downloaded CSV in `~/Claudecode/`.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["ses:SendRawEmail", "ses:SendEmail"],
      "Resource": "*",
      "Condition": { "StringEquals": { "ses:FromAddress": "bingbong@rpmchallenge.com" } }
    }
  ]
}
```

- [ ] **Settings.** bing bong → doorbell email…:
  - server `email-smtp.<region>.amazonaws.com`, port 587, tls from the start off;
  - username and password from the SMTP credentials;
  - send from `bingbong@rpmchallenge.com`.
  - Press save and send a test: the test arrives at bingbong@rpmchallenge.com, and the modal says
    "bing bong: emailed yourself."
- [ ] **A turn.** End a turn: Ben gets "bing bong: elling played turn N" with your line and
  sssketchy's summary, and the bar says "bing bong: emailed ben."
- [ ] **The fallback.** Press clear in the modal, then end a turn: Mail opens a ready draft to
  Ben, and the bar says so.
- [ ] **A failure.** Type a wrong password: end turn still writes the turn, Mail opens the draft,
  and the bar shows the server's error.
- [ ] **No address.** With no email for the other player: "no email for ben, so no doorbell this
  time."

## Done when

`npm test`, `npm run typecheck`, `npm run lint` pass (engine-spawn tests aside), and Task 8 passes
by hand.
