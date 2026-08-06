import { terminologyPreviewRequestSchema } from "../schema/api.js";
import type { TerminologyTerm } from "../schema/terminology.js";

export type TerminologyPreviewMode = "dictionary" | "literal";

export type TerminologyPreviewRequestDraft = {
  readonly spokenText: string;
  readonly mode: TerminologyPreviewMode;
  readonly excludedTermIds: readonly string[];
};

export type TerminologyPreviewSnapshot = {
  readonly draftKey: string;
  readonly activeTermsKey: string;
};

export function buildTerminologyPreviewRequest(
  draft: TerminologyPreviewRequestDraft
) {
  return terminologyPreviewRequestSchema.parse({
    spokenText: draft.spokenText,
    pronunciation: {
      mode: draft.mode,
      excludedTermIds: [...draft.excludedTermIds]
    }
  });
}

export function areTerminologyPreviewExclusionsDisabled(
  mode: TerminologyPreviewMode
): boolean {
  return mode === "literal";
}

export function getTerminologyPreviewDraftKey(
  draft: TerminologyPreviewRequestDraft
): string {
  return JSON.stringify([
    draft.spokenText,
    draft.mode,
    [...draft.excludedTermIds]
  ]);
}

export function getTerminologyPreviewActiveTermsKey(
  terms: readonly TerminologyTerm[]
): string {
  return JSON.stringify(
    [...terms]
      .sort((left, right) => left.termId.localeCompare(right.termId))
      .map((term) => [
        term.termId,
        term.surface,
        term.normalizedSurface,
        term.readingKatakana,
        term.category,
        term.priority,
        term.notes,
        term.status,
        term.createdAt,
        term.updatedAt
      ])
  );
}

export function isTerminologyPreviewSnapshotCurrent(
  snapshot: TerminologyPreviewSnapshot | null,
  draftKey: string,
  activeTermsKey: string
): boolean {
  return (
    snapshot !== null &&
    snapshot.draftKey === draftKey &&
    snapshot.activeTermsKey === activeTermsKey
  );
}
