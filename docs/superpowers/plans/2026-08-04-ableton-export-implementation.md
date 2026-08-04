# Ableton Live (.als) Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export the current sssketch arrangement as a self-contained Ableton Live 12 project
folder (`.als` + copied audio), per `docs/superpowers/specs/2026-08-04-ableton-export-design.md`.

**Architecture:** A pure XML-building layer (`src/main/ableton/`) clones canonical track/clip
nodes out of a real, checked-in reference template and mutates them per placed rifff/stem; a
thin orchestration layer (`src/main/exportAbleton.ts`) copies audio files and writes the final
gzipped `.als`; IPC/preload/UI wiring matches the existing `export-mix`/`export-stems` pattern.

**Tech Stack:** `fast-xml-parser` (already installed, `preserveOrder` mode), Node's built-in
`zlib`/`fs`, existing Electron IPC/dialog conventions.

---

## Before you start (already done, verified, and committed — do not redo)

Two pieces of prep already live on `master`, verified end-to-end against real data before this
plan was written:

1. **`src/main/ableton/template.xml`** — a trimmed copy of a real Ableton Live 12.4.3 Set the
   user exported by hand. Contains exactly one `<AudioTrack>` (with an active partial loop and
   a tempo-mismatched sample, for warp-marker reference), one `<GroupTrack>`, and both default
   `<ReturnTrack>` elements, inside a complete `<LiveSet>` skeleton (`MainTrack` with its own
   Tempo, Set-level `ScaleInformation`, etc.). Read it if you want to see real structure, but
   every task below already tells you exactly which elements to touch.
2. **`fast-xml-parser@^5.10.1`** — already in `package.json`'s `dependencies` and installed in
   `node_modules`. Use `preserveOrder: true` mode (see Task 1) — the default mode collapses
   repeated sibling tags (there are many: `AudioTrack`, `WarpMarker`, ...) into an ambiguous
   array-or-object shape that this design deliberately avoids.

Every piece of code in this plan was written against a working, tested simulation of the real
template — the field names, navigation paths, and XML shapes below are not guesses.

---

### Task 1: XML node helpers

**Files:**
- Create: `src/main/ableton/alsXmlHelpers.ts`
- Test: `src/main/ableton/alsXmlHelpers.test.ts`

`fast-xml-parser`'s `preserveOrder` mode represents a parsed document as an array of nodes,
each shaped `{ [tagName]: childArray, ':@'?: { '@_AttrName': 'value', ... } }`. This task
builds small, generically-reusable helpers over that shape — every later task in this plan
uses them, so get this one right first.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/main/ableton/alsXmlHelpers.test.ts
import { describe, it, expect } from 'vitest'
import {
  parseAls,
  serializeAls,
  findChild,
  findAllChildren,
  childArray,
  attrs,
  setAttr,
  cloneNode,
  renumberIds
} from './alsXmlHelpers'

const SAMPLE_XML =
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<Root>' +
  '<Tracks>' +
  '<AudioTrack Id="1"><Name Value="one" /></AudioTrack>' +
  '<AudioTrack Id="2"><Name Value="two" /></AudioTrack>' +
  '<GroupTrack Id="3"><Name Value="group" /></GroupTrack>' +
  '</Tracks>' +
  '</Root>'

describe('parseAls / serializeAls round trip', () => {
  it('parses and re-serializes without losing structure', () => {
    const doc = parseAls(SAMPLE_XML)
    const out = serializeAls(doc)
    const reparsed = parseAls(out)
    const root = findChild(reparsed, 'Root')!
    const tracks = findChild(childArray(root, 'Root'), 'Tracks')!
    expect(findAllChildren(childArray(tracks, 'Tracks'), 'AudioTrack')).toHaveLength(2)
  })
})

describe('findChild / findAllChildren', () => {
  it('finds the first matching child and all matching children', () => {
    const doc = parseAls(SAMPLE_XML)
    const root = findChild(doc, 'Root')!
    const tracks = findChild(childArray(root, 'Root'), 'Tracks')!
    const trackList = childArray(tracks, 'Tracks')

    expect(attrs(findChild(trackList, 'AudioTrack')!)['@_Id']).toBe('1')
    expect(findAllChildren(trackList, 'AudioTrack')).toHaveLength(2)
    expect(findAllChildren(trackList, 'GroupTrack')).toHaveLength(1)
  })
})

describe('setAttr', () => {
  it('overwrites an existing attribute', () => {
    const doc = parseAls(SAMPLE_XML)
    const root = findChild(doc, 'Root')!
    const tracks = findChild(childArray(root, 'Root'), 'Tracks')!
    const track = findChild(childArray(tracks, 'Tracks'), 'AudioTrack')!
    setAttr(track, '@_Id', '99')
    expect(attrs(track)['@_Id']).toBe('99')
  })

  it('adds an attribute to a node with none yet', () => {
    const doc = parseAls('<Root><Leaf /></Root>')
    const leaf = findChild(childArray(findChild(doc, 'Root')!, 'Root'), 'Leaf')!
    setAttr(leaf, '@_NewAttr', 'value')
    expect(attrs(leaf)['@_NewAttr']).toBe('value')
  })
})

describe('cloneNode', () => {
  it('produces an independent deep copy', () => {
    const doc = parseAls(SAMPLE_XML)
    const root = findChild(doc, 'Root')!
    const tracks = findChild(childArray(root, 'Root'), 'Tracks')!
    const original = findChild(childArray(tracks, 'Tracks'), 'AudioTrack')!

    const clone = cloneNode(original)
    setAttr(clone, '@_Id', '999')

    expect(attrs(original)['@_Id']).toBe('1') // untouched
    expect(attrs(clone)['@_Id']).toBe('999')
  })
})

