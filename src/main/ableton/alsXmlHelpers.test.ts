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

    const firstTrack = findChild(childArray(tracks, 'Tracks'), 'AudioTrack')!
    expect(attrs(firstTrack)['@_Id']).toBe('1')
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
    const doc = parseAls('<Root><Outer Id="1"><Inner Id="2" /><Inner Id="3" /></Outer></Root>')
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

  it('does not recurse into text-node string values', () => {
    const doc = parseAls('<Root><Leaf Id="1">some text</Leaf></Root>')
    const leaf = findChild(childArray(findChild(doc, 'Root')!, 'Root'), 'Leaf')!
    expect(() => renumberIds(leaf, () => 5)).not.toThrow()
    expect(attrs(leaf)['@_Id']).toBe('5')
  })

  it('leaves TrackSendHolder Ids untouched, since they are a positional index correlating to return-track count, not a generic identity Id', () => {
    // Regression test: renumbering TrackSendHolder's Id made a real
    // exported file fail to open in Ableton with "Track has more send
    // knobs than set has return tracks" -- confirmed against real
    // Ableton, not a guess.
    const doc = parseAls(
      '<Root><Sends><TrackSendHolder Id="0" /><TrackSendHolder Id="1" /></Sends></Root>'
    )
    const sends = findChild(childArray(findChild(doc, 'Root')!, 'Root'), 'Sends')!
    let counter = 100
    renumberIds(sends, () => counter++)

    const holders = findAllChildren(childArray(sends, 'Sends'), 'TrackSendHolder')
    expect(holders.map((n) => attrs(n)['@_Id'])).toEqual(['0', '1'])
  })

  it("renumbers a TrackSendHolder's NESTED Ids (the actual send-knob parameters) even though its own outer Id is skipped", () => {
    // Confirmed against real Ableton output: decompiling a real Live Set
    // with a track duplicated 6 times showed every duplicate's
    // TrackSendHolder Ids staying "0"/"1", while their nested
    // AutomationTarget/ModulationTarget Ids were all freshly unique per
    // duplicate -- never repeated, never left at the original template
    // value. This is the opposite of an earlier (wrong) assumption that
    // the whole subtree had to stay frozen.
    const doc = parseAls(
      '<Root><Sends><TrackSendHolder Id="0"><Send><AutomationTarget Id="22194" /><ModulationTarget Id="22195" /></Send></TrackSendHolder></Sends></Root>'
    )
    const sends = findChild(childArray(findChild(doc, 'Root')!, 'Root'), 'Sends')!
    let counter = 1000000
    renumberIds(sends, () => counter++)

    const holder = findChild(childArray(sends, 'Sends'), 'TrackSendHolder')!
    expect(attrs(holder)['@_Id']).toBe('0') // outer Id still skipped
    const send = findChild(childArray(holder, 'TrackSendHolder'), 'Send')!
    const at = findChild(childArray(send, 'Send'), 'AutomationTarget')!
    const mt = findChild(childArray(send, 'Send'), 'ModulationTarget')!
    expect(attrs(at)['@_Id']).toBe('1000000') // nested Ids DO get renumbered
    expect(attrs(mt)['@_Id']).toBe('1000001')
  })

  it("still renumbers a TrackSendHolder's siblings and ancestors in an otherwise-renumbered subtree", () => {
    const doc = parseAls(
      '<Root><Outer Id="1"><Sends><TrackSendHolder Id="0"><Send><AutomationTarget Id="22194" /></Send></TrackSendHolder></Sends><Other Id="2" /></Outer></Root>'
    )
    const outer = findChild(childArray(findChild(doc, 'Root')!, 'Root'), 'Outer')!
    let counter = 100
    renumberIds(outer, () => counter++)

    expect(attrs(outer)['@_Id']).toBe('100') // Outer itself still renumbered

    const sends = findChild(childArray(outer, 'Outer'), 'Sends')!
    const holder = findChild(childArray(sends, 'Sends'), 'TrackSendHolder')!
    expect(attrs(holder)['@_Id']).toBe('0') // TrackSendHolder itself skipped
    const send = findChild(childArray(holder, 'TrackSendHolder'), 'Send')!
    const target = findChild(childArray(send, 'Send'), 'AutomationTarget')!
    expect(attrs(target)['@_Id']).toBe('101') // nested Id renumbered

    const other = findChild(childArray(outer, 'Outer'), 'Other')!
    expect(attrs(other)['@_Id']).toBe('102') // a plain sibling still renumbered
  })
})
