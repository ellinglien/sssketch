# bing bong 2: core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two players trade a loop through a shared folder. Start a bing bong from a selected
riff, join one someone shared, take a turn in Cross, end it with a one-line message, and see the
other player's turns arrive as locked riffs on a bing bong sketch.

**Spec:** `docs/superpowers/specs/2026-10-10-bing-bong-design.md`. Plan 2 of 4: 1 foundations
(must be merged first), 2 core (this), 3 doorbell (email), 4 sssketchy and the menu.

**Architecture:**
- **Pure rules in `src/shared/`, test-first:**
  - `bingBongFormat.ts`: the three file types, their parsers, file names, the chat line.
  - `bingBongRules.ts`: whose turn it is, which turn files count (`resolveTurns`), and what to
    say about problems.
  - `bingBongTurns.ts`: a turn to a locked riff (`turnToRifff`), a draft riff to the next turn
    file (`buildTurnFile`), and the `BingBongLink` a project carries.
  - `bingBongDiff.ts`: what a turn changed, as one line (plans 3 and 4 use it).
- **Main does the file work:**
  - `bingBongFolder.ts`: read the folder, write files via a temp name and a rename, never
    replace bingbong.json or a turn file.
  - `bingBongActions.ts`: start, join, read, end turn. Audio is copied before the turn file.
  - `bingBongIpc.ts`: five channels.
- **Renderer:**
  - `AppState.bingBong` (a `BingBongLink | null`, saved with the project).
  - `APPEND_BING_BONG_TURNS`: history applies it to every undo step, so no undo takes a turn
    away.
  - A poll hook (30 s, on focus, on request).
  - `BingBongBar` (status, "take your turn", "end turn" with a line) and `BingBongDialog`
    (start/join).
  - The wiring in `App.tsx`.
- **Taking a turn:**
  - Cross opens with their latest turn on the left and the center pre-filled from it.
  - The right column is what you bring: your last turn, a shelf riff, or nothing (an empty
    riff).
  - "done in cross" places the center as the draft riff at the end of the timeline, for the
    edit pass.
  - "end turn" bakes any live downbeat offset, then main copies the audio and writes the turn
    file. The draft becomes locked turn N.

**Changes from the spec, decided while planning (the spec is updated to match):**
- **Cross's right column has no Discover switch.** Cross already has Discover in its center row
  ("add a stem that is:"), so the right column is just what you bring.
- **No player chooses between duplicate turn files.** A turn file's name carries its player, and
  only one player may write each turn number. A file from the wrong player is reported and
  skipped; it never blocks the real turn.
- **There is no generic "reload on change".** Turns arrive through `APPEND_BING_BONG_TURNS`
  instead, which also keeps them out of undo.
- **"Collect all and save" is left for later.** Bing bong's end turn copies only the turn's own
  audio.
- **The bing bong sketch lives in the library as `bingbong-<name>`,** not in a separate folder.

**Tech stack:** TypeScript, vitest, React, Electron.

**Repo:** `/Users/nickel/Claudecode/sssketch`. **Base:** plan 1 merged onto `master` at
`ffc83fd1`.

**Branch:** `bing-bong-2-core`, from the branch with plan 1 on it.

**Commits:** every commit message ends with exactly these two lines, after a blank line:

```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015GgVLoMfDYXWtBAGJo23dn
```

Commit each task's own files only (`git commit --only <paths>`), never `git add -A`.

**Before you start:** `git status --short`; `npm test` and `npm run typecheck` (engine-spawn
tests aside). `App.tsx` is large and moves under you: anchor every edit on the quoted code.

## How this plan's code was checked

Every code block is a file or `git diff` from a scratch copy of `src/` at `ffc83fd1` with plan 1
applied, after `prettier --write`. There, `npx vitest run src/renderer src/shared` passes (294
files, 4634 tests), every new main test passes, and `tsc` (web and node configs) and `eslint` pass
on every touched file. The UI (Tasks 10-11) was typechecked and linted, but nobody has clicked it:
Task 12 is Elling's.

## Files

| File | |
|---|---|
| `src/shared/bingBongFormat.ts`, `.test.ts` | new |
| `src/shared/bingBongRules.ts`, `.test.ts` | new |
| `src/shared/bingBongTurns.ts`, `.test.ts` | new |
| `src/shared/bingBongDiff.ts`, `.test.ts` | new |
| `src/main/bingBongFolder.ts` | new |
| `src/main/bingBongActions.ts`, `.test.ts` | new |
| `src/main/bingBongIpc.ts` | new |
| `src/main/index.ts`, `src/preload/index.ts` | register and expose the channels |
| `src/renderer/src/state/store.ts`, `history.ts` | `bingBong` link, two actions |
| `src/renderer/src/state/bingBongTimeline.ts`, `.test.ts` | new |
| `src/renderer/src/state/bingBongStatus.ts`, `.test.ts` | new |
| `src/renderer/src/state/useBingBongSync.ts` | new |
| `src/renderer/src/components/BingBongBar.tsx`, `BingBongDialog.tsx` | new |
| `src/renderer/src/App.tsx` | the menu, the bar, the dialog, start/join/take/end |

---

### Task 1: The file formats

**Files:** Create `src/shared/bingBongFormat.ts`, `src/shared/bingBongFormat.test.ts`

- [ ] **Step 1: Write the failing tests.** Create `src/shared/bingBongFormat.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  BING_BONG_CHAT_MAX,
  audioFileName,
  cleanChatLine,
  isContentId,
  parseBingBongFile,
  parsePlayerFile,
  parseTurnFile,
  parseTurnFileName,
  turnFileName,
  type BingBongTurnFile
} from './bingBongFormat'

const A = 'sha256-' + 'a'.repeat(64)
const B = 'sha256-' + 'b'.repeat(64)

function turnFixture(over: Partial<BingBongTurnFile> = {}): BingBongTurnFile {
  return {
    format: 'bingbong-turn/1',
    bingBong: 'bb_test',
    turn: 1,
    parent: null,
    player: 'elling',
    playedAt: '2026-10-12T21:40:03Z',
    chat: '',
    riff: {
      name: 'turn 1',
      bpm: 92,
      barLength: 8,
      stems: [
        {
          slot: 0,
          audio: A,
          ext: 'ogg',
          author: 'rowan',
          name: 'drums',
          type: 'drums',
          durationSec: 20.87,
          barLength: 8,
          gain: 0.8,
          muted: false
        }
      ]
    },
    audioAdded: [A],
    ...over
  }
}

describe('turn file names', () => {
  it('pads the turn to four digits so listings sort in play order', () => {
    expect(turnFileName(7, 'ben')).toBe('0007-ben.json')
  })

  it('reads back what turnFileName writes', () => {
    expect(parseTurnFileName(turnFileName(12, 'elling'))).toEqual({ turn: 12, player: 'elling' })
  })

  it('ignores Drive conflict copies, temp files and strays', () => {
    expect(parseTurnFileName('0007-ben (1).json')).toBeNull()
    expect(parseTurnFileName('0007-ben.json.tmp')).toBeNull()
    expect(parseTurnFileName('.DS_Store')).toBeNull()
    expect(parseTurnFileName('0000-ben.json')).toBeNull()
  })
})

describe('audio ids', () => {
  it('names audio files by content id', () => {
    expect(audioFileName(A, 'ogg')).toBe(`${A}.ogg`)
  })

  it('accepts only sha256 content ids', () => {
    expect(isContentId(A)).toBe(true)
    expect(isContentId('sha256-xyz')).toBe(false)
    expect(isContentId(42)).toBe(false)
  })
})

describe('cleanChatLine', () => {
  it('makes one trimmed line', () => {
    expect(cleanChatLine('  wonky\nbass,   sorry ')).toBe('wonky bass, sorry')
  })

  it('caps the length without splitting a character', () => {
    const long = '🔔'.repeat(BING_BONG_CHAT_MAX + 10)
    expect(Array.from(cleanChatLine(long))).toHaveLength(BING_BONG_CHAT_MAX)
  })
})

describe('parseTurnFile', () => {
  it('round-trips a well-formed turn', () => {
    const turn = turnFixture({ turn: 2, parent: 1, player: 'ben', audioAdded: [B] })
    expect(parseTurnFile(JSON.stringify(turn))).toEqual({ ok: true, value: turn })
  })

  it('keeps creationTime when present', () => {
    const turn = turnFixture()
    turn.riff.stems[0].creationTime = 1712345678
    const parsed = parseTurnFile(JSON.stringify(turn))
    expect(parsed.ok && parsed.value.riff.stems[0].creationTime).toBe(1712345678)
  })

  it('cleans the chat line it reads', () => {
    const parsed = parseTurnFile(JSON.stringify(turnFixture({ chat: ' hi\n there ' })))
    expect(parsed.ok && parsed.value.chat).toBe('hi there')
  })

  it('names the bad field instead of throwing', () => {
    expect(parseTurnFile('{')).toEqual({ ok: false, error: 'not valid JSON' })
    expect(parseTurnFile(JSON.stringify({ ...turnFixture(), format: 'x' }))).toEqual({
      ok: false,
      error: 'unknown format'
    })
    expect(parseTurnFile(JSON.stringify({ ...turnFixture(), turn: 0 }))).toEqual({
      ok: false,
      error: 'bad turn'
    })
    const badStem = turnFixture()
    badStem.riff.stems[0].audio = 'nope'
    expect(parseTurnFile(JSON.stringify(badStem))).toEqual({
      ok: false,
      error: 'stem 1: bad audio id'
    })
  })
})

describe('parseBingBongFile', () => {
  const file = {
    format: 'bingbong/1',
    id: 'bb_7f3k9q2x',
    name: 'elling-and-ben',
    createdAt: '2026-10-10T14:02:11Z',
    createdBy: 'elling',
    players: [{ username: 'elling' }, { username: 'ben', inviteEmail: 'ben@example.com' }]
  }

  it('reads a well-formed bingbong.json', () => {
    expect(parseBingBongFile(JSON.stringify(file))).toEqual({ ok: true, value: file })
  })

  it('needs two different players, one of them the creator', () => {
    expect(
      parseBingBongFile(
        JSON.stringify({ ...file, players: [{ username: 'a' }, { username: 'a' }] })
      )
    ).toEqual({ ok: false, error: 'same player twice' })
    expect(parseBingBongFile(JSON.stringify({ ...file, createdBy: 'zed' }))).toEqual({
      ok: false,
      error: 'creator is not a player'
    })
  })
})

describe('parsePlayerFile', () => {
  it('reads a player file, email optional', () => {
    const p = { format: 'bingbong-player/1', username: 'ben', displayName: 'ben' }
    expect(parsePlayerFile(JSON.stringify(p))).toEqual({ ok: true, value: p })
    expect(parsePlayerFile(JSON.stringify({ ...p, email: 'b@x.y' }))).toEqual({
      ok: true,
      value: { ...p, email: 'b@x.y' }
    })
  })
})
```

- [ ] **Step 2: Run them to see them fail.**

Run: `npx vitest run src/shared/bingBongFormat.test.ts`
Expected: FAIL, `Failed to resolve import "./bingBongFormat"`.

- [ ] **Step 3: Implement.** Create `src/shared/bingBongFormat.ts`:

