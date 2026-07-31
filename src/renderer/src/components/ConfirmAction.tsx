import { useState } from 'react'
import { Button } from './ui/Button'

/**
 * A destructive action that confirms in place before running (Story #43). Rather than a
 * modal dialog, the trigger button expands into an explicit warning plus Confirm / Cancel —
 * keyboard-accessible, dismissible, and testable, in keeping with the app's "avoid
 * unnecessary dialogs" stance. Presentational: the parent owns what `onConfirm` actually
 * does and how the outcome is shown.
 */
type Phase = 'idle' | 'confirming' | 'busy'

export function ConfirmAction({
  label,
  confirmLabel,
  busyLabel,
  warning,
  onConfirm,
}: {
  /** The resting trigger, e.g. "Clear statements". */
  label: string
  /** The confirm button once armed, e.g. "Yes, clear statements". */
  confirmLabel: string
  /** Shown on the confirm button while the action runs, e.g. "Clearing…". */
  busyLabel: string
  /** Plain-language statement of exactly what will be removed. */
  warning: string
  /** The destructive action; awaited so the button can show its busy state. */
  onConfirm: () => Promise<void>
}): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>('idle')

  if (phase === 'idle') {
    return (
      <Button variant="danger" onClick={() => setPhase('confirming')}>
        {label}
      </Button>
    )
  }

  const run = async (): Promise<void> => {
    setPhase('busy')
    try {
      await onConfirm()
    } finally {
      setPhase('idle')
    }
  }

  return (
    <div className="confirm-action" role="group" aria-label={`Confirm: ${label}`}>
      <p className="confirm-warning" role="status">
        {warning}
      </p>
      <div className="confirm-buttons">
        <Button variant="danger" onClick={() => void run()} disabled={phase === 'busy'}>
          {phase === 'busy' ? busyLabel : confirmLabel}
        </Button>
        <Button variant="secondary" onClick={() => setPhase('idle')} disabled={phase === 'busy'}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
