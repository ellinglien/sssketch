# bing bong 4: sssketchy and the menu — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** sssketchy becomes bing bong's courier and host.
- When the other player's turn is waiting, he stands on the bar with an envelope and says what
  they changed and their line. Clicking him opens the turn in Cross.
- He nudges gently after 4 days, either way round. When I'm the one waiting, he offers a poke,
  at most once a day.
- He marks milestones: every tenth turn, and the turn that takes the sketch past three minutes.

The bing bong menu lists every bing bong this Mac has started or joined, with whose turn it is,
and opens one.

**Spec:** `docs/superpowers/specs/2026-10-10-bing-bong-design.md`, "sssketchy" and "The bing bong
menu". Plan 4 of 4; plans 1-3 must be merged first.

**Architecture:**
- `src/shared/bingBongCourier.ts` (pure, `now` injected): what sssketchy says, whether he has an
  envelope, whether a poke is offered, milestones.
- `src/main/bingBongKnownStore.ts`: the bing bongs this Mac knows (userData JSON). IPC records
  one on start and join, and `bingbong:known` lists them, each read fresh from its folder.
- `BingBongStatus` gains `checkedAt`, the time of the read, so render never reads the clock.
- `BingBongLink.lastPokeAt` limits pokes, and `SET_BING_BONG_LINK` becomes transient (no undo
  step).
- `BingBongBar` shows sssketchy's sprite and line, with a poke button.
- `App.tsx` adds the poke, opening a known bing bong, and the library browser's open moved into a
  named function (`openLibrarySketchNamed`) so the bing bong menu can share it.

**Changes from the spec:**
- sssketchy lives on the bing bong bar, not the guided-flow coach panel. The coach panel's bubble
  is "one thought at a time" and driven only by the coach state.
- The milestone "the first recorded take in a bing bong" is left out: turn files don't record
  that a stem was recorded in the app.

**Repo / branch:** `/Users/nickel/Claudecode/sssketch`, `bing-bong-4-sssketchy` from plan 3's.

**Commits:** every commit message ends with exactly these two lines, after a blank line:

```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015GgVLoMfDYXWtBAGJo23dn
```

Commit each task's own files only (`git commit --only <paths>`).

## How this plan's code was checked

The scratch copy is the same as plans 1-3, with all three applied. Every block below is a file or
`git diff` from it, after `prettier --write`. `npx vitest run src/renderer src/shared` plus the
bing bong main tests pass: 302 files, 4676 tests. `tsc` (web and node) passes. `eslint src` is
clean. Task 7 is Elling's.

---

### Task 1: What sssketchy says

**Files:** Modify `src/shared/bingBongTurns.ts`; create `src/shared/bingBongCourier.ts`,
`src/shared/bingBongCourier.test.ts`

- [ ] **Step 1: `lastPokeAt` on the link.**

```diff
--- a/src/shared/bingBongTurns.ts
+++ b/src/shared/bingBongTurns.ts
@@ -23,6 +23,8 @@ export interface BingBongLink {
   other: string
   /** The riff "done in cross" placed for my turn, until end turn makes it a locked turn. */
   draftGroupId?: string
+  /** When I last poked the other player (ISO time): at most one poke a day. */
+  lastPokeAt?: string
 }
 
 export interface TurnAsRifff {
```

