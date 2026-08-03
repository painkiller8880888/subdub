import { type ZodType } from "zod";

import {
  apiErrorResponseSchema,
  projectCreateRequestSchema,
  projectCreateResponseSchema,
  projectDetailResponseSchema,
  projectListResponseSchema,
  type ApiErrorDetail,
  type ProjectCreateRequest,
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
