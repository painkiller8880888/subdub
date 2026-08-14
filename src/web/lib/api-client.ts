import { type ZodType } from "zod";

import {
  apiErrorResponseSchema,
  aiRunExportQuerySchema,
  aiRunSearchQuerySchema,
  aiRunSearchResponseSchema,
  assetListQuerySchema,
  assetListResponseSchema,
  characterVisualCatalogResponseSchema,
  outlineApproveRequestSchema,
  outlineRejectRequestSchema,
  outlineGenerateRequestSchema,
  outlineReviewRequestSchema,
  outlineSaveRequestSchema,
  modelsResponseSchema,
  projectBriefSaveRequestSchema,
  projectCreateRequestSchema,
  projectCreateResponseSchema,
  projectDetailResponseSchema,
  projectListResponseSchema,
  projectMutationResponseSchema,
  projectSourceReadResponseSchema,
  projectSourceSaveRequestSchema,
  scriptApproveRequestSchema,
  scriptInitializeRequestSchema,
  scriptSaveRequestSchema,
  terminologyCreateRequestSchema,
  terminologyListQuerySchema,
  terminologyListResponseSchema,
  terminologyPreviewRequestSchema,
  terminologyPreviewResponseSchema,
  terminologyTermParamsSchema,
  terminologyTermResponseSchema,
  terminologyUpdateRequestSchema,
  visualAssignmentDeleteRequestSchema,
  visualAssignmentRequestSchema,
  visualAssignmentResponseSchema,
  visualAssignmentUpdateRequestSchema,
  visualApprovalRequestSchema,
  assetDetailResponseSchema,
  visualSuggestionRequestSchema,
  visualSuggestionResponseSchema,
  visualSuggestionCandidateRejectRequestSchema,
  visualSuggestionCandidateRejectParamsSchema,
  improvementDecisionResponseSchema,
  manifestPreviewResponseSchema,
  voiceAdjustmentMutationResponseSchema,
  voiceAdjustmentPreviewRequestSchema,
  voiceAdjustmentPreviewResponseSchema,
  voiceAdjustmentResetResponseSchema,
  voiceAdjustmentSaveRequestSchema,
  voiceAdjustmentSnapshotResponseSchema,
  voiceGenerateRequestSchema,
  voiceGenerationAcceptedResponseSchema,
  voiceGenerationStatusResponseSchema,
  type ApiErrorDetail,
  type AiRunExportQuery,
  type AiRunSearchData,
  type AiRunSearchQuery,
  type OutlineApproveRequest,
  type OutlineRejectRequest,
  type OutlineGenerateRequest,
  type OutlineReviewRequest,
  type OutlineSaveRequest,
  type ProjectBriefSaveRequest,
  type ProjectCreateRequest,
  type ModelsResponse,
  type ProjectSourceContent,
  type ProjectSourceSaveRequest,
  type ScriptApproveRequest,
  type ScriptInitializeRequest,
  type ScriptSaveRequest,
  type ProjectSummary,
  type TerminologyCreateRequest,
  type TerminologyListQuery,
  type TerminologyPreviewRequest,
  type TerminologyPreviewResult,
  type TerminologyUpdateRequest,
  type VisualSuggestionRequest,
  type VisualSuggestionResponse,
  type VisualSuggestionCandidateRejectRequest,
  type ImprovementDecisionResponse,
  type VisualAssignmentRequest,
  type VisualAssignmentUpdateRequest,
  type VisualAssignmentDeleteRequest,
  type VisualApprovalRequest,
  type VoiceAdjustmentPreviewRequest,
  type VoiceAdjustmentSaveRequest,
  type VoiceAdjustmentSnapshot,
  type VoiceGenerateRequest,
  type VoiceGenerationAccepted,
  type VoiceGenerationStatusData,
  type ManifestPreviewData
} from "../../schema/api.js";
import type { TerminologyTerm } from "../../schema/terminology.js";
import type { AssetListResult } from "../../schema/asset.js";
import type { AssetDetail } from "../../schema/asset.js";
import type { VideoProject } from "../../schema/video-project.js";
import type { CharacterVisualCatalogSnapshot } from "../../schema/character-visual.js";

export type ApiClientErrorData = {
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly details: ApiErrorDetail[];
  readonly requestId: string;
};

