// src/renderer/src/components/RadioGuide.tsx
//
// The radio's `?` guide (RadioTopLine's `?`): how radio works, for a casual listener, drawn from
// @shared/radioGuide, the one copy both radios read (ell.ing/radio's src/ui/guide.ts draws the same
// data). A scrollable overlay in the app's modal shape (KeyGesturesModal's fixed backdrop and card),
// portalled to <body> at the full-screen popover tier, since Discover sits inside the Library
// Browser's full-screen view. Escape, the close button and a click on the backdrop close it.
//
// It never touches radio: it reads only the static guide, holds no radio state, and is opened by
// RadioTopLine's own state, so opening it re-renders the top line and nothing else (no row
// remounts). While it is open, keys stay in it: the app's shortcuts (space for play) never see them.
//
// The diagrams are small static SVGs. Colour only on audio information: a lane's bars are its kind
// of sound, in its type colour (typeColorVar); an ink lane (the intensity wave, not a sound),
// lines, ramps and the pace scale are ink.
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  radioGuideFor,
  type RadioGuideBars,
  type RadioGuideBlock,
  type RadioGuideItem,
  type RadioGuideScale
} from '@shared/radioGuide'
import { typeColorVar } from '../theme/typeColor'

const GUIDE = radioGuideFor('desktop')
const TITLE_ID = 'radio-guide-title'

/** A position 0..1 as a word's place. A segment's word (`start`) begins where its segment does; a
 * point's word is centred on it. Either is pinned to its end near the right edge and (a point's) to
 * its start near the left, so no word runs off the figure. */
function labelPlace(at: number, start = false): React.CSSProperties {
  const shift = at > 0.86 ? '-100%' : start || at < 0.12 ? '0' : '-50%'
  return { position: 'absolute', left: `${at * 100}%`, transform: `translateX(${shift})` }
}

