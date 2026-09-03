import { useCallback, useEffect, useState } from 'react'
import {
  draftFromForm,
  formFromProfile,
  isFormDirty,
  isFormValid,
  positionIssue,
  profileSummary,
  type ProfileFormState,
  type TargetRowDraft,
} from '../lib/investorProfile'
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
import { ProfileTargets } from './ProfileTargets'
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
 * **Its five `section` `Collapsible`s are untouched** (DDR-0106) — the parts of the profile still
 * open and close one at a time, `hidden` and never unmounted, so folding one away does not
 * discard what has been typed into it. That is the same decision the tab shell makes for a view
 * (DDR-0027), and the fold of the whole column now makes it a third time: `hidden` on this
 * block, so the form survives and its controls leave the tab order together.
 *
 * **Everything the owner can *do* to the profile sits with the form it acts on**, so a write can
 * only be started from a place where its reply can be read. `role="status"` inside a `hidden`
 * subtree announces nothing, and a Save button pressable while its answer was hidden would make
 * exactly that — which is why the fold takes the buttons with it rather than leaving a head row
 * that can still be pressed. (#347 moves Save and Discard to the top of the column, where the
 * design puts them and where they are still inside the same `hidden` subtree.)
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
       placement — the `--space-7` rhythm between the cards below — plus the padding the panel used
       to supply, and the `hidden` the fold sets. Its five `section` `Collapsible`s are untouched:
       a fold inside a fold is what two nested ones would be. */
    <div className="profile-column-body" hidden={hidden}>
      {/* The name the group's trigger used to carry, at the level it rendered. The design draws
          it under the eyebrow with what the stored profile currently says beneath (#347 gives the
          row its style-tag count badge). */}
      <div className="profile-column-title-block">
        <h2 className="profile-column-title">Investor Profile</h2>
        <p className="profile-summary">{profileSummary(stored)}</p>
      </div>

      {/* What this section is, what it offers to do, and how the last write went — one block,
          because all three are statements about the profile as a whole rather than about any
          section below. */}
      <div className="profile-intro-block">
        {/* It says "you" three times on purpose: the standard is the owner's, and the app
            measuring against a standard it invented is the one thing ADR-0009 does not
            license. */}
        <p className="profile-intro">
          Your own policy for how this portfolio should be invested. Nothing here is required —
          state only what you have a view on, and the parts you leave blank stay unmeasured. The
          assistant below compares your holdings against what you set here; the app never proposes
          a policy of its own.
        </p>
        <div className="profile-actions">
          {dirty && (
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => setForm(formFromProfile(stored))}
            >
              Discard changes
            </Button>
          )}
          <Button
            variant="primary"
            size="sm"
            disabled={busy || !dirty || !valid}
            onClick={() => void save()}
          >
            {busy ? 'Saving…' : 'Save profile'}
          </Button>
        </div>
        {/* The write's outcome, announced. `role="status"` rather than `alert` even for a
            failure: the owner pressed Save and is looking at the button, so this is a reply
            rather than an interruption. It sits beside the buttons for a second reason since
            #310 — a live region inside a closed panel announces nothing, so the press and its
            answer have to be in the same panel. */}
        <p
          className={`profile-notice ${notice?.tone === 'error' ? 'profile-notice-error' : ''}`}
          role="status"
        >
          {notice?.message ?? ''}
        </p>
      </div>

      <Card>
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
              {band === null ? 'Add a limit' : 'Remove the limit'}
            </Button>
          }
        >
          <CardContent>
            <p className="profile-lede">
              How large any one holding may grow, as a share of the portfolio. The maximum is the
              concentration ceiling; leave the minimum at 0 if that is all you want to state.
            </p>
            {band === null ? (
              <p className="profile-empty">No position limit — no policy stated here.</p>
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

      <Card>
        <Collapsible
          label="Clear the profile"
          /* The in-place confirm the app uses for every destructive action — no modal, no
             `window.confirm` (DDR-0012). It is not ADR-0006's sanctioned reset: nothing
             append-only is touched, because a profile is a setting rather than history. */
          action={
            <ConfirmAction
              label="Clear profile"
              confirmLabel="Yes, clear my profile"
              busyLabel="Clearing…"
              warning="This removes every style tag and target. Your holdings, snapshots and imported statements are untouched."
              onConfirm={clear}
            />
          }
        >
          <CardContent>
            <p className="profile-lede">
              Leaves the app with no standard to measure your portfolio against, which is where it
              started. You can state a new one at any time.
            </p>
          </CardContent>
        </Collapsible>
      </Card>
    </div>
  )
}