- [ ] **Step 2: Write the failing tests.** Create `src/shared/bingBongCourier.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { BingBongTurnFile, BingBongTurnStem } from './bingBongFormat'
import type { TurnResolution } from './bingBongRules'
import type { BingBongLink } from './bingBongTurns'
import { bingBongMilestone, courierSays } from './bingBongCourier'

const DAY = 24 * 60 * 60 * 1000
const T0 = Date.parse('2026-10-12T10:00:00Z')

function stem(c: string, name: string): BingBongTurnStem {
  return {
    slot: 1,
    audio: 'sha256-' + c.repeat(64),
    ext: 'wav',
    author: 'x',
    name,
    type: 'drums',
    durationSec: 9.6,
    barLength: 4,
    gain: 1,
    muted: false
  }
}

function turn(n: number, stems: BingBongTurnStem[], chat = '', bpm = 100): BingBongTurnFile {
  return {
    format: 'bingbong-turn/1',
    bingBong: 'bb',
    turn: n,
    parent: n === 1 ? null : n - 1,
    player: n % 2 ? 'elling' : 'ben',
    playedAt: new Date(T0).toISOString(),
    chat,
    riff: { name: `turn ${n}`, bpm, barLength: 4, stems },
    audioAdded: []
  }
}

const LINK: BingBongLink = { id: 'bb', name: 'n', folderPath: '/f', me: 'ben', other: 'elling' }

function resolution(applied: BingBongTurnFile[], whoseTurn: string): TurnResolution {
  return { applied, pending: null, problems: [], whoseTurn, nextTurn: applied.length + 1 }
}

describe('courierSays', () => {
  const t1 = turn(1, [stem('a', 'drums')])
  const t2 = turn(2, [stem('b', 'bass')], 'bass instead')
  const t3 = turn(3, [stem('b', 'bass'), stem('c', 'shaker')], 'shaker!')

  it('brings their turn: what changed and their line', () => {
    expect(courierSays(LINK, resolution([t1, t2, t3], 'ben'), T0)).toEqual({
      line: 'elling added shaker. kept your bass. “shaker!”',
      envelope: true,
      canPoke: false
    })
  })

  it('describes the first turn', () => {
    expect(courierSays(LINK, resolution([t1], 'ben'), T0).line).toBe('elling started with drums.')
  })

  it('nudges when their turn has waited on me', () => {
    expect(courierSays(LINK, resolution([t1], 'ben'), T0 + 5 * DAY).line).toBe(
      "elling started with drums. elling's been waiting 5 days."
    )
  })

  it('stays quiet while I wait, then offers a poke, at most once a day', () => {
    const waiting = resolution([t1, t2], 'elling')
    expect(courierSays(LINK, waiting, T0 + DAY)).toEqual({
      line: null,
      envelope: false,
      canPoke: false
    })
    expect(courierSays(LINK, waiting, T0 + 4 * DAY)).toEqual({
      line: "it's been 4 days. send elling a poke?",
      envelope: false,
      canPoke: true
    })
    const poked = { ...LINK, lastPokeAt: new Date(T0 + 4 * DAY).toISOString() }
    expect(courierSays(poked, waiting, T0 + 4 * DAY + 1000).canPoke).toBe(false)
    expect(courierSays(poked, waiting, T0 + 5 * DAY + 1000).canPoke).toBe(true)
  })

  it('says nothing while a turn is on its way', () => {
    const r = { ...resolution([t1], 'ben'), pending: t2 }
    expect(courierSays(LINK, r, T0).line).toBeNull()
  })
})

describe('bingBongMilestone', () => {
  it('marks every tenth turn', () => {
    const turns = Array.from({ length: 10 }, (_, i) => turn(i + 1, [stem('a', 'd')], '', 1000))
    expect(bingBongMilestone(turns)).toBe("turn 10. that's a proper back-and-forth.")
    expect(bingBongMilestone(turns.slice(0, 9))).toBeNull()
  })

  it('marks the turn that takes the sketch past three minutes, once', () => {
    // 4 bars at 60 bpm = 16 s a turn: past 180 s at turn 12.
    const turns = Array.from({ length: 13 }, (_, i) => turn(i + 1, [stem('a', 'd')], '', 60))
    expect(bingBongMilestone(turns.slice(0, 12))).toBe("that's three minutes of bing bong now.")
    expect(bingBongMilestone(turns.slice(0, 11))).toBeNull()
    expect(bingBongMilestone(turns)).toBeNull()
  })
})
```

- [ ] **Step 3: Run to see them fail.** FAIL.

- [ ] **Step 4: Implement.** Create `src/shared/bingBongCourier.ts`:

```ts
// src/shared/bingBongCourier.ts -- what sssketchy says on a bing bong sketch: what the other
// player's turn changed and their line, a gentle nudge when a turn has waited, and the odd
// milestone. He suggests, never plays. Pure; `now` is injected. Spec:
// docs/superpowers/specs/2026-10-10-bing-bong-design.md ("sssketchy").

import { describeTurn } from './bingBongDiff'
import type { BingBongTurnFile } from './bingBongFormat'
import type { TurnResolution } from './bingBongRules'
import type { BingBongLink } from './bingBongTurns'

const DAY_MS = 24 * 60 * 60 * 1000
/** A turn that has waited this long gets a nudge (me) or a poke offer (them). */
export const NUDGE_AFTER_DAYS = 4
const MILESTONE_SECONDS = 180

export interface CourierSays {
  /** sssketchy's bubble, or null to stay quiet. */
  line: string | null
  /** He has an envelope: the other player's turn is waiting for me. */
  envelope: boolean
  /** "send ben a poke?" is offered. */
  canPoke: boolean
}

function seconds(turn: BingBongTurnFile): number {
  return (turn.riff.barLength * 4 * 60) / turn.riff.bpm
}

/** A milestone the latest turn reached, if any. */
export function bingBongMilestone(applied: readonly BingBongTurnFile[]): string | null {
  const latest = applied[applied.length - 1]
  if (!latest) return null
  const total = applied.reduce((sum, t) => sum + seconds(t), 0)
  if (total >= MILESTONE_SECONDS && total - seconds(latest) < MILESTONE_SECONDS)
    return "that's three minutes of bing bong now."
  if (latest.turn % 10 === 0) return `turn ${latest.turn}. that's a proper back-and-forth.`
  return null
}

function daysSince(iso: string, now: number): number {
  return Math.floor((now - Date.parse(iso)) / DAY_MS)
}

