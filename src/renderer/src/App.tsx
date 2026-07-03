import { useState } from 'react'

/**
 * Placeholder renderer view.
 *
 * Beyond proving the shell renders (Story #9), it now exercises the typed IPC
 * bridge end-to-end (Story #10): the button calls `window.api.ping`, which flows
 * renderer → preload → IPC handler → systemService → back. Real portfolio UI
 * arrives in Milestone M1.
 */
export function App(): React.JSX.Element {
  const [reply, setReply] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handlePing(): Promise<void> {
    setError(null)
    try {
      const res = await window.api.ping({ message: 'hello from the renderer' })
      setReply(`${res.reply} · echo="${res.echo}" · ${res.at}`)
    } catch (err) {
      setReply(null)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <main className="app-shell">
      <section className="placeholder-card">
        <p className="eyebrow">Stock Portfolio Viewer</p>
        <h1>Foundation ready</h1>
        <p className="subtitle">
          Local-first desktop shell — Electron, React, Vite, and TypeScript are wired up.
        </p>

        <button type="button" className="ping-button" onClick={handlePing}>
          Test IPC bridge
        </button>
        {reply && (
          <p className="ipc-result" role="status">
            {reply}
          </p>
        )}
        {error && (
          <p className="ipc-error" role="alert">
            {error}
          </p>
        )}

        <p className="hint">
          Portfolio dashboard and analytics arrive in Milestone&nbsp;M1.
        </p>
      </section>
    </main>
  )
}
