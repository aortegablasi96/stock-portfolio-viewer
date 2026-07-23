import { useCallback, useState } from 'react'

/**
 * The "some positions have no sector yet" prompt in the Allocation view (Story #30).
 *
 * IBKR Flex statements carry no sector field, so classification is fetched from the
 * Client Portal Gateway once per instrument and cached locally. This is the only analytics
 * action that needs a live gateway, so it is opt-in — the sector chart renders without it,
 * with the unclassified positions in their own slice — and a closed gateway is reported
 * inline rather than replacing the view.
 */
export function ClassifySectors({
  unclassifiedCount,
  onClassified,
}: {
  unclassifiedCount: number
  onClassified: () => void
}): React.JSX.Element {
  const [running, setRunning] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  const run = useCallback(async () => {
    setRunning(true)
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
          setMessage(`${result.message} Sector data is read from IBKR once, then cached locally.`)
          break
        case 'error':
          setFailed(true)
          setMessage(result.message)
          break
      }
    } catch (err) {
      setFailed(true)
      setMessage(err instanceof Error ? err.message : 'Unexpected error classifying instruments.')
    } finally {
      setRunning(false)
    }
  }, [onClassified])

  return (
    <div className="classify-prompt">
      <p className="classify-note">
        {unclassifiedCount} position{unclassifiedCount === 1 ? ' has' : 's have'} no sector yet.
        Sector data isn’t in Flex statements — fetch it from Interactive Brokers once and it’s
        cached locally.
      </p>
      <button type="button" className="retry-button" onClick={() => void run()} disabled={running}>
        {running ? 'Classifying…' : 'Classify from IBKR'}
      </button>
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