export function courierSays(
  link: BingBongLink,
  resolution: TurnResolution,
  now: number
): CourierSays {
  const quiet: CourierSays = { line: null, envelope: false, canPoke: false }
  if (resolution.pending) return quiet
  const { applied } = resolution
  const latest = applied[applied.length - 1]
  if (!latest) return quiet

  if (resolution.whoseTurn === link.me) {
    if (latest.player === link.me) return quiet
    const prev = applied[applied.length - 2]
    const parts = [describeTurn(link.other, prev?.riff ?? null, latest.riff)]
    if (latest.chat) parts.push(`“${latest.chat}”`)
    const milestone = bingBongMilestone(applied)
    if (milestone) parts.push(milestone)
    const waited = daysSince(latest.playedAt, now)
    if (waited >= NUDGE_AFTER_DAYS) parts.push(`${link.other}'s been waiting ${waited} days.`)
    return { line: parts.join(' '), envelope: true, canPoke: false }
  }

  const waited = daysSince(latest.playedAt, now)
  if (waited < NUDGE_AFTER_DAYS) return quiet
  const pokedRecently = link.lastPokeAt !== undefined && now - Date.parse(link.lastPokeAt) < DAY_MS
  return {
    line: `it's been ${waited} days. send ${link.other} a poke?`,
    envelope: false,
    canPoke: !pokedRecently
  }
}
```

- [ ] **Step 5: Run the tests.** PASS (7 tests); eslint clean.

- [ ] **Step 6: Commit** (`--only` the three files): `bing bong: what sssketchy says`.

### Task 2: The bing bongs this Mac knows

**Files:** Create `src/main/bingBongKnownStore.ts`, `src/main/bingBongKnownStore.test.ts`

- [ ] **Step 1: Write the failing tests.**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let dir: string

vi.mock('electron', () => ({ app: { getPath: () => dir } }))

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bingbong-known-test-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const A = { id: 'bb_a', name: 'elling-and-ben', folder: '/d/a', me: 'elling', other: 'ben' }
const B = { id: 'bb_b', name: 'elling-and-wren', folder: '/d/b', me: 'elling', other: 'wren' }

describe('bingBongKnownStore', () => {
  it('starts empty and remembers, most recent first, one entry per id', async () => {
    const { loadKnownBingBongs, rememberBingBong } = await import('./bingBongKnownStore')
    expect(loadKnownBingBongs()).toEqual([])
    rememberBingBong(A)
    rememberBingBong(B)
    rememberBingBong({ ...A, folder: '/d/moved' })
    expect(loadKnownBingBongs()).toEqual([{ ...A, folder: '/d/moved' }, B])
    expect(readdirSync(dir)).toEqual(['bingbong-known.json'])
  })

  it('ignores a damaged file and bad entries', async () => {
    const { loadKnownBingBongs } = await import('./bingBongKnownStore')
    writeFileSync(join(dir, 'bingbong-known.json'), '{')
    expect(loadKnownBingBongs()).toEqual([])
    writeFileSync(join(dir, 'bingbong-known.json'), JSON.stringify([A, { id: 'x' }]))
    expect(loadKnownBingBongs()).toEqual([A])
  })
})
```

- [ ] **Step 2: Run to see them fail.** FAIL.

- [ ] **Step 3: Implement.**

```ts
// src/main/bingBongKnownStore.ts -- the bing bongs this Mac has started or joined, for the bing
// bong menu's list. userData JSON, written via a temp file and a rename; never throws. Spec:
// docs/superpowers/specs/2026-10-10-bing-bong-design.md ("The bing bong menu").

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

export interface KnownBingBong {
  id: string
  name: string
  folder: string
  me: string
  other: string
}

const STORE_FILENAME = 'bingbong-known.json'

function storePath(): string {
  return join(app.getPath('userData'), STORE_FILENAME)
}

function isKnown(value: unknown): value is KnownBingBong {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return ['id', 'name', 'folder', 'me', 'other'].every(
    (k) => typeof v[k] === 'string' && v[k] !== ''
  )
}

export function loadKnownBingBongs(): KnownBingBong[] {
  if (!existsSync(storePath())) return []
  try {
    const parsed: unknown = JSON.parse(readFileSync(storePath(), 'utf-8'))
    return Array.isArray(parsed) ? parsed.filter(isKnown) : []
  } catch (err) {
    console.error('bingBongKnownStore: failed to read:', err)
    return []
  }
}

/** Adds or updates (by id) a bing bong; the most recent first. */
export function rememberBingBong(entry: KnownBingBong): void {
  const next = [entry, ...loadKnownBingBongs().filter((k) => k.id !== entry.id)]
  const temporary = `${storePath()}.${process.pid}.tmp`
  try {
    mkdirSync(app.getPath('userData'), { recursive: true })
    writeFileSync(temporary, JSON.stringify(next))
    renameSync(temporary, storePath())
  } catch (err) {
    try {
      unlinkSync(temporary)
    } catch {
      // never written
    }
    console.error('bingBongKnownStore: failed to write:', err)
  }
}
```

- [ ] **Step 4: Run the tests.** PASS (2 tests); eslint clean.

- [ ] **Step 5: Commit** (`--only` both files): `bing bong: remember the bing bongs this mac knows`.

### Task 3: Record and list them over IPC

