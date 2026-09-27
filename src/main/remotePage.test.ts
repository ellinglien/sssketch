import { describe, expect, it } from 'vitest'
import { REMOTE_PAIR_QUERY_PARAM } from '@shared/remoteAuth'
import { DISCOVER_SLOT_KIND_LABEL, DISCOVER_SLOT_KIND_OPTIONS } from '@shared/discoverSlotKind'
import { buildSlotKindToggleTable } from '@shared/discoverSlotKindMask'
import {
  REMOTE_NOTHING_HERE_NOTICE,
  REMOTE_PAGE_HTML,
  REMOTE_WRONG_ADDRESS_NOTICE,
  acceptsHtml,
  remoteNoticePage
} from './remotePage'

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
    expect(SCRIPT).toContain("drop.textContent = armed ? 'sure' : 'x'")
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

  it('always offers the first add, slots or not', () => {
    // The chooser is a sheet now, so there is no always-visible picker to
    // unhide -- `new stem` is simply never hidden, and it is the one thing
    // you can do with an empty screen.
    expect(SCRIPT).not.toContain('pickerEl.hidden')
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
    // The labels swapped in at runtime are here too -- they are buttons the
    // same way. So are the ones inside a button that contains elements: the
    // regex above matches only <button>text</button>, so `keep` (a fill span
    // and two label spans) is invisible to it.
    const runtime = [
      'stop',
      'play',
      'sure',
      'x',
      'keep',
      'hold',
      'similar',
      'adjacent',
      'random',
      'duplicate'
    ]
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

/** The bug this file's newest tests exist for, 2026-09-26: a phone whose
 * saved tab pointed at the address the Mac advertised BEFORE f1fcc9b (the
 * bridge address, 192.168.3.1 on his machine) still reached the server --
 * different interface, same 0.0.0.0 listen -- and was refused by the Host
 * guard with `{}` and a json content type. iOS Safari draws that as a full
 * white screen with two characters in the corner, which is indistinguishable
 * from a page that failed to render. Confirmed in the iOS simulator. */
describe('acceptsHtml', () => {
  it('recognises a browser navigation', () => {
    expect(acceptsHtml('text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8')).toBe(
      true
    )
    expect(acceptsHtml('TEXT/HTML')).toBe(true)
  })

  it('does not recognise the page’s own fetch calls', () => {
    // fetch() with no Accept of its own sends */*. The page reads every
    // refusal as json and must keep getting json -- show(false) on a 401 is
    // how a stale token finds its way back to the pairing form.
    expect(acceptsHtml('*/*')).toBe(false)
    expect(acceptsHtml('application/json')).toBe(false)
    expect(acceptsHtml(undefined)).toBe(false)
  })
})

describe('remoteNoticePage', () => {
  it('says the one thing it has to say, visibly', () => {
    const page = remoteNoticePage(REMOTE_WRONG_ADDRESS_NOTICE)
    expect(page).toContain('<!doctype html>')
    expect(page).toContain(REMOTE_WRONG_ADDRESS_NOTICE)
    // The whole point: it is not a white void. Same near-black ground as
    // the remote itself.
    expect(page).toContain('background: #050505')
  })

  it('never names the address it is refusing', () => {
    // The Host guard's job is to not confirm what this machine is called
    // from the inside. A notice that printed the expected address would
    // hand that to anything that navigated into the refusal.
    for (const notice of [REMOTE_WRONG_ADDRESS_NOTICE, REMOTE_NOTHING_HERE_NOTICE]) {
      expect(remoteNoticePage(notice)).not.toMatch(/\d{1,3}(\.\d{1,3}){3}/)
    }
  })

  it('stays in the page’s own voice', () => {
    for (const notice of [REMOTE_WRONG_ADDRESS_NOTICE, REMOTE_NOTHING_HERE_NOTICE]) {
      expect(notice).toBe(notice.toLowerCase())
      expect(notice).not.toContain('!')
    }
  })
})

describe('remotePage layout 1a', () => {
  it('puts the counters up on the eyebrow row instead of on their own line', () => {
    // Four grey lines (eyebrow, h1, counts, kept-name) collapse to two.
    expect(REMOTE_PAGE_HTML).toContain('class="topbar"')
    expect(SCRIPT).toContain("countsEl.textContent = 'kept '")
  })

  it('starts the stack at the top and builds downward', () => {
    // Reversed on 2026-09-27 after the first real iphone session: "the
    // waves can appear starting at the top of the screen and build from
    // under". The viewport-height wrap stays -- it is what keeps the ground
    // near-black all the way down -- but nothing is pushed against it any
    // more.
    expect(REMOTE_PAGE_HTML).toContain('min-height: 100dvh')
    expect(REMOTE_PAGE_HTML).not.toContain('margin-top: auto')
    // A bare `#app` rule would beat [hidden]'s display:none on specificity
    // and show the app state to an unpaired phone. There is no #app rule at
    // all now; if one comes back it must be :not([hidden]).
    expect(REMOTE_PAGE_HTML).not.toMatch(/^#app[\s{>]/m)
  })

  it('rests the status line on the last kept rifff instead of on nothing', () => {
    expect(SCRIPT).toContain('function restStatus()')
    expect(SCRIPT).toContain("'last kept \\u00b7 '")
  })

  it('keeps the app state free of a second title', () => {
    // `side quest` belongs on the pair screen -- it names the thing you are
    // connecting to. Once connected you are looking at your own loop.
    const h1s = REMOTE_PAGE_HTML.match(/<h1>/g) ?? []
    expect(h1s).toHaveLength(1)
  })
})

describe('remotePage rows', () => {
  it('lays a row out as label, stem, remove', () => {
    expect(REMOTE_PAGE_HTML).toContain('grid-template-columns: 84px 1fr 44px')
    expect(REMOTE_PAGE_HTML).toContain('min-height: 50px')
  })

  it('draws each stem’s own waveform, from peaks the mac already had', () => {
    expect(SCRIPT).toContain('function drawRowWave(')
    expect(SCRIPT).toContain('slot.peaks')
  })

  it('says muted by taking the colour away, never by dimming it', () => {
    // StemWaveformRow.tsx's "gray means quieter/off": the colour layer is
    // suppressed and the grey one stays at full strength. #6a6a6a is the
    // hand-copied --ra-text-3 that layer is drawn in.
    expect(SCRIPT).toContain("slot.muted ? '#6a6a6a' : (TYPE_COLORS[slot.soundType] || '#6a6a6a')")
    // The whole rule, asserted rather than remembered: mute is the absence
    // of colour. Nothing on this page may express it by fading.
    expect(REMOTE_PAGE_HTML).not.toContain('opacity')
  })

  it('shortens remove to an icon and still needs two taps', () => {
    expect(SCRIPT).toContain("drop.textContent = armed ? 'sure' : 'x'")
  })
})

describe('remotePage without a master waveform', () => {
  it('lets the stack of per-stem shapes be the picture', () => {
    expect(SCRIPT).not.toContain('peaksFromBuffer')
    expect(SCRIPT).not.toContain('wavePeaks')
    expect(REMOTE_PAGE_HTML).not.toContain('id="wave"')
  })

  it('keeps the playhead, because it is the only motion on the page', () => {
    expect(REMOTE_PAGE_HTML).toContain('id="line"')
    expect(REMOTE_PAGE_HTML).toContain('background: #c56164')
    expect(SCRIPT).toContain("lineEl.style.left = (progress * 100) + '%'")
    // An indicator, not a seek. Both guards, as before.
    expect(REMOTE_PAGE_HTML).toContain('pointer-events: none')
  })

  it('runs the line down the waveform column only, not across the whole row', () => {
    // "the playhead line doesnt follow where the waveform would be (the
    // scroll includes the text descriptor, like drummy).. it should follow
    // the waves only" -- Elling, on the phone, 2026-09-27.
    //
    // The lane's two insets are the row grid read off exactly: 105 = the
    // row's 1px border + 10px left padding + the 84px kind column + the
    // 10px gap, and 55 = the 1px border + the 44px x column + its gap. The
    // stem column has no horizontal padding of its own, so the lane is the
    // drawn waveform's box and not an approximation of it. All four numbers
    // are asserted together, because changing one without the others is
    // exactly the bug.
    expect(REMOTE_PAGE_HTML).toContain('grid-template-columns: 84px 1fr 44px')
    expect(REMOTE_PAGE_HTML).toContain('column-gap: 10px')
    expect(REMOTE_PAGE_HTML).toContain('.row .stem { min-width: 0; padding: 6px 0; }')
    expect(REMOTE_PAGE_HTML).toContain('id="lane"')
    expect(REMOTE_PAGE_HTML).toContain('left: 105px')
    expect(REMOTE_PAGE_HTML).toContain('right: 55px')
    // Re-appended after every rebuild, with the line still inside it.
    expect(SCRIPT).toContain('rowsEl.appendChild(laneEl)')
  })
})

describe('remotePage row gestures', () => {
  it('opens the menu on a long press and mutes on a short tap', () => {
    expect(SCRIPT).toContain('HOLD_MS = 450')
    expect(SCRIPT).toContain("action: 'mute'")
  })

  it('never lets a fired long press also fire the tap on release', () => {
    expect(SCRIPT).toContain('if (holdFired || holdMoved) return')
  })

  it('cancels the press on a scroll, a leave or a cancel', () => {
    expect(SCRIPT).toContain('SLOP_PX = 10')
    expect(SCRIPT).toContain("row.addEventListener('pointercancel'")
    expect(SCRIPT).toContain("row.addEventListener('pointerleave'")
  })

  it('leaves the x out of both gestures', () => {
    expect(SCRIPT).toContain("e.target.tagName === 'BUTTON'")
  })

  it('guards the haptic rather than calling it bare', () => {
    // ios safari does not implement it at all.
    expect(SCRIPT).toContain('if (navigator.vibrate)')
    expect(SCRIPT).toContain('navigator.vibrate(10)')
  })

  it('paints a mute before the poll can confirm it', () => {
    // The poll is up to 700ms behind. A mute you cannot see land is
    // indistinguishable from a tap that missed.
    expect(SCRIPT).toContain('slot.muted = !slot.muted')
  })
})

describe('remotePage bottom sheets', () => {
  it('has one sheet treatment, used by both sheets', () => {
    expect(REMOTE_PAGE_HTML).toContain('rgba(5,5,5,0.72)')
    expect(REMOTE_PAGE_HTML).toContain('border-top: 1px solid #3a3a3a')
  })

  it('makes new stem the one lit control on the page', () => {
    expect(REMOTE_PAGE_HTML).toContain('id="new-stem"')
    expect(REMOTE_PAGE_HTML).toContain('height: 120px')
    expect(REMOTE_PAGE_HTML).toContain('border: 1px solid #ededed')
  })

  it('splits the chips into what it is and what it feels like', () => {
    expect(REMOTE_PAGE_HTML).toContain('what kind')
    expect(REMOTE_PAGE_HTML).toContain('what it feels like')
  })

  it('still changes a selection only by a table lookup', () => {
    // Unchanged from before the rewrite, and the reason the phone's picker
    // IS the mac's picker.
    expect(SCRIPT).toContain('pendingMask = KIND_TOGGLE[pendingMask][index]')
    const writes = SCRIPT.match(/pendingMask = /g) ?? []
    expect(writes).toHaveLength(3)
  })
})

describe('remotePage hold to keep', () => {
  it('takes 700ms of thumb, not a tap', () => {
    expect(SCRIPT).toContain('KEEP_MS = 700')
    expect(SCRIPT).toContain("api('/api/keep', {})")
  })

  it('sweeps an inversion, not a colour', () => {
    expect(REMOTE_PAGE_HTML).toContain('mix-blend-mode: difference')
    expect(REMOTE_PAGE_HTML).toContain('isolation: isolate')
    expect(REMOTE_PAGE_HTML).toContain('transition: width 700ms linear')
  })

  it('says how to use it, in one word', () => {
    expect(REMOTE_PAGE_HTML).toContain('>hold</span>')
  })

  it('abandons the hold on a lift, a leave or a cancel', () => {
    expect(SCRIPT).toContain('function cancelKeep()')
  })

  it('keeps the transport three-up and 52px', () => {
    expect(REMOTE_PAGE_HTML).toContain('height: 52px')
  })
})

describe('remotePage stem action sheet', () => {
  it('offers the four actions the desktop row already has', () => {
    expect(REMOTE_PAGE_HTML).toContain('id="act-sheet"')
    for (const action of ['similar', 'adjacent', 'random', 'duplicate']) {
      expect(SCRIPT).toContain(`"a":"${action}"`)
    }
  })

  it('sends only actions the mac will accept, to the one route', () => {
    const posts = SCRIPT.match(/api\('\/api\/slot-action'[^)]*\)/g) ?? []
    expect(posts).toEqual([
      "api('/api/slot-action', { slotId: slot.id, action: 'mute' })",
      "api('/api/slot-action', { slotId: actSlot.id, action: act.a })"
    ])
  })

  it('lays the four out two by two, at 64px', () => {
    expect(REMOTE_PAGE_HTML).toContain('grid-template-columns: 1fr 1fr')
    expect(REMOTE_PAGE_HTML).toContain('min-height: 64px')
  })

  it('closes when the slot it points at is gone', () => {
    expect(SCRIPT).toContain('if (!actStillThere) closeActionSheet()')
  })

  it('never has two sheets open at once', () => {
    expect(SCRIPT).toContain('closeKindSheet()')
    expect(SCRIPT).toContain('closeActionSheet()')
  })
})

describe('remotePage csp reality', () => {
  it('has no image of any kind, because the csp forbids even a data uri', () => {
    expect(REMOTE_PAGE_HTML).not.toContain('<img')
    expect(REMOTE_PAGE_HTML).not.toContain('url(data:image')
    expect(REMOTE_PAGE_HTML).not.toContain('background-image')
  })

  it('stays in the conservative dialect the whole page is written in', () => {
    expect(SCRIPT).not.toContain('=>')
    expect(SCRIPT).not.toContain('??')
    expect(SCRIPT).not.toContain('?.')
  })
})

describe('remotePage last resort', () => {
  it('shows a line rather than nothing if its own script throws', () => {
    // Hidden until something actually throws -- it is a last resort, not a
    // banner.
    expect(REMOTE_PAGE_HTML).toContain('id="broke" hidden')
    // Registered as a listener, NOT as a try/catch around init: the throw
    // still happens, still reaches the console, and is still a bug. A
    // handler that swallowed it would hide the next one.
    expect(SCRIPT).toContain("window.addEventListener('error'")
    expect(SCRIPT).not.toContain('preventDefault')
  })
})
