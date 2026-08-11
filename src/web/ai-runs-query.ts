import {
  aiRunExportQuerySchema,
  aiRunSearchQuerySchema,
  type AiRunExportQuery,
  type AiRunSearchQuery
} from "../schema/api.js";
import { aiTaskKindSchema } from "../schema/video-project.js";

export const aiRunTaskKinds = aiTaskKindSchema.options;

export type AiRunFilterDraft = {
  readonly from: string;
  readonly to: string;
  readonly taskKind: string;
  readonly modelId: string;
  readonly status: "" | "succeeded" | "failed";
  readonly decision: "" | "accepted" | "rejected" | "undecided";
  readonly errorCode: string;
};

export const emptyAiRunFilterDraft: AiRunFilterDraft = {
  from: "",
  to: "",
  taskKind: "",
  modelId: "",
  status: "",
  decision: "",
  errorCode: ""
};

export const aiRunPageSize = 50;

function parseLocalDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("date must use YYYY-MM-DD");
  }

  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    throw new Error("date is invalid");
  }
  return date;
}

export function localDateToUtcBoundary(
  value: string,
  nextDay = false
): string | undefined {
  if (value === "") {
    return undefined;
  }
  const date = parseLocalDate(value);
  if (nextDay) {
    date.setDate(date.getDate() + 1);
  }
  return date.toISOString();
}

export function buildAiRunSearchQuery(
  draft: AiRunFilterDraft,
  offset = 0
): AiRunSearchQuery {
  return aiRunSearchQuerySchema.parse({
    from: localDateToUtcBoundary(draft.from),
    to: localDateToUtcBoundary(draft.to, true),
    taskKind: draft.taskKind === "" ? undefined : draft.taskKind,
    modelId: draft.modelId.trim() === "" ? undefined : draft.modelId.trim(),
    status: draft.status === "" ? undefined : draft.status,
    decision: draft.decision === "" ? undefined : draft.decision,
    errorCode:
      draft.errorCode.trim() === "" ? undefined : draft.errorCode.trim(),
    limit: aiRunPageSize,
    offset
  });
}

export function buildAiRunExportQuery(
  query: AiRunSearchQuery
): AiRunExportQuery {
  return aiRunExportQuerySchema.parse({
    from: query.from,
    to: query.to,
    taskKind: query.taskKind,
    modelId: query.modelId,
    status: query.status,
    decision: query.decision,
    errorCode: query.errorCode
  });
}