**Files:** Modify `src/main/bingBongIpc.ts`, `src/preload/index.ts`

- [ ] **Step 1:**

```diff
--- a/src/main/bingBongIpc.ts
+++ b/src/main/bingBongIpc.ts
@@ -24,6 +24,16 @@ import {
   type MailStatus
 } from './bingBongMail'
 import { ringForTurn, ringPoke } from './bingBongRing'
+import { loadKnownBingBongs, rememberBingBong, type KnownBingBong } from './bingBongKnownStore'
+
+/** A known bing bong as the menu lists it: read fresh from its folder. */
+export interface KnownBingBongStatus {
+  known: KnownBingBong
+  turns: number
+  myTurn: boolean
+  pending: boolean
+  error?: string
+}
 
 function isNonEmptyString(value: unknown): value is string {
   return typeof value === 'string' && value !== ''
@@ -50,6 +60,13 @@ export function registerBingBongIpc(
     if (!isNonEmptyString(request?.parentFolder)) return NOT_A_FOLDER
     const started = await startBingBong(request)
     if (!started.ok) return started
+    rememberBingBong({
+      id: started.file.id,
+      name: started.file.name,
+      folder: started.folder,
+      me: request.me,
+      other: request.other
+    })
     // Turn 1 rings as the invite.
     const rang = await ringForTurn(started.folder, request.me, started.turn, doorbell)
     return { ...started, doorbell: rang }
@@ -58,9 +75,34 @@ export function registerBingBongIpc(
   ipcMain.handle('bingbong:join', (_event, folder: unknown, me: unknown, email: unknown) => {
     if (!isNonEmptyString(folder)) return NOT_A_FOLDER
     if (!isNonEmptyString(me)) return { ok: false as const, error: 'who are you?' }
-    return joinBingBong(folder, me, isNonEmptyString(email) ? email : undefined)
+    const joined = joinBingBong(folder, me, isNonEmptyString(email) ? email : undefined)
+    if (joined.ok) {
+      const { file } = joined.snapshot
+      rememberBingBong({
+        id: file.id,
+        name: file.name,
+        folder,
+        me,
+        other: file.players.find((p) => p.username !== me)?.username ?? ''
+      })
+    }
+    return joined
   })
 
+  ipcMain.handle('bingbong:known', (): KnownBingBongStatus[] =>
+    loadKnownBingBongs().map((known) => {
+      const read = readBingBong(known.folder)
+      if (!read.ok) return { known, turns: 0, myTurn: false, pending: false, error: read.error }
+      const { resolution } = read.snapshot
+      return {
+        known,
+        turns: resolution.applied.length,
+        myTurn: resolution.whoseTurn === known.me && resolution.pending === null,
+        pending: resolution.pending !== null
+      }
+    })
+  )
+
   ipcMain.handle('bingbong:end-turn', async (_event, request: EndTurnRequest) => {
     if (!isNonEmptyString(request?.folder)) return NOT_A_FOLDER
     const ended = await endTurn(request)
```

- [ ] **Step 2:**

```diff
--- a/src/preload/index.ts
+++ b/src/preload/index.ts
@@ -29,6 +29,7 @@ import type {
 } from '../main/bingBongActions'
 import type { BingBongFile, BingBongTurnFile } from '@shared/bingBongFormat'
 import type { DoorbellOutcome, MailSettings, MailStatus } from '../main/bingBongMail'
+import type { KnownBingBongStatus } from '../main/bingBongIpc'
 import type { DiscoverCandidate } from '../main/discoverCandidates'
 import type { ArtistIndex, ArtistMode, KeepRefused } from '@shared/discoverArtist'
 import type { ArtistScanBatch } from '../main/discoverArtistScanQueue'
@@ -158,6 +159,7 @@ const api = {
   ): Promise<{ ok: true; status: MailStatus } | { ok: false; error: string }> =>
     ipcRenderer.invoke('bingbong:mail-save', settings, password),
   bingBongMailTest: (): Promise<DoorbellOutcome> => ipcRenderer.invoke('bingbong:mail-test'),
+  bingBongKnown: (): Promise<KnownBingBongStatus[]> => ipcRenderer.invoke('bingbong:known'),
   pickRifffImportPaths: (): Promise<string[]> => ipcRenderer.invoke('pick-rifff-import-paths'),
   // Linked loop folders -- see the loop-folders-* handlers in main/index.ts.
   // Pick with pickFolder above, then link the path.
```

- [ ] **Step 3: Typecheck and lint; commit** (`--only` both files): `bing bong: list the known bing bongs`.

### Task 4: The read's time, the menu's labels, a transient link

**Files:** Modify `src/renderer/src/state/bingBongStatus.ts`, `bingBongStatus.test.ts`,
`useBingBongSync.ts`, `history.ts`

- [ ] **Step 1: Write the failing test** (append to `bingBongStatus.test.ts`, and import
`knownBingBongLabel`):

