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
    expect(SCRIPT).toContain("drop.textContent = going ? 'going' : (armed ? 'sure' : 'x')")
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

  it('arms by repainting one button, because a rebuild throws the scroll', () => {
    // "initial click to engage 'sure' and delete stem for stems low on
    // screen when bottom buttons are showing, it jumps the scroll to
    // another point" -- Elling, on the phone, 2026-09-27. armedRemoveId was
    // part of the repaint key, so arming wiped rowsEl and rebuilt every row
    // and canvas; the list has no height for that instant, the document is
    // shorter than the scroll offset, and the browser clamps it.
    expect(SCRIPT).toContain('var key = JSON.stringify(lastSlots)')
    expect(SCRIPT).not.toContain("+ '|' + armedRemoveId")
    expect(SCRIPT).toContain('function paintDrop(')
    // One wipe of the row list in the whole script, and it is renderRows'.
    const wipes = SCRIPT.match(/rowsEl\.innerHTML = ''/g) ?? []
    expect(wipes).toHaveLength(1)
    // And one place that writes the label, so arming and the first build
    // cannot drift apart.
    const labelWrites = SCRIPT.match(/drop\.textContent = /g) ?? []
    expect(labelWrites).toHaveLength(1)
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
      'duplicate',
      'going',
      'loop end',
      '8 bars',
      '4 bars',
      '2 bars'
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
  it('lays a row out as two lines -- what it is, then what to do with it', () => {
    // "reduce or make two rows for where the name is currently" -- Elling,
    // on the phone, 2026-09-27. Four controls, a name and a waveform do not
    // fit across one 390px line.
    expect(REMOTE_PAGE_HTML).toContain('grid-template-columns: 42px 42px 1fr 44px')
    expect(REMOTE_PAGE_HTML).toContain(
      'grid-template-areas: "kind kind name name" "solo mute wave drop"'
    )
    // 28px of name line and 42px of controls line: 42 is the tap target
    // every control on this page is held to, and the two plus the border
    // are the row's own height.
    expect(REMOTE_PAGE_HTML).toContain('grid-template-rows: 28px 42px')
    expect(REMOTE_PAGE_HTML).toContain('min-height: 72px')
  })

  it('gives the name the whole first line, x\u2019s column included', () => {
    // The point of the second line: the name used to share the middle
    // column with the waveform and ellipsised early. It now spans both of
    // the first line's right-hand columns, which is 54px it did not have.
    expect(REMOTE_PAGE_HTML).toContain('grid-area: name;')
    expect(REMOTE_PAGE_HTML).toContain('text-overflow: ellipsis')
  })

  it('keeps x at the far end of the controls line from s and m', () => {
    // x is the destructive one and it had no neighbours before tonight.
    // The areas row says it: solo and mute at the left, the waveform, then
    // drop -- and a whole waveform between them is the separation.
    const areas = /grid-template-areas: "kind kind name name" "(.*)"/.exec(REMOTE_PAGE_HTML)
    expect(areas).not.toBeNull()
    const line = (areas ?? ['', ''])[1].split(/\s+/)
    expect(line[0]).toBe('solo')
    expect(line[1]).toBe('mute')
    expect(line[line.length - 1]).toBe('drop')
    expect(line.indexOf('wave')).toBeGreaterThan(line.lastIndexOf('mute'))
    expect(line.indexOf('wave')).toBeLessThan(line.indexOf('drop'))
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
    expect(SCRIPT).toContain("drop.textContent = going ? 'going' : (armed ? 'sure' : 'x')")
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
    // The lane's two insets are the row grid read off exactly: 115 = the
    // row's 1px border + 10px left padding + the 42px s column + a 10px
    // gap + the 42px m column + another 10px gap, and 55 = the 1px border
    // + the 44px x column + its gap. The stem cell has no horizontal
    // padding of its own, so the lane is the drawn waveform's box and not
    // an approximation of it. All of these are asserted together, because
    // changing one without the others is exactly the bug.
    expect(REMOTE_PAGE_HTML).toContain('grid-template-columns: 42px 42px 1fr 44px')
    expect(REMOTE_PAGE_HTML).toContain('column-gap: 10px')
    expect(REMOTE_PAGE_HTML).toContain('.row .stem { grid-area: wave; min-width: 0; }')
    expect(REMOTE_PAGE_HTML).toContain('id="lane"')
    expect(REMOTE_PAGE_HTML).toContain('left: 115px')
    expect(REMOTE_PAGE_HTML).toContain('right: 55px')
    // Re-appended after every rebuild, with the line still inside it.
    expect(SCRIPT).toContain('rowsEl.appendChild(laneEl)')
  })
})

