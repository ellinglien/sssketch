// Which rows of a Discover or Cross mix are heard, and so which arrive Disabled when the mix is
// added to the shelf or timeline. One rule for both (the 2026-10-08 call, F6: what you hear is
// what you get).

/** Solo is a temporary listening layer over the mute choice: a soloed item is heard even when
 * its own mute is on, and the only one heard; without a solo, every unmuted item is. */
export function isHeard(itemId: string, muted: boolean, soloedId: string | null): boolean {
  return soloedId === null ? !muted : itemId === soloedId
}

/** Whether an item arrives Disabled (state.mute, the saved layer) when its mix is added: it
 * wasn't heard. At its own level: Disable keeps the gain underneath. */
export function disabledOnAdd(itemId: string, muted: boolean, soloedId: string | null): boolean {
  return !isHeard(itemId, muted, soloedId)
}
