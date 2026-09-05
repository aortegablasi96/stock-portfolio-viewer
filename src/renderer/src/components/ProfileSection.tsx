import { useCallback, useEffect, useState } from 'react'
import {
  draftFromForm,
  formFromProfile,
  isFormDirty,
  isFormValid,
  positionIssue,
  type ProfileFormState,
  type TargetRowDraft,
} from '../lib/investorProfile'
import {
  ADD_LIMIT_LABEL,
  CLEAR_ROW,
  EMPTY_POSITION_TEXT,
  PROFILE_COLUMN_TITLE,
  REMOVE_LIMIT_LABEL,
  SECTION_OPEN_ON_ARRIVAL,
  saveLabel,
  saveVariant,
  styleTagPillClassName,
  styleTagPillLabel,
} from '../lib/profileColumn'
import { vocabularyFrom } from '../lib/profileVocabulary'
import {
  EMPTY_INVESTOR_PROFILE,
  STYLE_TAGS,
  STYLE_TAG_LABELS,
  type InvestorProfile,
  type StyleTag,
} from '@shared/domain/investorProfileTerms'
import type { AllocationReport, AllocationResult } from '@shared/domain/allocation'
import { useAnalytics } from './analytics/useAnalytics'
import { ConfirmAction } from './ConfirmAction'
import { AddMark, ProfileTargets } from './ProfileTargets'
import { Button } from './ui/Button'
import { Card, CardContent } from './ui/Card'
import { Collapsible } from './ui/Collapsible'
import { Field } from './ui/Field'
import { PercentInput } from './ui/PercentInput'
import { StatePanel } from './ui/StatePanel'
import { ToggleGroup } from './ui/ToggleGroup'

/**
 * The investor profile — where the owner states how they intend to invest (Story #280, DDR-0094),
 * **folded into the Assistant view** (Story #310, DDR-0108).
 *
 * It was the app's seventh sidebar row until this story, and the argument that put it there is the
 * argument that has now taken it away. Assistant and Profile were the same page twice: neither an
 * `AnalyticsShell` view, both declaring their own `<main>` and `<h1>`, both carrying `OWNER_SOURCE`
 * — the one provenance value naming no data source, because the standard on the page is the
 * owner's rather than the app's (DDR-0094, DDR-0098). They sat next to each other so the list read
 * *data, then the surface that talks about it, then the policy over it*, and one page holding the
 * standard and the conversation about it is where that reading ends.
 *
 * So this is a **section**, not a view. It brings no `<main>`, no `<h1>` and no `PageHeader` — the
 * Assistant view owns all three — and everything else about it is untouched. **All five sections
 * stay**: `balanceDriftService` measures every one of them and `driftMoves` caps a move by the
 * position-size ceiling, so dropping a table would silently narrow the drift report rather than
 * simplify the page.
 *
 * **It is a column now, and the column is the disclosure** (Story #343, DDR-0115). Until #343 an
 * outer `group` `Collapsible` held the profile as a whole, closed on arrival, inside a scrolling
 * page. The design gives the standard its own 420px column that folds to a 48px rail, so that
 * outer fold is gone: two nested ones would be a fold inside a fold, and the rail's expander is
 * the same gesture the trigger was. The heading the trigger carried is a plain `<h2>` at the same
 * level, and the summary beside it moved under it.
 *
 * **Story #347 splits it into a head and a scroller.** Until now the title, the intro, Save,
 * Discard and the five sections were one block inside one scrolling column, so editing a target
 * three sections down meant scrolling back up to find the button that would store it. The design
 * pins the head and scrolls the sections under it, which is why this component returns two boxes
 * inside one `hidden` wrapper rather than one list: `.profile-column-head` does not shrink, and
 * `.profile-column-sections` is the only thing here with a scrollbar.
 *
 * **Its five `section` `Collapsible`s are untouched** (DDR-0106) — the parts of the profile still
 * open and close one at a time, `hidden` and never unmounted, so folding one away does not
 * discard what has been typed into it. That is the same decision the tab shell makes for a view
 * (DDR-0027), and the fold of the whole column now makes it a third time: `hidden` on this
 * block, so the form survives and its controls leave the tab order together. What #347 changes is
 * only which of them arrive open: the design opens *Investing style* alone, and the other four
 * are call sites opting out of the primitive's default rather than a change to it.
 *
 * **Everything the owner can *do* to the profile sits with the form it acts on**, so a write can
 * only be started from a place where its reply can be read. `role="status"` inside a `hidden`
 * subtree announces nothing, and a Save button pressable while its answer was hidden would make
 * exactly that — which is why the fold takes the buttons with it rather than leaving a head row
 * that can still be pressed. #347 moves them to the head, and the notice **moves with them**: that
 * is the whole of #310's finding, and a head that keeps the buttons while leaving their answer
 * down in the scroller would be the same bug with a longer scroll in front of it.
 *
 * The five cards lose the ruled header strip they carried as static cards, and that follows
 * DDR-0059's own rule rather than departing from it: the strip divides a head from the body under
 * it, and `.card-header:last-child` already gives it back where there is no body to divide from. A
 * closed disclosure *is* that case, so a strip here would be a rule drawn across the bottom of a
 * card for as long as the section stayed shut.
 *
 * Two pieces of state, kept apart on purpose. `stored` is what is in `app_meta`; `form` is what
 * the owner has typed since. Comparing them is what `Save` is enabled by, and keeping the form
 * rather than re-seeding it after every keystroke is what lets a half-finished profile survive a
 * trip to Allocation and back — the Assistant view stays mounted like every other (DDR-0027).
 *
 * **Nothing about the profile reaches the model here.** It is stored and shown; the conversation
 * beside it assembles its own context from `window.api`, and this component has no gateway to
 * reach through.
 */

