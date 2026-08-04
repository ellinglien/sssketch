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
})