export class ApiClientError extends Error {
  readonly data: ApiClientErrorData;
  readonly status: number;
  readonly code: string;
  readonly details: ApiErrorDetail[];
  readonly requestId: string;

  constructor(data: ApiClientErrorData) {
    super(data.message);
    this.name = "ApiClientError";
    this.data = {
      ...data,
      details: data.details.map((detail) => ({
        path: [...detail.path],
        message: detail.message
      }))
    };
    this.status = this.data.status;
    this.code = this.data.code;
    this.details = this.data.details;
    this.requestId = this.data.requestId;
  }
}

export class ApiClientProtocolError extends Error {
  constructor() {
    super("APIとの通信または応答形式の確認に失敗しました。");
    this.name = "ApiClientProtocolError";
  }
}

type FetchInit = Parameters<typeof fetch>[1];
type FetchResponse = Awaited<ReturnType<typeof fetch>>;

export const defaultAiRunExportFilename = "subdub-ai-runs.jsonl";

async function readJson(response: FetchResponse): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new ApiClientProtocolError();
  }
}

function throwApiClientError(response: FetchResponse, body: unknown): never {
  const parsedError = apiErrorResponseSchema.safeParse(body);
  if (!parsedError.success) {
    throw new ApiClientProtocolError();
  }

  throw new ApiClientError({
    status: response.status,
    code: parsedError.data.error.code,
    message: parsedError.data.error.message,
    details: parsedError.data.error.details,
    requestId: parsedError.data.error.requestId
  });
}

function createAiRunFilterParams(
  query: AiRunSearchQuery | AiRunExportQuery
): URLSearchParams {
  const params = new URLSearchParams();
  if (query.from !== undefined) {
    params.set("from", query.from);
  }
  if (query.to !== undefined) {
    params.set("to", query.to);
  }
  if (query.taskKind !== undefined) {
    params.set("taskKind", query.taskKind);
  }
  if (query.modelId !== undefined) {
    params.set("modelId", query.modelId);
  }
  if (query.status !== undefined) {
    params.set("status", query.status);
  }
  if (query.decision !== undefined) {
    params.set("decision", query.decision);
  }
  if (query.errorCode !== undefined) {
    params.set("errorCode", query.errorCode);
  }
  return params;
}

function parseExportFilename(contentDisposition: string | null): string {
  const match = contentDisposition?.match(
    /(?:^|;)\s*filename=(?:"([^"]+)"|([^;]+))/i
  );
  const filename = (match?.[1] ?? match?.[2] ?? "").trim();
  const hasUnsafeFilenameCharacter = [...filename].some((character) => {
    const code = character.charCodeAt(0);
    return (
      character === "\\" || character === "/" || code <= 0x1f || code === 0x7f
    );
  });
  if (filename.length === 0 || hasUnsafeFilenameCharacter) {
    return defaultAiRunExportFilename;
  }
  return filename;
}

export async function fetchApi<T>(
  input: string,
  responseSchema: ZodType<T>,
  init?: FetchInit
): Promise<T> {
  let response: FetchResponse;
  try {
    response = await fetch(input, init);
  } catch {
    throw new ApiClientProtocolError();
  }

  const body = await readJson(response);

  if (!response.ok) {
    throwApiClientError(response, body);
  }

  const parsedResponse = responseSchema.safeParse(body);
  if (!parsedResponse.success) {
    throw new ApiClientProtocolError();
  }

  return parsedResponse.data;
}

export async function fetchProjects(): Promise<ProjectSummary[]> {
  const response = await fetchApi("/api/projects", projectListResponseSchema);
  return response.data;
}

export async function searchAiRuns(
  input: AiRunSearchQuery = { limit: 50, offset: 0 }
): Promise<AiRunSearchData> {
  const query = aiRunSearchQuerySchema.parse(input);
  const params = createAiRunFilterParams(query);
  params.set("limit", String(query.limit));
  params.set("offset", String(query.offset));

  const response = await fetchApi(
    `/api/ai-runs?${params.toString()}`,
    aiRunSearchResponseSchema
  );
  return response.data;
}

export type AiRunExportDownload = {
  readonly blob: Blob;
  readonly filename: string;
};