```diff
--- a/src/renderer/src/state/bingBongStatus.test.ts
+++ b/src/renderer/src/state/bingBongStatus.test.ts
@@ -2,7 +2,7 @@ import { describe, expect, it } from 'vitest'
 import type { BingBongTurnFile } from '@shared/bingBongFormat'
 import type { TurnResolution } from '@shared/bingBongRules'
 import type { BingBongLink } from '@shared/bingBongTurns'
-import { bingBongStatusLine, type BingBongStatus } from './bingBongStatus'
+import { bingBongStatusLine, knownBingBongLabel, type BingBongStatus } from './bingBongStatus'
 
 const LINK: BingBongLink = { id: 'bb', name: 'n', folderPath: '/f', me: 'ben', other: 'elling' }
 
@@ -69,3 +69,22 @@ describe('bingBongStatusLine', () => {
     expect(bingBongStatusLine(LINK, null)).toBe('checking the folder…')
   })
 })
+
+describe('knownBingBongLabel', () => {
+  const known = { id: 'bb', name: 'n', folder: '/f', me: 'ben', other: 'elling' }
+
+  it('says whose turn, and how many turns', () => {
+    expect(knownBingBongLabel({ known, turns: 3, myTurn: true, pending: false })).toBe(
+      'elling · your turn (3 turns)'
+    )
+    expect(knownBingBongLabel({ known, turns: 1, myTurn: false, pending: false })).toBe(
+      'elling · waiting for elling (1 turn)'
+    )
+    expect(knownBingBongLabel({ known, turns: 1, myTurn: false, pending: true })).toBe(
+      'elling · their turn is on its way'
+    )
+    expect(
+      knownBingBongLabel({ known, turns: 0, myTurn: false, pending: false, error: 'gone' })
+    ).toBe("elling · can't read its folder")
+  })
+})
```

- [ ] **Step 2: Implement.**