```ts
// src/shared/bingBongFormat.ts -- the files a bing bong's shared folder holds, and the only code
// that reads or names them. Spec: docs/superpowers/specs/2026-10-10-bing-bong-design.md
// ("The folder").
//
// Every file has exactly one writer and turn files are never rewritten, so Drive never makes a
// conflict copy of shared state. A copy Drive makes anyway (`0007-ben (1).json`) does not match
// TURN_FILE_PATTERN and is ignored.

import type { SoundType } from './types'

export const BING_BONG_FORMAT = 'bingbong/1'
export const BING_BONG_PLAYER_FORMAT = 'bingbong-player/1'
export const BING_BONG_TURN_FORMAT = 'bingbong-turn/1'

/** The one-line chat a turn carries, at most this many characters. */
export const BING_BONG_CHAT_MAX = 140

export interface BingBongPlayerRef {
  username: string
  /** Only until players/<username>.json exists. */
  inviteEmail?: string
}

/** bingbong.json: written once, by the player who started the bing bong. */
export interface BingBongFile {
  format: typeof BING_BONG_FORMAT
  id: string
  name: string
  createdAt: string
  createdBy: string
  players: [BingBongPlayerRef, BingBongPlayerRef]
}

/** players/<username>.json: written only by that player. */
export interface BingBongPlayerFile {
  format: typeof BING_BONG_PLAYER_FORMAT
  username: string
  displayName: string
  email?: string
}

export interface BingBongTurnStem {
  slot: number
  /** Content id of the audio actually heard (the materialised copy): `sha256-<hex>`. */
  audio: string
  ext: string
  author: string
  name: string
  type: SoundType
  durationSec: number
  barLength: number
  gain: number
  muted: boolean
  creationTime?: number
}

export interface BingBongTurnRiff {
  name: string
  bpm: number
  barLength: number
  stems: BingBongTurnStem[]
}

/** turns/NNNN-<username>.json: one immutable file per turn. */
export interface BingBongTurnFile {
  format: typeof BING_BONG_TURN_FORMAT
  bingBong: string
  turn: number
  /** The turn this one was built from; null for turn 1. */
  parent: number | null
  player: string
  playedAt: string
  chat: string
  riff: BingBongTurnRiff
  /** Content ids this turn put in audio/. */
  audioAdded: string[]
}

const TURN_FILE_PATTERN = /^(\d{4})-([^/\\\s()]+)\.json$/
const CONTENT_ID_PATTERN = /^sha256-[0-9a-f]{64}$/
const SOUND_TYPES: readonly SoundType[] = [
  'drums',
  'notes',
  'bass',
  'extInst',
  'sampler',
  'fx',
  'extFx',
  'audioIn'
]

export function turnFileName(turn: number, username: string): string {
  return `${String(turn).padStart(4, '0')}-${username}.json`
}

/** The turn number and player a turn file's name claims, or null for anything else in turns/
 * (Drive conflict copies, temp files, .DS_Store). */
export function parseTurnFileName(fileName: string): { turn: number; player: string } | null {
  const match = TURN_FILE_PATTERN.exec(fileName)
  if (!match) return null
  const turn = Number(match[1])
  if (turn < 1) return null
  return { turn, player: match[2] }
}

export function audioFileName(contentId: string, ext: string): string {
  return `${contentId}.${ext}`
}

export function isContentId(value: unknown): value is string {
  return typeof value === 'string' && CONTENT_ID_PATTERN.test(value)
}

/** One line, trimmed, at most BING_BONG_CHAT_MAX characters. */
export function cleanChatLine(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  return Array.from(oneLine).slice(0, BING_BONG_CHAT_MAX).join('')
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function parseStem(value: unknown, index: number): Parsed<BingBongTurnStem> {
  const where = `stem ${index + 1}`
  if (!isRecord(value)) return { ok: false, error: `${where} is not an object` }
  const { slot, audio, ext, author, name, type, durationSec, barLength, gain, muted } = value
  if (!Number.isInteger(slot) || (slot as number) < 0)
    return { ok: false, error: `${where}: bad slot` }
  if (!isContentId(audio)) return { ok: false, error: `${where}: bad audio id` }
  if (typeof ext !== 'string' || !/^[a-z0-9]{1,5}$/.test(ext))
    return { ok: false, error: `${where}: bad ext` }
  if (typeof author !== 'string' || typeof name !== 'string')
    return { ok: false, error: `${where}: bad author or name` }
  if (!SOUND_TYPES.includes(type as SoundType)) return { ok: false, error: `${where}: bad type` }
  if (!isFiniteNumber(durationSec) || durationSec <= 0)
    return { ok: false, error: `${where}: bad duration` }
  if (!isFiniteNumber(barLength) || barLength <= 0)
    return { ok: false, error: `${where}: bad bar length` }
  if (!isFiniteNumber(gain) || gain < 0) return { ok: false, error: `${where}: bad gain` }
  if (typeof muted !== 'boolean') return { ok: false, error: `${where}: bad muted` }
  const stem: BingBongTurnStem = {
    slot: slot as number,
    audio,
    ext,
    author,
    name,
    type: type as SoundType,
    durationSec,
    barLength,
    gain,
    muted
  }
  if (isFiniteNumber(value.creationTime)) stem.creationTime = value.creationTime
  return { ok: true, value: stem }
}

/** A turn file's JSON, checked field by field. Anything malformed is an error naming the field,
 * never an exception: a half-synced or hand-edited file must not take the app down. */
export function parseTurnFile(json: string): Parsed<BingBongTurnFile> {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return { ok: false, error: 'not valid JSON' }
  }
  if (!isRecord(raw)) return { ok: false, error: 'not an object' }
  if (raw.format !== BING_BONG_TURN_FORMAT) return { ok: false, error: 'unknown format' }
  const { bingBong, turn, parent, player, playedAt, chat, riff, audioAdded } = raw
  if (typeof bingBong !== 'string' || bingBong === '') return { ok: false, error: 'bad bingBong' }
  if (!Number.isInteger(turn) || (turn as number) < 1) return { ok: false, error: 'bad turn' }
  if (!(parent === null || (Number.isInteger(parent) && (parent as number) >= 1)))
    return { ok: false, error: 'bad parent' }
  if (typeof player !== 'string' || player === '') return { ok: false, error: 'bad player' }
  if (typeof playedAt !== 'string' || Number.isNaN(Date.parse(playedAt)))
    return { ok: false, error: 'bad playedAt' }
  if (typeof chat !== 'string') return { ok: false, error: 'bad chat' }
  if (!isRecord(riff)) return { ok: false, error: 'bad riff' }
  if (typeof riff.name !== 'string') return { ok: false, error: 'bad riff name' }
  if (!isFiniteNumber(riff.bpm) || riff.bpm <= 0) return { ok: false, error: 'bad riff bpm' }
  if (!isFiniteNumber(riff.barLength) || riff.barLength <= 0)
    return { ok: false, error: 'bad riff bar length' }
  if (!Array.isArray(riff.stems)) return { ok: false, error: 'bad riff stems' }
  const stems: BingBongTurnStem[] = []
  for (let i = 0; i < riff.stems.length; i += 1) {
    const parsed = parseStem(riff.stems[i], i)
    if (!parsed.ok) return parsed
    stems.push(parsed.value)
  }
  if (!Array.isArray(audioAdded) || !audioAdded.every(isContentId))
    return { ok: false, error: 'bad audioAdded' }
  return {
    ok: true,
    value: {
      format: BING_BONG_TURN_FORMAT,
      bingBong,
      turn: turn as number,
      parent: parent as number | null,
      player,
      playedAt,
      chat: cleanChatLine(chat),
      riff: { name: riff.name, bpm: riff.bpm, barLength: riff.barLength, stems },
      audioAdded: [...audioAdded]
    }
  }
}

export function parseBingBongFile(json: string): Parsed<BingBongFile> {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return { ok: false, error: 'not valid JSON' }
  }
  if (!isRecord(raw)) return { ok: false, error: 'not an object' }
  if (raw.format !== BING_BONG_FORMAT) return { ok: false, error: 'unknown format' }
  const { id, name, createdAt, createdBy, players } = raw
  if (typeof id !== 'string' || id === '') return { ok: false, error: 'bad id' }
  if (typeof name !== 'string') return { ok: false, error: 'bad name' }
  if (typeof createdAt !== 'string') return { ok: false, error: 'bad createdAt' }
  if (typeof createdBy !== 'string') return { ok: false, error: 'bad createdBy' }
  if (!Array.isArray(players) || players.length !== 2) return { ok: false, error: 'bad players' }
  const refs: BingBongPlayerRef[] = []
  for (const p of players) {
    if (!isRecord(p) || typeof p.username !== 'string' || p.username === '')
      return { ok: false, error: 'bad player' }
    const ref: BingBongPlayerRef = { username: p.username }
    if (typeof p.inviteEmail === 'string') ref.inviteEmail = p.inviteEmail
    refs.push(ref)
  }
  if (refs[0].username === refs[1].username) return { ok: false, error: 'same player twice' }
  if (!refs.some((r) => r.username === createdBy))
    return { ok: false, error: 'creator is not a player' }
  return {
    ok: true,
    value: {
      format: BING_BONG_FORMAT,
      id,
      name,
      createdAt,
      createdBy,
      players: [refs[0], refs[1]]
    }
  }
}

export function parsePlayerFile(json: string): Parsed<BingBongPlayerFile> {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return { ok: false, error: 'not valid JSON' }
  }
  if (!isRecord(raw)) return { ok: false, error: 'not an object' }
  if (raw.format !== BING_BONG_PLAYER_FORMAT) return { ok: false, error: 'unknown format' }
  if (typeof raw.username !== 'string' || raw.username === '')
    return { ok: false, error: 'bad username' }
  if (typeof raw.displayName !== 'string') return { ok: false, error: 'bad displayName' }
  const value: BingBongPlayerFile = {
    format: BING_BONG_PLAYER_FORMAT,
    username: raw.username,
    displayName: raw.displayName
  }
  if (typeof raw.email === 'string') value.email = raw.email
  return { ok: true, value }
}
```

- [ ] **Step 4: Run the tests.** `npx vitest run src/shared/bingBongFormat.test.ts`, expected PASS
(14 tests). Then `npx eslint src/shared/bingBongFormat.ts src/shared/bingBongFormat.test.ts`, no
output.

- [ ] **Step 5: Commit** (`git commit --only src/shared/bingBongFormat.ts src/shared/bingBongFormat.test.ts`)
with the message `bing bong: the shared folder's file formats` and the two trailer lines.

### Task 2: Whose turn, and which turn files count

**Files:** Create `src/shared/bingBongRules.ts`, `src/shared/bingBongRules.test.ts`

- [ ] **Step 1: Write the failing tests.** Create `src/shared/bingBongRules.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { turnFileName, type BingBongFile, type BingBongTurnFile } from './bingBongFormat'
import {
  describeTurnProblem,
  otherPlayer,
  playerForTurn,
  resolveTurns,
  type TurnFolderEntry
} from './bingBongRules'

const A = 'sha256-' + 'a'.repeat(64)
const B = 'sha256-' + 'b'.repeat(64)

const FILE: BingBongFile = {
  format: 'bingbong/1',
  id: 'bb_test',
  name: 'elling-and-ben',
  createdAt: '2026-10-10T14:02:11Z',
  createdBy: 'elling',
  players: [{ username: 'elling' }, { username: 'ben', inviteEmail: 'ben@example.com' }]
}

function turn(n: number, over: Partial<BingBongTurnFile> = {}): BingBongTurnFile {
  return {
    format: 'bingbong-turn/1',
    bingBong: 'bb_test',
    turn: n,
    parent: n === 1 ? null : n - 1,
    player: n % 2 === 1 ? 'elling' : 'ben',
    playedAt: '2026-10-12T21:40:03Z',
    chat: '',
    riff: {
      name: `turn ${n}`,
      bpm: 92,
      barLength: 8,
      stems: [
        {
          slot: 0,
          audio: A,
          ext: 'ogg',
          author: 'rowan',
          name: 'drums',
          type: 'drums',
          durationSec: 20.87,
          barLength: 8,
          gain: 0.8,
          muted: false
        }
      ]
    },
    audioAdded: n === 1 ? [A] : [],
    ...over
  }
}

function entry(t: BingBongTurnFile, fileName = turnFileName(t.turn, t.player)): TurnFolderEntry {
  return { fileName, json: JSON.stringify(t) }
}

const allAudio = (): boolean => true

describe('players', () => {
  it('knows the other player', () => {
    expect(otherPlayer(FILE, 'elling')).toBe('ben')
    expect(otherPlayer(FILE, 'ben')).toBe('elling')
  })

  it('gives the creator the odd turns', () => {
    expect(playerForTurn(FILE, 1)).toBe('elling')
    expect(playerForTurn(FILE, 2)).toBe('ben')
    expect(playerForTurn(FILE, 7)).toBe('elling')
  })
})

describe('resolveTurns', () => {
  it('starts with the creator when there are no turns', () => {
    expect(resolveTurns(FILE, [], allAudio)).toEqual({
      applied: [],
      pending: null,
      problems: [],
      whoseTurn: 'elling',
      nextTurn: 1
    })
  })

  it('applies turns in order whatever order the folder lists them', () => {
    const r = resolveTurns(FILE, [entry(turn(3)), entry(turn(1)), entry(turn(2))], allAudio)
    expect(r.applied.map((t) => t.turn)).toEqual([1, 2, 3])
    expect(r.whoseTurn).toBe('ben')
    expect(r.nextTurn).toBe(4)
    expect(r.problems).toEqual([])
  })

  it('ignores files that are not turn files', () => {
    const r = resolveTurns(
      FILE,
      [entry(turn(1)), { fileName: '0002-ben (1).json', json: '{}' }],
      allAudio
    )
    expect(r.applied).toHaveLength(1)
    expect(r.problems).toEqual([])
  })

  it('holds a turn whose audio has not synced as pending, and nobody else may play', () => {
    const t2 = turn(2)
    t2.riff.stems[0].audio = B
    const r = resolveTurns(FILE, [entry(turn(1)), entry(t2)], (id) => id === A)
    expect(r.applied.map((t) => t.turn)).toEqual([1])
    expect(r.pending?.turn).toBe(2)
    expect(r.whoseTurn).toBe('ben')
  })

  it('reports and skips a file from the wrong player without blocking the real turn', () => {
    const intruder = turn(2, { player: 'elling' })
    const r = resolveTurns(FILE, [entry(turn(1)), entry(intruder), entry(turn(2))], allAudio)
    expect(r.applied.map((t) => t.turn)).toEqual([1, 2])
    expect(r.problems).toEqual([
      { kind: 'wrong-player', turn: 2, player: 'elling', expected: 'ben' }
    ])
  })

  it('stops at a gap and says which turn it is waiting for', () => {
    const r = resolveTurns(FILE, [entry(turn(1)), entry(turn(4))], allAudio)
    expect(r.applied.map((t) => t.turn)).toEqual([1])
    expect(r.problems).toEqual([{ kind: 'gap', missing: 2, next: 4 }])
    expect(r.whoseTurn).toBe('ben')
  })

  it('stops at an unreadable file from the right player', () => {
    const r = resolveTurns(
      FILE,
      [entry(turn(1)), { fileName: '0002-ben.json', json: '{"format":' }],
      allAudio
    )
    expect(r.applied).toHaveLength(1)
    expect(r.problems).toEqual([
      { kind: 'unreadable', turn: 2, player: 'ben', error: 'not valid JSON' }
    ])
  })

  it('stops when the contents disagree with the file name', () => {
    const r = resolveTurns(FILE, [entry(turn(1)), entry(turn(3), '0001-elling.json')], allAudio)
    expect(r.applied).toHaveLength(0)
    expect(r.problems).toEqual([{ kind: 'name-mismatch', turn: 1, player: 'elling' }])
  })

  it('stops at a turn from another bing bong', () => {
    const r = resolveTurns(FILE, [entry(turn(1, { bingBong: 'bb_other' }))], allAudio)
    expect(r.problems).toEqual([{ kind: 'wrong-bing-bong', turn: 1, player: 'elling' }])
  })

  it('stops at a turn that does not follow the one before', () => {
    const r = resolveTurns(FILE, [entry(turn(1)), entry(turn(2, { parent: null }))], allAudio)
    expect(r.applied).toHaveLength(1)
    expect(r.problems).toEqual([{ kind: 'bad-parent', turn: 2, player: 'ben' }])
  })
})

describe('describeTurnProblem', () => {
  const name = (u: string): string => u

  it('speaks in the app voice', () => {
    expect(describeTurnProblem({ kind: 'gap', missing: 7, next: 8 }, name)).toBe(
      "turn 8 is here but turn 7 isn't yet. waiting for it."
    )
    expect(
      describeTurnProblem(
        { kind: 'wrong-player', turn: 2, player: 'elling', expected: 'ben' },
        name
      )
    ).toBe("there's a turn 2 from elling, but turn 2 is ben's. skipping it.")
  })
})
```

- [ ] **Step 2: Run to see them fail.** `npx vitest run src/shared/bingBongRules.test.ts`,
expected FAIL (`./bingBongRules` doesn't resolve).

- [ ] **Step 3: Implement.** Create `src/shared/bingBongRules.ts`:

```ts
// src/shared/bingBongRules.ts -- whose turn it is, and which turn files in a bing bong's folder
// count. Pure: main reads the folder and hands the file names and contents in. Spec:
// docs/superpowers/specs/2026-10-10-bing-bong-design.md ("Receiving a turn").
//
// Two players strictly alternate, so for every turn number exactly one player may write it. A
// file from the other player for that number breaks the rules: it is reported and skipped, and
// never blocks the real turn. A gap, an unreadable file from the right player, or a turn whose
// parent is wrong stops the walk there: nothing after it is applied until it's fixed.

import {
  parseTurnFile,
  parseTurnFileName,
  type BingBongFile,
  type BingBongTurnFile
} from './bingBongFormat'

export interface TurnFolderEntry {
  fileName: string
  json: string
}

export type TurnProblem =
  | { kind: 'unreadable'; turn: number; player: string; error: string }
  | { kind: 'name-mismatch'; turn: number; player: string }
  | { kind: 'wrong-bing-bong'; turn: number; player: string }
  | { kind: 'wrong-player'; turn: number; player: string; expected: string }
  | { kind: 'bad-parent'; turn: number; player: string }
  | { kind: 'gap'; missing: number; next: number }

export interface TurnResolution {
  /** Turns 1..N in order, every one valid and with all its audio present. */
  applied: BingBongTurnFile[]
  /** Turn N+1 when its file is valid but some of its audio hasn't synced yet. */
  pending: BingBongTurnFile | null
  problems: TurnProblem[]
  /** Who plays next. While a turn is pending this is still its player: nobody else may start
   * that turn number. */
  whoseTurn: string
  nextTurn: number
}

export function otherPlayer(file: BingBongFile, username: string): string {
  const [a, b] = file.players
  return a.username === username ? b.username : a.username
}

/** Who plays turn `turn` (1-based): the creator plays the odd turns. */
export function playerForTurn(file: BingBongFile, turn: number): string {
  return turn % 2 === 1 ? file.createdBy : otherPlayer(file, file.createdBy)
}

export function resolveTurns(
  file: BingBongFile,
  entries: readonly TurnFolderEntry[],
  hasAudio: (contentId: string) => boolean
): TurnResolution {
  const problems: TurnProblem[] = []
  const byTurn = new Map<number, { player: string; json: string }>()
  let highest = 0

  for (const entry of entries) {
    const named = parseTurnFileName(entry.fileName)
    if (!named) continue
    const expected = playerForTurn(file, named.turn)
    if (named.player !== expected) {
      problems.push({ kind: 'wrong-player', turn: named.turn, player: named.player, expected })
      continue
    }
    byTurn.set(named.turn, { player: named.player, json: entry.json })
    highest = Math.max(highest, named.turn)
  }

  const applied: BingBongTurnFile[] = []
  let pending: BingBongTurnFile | null = null

  for (let n = 1; n <= highest; n += 1) {
    const found = byTurn.get(n)
    if (!found) {
      let next = n + 1
      while (!byTurn.has(next)) next += 1
      problems.push({ kind: 'gap', missing: n, next })
      break
    }
    const parsed = parseTurnFile(found.json)
    if (!parsed.ok) {
      problems.push({ kind: 'unreadable', turn: n, player: found.player, error: parsed.error })
      break
    }
    const turn = parsed.value
    if (turn.turn !== n || turn.player !== found.player) {
      problems.push({ kind: 'name-mismatch', turn: n, player: found.player })
      break
    }
    if (turn.bingBong !== file.id) {
      problems.push({ kind: 'wrong-bing-bong', turn: n, player: found.player })
      break
    }
    if (turn.parent !== (n === 1 ? null : n - 1)) {
      problems.push({ kind: 'bad-parent', turn: n, player: found.player })
      break
    }
    if (!turn.riff.stems.every((s) => hasAudio(s.audio))) {
      pending = turn
      break
    }
    applied.push(turn)
  }

  const nextTurn = applied.length + 1
  return { applied, pending, problems, whoseTurn: playerForTurn(file, nextTurn), nextTurn }
}

/** The line sssketchy says about a problem, in the app's lowercase voice. `name` maps a username
 * to the name shown. */
export function describeTurnProblem(problem: TurnProblem, name: (u: string) => string): string {
  switch (problem.kind) {
    case 'gap':
      return `turn ${problem.next} is here but turn ${problem.missing} isn't yet. waiting for it.`
    case 'unreadable':
      return `turn ${problem.turn} from ${name(problem.player)} can't be read (${problem.error}).`
    case 'name-mismatch':
      return `turn ${problem.turn} from ${name(problem.player)} doesn't match its file name.`
    case 'wrong-bing-bong':
      return `turn ${problem.turn} from ${name(problem.player)} belongs to a different bing bong.`
    case 'wrong-player':
      return `there's a turn ${problem.turn} from ${name(problem.player)}, but turn ${problem.turn} is ${name(problem.expected)}'s. skipping it.`
    case 'bad-parent':
      return `turn ${problem.turn} from ${name(problem.player)} doesn't follow turn ${problem.turn - 1}.`
  }
}
```

- [ ] **Step 4: Run the tests.** Expected PASS (13 tests); eslint clean on both files.

- [ ] **Step 5: Commit** (`--only` both files): `bing bong: whose turn, and which turn files count`.

### Task 3: Turns as riffs, and riffs as turns

**Files:** Create `src/shared/bingBongTurns.ts`, `src/shared/bingBongTurns.test.ts`.
Needs plan 1's `Rifff.locked`.

- [ ] **Step 1: Write the failing tests.** Create `src/shared/bingBongTurns.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseTurnFile, type BingBongTurnFile } from './bingBongFormat'
import type { TurnResolution } from './bingBongRules'
import {
  buildTurnFile,
  bingBongTurnGroupId,
  turnToRifff,
  type BuildTurnInput
} from './bingBongTurns'
import type { Rifff } from './types'

