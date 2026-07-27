import type { ClassificationPartial, ClassificationProgress } from '@shared/domain/classification'

/**
 * Wording for a sector-classification refresh: its running label and what a failed run still
 * managed to save (Story #105).
 *
 * Pure and component-free so it can be unit-tested — Vitest runs in a Node environment with
 * no jsdom, so nothing that renders is testable (see CLAUDE.md, Testing).
 */

/** Count the lookups off on the button itself; fall back until the first tick arrives. */
export function runningLabel(progress: ClassificationProgress | null): string {
  if (progress === null || progress.total === 0) return 'Classifying…'
  return `Classifying… ${progress.completed} of ${progress.total}`
}

/**
 * What a failed refresh still saved, or `null` when it got nowhere (a closed gateway fails
 * before the first lookup, and has nothing to report). The point is that a partial run is not
 * wasted: those rows are cached, and the next attempt starts from `remaining`.
 */
export function partialProgressNote(partial: ClassificationPartial): string | null {
  const { fetched, remaining } = partial
  if (fetched <= 0) return null

  const saved = `${fetched} instrument${fetched === 1 ? '' : 's'} ${fetched === 1 ? 'was' : 'were'} saved before it stopped`
  return remaining > 0
    ? `${saved} — retrying picks up with the remaining ${remaining}.`
    : `${saved}.`
}