export async function exportAiRuns(
  input: AiRunExportQuery = {}
): Promise<AiRunExportDownload> {
  const query = aiRunExportQuerySchema.parse(input);
  const params = createAiRunFilterParams(query);

  let response: FetchResponse;
  try {
    const queryString = params.toString();
    response = await fetch(
      `/api/ai-runs/export${queryString.length > 0 ? `?${queryString}` : ""}`
    );
  } catch {
    throw new ApiClientProtocolError();
  }

  if (!response.ok) {
    const body = await readJson(response);
    throwApiClientError(response, body);
  }

  let blob: Blob;
  try {
    blob = await response.blob();
  } catch {
    throw new ApiClientProtocolError();
  }

  return {
    blob,
    filename: parseExportFilename(response.headers.get("content-disposition"))
  };
}

export async function fetchModels(
  options: { refresh?: boolean } = {}
): Promise<ModelsResponse["data"]> {
  const query = options.refresh === true ? "?refresh=true" : "";
  const response = await fetchApi(`/api/models${query}`, modelsResponseSchema);
  return response.data;
}

export async function createProject(
  input: ProjectCreateRequest
): Promise<VideoProject> {
  const validatedInput = projectCreateRequestSchema.parse(input);
  const response = await fetchApi(
    "/api/projects",
    projectCreateResponseSchema,
    {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(validatedInput)
    }
  );
  return response.data;
}

export async function fetchProject(projectId: string): Promise<VideoProject> {
  const response = await fetchApi(
    `/api/projects/${encodeURIComponent(projectId)}`,
    projectDetailResponseSchema
  );
  return response.data;
}

export async function fetchCharacterVisualCatalog(): Promise<CharacterVisualCatalogSnapshot> {
  const response = await fetchApi(
    "/api/character-visuals",
    characterVisualCatalogResponseSchema
  );
  return response.data;
}

export async function fetchProjectManifest(
  projectId: string
): Promise<ManifestPreviewData> {
  const response = await fetchApi(
    `/api/projects/${encodeURIComponent(projectId)}/manifest`,
    manifestPreviewResponseSchema
  );
  return response.data;
}

export async function fetchProjectSource(
  projectId: string
): Promise<ProjectSourceContent & { revision: number }> {
  const response = await fetchApi(
    `/api/projects/${encodeURIComponent(projectId)}/source`,
    projectSourceReadResponseSchema
  );
  return { ...response.data, revision: response.revision };
}

export async function saveProjectSource(
  projectId: string,
  input: ProjectSourceSaveRequest
): Promise<VideoProject> {
  const validatedInput = projectSourceSaveRequestSchema.parse(input);
  const response = await fetchApi(
    `/api/projects/${encodeURIComponent(projectId)}/source`,
    projectMutationResponseSchema,
    {
      method: "PUT",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(validatedInput)
    }
  );
  return response.data;
}

export async function saveProjectBrief(
  projectId: string,
  input: ProjectBriefSaveRequest
): Promise<VideoProject> {
  const validatedInput = projectBriefSaveRequestSchema.parse(input);
  const response = await fetchApi(
    `/api/projects/${encodeURIComponent(projectId)}/brief`,
    projectMutationResponseSchema,
    {
      method: "PUT",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(validatedInput)
    }
  );
  return response.data;
}

export async function generateProjectOutline(
  projectId: string,
  input: OutlineGenerateRequest
): Promise<VideoProject> {
  const validatedInput = outlineGenerateRequestSchema.parse(input);
  const response = await fetchApi(
    `/api/projects/${encodeURIComponent(projectId)}/outline/generate`,
    projectMutationResponseSchema,
    {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(validatedInput)
    }
  );
  return response.data;
}

export async function saveProjectOutline(
  projectId: string,
  input: OutlineSaveRequest
): Promise<VideoProject> {
  const validatedInput = outlineSaveRequestSchema.parse(input);
  const response = await fetchApi(
    `/api/projects/${encodeURIComponent(projectId)}/outline`,
    projectMutationResponseSchema,
    {
      method: "PUT",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(validatedInput)
    }
  );
  return response.data;
}

export async function approveProjectOutline(
  projectId: string,
  input: OutlineApproveRequest
): Promise<VideoProject> {
  const validatedInput = outlineApproveRequestSchema.parse(input);
  const response = await fetchApi(
    `/api/projects/${encodeURIComponent(projectId)}/outline/approve`,
    projectMutationResponseSchema,
    {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(validatedInput)
    }
  );
  return response.data;
}

