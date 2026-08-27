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
import { OWNER_SOURCE } from '../lib/pageHeader'
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
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card'
import { Field } from './ui/Field'
import { PageHeader } from './ui/PageHeader'
import { PercentInput } from './ui/PercentInput'
import { StatePanel } from './ui/StatePanel'
import { ToggleGroup } from './ui/ToggleGroup'

/**
 * The Profile view: where the owner states how they intend to invest (Story #280, DDR-0094).
 *
 * It is the app's **sixth sidebar row and its first non-analytics one**, and that placement is a
 * decision the story left open (DDR-0094). The profile is a page — five sections, a form, an
 * owner-confirmed reset — not a preference behind a gear, and the sidebar is already a complete,
 * tested, accessible way to reach a page (DDR-0029, DDR-0055). It takes the *last* row so the
 * five data views stay contiguous, and needs no change to the accelerators: `viewShortcutIndex`
 * has always covered digits 1–9 and derives a row's binding from its index (DDR-0083).
 *
 * It is **not** an `AnalyticsShell` view and deliberately declares its own `<main>` and `<h1>`.
 * The shell exists for the four-branch `loading | error | needs_import | loaded` guard every
 * analytics view answers (DDR-0043), and this page answers none of it: its content is a form the
 * owner can fill in with nothing imported at all. What it does share is the one page header
 * (DDR-0058), whose provenance slot carries a third sentence — `OWNER_SOURCE`, the first that
 * names no data source, because this page has none.
 *
 * **Nothing about the profile reaches the model here.** It is stored and shown; who reads it is a
 * later story's concern, and the only thing this view sends anywhere is an IPC call to the local
 * main process.
 *
 * Two pieces of state, kept apart on purpose. `stored` is what is in `app_meta`; `form` is what
 * the owner has typed since. Comparing them is what `Save` is enabled by, and keeping the form
 * rather than re-seeding it after every keystroke is what lets a half-finished profile survive a
 * trip to Allocation and back — this view stays mounted like every other (DDR-0027).
 */

/** Stable across renders, so `useAnalytics`'s reload effect is not re-armed every time. */
const fetchAllocation = (): Promise<AllocationResult> => window.api.getAllocation()

/** What the owner is told after a write, and in which tone. */
type Notice = { tone: 'ok' | 'error'; message: string }

export function ProfileView(): React.JSX.Element {
  const [stored, setStored] = useState<InvestorProfile | null>(null)
  const [form, setForm] = useState<ProfileFormState>(() =>
    formFromProfile(EMPTY_INVESTOR_PROFILE),
  )
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)

  /**
   * The vocabularies, over the *existing* allocation channel rather than one of this view's own.
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
    })
    return () => {
      live = false
    }
  }, [])

  const seat = useCallback((profile: InvestorProfile, message: string): void => {
    setStored(profile)
    setForm(formFromProfile(profile))
    setNotice({ tone: 'ok', message })
  }, [])

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
      <main className="dashboard">
        <PageHeader title="Investor profile" source={OWNER_SOURCE} />
        <StatePanel variant="loading">Loading your profile…</StatePanel>
      </main>
    )
  }

  const dirty = isFormDirty(form, stored)
  const valid = isFormValid(form)
  const band = form.positionSize
  const bandIssue = positionIssue(band)

  return (
    <main className="dashboard">
      <PageHeader
        title="Investor profile"
        source={OWNER_SOURCE}
        loadedAt={stored.updatedAt}
        action={
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
        }
      />

      <div className="analytics-view">
        {/* What this page is, what it currently says, and how the last write went — one block,
            because all three are statements about the profile as a whole rather than about any
            section below. The count in particular was in the first card's header for one round and
            read as a fact about *investing style*; it is a fact about the page. */}
        <div className="profile-intro-block">
          {/* It says "you" three times on purpose: the standard is the owner's, and the app
              measuring against a standard it invented is the one thing ADR-0009 does not
              license. */}
          <p className="profile-intro">
            Your own policy for how this portfolio should be invested. Nothing here is required —
            state only what you have a view on, and the parts you leave blank stay unmeasured.
            Later views compare your holdings against what you set here; the app never proposes a
            policy of its own.
          </p>
          <p className="profile-summary">{profileSummary(stored)}</p>
          {/* The write's outcome, announced. `role="status"` rather than `alert` even for a
              failure: the owner pressed Save and is looking at the button, so this is a reply
              rather than an interruption. */}
          <p
            className={`profile-notice ${notice?.tone === 'error' ? 'profile-notice-error' : ''}`}
            role="status"
          >
            {notice?.message ?? ''}
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Investing style</CardTitle>
          </CardHeader>
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
          <CardHeader>
            <CardTitle>Single position size</CardTitle>
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
          </CardHeader>
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
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Clear the profile</CardTitle>
            {/* The in-place confirm the app uses for every destructive action — no modal, no
                `window.confirm` (DDR-0012). It is not ADR-0006's sanctioned reset: nothing
                append-only is touched, because a profile is a setting rather than history. */}
            <ConfirmAction
              label="Clear profile"
              confirmLabel="Yes, clear my profile"
              busyLabel="Clearing…"
              warning="This removes every style tag and target. Your holdings, snapshots and imported statements are untouched."
              onConfirm={clear}
            />
          </CardHeader>
          <CardContent>
            <p className="profile-lede">
              Leaves the app with no standard to measure your portfolio against, which is where it
              started. You can state a new one at any time.
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
