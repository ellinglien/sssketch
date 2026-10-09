import { useEffect, useRef, useState } from 'react'
import {
  CLEANING_TEXT,
  CLEAN_UP_BUTTON,
  COULD_NOT_CHECK_TEXT,
  LOOKING_TEXT,
  NOTHING_TO_CLEAN_TEXT,
  NOT_NOW_BUTTON,
  OK_BUTTON,
  cleanupOfferText,
  clearedText,
  shouldOfferCleanup
} from '@shared/reonedCleanup'
import { collectInMemoryReonedNames } from '../state/reonedInUse'
import { subscribeReonedCleanupRequest } from '../state/reonedCleanupRequest'

/** After the library is ready, how long the launch pass waits before sizing the unused copies,
 * so it never competes with opening a project. */
const LAUNCH_DELAY_MS = 30_000
/** Same window as the other notices' "done" lines. */
const DONE_VISIBLE_MS = 14_000

type NoticeState =
  | { kind: 'hidden' }
  | { kind: 'looking' }
  | { kind: 'offer'; bytes: number }
  | { kind: 'cleaning' }
  | { kind: 'done'; freedBytes: number }
  | { kind: 'nothing' }
  | { kind: 'unreadable' }

/** Spec part 3: re-oned stem copies no project uses.
 * - The launch pass, once per session: after the library is ready and 30 s more, a survey (main
 *   honours "not now"); the offer shows only at 200 MB or more. Every other outcome stays quiet.
 * - The gear menu's item: the same offer at any size, or "nothing to clean up", or "couldn't read
 *   every project".
 * - "clean up" sends what memory holds again, at click time, and main recomputes the used set.
 * - "not now" is stored in main (7 days), whichever way the notice was opened.
 * A small fixed box like the other notices: it never blocks input. Not behind the advanced
 * switch (re-one is a basic feature). */
