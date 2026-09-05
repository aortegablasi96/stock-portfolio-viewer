import { isProfileStated } from './assistantLayout'
import { TARGET_DIMENSION_LABELS, type TargetDimension } from '@shared/domain/investorProfileTerms'

/**
 * The profile column's head and its five sections (Story #347, DDR-0115).
 *
 * The design draws the standard as a column with a **head that does not scroll away**: the
 * eyebrow, the title with a count beside it, the intro, and Save / Discard — then the sections
 * below them, scrolling on their own. Until this story all of that was one block inside one
 * scrolling column, so editing a target three sections down meant scrolling back up to find the
 * button that would store it.
 *
 * Here rather than in the component for the reason everything in `lib/` is here: Vitest runs
 * Node-only with no jsdom (DDR-0029), so a word, a class name or a label written inside a
 * component is a decision nothing can assert. What is in this module is exactly the part that
 * decides wording, tone and which section arrives open; the cascade that keeps the head above the
 * scroller is `e2e/investor-profile.spec.ts`'s, which has a layout engine to measure it with.
 *
 * **The count is a fact, not a score** (ADR-0009, ADR-0012, DDR-0109). A profile with no targets
 * is not an incomplete one — it is a portfolio the owner has stated no view on, and the app judges
 * those dimensions against its own published baseline and says whose standard that is. So nothing
 * here reads as *finish your profile*, nothing suggests a target to set, and the pill counts style
 * tags because a count is the one thing that can be said without grading it. That is the same
 * reading the rail's dot takes, and it takes it through the same predicate — {@link
 * isProfileStated} is imported rather than restated, because two answers to "does this profile say
 * anything" are two answers that can disagree.
 *
 * **The pill is the Assistant's own chip** (DDR-0115 amendment 6). The design draws it at a 20px
 * radius with a `--positive-dim` wash; Story #346 already met that shape in the chat header, chose
 * `--radius-pill` over a second way of saying the same corner, and declined the wash because this
 * app has no such token and an unmeasured tint is what DDR-0037 refuses. The chip is that
 * decision's surface, so this column reuses it rather than growing a second pill vocabulary one
 * column over — which also means the chip's inks stay measured once, on the fill they render on.
 */

/** The column's own heading, under the view's eyebrow. */
export const PROFILE_COLUMN_TITLE = 'Investor Profile'

/**
 * The count beside the title: what the *stored* profile says, in tags.
 *
 * Singular at one, which is the design's own format (`figma_design/src/App.tsx:1912`) and the
 * format `profileDotTitle` already uses for the same number in the rail.
 */
export function styleTagPillLabel(styleTagCount: number): string {
  return `${styleTagCount} style tag${styleTagCount === 1 ? '' : 's'}`
}

/**
 * The pill's classes: the chat header's chip, toned by whether anything is stated.
 *
 * `live` and `idle` are the chip's own two quiet tones — the positive ink, and the resting muted
 * one — and both are already measured on `--surface-raised` in `lib/contrast.ts`. The pill draws
 * no dot, so the mark colour those rules also set goes unused here; that is a rule doing less
 * rather than a rule doing something else.
 */
export function styleTagPillClassName(styleTagCount: number): string {
  return `assistant-chip ${isProfileStated(styleTagCount) ? 'assistant-chip-live' : 'assistant-chip-idle'}`
}

/**
 * What Save reads, and how it is drawn, given whether the form states something new.
 *
 * Two states rather than one disabled button, because the design makes the *resting* state say
 * something: `✓ Saved` is the answer to "did that land", standing where the button that landed it
 * was. `isFormDirty` is what chooses between them — the same predicate that has always enabled the
 * button — so the label cannot claim one thing while the control does another.
 *
 * The check mark is drawn beside this label and never inside it: an accessible name of
 * "✓ Saved" reads the glyph out, and the word is the whole of what a reader needs.
 */
export const SAVE_LABELS = { dirty: 'Save profile', clean: 'Saved' } as const

export function saveLabel(dirty: boolean): string {
  return dirty ? SAVE_LABELS.dirty : SAVE_LABELS.clean
}

/**
 * Accent-filled while there is something to store, and quiet once there is not.
 *
 * `primary` is the app's accent fill (DDR-0032) and `secondary` its muted box, which is the pair
 * the design draws. Neither is `className`: colour is the `variant` axis's, always.
 */
export function saveVariant(dirty: boolean): 'primary' | 'secondary' {
  return dirty ? 'primary' : 'secondary'
}

/**
 * Which of the five sections arrives open.
 *
 * The design opens *Investing style* alone (`figma_design/src/App.tsx:1965`, and `defaultOpen:
 * false` on the four below it). `Collapsible`'s own default is open, and its stated reason — a
 * section that hides its content unasked is lost — still holds for a page of two or three
 * disclosures; this is a column of five in a 420px frame, where all five open is a scroller that
 * has to be walked before the shape of the thing is visible at all. The primitive's default is
 * untouched: these are call sites opting out of it (DDR-0106).
 *
 * Style is the one left open because it is the only section that needs no target typed into it —
 * a tag is one click, and it is the part of the profile the rail's dot and the head's pill both
 * report.
 */
export const SECTION_OPEN_ON_ARRIVAL = false

/**
 * The head-row actions, and the mark the design puts in front of them.
 *
 * The `+` is drawn `aria-hidden` beside the word rather than written into it: a screen reader
 * announcing "plus add target" is reading punctuation, and the button's name is what tells eight
 * of these apart. Same argument as the check mark on Save.
 */
export const ADD_MARK = '+'

export const ADD_TARGET_LABEL = 'Add target'
export const ADD_LIMIT_LABEL = 'Add limit'
export const REMOVE_LIMIT_LABEL = 'Remove limit'

/**
 * What a dimension with no targets says.
 *
 * A **statement**, never a prompt: an unset dimension is a valid profile, and the app fills that
 * silence with its own baseline and says so beside the claim (ADR-0012, DDR-0109). "No policy
 * stated here" is the design's own wording and it is the right one — it describes what is true
 * rather than what is missing.
 */
export function emptyTargetsText(dimension: TargetDimension): string {
  return `No ${TARGET_DIMENSION_LABELS[dimension].toLowerCase()} targets — no policy stated here.`
}

export const EMPTY_POSITION_TEXT = 'No position limit — no policy stated here.'

/**
 * The clear row, which is a row rather than a disclosure (`figma_design/src/App.tsx:2084-2120`).
 *
 * The other five sections fold because each holds a form; this holds one button, so a fold would
 * hide a control behind a click that reveals nothing else. What it keeps is `ConfirmAction`:
 * DDR-0115 amendment 5 took the confirm off Clear chat because a transcript is session state, and
 * a profile is **stored** — so the in-place confirm stays exactly where DDR-0012 put it, inside
 * the design's negative-bordered frame.
 */
export const CLEAR_ROW = {
  title: 'Clear the profile',
  explanation:
    'Leaves the app with no standard to measure your portfolio against, which is where it started. You can state a new one at any time.',
  action: 'Clear profile',
  confirm: 'Yes, clear my profile',
  busy: 'Clearing…',
  warning:
    'This removes every style tag and target. Your holdings, snapshots and imported statements are untouched.',
} as const
