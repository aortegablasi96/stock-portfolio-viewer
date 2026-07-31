import { useCallback, useState } from 'react'
import { flexDataVersion } from '../../lib/dataVersion'
import { Button } from '../ui/Button'

/**
 * The shared "no Flex data imported yet" empty state for the analytics views
 * (Stories #21–#24). Analytics read exclusively from imported Flex statements, so when
 * none exist each view renders this instead — with an inline import action that reuses
 * the same IPC as the Portfolio tab.
 *
 * A successful import bumps the shared data version rather than calling back into the view
 * that happens to be showing this panel (Story #109). The views stay mounted once visited,
 * so an import started here is an import the other three need to hear about too — one signal
 * re-reads all of them, including this one's.
 */
export function NeedsImport(): React.JSX.Element {
  const [importing, setImporting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const runImport = useCallback(async () => {
    setImporting(true)
    setMessage(null)
    try {
      const result = await window.api.importFlexStatements()
      switch (result.status) {
        case 'imported':
          flexDataVersion.bump()
          break
        case 'canceled':
          break
        case 'invalid':
          setMessage(`That file isn’t a valid Flex Query statement. ${result.message}`)
          break
        case 'error':
          setMessage(result.message)
          break
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Unexpected error importing the statements.')
    } finally {
      setImporting(false)
    }
  }, [])

  return (
    <section className="state-panel state-notice" role="status">
      <h2>No imported data yet</h2>
      <p>
        This analysis is built from your imported IBKR Flex Query statements. Import one or more
        Portfolio Analyst statement files to get started.
      </p>
      <Button variant="primary" onClick={() => void runImport()} disabled={importing}>
        {importing ? 'Importing…' : 'Import statements…'}
      </Button>
      {message && (
        <p className="capture-status capture-status-error" role="alert">
          {message}
        </p>
      )}
    </section>
  )
}