const A = 'sha256-' + 'a'.repeat(64)
const B = 'sha256-' + 'b'.repeat(64)

const TURN: BingBongTurnFile = {
  format: 'bingbong-turn/1',
  bingBong: 'bb_test',
  turn: 2,
  parent: 1,
  player: 'ben',
  playedAt: '2026-10-12T21:40:03Z',
  chat: 'wonky bass',
  riff: {
    name: 'turn 2',
    bpm: 92,
    barLength: 8,
    stems: [
      {
        slot: 1,
        audio: A,
        ext: 'ogg',
        author: 'rowan',
        name: 'drums',
        type: 'drums',
        durationSec: 20.87,
        barLength: 8,
        gain: 0.8,
        muted: false,
        creationTime: 1712345678
      },
      {
        slot: 2,
        audio: B,
        ext: 'wav',
        author: 'elling',
        name: 'bass',
        type: 'bass',
        durationSec: 20.87,
        barLength: 8,
        gain: 1,
        muted: true
      }
    ]
  },
  audioAdded: [B]
}

describe('turnToRifff', () => {
  it('makes a locked riff that plays from audio/, with gains and disables', () => {
    const { rifff, vol, mute } = turnToRifff(TURN, '/drive/bb/audio')
    const g = bingBongTurnGroupId('bb_test', 2)
    expect(g).toBe('bingbong-bb_test-2')
    expect(rifff).toEqual({
      groupId: g,
      phaseLinkId: g,
      name: 'turn 2 · ben',
      bpm: 92,
      barLength: 8,
      folderPath: '/drive/bb/audio',
      locked: true,
      stems: [
        {
          slot: 1,
          author: 'rowan',
          name: 'drums',
          type: 'drums',
          path: `/drive/bb/audio/${A}.ogg`,
          durationSec: 20.87,
          barLength: 8,
          creationTime: 1712345678
        },
        {
          slot: 2,
          author: 'elling',
          name: 'bass',
          type: 'bass',
          path: `/drive/bb/audio/${B}.wav`,
          durationSec: 20.87,
          barLength: 8
        }
      ]
    })
    expect(vol).toEqual({ [`${g}:1`]: 0.8, [`${g}:2`]: 1 })
    expect(mute).toEqual({ [`${g}:2`]: true })
  })
})

describe('buildTurnFile', () => {
  const draft: Rifff = {
    groupId: 'draft',
    name: 'cross: turn 2 × mine',
    bpm: 92,
    barLength: 8,
    folderPath: '',
    stems: [
      {
        slot: 1,
        author: 'rowan',
        name: 'drums',
        type: 'drums',
        path: '/drive/bb/audio/a.ogg',
        durationSec: 20.87,
        barLength: 8
      },
      {
        slot: 2,
        author: 'elling',
        name: 'pad',
        type: 'notes',
        path: '/lib/pad.wav',
        durationSec: 20.87,
        barLength: 8
      },
      {
        slot: 3,
        author: 'elling',
        name: 'pad again',
        type: 'notes',
        path: '/lib/pad-copy.wav',
        durationSec: 20.87,
        barLength: 8
      }
    ]
  }
  const resolution: TurnResolution = {
    applied: [],
    pending: null,
    problems: [],
    whoseTurn: 'elling',
    nextTurn: 3
  }
  const input: BuildTurnInput = {
    bingBongId: 'bb_test',
    me: 'elling',
    resolution,
    rifff: draft,
    vol: { 'draft:1': 0.5 },
    mute: { 'draft:2': true },
    identities: new Map([
      ['/drive/bb/audio/a.ogg', { contentId: A, ext: 'ogg' }],
      ['/lib/pad.wav', { contentId: B, ext: 'wav' }],
      ['/lib/pad-copy.wav', { contentId: B, ext: 'wav' }]
    ]),
    hasAudio: (id) => id === A,
    chat: '  more pad\n ',
    now: new Date('2026-10-13T08:00:00Z')
  }

  it('writes the next turn and copies only audio the folder lacks, once each', () => {
    const r = buildTurnFile(input)
    if (!r.ok) throw new Error(r.error)
    expect(r.fileName).toBe('0003-elling.json')
    expect(r.copies).toEqual([{ from: '/lib/pad.wav', contentId: B, ext: 'wav' }])
    expect(r.turn.audioAdded).toEqual([B])
    expect(r.turn.parent).toBe(2)
    expect(r.turn.chat).toBe('more pad')
    expect(r.turn.playedAt).toBe('2026-10-13T08:00:00.000Z')
    expect(r.turn.riff.stems.map((s) => [s.audio, s.gain, s.muted])).toEqual([
      [A, 0.5, false],
      [B, 1, true],
      [B, 1, false]
    ])
  })

  it('writes a file parseTurnFile accepts', () => {
    const r = buildTurnFile(input)
    if (!r.ok) throw new Error(r.error)
    expect(parseTurnFile(JSON.stringify(r.turn))).toEqual({ ok: true, value: r.turn })
  })

  it('makes turn 1 with no parent', () => {
    const r = buildTurnFile({ ...input, resolution: { ...resolution, nextTurn: 1 } })
    expect(r.ok && r.turn.parent).toBeNull()
  })

  it('refuses out of turn, while pending, and with no stems', () => {
    expect(buildTurnFile({ ...input, resolution: { ...resolution, whoseTurn: 'ben' } })).toEqual({
      ok: false,
      error: "it isn't your turn"
    })
    expect(
      buildTurnFile({ ...input, resolution: { ...resolution, pending: {} as BingBongTurnFile } })
    ).toEqual({ ok: false, error: 'the last turn is still syncing' })
    expect(buildTurnFile({ ...input, rifff: { ...draft, stems: [] } })).toEqual({
      ok: false,
      error: 'the riff has no stems'
    })
  })

  it('refuses a stem main could not identify', () => {
    expect(buildTurnFile({ ...input, identities: new Map() })).toEqual({
      ok: false,
      error: 'no content id for drums'
    })
  })
})
```

- [ ] **Step 2: Run to see them fail.** `npx vitest run src/shared/bingBongTurns.test.ts`,
expected FAIL.

- [ ] **Step 3: Implement.** Create `src/shared/bingBongTurns.ts`:

```ts
// src/shared/bingBongTurns.ts -- a turn file to a locked timeline riff, and a draft riff to the
// next turn file. Pure: main computes content ids and does the file copies. Spec:
// docs/superpowers/specs/2026-10-10-bing-bong-design.md ("The bing bong sketch", "Taking a turn").

import {
  BING_BONG_TURN_FORMAT,
  audioFileName,
  cleanChatLine,
  turnFileName,
  type BingBongTurnFile,
  type BingBongTurnStem
} from './bingBongFormat'
import type { TurnResolution } from './bingBongRules'
import { stemKey, type Rifff } from './types'

/** What a project knows about the bing bong it is the sketch of (AppState.bingBong). Saved with
 * the project; null for every other project. */
export interface BingBongLink {
  id: string
  name: string
  folderPath: string
  me: string
  other: string
  /** The riff "done in cross" placed for my turn, until end turn makes it a locked turn. */
  draftGroupId?: string
}

export interface TurnAsRifff {
  rifff: Rifff
  vol: Record<string, number>
  mute: Record<string, boolean>
}

/** A turn's riff with where it goes on the timeline (APPEND_BING_BONG_TURNS). */
export type PlacedTurn = TurnAsRifff & { startBar: number }

/** The groupId a turn's riff always has, on both Macs: the same turn is the same riff. */
export function bingBongTurnGroupId(bingBongId: string, turn: number): string {
  return `bingbong-${bingBongId}-${turn}`
}

/** A turn as a locked riff whose stems play straight from the shared folder's audio/. `mute` is
 * the durable Disable (AppState.mute), which is what a turn's `muted` records. */
export function turnToRifff(turn: BingBongTurnFile, audioDir: string): TurnAsRifff {
  const groupId = bingBongTurnGroupId(turn.bingBong, turn.turn)
  const vol: Record<string, number> = {}
  const mute: Record<string, boolean> = {}
  const stems = turn.riff.stems.map((s) => {
    const key = stemKey(groupId, s.slot)
    vol[key] = s.gain
    if (s.muted) mute[key] = true
    return {
      slot: s.slot,
      author: s.author,
      name: s.name,
      type: s.type,
      path: `${audioDir}/${audioFileName(s.audio, s.ext)}`,
      durationSec: s.durationSec,
      barLength: s.barLength,
      ...(s.creationTime !== undefined ? { creationTime: s.creationTime } : {})
    }
  })
  return {
    rifff: {
      groupId,
      phaseLinkId: groupId,
      name: `turn ${turn.turn} · ${turn.player}`,
      bpm: turn.riff.bpm,
      barLength: turn.riff.barLength,
      folderPath: audioDir,
      stems,
      locked: true
    },
    vol,
    mute
  }
}

export interface AudioIdentity {
  contentId: string
  ext: string
}

export interface TurnAudioCopy {
  from: string
  contentId: string
  ext: string
}

export interface BuildTurnInput {
  bingBongId: string
  me: string
  resolution: TurnResolution
  /** The draft riff, already materialised: every stem path is the audio actually heard. */
  rifff: Rifff
  vol: Readonly<Record<string, number>>
  mute: Readonly<Record<string, boolean>>
  /** Content id and extension of each stem path, computed by main. */
  identities: ReadonlyMap<string, AudioIdentity>
  /** True when audio/ already holds this content id. */
  hasAudio: (contentId: string) => boolean
  chat: string
  now: Date
}

export type BuildTurnResult =
  | { ok: true; turn: BingBongTurnFile; fileName: string; copies: TurnAudioCopy[] }
  | { ok: false; error: string }

/** The next turn file, and the audio end turn must copy into audio/ first (each new content id
 * once). Refuses when it isn't my turn, while a turn is pending, or with an empty riff. */
export function buildTurnFile(input: BuildTurnInput): BuildTurnResult {
  const { resolution, me, rifff } = input
  if (resolution.pending) return { ok: false, error: 'the last turn is still syncing' }
  if (resolution.whoseTurn !== me) return { ok: false, error: "it isn't your turn" }
  if (rifff.stems.length === 0) return { ok: false, error: 'the riff has no stems' }

  const copies: TurnAudioCopy[] = []
  const stems: BingBongTurnStem[] = []
  for (const stem of rifff.stems) {
    const identity = input.identities.get(stem.path)
    if (!identity) return { ok: false, error: `no content id for ${stem.name}` }
    const key = stemKey(rifff.groupId, stem.slot)
    stems.push({
      slot: stem.slot,
      audio: identity.contentId,
      ext: identity.ext,
      author: stem.author,
      name: stem.name,
      type: stem.type,
      durationSec: stem.durationSec,
      barLength: stem.barLength,
      gain: input.vol[key] ?? 1,
      muted: input.mute[key] === true,
      ...(stem.creationTime !== undefined ? { creationTime: stem.creationTime } : {})
    })
    const already =
      input.hasAudio(identity.contentId) || copies.some((c) => c.contentId === identity.contentId)
    if (!already) copies.push({ from: stem.path, ...identity })
  }

  const n = resolution.nextTurn
  const turn: BingBongTurnFile = {
    format: BING_BONG_TURN_FORMAT,
    bingBong: input.bingBongId,
    turn: n,
    parent: n === 1 ? null : n - 1,
    player: me,
    playedAt: input.now.toISOString(),
    chat: cleanChatLine(input.chat),
    riff: { name: `turn ${n}`, bpm: rifff.bpm, barLength: rifff.barLength, stems },
    audioAdded: copies.map((c) => c.contentId)
  }
  return { ok: true, turn, fileName: turnFileName(n, me), copies }
}
```

Paths are joined with `/` rather than `node:path`: `src/shared/` is also bundled into the
renderer, and sssketch is macOS-only.

- [ ] **Step 4: Run the tests.** Expected PASS (6 tests); eslint clean.

- [ ] **Step 5: Commit** (`--only` both files): `bing bong: turns as locked riffs, riffs as turn files`.

### Task 4: What a turn changed

**Files:** Create `src/shared/bingBongDiff.ts`, `src/shared/bingBongDiff.test.ts`

- [ ] **Step 1: Write the failing tests.** Create `src/shared/bingBongDiff.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { BingBongTurnRiff, BingBongTurnStem } from './bingBongFormat'
import { describeTurn, diffTurns } from './bingBongDiff'

function id(c: string): string {
  return 'sha256-' + c.repeat(64)
}

function stem(
  audio: string,
  name: string,
  type: BingBongTurnStem['type'],
  gain = 1
): BingBongTurnStem {
  return {
    slot: 0,
    audio,
    ext: 'ogg',
    author: 'x',
    name,
    type,
    durationSec: 10,
    barLength: 4,
    gain,
    muted: false
  }
}

function riff(...stems: BingBongTurnStem[]): BingBongTurnRiff {
  return { name: 'r', bpm: 100, barLength: 4, stems }
}

const drums = stem(id('a'), 'Drums', 'drums')
const bass = stem(id('b'), 'bass', 'bass')
const bass2 = stem(id('c'), 'sub bass', 'bass')
const shaker = stem(id('d'), 'shaker', 'fx')
const pad = stem(id('e'), 'pad', 'notes')

