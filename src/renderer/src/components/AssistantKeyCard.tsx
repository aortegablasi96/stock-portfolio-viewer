import { useCallback, useState } from 'react'
import {
  canRemoveKey,
  isSavableKey,
  keyPanelKind,
  saveKeyLabel,
  KEY_BODIES,
  KEY_HEADINGS,
  KEY_STORAGE_NOTE,
} from '../lib/assistantKey'
import { controlClassName } from '../lib/fieldVariants'
import type { AssistantStatus } from '@shared/domain/assistant'
import { MAX_API_KEY_CHARS } from '@shared/domain/assistantKey'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card'
import { ConfirmAction } from './ConfirmAction'
import { Field } from './ui/Field'
import { StatePanel } from './ui/StatePanel'

/**
 * Where the owner gives the app an OpenAI key (Story #300, DDR-0105).
 *
 * It exists because `.env` does not solve a packaged build: there is no file beside an installed
 * binary, so before this an installed copy found a key only if the operating system already
 * carried one — invisible, unguessable from inside the app, and a poor thing to ask a desktop
 * owner for (DDR-0100 names the gap and deliberately leaves it open).
 *
 * It sits **below the consent gate and above the question**, in the order the decisions are made:
 * what may be sent, then what it is sent with, then the asking. That also puts it where the
 * `not_configured` gate above points, so the blocker and its fix are adjacent rather than the
 * owner being told to go and edit a file.
 *
 * Three behaviours are the story's acceptance criteria and are worth reading before changing
 * anything here:
 *
 * **The value is never displayed back.** The field is `type="password"` while it is being typed,
 * is cleared the moment a save lands, and nothing repopulates it — because nothing *can*: no
 * channel returns a key or a fragment of one, and `AssistantStatus` carries three booleans about
 * it and no material (ADR-0010). A "show the last four characters" affordance would be the one
 * place the key came back after `aiGateway.redactKeys` went to the trouble of stripping even the
 * fragment OpenAI quotes in a refusal.
 *
 * **Precedence is on screen, not discovered.** Saving a key while `OPENAI_API_KEY` is set stores
 * it and does not use it, and the panel says exactly that — `keyPanelKind` has a kind for it.
 *
 * **Removing is the in-place `ConfirmAction`** — no modal, no `window.confirm` (DDR-0012) — and,
 * unlike withdrawing consent, this one *does* warn of loss: the key cannot be shown again, so it
 * has to be pasted afresh.
 */
export function AssistantKeyCard({
  status,
  onStatus,
}: {
  status: AssistantStatus
  /** Re-seat the view on the status that actually landed, rather than on what was assumed. */
  onStatus: (next: AssistantStatus) => void
}): React.JSX.Element {
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const kind = keyPanelKind(status)

  const save = useCallback(async (): Promise<void> => {
    if (!isSavableKey(key)) return
    setBusy(true)
    try {
      const result = await window.api.setAssistantApiKey({ key })
      onStatus(result.assistant)
      if (result.status === 'saved') {
        // Cleared on success and only on success: a rejected paste is still the owner's to fix,
        // and wiping it would make them find the key again to correct a stray space.
        setKey('')
        setProblem(null)
      } else {
        setProblem(result.message)
      }
    } finally {
      setBusy(false)
    }
  }, [key, onStatus])

  const remove = useCallback(async (): Promise<void> => {
    const result = await window.api.clearAssistantApiKey()
    onStatus(result.assistant)
    setProblem(null)
  }, [onStatus])

  return (
    <Card>
      <CardHeader>
        <CardTitle>{KEY_HEADINGS[kind]}</CardTitle>
        {/* A missing key is not a failure and is not toned as one — the same call the gate above
            makes for a decision that has not been taken yet (DDR-0037). */}
        <Badge variant={status.configured ? 'positive' : 'neutral'}>
          {status.configured ? 'Key set' : 'No key'}
        </Badge>
      </CardHeader>
      <CardContent>
        <p className="assistant-lede">{KEY_BODIES[kind]}</p>

        {/* Reuses the question box's own form layout: a stacked label over a full-width control
            and an action row beneath it. A second rule declaring the same three properties is the
            duplication Epic #125 exists to stop, and the two forms are the same shape. */}
        <form
          className="assistant-ask"
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          <Field label="OpenAI API key">
            {(id) => (
              <input
                id={id}
                type="password"
                className={controlClassName('term')}
                value={key}
                disabled={busy}
                maxLength={MAX_API_KEY_CHARS}
                autoComplete="off"
                spellCheck={false}
                placeholder="sk-…"
                onChange={(event) => {
                  setKey(event.target.value)
                  setProblem(null)
                }}
              />
            )}
          </Field>
          <div className="assistant-ask-actions">
            <Button type="submit" variant="primary" disabled={busy || !isSavableKey(key)}>
              {saveKeyLabel(kind, busy)}
            </Button>
            {canRemoveKey(status) && (
              <ConfirmAction
                label="Remove key"
                confirmLabel="Yes, remove it"
                busyLabel="Removing…"
                warning="The assistant stops working until another key is set. This app never shows a saved key again, so you will need to paste it in afresh."
                onConfirm={remove}
              />
            )}
          </div>
        </form>

        {/* What the owner pasted was not a key. The one state here that interrupts, and the only
            variant the primitive paints (DDR-0038). */}
        {problem !== null && (
          <StatePanel variant="error" surface="inline">
            {problem}
          </StatePanel>
        )}

        <p className="assistant-note assistant-key-note">{KEY_STORAGE_NOTE}</p>
      </CardContent>
    </Card>
  )
}