export function ReonedCopiesNotice(): React.JSX.Element | null {
  const [notice, setNotice] = useState<NoticeState>({ kind: 'hidden' })
  // What is showing, for the async callbacks below: a launch pass never replaces a notice that
  // is already up, and a second request never interrupts looking or cleaning.
  const showing = useRef<NoticeState['kind']>('hidden')
  useEffect(() => {
    showing.current = notice.kind
  }, [notice])

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let ran = false
    const runLaunchPass = (): void => {
      if (ran || cancelled) return
      ran = true
      timer = setTimeout(() => {
        if (cancelled || showing.current !== 'hidden') return
        void window.rifffApi
          .reonedCopiesSurvey({
            inMemoryNames: collectInMemoryReonedNames(),
            respectNotNow: true
          })
          .then((survey) => {
            if (cancelled || showing.current !== 'hidden' || survey.status !== 'ok') return
            const offer = shouldOfferCleanup({
              unusedBytes: survey.unusedBytes,
              now: Date.now(),
              notNowUntil: survey.notNowUntil
            })
            if (offer) setNotice({ kind: 'offer', bytes: survey.unusedBytes })
          })
          .catch((err) => console.error('ReonedCopiesNotice: launch survey failed:', err))
      }, LAUNCH_DELAY_MS)
    }
    const unsubscribe = window.rifffApi.onLibraryWarmupComplete(runLaunchPass)
    void window.rifffApi
      .getLibraryWarmupStatus()
      .then((done) => {
        if (done) runLaunchPass()
      })
      .catch((err) => console.error('ReonedCopiesNotice: warmup status failed:', err))
    return () => {
      cancelled = true
      unsubscribe()
      if (timer !== null) clearTimeout(timer)
    }
  }, [])

  useEffect(
    () =>
      subscribeReonedCleanupRequest(() => {
        if (showing.current === 'looking' || showing.current === 'cleaning') return
        showing.current = 'looking'
        setNotice({ kind: 'looking' })
        void window.rifffApi
          .reonedCopiesSurvey({
            inMemoryNames: collectInMemoryReonedNames(),
            respectNotNow: false
          })
          .then((survey) => {
            if (survey.status === 'ok') {
              setNotice(
                survey.unusedBytes > 0
                  ? { kind: 'offer', bytes: survey.unusedBytes }
                  : { kind: 'nothing' }
              )
            } else if (survey.status === 'unreadable') {
              setNotice({ kind: 'unreadable' })
            } else {
              setNotice({ kind: 'hidden' }) // the library is away: the item was greyed anyway
            }
          })
          .catch((err) => {
            console.error('ReonedCopiesNotice: survey failed:', err)
            setNotice({ kind: 'hidden' })
          })
      }),
    []
  )

  useEffect(() => {
    if (notice.kind !== 'done') return
    const timer = setTimeout(() => setNotice({ kind: 'hidden' }), DONE_VISIBLE_MS)
    return () => clearTimeout(timer)
  }, [notice])

  function cleanUp(): void {
    setNotice({ kind: 'cleaning' })
    void window.rifffApi
      .reonedCopiesClean(collectInMemoryReonedNames())
      .then((result) => {
        if (result.status === 'ok') {
          if (result.failedCount > 0) {
            console.error(`ReonedCopiesNotice: ${result.failedCount} copies could not be deleted`)
          }
          setNotice({ kind: 'done', freedBytes: result.freedBytes })
        } else if (result.status === 'unreadable') {
          setNotice({ kind: 'unreadable' })
        } else {
          console.error('ReonedCopiesNotice: clean found no library')
          setNotice({ kind: 'hidden' })
        }
      })
      .catch((err) => {
        console.error('ReonedCopiesNotice: clean failed:', err)
        setNotice({ kind: 'hidden' })
      })
  }

  function notNow(): void {
    setNotice({ kind: 'hidden' })
    void window.rifffApi
      .reonedCopiesNotNow()
      .catch((err) => console.error('ReonedCopiesNotice: not now failed:', err))
  }

  const hide = (): void => setNotice({ kind: 'hidden' })

  if (notice.kind === 'hidden') return null

  let text: string
  let actions: { label: string; onClick: () => void }[] = []
  switch (notice.kind) {
    case 'looking':
      text = LOOKING_TEXT
      break
    case 'offer':
      text = cleanupOfferText(notice.bytes)
      actions = [
        { label: CLEAN_UP_BUTTON, onClick: cleanUp },
        { label: NOT_NOW_BUTTON, onClick: notNow }
      ]
      break
    case 'cleaning':
      text = CLEANING_TEXT
      break
    case 'done':
      text = clearedText(notice.freedBytes)
      break
    case 'nothing':
      text = NOTHING_TO_CLEAN_TEXT
      actions = [{ label: OK_BUTTON, onClick: hide }]
      break
    case 'unreadable':
      text = COULD_NOT_CHECK_TEXT
      actions = [{ label: OK_BUTTON, onClick: hide }]
      break
  }

  return (
    <div
      role="status"
      onClick={notice.kind === 'done' ? hide : undefined}
      style={{
        pointerEvents: 'auto',
        maxWidth: 360,
        padding: '5px 10px',
        background: 'var(--ra-bg-bar)',
        border: '1px solid var(--ra-border)',
        borderRadius: 0,
        fontSize: 9,
        lineHeight: 1.5,
        color: 'var(--ra-text-3)',
        cursor: notice.kind === 'done' ? 'pointer' : undefined
      }}
    >
      {text}
      {actions.map((action) => (
        <span key={action.label}>
          {' · '}
          <button
            onClick={action.onClick}
            style={{
              padding: 0,
              border: 'none',
              borderRadius: 0,
              background: 'none',
              fontFamily: 'inherit',
              fontSize: 9,
              color: 'var(--ra-text)',
              cursor: 'pointer'
            }}
          >
            {action.label}
          </button>
        </span>
      ))}
    </div>
  )
}
