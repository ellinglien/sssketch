import { describe, expect, it } from 'vitest'
import { lateStemsNotAddedText, reoneSiblings, siblingsNotReonedText } from './reoneNotices'

describe('reoneSiblings', () => {
  it('bakes every sibling and names the ones that came back with nothing', async () => {
    const baked: string[] = []
    const failed = await reoneSiblings(
      [
        { groupId: 'a', name: 'misty kestrel' },
        { groupId: 'b', name: 'red fox' },
        { groupId: 'c', name: 'blue heron' }
      ],
      async (sibling) => {
        baked.push(sibling.groupId)
        return sibling.groupId === 'b' ? null : [{}]
      }
    )
    expect(baked).toEqual(['a', 'b', 'c'])
    expect(failed).toEqual(['red fox'])
  })

  it('counts a bake that throws as failed, without losing the others', async () => {
    const failed = await reoneSiblings(
      [
        { groupId: 'a', name: 'misty kestrel' },
        { groupId: 'b', name: 'red fox' }
      ],
      async (sibling) => {
        if (sibling.groupId === 'a') throw new Error('ipc down')
        return [{}]
      }
    )
    expect(failed).toEqual(['misty kestrel'])
  })

  it('names nothing when every sibling was re-oned', async () => {
    expect(await reoneSiblings([{ groupId: 'a', name: 'x' }], async () => [{}])).toEqual([])
  })
})

describe('siblingsNotReonedText', () => {
  it('says how many of the batch were not re-oned, and which', () => {
    expect(siblingsNotReonedText(['red fox', 'blue heron'], 5)).toBe(
      "couldn't re-one 2 of 5 riffs: red fox, blue heron · they're at their original phase · re-one them from the inspector"
    )
  })

  it('reads well for one', () => {
    expect(siblingsNotReonedText(['red fox'], 3)).toBe(
      "couldn't re-one 1 of 3 riffs: red fox · it's at its original phase · re-one it from the inspector"
    )
  })

  it('names four at most', () => {
    expect(siblingsNotReonedText(['a', 'b', 'c', 'd', 'e', 'f'], 8)).toBe(
      "couldn't re-one 6 of 8 riffs: a, b, c, d and 2 more · they're at their original phase · re-one them from the inspector"
    )
  })

  it('is lowercase whatever the riff names are', () => {
    expect(siblingsNotReonedText(['Red Fox'], 2)).toContain('red fox')
  })
})

describe('lateStemsNotAddedText', () => {
  it('says the new stems were not added, and why', () => {
    expect(lateStemsNotAddedText('misty kestrel', 2)).toBe(
      "couldn't re-one 2 new stems of misty kestrel · not added · import it again"
    )
    expect(lateStemsNotAddedText('misty kestrel', 1)).toBe(
      "couldn't re-one 1 new stem of misty kestrel · not added · import it again"
    )
  })
})
