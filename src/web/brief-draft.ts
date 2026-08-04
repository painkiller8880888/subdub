import type { ProjectBrief } from "../schema/index.js";

export type BriefDraft = Omit<ProjectBrief, "targetDurationSec"> & {
  targetDurationSec: string;
  markdown: string;
};

type BriefDraftFields = Omit<BriefDraft, "markdown">;

function briefFields(draft: BriefDraft): BriefDraftFields {
  return {
    audience: draft.audience,
    postViewingGoal: draft.postViewingGoal,
    prerequisites: draft.prerequisites,
    targetDurationSec: draft.targetDurationSec,
    requiredItems: draft.requiredItems,
    prohibitedItems: draft.prohibitedItems,
    globalDirectives: draft.globalDirectives
  };
}

export function sameBriefDraft(first: BriefDraft, second: BriefDraft): boolean {
  return (
    JSON.stringify(briefFields(first)) === JSON.stringify(briefFields(second))
  );
}