describe('diffTurns', () => {
  it('matches stems by audio, pairs same-type replacements as swaps', () => {
    const d = diffTurns(riff(drums, bass, pad), riff(drums, bass2, shaker))
    expect(d.kept).toEqual([drums])
    expect(d.swapped).toEqual([{ from: bass, to: bass2 }])
    expect(d.added).toEqual([shaker])
    expect(d.removed).toEqual([pad])
    expect(d.releveled).toEqual([])
  })

  it('notices level and mute changes on kept stems, ignoring tiny ones', () => {
    const quieter = { ...drums, gain: 0.5 }
    const nudged = { ...bass, gain: 0.98 }
    const muted = { ...pad, muted: true }
    const d = diffTurns(riff(drums, bass, pad), riff(quieter, nudged, muted))
    expect(d.releveled).toEqual([quieter, muted])
  })
})

describe('describeTurn', () => {
  it('describes the first turn', () => {
    expect(describeTurn('elling', null, riff(drums, bass, pad))).toBe(
      'elling started with drums, bass and pad.'
    )
  })

  it('says what changed and what was kept', () => {
    expect(describeTurn('ben', riff(drums, bass), riff(drums, bass2, shaker))).toBe(
      'ben swapped your bass and added shaker. kept your drums.'
    )
  })

  it('mentions drops and level changes', () => {
    expect(describeTurn('ben', riff(drums, pad), riff({ ...drums, gain: 0.4 }))).toBe(
      'ben dropped your pad and changed the levels.'
    )
  })

  it('says when nothing changed', () => {
    expect(describeTurn('ben', riff(drums), riff(drums))).toBe('ben sent it back unchanged.')
  })
})
```

- [ ] **Step 2: Run to see them fail.** Expected FAIL.

- [ ] **Step 3: Implement.** Create `src/shared/bingBongDiff.ts`:

```ts
// src/shared/bingBongDiff.ts -- what a turn changed, and the one line sssketchy says about it
// ("ben swapped your bass and added shaker. kept your drums."). Stems are matched by the audio
// they play (content id), so a stem that moved slot is still the same stem. Spec:
// docs/superpowers/specs/2026-10-10-bing-bong-design.md ("sssketchy").

import type { BingBongTurnRiff, BingBongTurnStem } from './bingBongFormat'

/** A gain change smaller than this isn't worth mentioning. */
const LEVEL_EPSILON = 0.05

export interface TurnDiff {
  kept: BingBongTurnStem[]
  /** Removed and added stems of the same type, paired in slot order. */
  swapped: { from: BingBongTurnStem; to: BingBongTurnStem }[]
  added: BingBongTurnStem[]
  removed: BingBongTurnStem[]
  /** Kept stems whose level or mute changed. */
  releveled: BingBongTurnStem[]
}

export function diffTurns(prev: BingBongTurnRiff | null, next: BingBongTurnRiff): TurnDiff {
  const before = new Map((prev?.stems ?? []).map((s) => [s.audio, s]))
  const after = new Map(next.stems.map((s) => [s.audio, s]))

  const kept: BingBongTurnStem[] = []
  const releveled: BingBongTurnStem[] = []
  const addedAll: BingBongTurnStem[] = []
  for (const stem of next.stems) {
    const old = before.get(stem.audio)
    if (!old) {
      addedAll.push(stem)
      continue
    }
    kept.push(stem)
    if (Math.abs(old.gain - stem.gain) >= LEVEL_EPSILON || old.muted !== stem.muted)
      releveled.push(stem)
  }
  const removedAll = (prev?.stems ?? []).filter((s) => !after.has(s.audio))

  const swapped: TurnDiff['swapped'] = []
  const added: BingBongTurnStem[] = []
  const unpairedRemoved = [...removedAll]
  for (const stem of addedAll) {
    const i = unpairedRemoved.findIndex((r) => r.type === stem.type)
    if (i === -1) {
      added.push(stem)
      continue
    }
    swapped.push({ from: unpairedRemoved[i], to: stem })
    unpairedRemoved.splice(i, 1)
  }

  return { kept, swapped, added, removed: unpairedRemoved, releveled }
}

function listNames(stems: readonly BingBongTurnStem[]): string {
  const names = stems.map((s) => s.name.trim().toLowerCase() || s.type)
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** sssketchy's line for a turn. `who` is the name shown for the player who made it. With no
 * previous turn, it describes what the bing bong started with. */
export function describeTurn(
  who: string,
  prev: BingBongTurnRiff | null,
  next: BingBongTurnRiff
): string {
  if (!prev) return `${who} started with ${listNames(next.stems) || 'silence'}.`

  const d = diffTurns(prev, next)
  const clauses: string[] = []
  if (d.swapped.length) clauses.push(`swapped your ${listNames(d.swapped.map((s) => s.from))}`)
  if (d.added.length) clauses.push(`added ${listNames(d.added)}`)
  if (d.removed.length) clauses.push(`dropped your ${listNames(d.removed)}`)
  if (d.releveled.length) clauses.push(`changed the levels`)
  if (clauses.length === 0) return `${who} sent it back unchanged.`

  const changed =
    clauses.length === 1
      ? clauses[0]
      : `${clauses.slice(0, -1).join(', ')} and ${clauses[clauses.length - 1]}`
  const untouched = d.kept.filter((s) => !d.releveled.includes(s))
  const keptLine = untouched.length ? ` kept your ${listNames(untouched)}.` : ''
  return `${who} ${changed}.${keptLine}`
}
```

- [ ] **Step 4: Run the tests.** Expected PASS (6 tests); eslint clean.

- [ ] **Step 5: Commit** (`--only` both files): `bing bong: what a turn changed, in one line`.

### Task 5: The shared folder, in main

**Files:** Create `src/main/bingBongFolder.ts`, `src/main/bingBongActions.ts`,
`src/main/bingBongActions.test.ts`. Needs plan 1's `audioContentId.ts`.

- [ ] **Step 1: Write the failing tests.** Create `src/main/bingBongActions.test.ts`. It uses
real temp directories and real hashing, and imports nothing from `electron`, so it runs in CI:

```ts
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Rifff } from '@shared/types'
import { endTurn, joinBingBong, readBingBong, startBingBong } from './bingBongActions'
import { resetContentIdCacheForTests } from './audioContentId'

let root: string
let drive: string
let lib: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bing-bong-test-'))
  drive = join(root, 'drive')
  lib = join(root, 'lib')
  mkdirSync(drive)
  mkdirSync(lib)
  resetContentIdCacheForTests()
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function audio(name: string, bytes: string): string {
  const path = join(lib, name)
  writeFileSync(path, bytes)
  return path
}

function riff(groupId: string, paths: string[]): Rifff {
  return {
    groupId,
    name: groupId,
    bpm: 100,
    barLength: 4,
    folderPath: lib,
    stems: paths.map((path, i) => ({
      slot: i + 1,
      author: 'x',
      name: `stem ${i + 1}`,
      type: 'fx',
      path,
      durationSec: 9.6,
      barLength: 4
    }))
  }
}

const now = new Date('2026-10-12T10:00:00Z')

async function started(): Promise<string> {
  const r = await startBingBong(
    {
      parentFolder: drive,
      name: 'elling-and-ben',
      me: 'elling',
      meEmail: 'e@x.y',
      other: 'ben',
      otherEmail: 'b@x.y',
      rifff: riff('g1', [audio('drums.wav', 'drums'), audio('bass.wav', 'bass')]),
      vol: {},
      mute: {}
    },
    now
  )
  if (!r.ok) throw new Error(r.error)
  return r.folder
}

describe('startBingBong', () => {
  it('lays out the folder and plays turn 1 with its audio', async () => {
    const folder = await started()
    expect(readdirSync(folder).sort()).toEqual(['audio', 'bingbong.json', 'players', 'turns'])
    expect(readdirSync(join(folder, 'turns'))).toEqual(['0001-elling.json'])
    expect(readdirSync(join(folder, 'players'))).toEqual(['elling.json'])
    expect(readdirSync(join(folder, 'audio'))).toHaveLength(2)

    const read = readBingBong(folder)
    if (!read.ok) throw new Error(read.error)
    expect(read.snapshot.resolution.applied.map((t) => t.turn)).toEqual([1])
    expect(read.snapshot.resolution.whoseTurn).toBe('ben')
    expect(read.snapshot.file.players[1]).toEqual({ username: 'ben', inviteEmail: 'b@x.y' })
  })

  it('refuses a folder that already has a bing bong, and playing yourself', async () => {
    await started()
    const again = await startBingBong({
      parentFolder: drive,
      name: 'elling-and-ben',
      me: 'elling',
      other: 'ben',
      rifff: riff('g', [audio('a.wav', 'a')]),
      vol: {},
      mute: {}
    })
    expect(again).toEqual({ ok: false, error: 'that folder already has a bing bong in it' })
    const self = await startBingBong({
      parentFolder: drive,
      name: 'solo',
      me: 'elling',
      other: 'elling',
      rifff: riff('g', [audio('a.wav', 'a')]),
      vol: {},
      mute: {}
    })
    expect(self).toEqual({ ok: false, error: "you can't bing bong yourself" })
  })
})

describe('joinBingBong', () => {
  it('writes the joiner’s player file', async () => {
    const folder = await started()
    const joined = joinBingBong(folder, 'ben', 'ben@x.y')
    if (!joined.ok) throw new Error(joined.error)
    expect(joined.snapshot.players.ben).toEqual({
      format: 'bingbong-player/1',
      username: 'ben',
      displayName: 'ben',
      email: 'ben@x.y'
    })
  })

  it('refuses someone who is not a player', async () => {
    const folder = await started()
    expect(joinBingBong(folder, 'rowan', undefined)).toEqual({
      ok: false,
      error: "this bing bong is between elling and ben; you're rowan"
    })
  })
})

describe('endTurn', () => {
  it('copies only new audio: a remix turn adds none', async () => {
    const folder = await started()
    const audioDir = join(folder, 'audio')
    const read = readBingBong(folder)
    if (!read.ok) throw new Error(read.error)
    const sharedPaths = readdirSync(audioDir).map((f) => join(audioDir, f))

    const remix = await endTurn(
      { folder, me: 'ben', rifff: riff('d', sharedPaths), vol: {}, mute: {}, chat: 'same' },
      now
    )
    if (!remix.ok) throw new Error(remix.error)
    expect(remix.turn.turn).toBe(2)
    expect(remix.turn.audioAdded).toEqual([])
    expect(readdirSync(audioDir)).toHaveLength(2)

    const added = await endTurn(
      {
        folder,
        me: 'elling',
        rifff: riff('e', [...sharedPaths, audio('pad.wav', 'pad')]),
        vol: {},
        mute: {},
        chat: ''
      },
      now
    )
    if (!added.ok) throw new Error(added.error)
    expect(added.turn.audioAdded).toHaveLength(1)
    expect(readdirSync(audioDir)).toHaveLength(3)
  })

  it('refuses out of turn and leaves no file behind', async () => {
    const folder = await started()
    const r = await endTurn({
      folder,
      me: 'elling',
      rifff: riff('x', [audio('n.wav', 'n')]),
      vol: {},
      mute: {},
      chat: ''
    })
    expect(r).toEqual({ ok: false, error: "it isn't your turn" })
    expect(readdirSync(join(folder, 'turns'))).toEqual(['0001-elling.json'])
    expect(readdirSync(join(folder, 'audio'))).toHaveLength(2)
  })

  it('names a stem whose audio is missing', async () => {
    const folder = await started()
    const r = await endTurn({
      folder,
      me: 'ben',
      rifff: riff('x', [join(lib, 'gone.wav')]),
      vol: {},
      mute: {},
      chat: ''
    })
    expect(r).toEqual({ ok: false, error: "can't read the audio for stem 1" })
  })

  it('a turn whose audio has not synced reads as pending', async () => {
    const folder = await started()
    const audioDir = join(folder, 'audio')
    const r = await endTurn({
      folder,
      me: 'ben',
      rifff: riff('x', [audio('late.wav', 'late')]),
      vol: {},
      mute: {},
      chat: ''
    })
    if (!r.ok) throw new Error(r.error)
    rmSync(join(audioDir, `${r.turn.audioAdded[0]}.wav`))
    const read = readBingBong(folder)
    if (!read.ok) throw new Error(read.error)
    expect(read.snapshot.resolution.pending?.turn).toBe(2)
    expect(read.snapshot.resolution.whoseTurn).toBe('ben')
  })
})
```

- [ ] **Step 2: Run to see them fail.** `npx vitest run src/main/bingBongActions.test.ts`,
expected FAIL.

- [ ] **Step 3: The folder primitives.** Create `src/main/bingBongFolder.ts`:

```ts
// src/main/bingBongFolder.ts -- reading and writing a bing bong's shared folder (Google Drive for
// desktop, Dropbox, iCloud: to us it's a folder). Spec:
// docs/superpowers/specs/2026-10-10-bing-bong-design.md ("The folder").
//
// Every file has one writer. bingbong.json and turn files are written once and never replaced;
// audio files are named by content id, so one that exists is already right. Every write goes to
// a temp name first and is renamed into place, so the other Mac never syncs half a file. Temp
// names end in `.tmp`, which neither the turn-file pattern nor the audio pattern accepts.

import { randomBytes } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import {
  audioFileName,
  parseBingBongFile,
  parsePlayerFile,
  parseTurnFileName,
  type BingBongFile,
  type BingBongPlayerFile,
  type BingBongTurnFile
} from '@shared/bingBongFormat'
import type { TurnFolderEntry } from '@shared/bingBongRules'
import type { TurnAudioCopy } from '@shared/bingBongTurns'

export const BING_BONG_FILE = 'bingbong.json'

const AUDIO_FILE_PATTERN = /^(sha256-[0-9a-f]{64})\.[a-z0-9]{1,5}$/

export function audioDirOf(folder: string): string {
  return join(folder, 'audio')
}

function turnsDirOf(folder: string): string {
  return join(folder, 'turns')
}

function playersDirOf(folder: string): string {
  return join(folder, 'players')
}

function tempPathFor(path: string): string {
  return `${path}.${randomBytes(4).toString('hex')}.tmp`
}

/** Writes `data` to a temp name beside `path`, then renames it into place. With `once`, refuses
 * (throws) when `path` already exists: bingbong.json and turn files are never replaced. */
