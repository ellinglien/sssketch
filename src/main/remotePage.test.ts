import { describe, expect, it } from 'vitest'
import { REMOTE_PAIR_QUERY_PARAM } from '@shared/remoteAuth'
import { DISCOVER_SLOT_KIND_LABEL, DISCOVER_SLOT_KIND_OPTIONS } from '@shared/discoverSlotKind'
import { buildSlotKindToggleTable } from '@shared/discoverSlotKindMask'
import { REMOTE_PAGE_HTML } from './remotePage'

/** The phone page is one hand-written string, so these are the only checks
 * that can be made of it without a browser. They are the ones worth having:
 * that scanning the QR code still goes through the single pairing route,
 * and that the code does not stay in the address bar afterwards. */
describe('remotePage pairing', () => {
  it('has exactly one way to pair -- the qr link fills the same form in', () => {
    const attempts = REMOTE_PAGE_HTML.match(/fetch\('\/api\/pair'/g) ?? []
    expect(attempts).toHaveLength(1)
  })

  it('reads the pairing code out of the query parameter the qr encodes', () => {
    expect(REMOTE_PAGE_HTML).toContain(`/[?&]${REMOTE_PAIR_QUERY_PARAM}=([^&]*)/`)
  })

  it('strips the code from the address bar rather than leaving it to be reloaded', () => {
    expect(REMOTE_PAGE_HTML).toContain("history.replaceState(null, '', location.pathname)")
  })
})

/** The embedded script, without the surrounding markup -- so a check for a
 * guard cannot be satisfied by a comment in the stylesheet. */
const SCRIPT = (/<script>([\s\S]*)<\/script>/.exec(REMOTE_PAGE_HTML) ?? ['', ''])[1]

describe('remotePage kind picker', () => {
  it('embeds the toggle table built from toggleSlotKind, not its own rules', () => {
    expect(SCRIPT).toContain(JSON.stringify(buildSlotKindToggleTable()))
  })

  it('changes a selection only by a table lookup', () => {
    expect(SCRIPT).toContain('pendingMask = KIND_TOGGLE[pendingMask][index]')
    const writes = SCRIPT.match(/pendingMask = /g) ?? []
    // Three: the declaration, the table lookup, and the clear after an
    // add. Nothing else may COMPUTE a selection -- that is what would
    // become a second copy of the combination rules.
    expect(writes).toHaveLength(3)
  })

  it('offers every kind, by its own playful label', () => {
    for (const kind of DISCOVER_SLOT_KIND_OPTIONS) {
      expect(SCRIPT).toContain(`"l":"${DISCOVER_SLOT_KIND_LABEL[kind]}"`)
      expect(SCRIPT).toContain(`"k":"${kind}"`)
    }
  })

  it('refuses to add a slot with nothing chosen', () => {
    expect(SCRIPT).toContain('if (kinds.length === 0) return')
  })

  it('sends kinds by name, and never anything else, to the add route', () => {
    const adds = SCRIPT.match(/api\('\/api\/add-slot'[^)]*\)/g) ?? []
    expect(adds).toEqual(["api('/api/add-slot', { kinds: kinds })"])
  })
})

describe('remotePage slots', () => {
  it('needs two taps to remove, because the phone has no undo', () => {
    expect(SCRIPT).toContain("drop.textContent = armed ? 'sure' : 'remove'")
    expect(SCRIPT).toContain('if (armedRemoveId === slot.id) {')
    const removes = SCRIPT.match(/api\('\/api\/remove-slot'[^)]*\)/g) ?? []
    expect(removes).toEqual(["api('/api/remove-slot', { slotId: slot.id })"])
  })

  it('lets an arming lapse rather than sitting armed in a pocket', () => {
    expect(SCRIPT).toContain('armedRemoveTimer = setTimeout(')
  })

  it('drops an arming when the slot it points at is gone', () => {
    expect(SCRIPT).toContain('if (!stillThere) disarmRemove()')
  })

  it('rebuilds the rows only when they changed, so a poll cannot eat a tap', () => {
    expect(SCRIPT).toContain('if (key === lastRowsKey) return')
  })
})

describe('remotePage empty state', () => {
  it('invites the first add rather than reporting emptiness', () => {
    expect(REMOTE_PAGE_HTML).toContain('pick what you want below, then add it')
    expect(REMOTE_PAGE_HTML.toLowerCase()).not.toContain('no slots')
    expect(REMOTE_PAGE_HTML.toLowerCase()).not.toContain('nothing here')
  })

  it('shows the picker whenever discover is open, slots or not', () => {
    expect(SCRIPT).toContain('pickerEl.hidden = false')
    expect(SCRIPT).toContain('emptyEl.hidden = state.slots.length > 0')
    expect(SCRIPT).toContain('loopEl.hidden = state.slots.length === 0')
  })
})

describe('remotePage copy', () => {
  const buttonLabels = [...REMOTE_PAGE_HTML.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map(
    (match) => match[1].trim()
  )

  it('found the page buttons at all', () => {
    expect(buttonLabels).toContain('add slot')
    expect(buttonLabels.length).toBeGreaterThanOrEqual(5)
  })

  it('keeps every button to two words, as asked on 2026-09-26', () => {
    // The labels swapped in at runtime are here too -- they are buttons
    // the same way.
    const runtime = ['stop', 'play', 'sure', 'remove']
    for (const label of [...buttonLabels, ...runtime]) {
      expect(label.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(2)
    }
  })

  it('stays lowercase, with no emoji and no exclamation marks', () => {
    for (const label of buttonLabels) {
      expect(label).toBe(label.toLowerCase())
      expect(label).not.toContain('!')
    }
  })
})
