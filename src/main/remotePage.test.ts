import { describe, expect, it } from 'vitest'
import { REMOTE_PAIR_QUERY_PARAM } from '@shared/remoteAuth'
import { DISCOVER_SLOT_KIND_LABEL, DISCOVER_SLOT_KIND_OPTIONS } from '@shared/discoverSlotKind'
import { buildSlotKindToggleTable } from '@shared/discoverSlotKindMask'
import { TURNAROUND_MOVE_LABEL, TURNAROUND_MOVES } from '@shared/radioTurnaround'
import type { RemoteArcAnswer } from '@shared/remoteState'
import {
  RADIO_ARC_REST_SHORT,
  RADIO_BUILDING_WORD,
  RADIO_DROPPING_WORD
} from '@shared/radioIntensityArc'
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
    expect(SCRIPT).toContain('if (key === lastRowsKey) {')
  })

  it('arms by repainting one button, because a rebuild throws the scroll', () => {
    // "initial click to engage 'sure' and delete stem for stems low on
    // screen when bottom buttons are showing, it jumps the scroll to
    // another point" -- Elling, on the phone, 2026-09-27. armedRemoveId was
    // part of the repaint key, so arming wiped rowsEl and rebuilt every row
    // and canvas; the list has no height for that instant, the document is
    // shorter than the scroll offset, and the browser clamps it.
    expect(SCRIPT).toContain('var key = rowsKey(lastSlots)')
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

describe('remotePage radio roles', () => {
  it('offers the hook on the action sheet, and back for an away hook, while radio runs', () => {
    expect(REMOTE_PAGE_HTML).toContain('"a":"hook","l":"hook","h":"leaves, comes back"')
    expect(REMOTE_PAGE_HTML).toContain('"a":"hook","l":"release"')
    expect(REMOTE_PAGE_HTML).toContain('"a":"back","l":"back","h":"next phrase"')
    expect(REMOTE_PAGE_HTML).toContain(
      "if (hook === 'away' || hook === 'resting') acts.push(ROLE_ACTS.back)"
    )
    expect(REMOTE_PAGE_HTML).toContain('if (radioAhead) {')
  })

  it('offers dig on the action sheet while radio runs, and stop digging on the dug row', () => {
    expect(REMOTE_PAGE_HTML).toContain('"a":"dig","l":"dig","h":"lean toward this"')
    expect(REMOTE_PAGE_HTML).toContain('"a":"dig","l":"stop digging","h":"back to normal"')
    expect(REMOTE_PAGE_HTML).toContain(
      'acts.push(slot.role && slot.role.dig ? ROLE_ACTS.undig : ROLE_ACTS.dig)'
    )
  })

  it("paints a row's role words in place, after its stem name", () => {
    expect(REMOTE_PAGE_HTML).toContain("el.textContent = words ? ' · ' + words : ''")
    expect(REMOTE_PAGE_HTML).toContain('roleEls[slot.id] = role')
  })

  it('keys the row rebuild on a role cut to its hook and dig, never its words', () => {
    expect(REMOTE_PAGE_HTML).toContain("if (k === 'role' && v) return { hook: v.hook, dig: v.dig }")
    expect(REMOTE_PAGE_HTML).toContain('var key = rowsKey(lastSlots)')
    expect(REMOTE_PAGE_HTML).not.toContain('var key = JSON.stringify(lastSlots)')
    // the key function, run as the page runs it: words and bars away change nothing
    const src = REMOTE_PAGE_HTML.match(/function rowsKey\(slots\) \{[\s\S]*?\n {2}\}/)
    expect(src).not.toBeNull()
    const rowsKey = new Function(`${src![0]}; return rowsKey`)() as (s: unknown) => string
    const row = (words: string, away: number): object => ({
      id: 'a',
      stemName: 'x',
      role: { hook: 'away', dig: false, hookBarsAway: away, words }
    })
    expect(rowsKey([row('back in 16', 16)])).toBe(rowsKey([row('back in 15', 15)]))
    expect(rowsKey([row('back in 16', 16)])).not.toBe(
      rowsKey([{ id: 'a', stemName: 'x', role: { hook: 'in', dig: false } }])
    )
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
      's',
      'm',
      'keep',
      'hold',
      'similar',
      'adjacent',
      'random',
      'duplicate',
      'going',
      'cut',
      'short',
      'long',
      'own loop',
      'loop end',
      '8 bars',
      '4 bars',
      '2 bars',
      'turn',
      'turning',
      'build',
      'building',
      'drop',
      'dropping',
      'hook',
      'release',
      'back',
      'dig',
      'stop digging',
      'digging',
      ...TURNAROUND_MOVES.map((m) => TURNAROUND_MOVE_LABEL[m])
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
    expect(SCRIPT).toContain(
      "(slot.muted || dead) ? '#6a6a6a' : (TYPE_COLORS[slot.soundType] || '#6a6a6a')"
    )
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

describe('remotePage per-stem mixer', () => {
  it('gives every stem its own source and its own gain', () => {
    // "are we streaming all stems individually? if so lets make mute and
    // solo happen immediately" -- Elling, 2026-09-27. One mixdown became N
    // voices, and a gain node per voice is what makes a mute a gain change
    // rather than a round trip through a c++ renderer.
    expect(SCRIPT).toContain('function makeVoice(')
    expect(SCRIPT).toContain('audioCtx.createGain()')
    expect(SCRIPT).toContain('audioCtx.createBufferSource()')
    expect(SCRIPT).toContain('src.loop = true')
  })

  it('measures every source from one instant that never moves', () => {
    // The whole simplification: the old player moved its start time on
    // every handover because the incoming mix began at its own bar 0. Per
    // stem there is a phrase to enter, so there is nothing to reset.
    expect(SCRIPT).toContain('var haveOrigin = false')
    expect(SCRIPT).toContain('origin = audioCtx.currentTime + START_LEAD')
    // Exactly two writes: the declaration, and the one start.
    const writes = SCRIPT.match(/origin = /g) ?? []
    expect(writes).toHaveLength(2)
  })

  it('enters a stem at the phase the phrase is already at, not at its bar 0', () => {
    expect(SCRIPT).toContain('function offsetAt(at, dur)')
    expect(SCRIPT).toContain('var o = (at - origin) % dur')
    expect(SCRIPT).toContain('src.start(at, offsetAt(at, buf.duration))')
  })

  it('loops each stem at its own length, which is the tiling', () => {
    // A 2-bar hat under an 8-bar pad wraps four times a phrase, in phase,
    // with no arithmetic -- the same thing tileOffsetsPx draws and
    // PlaybackEngine::renderBlock walks.
    expect(SCRIPT).toContain('src.loopEnd = buf.duration')
    expect(SCRIPT).toContain('src.loopStart = 0')
  })

  it('takes the phrase length off the buffers, never off a tempo', () => {
    expect(SCRIPT).toContain('function loopDur()')
    expect(SCRIPT).toContain('return (dur * step) / bars')
    expect(SCRIPT).not.toContain('bpm')
  })

  it('addresses a stem only by the id the mac named, and never by a path', () => {
    const gets = SCRIPT.match(/fetch\('\/api\/stem[^)]*\)/g) ?? []
    expect(gets).toEqual([
      "fetch('/api/stem?id=' + stemId, { headers: { authorization: 'Bearer ' + token } })"
    ])
  })

  it('keeps a stem the mac stopped naming, because a mute is not a delete', () => {
    // A muted slot is not in discover's preview project at all, so its
    // stemId goes null. Null is "the mac is not naming one right now".
    expect(SCRIPT).toContain('if (ps.stemId) wantedStemId[ps.id] = ps.stemId')
    expect(SCRIPT).toContain('if (!seen[gone]) delete wantedStemId[gone]')
  })

  it('never downloads the same stem twice at once', () => {
    expect(SCRIPT).toContain('if (buffers[id] || fetchingIds[id]) continue')
  })

  it('runs the playhead off the one instant, so a roll no longer resets it', () => {
    expect(SCRIPT).toContain('var t = (audioCtx.currentTime - origin) % dur')
    expect(SCRIPT).toContain('if (t < 0) t = t + dur')
    expect(REMOTE_PAGE_HTML).toContain('pointer-events: none')
  })

  it('no longer fetches the rendered mixdown at all', () => {
    // /api/loop stays on the mac -- it is the only thing that can render
    // the loop as the mac's own engine hears it, and it is what there is to
    // compare against. The page simply stops asking for it.
    expect(SCRIPT).not.toContain("'/api/loop'")
  })

  it('takes every voice down with the transport, and with discover', () => {
    expect(SCRIPT).toContain('function stopAll()')
    expect(SCRIPT).toContain('for (var id in voices) killVoice(voices[id])')
  })
})

describe('remotePage mute is a gain', () => {
  it('changes the sound before the mac has heard about it', () => {
    // "lets make mute and solo happen immediately" -- Elling, 2026-09-27.
    // The gain moves in the handler the two buttons share; the POST is
    // only how the mac catches up. The optimistic paint is factored into
    // paintSlotAction, so this asserts the ORDER inside the one function
    // that does both, which is where the plan expected to find it inline.
    const send = (/function sendSlotAction\(slot, next\)[\s\S]{0,600}?\n {2}\}/.exec(SCRIPT) ?? [
      ''
    ])[0]
    expect(send).toContain('applyMix()')
    expect(send.indexOf('applyMix()')).toBeGreaterThan(-1)
    expect(send.indexOf('applyMix()')).toBeLessThan(send.indexOf("api('/api/slot-action'"))
  })

  it('ramps rather than stepping, because a step on a live source pops', () => {
    expect(SCRIPT).toContain('MUTE_RAMP = 0.015')
    expect(SCRIPT).toContain('linearRampToValueAtTime(level, now + MUTE_RAMP)')
    expect(SCRIPT).not.toContain('.gain.value = ')
  })

  it('lets a mute win over a fade that is already running', () => {
    expect(SCRIPT).toContain('v.gain.gain.cancelScheduledValues(now)')
  })

  it('leaves a muted stem sounding silently, so unmuting is free', () => {
    // It is not stopped and its buffer is not dropped, so unmuting is
    // another 15ms ramp and it comes back IN PHASE, because it never left
    // the clock.
    const mix = (/function applyMix\(\)[\s\S]{0,300}/.exec(SCRIPT) ?? [''])[0]
    expect(mix).not.toContain('killVoice')
    expect(mix).not.toContain('delete buffers')
  })

  it('lands a mute made on the mac too, by the same one line', () => {
    const renders = SCRIPT.match(/applyMix\(\)/g) ?? []
    // The declaration, the tap, and the poll. Nothing else moves the mix.
    expect(renders).toHaveLength(3)
  })

  it('does not re-assert a level nothing asked to change', () => {
    // The poll runs every 700ms and a handover's fade can be scheduled
    // seconds ahead of its boundary. Writing the same level again would
    // cancel that curve four times before it ever ran.
    expect(SCRIPT).toContain('if (voices[slotId].level !== want) setLevel(voices[slotId], want)')
  })

  it('still says muted by taking the colour away, never by dimming', () => {
    expect(SCRIPT).toContain(
      "(slot.muted || dead) ? '#6a6a6a' : (TYPE_COLORS[slot.soundType] || '#6a6a6a')"
    )
    expect(REMOTE_PAGE_HTML).not.toContain('opacity')
  })
})

describe('remotePage swap grid', () => {
  it('offers own loop, loop end and three bar counts, and nothing else', () => {
    // "instead of it playing only at the end of the loop, could we set it
    // to update every 4 bars, 8 bars, etc? a switch and setting to do that?
    // so it's seamless but can update a bit sooner" -- Elling, 2026-09-27,
    // after hearing the end-of-loop handover. own loop is the fifth, and
    // the one per-stem replacement made possible at all.
    expect(SCRIPT).toContain("{ g: -1, l: 'own loop' }")
    expect(SCRIPT).toContain("{ g: 0, l: 'loop end' }")
    expect(SCRIPT).toContain("{ g: 8, l: '8 bars' }")
    expect(SCRIPT).toContain("{ g: 4, l: '4 bars' }")
    expect(SCRIPT).toContain("{ g: 2, l: '2 bars' }")
    const options = SCRIPT.match(/\{ g: -?\d+, l: '/g) ?? []
    expect(options).toHaveLength(5)
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
      "api('/api/arc'",
      "api('/api/fold'",
      "api('/api/keep'",
      "api('/api/remove-slot'",
      "api('/api/roll'",
      "api('/api/slot-action'",
      "api('/api/slot-action'",
      "api('/api/turn'"
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
    expect(SCRIPT).toContain('var dur = loopDur()')
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

  it('takes the bar count off the poll and the seconds off the buffers', () => {
    // There is no single audible buffer to hang a bar count on any more --
    // there are N of them, and the longest spans the loop by definition.
    // So the bars come from the mac's own loopBars and the seconds from
    // loopDur(), and the two are never two copies of one fact.
    expect(SCRIPT).toContain('var loopBars = 0')
    expect(SCRIPT).toContain('loopBars = state.loopBars > 0 ? state.loopBars : 0')
    expect(SCRIPT).not.toContain('loadedLoopBars')
  })

  it('leaves a handover that is already scheduled on the boundary it was given', () => {
    // Both of its ends are committed on the audio clock, and moving a stop
    // that may be inside the render quantum has no honest answer -- the same
    // reason takeLoop drops a buffer whose boundary has moved. Tapping a
    // chip therefore schedules nothing, cancels nothing and makes no sound.
    const handler = (/swapGrid = option\.g[\s\S]{0,200}/.exec(SCRIPT) ?? [''])[0]
    expect(handler).not.toContain('cancelPending')
    expect(handler).not.toContain('scheduleReplace')
    expect(handler).not.toContain('reconcile')
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

describe('remotePage per-stem handover', () => {
  it('lands a changed stem on a boundary, against the one shared instant', () => {
    expect(SCRIPT).toContain('var at = origin + Math.ceil((now - origin) / period) * period')
    expect(SCRIPT).toContain('if (at - now < SWAP_LEAD) at = at + period')
    expect(SCRIPT).toContain('SWAP_LEAD = 0.08')
    expect(SCRIPT).toContain('v.src.stop(at + fade)')
  })

  it('moves ONE row, and leaves the other eleven sounding', () => {
    // The whole reason for per-stem. scheduleReplace is keyed by slotId and
    // touches nothing else.
    expect(SCRIPT).toContain('function scheduleReplace(slotId, stemId, buf)')
    expect(SCRIPT).toContain('function commitReplace(slotId, at)')
    expect(SCRIPT).not.toContain('function commitSwap(')
  })

  it('never leaves a scheduled replacement behind it', () => {
    expect(SCRIPT).toContain('function cancelPending(slotId)')
    expect(SCRIPT).toContain('if (p.at !== at) return')
    expect(SCRIPT).toContain('old.src.onended = null')
    // A vanished row and a stopped transport are the two ways a scheduled
    // replacement can be orphaned, and both go through the one function.
    const cancels = SCRIPT.match(/cancelPending\(/g) ?? []
    expect(cancels.length).toBeGreaterThanOrEqual(4)
  })

  it('offers a handover only once per boundary per row', () => {
    expect(SCRIPT).toContain('if (pending[slotId] && pending[slotId].stemId === want) continue')
  })

  it('gives own loop the stem its own cycle, and everything else the grid', () => {
    expect(SCRIPT).toContain('function periodFor(v)')
    expect(SCRIPT).toContain('if (swapGrid === -1) return v.dur > 0 ? v.dur : loopDur()')
  })

  it('starts a fresh phrase when there is nothing left to be in phase with', () => {
    // Not in the plan, and needed: with every voice gone, loopDur() is 0,
    // so swapPeriod() is 0 and a row joining on a boundary would wait for a
    // boundary that can never come. Nothing is sounding, so there is
    // nothing to interrupt.
    expect(SCRIPT).toContain('if (!sounding) { haveOrigin = false; lineEl.hidden = true }')
  })

  it('still starts on loop end and still keeps the setting on the phone', () => {
    expect(SCRIPT).toContain('var swapGrid = 0')
    expect(SCRIPT).toContain("SWAP_GRID_KEY = 'sssketch-remote-swap-grid'")
    const posts = SCRIPT.match(/api\('\/api\/[a-z-]+'/g) ?? []
    expect(posts).not.toContain("api('/api/swap-grid'")
  })
})

describe('remotePage row gestures', () => {
  it('opens the menu on a plain tap, because nothing else wants one', () => {
    // The menu was a 450ms press for as long as a tap meant mute. s and m
    // took that job, so the cheapest gesture on the page is free and the
    // menu takes it.
    expect(SCRIPT).toContain("row.addEventListener('click', function (e) {")
    expect(SCRIPT).toContain('openActionSheet(slot)')
  })

  it('has one listener on a row, and it is that tap', () => {
    // A click rather than a pointerup: the browser already knows a tap
    // from the start of a scroll, and letting it decide is the whole
    // saving.
    const listeners = SCRIPT.match(/row\.addEventListener\('[a-z]+'/g) ?? []
    expect(listeners).toEqual(["row.addEventListener('click'"])
  })

  it('has no long press left in it -- deleted, not left dormant', () => {
    // The 450ms timer, the 10px slop threshold, the fired/moved
    // arbitration and the pointermove/leave/cancel handling existed only
    // to tell two gestures on one element apart. There is one gesture now,
    // so all of it is gone rather than unused: dormant machinery is what
    // the next person has to read and decide about.
    for (const ghost of [
      'HOLD_MS',
      'holdTimer',
      'holdFired',
      'holdMoved',
      'holdX',
      'cancelHold',
      'nextSlotAction'
    ]) {
      expect(SCRIPT).not.toContain(ghost)
    }
  })

  it('has no hold left anywhere on the page, keep included', () => {
    // Keep was the last one and it is a tap now (2026-09-27: "doesnt need
    // to be a touch and hold necessarily.. it an be just a click"), after
    // it was reported not working at all on his iPhone.
    //
    // This asserts the machinery is gone rather than merely unreached,
    // because the reason it went is a trap worth not walking back into: a
    // hold must give up when the browser claims the gesture, so it listens
    // for pointercancel -- and iOS fires pointercancel when it decides a
    // touch might become a scroll. The page became scrollable the same day
    // the stack went top-aligned and the rows grew to two lines. A thumb
    // resting on a button for most of a second, on a scrollable page, is
    // the shape iOS reads as the start of a pan.
    for (const ghost of ['KEEP_MS', 'SLOP_PX', 'keepTimer', 'cancelKeep', 'keep-fill']) {
      expect(SCRIPT).not.toContain(ghost)
    }
    expect(REMOTE_PAGE_HTML).not.toContain('keep-fill')
    // One listener, and it is a click.
    const listeners = SCRIPT.match(/keepEl\.addEventListener\('[a-z]+'/g) ?? []
    expect(listeners).toEqual(["keepEl.addEventListener('click'"])
  })

  it('leaves the row\u2019s own buttons out of the tap', () => {
    // s, m and x are inside the row, so their click passes through the row
    // on its way up. Each is its own gesture and none is a request for the
    // menu.
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

describe('remotePage s and m', () => {
  it('gives every row its own two buttons, in the shorthand every daw uses', () => {
    // "buttosn for s and m instead! simplidy" -- Elling, on the phone,
    // 2026-09-27, after a session with the tap cycle. Neither verb is new:
    // both have been on the wire since a596b39 and on the desktop row since
    // 2026-09-15. Only the way to reach them changed.
    expect(SCRIPT).toContain("soloKey.textContent = 's'")
    expect(SCRIPT).toContain("muteKey.textContent = 'm'")
    expect(SCRIPT).toContain("sendSlotAction(slot, 'solo')")
    expect(SCRIPT).toContain("sendSlotAction(slot, 'mute')")
  })

  it('draws an engaged toggle as an inversion, the only word this page has for on', () => {
    // .drop.armed and both sets of chips are the same white block. A second
    // vocabulary for "engaged" would be a second thing to learn, and there
    // is nothing else available: nothing here fades and no colour is spent
    // on chrome.
    expect(REMOTE_PAGE_HTML).toContain(
      'button.key.on { background: #ededed; border-color: #ededed; color: #050505; }'
    )
    expect(SCRIPT).toContain("rec.solo.className = slot.soloed ? 'key solo on' : 'key solo'")
    expect(SCRIPT).toContain("rec.mute.className = slot.muted ? 'key mute on' : 'key mute'")
    expect(REMOTE_PAGE_HTML).not.toContain('opacity')
  })

  it('holds both letters to the tap target everything else on the page is held to', () => {
    // Three small targets in a row is exactly where a thumb mis-taps, and
    // one of them removes a stem. 42px each, and a 10px gutter between them
    // from the row's own column-gap.
    expect(REMOTE_PAGE_HTML).toContain('button.key {\n  width: 42px;\n  height: 42px;')
    expect(REMOTE_PAGE_HTML).toContain('column-gap: 10px')
  })

  it('offers neither until the stem has resolved', () => {
    // The desktop row's own hasStemToActOn guard. Dimmed to the page's
    // faintest ink rather than faded, because nothing here fades.
    expect(SCRIPT).toContain('soloKey.disabled = !slot.stemName')
    expect(SCRIPT).toContain('muteKey.disabled = !slot.stemName')
    expect(REMOTE_PAGE_HTML).toContain('button.key:disabled { color: #3a3a3a; }')
  })

  it('paints a mute onto one row rather than rebuilding the list', () => {
    // d7ff531 took armedRemoveId out of the repaint key because arming one
    // button rebuilt every row and threw the scroll. A mute is the same
    // kind of change and gets the same treatment -- and the key is brought
    // forward with the paint, so the poll that agrees with it 700ms later
    // is not a rebuild either.
    expect(SCRIPT).toContain('function paintRowMix(slot)')
    expect(SCRIPT).toContain('function paintMix()')
    expect(SCRIPT).toContain('lastRowsKey = rowsKey(lastSlots)')
    // Still exactly one wipe of the row list, and it is renderRows'.
    const wipes = SCRIPT.match(/rowsEl\.innerHTML = ''/g) ?? []
    expect(wipes).toHaveLength(1)
    // And the mute path does not go near renderRows.
    const send = (/function sendSlotAction\(slot, next\)[\s\S]{0,400}?\n {2}\}/.exec(SCRIPT) ?? [
      ''
    ])[0]
    expect(send).not.toContain('renderRows')
  })

  it('reads soloed off the mix rather than remembering it', () => {
    // remoteStateFromSlots computes it from the same fact -- one row left
    // in the mix -- so an optimistic paint and the poll that replaces it
    // can only ever agree.
    expect(SCRIPT).toContain('function recomputeSoloed()')
    expect(SCRIPT).toContain('var alone = audibleRowCount() === 1')
    expect(SCRIPT).toContain('lastSlots[i].soloed = !lastSlots[i].muted && alone')
  })

  it('paints a solo as every other row losing its colour, and nothing more', () => {
    // A solo IS the other rows dropping out, so the ROW needs no affordance
    // of its own: they go grey by the mute treatment that already exists,
    // and the one row still in colour is the picture. The s button lights
    // because a toggle has to say whether it is engaged; the row takes no
    // mark.
    expect(SCRIPT).toContain('lastSlots[i].muted = lastSlots[i].id !== slot.id')
    expect(REMOTE_PAGE_HTML).not.toContain('.row.soloed')
    // The one place a row's colour is decided, unchanged by solo.
    expect(SCRIPT).toContain(
      "(slot.muted || dead) ? '#6a6a6a' : (TYPE_COLORS[slot.soundType] || '#6a6a6a')"
    )
  })

  it('puts the whole mix back on a second press of a solo that is already alone', () => {
    // toggleSlotSolo's own behaviour, drawn rather than waited for: it is
    // the one gesture that restores every row at once, and the one that
    // most needs to be believed.
    expect(SCRIPT).toContain('if (slot.soloed) lastSlots[i].muted = !lastSlots[i].stemName')
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
    // No mute, no solo, no menu, no re-arming the remove. A row you have
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
    expect(SCRIPT).toContain('var key = rowsKey(lastSlots)')
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

describe('remotePage stem budget and failures', () => {
  it('budgets decoded bytes, not a stem count', () => {
    // Twenty 8-second stems are cheaper than eight 32-second ones, and
    // PHONE_LOOP_MAX_BARS is 32. A count would be the wrong shape.
    //
    // 160 MiB, not the spec's 96: 96 was a MONO figure and the mac serves
    // stereo, so it would evict at eleven stems. The budget is set above
    // twenty stereo 16-second stems on purpose -- evicting one he is
    // listening to is a worse failure than a fatter tab, because it is
    // silent and reads as the mix being wrong.
    expect(SCRIPT).toContain('STEM_BUDGET_BYTES = 160 * 1024 * 1024')
    expect(SCRIPT).toContain('buf.length * buf.numberOfChannels * 4')
    expect(SCRIPT).not.toMatch(/MAX_STEMS?\s*=\s*\d+/)
  })

  it('evicts only what nothing is asking for', () => {
    expect(SCRIPT).toContain('if (wanted[id]) continue')
  })

  it('gives up on a stem after three tries rather than downloading forever', () => {
    // The poll runs every 700ms. An uncounted retry is an infinite
    // download, which is why this is NOT the analysis caches' evict-on-
    // rejection rule.
    expect(SCRIPT).toContain('MAX_STEM_TRIES = 3')
    expect(SCRIPT).toContain('if (failedIds[id] >= MAX_STEM_TRIES) continue')
  })

  it('says a stem is missing rather than hiding an incomplete mix', () => {
    expect(SCRIPT).toContain("' stem missing'")
    expect(SCRIPT).toContain("' stems missing'")
    expect(SCRIPT).toContain("'too many stems'")
  })

  it('does not rewrite the status line on every poll', () => {
    // It runs every 700ms and would eat the flash under the thumb.
    expect(SCRIPT).toContain('if (was !== overBudget) restStatus()')
  })

  it('draws a stem that never arrived the way it draws a muted one', () => {
    // There is no spare colour on this page and nothing on it may fade.
    expect(SCRIPT).toContain('(slot.muted || dead)')
    expect(REMOTE_PAGE_HTML).not.toContain('opacity')
  })

  it('holds the picture per row, not per page', () => {
    expect(SCRIPT).toContain('function mergePolledSlots(')
    expect(SCRIPT).not.toContain('function holdingForSwap(')
    // A mute he just made is still shown at once, even on a held row.
    expect(SCRIPT).toContain('drawn.muted = s.muted')
  })

  it('holds a row only while its own sound is genuinely on its way', () => {
    // Nothing is sounding means nothing to run ahead of -- without this a
    // row rolled with the transport off would freeze forever. And a stem
    // that has given up is not coming, which is the judgement the
    // whole-page hold made too.
    expect(SCRIPT).toContain('if (!wantPlaying || !haveOrigin) return polled')
    expect(SCRIPT).toContain('var coming = !(failedIds[want] >= MAX_STEM_TRIES)')
  })

  it('moves a held row at the boundary, not up to a poll after it', () => {
    expect(SCRIPT).toContain('lastSlots = mergePolledSlots(polledSlots)')
    expect(SCRIPT).toContain('lastSlots = mergePolledSlots(state.slots)')
  })
})

describe('remotePage crossfade', () => {
  it('offers cut, short and long, and nothing else', () => {
    expect(SCRIPT).toContain("{ x: 0, l: 'cut' }")
    expect(SCRIPT).toContain("{ x: 0.125, l: 'short' }")
    expect(SCRIPT).toContain("{ x: 0.5, l: 'long' }")
    const options = SCRIPT.match(/\{ x: [\d.]+, l: '/g) ?? []
    expect(options).toHaveLength(3)
  })

  it('measures the fade in bars, so it means the same at any tempo', () => {
    expect(SCRIPT).toContain('return xfade * (dur / bars)')
    expect(SCRIPT).not.toContain('bpm')
  })

  it('is equal power, because a linear crossfade of two stems dips', () => {
    expect(SCRIPT).toContain('FADE_IN[fi] = Math.sqrt(ft)')
    expect(SCRIPT).toContain('FADE_OUT[fi] = Math.sqrt(1 - ft)')
    expect(SCRIPT).toContain('setValueCurveAtTime')
  })

  it('never lets cut mean a hard step, which pops', () => {
    expect(SCRIPT).toContain('if (xfade === 0) return 0.005')
  })

  it('keeps the old source alive until the fade is over', () => {
    expect(SCRIPT).toContain('v.src.stop(at + fade)')
  })

  it('keeps every other automation event out of the curve window', () => {
    // setValueCurveAtTime throws if another event falls inside its own
    // window, and the curve starts at exactly the boundary -- so a new
    // voice's baseline gain is set at currentTime, not at the boundary.
    expect(SCRIPT).toContain('g.gain.setValueAtTime(level, audioCtx.currentTime)')
  })

  it('does not slow a mute down with it', () => {
    const mix = (/function setLevel\(v, level\)[\s\S]{0,400}/.exec(SCRIPT) ?? [''])[0]
    expect(mix).toContain('MUTE_RAMP')
    expect(mix).not.toContain('xfadeSec')
  })

  it('keeps the setting on the phone, with no route and no mac involved', () => {
    expect(SCRIPT).toContain("XFADE_KEY = 'sssketch-remote-xfade'")
    expect(SCRIPT).toContain('localStorage.getItem(XFADE_KEY)')
    expect(SCRIPT).toContain('localStorage.setItem(XFADE_KEY, String(option.x))')
    const posts = SCRIPT.match(/api\('\/api\/[a-z-]+'/g) ?? []
    expect(posts).not.toContain("api('/api/xfade'")
  })

  it('never lets storage being off take the page down with it', () => {
    const reads = SCRIPT.match(/localStorage\.(get|set)Item/g) ?? []
    const guards = SCRIPT.match(/try \{[^}]*localStorage/g) ?? []
    expect(guards).toHaveLength(reads.length)
  })

  it('starts on cut, so nobody’s phone changes until they touch a chip', () => {
    expect(SCRIPT).toContain('var xfade = 0')
  })

  it('sits directly under the swap grid, in the same idiom', () => {
    const loopBlock = (/<div id="loop" hidden>[\s\S]*?<\/div>\s*<div class="eyebrow foot"/.exec(
      REMOTE_PAGE_HTML
    ) ?? [''])[0]
    expect(loopBlock).toContain('id="chips-xfade"')
    expect(loopBlock.indexOf('id="chips-grid"')).toBeLessThan(loopBlock.indexOf('id="chips-xfade"'))
    expect(REMOTE_PAGE_HTML).toContain('and take')
    expect(REMOTE_PAGE_HTML).toContain('.chips.grid button.chip { flex: 1 1 0; min-width: 0; }')
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

describe('remotePage keep', () => {
  it('is a tap, and posts on that tap', () => {
    // Was a 700ms hold until 2026-09-27, when it was reported not working
    // at all on his iPhone and he said a click would do. The hold, its
    // fill sweep and the difference blend that inverted the label under
    // it are all gone; "has no hold left anywhere on the page" above is
    // the assertion that they stayed gone.
    // The body carries the tap's own keep id since 2026-10-01 (artist mode
    // review), so the Mac's answer can be matched to this tap.
    expect(SCRIPT).toContain("api('/api/keep', { keepId: id })")
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
    // -- Elling, 2026-09-27. Keep is a 700ms press, and it outlived the
    // row's own: neither may raise ios's selection handles over the page,
    // and a thumb resting anywhere still must not.
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

describe('remotePage rows about to change', () => {
  // Direct report, 2026-09-29, listening on radio: "i don't see any
  // preparatory blinking on the channels about to transition... it seems
  // to make sense to have that in the ui". The phone is a per-stem mixer
  // now and the same fact is worth the same there.
  it('marks the row radio is about to change with a fade, not a blink', () => {
    // It was a 2px rule along the bottom of the row for one day.
    // Elling, on the mac's own copy of it: "can't it be the red playhead
    // indicator instead of a progress bar? that would streamline the ui"
    // -- and this page has had a playhead sweeping every row since
    // 2026-09-26, so the rule was drawing a second time something already
    // on screen.
    expect(REMOTE_PAGE_HTML).not.toContain('.ahead {')
    expect(SCRIPT).toContain('function paintAhead(')
  })

  it('breathes slowly enough that it can never read as a flash', () => {
    // The page's standing rule is that the playhead is the only motion
    // here. This is the one exception, and the reason it is allowed is
    // the reason a blink was not: at 2600ms it is far slower than a bar
    // at any tempo radio runs at, so it carries no count and cannot be
    // mistaken for the playhead's own rhythm. Two keyframes and no more.
    expect(REMOTE_PAGE_HTML.match(/@keyframes/g)).toHaveLength(2)
    for (const duration of SCRIPT.match(/(\d+)ms ease-in-out infinite/g) ?? []) {
      expect(Number.parseInt(duration, 10)).toBeGreaterThanOrEqual(2000)
    }
    expect(SCRIPT).not.toContain('step-end')
  })

  it('tells armed from held by luminance alone, because chrome gets no colour', () => {
    // Two steps of the page's own grey ladder, and the same pair the mac
    // uses (--ra-bg-row-active and --ra-border). #0a0a0a is the row's own
    // ground; neither peak is the #ededed that button.lit alone is
    // allowed.
    expect(REMOTE_PAGE_HTML).toContain(
      '@keyframes ahead { 0%, 100% { background: #0a0a0a; } 50% { background: #161616; } }'
    )
    expect(REMOTE_PAGE_HTML).toContain(
      '@keyframes ahead-now { 0%, 100% { background: #161616; } 50% { background: #222222; } }'
    )
    expect(SCRIPT).toContain("'ahead-now 2600ms ease-in-out infinite'")
  })

  it('leaves the row class alone, so the one painter that owns it still does', () => {
    // paintGoingRow is the only thing on this page allowed to write a
    // row's className -- that is how a rebuild under a pending removal
    // comes up already marked. This writes the row's animation style
    // instead, so the two can never overwrite one another.
    expect(SCRIPT).toContain('row.style.animation =')
    expect(SCRIPT.match(/\brow\.className = /g) ?? []).toHaveLength(1)
  })

  it('paints it onto the drawn rows instead of rebuilding them', () => {
    // The whole reason it is not a field on a slot view: renderRows
    // rebuilds the stack whenever the slot list changes, and wiping rowsEl
    // under a thumb is the scroll jump d7ff531 fixed. A change that lands
    // every few bars must not reintroduce it.
    expect(SCRIPT).toContain('paintAllAhead()')
    expect(SCRIPT).toContain('radioAhead = state.radio')
  })

  it('breathes every held row, so a row waiting for the loop top says why a tap did nothing', () => {
    // 2026-09-29: while radio runs, a manual change waits for the loop top
    // and a second tap on that row is ignored. The mac sends every waiting
    // row as held, radio's own among them.
    expect(SCRIPT).toContain('radioAhead.heldSlotIds')
  })
})

/** Discover artist mode (2026-10-01). The keep used to flash "kept" the
 * moment it was tapped, whether or not anything was kept. */
describe('remotePage keep', () => {
  const SCRIPT_TEXT = REMOTE_PAGE_HTML.slice(REMOTE_PAGE_HTML.indexOf('<script>'))
  const handler = SCRIPT_TEXT.slice(
    SCRIPT_TEXT.indexOf("keepEl.addEventListener('click'"),
    SCRIPT_TEXT.indexOf('function poll()')
  )

  it('does not claim "kept" when the tap is sent', () => {
    expect(handler).toContain("api('/api/keep'")
    expect(handler).not.toContain("flash('kept')")
  })

  it('says "kept" only for its OWN keep id, never by watching the kept counter', () => {
    expect(handler).toContain("api('/api/keep', { keepId: ")
    expect(SCRIPT_TEXT).not.toContain('keepPendingFrom')
    expect(SCRIPT_TEXT).toMatch(/k\.id === keepPending\.id/)
  })

  it('names all four outcomes, and gives up after a wait', () => {
    for (const outcome of ["'kept'", "'already'", "'refused'", "'none'"]) {
      expect(SCRIPT_TEXT).toContain(outcome)
    }
    expect(SCRIPT_TEXT).toMatch(
      /Date\.now\(\) > keepPending\.until[\s\S]{0,120}flash\('not kept'\)/
    )
  })

  it('reads a refused keep as listening only, and disables keep in that mode', () => {
    expect(handler).toContain('409')
    expect(handler).toContain("flash('listening only')")
    expect(SCRIPT_TEXT).toContain('state.listenOnly === true')
    expect(SCRIPT_TEXT).toContain('keepEl.disabled = listenOnly')
  })
})

describe('remotePage turn', () => {
  it('offers turn and every move as a chip, labelled as the desktop labels them', () => {
    expect(REMOTE_PAGE_HTML).toContain('<button class="big" id="turn">turn</button>')
    for (const move of TURNAROUND_MOVES) {
      expect(REMOTE_PAGE_HTML).toContain(
        JSON.stringify({ m: move, l: TURNAROUND_MOVE_LABEL[move] })
      )
    }
  })

  it('posts to the turn route, with a move only for a chip', () => {
    expect(REMOTE_PAGE_HTML).toContain("api('/api/turn', move === null ? {} : { move: move })")
  })

  it("flashes the mac's own answer", () => {
    expect(REMOTE_PAGE_HTML).toContain('flash(body && body.answer ? body.answer : ')
  })

  it('shows the turn only while radio runs on the mac, and says when one waits', () => {
    expect(REMOTE_PAGE_HTML).toContain('<div class="swapgrid" id="turn-box" hidden>')
    expect(REMOTE_PAGE_HTML).toContain('turnBoxEl.hidden = !turn')
    expect(REMOTE_PAGE_HTML).toContain("turn.waiting ? 'turning' : 'turn'")
    expect(REMOTE_PAGE_HTML).toContain('paintTurn(state.turn)')
  })
})

describe('the fold switch', () => {
  it('sits in the loop block under the handover chips, hidden until radio runs', () => {
    const loopBlock = (/<div id="loop" hidden>[\s\S]*?<\/div>\s*<div class="eyebrow foot"/.exec(
      REMOTE_PAGE_HTML
    ) ?? [''])[0]
    expect(loopBlock).toContain('<div class="swapgrid" id="fold-row" hidden>')
    expect(loopBlock.indexOf('id="chips-xfade"')).toBeLessThan(loopBlock.indexOf('id="chips-fold"'))
  })

  it('paints from the state, a boolean or nothing, and posts only a change', () => {
    expect(REMOTE_PAGE_HTML).toContain(
      "foldState = typeof state.fold === 'boolean' ? state.fold : null"
    )
    expect(REMOTE_PAGE_HTML).toContain("api('/api/fold', { on: on })")
    expect(REMOTE_PAGE_HTML).toContain('if (foldState === null || foldState === on) return')
  })
})

describe('remotePage build and drop', () => {
  /** paintArc as the page runs it, against two fake buttons and a fake box. */
  function paintWith(arc: unknown): {
    box: { hidden: boolean }
    build: { textContent: string; className: string }
    drop: { textContent: string; className: string }
  } {
    const src = /function paintArc\(arc\) \{[\s\S]*?\n {2}\}/.exec(REMOTE_PAGE_HTML)
    expect(src).not.toBeNull()
    const box = { hidden: true }
    const build = { textContent: 'build', className: 'big' }
    const drop = { textContent: 'drop', className: 'big' }
    const paint = new Function(
      'arcBoxEl',
      'arcBuildEl',
      'arcDropEl',
      `${src![0]}; return paintArc`
    )(box, build, drop) as (a: unknown) => void
    paint(arc)
    return { box, build, drop }
  }

  it('sits under the turn, hidden until the mac sends an arc', () => {
    expect(REMOTE_PAGE_HTML).toContain('<div class="swapgrid" id="arc-box" hidden>')
    expect(REMOTE_PAGE_HTML).toContain('<button class="big" id="arc-build">build</button>')
    expect(REMOTE_PAGE_HTML).toContain('<button class="big" id="arc-drop">drop</button>')
    expect(REMOTE_PAGE_HTML.indexOf('id="turn-box"')).toBeLessThan(
      REMOTE_PAGE_HTML.indexOf('id="arc-box"')
    )
    expect(REMOTE_PAGE_HTML).toContain('paintArc(state.arc)')
  })

  it('shows the buttons only while there is an arc, painted from waiting and can', () => {
    expect(paintWith(null).box.hidden).toBe(true)
    expect(paintWith(undefined).box.hidden).toBe(true)
    const idle = paintWith({ phase: 'build', waiting: null, canBuild: true, canDrop: false })
    expect(idle.box.hidden).toBe(false)
    expect(idle.build).toEqual({ textContent: 'build', className: 'big' })
    expect(idle.drop).toEqual({ textContent: 'drop', className: 'big dim' })
    const waiting = paintWith({
      phase: 'breakdown',
      waiting: 'drop',
      canBuild: true,
      canDrop: true
    })
    expect(waiting.drop).toEqual({ textContent: RADIO_DROPPING_WORD, className: 'big on' })
    const building = paintWith({ phase: 'build', waiting: 'build', canBuild: true, canDrop: true })
    expect(building.build).toEqual({ textContent: RADIO_BUILDING_WORD, className: 'big on' })
  })

  it("posts the action to the arc route and flashes the mac's answer", () => {
    expect(SCRIPT).toContain("api('/api/arc', { action: action })")
    expect(SCRIPT).toContain(
      "arcBuildEl.addEventListener('click', function () { sendArc('build') })"
    )
    expect(SCRIPT).toContain("arcDropEl.addEventListener('click', function () { sendArc('drop') })")
  })

  it('fits its words at 320 px', () => {
    // Silkscreen is a wide pixel face; one em per character is a generous upper bound on its
    // advance. 320 px less the body's 16 px gutters each side.
    const content = 320 - 2 * 16
    const px = (rule: RegExp): number => Number((rule.exec(REMOTE_PAGE_HTML) ?? ['', '0'])[1])
    const bigFont = px(/button\.big \{[^}]*?font-size: (\d+)px/)
    const bigPad = px(/button\.big \{[^}]*?padding: 0 (\d+)px/)
    const gap = px(/\.actions \{[^}]*?gap: (\d+)px/)
    const msgFont = px(/\.msg \{ font-size: (\d+)px/)
    expect(bigFont).toBeGreaterThan(0)
    expect(msgFont).toBeGreaterThan(0)
    // two buttons side by side, each its share of the row less its padding
    const perButton = (content - gap) / 2 - 2 * bigPad
    for (const word of ['build', 'drop', RADIO_BUILDING_WORD, RADIO_DROPPING_WORD]) {
      expect(word.length * bigFont).toBeLessThanOrEqual(perButton)
    }
    // the press's answer, flashed on the status line
    const answers: RemoteArcAnswer[] = [
      'building',
      'dropping',
      'not now',
      'radio off',
      'density not intensity'
    ]
    for (const answer of answers) expect(answer.length * msgFont).toBeLessThanOrEqual(content)
    // a resting row's words, after its stem name
    expect(RADIO_ARC_REST_SHORT.length * 13).toBeLessThanOrEqual(content / 4)
  })
})