function writeInPlace(path: string, data: string, once: boolean): void {
  if (once && existsSync(path)) throw new Error(`${path} already exists`)
  const temp = tempPathFor(path)
  try {
    writeFileSync(temp, data)
    renameSync(temp, path)
  } catch (err) {
    try {
      unlinkSync(temp)
    } catch {
      // never written, or already renamed
    }
    throw err
  }
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

/** Makes the folder's layout and writes bingbong.json and the creator's player file. Refuses a
 * folder that already holds a bing bong. */
export function createBingBongFolder(
  folder: string,
  file: BingBongFile,
  creator: BingBongPlayerFile
): void {
  mkdirSync(turnsDirOf(folder), { recursive: true })
  mkdirSync(audioDirOf(folder), { recursive: true })
  mkdirSync(playersDirOf(folder), { recursive: true })
  writeInPlace(join(folder, BING_BONG_FILE), json(file), true)
  writePlayerFile(folder, creator)
}

/** A player's own file. Only that player ever writes it, so replacing it is safe. */
export function writePlayerFile(folder: string, player: BingBongPlayerFile): void {
  mkdirSync(playersDirOf(folder), { recursive: true })
  writeInPlace(join(playersDirOf(folder), `${player.username}.json`), json(player), false)
}

export interface BingBongFolderContents {
  file: BingBongFile
  players: Record<string, BingBongPlayerFile>
  entries: TurnFolderEntry[]
  audioIds: Set<string>
}

function listOrEmpty(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

/** Everything a bing bong's folder holds, read fresh. Turn files are returned raw: which ones
 * count is resolveTurns' job (@shared/bingBongRules). */
export function readBingBongFolder(
  folder: string
): { ok: true; value: BingBongFolderContents } | { ok: false; error: string } {
  let raw: string
  try {
    raw = readFileSync(join(folder, BING_BONG_FILE), 'utf-8')
  } catch {
    return { ok: false, error: "there's no bing bong in that folder" }
  }
  const parsed = parseBingBongFile(raw)
  if (!parsed.ok) return { ok: false, error: `bingbong.json: ${parsed.error}` }

  const players: Record<string, BingBongPlayerFile> = {}
  for (const name of listOrEmpty(playersDirOf(folder))) {
    if (!name.endsWith('.json')) continue
    try {
      const player = parsePlayerFile(readFileSync(join(playersDirOf(folder), name), 'utf-8'))
      if (player.ok && name === `${player.value.username}.json`)
        players[player.value.username] = player.value
    } catch {
      // unreadable mid-sync: read again next time
    }
  }

  const entries: TurnFolderEntry[] = []
  for (const fileName of listOrEmpty(turnsDirOf(folder))) {
    if (!parseTurnFileName(fileName)) continue
    try {
      entries.push({ fileName, json: readFileSync(join(turnsDirOf(folder), fileName), 'utf-8') })
    } catch {
      // unreadable mid-sync: read again next time
    }
  }

  const audioIds = new Set<string>()
  for (const name of listOrEmpty(audioDirOf(folder))) {
    const match = AUDIO_FILE_PATTERN.exec(name)
    if (match) audioIds.add(match[1])
  }

  return { ok: true, value: { file: parsed.value, players, entries, audioIds } }
}

/** Copies each new audio file into audio/ under its content id. One already there is skipped:
 * the same id is the same bytes. */
export function copyAudioInto(folder: string, copies: readonly TurnAudioCopy[]): void {
  const dir = audioDirOf(folder)
  mkdirSync(dir, { recursive: true })
  for (const copy of copies) {
    const target = join(dir, audioFileName(copy.contentId, copy.ext))
    if (existsSync(target)) continue
    const temp = tempPathFor(target)
    try {
      copyFileSync(copy.from, temp)
      renameSync(temp, target)
    } catch (err) {
      try {
        unlinkSync(temp)
      } catch {
        // never written, or already renamed
      }
      throw err
    }
  }
}

/** Writes a turn file. Refuses (throws) if that turn file already exists. */
export function writeTurnFile(folder: string, fileName: string, turn: BingBongTurnFile): void {
  mkdirSync(turnsDirOf(folder), { recursive: true })
  writeInPlace(join(turnsDirOf(folder), fileName), json(turn), true)
}
```

- [ ] **Step 4: Start, join, read, end turn.** Create `src/main/bingBongActions.ts`:

```ts
// src/main/bingBongActions.ts -- starting, joining, reading and taking a turn in a bing bong. Pure
// rules live in @shared/bingBong*; this does the file work in the order the spec requires: audio
// first, then the turn file, so a turn file that exists always has its audio. Spec:
// docs/superpowers/specs/2026-10-10-bing-bong-design.md ("How a bing bong goes", "Taking a turn").

import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  BING_BONG_FORMAT,
  BING_BONG_PLAYER_FORMAT,
  type BingBongFile,
  type BingBongPlayerFile,
  type BingBongTurnFile
} from '@shared/bingBongFormat'
import { resolveTurns, type TurnResolution } from '@shared/bingBongRules'
import { buildTurnFile, type AudioIdentity } from '@shared/bingBongTurns'
import type { Rifff } from '@shared/types'
import { audioExtension, contentIdForFile } from './audioContentId'
import {
  BING_BONG_FILE,
  audioDirOf,
  copyAudioInto,
  createBingBongFolder,
  readBingBongFolder,
  writePlayerFile,
  writeTurnFile
} from './bingBongFolder'

export type Outcome<T> = ({ ok: true } & T) | { ok: false; error: string }

export interface BingBongSnapshot {
  folder: string
  audioDir: string
  file: BingBongFile
  players: Record<string, BingBongPlayerFile>
  resolution: TurnResolution
}

export function readBingBong(folder: string): Outcome<{ snapshot: BingBongSnapshot }> {
  const read = readBingBongFolder(folder)
  if (!read.ok) return read
  const { file, players, entries, audioIds } = read.value
  const resolution = resolveTurns(file, entries, (id) => audioIds.has(id))
  return {
    ok: true,
    snapshot: { folder, audioDir: audioDirOf(folder), file, players, resolution }
  }
}

export interface EndTurnRequest {
  folder: string
  me: string
  rifff: Rifff
  vol: Record<string, number>
  mute: Record<string, boolean>
  chat: string
}

/** Takes my turn: works out the turn file, copies the audio the folder lacks, then writes the
 * turn file. Retrying after a failure is safe: audio already copied is skipped, and a turn file
 * that got written means the turn is taken (the retry is then refused as out of turn). */
export async function endTurn(
  request: EndTurnRequest,
  now = new Date()
): Promise<Outcome<{ turn: BingBongTurnFile }>> {
  const read = readBingBongFolder(request.folder)
  if (!read.ok) return read
  const { file, entries, audioIds } = read.value
  if (!file.players.some((p) => p.username === request.me))
    return { ok: false, error: `${request.me} isn't a player in this bing bong` }
  const resolution = resolveTurns(file, entries, (id) => audioIds.has(id))

  const identities = new Map<string, AudioIdentity>()
  for (const stem of request.rifff.stems) {
    if (identities.has(stem.path)) continue
    try {
      identities.set(stem.path, {
        contentId: await contentIdForFile(stem.path),
        ext: audioExtension(stem.path)
      })
    } catch {
      return { ok: false, error: `can't read the audio for ${stem.name}` }
    }
  }

  const built = buildTurnFile({
    bingBongId: file.id,
    me: request.me,
    resolution,
    rifff: request.rifff,
    vol: request.vol,
    mute: request.mute,
    identities,
    hasAudio: (id) => audioIds.has(id),
    chat: request.chat,
    now
  })
  if (!built.ok) return built

  try {
    copyAudioInto(request.folder, built.copies)
  } catch (err) {
    console.error('bing bong: copying audio failed:', err)
    return { ok: false, error: "couldn't copy the audio into the shared folder" }
  }
  try {
    writeTurnFile(request.folder, built.fileName, built.turn)
  } catch (err) {
    console.error('bing bong: writing the turn failed:', err)
    return { ok: false, error: "couldn't write the turn into the shared folder" }
  }
  return { ok: true, turn: built.turn }
}

export interface StartRequest {
  /** The folder the bing bong's own folder is made in (e.g. a shared Drive folder). */
  parentFolder: string
  name: string
  me: string
  meEmail?: string
  other: string
  otherEmail?: string
  rifff: Rifff
  vol: Record<string, number>
  mute: Record<string, boolean>
}

const NAME_PATTERN = /^[a-z0-9][a-z0-9 _-]{0,62}$/i

/** Makes the bing bong's folder inside `parentFolder` and plays turn 1. */
export async function startBingBong(
  request: StartRequest,
  now = new Date()
): Promise<Outcome<{ folder: string; file: BingBongFile; turn: BingBongTurnFile }>> {
  if (!NAME_PATTERN.test(request.name)) return { ok: false, error: 'pick a simpler name' }
  if (request.me === request.other) return { ok: false, error: "you can't bing bong yourself" }
  const folder = join(request.parentFolder, request.name)
  if (existsSync(join(folder, BING_BONG_FILE)))
    return { ok: false, error: 'that folder already has a bing bong in it' }

  const file: BingBongFile = {
    format: BING_BONG_FORMAT,
    id: `bb_${randomBytes(5).toString('hex')}`,
    name: request.name,
    createdAt: now.toISOString(),
    createdBy: request.me,
    players: [
      { username: request.me },
      {
        username: request.other,
        ...(request.otherEmail ? { inviteEmail: request.otherEmail } : {})
      }
    ]
  }
  const creator: BingBongPlayerFile = {
    format: BING_BONG_PLAYER_FORMAT,
    username: request.me,
    displayName: request.me,
    ...(request.meEmail ? { email: request.meEmail } : {})
  }
  try {
    createBingBongFolder(folder, file, creator)
  } catch (err) {
    console.error('bing bong: creating the folder failed:', err)
    return { ok: false, error: "couldn't make the bing bong's folder" }
  }

  const first = await endTurn(
    {
      folder,
      me: request.me,
      rifff: request.rifff,
      vol: request.vol,
      mute: request.mute,
      chat: ''
    },
    now
  )
  if (!first.ok) return first
  return { ok: true, folder, file, turn: first.turn }
}

/** Joins as the other player: writes my player file. I must be one of the two players. */
export function joinBingBong(
  folder: string,
  me: string,
  email: string | undefined
): Outcome<{ snapshot: BingBongSnapshot }> {
  const read = readBingBong(folder)
  if (!read.ok) return read
  const { file } = read.snapshot
  if (!file.players.some((p) => p.username === me)) {
    const names = file.players.map((p) => p.username).join(' and ')
    return { ok: false, error: `this bing bong is between ${names}; you're ${me}` }
  }
  try {
    writePlayerFile(folder, {
      format: BING_BONG_PLAYER_FORMAT,
      username: me,
      displayName: me,
      ...(email ? { email } : {})
    })
  } catch (err) {
    console.error('bing bong: writing the player file failed:', err)
    return { ok: false, error: "couldn't write to the shared folder" }
  }
  return readBingBong(folder)
}
```

- [ ] **Step 5: Run the tests.** Expected PASS (8 tests). `npx eslint src/main/bingBongFolder.ts src/main/bingBongActions.ts src/main/bingBongActions.test.ts`,
no output.

- [ ] **Step 6: Commit** (`--only` the three files): `bing bong: read and write the shared folder`.

### Task 6: IPC

**Files:** Create `src/main/bingBongIpc.ts`; modify `src/main/index.ts`, `src/preload/index.ts`

- [ ] **Step 1: The channels.** Create `src/main/bingBongIpc.ts`:

```ts
// src/main/bingBongIpc.ts -- bing bong's IPC surface (spec:
// docs/superpowers/specs/2026-10-10-bing-bong-design.md). The renderer picks the folder with the
// existing 'pick-folder' and says who "me" is from the bing bong's own link; everything that
// touches the shared folder happens here.

import type { IpcMain } from 'electron'
import {
  endTurn,
  joinBingBong,
  readBingBong,
  startBingBong,
  type EndTurnRequest,
  type StartRequest
} from './bingBongActions'

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== ''
}

const NOT_A_FOLDER = { ok: false as const, error: 'no folder given' }

export function registerBingBongIpc(
  ipcMain: IpcMain,
  deps: { ownUsername: () => string | null }
): void {
  ipcMain.handle('bingbong:whoami', (): string | null => deps.ownUsername())

  ipcMain.handle('bingbong:read', (_event, folder: unknown) =>
    isNonEmptyString(folder) ? readBingBong(folder) : NOT_A_FOLDER
  )

  ipcMain.handle('bingbong:start', (_event, request: StartRequest) =>
    isNonEmptyString(request?.parentFolder) ? startBingBong(request) : NOT_A_FOLDER
  )

  ipcMain.handle('bingbong:join', (_event, folder: unknown, me: unknown, email: unknown) => {
    if (!isNonEmptyString(folder)) return NOT_A_FOLDER
    if (!isNonEmptyString(me)) return { ok: false as const, error: 'who are you?' }
    return joinBingBong(folder, me, isNonEmptyString(email) ? email : undefined)
  })

  ipcMain.handle('bingbong:end-turn', (_event, request: EndTurnRequest) =>
    isNonEmptyString(request?.folder) ? endTurn(request) : NOT_A_FOLDER
  )
}
```

The folder picker is the existing `'pick-folder'` (`window.rifffApi.pickFolder`).

- [ ] **Step 2: Register them.** In `src/main/index.ts`, beside `registerReonedCopiesIpc`:

```diff
--- a/src/main/index.ts
+++ b/src/main/index.ts
@@ -59,6 +59,7 @@ import { jamNamesFor, stemJamsForPaths } from './stemJams'
 import { bakeOffset, type BakeJob } from './bakeOffset'
 import { setStemMetadataDurationLookup } from './reonedRebuild'
 import { registerReonedCopiesIpc } from './reonedCopiesIpc'
+import { registerBingBongIpc } from './bingBongIpc'
 import { createEngineStopper } from './engineStop'
 import { createMetronomeSetting } from './metronomeSetting'
 import { claimSingleInstance } from './singleInstance'