export async function rejectProjectOutline(
  projectId: string,
  input: OutlineRejectRequest
): Promise<VideoProject> {
  const validatedInput = outlineRejectRequestSchema.parse(input);
  const response = await fetchApi(
    `/api/projects/${encodeURIComponent(projectId)}/outline/reject`,
    projectMutationResponseSchema,
    {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(validatedInput)
    }
  );
  return response.data;
}

export async function reviewProjectOutline(
  projectId: string,
  input: OutlineReviewRequest
): Promise<VideoProject> {
  const validatedInput = outlineReviewRequestSchema.parse(input);
  const response = await fetchApi(
    `/api/projects/${encodeURIComponent(projectId)}/outline/review`,
    projectMutationResponseSchema,
    {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(validatedInput)
    }
  );
  return response.data;
}

export async function initializeProjectScript(
  projectId: string,
  input: ScriptInitializeRequest
): Promise<VideoProject> {
  const validatedInput = scriptInitializeRequestSchema.parse(input);
  const response = await fetchApi(
    `/api/projects/${encodeURIComponent(projectId)}/script/initialize`,
    projectMutationResponseSchema,
    {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(validatedInput)
    }
  );
  return response.data;
}

export async function saveProjectScript(
  projectId: string,
  input: ScriptSaveRequest
): Promise<VideoProject> {
  const validatedInput = scriptSaveRequestSchema.parse(input);
  const response = await fetchApi(
    `/api/projects/${encodeURIComponent(projectId)}/script`,
    projectMutationResponseSchema,
    {
      method: "PUT",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(validatedInput)
    }
  );
  return response.data;
}

export async function approveProjectScript(
  projectId: string,
  input: ScriptApproveRequest
): Promise<VideoProject> {
  const validatedInput = scriptApproveRequestSchema.parse(input);
  const response = await fetchApi(
    `/api/projects/${encodeURIComponent(projectId)}/script/approve`,
    projectMutationResponseSchema,
    {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(validatedInput)
    }
  );
  return response.data;
}

export async function generateProjectVoice(
  projectId: string,
  input: VoiceGenerateRequest
): Promise<VoiceGenerationAccepted> {
  const validatedInput = voiceGenerateRequestSchema.parse(input);
  const response = await fetchApi(
    `/api/projects/${encodeURIComponent(projectId)}/voice/generate`,
    voiceGenerationAcceptedResponseSchema,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validatedInput)
    }
  );
  return response.data;
}

export async function generateAllProjectVoice(
  projectId: string
): Promise<VoiceGenerationAccepted> {
  const response = await fetchApi(
    `/api/projects/${encodeURIComponent(projectId)}/voice/generate-all`,
    voiceGenerationAcceptedResponseSchema,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({})
    }
  );
  return response.data;
}

export async function fetchProjectVoiceStatus(
  projectId: string
): Promise<VoiceGenerationStatusData> {
  const response = await fetchApi(
    `/api/projects/${encodeURIComponent(projectId)}/voice/status`,
    voiceGenerationStatusResponseSchema
  );
  return response.data;
}

export async function fetchProjectVoiceAdjustment(
  projectId: string,
  lineId: string
): Promise<VoiceAdjustmentSnapshot> {
  const response = await fetchApi(
    `/api/projects/${encodeURIComponent(projectId)}/voice/adjustments/${encodeURIComponent(lineId)}`,
    voiceAdjustmentSnapshotResponseSchema
  );
  return response.data;
}

export async function saveProjectVoiceAdjustment(
  projectId: string,
  lineId: string,
  input: VoiceAdjustmentSaveRequest
): Promise<VoiceAdjustmentSnapshot> {
  const validatedInput = voiceAdjustmentSaveRequestSchema.parse(input);
  const response = await fetchApi(
    `/api/projects/${encodeURIComponent(projectId)}/voice/adjustments/${encodeURIComponent(lineId)}`,
    voiceAdjustmentSnapshotResponseSchema,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validatedInput)
    }
  );
  return response.data;
}