```diff
--- a/src/renderer/src/state/bingBongStatus.ts
+++ b/src/renderer/src/state/bingBongStatus.ts
@@ -5,11 +5,14 @@ import { useSyncExternalStore } from 'react'
 import { describeTurnProblem } from '@shared/bingBongRules'
 import type { BingBongLink } from '@shared/bingBongTurns'
 import type { BingBongSnapshot } from '../../../main/bingBongActions'
+import type { KnownBingBongStatus } from '../../../main/bingBongIpc'
 
 export interface BingBongStatus {
   link: BingBongLink
   snapshot?: BingBongSnapshot
   error?: string
+  /** Date.now() of the read: sssketchy's "now" for nudges, without reading the clock in render. */
+  checkedAt?: number
 }
 
 let status: BingBongStatus | null = null
@@ -39,6 +42,15 @@ export function requestBingBongCheck(): void {
   recheck?.()
 }
 
+/** A known bing bong (another one, maybe) as the bing bong menu lists it. */
+export function knownBingBongLabel(item: KnownBingBongStatus): string {
+  const who = item.known.other
+  if (item.error) return `${who} · can't read its folder`
+  if (item.pending) return `${who} · their turn is on its way`
+  const turns = `${item.turns} turn${item.turns === 1 ? '' : 's'}`
+  return item.myTurn ? `${who} · your turn (${turns})` : `${who} · waiting for ${who} (${turns})`
+}
+
 /** Where the bing bong stands, in the app's lowercase voice. `link` is the project's live one
  * (the draft comes and goes between reads); `status` is the latest read, if any. */
 export function bingBongStatusLine(link: BingBongLink, status: BingBongStatus | null): string {
```

```diff
--- a/src/renderer/src/state/useBingBongSync.ts
+++ b/src/renderer/src/state/useBingBongSync.ts
@@ -51,7 +51,11 @@ export function useBingBongSync(
       const latest = snapshot.resolution.applied[snapshot.resolution.applied.length - 1]
       if (seen !== null && latest && latest.turn > seen && latest.player !== me) ring(latest)
       seen = latest?.turn ?? 0
-      publishBingBongStatus({ link: getState().bingBong ?? current, snapshot })
+      publishBingBongStatus({
+        link: getState().bingBong ?? current,
+        snapshot,
+        checkedAt: Date.now()
+      })
     }
 
     const run = (): void => {
```

```diff
--- a/src/renderer/src/state/history.ts
+++ b/src/renderer/src/state/history.ts
@@ -149,7 +149,9 @@ const TRANSIENT_ACTION_TYPES = new Set<Action['type']>([
   // for the v1 mark, which records a file on disk rather than an edit).
   'COACH_APPLY_TENSION',
   'COACH_CLEAR_TENSION',
-  'COACH_MARK_V1_EXPORTED'
+  'COACH_MARK_V1_EXPORTED',
+  // Bing bong's own bookkeeping (when I last poked): not an arrangement edit.
+  'SET_BING_BONG_LINK'
 ])
 
 export function createHistoryState(present: AppState): HistoryState {
```

`SET_BING_BONG_LINK` inside "done in cross"'s `BATCH` still lands in that batch's one undo step;
only a bare dispatch (the poke) skips the checkpoint.

- [ ] **Step 3: Run** `npx vitest run src/renderer/src/state`: PASS. Typecheck, eslint.

- [ ] **Step 4: Commit** (`--only` the four files): `bing bong: when the folder was read, and the menu's labels`.

### Task 5: sssketchy on the bar

**Files:** Modify `src/renderer/src/components/BingBongBar.tsx`

- [ ] **Step 1:**

```diff
--- a/src/renderer/src/components/BingBongBar.tsx
+++ b/src/renderer/src/components/BingBongBar.tsx
@@ -1,5 +1,7 @@
 import { useState } from 'react'
+import type { CourierSays } from '@shared/bingBongCourier'
 import { BING_BONG_CHAT_MAX } from '@shared/bingBongFormat'
+import { SssketchySprite } from './SssketchySprite'
 import type { BingBongLink } from '@shared/bingBongTurns'
 import { bingBongStatusLine, type BingBongStatus } from '../state/bingBongStatus'
 
@@ -30,7 +32,9 @@ export function BingBongBar({
   defaultBring,
   onTakeTurn,
   onEndTurn,
-  note
+  note,
+  courier,
+  onPoke
 }: {
   link: BingBongLink
   status: BingBongStatus | null
@@ -42,6 +46,10 @@ export function BingBongBar({
   onEndTurn: (chat: string) => Promise<boolean>
   /** What the doorbell did after my last move (bingBongDoorbellNote.ts). */
   note?: string | null
+  /** What sssketchy says (@shared/bingBongCourier). With an envelope, clicking him takes the
+   * turn. */
+  courier?: CourierSays | null
+  onPoke?: () => void
 }): React.JSX.Element {
   const [bring, setBring] = useState(defaultBring)
   const [chat, setChat] = useState('')
@@ -83,13 +91,34 @@ export function BingBongBar({
         color: 'var(--ra-text-2)'
       }}
     >
+      {courier?.line && (
+        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
+          <SssketchySprite
+            animation={courier.envelope ? 'walk' : 'idle'}
+            size={40}
+            title={courier.envelope ? `open ${link.other}'s turn` : 'sssketchy'}
+            onClick={() => {
+              if (courier.envelope && myTurn) onTakeTurn(bringValue)
+            }}
+          />
+          <div style={{ color: 'var(--ra-text)' }}>
+            {courier.envelope ? '✉ ' : ''}
+            {courier.line}
+            {courier.canPoke && onPoke && (
+              <button style={{ ...buttonStyle, marginLeft: 6 }} onClick={onPoke}>
+                poke
+              </button>
+            )}
+          </div>
+        </div>
+      )}
       <div>
         <span style={{ color: 'var(--ra-text)' }}>bing bong · {link.other}</span>
         {' — '}
         {bingBongStatusLine(link, status)}
       </div>
       {note && <div>{note}</div>}
-      {theirLine && (
+      {theirLine && !courier?.envelope && (
         <div style={{ fontStyle: 'italic' }}>
           “{theirLine}” — {link.other}
         </div>
```

- [ ] **Step 2: Typecheck, lint; commit** (`--only` the file): `bing bong: sssketchy brings the turn`.

### Task 6: Poke, the list, opening a known bing bong

**Files:** Modify `src/renderer/src/App.tsx`, `CHANGELOG.md`

- [ ] **Step 1:**

```diff
--- a/src/renderer/src/App.tsx
+++ b/src/renderer/src/App.tsx
@@ -116,7 +116,10 @@ import {
   type BingBongStartForm
 } from './components/BingBongDialog'
 import { useBingBongSync } from './state/useBingBongSync'
-import { requestBingBongCheck, useBingBongStatus } from './state/bingBongStatus'
+import { knownBingBongLabel, requestBingBongCheck, useBingBongStatus } from './state/bingBongStatus'
+import { courierSays } from '@shared/bingBongCourier'
+import type { KnownBingBong } from '../../main/bingBongKnownStore'
+import type { KnownBingBongStatus } from '../../main/bingBongIpc'
 import { appendTurnsAction, timelineEndBar } from './state/bingBongTimeline'
 import type { BingBongTurnFile } from '@shared/bingBongFormat'
 import { otherPlayer } from '@shared/bingBongRules'
@@ -710,7 +713,8 @@ function ProjectMenu({
   onOpenDrawArrange,
   onStartBingBong,
   onJoinBingBong,
-  onOpenBingBongMail
+  onOpenBingBongMail,
+  onOpenKnownBingBong
 }: {
   currentSketch: CurrentSketch
   setCurrentSketch: (sketch: CurrentSketch) => void
@@ -750,6 +754,8 @@ function ProjectMenu({
   onStartBingBong: () => void
   onJoinBingBong: () => void
   onOpenBingBongMail: () => void
+  /** Opens one of the bing bongs this Mac has started or joined (bingBongKnownStore.ts). */
+  onOpenKnownBingBong: (known: KnownBingBong) => void
 }): React.JSX.Element {
   const state = useAppState()
   const dispatch = useDispatch()
@@ -770,6 +776,7 @@ function ProjectMenu({
   const [gearMenu, setGearMenu] = useState<{ x: number; y: number } | null>(null)
   const gearButtonRef = useRef<HTMLButtonElement>(null)
   const [bingBongMenu, setBingBongMenu] = useState<{ x: number; y: number } | null>(null)
+  const [knownBingBongs, setKnownBingBongs] = useState<KnownBingBongStatus[]>([])
   const bingBongButtonRef = useRef<HTMLButtonElement>(null)
   const canStartBingBong = state.sel !== null && state.rifffs[state.sel] !== undefined
   const [tidyUpNudgeOpen, setTidyUpNudgeOpen] = useState(false)
@@ -1128,6 +1135,11 @@ function ProjectMenu({
           }
           const rect = e.currentTarget.getBoundingClientRect()
           setBingBongMenu({ x: rect.left, y: rect.bottom + 4 })
+          // Each one read fresh from its folder, so the list says whose turn it is now.
+          void window.rifffApi
+            .bingBongKnown()
+            .then(setKnownBingBongs)
+            .catch((err: unknown) => console.error('bing bong: listing failed:', err))
         }}
         title="trade a loop with a friend, one turn at a time"
         style={buttonStyle}
@@ -1147,7 +1159,13 @@ function ProjectMenu({
               title: canStartBingBong ? undefined : 'select the riff to start with first'
             },
             { label: 'join a bing bong…', onClick: onJoinBingBong },
-            { label: 'doorbell email…', onClick: onOpenBingBongMail }
+            { label: 'doorbell email…', onClick: onOpenBingBongMail },
+            ...knownBingBongs.map((item) => ({
+              label: knownBingBongLabel(item),
+              onClick: () => onOpenKnownBingBong(item.known),
+              disabled: item.known.id === state.bingBong?.id,
+              title: item.known.id === state.bingBong?.id ? 'open now' : item.known.folder
+            }))
           ]}
           onClose={() => setBingBongMenu(null)}
         />
@@ -2026,6 +2044,74 @@ function Frame(): React.JSX.Element {
     return true
   }
 
+  async function pokeBingBong(): Promise<void> {
+    const link = stateRef.current.bingBong
+    if (!link) return
+    const outcome = await window.rifffApi.bingBongPoke(link.folderPath, link.me)
+    setBingBongNote(doorbellNote(outcome, link.other))
+    const current = stateRef.current.bingBong
+    if (current) {
+      dispatch({
+        type: 'SET_BING_BONG_LINK',
+        link: { ...current, lastPokeAt: new Date().toISOString() }
+      })
+    }
+  }
+
+  /** From the bing bong menu's list: its library sketch, or rebuilt from the folder when this Mac
+   * doesn't have one (say, the library moved). */
+  async function openKnownBingBong(known: KnownBingBong): Promise<void> {
+    if (!(await leaveForBingBong())) return
+    if (await openLibrarySketchNamed(`bingbong-${known.name}`)) return
+    const read = await window.rifffApi.bingBongRead(known.folder)
+    if (!read.ok) {
+      window.alert(`couldn't open that bing bong: ${read.error}`)
+      return
+    }
+    beginProjectDeparture()
+    const { file, resolution } = read.snapshot
+    await enterBingBongSketch(
+      { id: file.id, name: file.name, folderPath: known.folder, me: known.me, other: known.other },
+      resolution.applied,
+      resolution.applied[0]?.riff.bpm ?? state.bpm
+    )
+  }
+
+  /** Opens a library sketch by name, after the departure guard has passed; true when it opened.
+   * The library browser's own open, shared with the bing bong menu. Ends the departure. */
+  async function openLibrarySketchNamed(name: string): Promise<boolean> {
+    setBusy('opening project…')
+    try {
+      if (!projectDepartureIsCurrent()) return false
+      const result = await window.rifffApi.openLibrarySketch(name)
+      if (!result) return false
+      const { state: loaded, pluginStates } = deserializeProject(
+        JSON.parse(result.json),
+        await appSoundDefaults()
+      )
+      setBusy('loading…')
+      const opened = await openWithReonedRepair(loaded)
+      await warmStemCaches(opened.state)
+      if (!projectDepartureIsCurrent()) {
+        reonedOpenFailed()
+        return false
+      }
+      invalidateShapeSession()
+      projectSessionEpochRef.current = crypto.randomUUID()
+      restoreState(opened.state, pluginStates)
+      lastSavedJsonRef.current = opened.savedJson
+      setCurrentSketch({ kind: 'library', name })
+      return true
+    } catch (err) {
+      console.error('App: failed to open library sketch:', err)
+      reonedOpenFailed()
+      return false
+    } finally {
+      endProjectDeparture()
+      setBusy(null)
+    }
+  }
+
   // Guards the startup effect below against StrictMode's dev-only
   // double-invoke: without this, both invocations independently call
   // loadAutosave() before either gets to clearAutosave()/setRecoverableAutosave(),
@@ -4092,6 +4178,7 @@ function Frame(): React.JSX.Element {
               onStartBingBong={() => void openBingBongDialog('start')}
               onJoinBingBong={() => void openBingBongDialog('join')}
               onOpenBingBongMail={() => setBingBongMailOpen(true)}
+              onOpenKnownBingBong={(known) => void openKnownBingBong(known)}
             />
           </div>
         </div>
@@ -4440,6 +4527,16 @@ function Frame(): React.JSX.Element {
             onTakeTurn={takeBingBongTurn}
             onEndTurn={endBingBongTurn}
             note={bingBongNote}
+            courier={
+              bingBongStatus?.snapshot && bingBongStatus.checkedAt !== undefined
+                ? courierSays(
+                    state.bingBong,
+                    bingBongStatus.snapshot.resolution,
+                    bingBongStatus.checkedAt
+                  )
+                : null
+            }
+            onPoke={() => void pokeBingBong()}
           />
         )}
         {bingBongMailOpen && <BingBongMailModal onClose={() => setBingBongMailOpen(false)} />}
@@ -4487,38 +4584,7 @@ function Frame(): React.JSX.Element {
               }
               return 'proceed'
             }}
-            onSelect={(name) => {
-              void (async () => {
-                setBusy('opening project…')
-                try {
-                  if (!projectDepartureIsCurrent()) return
-                  const result = await window.rifffApi.openLibrarySketch(name)
-                  if (!result) return
-                  const { state: loaded, pluginStates } = deserializeProject(
-                    JSON.parse(result.json),
-                    await appSoundDefaults()
-                  )
-                  setBusy('loading…')
-                  const opened = await openWithReonedRepair(loaded)
-                  await warmStemCaches(opened.state)
-                  if (!projectDepartureIsCurrent()) {
-                    reonedOpenFailed()
-                    return
-                  }
-                  invalidateShapeSession()
-                  projectSessionEpochRef.current = crypto.randomUUID()
-                  restoreState(opened.state, pluginStates)
-                  lastSavedJsonRef.current = opened.savedJson
-                  setCurrentSketch({ kind: 'library', name })
-                } catch (err) {
-                  console.error('App: failed to open library sketch:', err)
-                  reonedOpenFailed()
-                } finally {
-                  endProjectDeparture()
-                  setBusy(null)
-                }
-              })()
-            }}
+            onSelect={(name) => void openLibrarySketchNamed(name)}
             onOpenFromDisk={() => {
               void (async () => {
                 beginProjectDeparture()
```

The library browser's `onSelect` now calls `openLibrarySketchNamed`. Its body is the same code
moved into a function, so opening from the browser behaves exactly as before. That is worth a
quick check by hand (Task 7).

- [ ] **Step 2: The changelog.** In `CHANGELOG.md`, under the current "Unreleased" heading's
"Added":

```markdown
- Added **bing bong**: trade a loop with a friend, one turn at a time, through a folder you both share (Google Drive, Dropbox…). Start one from a riff (project menu → bing bong), take your turn in Cross with their riff on the left and a copy of it in the middle, end it with a one-line message, and their doorbell rings by email. Past turns are locked; the turns, end to end, are a sketch you can play and export. No server, no accounts. sssketchy brings each turn, says what changed, and nudges after a few days.
- Added locked riffs (bing bong's past turns): they play and solo, and anything that would move, resize, edit or delete one says why it can't.
- Cross can open with its center already filled, and with one button in place of add to shelf / add to timeline.
- Added doorbell email settings (bing bong → doorbell email…): your own email server, with Gmail and iCloud presets. The password is encrypted by macOS. Without one, the doorbell opens a ready-made email in your mail app.
```

- [ ] **Step 3: Typecheck, lint, test.** `npm run typecheck && npm run lint && npx vitest run src/renderer src/shared`.

- [ ] **Step 4: Commit** (`--only src/renderer/src/App.tsx CHANGELOG.md`): `bing bong: poke, the list of bing bongs, sssketchy's lines`.

### Task 7: By hand (Elling and Ben)

- [ ] **The envelope.** When Ben's turn arrives, sssketchy walks on the bar with ✉ and a line like
  "ben added shaker. kept your drums. “shaker!”". Clicking him opens the turn in Cross.
- [ ] **Waiting.** Set the Mac's clock forward 4 days, or wait:
  - while waiting on Ben: "it's been 4 days. send ben a poke?" with a poke button. Poke: Ben's
    doorbell rings, and the button is gone until tomorrow.
  - while Ben waits on you: "ben's been waiting 4 days."
- [ ] **Milestone.** At turn 10: "turn 10. that's a proper back-and-forth."
- [ ] **The list.** bing bong menu: each known bing bong with whose turn it is. Pick one from
  another sketch: the unsaved-changes prompt, then that bing bong's sketch opens.
- [ ] **Rebuilt from the folder.** Rename the `bingbong-<name>` sketch in the library, then open it
  from the list: it's rebuilt from the folder.
- [ ] **Library browser.** Opening any sketch from the library browser still works as before.

## Done when

`npm test`, `npm run typecheck`, `npm run lint` pass (engine-spawn tests aside), and Task 7 passes
by hand.