describe('remotePage seamless loop swap', () => {
  it('hands over at the end of the loop, not when the download lands', () => {
    // "ideally this would be seamless .. so the transitions and new mix
    // renders play when a loop ends.. ideally it'd be instantaneous at the
    // end of the loop" -- Elling, 2026-09-27. The playing source has looped
    // seamlessly since startedAt, so its boundaries are startedAt + k *
    // duration. Both ends are scheduled against that one instant on the
    // audio clock, which is what makes the handover sample-accurate rather
    // than "soon after this callback ran".
    // The period is `period` rather than `dur` since the handover grid
    // landed (2026-09-27) -- same arithmetic, a shorter step. swapPeriod()
    // returns the whole loop's duration on the default setting, so this IS
    // still the end-of-loop handover unless a chip says otherwise.
    expect(SCRIPT).toContain('var at = startedAt + Math.ceil((now - startedAt) / period) * period')
    expect(SCRIPT).toContain('next.start(at)')
    expect(SCRIPT).toContain('srcNode.stop(at)')
  })

  it('takes the next boundary along when this one is too close to schedule', () => {
    // start(t)/stop(t) with a t that has passed are clamped to "now", which
    // is the mid-loop cut this exists to avoid. 80ms clears the hardware
    // buffer ios renders ahead by, plus a frame or two of main-thread jitter.
    expect(SCRIPT).toContain('SWAP_LEAD = 0.08')
    expect(SCRIPT).toContain('if (at - now < SWAP_LEAD) at = at + period')
  })

  it('swaps at once when nothing is sounding, because there is nothing to cut', () => {
    expect(SCRIPT).toContain(
      'if (!wantPlaying || !srcNode || !audioBuffer || !(audioBuffer.duration > 0)) {'
    )
  })

  it('moves the playhead onto the new buffer in the same step', () => {
    // The two loops need not be the same length, so the duration the
    // progress is divided by and the clock it counts from have to change
    // together with the sound.
    expect(SCRIPT).toContain('audioBuffer = swap.buffer')
    expect(SCRIPT).toContain('startedAt = swap.at')
    expect(SCRIPT).toContain('loadedLoopId = swap.id')
  })

  it('never leaves a scheduled source behind it', () => {
    // A third loop arriving before the second has started, and stopping the
    // transport with a swap already scheduled, are the two ways a source can
    // be superseded. Both go through one function, and stopping goes through
    // it before it touches the playing source.
    expect(SCRIPT).toContain('function cancelPendingSwap()')
    expect(SCRIPT).toContain('if (pendingSwap.at !== at) return')
    expect(SCRIPT).toContain('srcNode.onended = null')
    const cancels = SCRIPT.match(/cancelPendingSwap\(\)/g) ?? []
    expect(cancels.length).toBeGreaterThanOrEqual(3)
  })

  it('does not download the same loop again while it waits for its boundary', () => {
    expect(SCRIPT).toContain('if (pendingSwap && pendingSwap.id === currentLoopId) return')
  })

  it('moves the rows at the boundary too, so the picture never leads the sound', () => {
    // loadedLoopId is what is audible and currentLoopId is what the mac
    // wants; the rows follow the first. Drawing the new stems while the old
    // mix is still playing is seconds of the row saying one thing and the
    // phone playing another, every roll.
    expect(SCRIPT).toContain('function adoptPolledSlots()')
    expect(SCRIPT).toContain('if (polledLoopId !== loadedLoopId) return')
    expect(SCRIPT).toContain('if (!holdingForSwap()) lastSlots = state.slots')
  })

  it('holds the picture only while sound is actually on its way', () => {
    // A render that failed means nothing is coming. Freezing the rows on a
    // loop that will never arrive is worse than showing the mac's picture
    // early.
    expect(SCRIPT).toContain('return fetching || pendingSwap !== null')
  })
})