export async function previewProjectVoiceAdjustment(
  projectId: string,
  lineId: string,
  input: VoiceAdjustmentPreviewRequest
): Promise<{ readonly previewId: string }> {
  const validatedInput = voiceAdjustmentPreviewRequestSchema.parse(input);
  const response = await fetchApi(
    `/api/projects/${encodeURIComponent(projectId)}/voice/adjustments/${encodeURIComponent(lineId)}/preview`,
    voiceAdjustmentPreviewResponseSchema,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validatedInput)
    }
  );
  return response.data;
}

export function projectVoiceAdjustmentPreviewUrl(
  projectId: string,
  lineId: string,
  previewId: string
): string {
  return `/api/projects/${encodeURIComponent(projectId)}/voice/adjustments/${encodeURIComponent(lineId)}/preview/${encodeURIComponent(previewId)}`;
}

export async function discardProjectVoiceAdjustment(
  projectId: string,
  lineId: string
): Promise<string> {
  const response = await fetchApi(
    `/api/projects/${encodeURIComponent(projectId)}/voice/adjustments/${encodeURIComponent(lineId)}`,
    voiceAdjustmentMutationResponseSchema,
    {
      method: "DELETE"
    }
  );
  return response.data.lineId;
}

export async function resetProjectVoiceAdjustments(
  projectId: string
): Promise<readonly string[]> {
  const response = await fetchApi(
    `/api/projects/${encodeURIComponent(projectId)}/voice/adjustments`,
    voiceAdjustmentResetResponseSchema,
    {
      method: "DELETE"
    }
  );
  return response.data.resetLineIds;
}

export async function suggestProjectVisuals(
  projectId: string,
  input: VisualSuggestionRequest
): Promise<VisualSuggestionResponse> {
  const validatedInput = visualSuggestionRequestSchema.parse(input);
  return fetchApi(
    `/api/projects/${encodeURIComponent(projectId)}/visual-suggestions`,
    visualSuggestionResponseSchema,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validatedInput)
    }
  );
}

export async function assignProjectVisual(
  projectId: string,
  input: VisualAssignmentRequest
): Promise<VideoProject> {
  const validatedInput = visualAssignmentRequestSchema.parse(input);
  const response = await fetchApi(
    `/api/projects/${encodeURIComponent(projectId)}/visual-assignments`,
    visualAssignmentResponseSchema,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validatedInput)
    }
  );
  return response.data;
}

export async function rejectProjectVisualSuggestionCandidate(
  projectId: string,
  runId: string,
  assetId: string,
  input: VisualSuggestionCandidateRejectRequest
): Promise<ImprovementDecisionResponse> {
  const params = visualSuggestionCandidateRejectParamsSchema.parse({
    runId,
    assetId
  });
  const validatedInput =
    visualSuggestionCandidateRejectRequestSchema.parse(input);
  return fetchApi(
    `/api/projects/${encodeURIComponent(projectId)}/visual-suggestions/${encodeURIComponent(params.runId)}/candidates/${encodeURIComponent(params.assetId)}/reject`,
    improvementDecisionResponseSchema,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validatedInput)
    }
  );
}

export async function updateProjectVisualAssignment(
  projectId: string,
  assignmentId: string,
  input: VisualAssignmentUpdateRequest
): Promise<VideoProject> {
  const validatedInput = visualAssignmentUpdateRequestSchema.parse(input);
  const response = await fetchApi(
    `/api/projects/${encodeURIComponent(projectId)}/visual-assignments/${encodeURIComponent(assignmentId)}`,
    visualAssignmentResponseSchema,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validatedInput)
    }
  );
  return response.data;
}

export async function deleteProjectVisualAssignment(
  projectId: string,
  assignmentId: string,
  input: VisualAssignmentDeleteRequest
): Promise<VideoProject> {
  const validatedInput = visualAssignmentDeleteRequestSchema.parse(input);
  const response = await fetchApi(
    `/api/projects/${encodeURIComponent(projectId)}/visual-assignments/${encodeURIComponent(assignmentId)}`,
    visualAssignmentResponseSchema,
    {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validatedInput)
    }
  );
  return response.data;
}

export async function approveProjectVisuals(
  projectId: string,
  input: VisualApprovalRequest
): Promise<VideoProject> {
  const validatedInput = visualApprovalRequestSchema.parse(input);
  const response = await fetchApi(
    `/api/projects/${encodeURIComponent(projectId)}/visuals/approve`,
    visualAssignmentResponseSchema,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validatedInput)
    }
  );
  return response.data;
}

