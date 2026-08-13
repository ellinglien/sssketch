import { describe, it, expect } from 'vitest'
import {
  rppField,
  rppBlock,
  quote,
  serializeRpp,
  parseRpp,
  findChild,
  findAllChildren
} from './rppNode'

describe('serializeRpp', () => {
  it('serializes a field with no children as a single unbracketed line', () => {
    const node = rppField('TEMPO', 120, 4, 4)
    expect(serializeRpp(node)).toBe('TEMPO 120 4 4')
  })

  it('serializes a block with nested children, indented, wrapped in angle brackets', () => {
    const node = rppBlock(
      'TRACK',
      [],
      [rppField('NAME', quote('drums')), rppBlock('ITEM', [], [rppField('POSITION', 0)])]
    )
    expect(serializeRpp(node)).toBe('<TRACK\n  NAME "drums"\n  <ITEM\n    POSITION 0\n  >\n>')
  })

  it('serializes an empty block as an open/close pair with no lines in between', () => {
    const node = rppBlock('SendsPre', [], [])
    expect(serializeRpp(node)).toBe('<SendsPre\n>')
  })
})

describe('quote', () => {
  it('wraps a plain string in double quotes', () => {
    expect(quote('my rifff - kick')).toBe('"my rifff - kick"')
  })

  it('replaces an embedded double-quote with a single quote rather than breaking the line', () => {
    expect(quote('weird "name"')).toBe('"weird \'name\'"')
  })
})

describe('parseRpp / findChild / findAllChildren round trip', () => {
  it('parses a serialized block back into an equivalent tree', () => {
    const original = rppBlock(
      'TRACK',
      ['{GUID}'],
      [
        rppField('NAME', quote('drums')),
        rppField('PEAKCOL', 12345),
        rppBlock('ITEM', [], [rppField('POSITION', 1.5), rppField('LENGTH', 2)]),
        rppBlock('ITEM', [], [rppField('POSITION', 4)])
      ]
    )
    const parsed = parseRpp(serializeRpp(original))

    expect(parsed.tag).toBe('TRACK')
    expect(parsed.params).toEqual(['{GUID}'])
    expect(findChild(parsed, 'NAME')?.params).toEqual(['"drums"'])
    expect(findChild(parsed, 'PEAKCOL')?.params).toEqual(['12345'])
    expect(findAllChildren(parsed, 'ITEM')).toHaveLength(2)
    const firstItem = findAllChildren(parsed, 'ITEM')[0]
    expect(findChild(firstItem, 'POSITION')?.params).toEqual(['1.5'])
    expect(findChild(firstItem, 'LENGTH')?.params).toEqual(['2'])
  })

  it('preserves a quoted value containing a space as a single param, not split on the space', () => {
    const original = rppField('FILE', quote('a file with spaces.wav'))
    const parsed = parseRpp(serializeRpp(original))
    expect(parsed.params).toEqual(['"a file with spaces.wav"'])
  })

  it('findChild returns undefined when no child has that tag', () => {
    const parsed = parseRpp(serializeRpp(rppBlock('TRACK', [], [rppField('NAME', quote('x'))])))
    expect(findChild(parsed, 'NOPE')).toBeUndefined()
  })

  it('findChild returns undefined for a field node (no children at all)', () => {
    const parsed = parseRpp(serializeRpp(rppField('POSITION', 0)))
    expect(findChild(parsed, 'ANYTHING')).toBeUndefined()
    expect(findAllChildren(parsed, 'ANYTHING')).toEqual([])
  })
})
