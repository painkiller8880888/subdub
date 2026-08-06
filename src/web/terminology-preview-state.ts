import { terminologyPreviewRequestSchema } from "../schema/api.js";

export type TerminologyPreviewMode = "dictionary" | "literal";

export type TerminologyPreviewRequestDraft = {
  readonly spokenText: string;
  readonly mode: TerminologyPreviewMode;
  readonly excludedTermIds: readonly string[];
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
