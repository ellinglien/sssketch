import type { Dispatch } from 'react'
import type { Rifff } from '@shared/types'
import { guessSoundType } from '@shared/typeGuess'
import { decodeStemFile } from './decodeStemFile'
import type { Action } from '../state/store'

/**
 * Runs the quick bass/drums heuristic against every stem in a freshly-imported
 * rifff and dispatches a guess for each one that confidently matches (the
 * reducer only applies it while the stem is still at the untouched 'fx'
 * default, so this can't clobber a manual correction). Fire-and-forget from the
 * caller — failures here shouldn't block or fail the import itself.
 */
export async function classifyStems(rifff: Rifff, dispatch: Dispatch<Action>): Promise<void> {
  await Promise.all(
    rifff.stems.map(async (stem) => {
      try {
        const decoded = await decodeStemFile(stem.path)
        const guess = guessSoundType(decoded.getChannelData(0), decoded.sampleRate)
        if (guess) {
          dispatch({
            type: 'SET_STEM_TYPE',
            groupId: rifff.groupId,
            slot: stem.slot,
            soundType: guess
          })
        }
      } catch (err) {
        console.error(`classifyStems: failed to analyze "${stem.path}":`, err)
      }
    })
  )
}