describe('renumberIds', () => {
  it('replaces every Id attribute in a subtree, not just the top-level one', () => {
    const doc = parseAls(
      '<Root><Outer Id="1"><Inner Id="2" /><Inner Id="3" /></Outer></Root>'
    )
    const outer = findChild(childArray(findChild(doc, 'Root')!, 'Root'), 'Outer')!
    let counter = 100
    renumberIds(outer, () => counter++)

    expect(attrs(outer)['@_Id']).toBe('100')
    const inners = findAllChildren(childArray(outer, 'Outer'), 'Inner')
    expect(inners.map((n) => attrs(n)['@_Id'])).toEqual(['101', '102'])
  })

  it('does not touch nodes with no Id attribute', () => {
    const doc = parseAls('<Root><Leaf Value="x" /></Root>')
    const leaf = findChild(childArray(findChild(doc, 'Root')!, 'Root'), 'Leaf')!
    renumberIds(leaf, () => 5)
    expect(attrs(leaf)['@_Id']).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/main/ableton/alsXmlHelpers.test.ts`
Expected: FAIL — `Cannot find module './alsXmlHelpers'`

- [ ] **Step 3: Implement**

```typescript
// src/main/ableton/alsXmlHelpers.ts
import { XMLParser, XMLBuilder } from 'fast-xml-parser'

/**
 * A node in fast-xml-parser's `preserveOrder` document shape: an object with
 * exactly one tag-name key (whose value is the array of child nodes) plus an
 * optional `:@` key holding that element's attributes. A parsed document is
 * an array of these. preserveOrder (not the default object-collapsing mode)
 * is used because .als has many repeated sibling tags (AudioTrack,
 * WarpMarker, ...) that the default mode can't represent without
 * array/object ambiguity -- see docs/superpowers/specs/
 * 2026-08-04-ableton-export-design.md.
 */
export type AlsNode = {
  [tag: string]: AlsNode[] | Record<string, string> | undefined
}

const XML_OPTIONS = {
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '@_'
} as const

export function parseAls(xmlText: string): AlsNode[] {
  return new XMLParser(XML_OPTIONS).parse(xmlText) as AlsNode[]
}

export function serializeAls(doc: AlsNode[]): string {
  return new XMLBuilder({ ...XML_OPTIONS, format: false }).build(doc) as string
}

/** First direct child tagged `tag`, or undefined if none exists. */
export function findChild(nodes: AlsNode[], tag: string): AlsNode | undefined {
  return nodes.find((n) => n[tag] !== undefined)
}

/** Every direct child tagged `tag`, in document order. */
export function findAllChildren(nodes: AlsNode[], tag: string): AlsNode[] {
  return nodes.filter((n) => n[tag] !== undefined)
}

/** `node`'s own children array under `tag` -- callers only reach for this
 * once they already know (via findChild/findAllChildren) that `node` really
 * is a `tag` element, so the cast is safe. */
export function childArray(node: AlsNode, tag: string): AlsNode[] {
  return node[tag] as AlsNode[]
}

/** `node`'s attribute map, or an empty object if it has none. */
export function attrs(node: AlsNode): Record<string, string> {
  return (node[':@'] as Record<string, string> | undefined) ?? {}
}

/** Sets (or adds) one attribute on `node`. */
export function setAttr(node: AlsNode, name: string, value: string): void {
  const existing = node[':@'] as Record<string, string> | undefined
  if (existing) existing[name] = value
  else node[':@'] = { [name]: value }
}

/** Deep-clones a node subtree -- used to duplicate the template's canonical
 * AudioTrack/GroupTrack once per stem/channel. structuredClone is safe here
 * because every value in this document shape (strings, plain objects,
 * arrays) is structured-clone-able -- there are no functions, class
 * instances, or other exotic values anywhere in a parsed .als document. */
export function cloneNode(node: AlsNode): AlsNode {
  return structuredClone(node)
}

/**
 * Recursively replaces every `@_Id` attribute found anywhere within `node`'s
 * subtree (not just on `node` itself) with a freshly allocated value from
 * `nextId`. Necessary because cloning a template track via cloneNode also
 * duplicates every internal automation-target/pointee/clip-slot Id it
 * contains -- the reference template's own single canonical AudioTrack has
 * 69 of them. Confirmed empirically (see the design spec) that the original,
 * real, Ableton-produced reference file already reuses small Id values
 * across unrelated elements without apparent problems, so this is defensive
 * rather than a fix for a confirmed bug -- but it's free, and matches the
 * spirit of the template's own NextPointeeId field (Ableton's own "next
 * safe Id to hand out" counter).
 */
export function renumberIds(node: AlsNode, nextId: () => number): void {
  const nodeAttrs = node[':@'] as Record<string, string> | undefined
  if (nodeAttrs && '@_Id' in nodeAttrs) {
    nodeAttrs['@_Id'] = String(nextId())
  }
  for (const key of Object.keys(node)) {
    if (key === ':@') continue
    const children = node[key] as AlsNode[]
    for (const child of children) renumberIds(child, nextId)
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/main/ableton/alsXmlHelpers.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/ableton/alsXmlHelpers.ts src/main/ableton/alsXmlHelpers.test.ts
git commit -m "Add fast-xml-parser preserveOrder helpers for Ableton export"
```

---

### Task 2: LORE key → Ableton Scale mapping

**Files:**
- Create: `src/main/ableton/scaleMapping.ts`
- Test: `src/main/ableton/scaleMapping.test.ts`

`Rifff.key` (from `src/shared/types.ts`) is a combined display string like `"E Minor (Aeolian)"`,
produced by `src/main/loreWarehouse.ts`'s `resolveKeyName` joining a root name (from
`LORE_ROOT_NAMES`) and a scale name (from `LORE_SCALE_NAMES`) with a space. This task reverse-
parses that string into Ableton's Set-level `<ScaleInformation><Root/><Name/></ScaleInformation>`
representation — confirmed against the reference template that `Root` is the semitone offset
from C (0–11) and `Name` is a *different*, Ableton-specific scale-type enum (NOT the same index
as `LORE_SCALE_NAMES` — e.g. LORE's `"Minor (Aeolian)"` is index 5 in `LORE_SCALE_NAMES`, but the
reference file's Set-level Scale for E Minor came through as `Name="1"`, not `"5"`). Only
`"Major (Ionian)"` and `"Minor (Aeolian)"` have a confirmed Ableton enum value (0 and 1
respectively, from the reference file's per-clip default and Set-level test); every other LORE
scale name has no entry, so this function returns `undefined` for it rather than guessing.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/main/ableton/scaleMapping.test.ts
import { describe, it, expect } from 'vitest'
import { parseKeyToAbletonScale } from './scaleMapping'

describe('parseKeyToAbletonScale', () => {
  it('parses a confirmed root + Minor (Aeolian) scale', () => {
    expect(parseKeyToAbletonScale('E Minor (Aeolian)')).toEqual({ root: 4, name: 1 })
  })

  it('parses a confirmed root + Major (Ionian) scale', () => {
    expect(parseKeyToAbletonScale('C Major (Ionian)')).toEqual({ root: 0, name: 0 })
  })

  it('maps every chromatic root name to its semitone offset from C', () => {
    const roots = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']
    roots.forEach((rootName, expectedOffset) => {
      expect(parseKeyToAbletonScale(`${rootName} Minor (Aeolian)`)).toEqual({
        root: expectedOffset,
        name: 1
      })
    })
  })

  it('returns undefined for a scale name with no confirmed Ableton mapping', () => {
    expect(parseKeyToAbletonScale('D Dorian')).toBeUndefined()
    expect(parseKeyToAbletonScale('A Minor Pentatonic')).toBeUndefined()
  })

  it('returns undefined for an unrecognized root name', () => {
    expect(parseKeyToAbletonScale('H Major (Ionian)')).toBeUndefined()
  })

  it('returns undefined for a string with no space', () => {
    expect(parseKeyToAbletonScale('garbage')).toBeUndefined()
  })

  it('returns undefined for undefined input', () => {
    expect(parseKeyToAbletonScale(undefined)).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/main/ableton/scaleMapping.test.ts`
Expected: FAIL — `Cannot find module './scaleMapping'`

- [ ] **Step 3: Implement**

```typescript
// src/main/ableton/scaleMapping.ts

// Same chromatic order as loreWarehouse.ts's own LORE_ROOT_NAMES (kept as a
// separate copy here, not imported, since loreWarehouse.ts pulls in
// better-sqlite3/warehouse-connection concerns this module has no business
// depending on for a pure string-parsing job). The array index IS the
// semitone offset from C -- confirmed against the reference template
// (E -> index 4 -> Ableton's own Root Value="4" for a Set the user set to
// E Minor).
const LORE_ROOT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'] as const

// Only entries confirmed against a real Ableton-generated reference file
// (see docs/superpowers/specs/2026-08-04-ableton-export-design.md) --
// LORE_SCALE_NAMES has 18 entries total, but this table intentionally has
// only these two. Every other LORE scale name falls through to undefined
// below rather than guessing an unverified Ableton enum value.
const ABLETON_SCALE_NAME_TO_ENUM: Record<string, number> = {
  'Major (Ionian)': 0,
  'Minor (Aeolian)': 1
}

export interface AbletonScale {
  /** Semitone offset from C, 0-11. */
  root: number
  /** Ableton's own scale-type enum value. */
  name: number
}

/**
 * Reverse-parses a Rifff.key display string (e.g. "E Minor (Aeolian)",
 * produced by loreWarehouse.ts's resolveKeyName) into Ableton's Set-level
 * Scale representation. Returns undefined for anything unparseable, or for
 * a scale name outside the confirmed set above -- never guesses.
 */
export function parseKeyToAbletonScale(key: string | undefined): AbletonScale | undefined {
  if (!key) return undefined
  const spaceIdx = key.indexOf(' ')
  if (spaceIdx === -1) return undefined

  const rootName = key.slice(0, spaceIdx)
  const scaleName = key.slice(spaceIdx + 1)

  const root = LORE_ROOT_NAMES.indexOf(rootName as (typeof LORE_ROOT_NAMES)[number])
  if (root === -1) return undefined

  const name = ABLETON_SCALE_NAME_TO_ENUM[scaleName]
  if (name === undefined) return undefined

  return { root, name }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/main/ableton/scaleMapping.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/ableton/scaleMapping.ts src/main/ableton/scaleMapping.test.ts
git commit -m "Add LORE key to Ableton Set-level Scale mapping"
```

---

### Task 3: buildAlsXml — the pure track/clip/tempo/scale builder

**Files:**
- Create: `src/main/ableton/buildAlsXml.ts`
- Test: `src/main/ableton/buildAlsXml.test.ts`

This is the core mapping logic from the design spec. It's a pure function: given the real
template XML text, the app's `AppState`, the output directory, and a map of which stems
actually got copied (and under what filename), it returns the finished `.als` XML text
(ungzipped — gzipping is `exportAbleton.ts`'s job in Task 4).

**Read first — types this task depends on** (already exist, don't recreate them):
- `src/shared/types.ts`: `Rifff { groupId, name, bpm, barLength, folderPath, stems, startBar?, key? }`,
  `Stem { slot, author, name, type: SoundType, path, durationSec, barLength, oneShot?, trimStartSec?, trimEndSec?, recordedInApp? }`,
  `stemKey(groupId, slot): string`.
- `src/renderer/src/state/store.ts`: `AppState` includes `bpm`, `rifffs: Record<string, Rifff>`,
  `vol`/`mute`/`fadeIn`/`fadeOut`/`playedBars`/`leftCrop`/`off`/`stretch` (all `Record<string, ...>`
  keyed by groupId except `vol`/`mute` which are keyed by stemKey), `channelOrder: string[]`,
  `channelOf: Record<string, string>`.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/main/ableton/buildAlsXml.test.ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { buildAlsXml } from './buildAlsXml'
import { parseAls, findChild, findAllChildren, childArray, attrs } from './alsXmlHelpers'
import type { AppState } from '../../renderer/src/state/store'
import type { Rifff } from '@shared/types'

// Mirrors engineProcess.test.ts / pluginScan.test.ts's own pattern for
// reading a real sibling file from a test -- __dirname isn't reliably
// available when vitest runs this file as ESM.
const TEMPLATE_PATH = join(dirname(fileURLToPath(import.meta.url)), 'template.xml')
const TEMPLATE_XML = readFileSync(TEMPLATE_PATH, 'utf-8')

function emptyAppState(overrides: Partial<AppState> = {}): AppState {
  return {
    bpm: 120,
    snapIdx: 0,
    vol: {},
    mute: {},
    off: {},
    stretch: {},
    fadeIn: {},
    fadeOut: {},
    playedBars: {},
    leftCrop: {},
    dragVol: {},
    dragFadeIn: {},
    dragFadeOut: {},
    dragPlayedBars: {},
    dragLeftCropBars: {},
    sel: null,
    channelOrder: [],
    channelOf: {},
    recordingChannelIds: {},
    rifffs: {},
    masterChain: [null, null, null, null],
    channelPlugins: {},
    mode: 'normal',
    ...overrides
  } as AppState
}

function drumsRifff(): Rifff {
  return {
    groupId: 'rifff-1',
    name: 'my-rifff',
    bpm: 140,
    barLength: 4,
    folderPath: '/fake/folder',
    startBar: 8,
    stems: [
      {
        slot: 0,
        author: 'someone',
        name: 'kick',
        type: 'drums',
        path: '/source/kick.wav',
        durationSec: (60 / 140) * 4 * 4, // exactly 4 bars at 140bpm
        barLength: 4
      }
    ]
  }
}

// Navigates from a parsed document down to the <Tracks> children array --
// every test below starts from here.
function tracksOf(xml: string) {
  const doc = parseAls(xml)
  const ableton = findChild(doc, 'Ableton')!
  const liveSetBody = childArray(ableton, 'Ableton')
  const liveSet = findChild(liveSetBody, 'LiveSet')!
  const liveSetChildren = childArray(liveSet, 'LiveSet')
  const tracksNode = findChild(liveSetChildren, 'Tracks')!
  return { liveSetChildren, tracks: childArray(tracksNode, 'Tracks') }
}

describe('buildAlsXml', () => {
  it('produces one AudioTrack + one GroupTrack for a single placed rifff/stem, plus the two return tracks', () => {
    const state = emptyAppState({
      rifffs: { 'rifff-1': drumsRifff() },
      channelOrder: ['rifff-1'],
      channelOf: { 'rifff-1': 'rifff-1' }
    })
    const stemFileNames = new Map([['rifff-1:0', 'my-rifff-kick.wav']])

    const xml = buildAlsXml(TEMPLATE_XML, state, '/out', stemFileNames)
    const { tracks } = tracksOf(xml)

    expect(findAllChildren(tracks, 'ReturnTrack')).toHaveLength(2)
    expect(findAllChildren(tracks, 'GroupTrack')).toHaveLength(1)
    expect(findAllChildren(tracks, 'AudioTrack')).toHaveLength(1)
  })

  it('names the stem track "<rifff name> - <stem name>" and the group after the channel\'s earliest rifff', () => {
    const state = emptyAppState({
      rifffs: { 'rifff-1': drumsRifff() },
      channelOrder: ['rifff-1'],
      channelOf: { 'rifff-1': 'rifff-1' }
    })
    const stemFileNames = new Map([['rifff-1:0', 'my-rifff-kick.wav']])

    const xml = buildAlsXml(TEMPLATE_XML, state, '/out', stemFileNames)
    const { tracks } = tracksOf(xml)

    const audioTrack = findChild(tracks, 'AudioTrack')!
    const audioName = findChild(childArray(audioTrack, 'AudioTrack'), 'Name')!
    const audioEffName = findChild(childArray(audioName, 'Name'), 'EffectiveName')!
    expect(attrs(audioEffName)['@_Value']).toBe('my-rifff - kick')

    const groupTrack = findChild(tracks, 'GroupTrack')!
    const groupName = findChild(childArray(groupTrack, 'GroupTrack'), 'Name')!
    const groupEffName = findChild(childArray(groupName, 'Name'), 'EffectiveName')!
    expect(attrs(groupEffName)['@_Value']).toBe('my-rifff')
  })

  it('links the stem track to its group via TrackGroupId', () => {
    const state = emptyAppState({
      rifffs: { 'rifff-1': drumsRifff() },
      channelOrder: ['rifff-1'],
      channelOf: { 'rifff-1': 'rifff-1' }
    })
    const stemFileNames = new Map([['rifff-1:0', 'my-rifff-kick.wav']])

    const xml = buildAlsXml(TEMPLATE_XML, state, '/out', stemFileNames)
    const { tracks } = tracksOf(xml)

    const groupTrack = findChild(tracks, 'GroupTrack')!
    const groupId = attrs(groupTrack)['@_Id']

    const audioTrack = findChild(tracks, 'AudioTrack')!
    const trackGroupIdNode = findChild(childArray(audioTrack, 'AudioTrack'), 'TrackGroupId')!
    expect(attrs(trackGroupIdNode)['@_Value']).toBe(groupId)
  })

  it('places the clip at startBar*4 beats and sets its file path/relative path', () => {
    const state = emptyAppState({
      rifffs: { 'rifff-1': drumsRifff() }, // startBar: 8
      channelOrder: ['rifff-1'],
      channelOf: { 'rifff-1': 'rifff-1' }
    })
    const stemFileNames = new Map([['rifff-1:0', 'my-rifff-kick.wav']])

    const xml = buildAlsXml(TEMPLATE_XML, state, '/out', stemFileNames)
    const { tracks } = tracksOf(xml)
    const audioTrack = findChild(tracks, 'AudioTrack')!
    const clip = findAudioClip(audioTrack)

    expect(attrs(clip)['@_Time']).toBe('32') // 8 bars * 4 beats

    const clipBody = childArray(clip, 'AudioClip')
    const sampleRef = findChild(clipBody, 'SampleRef')!
    const fileRef = findChild(childArray(sampleRef, 'SampleRef'), 'FileRef')!
    const fileRefBody = childArray(fileRef, 'FileRef')
    expect(attrs(findChild(fileRefBody, 'Path')!)['@_Value']).toBe(
      '/out/Samples/Imported/my-rifff-kick.wav'
    )
    expect(attrs(findChild(fileRefBody, 'RelativePath')!)['@_Value']).toBe(
      'Samples/Imported/my-rifff-kick.wav'
    )
  })

  it('maps leftCrop/playedBars onto the loop window with LoopOn true for a normal (non-one-shot) stem', () => {
    const rifff = drumsRifff()
    const state = emptyAppState({
      rifffs: { 'rifff-1': rifff },
      channelOrder: ['rifff-1'],
      channelOf: { 'rifff-1': 'rifff-1' },
      leftCrop: { 'rifff-1': 1 },
      playedBars: { 'rifff-1': 6 }
    })
    const stemFileNames = new Map([['rifff-1:0', 'my-rifff-kick.wav']])

    const xml = buildAlsXml(TEMPLATE_XML, state, '/out', stemFileNames)
    const { tracks } = tracksOf(xml)
    const clip = findAudioClip(findChild(tracks, 'AudioTrack')!)
    const clipBody = childArray(clip, 'AudioClip')
    const loop = findChild(clipBody, 'Loop')!
    const loopBody = childArray(loop, 'Loop')

    expect(attrs(findChild(loopBody, 'LoopStart')!)['@_Value']).toBe('4') // 1 bar * 4
    expect(attrs(findChild(loopBody, 'LoopEnd')!)['@_Value']).toBe('24') // (1+6) bars * 4
    expect(attrs(findChild(loopBody, 'LoopOn')!)['@_Value']).toBe('true')
  })

  it('sets warp markers from the stem\'s native tempo (durationSec/barLength vs a clean 1-beat span)', () => {
    // 4 bars at 140bpm = (60/140)*4*4 seconds. Native seconds-per-beat = 60/140.
    const state = emptyAppState({
      rifffs: { 'rifff-1': drumsRifff() },
      channelOrder: ['rifff-1'],
      channelOf: { 'rifff-1': 'rifff-1' }
    })
    const stemFileNames = new Map([['rifff-1:0', 'my-rifff-kick.wav']])

    const xml = buildAlsXml(TEMPLATE_XML, state, '/out', stemFileNames)
    const { tracks } = tracksOf(xml)
    const clip = findAudioClip(findChild(tracks, 'AudioTrack')!)
    const clipBody = childArray(clip, 'AudioClip')
    const warpMarkersNode = findChild(clipBody, 'WarpMarkers')!
    const markers = childArray(warpMarkersNode, 'WarpMarkers')

    expect(markers).toHaveLength(2)
    expect(attrs(markers[0])['@_SecTime']).toBe('0')
    expect(attrs(markers[0])['@_BeatTime']).toBe('0')
    expect(attrs(markers[1])['@_BeatTime']).toBe('1')
    expect(Number(attrs(markers[1])['@_SecTime'])).toBeCloseTo(60 / 140, 10)
  })

  it('sets warp mode Beats (0) for a drums stem and Complex Pro (5) for everything else', () => {
    const rifff = drumsRifff()
    const notesStem = { ...rifff.stems[0], slot: 1, name: 'lead', type: 'notes' as const }
    rifff.stems.push(notesStem)

    const state = emptyAppState({
      rifffs: { 'rifff-1': rifff },
      channelOrder: ['rifff-1'],
      channelOf: { 'rifff-1': 'rifff-1' }
    })
    const stemFileNames = new Map([
      ['rifff-1:0', 'my-rifff-kick.wav'],
      ['rifff-1:1', 'my-rifff-lead.wav']
    ])

    const xml = buildAlsXml(TEMPLATE_XML, state, '/out', stemFileNames)
    const { tracks } = tracksOf(xml)
    const audioTracks = findAllChildren(tracks, 'AudioTrack')
    const warpModes = audioTracks.map((t) => {
      const clip = findAudioClip(t)
      return attrs(findChild(childArray(clip, 'AudioClip'), 'WarpMode')!)['@_Value']
    })

    expect(warpModes).toContain('0')
    expect(warpModes).toContain('5')
  })

  it('gives a one-shot stem LoopOn=false and maps trimStartSec/trimEndSec onto the loop window', () => {
    const rifff = drumsRifff()
    rifff.stems[0] = {
      ...rifff.stems[0],
      oneShot: true,
      trimStartSec: 60 / 140, // 1 beat in
      trimEndSec: (60 / 140) * 2 // 2 beats in
    }

    const state = emptyAppState({
      rifffs: { 'rifff-1': rifff },
      channelOrder: ['rifff-1'],
      channelOf: { 'rifff-1': 'rifff-1' }
    })
    const stemFileNames = new Map([['rifff-1:0', 'my-rifff-kick.wav']])

    const xml = buildAlsXml(TEMPLATE_XML, state, '/out', stemFileNames)
    const { tracks } = tracksOf(xml)
    const clip = findAudioClip(findChild(tracks, 'AudioTrack')!)
    const clipBody = childArray(clip, 'AudioClip')
    const loop = findChild(clipBody, 'Loop')!
    const loopBody = childArray(loop, 'Loop')

    expect(attrs(findChild(loopBody, 'LoopOn')!)['@_Value']).toBe('false')
    expect(Number(attrs(findChild(loopBody, 'LoopStart')!)['@_Value'])).toBeCloseTo(1, 10)
    expect(Number(attrs(findChild(loopBody, 'LoopEnd')!)['@_Value'])).toBeCloseTo(2, 10)
  })

  it('skips a stem missing from stemFileNames instead of producing a broken track', () => {
    const rifff = drumsRifff()
    rifff.stems.push({ ...rifff.stems[0], slot: 1, name: 'missing-file' })

    const state = emptyAppState({
      rifffs: { 'rifff-1': rifff },
      channelOrder: ['rifff-1'],
      channelOf: { 'rifff-1': 'rifff-1' }
    })
    // Only slot 0 present -- slot 1's copy "failed".
    const stemFileNames = new Map([['rifff-1:0', 'my-rifff-kick.wav']])

    const xml = buildAlsXml(TEMPLATE_XML, state, '/out', stemFileNames)
    const { tracks } = tracksOf(xml)
    expect(findAllChildren(tracks, 'AudioTrack')).toHaveLength(1)
  })

  it('produces no GroupTrack for a channel with no placed rifffs', () => {
    const state = emptyAppState({
      rifffs: {},
      channelOrder: ['empty-channel'],
      channelOf: {}
    })
    const xml = buildAlsXml(TEMPLATE_XML, state, '/out', new Map())
    const { tracks } = tracksOf(xml)
    expect(findAllChildren(tracks, 'GroupTrack')).toHaveLength(0)
  })

  it('sets the Set-level tempo from state.bpm', () => {
    const state = emptyAppState({ bpm: 135.5 })
    const xml = buildAlsXml(TEMPLATE_XML, state, '/out', new Map())
    const { liveSetChildren } = tracksOf(xml)
    const mainTrack = findChild(liveSetChildren, 'MainTrack')!
    const deviceChain = findChild(childArray(mainTrack, 'MainTrack'), 'DeviceChain')!
    const mixer = findChild(childArray(deviceChain, 'DeviceChain'), 'Mixer')!
    const tempo = findChild(childArray(mixer, 'Mixer'), 'Tempo')!
    const manual = findChild(childArray(tempo, 'Tempo'), 'Manual')!
    expect(attrs(manual)['@_Value']).toBe('135.5')
  })

  it('sets the Set-level Scale from the earliest placed rifff that has a parseable key', () => {
    const early: Rifff = { ...drumsRifff(), groupId: 'early', startBar: 0, key: 'E Minor (Aeolian)' }
    const late: Rifff = { ...drumsRifff(), groupId: 'late', startBar: 16, key: 'C Major (Ionian)' }
    const state = emptyAppState({
      rifffs: { early, late },
      channelOrder: ['early', 'late'],
      channelOf: { early: 'early', late: 'late' }
    })
    const xml = buildAlsXml(
      TEMPLATE_XML,
      state,
      '/out',
      new Map([
        ['early:0', 'a.wav'],
        ['late:0', 'b.wav']
      ])
    )
    const { liveSetChildren } = tracksOf(xml)
    const scaleInfo = findChild(liveSetChildren, 'ScaleInformation')!
    const scaleBody = childArray(scaleInfo, 'ScaleInformation')
    expect(attrs(findChild(scaleBody, 'Root')!)['@_Value']).toBe('4')
    expect(attrs(findChild(scaleBody, 'Name')!)['@_Value']).toBe('1')
  })

  it('omits nothing special (leaves the template default) when no placed rifff has a parseable key', () => {
    const rifff: Rifff = { ...drumsRifff(), key: 'D Dorian' } // unmapped scale
    const state = emptyAppState({
      rifffs: { 'rifff-1': rifff },
      channelOrder: ['rifff-1'],
      channelOf: { 'rifff-1': 'rifff-1' }
    })
    // Should not throw, and should leave whatever the template's own
    // default ScaleInformation was rather than guessing.
    expect(() =>
      buildAlsXml(TEMPLATE_XML, state, '/out', new Map([['rifff-1:0', 'a.wav']]))
    ).not.toThrow()
  })
})

// Navigates AudioTrack > DeviceChain > MainSequencer > Sample >
// ArrangerAutomation > Events > AudioClip -- shared by several tests above.
function findAudioClip(audioTrack: ReturnType<typeof findChild>) {
  const body = childArray(audioTrack!, 'AudioTrack')
  const deviceChain = findChild(body, 'DeviceChain')!
  const mainSeq = findChild(childArray(deviceChain, 'DeviceChain'), 'MainSequencer')!
  const sample = findChild(childArray(mainSeq, 'MainSequencer'), 'Sample')!
  const arrangerAuto = findChild(childArray(sample, 'Sample'), 'ArrangerAutomation')!
  const events = findChild(childArray(arrangerAuto, 'ArrangerAutomation'), 'Events')!
  return findChild(childArray(events, 'Events'), 'AudioClip')!
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/main/ableton/buildAlsXml.test.ts`
Expected: FAIL — `Cannot find module './buildAlsXml'`

- [ ] **Step 3: Implement**

```typescript
// src/main/ableton/buildAlsXml.ts
import { join } from 'node:path'
import type { AppState } from '../../renderer/src/state/store'
import type { Rifff, Stem } from '@shared/types'
import { stemKey } from '@shared/types'
import { parseKeyToAbletonScale } from './scaleMapping'
import {
  parseAls,
  serializeAls,
  findChild,
  findAllChildren,
  childArray,
  attrs,
  setAttr,
  cloneNode,
  renumberIds,
  type AlsNode
} from './alsXmlHelpers'

// Ableton's own warp-mode enum (best-effort, based on commonly-documented
// community reverse-engineering, NOT independently verified against a real
// Ableton install -- see docs/superpowers/specs/
// 2026-08-04-ableton-export-design.md's "Known risks" section. If wrong,
// worst case a clip opens with the wrong (but still valid) warp mode --
// fixed with a couple of clicks per-clip in Ableton, not a file-corruption
// risk).
const WARP_MODE_BEATS = 0
const WARP_MODE_COMPLEX_PRO = 5

// Counter for renumberIds, shared across every clone made during one
// buildAlsXml call so no two cloned elements anywhere in the output collide
// -- starts far above anything the template itself uses (its own Ids top
// out in the tens of thousands; see alsXmlHelpers.ts's renumberIds doc
// comment for why this is defensive, not a fix for a confirmed bug).
function makeIdAllocator(): () => number {
  let next = 1_000_000
  return () => next++
}

// Mirrors src/renderer/src/state/selectors.ts's resolvePlayedBars
// (re-implemented here rather than imported wholesale, matching
// nativeExport.ts's own loopLengthBarsFor precedent -- selectors.ts also
// exports React-adjacent selectors that assume renderer context).
function resolvePlayedBarsFor(state: AppState, groupId: string): number {
  const rifff = state.rifffs[groupId]
  return state.playedBars[groupId] ?? rifff.barLength
}

// Mirrors selectors.ts's channelsInOrder grouping (without the ordering/
// recording-channel concerns, which don't apply here -- a recording channel
// with nothing recorded onto it has nothing to export by definition).
function placedRifffsByChannel(state: AppState): Map<string, Rifff[]> {
  const byChannel = new Map<string, Rifff[]>()
  for (const rifff of Object.values(state.rifffs)) {
    if (rifff.startBar === undefined) continue
    const channelId = state.channelOf[rifff.groupId] ?? rifff.groupId
    const list = byChannel.get(channelId)
    if (list) list.push(rifff)
    else byChannel.set(channelId, [rifff])
  }
  return byChannel
}

function earliestRifff(rifffs: Rifff[]): Rifff {
  return [...rifffs].sort((a, b) => (a.startBar ?? 0) - (b.startBar ?? 0))[0]
}

// A stem's own native tempo, derived the same way buildEngineProject.ts
// derives it for stretch-ratio purposes -- reused here purely as a warp-
// marker reference (NOT for stretching; this export never re-renders
// audio). Meaningful for one-shots too: even though buildEngineProject.ts
// treats a one-shot's durationSec/barLength as "cosmetic" for its own
// ratio=1 stretch-skipping logic, they're still real, recorded numbers that
// make a perfectly good warp-marker reference for Ableton's own purposes.
function nativeBpmFor(stem: Stem): number {
  const secPerBar = stem.durationSec / stem.barLength
  return 240 / secPerBar // (60 / secPerBar) beats/min-per-bar-unit * 4 beats/bar
}

function warpModeFor(stem: Stem): number {
  return stem.type === 'drums' ? WARP_MODE_BEATS : WARP_MODE_COMPLEX_PRO
}

function findAudioClip(audioTrack: AlsNode): AlsNode {
  const body = childArray(audioTrack, 'AudioTrack')
  const deviceChain = findChild(body, 'DeviceChain')!
  const mainSeq = findChild(childArray(deviceChain, 'DeviceChain'), 'MainSequencer')!
  const sample = findChild(childArray(mainSeq, 'MainSequencer'), 'Sample')!
  const arrangerAuto = findChild(childArray(sample, 'Sample'), 'ArrangerAutomation')!
  const events = findChild(childArray(arrangerAuto, 'ArrangerAutomation'), 'Events')!
  return findChild(childArray(events, 'Events'), 'AudioClip')!
}

interface LoopWindow {
  loopStartBeats: number
  loopEndBeats: number
  loopOn: boolean
}

// One-shots: trimStartSec/trimEndSec (source-relative seconds) converted to
// beats via the stem's own native tempo, LoopOn=false (play once, no
// tiling). Everything else: leftCropBars/playedBars, LoopOn=true --
// playedBars is already an ABSOLUTE end-boundary measured from the clip's
// own start (confirmed against selectors.ts's own clipGeometryFromFields:
// visibleBars = playedBars - leftCropBars, NOT playedBars + leftCropBars),
// so LoopEnd is playedBars*4, not (leftCropBars+playedBars)*4. See
// docs/superpowers/specs/2026-08-04-ableton-export-design.md's mapping
// section for why LoopStart/LoopEnd still define the played region even
// with LoopOn=false.
function computeLoopWindow(
  stem: Stem,
  nativeBpm: number,
  leftCropBars: number,
  playedBars: number
): LoopWindow {
  if (stem.oneShot) {
    const beatsPerSecond = nativeBpm / 60
    return {
      loopStartBeats: (stem.trimStartSec ?? 0) * beatsPerSecond,
      loopEndBeats: (stem.trimEndSec ?? stem.durationSec) * beatsPerSecond,
      loopOn: false
    }
  }
  return {
    loopStartBeats: leftCropBars * 4,
    loopEndBeats: playedBars * 4,
    loopOn: true
  }
}

function buildStemTrack(
  canonicalAudioTrack: AlsNode,
  nextId: () => number,
  rifff: Rifff,
  stem: Stem,
  fileName: string,
  outputDir: string,
  groupTrackId: string,
  leftCropBars: number,
  playedBars: number
): AlsNode {
  const track = cloneNode(canonicalAudioTrack)
  renumberIds(track, nextId)

  const trackBody = childArray(track, 'AudioTrack')
  setAttr(findChild(trackBody, 'TrackGroupId')!, '@_Value', groupTrackId)

  const trackName = `${rifff.name} - ${stem.name}`
  const nameNode = findChild(trackBody, 'Name')!
  setAttr(findChild(childArray(nameNode, 'Name'), 'EffectiveName')!, '@_Value', trackName)

  const clip = findAudioClip(track)
  setAttr(clip, '@_Time', String((rifff.startBar ?? 0) * 4))

  const clipBody = childArray(clip, 'AudioClip')
  setAttr(findChild(clipBody, 'Name')!, '@_Value', trackName)

  const nativeBpm = nativeBpmFor(stem)
  const { loopStartBeats, loopEndBeats, loopOn } = computeLoopWindow(
    stem,
    nativeBpm,
    leftCropBars,
    playedBars
  )

  setAttr(findChild(clipBody, 'CurrentStart')!, '@_Value', '0')
  setAttr(findChild(clipBody, 'CurrentEnd')!, '@_Value', String(loopEndBeats))

  const loop = findChild(clipBody, 'Loop')!
  const loopBody = childArray(loop, 'Loop')
  setAttr(findChild(loopBody, 'LoopStart')!, '@_Value', String(loopStartBeats))
  setAttr(findChild(loopBody, 'LoopEnd')!, '@_Value', String(loopEndBeats))
  setAttr(findChild(loopBody, 'LoopOn')!, '@_Value', loopOn ? 'true' : 'false')
  setAttr(findChild(loopBody, 'HiddenLoopStart')!, '@_Value', '0')
  setAttr(findChild(loopBody, 'HiddenLoopEnd')!, '@_Value', String(loopEndBeats))

  const relativePath = join('Samples', 'Imported', fileName)
  const absolutePath = join(outputDir, relativePath)
  const sampleRef = findChild(clipBody, 'SampleRef')!
  const fileRef = findChild(childArray(sampleRef, 'SampleRef'), 'FileRef')!
  const fileRefBody = childArray(fileRef, 'FileRef')
  setAttr(findChild(fileRefBody, 'Path')!, '@_Value', absolutePath)
  setAttr(findChild(fileRefBody, 'RelativePath')!, '@_Value', relativePath)

  setAttr(findChild(clipBody, 'WarpMode')!, '@_Value', String(warpModeFor(stem)))

  const warpMarkersNode = findChild(clipBody, 'WarpMarkers')!
  warpMarkersNode['WarpMarkers'] = [
    { WarpMarker: [], ':@': { '@_Id': String(nextId()), '@_SecTime': '0', '@_BeatTime': '0' } },
    {
      WarpMarker: [],
      ':@': { '@_Id': String(nextId()), '@_SecTime': String(60 / nativeBpm), '@_BeatTime': '1' }
    }
  ]

  return track
}

/**
 * Builds the finished (ungzipped) .als XML text for the current arrangement.
 * Pure: no filesystem access beyond string path-joining (path.join never
 * touches disk). `stemFileNames` (keyed by stemKey(groupId, slot)) tells
 * this function which stems actually have audio to reference and under what
 * filename -- a stem missing from the map is skipped entirely (its copy
 * presumably failed; see exportAbleton.ts, Task 4). See
 * docs/superpowers/specs/2026-08-04-ableton-export-design.md for the full
 * mapping rationale.
 */
export function buildAlsXml(
  templateXml: string,
  state: AppState,
  outputDir: string,
  stemFileNames: Map<string, string>
): string {
  const doc = parseAls(templateXml)
  const ableton = findChild(doc, 'Ableton')!
  const abletonBody = childArray(ableton, 'Ableton')
  const liveSet = findChild(abletonBody, 'LiveSet')!
  const liveSetChildren = childArray(liveSet, 'LiveSet')
  const tracksNode = findChild(liveSetChildren, 'Tracks')!
  const tracks = childArray(tracksNode, 'Tracks')

  const canonicalAudioTrack = findChild(tracks, 'AudioTrack')!
  const canonicalGroupTrack = findChild(tracks, 'GroupTrack')!
  const returnTracks = findAllChildren(tracks, 'ReturnTrack')

  const nextId = makeIdAllocator()
  const outTracks: AlsNode[] = [...returnTracks]

  const byChannel = placedRifffsByChannel(state)
  for (const channelId of state.channelOrder) {
    const rifffs = byChannel.get(channelId)
    if (!rifffs || rifffs.length === 0) continue

    const groupTrack = cloneNode(canonicalGroupTrack)
    renumberIds(groupTrack, nextId)
    const groupTrackId = attrs(groupTrack)['@_Id']
    const groupName = earliestRifff(rifffs).name
    const groupNameNode = findChild(childArray(groupTrack, 'GroupTrack'), 'Name')!
    setAttr(findChild(childArray(groupNameNode, 'Name'), 'EffectiveName')!, '@_Value', groupName)
    outTracks.push(groupTrack)

    for (const rifff of rifffs) {
      const playedBars = resolvePlayedBarsFor(state, rifff.groupId)
      const leftCropBars = state.leftCrop[rifff.groupId] ?? 0

      for (const stem of rifff.stems) {
        const key = stemKey(rifff.groupId, stem.slot)
        const fileName = stemFileNames.get(key)
        if (!fileName) continue

        const track = buildStemTrack(
          canonicalAudioTrack,
          nextId,
          rifff,
          stem,
          fileName,
          outputDir,
          groupTrackId,
          leftCropBars,
          playedBars
        )
        outTracks.push(track)
      }
    }
  }

  tracksNode['Tracks'] = outTracks

  // Set-level tempo.
  const mainTrack = findChild(liveSetChildren, 'MainTrack')!
  const mtDeviceChain = findChild(childArray(mainTrack, 'MainTrack'), 'DeviceChain')!
  const mtMixer = findChild(childArray(mtDeviceChain, 'DeviceChain'), 'Mixer')!
  const tempoNode = findChild(childArray(mtMixer, 'Mixer'), 'Tempo')!
  setAttr(findChild(childArray(tempoNode, 'Tempo'), 'Manual')!, '@_Value', String(state.bpm))

  // Set-level scale, from the earliest placed rifff with a parseable key.
  const placed = Object.values(state.rifffs)
    .filter((r) => r.startBar !== undefined)
    .sort((a, b) => (a.startBar ?? 0) - (b.startBar ?? 0))
  for (const rifff of placed) {
    const scale = parseKeyToAbletonScale(rifff.key)
    if (!scale) continue
    const scaleInfo = findChild(liveSetChildren, 'ScaleInformation')!
    const scaleBody = childArray(scaleInfo, 'ScaleInformation')
    setAttr(findChild(scaleBody, 'Root')!, '@_Value', String(scale.root))
    setAttr(findChild(scaleBody, 'Name')!, '@_Value', String(scale.name))
    break
  }

  return serializeAls(doc)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/main/ableton/buildAlsXml.test.ts`
Expected: PASS (13 tests)

- [ ] **Step 5: Run the full test suite to check for regressions**

Run: `npm test`
Expected: PASS (all prior suites unaffected — this task only added new files)

- [ ] **Step 6: Commit**

```bash
git add src/main/ableton/buildAlsXml.ts src/main/ableton/buildAlsXml.test.ts
git commit -m "Add buildAlsXml: pure sssketch-state to Ableton .als XML mapping"
```

---

### Task 4: exportAbleton.ts — orchestration (copy audio, gzip, write, dialog)

**Files:**
- Create: `src/main/exportAbleton.ts`

Not unit tested, matching this codebase's existing convention for the dialog/file-write layer
(`src/main/exportMix.ts` is untested the same way) — verified by manual walkthrough in Task 7
instead. Two exported functions: `buildAndWriteAlsProject` (the real work, pure enough to call
directly with a real temp directory if ever needed) and `exportAbleton` (the dialog wrapper the
IPC handler calls).

- [ ] **Step 1: Implement**

```typescript
// src/main/exportAbleton.ts
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join, basename, dirname } from 'node:path'
import { dialog, BrowserWindow } from 'electron'
import type { AppState } from '../renderer/src/state/store'
import { stemKey } from '@shared/types'
// electron-vite's own Node-asset mechanism -- resolves to a real filesystem
// path in both dev and packaged builds, matching this file's own precedent
// (see index.ts's `import icon from '../../resources/icon.png?asset'`).
// Deliberately NOT imported by buildAlsXml.ts or its tests, which take the
// template text as a plain parameter instead -- vitest has no electron-vite
// plugin loaded to understand `?asset`, only the real Electron main build does.
import templatePath from './ableton/template.xml?asset'
import { buildAlsXml } from './ableton/buildAlsXml'
import { readFileSync } from 'node:fs'

// Anything outside this set is unsafe (or at least unwelcome) in a filename
// across macOS/Windows/Linux -- matches nativeExport.ts's own
// sanitizeFileNamePart exactly (duplicated rather than imported: it's not
// exported from that module, and it's a five-line pure function -- not worth
// coupling these two independent export features over).
function sanitizeFileNamePart(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '_').trim() || 'stem'
}

/**
 * Copies every placed stem's source audio into `<outputDir>/Samples/Imported/`,
 * builds the .als XML, gzips it, and writes `<outputDir>/<projectName>.als`.
 * A stem whose source file can't be copied is logged and skipped (its clip
 * is simply absent from the export) rather than failing the whole export --
 * matching this codebase's existing "don't fail the whole export over one
 * bad piece" convention (see buildEngineProject.ts's rubberband-failure
 * fallback). Throws if no rifff is placed at all (nothing to export) or if
 * the checked-in template can't be read (should never happen in practice).
 */
export function buildAndWriteAlsProject(state: AppState, outputDir: string, projectName: string): void {
  const placed = Object.values(state.rifffs).filter((r) => r.startBar !== undefined)
  if (placed.length === 0) {
    throw new Error('Nothing to export -- no rifffs are placed on the timeline.')
  }

  const samplesDir = join(outputDir, 'Samples', 'Imported')
  mkdirSync(samplesDir, { recursive: true })

  const stemFileNames = new Map<string, string>()
  const usedNames = new Map<string, number>()
  function uniqueFileName(rifffName: string, stemName: string): string {
    const base = `${sanitizeFileNamePart(rifffName)}-${sanitizeFileNamePart(stemName)}`
    const count = (usedNames.get(base) ?? 0) + 1
    usedNames.set(base, count)
    return count === 1 ? `${base}.wav` : `${base}-${count}.wav`
  }

  for (const rifff of placed) {
    for (const stem of rifff.stems) {
      const fileName = uniqueFileName(rifff.name, stem.name)
      try {
        copyFileSync(stem.path, join(samplesDir, fileName))
        stemFileNames.set(stemKey(rifff.groupId, stem.slot), fileName)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error(
          `buildAndWriteAlsProject: failed to copy stem "${stem.name}" from ${stem.path}: ${message}`
        )
      }
    }
  }

  const templateXml = readFileSync(templatePath, 'utf-8')
  const alsXml = buildAlsXml(templateXml, state, outputDir, stemFileNames)
  const gzipped = gzipSync(Buffer.from(alsXml, 'utf-8'))
  writeFileSync(join(outputDir, `${projectName}.als`), gzipped)
}

/**
 * Opens a save dialog (choosing the .als file's own name/location), then
 * builds the whole self-contained project folder around it. Mirrors
 * exportMixToWav's cancel/failure handling -- resolves null on a cancelled
 * dialog, alerts (via the thrown error, caught by the renderer's own
 * handler) rather than silently swallowing a real failure.
 */
export async function exportAbleton(win: BrowserWindow, state: AppState): Promise<string | null> {
  const result = await dialog.showSaveDialog(win, {
    filters: [{ name: 'Ableton Live Set', extensions: ['als'] }],
    defaultPath: 'sssketch-export.als'
  })
  if (result.canceled || !result.filePath) return null

  const outputDir = dirname(result.filePath)
  const projectName = basename(result.filePath, '.als')
  buildAndWriteAlsProject(state, outputDir, projectName)
  return result.filePath
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck:node`
Expected: PASS. If it fails on the `?asset` import specifically, confirm `tsconfig.node.json`
still has `"types": ["electron-vite/node"]` (it does as of this plan being written) — that's
what declares the `*?asset` module shape.

- [ ] **Step 3: Commit**

```bash
git add src/main/exportAbleton.ts
git commit -m "Add exportAbleton orchestration: copy stems, build .als, gzip, write"
```

---

### Task 5: IPC handler + preload bridge

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`

Follows the exact existing `export-mix`/`export-stems` convention (kebab-case IPC channel,
camelCase bridge method, dialog-driven, returns the chosen path or `null`).

- [ ] **Step 1: Add the import and IPC handler in `src/main/index.ts`**

Find this existing import line (near the top of the file, alongside the other export imports):

```typescript
import { exportMixToWav, exportStemsToWavs } from './exportMix'
```

Add directly below it:

```typescript
import { exportAbleton } from './exportAbleton'
```

Find this existing handler block:

```typescript
  ipcMain.handle('export-stems', (event, stems: ExportedStem[]) => {
    const win = BrowserWindow.fromWebContents(event.sender)!
    return exportStemsToWavs(win, stems)
  })
```

Add directly below it:

```typescript
  ipcMain.handle('export-als', async (event, stateJson: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)!
    const state = JSON.parse(stateJson) as import('../renderer/src/state/store').AppState
    return exportAbleton(win, state)
  })
```

- [ ] **Step 2: Add the bridge method in `src/preload/index.ts`**

Find this existing line:

```typescript
  exportStems: (stems: ExportedStem[]): Promise<string | null> =>
    ipcRenderer.invoke('export-stems', stems),
```

Add directly below it:

```typescript
  exportAls: (stateJson: string): Promise<string | null> =>
    ipcRenderer.invoke('export-als', stateJson),
```

- [ ] **Step 3: Typecheck both processes**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/main/index.ts src/preload/index.ts
git commit -m "Wire export-als IPC channel and exportAls preload bridge"
```

---

### Task 6: UI — third export button

**Files:**
- Modify: `src/renderer/src/App.tsx`

Adds "export ableton" as a third option in the existing export context menu, following
`handleExportMix`/`handleExportStems`'s exact pattern (`setExporting` around the call, alert on
failure). Unlike the other two, this is a single IPC round trip (no separate render step), so
there's only one handler function, not two.

- [ ] **Step 1: Add the handler**

Find this existing function in `src/renderer/src/App.tsx`:

```typescript
  async function handleExportStems(): Promise<void> {
    setExporting(true)
    try {
      const stems = await window.rifffApi.exportStemsNative(JSON.stringify(state))
      await window.rifffApi.exportStems(stems)
    } catch (err) {
      console.error('ProjectMenu: failed to export stems:', err)
      window.alert(`Export failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setExporting(false)
    }
  }
```

Add directly below it:

```typescript
  async function handleExportAbleton(): Promise<void> {
    setExporting(true)
    try {
      await window.rifffApi.exportAls(JSON.stringify(state))
    } catch (err) {
      console.error('ProjectMenu: failed to export to Ableton:', err)
      window.alert(`Export failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setExporting(false)
    }
  }
```

- [ ] **Step 2: Add the menu item**

Find this existing block:

```typescript
          items={[
            { label: 'export mix', onClick: handleExportMix },
            { label: 'export stems', onClick: handleExportStems }
          ]}
```

Replace it with:

```typescript
          items={[
            { label: 'export mix', onClick: handleExportMix },
            { label: 'export stems', onClick: handleExportStems },
            { label: 'export ableton', onClick: handleExportAbleton }
          ]}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck:web`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/App.tsx
git commit -m "Add export-ableton button to the export menu"
```

---

### Task 7: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck**

Run: `npm run typecheck`
Expected: PASS, both node and web configs.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: PASS (or only pre-existing warnings unrelated to this feature — if any NEW warning
appears in a file this plan touched, fix it before continuing).

- [ ] **Step 3: Full test suite**

Run: `npm test`
Expected: PASS — should include all of Task 1/2/3's new test files (28 new tests total: 8 in
alsXmlHelpers, 7 in scaleMapping, 13 in buildAlsXml) plus every pre-existing suite unaffected.

- [ ] **Step 4: Dev-mode smoke test**

Run: `npm run dev`, open the app, place at least one rifff with a couple of stems on the
timeline, click **export → export ableton**, choose a destination, confirm:
- The app doesn't crash or hang.
- The chosen folder contains `<name>.als` and a `Samples/Imported/` subfolder with the
  expected `.wav` files.
- `gzip -t <name>.als` on the output succeeds (confirms it's valid gzip, catches a truncated-
  write bug before ever touching Ableton).

- [ ] **Step 5: Manual acceptance in real Ableton — cannot be automated, must be done by hand**

This is the one thing nothing in this repo (or this agent) can verify automatically, per the
design spec's own "Testing" section. Open the exported `.als` in real Ableton Live 12 and
confirm:
- It opens without an error dialog.
- Tracks/clips land at the expected bar positions, grouped under the expected channel Group
  Tracks.
- The Set's tempo and (if a placed rifff had a Major/Minor key) Scale match the project.
- At least one `drums`-typed stem and one other-typed stem sound reasonable on their
  auto-picked warp mode (Beats / Complex Pro respectively) — if a mode sounds wrong, that's a
  known, cheaply-fixable risk already flagged in the design spec's "Known risks" section, not a
  surprise.

If anything in this step fails, note exactly what broke (error text, which field was wrong)
before making any fix — the most likely source of a real bug at this point is a wrong XML
navigation path or attribute name for an Ableton version/schema variant this plan's own
reference file didn't cover.

- [ ] **Step 6: Update the scope-pivot memory**

This feature is the concrete first deliverable of the scope pivot recorded in project memory
`sssketch-scope-pivot-ableton-export`. Once Step 5 passes, note in that memory file that the
Ableton export shipped (date, and whether the manual Ableton walkthrough found anything worth
remembering for next time — e.g. if a warp mode enum value turned out wrong, or a scale
mapping needs extending).
