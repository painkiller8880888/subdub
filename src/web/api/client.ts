import { type ZodType } from "zod";

import {
  apiErrorResponseSchema,
  outlineApproveRequestSchema,
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
  scriptInitializeRequestSchema,
  scriptSaveRequestSchema,
  type ApiErrorDetail,
  type OutlineApproveRequest,
  type OutlineGenerateRequest,
  type OutlineReviewRequest,
  type OutlineSaveRequest,
  type ProjectBriefSaveRequest,
  type ProjectCreateRequest,
  type ModelsResponse,
  type ProjectSourceContent,
  type ProjectSourceSaveRequest,
  type ScriptInitializeRequest,
  type ScriptSaveRequest,
  type ProjectSummary
} from "../../schema/api.js";
import type { VideoProject } from "../../schema/video-project.js";

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

async function readJson(response: FetchResponse): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new ApiClientProtocolError();
  }
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
