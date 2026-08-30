import { useCallback, useState } from 'react'
import {
  isSavableKey,
  keySurface,
  saveKeyLabel,
  KEY_BODY,
  KEY_HEADING,
  KEY_SHADOWED_NOTE,
  KEY_STORAGE_NOTE,
} from '../lib/assistantKey'
import { controlClassName } from '../lib/fieldVariants'
import type { AssistantStatus } from '@shared/domain/assistant'
import { MAX_API_KEY_CHARS } from '@shared/domain/assistantKey'
import { Button } from './ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card'
import { Field } from './ui/Field'
import { StatePanel } from './ui/StatePanel'

/**
 * Where the owner gives the app an OpenAI key (Story #300, DDR-0105; shrunk by Story #309).
 *
 * It exists because `.env` does not solve a packaged build: there is no file beside an installed
 * binary, so without this an installed copy finds a key only if the operating system already
 * carries one — invisible, unguessable from inside the app, and a poor thing to ask a desktop owner
 * for. Since ADR-0011 it is also the *whole* of the setup: supplying the key is what authorizes
 * sending, and there is no separate decision in front of it.
 *
 * **The surface shrinks; the feature does not.** #300 drew four panel kinds and a Remove control.
 * The field is now shown when there is no working key and not shown once there is one — no
 * activate, no deactivate, no rotate — so this component **renders nothing** on every run after
 * the first, and the page is the chat. The one thing it still says about a key that is present is
 * DDR-0105's precedence, and that is a sentence rather than a control.
 *
 * Three behaviours are the story's acceptance criteria and are worth reading before changing
 * anything here:
 *
 * **The value is never displayed back.** The field is `type="password"` while it is being typed,
 * is cleared the moment a save lands, and nothing repopulates it — because nothing *can*: no
 * channel returns a key or a fragment of one, and `AssistantStatus` carries two facts about it and
 * no material (ADR-0010). A "show the last four characters" affordance would be the one place the
 * key came back after `aiGateway.redactKeys` went to the trouble of stripping even the fragment
 * OpenAI quotes in a refusal.
 *
 * **Precedence is on screen, not discovered.** A key the environment shadows is reported as kept
 * and unused, with what to do about it, and `keySurface` has a state for exactly that.
 *
 * **No restart.** The status that comes back from the save is what this view re-seats on, so the
 * assistant is ready in the same process that had no key a moment ago.
 */
export function AssistantKeyCard({
  status,
  onStatus,
}: {
  status: AssistantStatus
  /** Re-seat the view on the status that actually landed, rather than on what was assumed. */
  onStatus: (next: AssistantStatus) => void
}): React.JSX.Element | null {
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

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

  const surface = keySurface(status)

  // The assistant is running on a key nobody here needs to touch. Nothing is drawn at all — a card
  // reporting that the setup is done is the ceremony this story exists to remove.
  if (surface === 'none') return null

  // Running on the environment's key while the owner's sits unused. One sentence, no control:
  // the order is reported rather than silent (DDR-0105), and removing a key is not something this
  // app does (ADR-0011).
  if (surface === 'shadowed') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Using a key from your environment</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="assistant-lede">{KEY_SHADOWED_NOTE}</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{KEY_HEADING}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="assistant-lede">{KEY_BODY}</p>

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
              {saveKeyLabel(busy)}
            </Button>
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