describe('remotePage swap grid', () => {
  it('offers loop end and three bar counts, and nothing else', () => {
    // "instead of it playing only at the end of the loop, could we set it
    // to update every 4 bars, 8 bars, etc? a switch and setting to do that?
    // so it's seamless but can update a bit sooner" -- Elling, 2026-09-27,
    // after hearing the end-of-loop handover.
    expect(SCRIPT).toContain("{ g: 0, l: 'loop end' }")
    expect(SCRIPT).toContain("{ g: 8, l: '8 bars' }")
    expect(SCRIPT).toContain("{ g: 4, l: '4 bars' }")
    expect(SCRIPT).toContain("{ g: 2, l: '2 bars' }")
    const options = SCRIPT.match(/\{ g: \d+, l: '/g) ?? []
    expect(options).toHaveLength(4)
  })

  it('starts on loop end, so nobody\u2019s phone changes until they touch a chip', () => {
    expect(SCRIPT).toContain('var swapGrid = 0')
    expect(SCRIPT).toContain('if (swapGrid === 0) return dur')
  })

  it('keeps the setting on the phone, with no route and no mac involved', () => {
    // A preference about how a handover should FEEL on this device. It
    // cannot drift out of step with the mac because the mac never hears
    // about it, and it survives a reload.
    expect(SCRIPT).toContain("SWAP_GRID_KEY = 'sssketch-remote-swap-grid'")
    expect(SCRIPT).toContain('localStorage.getItem(SWAP_GRID_KEY)')
    expect(SCRIPT).toContain('localStorage.setItem(SWAP_GRID_KEY, String(option.g))')
    // No new api() call went with it.
    const posts = SCRIPT.match(/api\('\/api\/[a-z-]+'/g) ?? []
    expect(posts.sort()).toEqual([
      "api('/api/add-slot'",
      "api('/api/keep'",
      "api('/api/remove-slot'",
      "api('/api/roll'",
      "api('/api/slot-action'",
      "api('/api/slot-action'"
    ])
  })

  it('never lets storage being off take the page down with it', () => {
    // Private browsing throws on both calls and blocked site data throws on
    // read; a first visit simply has nothing. All three land on the default.
    const reads = SCRIPT.match(/localStorage\.(get|set)Item/g) ?? []
    const guards = SCRIPT.match(/try \{[^}]*localStorage/g) ?? []
    expect(guards).toHaveLength(reads.length)
  })

  it('derives seconds per bar from the buffer, never from a bpm', () => {
    // The buffer is the ground truth for what is sounding. A bpm on the
    // wire would be a second copy of the same fact, free to disagree.
    expect(SCRIPT).toContain('var dur = audioBuffer.duration')
    expect(SCRIPT).toContain('return (dur * step) / bars')
    expect(SCRIPT).not.toContain('bpm')
  })

  it('never makes the wait longer than the loop it is supposed to shorten', () => {
    // Every 8 bars over a 4-bar loop would mean waiting two whole cycles --
    // worse than the default it replaced.
    expect(SCRIPT).toContain('if (step > bars) step = bars')
  })

  it('steps a grid that does not divide the loop down to one that does', () => {
    // 4 bars over a 6-bar loop would land at bar 4, then bar 2 of the next
    // cycle, then bar 0 -- drifting across the phrase and never repeating.
    // Stepping down to 3 keeps every boundary at the same place in the loop
    // every cycle, so the downbeats stay where they were.
    expect(SCRIPT).toContain('while (step > 1 && bars % step !== 0) step = step - 1')
  })

  it('falls back to the whole loop when the mac has not said how long it is', () => {
    expect(SCRIPT).toContain('if (!(bars > 0) || bars !== Math.floor(bars)) return dur')
  })

  it('moves the bar count with the buffer it describes, not with the poll', () => {
    // loadedLoopBars belongs to the buffer that is AUDIBLE, the same way
    // loadedLoopId does, so a swap scheduled against the playing loop uses
    // the playing loop's own grid.
    expect(SCRIPT).toContain('var loadedLoopBars = 0')
    expect(SCRIPT).toContain('loadedLoopBars = swap.bars')
    expect(SCRIPT).toContain('function barsForLoop(id)')
    expect(SCRIPT).toContain('return polledLoopId === id ? polledLoopBars : 0')
  })

  it('leaves a handover that is already scheduled on the boundary it was given', () => {
    // Both of its ends are committed on the audio clock, and moving a stop
    // that may be inside the render quantum has no honest answer -- the same
    // reason takeLoop drops a buffer whose boundary has moved. Tapping a
    // chip therefore schedules nothing, cancels nothing and makes no sound.
    const handler = (/swapGrid = option\.g[\s\S]{0,200}/.exec(SCRIPT) ?? [''])[0]
    expect(handler).not.toContain('cancelPendingSwap')
    expect(handler).not.toContain('takeLoop')
    expect(handler).not.toContain('startSource')
    expect(handler).toContain('paintGridChips()')
  })

  it('sits under the transport, in the block that appears with the loop', () => {
    // Below the three big buttons rather than above them: they keep the
    // position the thumb already knows, and this is set once, not used every
    // few seconds. Inside #loop, so it comes and goes with the loop it
    // describes.
    const loopBlock = (/<div id="loop" hidden>[\s\S]*?<\/div>\s*<div class="eyebrow foot"/.exec(
      REMOTE_PAGE_HTML
    ) ?? [''])[0]
    expect(loopBlock).toContain('id="chips-grid"')
    expect(loopBlock.indexOf('id="roll-all"')).toBeLessThan(loopBlock.indexOf('id="chips-grid"'))
    expect(REMOTE_PAGE_HTML).toContain('swap every')
    // Four across in one row, and still a 42px tap target.
    expect(REMOTE_PAGE_HTML).toContain('.chips.grid button.chip { flex: 1 1 0; min-width: 0; }')
    expect(REMOTE_PAGE_HTML).toContain('min-height: 42px')
  })
})

describe('remotePage row gestures', () => {
  it('opens the menu on a long press and cycles the row on a short tap', () => {
    expect(SCRIPT).toContain('HOLD_MS = 450')
    expect(SCRIPT).toContain('var next = nextSlotAction(slot)')
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

describe('remotePage solo', () => {
  it('makes the first press a solo and the second a mute', () => {
    // "could we also add solo? first press is solo, then second press is
    // mute / like double tap" -- Elling, 2026-09-27. Two verbs cover three
    // states because the mac's own two functions do: toggleSlotSolo drops
    // every other row out, toggleSlotPreview takes this one out and puts it
    // back.
    expect(SCRIPT).toContain('function nextSlotAction(slot)')
    expect(SCRIPT).toContain("return slot.soloed ? 'mute' : 'solo'")
    expect(SCRIPT).toContain('if (slot.muted) return')
  })

  it('reads which third of the cycle it is in off the mix, not off a mode', () => {
    // soloed comes from the mac, computed by remoteStateFromSlots the same
    // way toggleSlotSolo computes it. The page never decides on its own that
    // a row is soloed -- except between polls, where it has just made it so.
    expect(SCRIPT).toContain('slot.soloed')
  })

  it('paints a solo as every other row losing its colour, and nothing more', () => {
    // A solo IS the other rows dropping out, so it needs no affordance of
    // its own: they go grey by the mute treatment that already exists, and
    // the one row still in colour is the picture. There is no spare colour
    // on this page and nothing on it may fade.
    expect(SCRIPT).toContain('lastSlots[i].muted = lastSlots[i].id !== slot.id')
    expect(SCRIPT).toContain('lastSlots[i].soloed = lastSlots[i].id === slot.id')
    expect(REMOTE_PAGE_HTML).not.toContain('opacity')
    // The one place a row's colour is decided, unchanged by solo.
    expect(SCRIPT).toContain("slot.muted ? '#6a6a6a' : (TYPE_COLORS[slot.soundType] || '#6a6a6a')")
  })
})

describe('remotePage going away', () => {
  it('says a row is on its way out in a word, at the button that did it', () => {
    // "have a way to show when a stem has been removed and will disappear
    // soon" -- Elling, 2026-09-27. Between the confirming tap and the row
    // actually going there was no sign at all, which is indistinguishable
    // from a tap that missed, so the instinct is to tap again.
    //
    // A WORD, not a treatment, and it goes in the one cell whose job is
    // removal -- the message lands exactly where the thumb was. The four
    // facts it had to survive: nothing on this page may fade; there is no
    // colour to spend on chrome; #6a6a6a is already the muted treatment and
    // a going row is still SOUNDING, so it must not read as silenced; and
    // inversion already means armed, a question ("sure"), which must not
    // come to also mean a statement you are being told.
    expect(SCRIPT).toContain("drop.textContent = going ? 'going' : (armed ? 'sure' : 'x')")
    expect(SCRIPT).toContain(
      "drop.className = going ? 'drop going' : (armed ? 'drop armed' : 'drop')"
    )
    expect(REMOTE_PAGE_HTML).toContain('button.drop.going { color: #ededed; }')
    // The row itself takes a quiet structural mark and keeps every bit of
    // its colour, because the stem is still in the loop that is playing.
    expect(REMOTE_PAGE_HTML).toContain('.row.going { border-color: #3a3a3a; }')
    expect(REMOTE_PAGE_HTML).not.toContain('opacity')
    // Not a second use of the mute grey, and not a second use of inversion.
    expect(REMOTE_PAGE_HTML).not.toContain('.row.going { background: #ededed')
  })

  it('stops responding to the thumb the moment it is going', () => {
    // No mute, no long press, no re-arming the remove. A row you have
    // already removed has nothing left to ask it.
    const guards = SCRIPT.match(/if \(isGoing\(slot\.id\)\) return/g) ?? []
    expect(guards).toHaveLength(3)
    expect(REMOTE_PAGE_HTML).toContain('.row.going:active { background: #0a0a0a; }')
  })

  it('marks the row without rebuilding the list', () => {
    // d7ff531 took armedRemoveId out of the repaint key precisely because
    // arming one button rebuilt every row and threw the scroll. Going is
    // per-row presentational state of exactly the same kind and stays out
    // of the key for exactly the same reason.
    expect(SCRIPT).toContain('var key = JSON.stringify(lastSlots)')
    expect(SCRIPT).not.toMatch(/var key = .*goingRemoveIds/)
    expect(SCRIPT).toContain('function markGoing(id)')
    expect(SCRIPT).toContain('function paintGoingRow(id)')
    // Still exactly one wipe of the row list, and it is renderRows'.
    const wipes = SCRIPT.match(/rowsEl\.innerHTML = ''/g) ?? []
    expect(wipes).toHaveLength(1)
  })

  it('is a pending indicator and not an undo window', () => {
    // He asked to SHOW it, not to take it back. The remove posts on the
    // confirming tap exactly as it always did -- nothing is delayed, queued
    // or cancellable.
    const removes = SCRIPT.match(/api\('\/api\/remove-slot'[^)]*\)/g) ?? []
    expect(removes).toEqual(["api('/api/remove-slot', { slotId: slot.id })"])
    // The post goes FIRST and the mark is drawn after it, so there is no
    // instant in which the row says going and nothing has been asked for.
    expect(SCRIPT.indexOf("api('/api/remove-slot'")).toBeLessThan(
      SCRIPT.indexOf('markGoing(slot.id)')
    )
    // And the line under the buttons stops claiming it is already done.
    expect(SCRIPT).toContain("flash('removing')")
  })

  it('stays going until the row actually goes, however long the loop is', () => {
    // The promise is "will disappear soon", so it is kept until the row
    // disappears -- which, with the rows held to the audible loop, can be a
    // whole loop after the mac agreed.
    expect(SCRIPT).toContain('function reconcileGoing()')
    expect(SCRIPT).toContain('if (!drawn) { delete goingRemoveIds[id]; continue }')
  })

  it('gives up only when the mac never took the removal at all', () => {
    // The mac offline, the command lost, discover closed. Eight seconds is
    // more than ten polls, and the clock is only consulted when the mac's
    // own live list STILL has the slot -- so a removal the mac did take can
    // never time out while it waits for a loop boundary, however long that
    // wait is.
    expect(SCRIPT).toContain('GOING_MS = 8000')
    expect(SCRIPT).toContain('if (macStillHasIt && Date.now() - goingRemoveIds[id] > GOING_MS) {')
  })

  it('reconciles everything the thumb can touch against what the thumb can see', () => {
    // The armed remove and the open action sheet used to check the MAC's
    // live list while the rows were held to the audible loop -- so an arming
    // could be dropped, and a sheet closed, under a row still drawn and
    // still sounding. Every gesture acts on a drawn row, so every gesture's
    // "is it still there" asks the drawn rows. Fixed here because the going
    // mark needed exactly this list and three lists in one function is how
    // the next one goes wrong.
    expect(SCRIPT).toContain('var stillThere = lastSlots.some(')
    expect(SCRIPT).toContain('var actStillThere = lastSlots.some(')
    expect(SCRIPT).toContain('if (!stillThere) disarmRemove()')
    expect(SCRIPT).toContain('if (!actStillThere) closeActionSheet()')
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
      "api('/api/slot-action', { slotId: slot.id, action: next })",
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

describe('remotePage text selection', () => {
  it('suppresses selection page-wide, because every gesture here is a press', () => {
    // "pressing and holding to keep i selected the text below on my iphone"
    // -- Elling, 2026-09-27. A row is a 450ms press and keep is a 700ms
    // one; neither may raise ios's selection handles over the page.
    expect(REMOTE_PAGE_HTML).toContain('-webkit-user-select: none')
    expect(REMOTE_PAGE_HTML).toContain('-webkit-touch-callout: none')
  })

  it('does it in css, because the script may not have a preventDefault', () => {
    // The nicer js fix is a selectstart handler, and this page is not
    // allowed one -- see 'remotePage last resort' below.
    expect(SCRIPT).not.toContain('selectstart')
    expect(SCRIPT).not.toContain('user-select')
  })

  it('hands selection back to the code field, which has to stay editable', () => {
    // Not optional: user-select: none on an input takes the ios caret
    // handles and the edit menu with it, paste included.
    expect(REMOTE_PAGE_HTML).toContain('user-select: text')
    expect(REMOTE_PAGE_HTML).toContain('-webkit-touch-callout: default')
  })

  it('has one mechanism for it, not two overlapping ones', () => {
    // The rows carried their own copy from the day the long press was
    // built. The * rule covers them, so theirs is gone; two rules saying
    // the same thing is how one of them gets changed alone later. The
    // pattern skips the -webkit- prefixed spelling on the same line, and
    // the trailing semicolon skips the prose in the comments around it.
    const declarations = REMOTE_PAGE_HTML.match(/[^-]user-select: none;/g) ?? []
    expect(declarations).toHaveLength(1)
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
