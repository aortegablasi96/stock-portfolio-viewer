import { useCallback, useEffect, useState } from 'react'
import type { ClassificationPartial, ClassificationProgress } from '@shared/domain/classification'
import { partialProgressNote, runningLabel } from '../../lib/classifyProgress'
import { Button } from '../ui/Button'

/**
 * The "some positions have no sector yet" prompt in the Allocation view (Story #30).
 *
 * IBKR Flex statements carry no sector field, so classification is fetched from the
 * Client Portal Gateway once per instrument and cached locally. This is the only analytics
 * action that needs a live gateway, so it is opt-in — the sector chart renders without it,
 * with the unclassified positions in their own slice — and a closed gateway is reported
 * inline rather than replacing the view.
 *
 * The lookups are sequential (DDR-0009), so a few dozen instruments take a visible while:
 * the refresh pushes a progress event per lookup and the button counts them off. A refresh
 * that fails partway still saved what it fetched, so failures report that too (Story #105).
 */
export function ClassifySectors({
  unclassifiedCount,
  onClassified,
}: {
  unclassifiedCount: number
  onClassified: () => void
}): React.JSX.Element {
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<ClassificationProgress | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  // Subscribed for the component's lifetime rather than per-run: the unsubscribe is what the
  // preload bridge returns, and ticks only arrive while a refresh this window started is running.
  useEffect(() => window.api.onClassifyProgress(setProgress), [])

  const run = useCallback(async () => {
    setRunning(true)
    setProgress(null)
    setMessage(null)
    setFailed(false)
    try {
      const result = await window.api.classifyInstruments()
      switch (result.status) {
        case 'ok': {
          const { fetched, classified, unclassified } = result.summary
          setMessage(
            fetched === 0
              ? 'Every position has already been looked up. Instruments with no sector are left unclassified.'
              : `Looked up ${fetched} instrument${fetched === 1 ? '' : 's'}; ${classified} classified, ${unclassified} still without a sector.`,
          )
          onClassified()
          break
        }
        case 'needs_import':
          setFailed(true)
          setMessage('Import a Flex statement first.')
          break
        case 'not_connected':
          setFailed(true)
          setMessage(
            `${result.message} Sector data is read from IBKR once, then cached locally.${saved(result.partial)}`,
          )
          break
        case 'not_responding':
          setFailed(true)
          setMessage(
            `${result.message} The gateway is running but didn’t answer — re-authenticate its session and try again.${saved(result.partial)}`,
          )
          break
        case 'error':
          setFailed(true)
          setMessage(`${result.message}${saved(result.partial)}`)
          break
      }
      // A partial run still changed the cache, so the view is refreshed either way.
      if (result.status !== 'needs_import' && result.status !== 'ok') {
        if (result.partial.fetched > 0) onClassified()
      }
    } catch (err) {
      setFailed(true)
      setMessage(err instanceof Error ? err.message : 'Unexpected error classifying instruments.')
    } finally {
      setRunning(false)
      setProgress(null)
    }
  }, [onClassified])

  return (
    <div className="classify-prompt">
      <p className="classify-note">
        {unclassifiedCount} position{unclassifiedCount === 1 ? ' has' : 's have'} no sector yet.
        Sector data isn’t in Flex statements — fetch it from Interactive Brokers once and it’s
        cached locally.
      </p>
      <Button variant="primary" onClick={() => void run()} disabled={running}>
        {running ? runningLabel(progress) : 'Classify from IBKR'}
      </Button>
      {running && progress !== null && progress.total > 0 && (
        <div
          className="classify-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={progress.total}
          aria-valuenow={progress.completed}
          aria-label={`Classifying instruments: ${progress.completed} of ${progress.total}`}
        >
          <span
            className="classify-progress-bar"
            style={{ inlineSize: `${(progress.completed / progress.total) * 100}%` }}
          />
        </div>
      )}
      {message && (
        <p
          className={`capture-status${failed ? ' capture-status-error' : ''}`}
          role={failed ? 'alert' : 'status'}
        >
          {message}
        </p>
      )}
    </div>
  )
}

/** Trailing sentence naming what a failed run still managed to save, or '' if nothing. */
function saved(partial: ClassificationPartial): string {
  const note = partialProgressNote(partial)
  return note === null ? '' : ` ${note}`
}