@@ -1398,6 +1399,7 @@ app.whenReady().then(async () => {
     bakeOffset(jobs, bakeAssetsDir(), { mayCreateRoot: isDefaultLibraryRoot() })
   )
   registerReonedCopiesIpc(ipcMain)
+  registerBingBongIpc(ipcMain, { ownUsername: () => ownUsername })
 
   ipcMain.handle('shape-materialize', (_event, request: ShapeMaterializeRequest) =>
     materializeShape(request, shapeAssetsDir(), { mayCreateRoot: isDefaultLibraryRoot() })
```

- [ ] **Step 3: Expose them.** In `src/preload/index.ts`, just after `pickFolder`:

```diff
--- a/src/preload/index.ts
+++ b/src/preload/index.ts
@@ -21,6 +21,13 @@ import type {
 } from '@shared/riffLibraryTypes'
 import type { LinkLoopFolderResult, LoopEntry, LoopFolderListing } from '@shared/loopFolderTypes'
 import type { PluginCatalog } from '../main/pluginCatalog'
+import type {
+  BingBongSnapshot,
+  EndTurnRequest,
+  Outcome,
+  StartRequest
+} from '../main/bingBongActions'
+import type { BingBongFile, BingBongTurnFile } from '@shared/bingBongFormat'
 import type { DiscoverCandidate } from '../main/discoverCandidates'
 import type { ArtistIndex, ArtistMode, KeepRefused } from '@shared/discoverArtist'
 import type { ArtistScanBatch } from '../main/discoverArtistScanQueue'
@@ -116,6 +123,23 @@ const api = {
   ): Promise<Stem | null> =>
     ipcRenderer.invoke('import-recorded-stem', path, rifffBpm, loopBars, existingSlots),
   pickFolder: (): Promise<string | null> => ipcRenderer.invoke('pick-folder'),
+
+  // bing bong (src/main/bingBongIpc.ts).
+  bingBongWhoami: (): Promise<string | null> => ipcRenderer.invoke('bingbong:whoami'),
+  bingBongRead: (folder: string): Promise<Outcome<{ snapshot: BingBongSnapshot }>> =>
+    ipcRenderer.invoke('bingbong:read', folder),
+  bingBongStart: (
+    request: StartRequest
+  ): Promise<Outcome<{ folder: string; file: BingBongFile; turn: BingBongTurnFile }>> =>
+    ipcRenderer.invoke('bingbong:start', request),
+  bingBongJoin: (
+    folder: string,
+    me: string,
+    email: string | null
+  ): Promise<Outcome<{ snapshot: BingBongSnapshot }>> =>
+    ipcRenderer.invoke('bingbong:join', folder, me, email),
+  bingBongEndTurn: (request: EndTurnRequest): Promise<Outcome<{ turn: BingBongTurnFile }>> =>
+    ipcRenderer.invoke('bingbong:end-turn', request),
   pickRifffImportPaths: (): Promise<string[]> => ipcRenderer.invoke('pick-rifff-import-paths'),
   // Linked loop folders -- see the loop-folders-* handlers in main/index.ts.
   // Pick with pickFolder above, then link the path.
```

`src/preload/index.d.ts` needs no change (`RifffApi = typeof api`).

- [ ] **Step 4: Typecheck and lint.** `npm run typecheck && npx eslint src/main/bingBongIpc.ts src/main/index.ts src/preload/index.ts`.

- [ ] **Step 5: Commit** (`--only` the three files): `bing bong: ipc`.

### Task 7: The link, and turns arriving, in the store

**Files:** Modify `src/renderer/src/state/store.ts`, `src/renderer/src/state/history.ts`; create
`src/renderer/src/state/bingBongTimeline.ts`, `bingBongTimeline.test.ts`

- [ ] **Step 1: Write the failing tests.** Create `src/renderer/src/state/bingBongTimeline.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { BingBongTurnFile } from '@shared/bingBongFormat'
import { bingBongTurnGroupId, type BingBongLink } from '@shared/bingBongTurns'
import type { Rifff } from '@shared/types'
import { appendTurnsAction, timelineEndBar } from './bingBongTimeline'
import { createHistoryState, historyReducer } from './history'
import { initialState, reducer, type AppState } from './store'
import { deserializeProject, serializeProject } from './serialize'

const A = 'sha256-' + 'a'.repeat(64)

function turn(n: number): BingBongTurnFile {
  return {
    format: 'bingbong-turn/1',
    bingBong: 'bb_t',
    turn: n,
    parent: n === 1 ? null : n - 1,
    player: n % 2 ? 'elling' : 'ben',
    playedAt: '2026-10-12T10:00:00Z',
    chat: '',
    riff: {
      name: `turn ${n}`,
      bpm: 100,
      barLength: 4,
      stems: [
        {
          slot: 1,
          audio: A,
          ext: 'wav',
          author: 'x',
          name: 'drums',
          type: 'drums',
          durationSec: 9.6,
          barLength: 4,
          gain: 0.5,
          muted: false
        }
      ]
    },
    audioAdded: []
  }
}

const LINK: BingBongLink = {
  id: 'bb_t',
  name: 'elling-and-ben',
  folderPath: '/drive/elling-and-ben',
  me: 'ben',
  other: 'elling'
}

function draftRifff(): Rifff {
  return {
    groupId: 'draft',
    name: 'draft',
    bpm: 100,
    barLength: 8,
    folderPath: '/x',
    stems: [
      { slot: 1, author: 'x', name: 'a', type: 'fx', path: '/a.wav', durationSec: 9, barLength: 8 }
    ]
  }
}

function base(): AppState {
  return { ...initialState, bingBong: LINK }
}

describe('appendTurnsAction', () => {
  it('places new turns one after another at the end, skipping ones already there', () => {
    let s = base()
    const first = appendTurnsAction(s, [turn(1)], '/drive/audio')
    if (!first) throw new Error('expected an action')
    s = reducer(s, first)
    const action = appendTurnsAction(s, [turn(3), turn(1), turn(2)], '/drive/audio')
    expect(
      action?.type === 'APPEND_BING_BONG_TURNS' && action.turns.map((t) => t.startBar)
    ).toEqual([4, 8])
    if (!action) throw new Error('expected an action')
    s = reducer(s, action)
    const g2 = bingBongTurnGroupId('bb_t', 2)
    expect(s.rifffs[g2].locked).toBe(true)
    expect(s.rifffs[g2].startBar).toBe(4)
    expect(s.vol[`${g2}:1`]).toBe(0.5)
    expect(timelineEndBar(s)).toBe(12)
  })

  it('is null when nothing is new', () => {
    const s = reducer(base(), appendTurnsAction(base(), [turn(1)], '/a')!)
    expect(appendTurnsAction(s, [turn(1)], '/a')).toBeNull()
  })

  it('replaces my draft with my turn and clears it from the link', () => {
    let s = reducer(base(), appendTurnsAction(base(), [turn(1)], '/a')!)
    s = reducer(s, { type: 'ADD_TO_SHELF', rifff: draftRifff() })
    s = reducer(s, { type: 'PLACE_ON_TIMELINE', groupId: 'draft', startBar: 4 })
    s = reducer(s, { type: 'SET_BING_BONG_LINK', link: { ...LINK, draftGroupId: 'draft' } })
    const action = appendTurnsAction(s, [turn(2)], '/a', 'draft')
    expect(action?.type === 'APPEND_BING_BONG_TURNS' && action.turns[0].startBar).toBe(4)
    s = reducer(s, action!)
    expect(s.rifffs.draft).toBeUndefined()
    expect(s.bingBong).toEqual(LINK)
  })
})

describe('turns in the history', () => {
  it('land in every undo step, so undo never removes one', () => {
    let h = createHistoryState(base())
    h = historyReducer(h, { type: 'SET_TEMPO', bpm: 90 })
    h = historyReducer(h, appendTurnsAction(h.present, [turn(1)], '/a')!)
    expect(h.past).toHaveLength(1)
    h = historyReducer(h, { type: 'UNDO' })
    expect(h.present.bpm).toBe(80)
    expect(h.present.rifffs[bingBongTurnGroupId('bb_t', 1)]).toBeDefined()
  })

  it('are locked once there', () => {
    let h = createHistoryState(base())
    h = historyReducer(h, appendTurnsAction(h.present, [turn(1)], '/a')!)
    const before = h
    h = historyReducer(h, {
      type: 'REMOVE_FROM_TIMELINE',
      groupId: bingBongTurnGroupId('bb_t', 1)
    })
    expect(h).toBe(before)
  })
})

describe('saving', () => {
  it('keeps the link, and an old project has none', () => {
    const json = serializeProject({ ...base(), bingBong: { ...LINK, draftGroupId: 'd' } })
    expect(deserializeProject(JSON.parse(json)).state.bingBong).toEqual({
      ...LINK,
      draftGroupId: 'd'
    })
    const old = JSON.parse(serializeProject(initialState)) as Record<string, unknown>
    delete old.bingBong
    expect(deserializeProject(old as never).state.bingBong).toBeNull()
  })
})
```

- [ ] **Step 2: Run to see them fail.** Expected FAIL.

- [ ] **Step 3: The field and the two actions.** In `src/renderer/src/state/store.ts`:

```diff
--- a/src/renderer/src/state/store.ts
+++ b/src/renderer/src/state/store.ts
@@ -1,5 +1,6 @@
 import { TYPE_ORDER, stemKey, type BusId, type Rifff, type SoundType } from '@shared/types'
 import { applyReonedRepair } from '@shared/reonedRepair'
+import type { BingBongLink, PlacedTurn } from '@shared/bingBongTurns'
 import { sqrtGain } from '@shared/mixGain'
 import {
   DEFAULT_REVERB,
@@ -555,6 +556,9 @@ export interface AppState {
    * you are in the flow is not an arrangement edit. */
   coach: CoachState | null
   rifffs: Record<string, Rifff>
+  /** Set only on a bing bong sketch (spec: docs/superpowers/specs/2026-10-10-bing-bong-design.md):
+   * which bing bong, where its folder is, who I am in it. Saved with the project. */
+  bingBong: BingBongLink | null
 }
 
 export const initialState: AppState = {
@@ -606,7 +610,8 @@ export const initialState: AppState = {
   reverb: DEFAULT_REVERB,
   risers: {},
   coach: null,
-  rifffs: {}
+  rifffs: {},
+  bingBong: null
 }
 
 /** The live store's state before any project is created or opened (StoreProvider): initialState
@@ -672,6 +677,12 @@ export type Action =
       mute?: Record<string, boolean>
     }
   | { type: 'SEQUENCE_RIFFFS'; groupIds: string[] }
+  // A bing bong's turns arriving (or my own just ended), each a locked riff at the startBar the
+  // dispatcher worked out from the present (appendTurnsAction). history.ts applies it to every
+  // undo step: a turn is the other player's, not something Cmd+Z takes back. replaceDraft is the
+  // draft riff that my ended turn replaces.
+  | { type: 'APPEND_BING_BONG_TURNS'; turns: PlacedTurn[]; replaceDraft?: string }
+  | { type: 'SET_BING_BONG_LINK'; link: BingBongLink | null }
   | { type: 'SELECT'; groupId: string }
   | { type: 'SET_TEMPO'; bpm: number }
   | { type: 'CYCLE_SNAP' }
@@ -1676,6 +1687,34 @@ export function reducer(state: AppState, action: Action): AppState {
       }
     }
 
+    case 'APPEND_BING_BONG_TURNS': {
+      let next = state
+      const draft = action.replaceDraft
+      if (draft !== undefined) {
+        if (next.rifffs[draft] && !next.rifffs[draft].locked)
+          next = reducer(next, { type: 'DELETE_RIFFFS', groupIds: [draft] })
+        if (next.bingBong?.draftGroupId === draft) {
+          const link = { ...next.bingBong }
+          delete link.draftGroupId
+          next = { ...next, bingBong: link }
+        }
+      }
+      for (const turn of action.turns) {
+        if (next.rifffs[turn.rifff.groupId]) continue
+        next = reducer(next, {
+          type: 'PLACE_LOOP_ON_TIMELINE',
+          stems: [turn.rifff],
+          startBar: turn.startBar,
+          vol: turn.vol,
+          mute: turn.mute
+        })
+      }
+      return next
+    }
+
+    case 'SET_BING_BONG_LINK':
+      return { ...state, bingBong: action.link }
+
     case 'SET_VOLUME':
       return {
         ...state,
```

`PersistedProject` omits named fields, so `bingBong` is saved with no serializer change.
`deserializeProject` spreads over `initialState`, so an older project loads with `bingBong: null`.
The `saving` test checks both.

- [ ] **Step 4: Every undo step gets the turn.** In `src/renderer/src/state/history.ts`, before
the locked-riff check plan 1 added:

```diff
--- a/src/renderer/src/state/history.ts
+++ b/src/renderer/src/state/history.ts
@@ -314,6 +314,17 @@ export function historyReducer(state: HistoryState, action: HistoryAction): Hist
     return unchanged ? state : { past, present, future }
   }
 
+  // A bing bong turn arriving: the other player's move, so it lands in every step of the history
+  // and no undo or redo takes it away. Not an edit, so no undo step of its own.
+  if (action.type === 'APPEND_BING_BONG_TURNS') {
+    const append = (s: AppState): AppState => reducer(s, action)
+    return {
+      past: state.past.map(append),
+      present: append(state.present),
+      future: state.future.map(append)
+    }
+  }
+
   const present = reducer(state.present, action)
   if (editsLockedRiff(state.present, present)) return state
 
```

- [ ] **Step 5: Where turns go.** Create `src/renderer/src/state/bingBongTimeline.ts`:

```ts
// src/renderer/src/state/bingBongTimeline.ts -- where a bing bong's turns go on the timeline:
// one after another, each after everything already placed. Spec:
// docs/superpowers/specs/2026-10-10-bing-bong-design.md ("The bing bong sketch").

import type { BingBongTurnFile } from '@shared/bingBongFormat'
import { turnToRifff, type PlacedTurn } from '@shared/bingBongTurns'
import { resolvedPlayedBarsFromFields } from './selectors'
import type { Action, AppState } from './store'

/** The bar after the last placed riff ends (risers aside); 0 on an empty timeline. `except` is
 * left out: the draft my ended turn replaces. */
export function timelineEndBar(state: AppState, except?: string): number {
  let end = 0
  for (const rifff of Object.values(state.rifffs)) {
    if (rifff.startBar === undefined || rifff.groupId === except) continue
    const played = resolvedPlayedBarsFromFields(state.playedBars[rifff.groupId], rifff.barLength)
    end = Math.max(end, rifff.startBar + played)
  }
  return end
}

/** The action that puts every turn not yet in the project at the end of the timeline, in turn
 * order. Null when there is nothing new. */
export function appendTurnsAction(
  state: AppState,
  turns: readonly BingBongTurnFile[],
  audioDir: string,
  replaceDraft?: string
): Action | null {
  let startBar = timelineEndBar(state, replaceDraft)
  const placed: PlacedTurn[] = []
  for (const turn of [...turns].sort((a, b) => a.turn - b.turn)) {
    const asRifff = turnToRifff(turn, audioDir)
    if (state.rifffs[asRifff.rifff.groupId]) continue
    placed.push({ ...asRifff, startBar })
    startBar += asRifff.rifff.barLength
  }
  if (placed.length === 0 && replaceDraft === undefined) return null
  return {
    type: 'APPEND_BING_BONG_TURNS',
    turns: placed,
    ...(replaceDraft !== undefined ? { replaceDraft } : {})
  }
}
```

- [ ] **Step 6: Run the tests.** `npx vitest run src/renderer/src/state`, expected PASS. Then
typecheck, and eslint on the four files.

- [ ] **Step 7: Commit** (`--only` the four files): `bing bong: the project's link, and turns arriving`.

### Task 8: Where it stands

**Files:** Create `src/renderer/src/state/bingBongStatus.ts`, `bingBongStatus.test.ts`

- [ ] **Step 1: Write the failing tests.** Create `src/renderer/src/state/bingBongStatus.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { BingBongTurnFile } from '@shared/bingBongFormat'
import type { TurnResolution } from '@shared/bingBongRules'
import type { BingBongLink } from '@shared/bingBongTurns'
import { bingBongStatusLine, type BingBongStatus } from './bingBongStatus'

const LINK: BingBongLink = { id: 'bb', name: 'n', folderPath: '/f', me: 'ben', other: 'elling' }

function status(resolution: Partial<TurnResolution>): BingBongStatus {
  return {
    link: LINK,
    snapshot: {
      folder: '/f',
      audioDir: '/f/audio',
      file: {
        format: 'bingbong/1',
        id: 'bb',
        name: 'n',
        createdAt: '2026-10-10T00:00:00Z',
        createdBy: 'elling',
        players: [{ username: 'elling' }, { username: 'ben' }]
      },
      players: {},
      resolution: {
        applied: [],
        pending: null,
        problems: [],
        whoseTurn: 'ben',
        nextTurn: 2,
        ...resolution
      }
    }
  }
}

describe('bingBongStatusLine', () => {
  it('says whose turn it is', () => {
    expect(bingBongStatusLine(LINK, status({}))).toBe('your turn')
    expect(bingBongStatusLine({ ...LINK, draftGroupId: 'd' }, status({}))).toBe(
      'your turn: end it when it sounds right'
    )
    expect(bingBongStatusLine(LINK, status({ whoseTurn: 'elling' }))).toBe('waiting for elling')
  })

  it('says a turn is on its way while its audio syncs', () => {
    expect(bingBongStatusLine(LINK, status({ pending: {} as BingBongTurnFile }))).toBe(
      "elling's turn is on its way"
    )
  })

  it('puts a blocking problem first, but not a skipped stray file', () => {
    expect(
      bingBongStatusLine(LINK, status({ problems: [{ kind: 'gap', missing: 2, next: 3 }] }))
    ).toBe("turn 3 is here but turn 2 isn't yet. waiting for it.")
    expect(
      bingBongStatusLine(
        LINK,
        status({
          problems: [{ kind: 'wrong-player', turn: 2, player: 'elling', expected: 'ben' }]
        })
      )
    ).toBe('your turn')
  })

  it('shows a read error, and that it is checking', () => {
    expect(
      bingBongStatusLine(LINK, { link: LINK, error: "there's no bing bong in that folder" })
    ).toBe("there's no bing bong in that folder")
    expect(bingBongStatusLine(LINK, null)).toBe('checking the folder…')
  })
})
```

- [ ] **Step 2: Run to see them fail.** Expected FAIL.

- [ ] **Step 3: Implement.** Create `src/renderer/src/state/bingBongStatus.ts`:

```ts
// The open bing bong's latest read of its shared folder (useBingBongSync.ts publishes it,
// BingBongBar.tsx shows it), and the one line that says where it stands. Session-only, like the
// notices' state modules. Spec: docs/superpowers/specs/2026-10-10-bing-bong-design.md.
import { useSyncExternalStore } from 'react'
import { describeTurnProblem } from '@shared/bingBongRules'
import type { BingBongLink } from '@shared/bingBongTurns'
import type { BingBongSnapshot } from '../../../main/bingBongActions'

export interface BingBongStatus {
  link: BingBongLink
  snapshot?: BingBongSnapshot
  error?: string
}

let status: BingBongStatus | null = null
let recheck: (() => void) | null = null
const listeners = new Set<() => void>()

export function publishBingBongStatus(next: BingBongStatus | null): void {
  status = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useBingBongStatus(): BingBongStatus | null {
  return useSyncExternalStore(subscribe, () => status)
}

/** useBingBongSync registers its check here, so end turn can ask for a fresh read at once. */
export function setBingBongRecheck(fn: (() => void) | null): void {
  recheck = fn
}

export function requestBingBongCheck(): void {
  recheck?.()
}

/** Where the bing bong stands, in the app's lowercase voice. `link` is the project's live one
 * (the draft comes and goes between reads); `status` is the latest read, if any. */
export function bingBongStatusLine(link: BingBongLink, status: BingBongStatus | null): string {
  const other = link.other
  if (status?.error) return status.error
  if (!status?.snapshot) return 'checking the folder…'
  const { resolution } = status.snapshot
  const problem = resolution.problems.find((p) => p.kind !== 'wrong-player')
  if (problem) return describeTurnProblem(problem, (u) => u)
  if (resolution.pending) return `${other}'s turn is on its way`
  if (resolution.whoseTurn !== link.me) return `waiting for ${other}`
  return link.draftGroupId ? 'your turn: end it when it sounds right' : 'your turn'
}
```

- [ ] **Step 4: Run the tests.** Expected PASS (4 tests); eslint clean.

- [ ] **Step 5: Commit** (`--only` both files): `bing bong: where it stands, in one line`.

### Task 9: Keep the sketch in step with the folder

**Files:** Create `src/renderer/src/state/useBingBongSync.ts`

- [ ] **Step 1: Implement.**

```ts
// Keeps the open bing bong sketch in step with its shared folder: reads it every 30 s, when the
// window gets focus, and when asked (requestBingBongCheck), appends turns that have arrived, and
// rings when one is the other player's. Spec: docs/superpowers/specs/2026-10-10-bing-bong-design.md
// ("Receiving a turn").
import { useEffect } from 'react'
import type { BingBongTurnFile } from '@shared/bingBongFormat'
import type { BingBongLink } from '@shared/bingBongTurns'
import { appendTurnsAction } from './bingBongTimeline'
import { publishBingBongStatus, setBingBongRecheck } from './bingBongStatus'
import type { Action, AppState } from './store'

const POLL_MS = 30_000

function ring(turn: BingBongTurnFile): void {
  const chat = turn.chat ? `: ${turn.chat}` : ''
  try {
    new Notification('bing bong', { body: `${turn.player} played turn ${turn.turn}${chat}` })
  } catch (err) {
    console.error('bing bong: notification failed:', err)
  }
}

export function useBingBongSync(
  link: BingBongLink | null,
  getState: () => AppState,
  dispatch: (action: Action) => void
): void {
  const folderPath = link?.folderPath ?? null
  const me = link?.me ?? null

  useEffect(() => {
    if (folderPath === null || me === null) {
      publishBingBongStatus(null)
      return
    }
    let cancelled = false
    let seen: number | null = null

    async function check(): Promise<void> {
      const result = await window.rifffApi.bingBongRead(folderPath as string)
      if (cancelled) return
      const current = getState().bingBong
      if (!current) return
      if (!result.ok) {
        publishBingBongStatus({ link: current, error: result.error })
        return
      }
      const { snapshot } = result
      const action = appendTurnsAction(getState(), snapshot.resolution.applied, snapshot.audioDir)
      if (action) dispatch(action)
      const latest = snapshot.resolution.applied[snapshot.resolution.applied.length - 1]
      if (seen !== null && latest && latest.turn > seen && latest.player !== me) ring(latest)
      seen = latest?.turn ?? 0
      publishBingBongStatus({ link: getState().bingBong ?? current, snapshot })
    }

    const run = (): void => {
      void check().catch((err: unknown) => console.error('bing bong: check failed:', err))
    }
    run()
    const timer = window.setInterval(run, POLL_MS)
    window.addEventListener('focus', run)
    setBingBongRecheck(run)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      window.removeEventListener('focus', run)
      setBingBongRecheck(null)
    }
  }, [folderPath, me, getState, dispatch])
}
```

The first read after opening only records what's there (`seen` starts null), so opening a bing
bong never rings for old turns. A turn of mine arriving from the folder (say, the sketch wasn't
saved after my last end turn) is appended but doesn't ring.

- [ ] **Step 2: Typecheck and lint.** `npm run typecheck && npx eslint src/renderer/src/state/useBingBongSync.ts`.

- [ ] **Step 3: Commit** (`--only` the file): `bing bong: keep the sketch in step with the folder`.

### Task 10: The bar and the dialog

**Files:** Create `src/renderer/src/components/BingBongBar.tsx`,
`src/renderer/src/components/BingBongDialog.tsx`

- [ ] **Step 1: The bar.**

```tsx
import { useState } from 'react'
import { BING_BONG_CHAT_MAX } from '@shared/bingBongFormat'
import type { BingBongLink } from '@shared/bingBongTurns'
import { bingBongStatusLine, type BingBongStatus } from '../state/bingBongStatus'

export interface BingBongBringOption {
  /** 'nothing', 'my-last', or a shelf riff's groupId. */
  value: string
  label: string
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

/** The strip a bing bong sketch shows (spec: docs/superpowers/specs/2026-10-10-bing-bong-design.md):
 * where it stands, the other player's last line, and the two moves: take your turn in Cross
 * (bringing a riff of yours into the right-hand column, or nothing), then end it with a line. */
export function BingBongBar({
  link,
  status,
  draftExists,
  bringOptions,
  defaultBring,
  onTakeTurn,
  onEndTurn
}: {
  link: BingBongLink
  status: BingBongStatus | null
  draftExists: boolean
  bringOptions: BingBongBringOption[]
  defaultBring: string
  onTakeTurn: (bring: string) => void
  /** Resolves true when the turn was taken. */
  onEndTurn: (chat: string) => Promise<boolean>
}): React.JSX.Element {
  const [bring, setBring] = useState(defaultBring)
  const [chat, setChat] = useState('')
  const [ending, setEnding] = useState(false)

  const resolution = status?.snapshot?.resolution
  const myTurn =
    resolution !== undefined && resolution.whoseTurn === link.me && resolution.pending === null
  const last = resolution?.applied[resolution.applied.length - 1]
  const theirLine = last && last.player !== link.me && last.chat ? last.chat : null
  const bringValue = bringOptions.some((o) => o.value === bring) ? bring : defaultBring

  async function endTurn(): Promise<void> {
    setEnding(true)
    try {
      if (await onEndTurn(chat)) setChat('')
    } finally {
      setEnding(false)
    }
  }

  return (
    <div
      role="region"
      aria-label="bing bong"
      style={{
        position: 'fixed',
        left: 10,
        bottom: 10,
        zIndex: 1500,
        maxWidth: 420,
        padding: '8px 10px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        background: 'var(--ra-bg-bar)',
        border: '1px solid var(--ra-border)',
        fontSize: 10,
        color: 'var(--ra-text-2)'
      }}
    >
      <div>
        <span style={{ color: 'var(--ra-text)' }}>bing bong · {link.other}</span>
        {' — '}
        {bingBongStatusLine(link, status)}
      </div>
      {theirLine && (
        <div style={{ fontStyle: 'italic' }}>
          “{theirLine}” — {link.other}
        </div>
      )}
      {myTurn && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <label htmlFor="bing-bong-bring">bring</label>
          <select
            id="bing-bong-bring"
            value={bringValue}
            onChange={(e) => setBring(e.target.value)}
            style={{ fontSize: 10, height: 22 }}
          >
            {bringOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <button style={buttonStyle} onClick={() => onTakeTurn(bringValue)}>
            {draftExists ? 'back to cross' : 'take your turn'}
          </button>
        </div>
      )}
      {myTurn && draftExists && (
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            type="text"
            value={chat}
            maxLength={BING_BONG_CHAT_MAX}
            placeholder={`a line for ${link.other} (optional)`}
            onChange={(e) => setChat(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !ending) void endTurn()
            }}
            style={{
              flex: 1,
              height: 22,
              padding: '0 6px',
              fontSize: 10,
              border: '1px solid var(--ra-border)',
              background: 'var(--ra-bg-row)',
              color: 'var(--ra-text)'
            }}
          />
          <button style={buttonStyle} disabled={ending} onClick={() => void endTurn()}>
            {ending ? 'ending…' : 'end turn'}
          </button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: The dialog**, styled like `NewProjectModal.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { backgroundScanGate } from '../audio/backgroundScanGate'

export interface BingBongStartForm {
  parentFolder: string
  name: string
  me: string
  meEmail: string
  other: string
  otherEmail: string
}

export interface BingBongJoinForm {
  folder: string
  me: string
  meEmail: string
}

const inputStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  marginTop: 6,
  height: 26,
  padding: '0 8px',
  fontSize: 12,
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
  placeholder
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
}): React.JSX.Element {
  return (
    <label style={{ display: 'block', marginTop: 12, fontSize: 11, color: 'var(--ra-text)' }}>
      {label}
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={inputStyle}
      />
    </label>
  )
}

/** Starting or joining a bing bong (spec: docs/superpowers/specs/2026-10-10-bing-bong-design.md,
 * "How a bing bong goes"). Start: the riff selected is turn 1; pick the shared folder it goes
 * in, and who it's with. Join: pick the folder someone shared with you. `knownMe` is the
 * Endlesss username sssketch already has; without one, the dialog asks for a name. */
export function BingBongDialog({
  mode,
  knownMe,
  riffName,
  error,
  busy,
  onStart,
  onJoin,
  onCancel
}: {
  mode: 'start' | 'join'
  knownMe: string | null
  /** The selected riff's name (start only). */
  riffName?: string
  error: string | null
  busy: boolean
  onStart: (form: BingBongStartForm) => void
  onJoin: (form: BingBongJoinForm) => void
  onCancel: () => void
}): React.JSX.Element {
  useEffect(() => backgroundScanGate.hold(), [])

  const [folder, setFolder] = useState('')
  const [me, setMe] = useState(knownMe ?? '')
  const [meEmail, setMeEmail] = useState('')
  const [other, setOther] = useState('')
  const [otherEmail, setOtherEmail] = useState('')
  const [name, setName] = useState('')
  const defaultName = me && other ? `${me}-and-${other}` : ''

  async function pickFolder(): Promise<void> {
    const picked = await window.rifffApi.pickFolder()
    if (picked) setFolder(picked)
  }

  const ready =
    folder !== '' &&
    me.trim() !== '' &&
    (mode === 'join' || (other.trim() !== '' && (name.trim() || defaultName) !== ''))

  function submit(): void {
    if (!ready || busy) return
    if (mode === 'join') {
      onJoin({ folder, me: me.trim(), meEmail: meEmail.trim() })
      return
    }
    onStart({
      parentFolder: folder,
      name: name.trim() || defaultName,
      me: me.trim(),
      meEmail: meEmail.trim(),
      other: other.trim(),
      otherEmail: otherEmail.trim()
    })
  }

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
          width: 'min(380px, 90vw)',
          background: 'var(--ra-bg-bar)',
          border: '1px solid var(--ra-border)',
          borderRadius: 0,
          padding: 16
        }}
      >
        <p style={{ margin: 0, fontSize: 11, color: 'var(--ra-text)' }}>
          {mode === 'start'
            ? `start a bing bong with “${riffName ?? 'this riff'}”`
            : 'join a bing bong'}
        </p>
        <p style={{ margin: '6px 0 0', fontSize: 10, color: 'var(--ra-text-2)' }}>
          {mode === 'start'
            ? 'pick a folder you both can see, like one in a shared google drive. the bing bong gets its own folder inside it.'
            : 'pick the bing bong folder they shared with you. in google drive, add it to my drive first so it syncs to this mac.'}
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
          <button style={buttonStyle} onClick={() => void pickFolder()}>
            choose folder…
          </button>
          <span
            style={{ fontSize: 10, color: 'var(--ra-text-2)', overflow: 'hidden' }}
            title={folder}
          >
            {folder || 'none yet'}
          </span>
        </div>
        {knownMe === null && <Field label="your name" value={me} onChange={setMe} />}
        {mode === 'start' && (
          <>
            <Field label="their endlesss username" value={other} onChange={setOther} />
            <Field
              label="their email (for the doorbell)"
              value={otherEmail}
              onChange={setOtherEmail}
            />
            <Field label="name" value={name} onChange={setName} placeholder={defaultName} />
          </>
        )}
        <Field label="your email (optional)" value={meEmail} onChange={setMeEmail} />
        {error && (
          <p style={{ margin: '12px 0 0', fontSize: 10, color: 'var(--ra-text)' }}>{error}</p>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button style={buttonStyle} onClick={onCancel} disabled={busy}>
            cancel
          </button>
          <button style={buttonStyle} onClick={submit} disabled={!ready || busy}>
            {busy ? '…' : mode === 'start' ? 'start' : 'join'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Typecheck and lint** both files.

- [ ] **Step 4: Commit** (`--only` both files): `bing bong: the bar and the start/join dialog`.

### Task 11: Wire it into the app

**Files:** Modify `src/renderer/src/App.tsx`

- [ ] **Step 1: Apply the change.** It adds, in this order:
  - a `bing bong` button and menu in `ProjectMenu`;
  - the sync hook and dialog state in `Frame`;
  - the start, join, take-turn, done-in-cross and end-turn functions after `commitNewProject`;
  - the bar and dialog mounts beside Cross;
  - the imports.

```diff
--- a/src/renderer/src/App.tsx
+++ b/src/renderer/src/App.tsx
@@ -107,6 +107,18 @@ import { ReonedCopiesNotice } from './components/ReonedCopiesNotice'
 import { ReoneNotice } from './components/ReoneNotice'
 import { SaveCopyNotice } from './components/SaveCopyNotice'
 import { LockedNotice } from './components/LockedNotice'
+import { BingBongBar } from './components/BingBongBar'
+import {
+  BingBongDialog,
+  type BingBongJoinForm,
+  type BingBongStartForm
+} from './components/BingBongDialog'
+import { useBingBongSync } from './state/useBingBongSync'
+import { requestBingBongCheck, useBingBongStatus } from './state/bingBongStatus'
+import { appendTurnsAction, timelineEndBar } from './state/bingBongTimeline'
+import type { BingBongTurnFile } from '@shared/bingBongFormat'
+import { otherPlayer } from '@shared/bingBongRules'
+import { bingBongTurnGroupId, type BingBongLink } from '@shared/bingBongTurns'
 import { TopRightNotices } from './components/TopRightNotices'
 import { showSaveCopyNotice } from './state/saveCopyNotice'
 import { saveAsNewVersion } from './state/saveAsNewVersion'
@@ -154,6 +166,7 @@ import {
   crossParentFromRifff,
   prefillCrossCenter,
   crossProjectKey,
+  type CrossAssembly,
   type CrossDraft
 } from '@shared/cross'
 import {
@@ -692,7 +705,9 @@ function ProjectMenu({
   onOpenClusterStems,
   onOpenClusterStemsLibrary,
   onOpenAutoArrange,
-  onOpenDrawArrange
+  onOpenDrawArrange,
+  onStartBingBong,
+  onJoinBingBong
 }: {
   currentSketch: CurrentSketch
   setCurrentSketch: (sketch: CurrentSketch) => void
@@ -727,6 +742,10 @@ function ProjectMenu({
   /** Opens DrawArrangeWizard -- Draw Arrangement's own equivalent of
    * onOpenAutoArrange above, wired to setDrawArrangeOpen(true) in Frame. */
   onOpenDrawArrange: () => void
+  /** Bing bong (spec: docs/superpowers/specs/2026-10-10-bing-bong-design.md): start one from the
+   * selected riff, or join one someone shared. Both open BingBongDialog in Frame. */
+  onStartBingBong: () => void
+  onJoinBingBong: () => void
 }): React.JSX.Element {
   const state = useAppState()
   const dispatch = useDispatch()
@@ -746,6 +765,9 @@ function ProjectMenu({
   // settings surface).
   const [gearMenu, setGearMenu] = useState<{ x: number; y: number } | null>(null)
   const gearButtonRef = useRef<HTMLButtonElement>(null)
+  const [bingBongMenu, setBingBongMenu] = useState<{ x: number; y: number } | null>(null)
+  const bingBongButtonRef = useRef<HTMLButtonElement>(null)
+  const canStartBingBong = state.sel !== null && state.rifffs[state.sel] !== undefined
   const [tidyUpNudgeOpen, setTidyUpNudgeOpen] = useState(false)
   const [pendingExport, setPendingExport] = useState<PendingExport | null>(null)
   const [exportFormatPickerOpen, setExportFormatPickerOpen] = useState(false)
@@ -1093,6 +1115,38 @@ function ProjectMenu({
           onClose={() => setSaveMenu(null)}
         />
       )}
+      <button
+        ref={bingBongButtonRef}
+        onClick={(e) => {
+          if (bingBongMenu) {
+            setBingBongMenu(null)
+            return
+          }
+          const rect = e.currentTarget.getBoundingClientRect()
+          setBingBongMenu({ x: rect.left, y: rect.bottom + 4 })
+        }}
+        title="trade a loop with a friend, one turn at a time"
+        style={buttonStyle}
+      >
+        bing bong
+      </button>
+      {bingBongMenu && (
+        <ContextMenu
+          x={bingBongMenu.x}
+          y={bingBongMenu.y}
+          ignoreRef={bingBongButtonRef}
+          items={[
+            {
+              label: 'start a bing bong…',
+              onClick: onStartBingBong,
+              disabled: !canStartBingBong,
+              title: canStartBingBong ? undefined : 'select the riff to start with first'
+            },
+            { label: 'join a bing bong…', onClick: onJoinBingBong }
+          ]}
+          onClose={() => setBingBongMenu(null)}
+        />
+      )}
       <button
         ref={gearButtonRef}
         onClick={(e) => {
@@ -1357,6 +1411,17 @@ function Frame(): React.JSX.Element {
     stateRef.current = state
   }, [state])
 
+  // Bing bong: keep the open bing bong sketch in step with its shared folder.
+  const getBingBongState = useCallback((): AppState => stateRef.current, [])
+  useBingBongSync(state.bingBong, getBingBongState, dispatch)
+  const bingBongStatus = useBingBongStatus()
+  const [bingBongDialog, setBingBongDialog] = useState<{
+    mode: 'start' | 'join'
+    knownMe: string | null
+    error: string | null
+    busy: boolean
+  } | null>(null)
+
   const [currentSketch, setCurrentSketch] = useState<CurrentSketch>(null)
   // Remembers the open project's tempo for the next new project's default
   // (lastProjectTempo.ts) -- only once a real project is open, so the
@@ -1717,6 +1782,240 @@ function Frame(): React.JSX.Element {
       }
     })()
   }
+  // ---- bing bong (spec: docs/superpowers/specs/2026-10-10-bing-bong-design.md) ----
+
+  async function openBingBongDialog(mode: 'start' | 'join'): Promise<void> {
+    const knownMe = await window.rifffApi.bingBongWhoami()
+    setBingBongDialog({ mode, knownMe, error: null, busy: false })
+  }
+
+  function bingBongDialogFailed(error: string): void {
+    setBingBongDialog((d) => (d ? { ...d, error, busy: false } : d))
+  }
+
+  /** handleNew's departure guard: true when the open project may be replaced. The caller ends
+   * the departure (endProjectDeparture) once it has. */
+  async function leaveForBingBong(): Promise<boolean> {
+    beginProjectDeparture()
+    const choice = await confirmDiscardIfDirty()
+    if (choice === 'cancel') {
+      endProjectDeparture()
+      return false
+    }
+    if (choice === 'save') {
+      if (!(await saveBeforeLeaving())) {
+        endProjectDeparture()
+        return false
+      }
+    } else {
+      clearAutosaveNow()
+    }
+    return true
+  }
+
+  /** Replaces the open project with a bing bong sketch holding `turns`, saved in the library as
+   * `bingbong-<name>`. Ends the departure leaveForBingBong began. */
+  async function enterBingBongSketch(
+    link: BingBongLink,
+    turns: readonly BingBongTurnFile[],
+    bpm: number
+  ): Promise<void> {
+    try {
+      const sound = await appSoundDefaults()
+      if (!projectDepartureIsCurrent()) return
+      const fresh: AppState = {
+        ...initialState,
+        bpm,
+        sound,
+        projectSeed: newProjectSeed(),
+        bingBong: link
+      }
+      const append = appendTurnsAction(fresh, turns, `${link.folderPath}/audio`)
+      const opened = append ? reducer(fresh, append) : fresh
+      const sketchName = `bingbong-${link.name}`
+      invalidateShapeSession()
+      projectSessionEpochRef.current = crypto.randomUUID()
+      dispatch({ type: 'LOAD_STATE', state: opened })
+      replacePendingPluginStates({})
+      setReonedMissing([])
+      setCurrentSketch({ kind: 'library', name: sketchName })
+      const touchedVersion = pluginsTouchedSnapshot().version
+      await window.rifffApi.saveProjectToLibrary(
+        sketchName,
+        await serializeForSave(undefined, opened)
+      )
+      recordSaved(opened, touchedVersion)
+    } catch (error) {
+      console.error('App: failed to open the bing bong sketch:', error)
+      window.alert("couldn't save the bing bong sketch. it's open; save it with cmd+s.")
+    } finally {
+      endProjectDeparture()
+    }
+  }
+
+  async function startBingBongFromDialog(form: BingBongStartForm): Promise<void> {
+    const source = state.sel ? state.rifffs[state.sel] : undefined
+    if (!source) return bingBongDialogFailed('select the riff to start with first')
+    setBingBongDialog((d) => (d ? { ...d, error: null, busy: true } : d))
+    const prepared = await rifffForSketchCross(
+      source,
+      state.off,
+      SNAP_DIVS[state.snapIdx],
+      (jobs) => window.rifffApi.bakeOffset(jobs)
+    )
+    if (!prepared) return bingBongDialogFailed("couldn't prepare every stem of that riff")
+    const result = await window.rifffApi.bingBongStart({
+      parentFolder: form.parentFolder,
+      name: form.name,
+      me: form.me,
+      ...(form.meEmail ? { meEmail: form.meEmail } : {}),
+      other: form.other,
+      ...(form.otherEmail ? { otherEmail: form.otherEmail } : {}),
+      rifff: prepared,
+      vol: state.vol,
+      mute: state.mute
+    })
+    if (!result.ok) return bingBongDialogFailed(result.error)
+    setBingBongDialog(null)
+    if (!(await leaveForBingBong())) {
+      window.alert(`the bing bong is started. open it any time: bing bong → join a bing bong…`)
+      return
+    }
+    await enterBingBongSketch(
+      {
+        id: result.file.id,
+        name: result.file.name,
+        folderPath: result.folder,
+        me: form.me,
+        other: form.other
+      },
+      [result.turn],
+      result.turn.riff.bpm
+    )
+  }
+
+  async function joinBingBongFromDialog(form: BingBongJoinForm): Promise<void> {
+    setBingBongDialog((d) => (d ? { ...d, error: null, busy: true } : d))
+    const result = await window.rifffApi.bingBongJoin(form.folder, form.me, form.meEmail || null)
+    if (!result.ok) return bingBongDialogFailed(result.error)
+    setBingBongDialog(null)
+    if (!(await leaveForBingBong())) return
+    const { file, resolution } = result.snapshot
+    await enterBingBongSketch(
+      {
+        id: file.id,
+        name: file.name,
+        folderPath: form.folder,
+        me: form.me,
+        other: otherPlayer(file, form.me)
+      },
+      resolution.applied,
+      resolution.applied[0]?.riff.bpm ?? state.bpm
+    )
+  }
+
+  /** The turns as they stand in the latest read: theirs to build on, mine to bring back. */
+  function lastTurnBy(mine: boolean): BingBongTurnFile | undefined {
+    const link = state.bingBong
+    const applied = bingBongStatus?.snapshot?.resolution.applied ?? []
+    return [...applied].reverse().find((t) => (t.player === link?.me) === mine)
+  }
+
+  function takeBingBongTurn(bring: string): void {
+    const link = state.bingBong
+    if (!link) return
+    const theirs = lastTurnBy(false)
+    const left = theirs && state.rifffs[bingBongTurnGroupId(link.id, theirs.turn)]
+    if (!left) {
+      window.alert("their turn isn't in this sketch yet. give it a moment.")
+      return
+    }
+    const mine = lastTurnBy(true)
+    const brought =
+      bring === 'my-last'
+        ? mine && state.rifffs[bingBongTurnGroupId(link.id, mine.turn)]
+        : bring === 'nothing'
+          ? undefined
+          : state.rifffs[bring]
+    const right: Rifff = brought ?? {
+      groupId: 'bingbong-nothing',
+      name: 'nothing',
+      bpm: left.bpm,
+      barLength: left.barLength,
+      folderPath: '',
+      stems: []
+    }
+    void openCrossFromRiffs([left, right], {
+      prefillFromLeft: true,
+      primaryAction: { label: 'done in cross', run: placeBingBongDraft }
+    })
+  }
+
+  /** "done in cross": the center becomes my draft turn at the end of the timeline, replacing any
+   * draft from before, for the edit pass. */
+  async function placeBingBongDraft(assembly: CrossAssembly): Promise<boolean> {
+    const current = stateRef.current
+    const link = current.bingBong
+    if (!link) return false
+    const old = link.draftGroupId
+    dispatch({
+      type: 'BATCH',
+      actions: [
+        ...(old && current.rifffs[old]
+          ? [{ type: 'DELETE_RIFFFS' as const, groupIds: [old] }]
+          : []),
+        {
+          type: 'PLACE_LOOP_ON_TIMELINE',
+          stems: [assembly.rifff],
+          startBar: timelineEndBar(current, old),
+          vol: assembly.vol,
+          mute: assembly.mute
+        },
+        { type: 'SET_BING_BONG_LINK', link: { ...link, draftGroupId: assembly.rifff.groupId } }
+      ]
+    })
+    return true
+  }
+
+  async function endBingBongTurn(chat: string): Promise<boolean> {
+    const current = stateRef.current
+    const link = current.bingBong
+    const draft = link?.draftGroupId ? current.rifffs[link.draftGroupId] : undefined
+    if (!link || !draft) return false
+    const prepared = await rifffForSketchCross(
+      draft,
+      current.off,
+      SNAP_DIVS[current.snapIdx],
+      (jobs) => window.rifffApi.bakeOffset(jobs)
+    )
+    if (!prepared) {
+      window.alert("couldn't prepare every stem of your turn. nothing was sent.")
+      return false
+    }
+    const result = await window.rifffApi.bingBongEndTurn({
+      folder: link.folderPath,
+      me: link.me,
+      rifff: prepared,
+      vol: current.vol,
+      mute: current.mute,
+      chat
+    })
+    if (!result.ok) {
+      window.alert(`your turn wasn't sent: ${result.error}`)
+      return false
+    }
+    const append = appendTurnsAction(
+      stateRef.current,
+      [result.turn],
+      `${link.folderPath}/audio`,
+      draft.groupId
+    )
+    if (append) dispatch(append)
+    requestBingBongCheck()
+    await handleSave()
+    return true
+  }
+
   // Guards the startup effect below against StrictMode's dev-only
   // double-invoke: without this, both invocations independently call
   // loadAutosave() before either gets to clearAutosave()/setRecoverableAutosave(),
@@ -3780,6 +4079,8 @@ function Frame(): React.JSX.Element {
               onOpenClusterStemsLibrary={() => openClusterStems('library')}
               onOpenAutoArrange={() => setAutoArrangeOpen(true)}
               onOpenDrawArrange={() => setDrawArrangeOpen(true)}
+              onStartBingBong={() => void openBingBongDialog('start')}
+              onJoinBingBong={() => void openBingBongDialog('join')}
             />
           </div>
         </div>
@@ -4108,6 +4409,39 @@ function Frame(): React.JSX.Element {
               />
             </div>
           )}
+        {state.bingBong && !crossOpen && (
+          <BingBongBar
+            key={state.bingBong.id}
+            link={state.bingBong}
+            status={bingBongStatus}
+            draftExists={
+              state.bingBong.draftGroupId !== undefined &&
+              state.rifffs[state.bingBong.draftGroupId] !== undefined
+            }
+            bringOptions={[
+              { value: 'nothing', label: 'nothing, just theirs' },
+              ...(lastTurnBy(true) ? [{ value: 'my-last', label: 'my last turn' }] : []),
+              ...Object.values(state.rifffs)
+                .filter((r) => r.startBar === undefined)
+                .map((r) => ({ value: r.groupId, label: r.name }))
+            ]}
+            defaultBring={lastTurnBy(true) ? 'my-last' : 'nothing'}
+            onTakeTurn={takeBingBongTurn}
+            onEndTurn={endBingBongTurn}
+          />
+        )}
+        {bingBongDialog && (
+          <BingBongDialog
+            mode={bingBongDialog.mode}
+            knownMe={bingBongDialog.knownMe}
+            riffName={state.sel ? state.rifffs[state.sel]?.name : undefined}
+            error={bingBongDialog.error}
+            busy={bingBongDialog.busy}
+            onStart={(form) => void startBingBongFromDialog(form)}
+            onJoin={(form) => void joinBingBongFromDialog(form)}
+            onCancel={() => setBingBongDialog(null)}
+          />
+        )}
         {libraryBrowserOpen && (
           <ProjectLibraryBrowser
             onClose={() => setLibraryBrowserOpen(false)}
```

Notes for review:
- **Start:** the shared folder is written *before* the open project is left. If the user then
  cancels the unsaved-changes prompt, the bing bong still exists and they're told to open it with
  join.
- **Saving the sketch:** `enterBingBongSketch` saves straight to `bingbong-<name>` with
  `serializeForSave(undefined, opened)`, not through `saveProjectNow`, whose `currentSketch` would
  still be the old project's in this render.
- **The bar** hides while Cross is open, and its `key` is the bing bong's id, so its local state
  resets when another bing bong opens.
- **End turn** ends with `handleSave()`. The turn is in the folder either way. Saving only keeps
  the local sketch current, and the sync hook would rebuild it otherwise.

- [ ] **Step 2: Typecheck, lint, test.** `npm run typecheck && npx eslint src/renderer/src/App.tsx && npx vitest run src/renderer src/shared`.

- [ ] **Step 3: Commit** (`--only` the file): `bing bong: start, join, take and end a turn`.

### Task 12: By hand (Elling and Ben)

No agent can hear audio or see the UI. Before merging, on one Mac with two folders, then on two
Macs with a real shared Drive folder:

- [ ] **Start.** Select a riff → bing bong → start a bing bong… → choose a folder → fill in Ben's
  Endlesss username → start.
  - A `bingbong-<name>` sketch opens with turn 1, locked.
  - Try to drag it: "that's a past turn, so it's locked." appears.
  - The bar says "waiting for ben".
- [ ] **Folder.** In Finder, `<folder>/<name>/` holds `bingbong.json`, `players/`, `turns/0001-<you>.json`
  and `audio/`.
- [ ] **Join** (Ben's Mac; in Drive, "add to My Drive" first).
  - bing bong → join a bing bong… → pick the folder.
  - His sketch opens with turn 1, and his bar says "your turn".
- [ ] **Take a turn.**
  - take your turn → Cross opens with turn 1 on the left and the same stems in the middle.
  - Change something → done in cross: the draft sits after turn 1, unlocked.
  - Nudge its level, type a line → end turn: the draft becomes locked turn 2.
- [ ] **Receive.**
  - Within 30 s (or on focusing the window) Elling's sketch gets turn 2.
  - A "bing bong" notification shows Ben's line, and the bar says "your turn".
- [ ] **Undo.** Cmd+Z after a turn arrives never removes it.
- [ ] **Remix-only turn.** Bring "nothing", change only levels, end turn: `audio/` gains no files.

## Done when

- `npm test`, `npm run typecheck`, `npm run lint` pass (engine-spawn tests aside).
- Task 12 passes by hand.