export async function fetchAsset(assetId: string): Promise<AssetDetail> {
  const response = await fetchApi(
    `/api/assets/${encodeURIComponent(assetId)}`,
    assetDetailResponseSchema
  );
  return response.data;
}

export async function searchAssets(
  input: unknown = {}
): Promise<AssetListResult> {
  const query = assetListQuerySchema.parse(input);
  const searchParams = new URLSearchParams();
  if (query.q !== undefined) {
    searchParams.set("q", query.q);
  }
  if (query.kind !== undefined) {
    searchParams.set("kind", query.kind);
  }
  if (query.department !== undefined) {
    searchParams.set("department", query.department);
  }
  if (query.system !== undefined) {
    searchParams.set("system", query.system);
  }
  if (query.status !== undefined) {
    searchParams.set("status", query.status);
  }
  for (const tagId of query.tagIds) {
    searchParams.append("tagIds", tagId);
  }
  searchParams.set("page", String(query.page));
  searchParams.set("pageSize", String(query.pageSize));
  const response = await fetchApi(
    `/api/assets?${searchParams.toString()}`,
    assetListResponseSchema
  );
  return response.data;
}

export async function fetchTerminology(
  input: TerminologyListQuery = {}
): Promise<TerminologyTerm[]> {
  const query = terminologyListQuerySchema.parse(input);
  const searchParams = new URLSearchParams();
  if (query.surface !== undefined) {
    searchParams.set("surface", query.surface);
  }
  if (query.reading !== undefined) {
    searchParams.set("reading", query.reading);
  }
  if (query.category !== undefined) {
    searchParams.set("category", query.category);
  }
  if (query.status !== undefined) {
    searchParams.set("status", query.status);
  }
  const queryString = searchParams.toString();
  const response = await fetchApi(
    `/api/terminology${queryString.length > 0 ? `?${queryString}` : ""}`,
    terminologyListResponseSchema
  );
  return response.data;
}

export async function previewTerminology(
  input: TerminologyPreviewRequest
): Promise<TerminologyPreviewResult> {
  const validatedInput = terminologyPreviewRequestSchema.parse(input);
  const response = await fetchApi(
    "/api/terminology/preview",
    terminologyPreviewResponseSchema,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validatedInput)
    }
  );
  return response.data;
}

export async function fetchTerminologyTerm(
  termId: string
): Promise<TerminologyTerm> {
  const params = terminologyTermParamsSchema.parse({ termId });
  const response = await fetchApi(
    `/api/terminology/${encodeURIComponent(params.termId)}`,
    terminologyTermResponseSchema
  );
  return response.data;
}

export async function createTerminology(
  input: TerminologyCreateRequest
): Promise<TerminologyTerm> {
  const validatedInput = terminologyCreateRequestSchema.parse(input);
  const response = await fetchApi(
    "/api/terminology",
    terminologyTermResponseSchema,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validatedInput)
    }
  );
  return response.data;
}

export async function updateTerminology(
  termId: string,
  input: TerminologyUpdateRequest
): Promise<TerminologyTerm> {
  const params = terminologyTermParamsSchema.parse({ termId });
  const validatedInput = terminologyUpdateRequestSchema.parse(input);
  const response = await fetchApi(
    `/api/terminology/${encodeURIComponent(params.termId)}`,
    terminologyTermResponseSchema,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validatedInput)
    }
  );
  return response.data;
}

export async function deactivateTerminology(
  termId: string
): Promise<TerminologyTerm> {
  return changeTerminologyStatus(termId, "deactivate");
}

export async function activateTerminology(
  termId: string
): Promise<TerminologyTerm> {
  return changeTerminologyStatus(termId, "activate");
}

async function changeTerminologyStatus(
  termId: string,
  action: "activate" | "deactivate"
): Promise<TerminologyTerm> {
  const params = terminologyTermParamsSchema.parse({ termId });
  const response = await fetchApi(
    `/api/terminology/${encodeURIComponent(params.termId)}/${action}`,
    terminologyTermResponseSchema,
    { method: "POST" }
  );
  return response.data;
}
