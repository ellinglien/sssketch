// What a re-one that couldn't be applied tells the user. A riff that stays at its original phase
// while the riffs around it were re-oned sounds like "this one's off" (the triage of the
// 2026-10-08 call, B1 paths 2 and 3), so it is never left to a console line.

/** Re-ones the other riffs of a batch import by the pick made on one of them, all at once, and
 * names the ones that came back with nothing (`bake` resolving null, or throwing). Each riff's
 * bake is its own all-or-nothing batch, so a failed riff is wholly unrotated, never half. */
export async function reoneSiblings<T extends { groupId: string; name: string }>(
  siblings: readonly T[],
  bake: (sibling: T) => Promise<unknown>
): Promise<string[]> {
  const outcomes = await Promise.all(
    siblings.map(async (sibling) => {
      try {
        return (await bake(sibling)) !== null
      } catch (err) {
        console.error(`reoneSiblings: re-one of ${sibling.groupId} failed:`, err)
        return false
      }
    })
  )
  return siblings.filter((_, i) => !outcomes[i]).map((sibling) => sibling.name)
}

const MAX_NAMED = 4

function namesList(names: readonly string[]): string {
  const shown = names.slice(0, MAX_NAMED).join(', ')
  const rest = names.length - MAX_NAMED
  return rest > 0 ? `${shown} and ${rest} more` : shown
}

/** `failed` of a batch of `batchSize` riffs kept their original phase. */
export function siblingsNotReonedText(failed: readonly string[], batchSize: number): string {
  const one = failed.length === 1
  return [
    `couldn't re-one ${failed.length} of ${batchSize} riffs: ${namesList(failed)}`,
    one ? "it's at its original phase" : "they're at their original phase",
    one ? 're-one it from the inspector' : 're-one them from the inspector'
  ]
    .join(' · ')
    .toLowerCase()
}

/** A riff's late-downloaded stems couldn't be baked to its rotation, so they were left out. */
export function lateStemsNotAddedText(rifffName: string, count: number): string {
  return `couldn't re-one ${count} new ${count === 1 ? 'stem' : 'stems'} of ${rifffName} · not added · import it again`.toLowerCase()
}

/** A Discover candidate from the seed's jam couldn't be baked to the seed's rotation, so its row
 * was left unresolved rather than played out of phase. `jamName` null: not known. */
export function candidateNotAlignedText(jamName: string | null): string {
  return `couldn't line up a stem from ${jamName ?? "the seed's jam"} · skipped`.toLowerCase()
}

/** Whether a notice line may show now: once per `intervalMs` per line, so a bake that keeps
 * failing (every roll of a jam whose originals are away) says so without nagging. */
export function createNoticeThrottle(
  intervalMs: number,
  now: () => number = Date.now
): (line: string) => boolean {
  const shownAt = new Map<string, number>()
  return (line) => {
    const last = shownAt.get(line)
    if (last !== undefined && now() - last < intervalMs) return false
    shownAt.set(line, now())
    return true
  }
}