function GuideBars({
  figure,
  laneHeight = 22,
  labels = true
}: {
  figure: RadioGuideBars
  laneHeight?: number
  labels?: boolean
}): React.JSX.Element {
  const n = figure.lanes[0]?.cells.length ?? 0
  const mid = laneHeight / 2
  return (
    <div role="img" aria-label={figure.alt} style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {figure.lanes.map((lane, li) => {
          // a sound's lane in its type colour; an ink lane (not a sound) in ink
          const fill = lane.kind === 'ink' ? 'var(--ra-text-2)' : typeColorVar(lane.kind)
          return (
            <div key={li} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {lane.label !== undefined && labels && (
                <span style={{ fontSize: 'var(--ra-fs-9)', color: 'var(--ra-text-3)' }}>
                  {lane.label}
                </span>
              )}
              <svg
                aria-hidden
                width="100%"
                height={laneHeight}
                viewBox={`0 0 ${n} ${laneHeight}`}
                preserveAspectRatio="none"
                style={{ display: 'block' }}
              >
                {lane.cells.map((c, i) => {
                  const h = c.v * (laneHeight - 2)
                  const y = c.half === 'bottom' ? mid : mid - h / 2
                  const height = c.half === undefined ? h : h / 2
                  return (
                    <g key={i} fill={fill}>
                      {c.blur === true && (
                        <rect
                          x={i - 0.3}
                          y={mid - Math.min(mid, h * 0.65)}
                          width={1.6}
                          height={Math.min(laneHeight, h * 1.3)}
                          opacity={0.22 * c.a}
                        />
                      )}
                      <rect x={i + 0.15} y={y} width={0.7} height={height} opacity={c.a} />
                    </g>
                  )
                })}
              </svg>
            </div>
          )
        })}
        {/* Lines and the riser over every lane, in ink. */}
        <svg
          aria-hidden
          viewBox="0 0 1000 100"
          preserveAspectRatio="none"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
        >
          {(figure.lines ?? []).map((l, i) => (
            <line
              key={i}
              x1={l.at * 1000}
              x2={l.at * 1000}
              y1={0}
              y2={100}
              stroke={l.strong === true ? 'var(--ra-text-2)' : 'var(--ra-border-strong)'}
              strokeWidth={1}
              strokeDasharray={l.strong === true ? undefined : '2 3'}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {figure.ramp !== undefined && (
            <g>
              <polygon
                points={`${figure.ramp.from * 1000},100 ${figure.ramp.to * 1000},62 ${figure.ramp.to * 1000},100`}
                fill="var(--ra-text)"
                opacity={0.14}
              />
              <line
                x1={figure.ramp.from * 1000}
                y1={100}
                x2={figure.ramp.to * 1000}
                y2={62}
                stroke="var(--ra-text)"
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
              />
            </g>
          )}
        </svg>
      </div>
      {labels && (figure.labels?.length ?? 0) > 0 && (
        <div
          aria-hidden
          style={{
            position: 'relative',
            height: figure.labels!.some((l) => l.row === 1) ? 30 : 16,
            marginTop: 4
          }}
        >
          {figure.labels!.map((l, i) => (
            <span
              key={i}
              style={{
                ...labelPlace(l.at, true),
                top: l.row === 1 ? 14 : 0,
                whiteSpace: 'nowrap',
                fontSize: 'var(--ra-fs-9)',
                color: 'var(--ra-text-3)'
              }}
            >
              {l.text}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function GuideScale({ figure }: { figure: RadioGuideScale }): React.JSX.Element {
  const n = figure.values.length
  const H = 30
  const row = (
    items: readonly { at: number; text: string }[],
    color: string
  ): React.JSX.Element => (
    <div aria-hidden style={{ position: 'relative', height: 14 }}>
      {items.map((w, i) => (
        <span
          key={i}
          style={{
            ...labelPlace(w.at / 100),
            whiteSpace: 'nowrap',
            fontSize: 'var(--ra-fs-9)',
            color
          }}
        >
          {w.text}
        </span>
      ))}
    </div>
  )
  return (
    <div
      role="img"
      aria-label={figure.alt}
      style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
    >
      {row(figure.words, 'var(--ra-text)')}
      <svg
        aria-hidden
        width="100%"
        height={H}
        viewBox={`0 0 ${n} ${H}`}
        preserveAspectRatio="none"
        style={{ display: 'block', borderBottom: '1px solid var(--ra-border-strong)' }}
      >
        {figure.values.map((v, i) => (
          <rect
            key={i}
            x={i + 0.2}
            y={H - v * H}
            width={0.6}
            height={v * H}
            fill="var(--ra-text-2)"
          />
        ))}
      </svg>
      {row(
        figure.ticks.map((t) => ({ at: t, text: String(t) })),
        'var(--ra-text-3)'
      )}
    </div>
  )
}

const figureBox: React.CSSProperties = {
  border: '1px solid var(--ra-border)',
  background: 'var(--ra-bg-row)',
  padding: 'var(--ra-s-5)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--ra-s-3)'
}

const bodyText: React.CSSProperties = {
  margin: 0,
  fontSize: 'var(--ra-fs-11)',
  lineHeight: 'var(--ra-lh-body)',
  color: 'var(--ra-text-2)'
}

function KeyRows({ items }: { items: readonly RadioGuideItem[] }): React.JSX.Element {
  return (
    <dl style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 'var(--ra-s-2)' }}>
      {items.map((i) => (
        <div
          key={i.key}
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(96px, 150px) 1fr',
            gap: 'var(--ra-s-5)',
            alignItems: 'baseline'
          }}
        >
          <dt style={{ fontSize: 'var(--ra-fs-10)', color: 'var(--ra-text)' }}>{i.key}</dt>
          <dd style={{ ...bodyText, fontSize: 'var(--ra-fs-10)' }}>{i.text}</dd>
        </div>
      ))}
    </dl>
  )
}

function Block({ block }: { block: RadioGuideBlock }): React.JSX.Element {
  switch (block.type) {
    case 'text':
      return <p style={bodyText}>{block.text}</p>
    case 'figure':
      return (
        <figure style={{ ...figureBox, margin: 0 }}>
          {block.figure.type === 'bars' ? (
            <GuideBars figure={block.figure} />
          ) : (
            <GuideScale figure={block.figure} />
          )}
          <figcaption style={{ fontSize: 'var(--ra-fs-9)', color: 'var(--ra-text-3)' }}>
            {block.caption}
          </figcaption>
        </figure>
      )
    case 'keys':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ra-s-2)' }}>
          {block.title !== undefined && <span className="ra-eyebrow">{block.title}</span>}
          <KeyRows items={block.items} />
        </div>
      )
    case 'cards':
      return (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
            gap: 'var(--ra-s-3)'
          }}
        >
          {block.items.map((i) => (
            <div key={i.key} style={{ ...figureBox, gap: 'var(--ra-s-2)' }}>
              {i.figure !== undefined && <GuideBars figure={i.figure} laneHeight={9} />}
              <span style={{ fontSize: 'var(--ra-fs-11)', color: 'var(--ra-text)' }}>{i.key}</span>
              <span style={{ ...bodyText, fontSize: 'var(--ra-fs-10)' }}>{i.text}</span>
            </div>
          ))}
        </div>
      )
  }
}

export function RadioGuide({
  onClose,
  returnFocusRef
}: {
  onClose: () => void
  /** Focused again when the guide closes (the `?` that opened it). */
  returnFocusRef?: React.RefObject<HTMLElement | null>
}): React.JSX.Element {
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)

  // Focus the close button on open, and the opener again on close.
  useEffect(() => {
    closeRef.current?.focus()
    const back = returnFocusRef?.current ?? null
    return () => back?.focus()
  }, [returnFocusRef])

  // Keys stay in the guide (capture phase, before the app's window shortcuts and the Library
  // Browser's own Escape): Escape closes it; Tab moves between the close button and the text;
  // every other key does only its default here (space scrolls the text or presses the button).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      e.stopPropagation()
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      const stops = [closeRef.current, bodyRef.current].filter(
        (x): x is HTMLButtonElement | HTMLDivElement => x !== null
      )
      if (stops.length === 0) return
      e.preventDefault()
      const at = stops.findIndex((x) => x === document.activeElement)
      const next = at === -1 ? 0 : (at + (e.shiftKey ? stops.length - 1 : 1)) % stops.length
      stops[next].focus()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onClose])

  return createPortal(
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--ra-backdrop)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        // Above the Library Browser's full-screen view, which Discover sits inside.
        zIndex: 'var(--ra-z-fullscreen-popover)'
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={TITLE_ID}
        style={{
          width: 'min(640px, 92vw)',
          maxHeight: '86vh',
          background: 'var(--ra-bg-bar)',
          border: '1px solid var(--ra-border)',
          borderRadius: 0,
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--ra-s-5)',
            padding: 'var(--ra-s-5) var(--ra-s-7)',
            borderBottom: '1px solid var(--ra-border)'
          }}
        >
          <h2
            id={TITLE_ID}
            style={{
              margin: 0,
              fontSize: 'var(--ra-fs-13)',
              fontWeight: 'var(--ra-fw-regular)',
              color: 'var(--ra-text)'
            }}
          >
            {GUIDE.title}
          </h2>
          <button
            ref={closeRef}
            onClick={onClose}
            data-tooltip="close · esc"
            style={{
              height: 'var(--ra-h-control)',
              borderRadius: 0,
              padding: '0 var(--ra-s-6)',
              fontSize: 'var(--ra-fs-11)',
              border: '1px solid var(--ra-border-strong)',
              background: 'var(--ra-bg-row-active)',
              color: 'var(--ra-text)',
              cursor: 'pointer'
            }}
          >
            close
          </button>
        </div>
        <div
          ref={bodyRef}
          tabIndex={0}
          aria-label="guide text"
          // the app's focus ring (global.css), on a scroll box reached by tab
          data-focus-ring
          style={{
            overflowY: 'auto',
            padding: 'var(--ra-s-7)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--ra-s-8)'
          }}
        >
          <p style={{ ...bodyText, color: 'var(--ra-text)' }}>{GUIDE.lede}</p>
          {GUIDE.sections.map((s) => (
            <section
              key={s.id}
              aria-labelledby={`radio-guide-${s.id}`}
              style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ra-s-5)' }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ra-s-1)' }}>
                <span className="ra-eyebrow">{s.eyebrow}</span>
                <h3
                  id={`radio-guide-${s.id}`}
                  style={{
                    margin: 0,
                    fontSize: 'var(--ra-fs-13)',
                    fontWeight: 'var(--ra-fw-regular)',
                    color: 'var(--ra-text)'
                  }}
                >
                  {s.heading}
                </h3>
              </div>
              {s.blocks.map((b, i) => (
                <Block key={i} block={b} />
              ))}
            </section>
          ))}
          <p
            style={{
              margin: 0,
              paddingTop: 'var(--ra-s-5)',
              borderTop: '1px solid var(--ra-border)',
              fontSize: 'var(--ra-fs-9)',
              color: 'var(--ra-text-3)'
            }}
          >
            {GUIDE.foot}
          </p>
        </div>
      </div>
    </div>,
    document.body
  )
}