/** Stable across renders, so `useAnalytics`'s reload effect is not re-armed every time. */
const fetchAllocation = (): Promise<AllocationResult> => window.api.getAllocation()

/** What the owner is told after a write, and in which tone. */
type Notice = { tone: 'ok' | 'error'; message: string }

export function ProfileSection({
  onWritten,
  onStored,
  hidden,
}: {
  /**
   * A save or a clear landed, and the stored profile is now something else.
   *
   * The conversation beside this section grounds an answer partly in the profile and reads it
   * once, so it has to be told (DDR-0098). It is a callback to the view above rather than a bump
   * of a module-level store, because since #310 there *is* a common ancestor: `AssistantView`
   * holds both halves, which is the shape `App` already uses for every fact the sidebar and a
   * view share (DDR-0056, DDR-0108).
   */
  onWritten: () => void
  /**
   * What the stored profile now *says*, which is a different question from whether it changed.
   *
   * The column's rail draws a completeness dot while it is folded (Story #343), and the count
   * behind it is this section's `stored`. It is reported up rather than read a second time in the
   * view: two reads of one `app_meta` value are two answers waiting to disagree, and the one that
   * matters is the one the form beside it is seated on. Called on arrival as well as on a write —
   * the dot has to be right before anything is saved.
   */
  onStored: (profile: InvestorProfile) => void
  /**
   * The column is folded, so nothing here may be seen *or reached*.
   *
   * `hidden`, never unmounted, which is the tab shell's rule one level down (DDR-0027): a
   * half-finished profile survives the fold, and the attribute is what takes the form's controls
   * out of the tab order — a 48px rail must not be a column of invisible Tab stops.
   */
  hidden: boolean
}): React.JSX.Element {
  const [stored, setStored] = useState<InvestorProfile | null>(null)
  const [form, setForm] = useState<ProfileFormState>(() => formFromProfile(EMPTY_INVESTOR_PROFILE))
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)

  /**
   * The vocabularies, over the *existing* allocation channel rather than one of this section's own.
   *
   * Its three breakdowns are precisely the three vocabularies, already grouped and labelled, and
   * a second channel computing the same thing would be a second answer that could disagree. It
   * follows that `needs_import` is not an error here — it is a portfolio the app has never seen —
   * so the report is read out where it exists and is `null` where it does not, and the form works
   * either way.
   */
  const allocation = useAnalytics(fetchAllocation)
  const report: AllocationReport | null =
    allocation.state.phase === 'loaded' && allocation.state.result.status === 'ok'
      ? allocation.state.result.report
      : null
  const vocabulary = vocabularyFrom(report, form)

  useEffect(() => {
    let live = true
    void window.api.getInvestorProfile().then((profile) => {
      if (!live) return
      setStored(profile)
      setForm(formFromProfile(profile))
      onStored(profile)
    })
    return () => {
      live = false
    }
  }, [onStored])

  /** Take the profile the write returned as the new truth, and tell the view above. */
  const seat = useCallback(
    (profile: InvestorProfile, message: string): void => {
      setStored(profile)
      setForm(formFromProfile(profile))
      setNotice({ tone: 'ok', message })
      onWritten()
      onStored(profile)
    },
    [onWritten, onStored],
  )

  const save = async (): Promise<void> => {
    const draft = draftFromForm(form)
    if (draft === null) return

    setBusy(true)
    setNotice(null)
    try {
      const result = await window.api.saveInvestorProfile(draft)
      if (result.status === 'saved') seat(result.profile, 'Profile saved.')
      else setNotice({ tone: 'error', message: result.message })
    } finally {
      setBusy(false)
    }
  }

  const clear = async (): Promise<void> => {
    setNotice(null)
    const result = await window.api.clearInvestorProfile()
    if (result.status === 'cleared') seat(result.profile, 'Profile cleared.')
    else setNotice({ tone: 'error', message: result.message })
  }

  const setRows = (
    field: 'currency' | 'sector' | 'assetClass',
    rows: readonly TargetRowDraft[],
  ): void => {
    setForm((prev) => ({ ...prev, [field]: rows }))
  }

  const toggleTag = (tag: StyleTag): void => {
    setForm((prev) => {
      const next = new Set(prev.styleTags)
      if (!next.delete(tag)) next.add(tag)
      return { ...prev, styleTags: next }
    })
  }

  // Nothing may be edited before the stored profile arrives, or the first keystroke would be
  // overwritten by the read that is still in flight.
  if (stored === null) {
    return (
      <div className="profile-column-body" hidden={hidden}>
        <StatePanel variant="loading">Loading your profile…</StatePanel>
      </div>
    )
  }

  const dirty = isFormDirty(form, stored)
  const valid = isFormValid(form)
  const band = form.positionSize
  const bandIssue = positionIssue(band)

  return (
    /* The column *is* the disclosure now (Story #343, DDR-0115), so the outer `group`
       `Collapsible` is gone and this is a plain block. What it keeps is the class it wore for
       placement and the `hidden` the fold sets; what Story #347 gives it is two children rather
       than seven, because the head has to stay put while the sections scroll under it. Its five
       `section` `Collapsible`s are untouched: a fold inside a fold is what two nested ones would
       be. */
    <div className="profile-column-body" hidden={hidden}>
      {/* Everything that is true of the profile as a whole, and everything the owner can do to
          it — pinned, so a target typed three sections down is stored without scrolling back
          (Story #347). */}
      <div className="profile-column-head">
        {/* The name the group's trigger used to carry, at the level it rendered, with the count
            of what the *stored* profile says beside it. The pill is a count and never a score:
            an owner who has stated nothing has stated nothing, which the app answers from its own
            published baseline (ADR-0009, ADR-0012, DDR-0109). */}
        <div className="profile-column-title-row">
          <h2 className="profile-column-title">{PROFILE_COLUMN_TITLE}</h2>
          <span className={styleTagPillClassName(stored.styleTags.length)}>
            {styleTagPillLabel(stored.styleTags.length)}
          </span>
        </div>

        {/* It says "you" three times on purpose: the standard is the owner's, and the app
            measuring against a standard it invented is the one thing ADR-0009 does not
            license. */}
        <p className="profile-intro">
          Your own policy for how this portfolio should be invested. Nothing here is required —
          state only what you have a view on, and the parts you leave blank stay unmeasured. The
          assistant beside this compares your holdings against what you set here; the app never
          proposes a policy of its own.
        </p>

        <div className="profile-actions">
          <Button
            variant={saveVariant(dirty)}
            size="sm"
            disabled={busy || !dirty || !valid}
            onClick={() => void save()}
          >
            {/* The check is a glyph beside the word rather than inside it: an accessible name of
                "✓ Saved" is a reader being told "check mark saved", and the word alone is the
                whole of the state. Drawn only in the resting half, where it is the answer to
                "did that land". */}
            {!dirty && !busy && (
              <svg
                className="profile-save-glyph"
                viewBox="0 0 24 24"
                aria-hidden="true"
                focusable="false"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
            {busy ? 'Saving…' : saveLabel(dirty)}
          </Button>
          {/* Only while there is something to discard, which is the design's own guard and the
              honest one: a control that would undo nothing is a control that says there is
              something to undo. */}
          {dirty && (
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => setForm(formFromProfile(stored))}
            >
              Discard
            </Button>
          )}
        </div>

        {/* The write's outcome, announced. `role="status"` rather than `alert` even for a
            failure: the owner pressed Save and is looking at the button, so this is a reply
            rather than an interruption. It moved to the head *with* the buttons, which is #310's
            finding rather than a departure from it — a live region the press cannot reach is a
            press whose answer is never read, and leaving it in the scroller while the button rose
            would have been that bug with a longer scroll in front of it. */}
        <p
          className={`profile-notice ${notice?.tone === 'error' ? 'profile-notice-error' : ''}`}
          role="status"
        >
          {notice?.message ?? ''}
        </p>
      </div>

      {/* The only thing in this column with a scrollbar. */}
      <div className="profile-column-sections">
        <Card>
          {/* The one section that arrives open: a tag is one click and needs nothing typed, and
              it is the part of the profile both the head's pill and the rail's dot report. */}
          <Collapsible label="Investing style">
            <CardContent>
              <p className="profile-lede">
                How you think about this portfolio, in the owner’s own five words. Pick any number,
                or none — these describe intent, and the targets below are what make it measurable.
              </p>
              <ToggleGroup
                label="Investing style tags"
                mode="multiple"
                value={form.styleTags}
                options={STYLE_TAGS.map((tag) => ({ id: tag, label: STYLE_TAG_LABELS[tag] }))}
                onSelect={toggleTag}
              />
            </CardContent>
          </Collapsible>
        </Card>

        <ProfileTargets
          dimension="currency"
          rows={form.currency}
          terms={vocabulary.currency}
          onChange={(rows) => setRows('currency', rows)}
          lede="What share of the portfolio you want denominated in each currency. Currencies you already hold are offered; you can add one you intend to hold."
        />

        <ProfileTargets
          dimension="sector"
          rows={form.sector}
          terms={vocabulary.sector}
          onChange={(rows) => setRows('sector', rows)}
          lede="What share of the portfolio you want in each sector. The list comes from the sectors your holdings have been classified into."
        />

        <ProfileTargets
          dimension="assetClass"
          rows={form.assetClass}
          terms={vocabulary.assetClass}
          onChange={(rows) => setRows('assetClass', rows)}
          lede="What share of the portfolio you want in each asset class, cash included."
        />

        <Card>
          <Collapsible
            label="Single position size"
            defaultOpen={SECTION_OPEN_ON_ARRIVAL}
            /* Beside the trigger and never inside it: a control within the trigger would be a
               button inside a button, which is invalid markup that renders and then swallows one
               of the two clicks (DDR-0106). */
            action={
              <Button
                size="sm"
                onClick={() =>
                  setForm((prev) => ({
                    ...prev,
                    positionSize: prev.positionSize === null ? { low: '', high: '' } : null,
                  }))
                }
              >
                {band === null ? (
                  <>
                    <AddMark />
                    {ADD_LIMIT_LABEL}
                  </>
                ) : (
                  REMOVE_LIMIT_LABEL
                )}
              </Button>
            }
          >
            <CardContent>
              <p className="profile-lede">
                How large any one holding may grow, as a share of the portfolio. The maximum is the
                concentration ceiling; leave the minimum at 0 if that is all you want to state.
              </p>
              {band === null ? (
                <p className="profile-empty">{EMPTY_POSITION_TEXT}</p>
              ) : (
                <div className="profile-target">
                  <div className="profile-target-row">
                    <Field label="At least %">
                      {(id) => (
                        <PercentInput
                          id={id}
                          value={band.low}
                          onChange={(e) =>
                            setForm((prev) => ({
                              ...prev,
                              positionSize: { low: e.target.value, high: band.high },
                            }))
                          }
                        />
                      )}
                    </Field>
                    <Field label="At most %">
                      {(id) => (
                        <PercentInput
                          id={id}
                          value={band.high}
                          onChange={(e) =>
                            setForm((prev) => ({
                              ...prev,
                              positionSize: { low: band.low, high: e.target.value },
                            }))
                          }
                        />
                      )}
                    </Field>
                  </div>
                  {bandIssue && <p className="profile-target-issue">{bandIssue}</p>}
                </div>
              )}
            </CardContent>
          </Collapsible>
        </Card>

        {/* Not a disclosure, and that is the design's reading rather than a shortcut: the five
            above fold because each holds a form, and this holds one button — a fold would hide a
            control behind a click that reveals nothing else.

            What it keeps is the in-place confirm the app uses for every destructive action — no
            modal, no `window.confirm` (DDR-0012). DDR-0115 amendment 5 took the confirm off Clear
            chat because a transcript is session state; a profile is **stored**, so this one stays.
            It is still not ADR-0006's sanctioned reset: nothing append-only is touched, because a
            profile is a setting rather than history. */}
        <div className="profile-clear-row">
          <div className="profile-clear-copy">
            <p className="profile-clear-title">{CLEAR_ROW.title}</p>
            <p className="profile-clear-note">{CLEAR_ROW.explanation}</p>
          </div>
          <ConfirmAction
            label={CLEAR_ROW.action}
            confirmLabel={CLEAR_ROW.confirm}
            busyLabel={CLEAR_ROW.busy}
            warning={CLEAR_ROW.warning}
            onConfirm={clear}
          />
        </div>
      </div>
    </div>
  )
}
