import { projectMutationResponseSchema } from "../../schema/api.js";
import {
  outlineApproveRequestSchema,
  outlineGenerateRequestSchema,
  outlineRejectRequestSchema,
  outlineReviewRequestSchema,
  outlineSaveRequestSchema,
  projectBriefSaveRequestSchema,
  projectSourceReadResponseSchema,
  projectSourceSaveRequestSchema,
  scriptApproveRequestSchema,
  scriptInitializeRequestSchema,
  type OutlineApproveRequest,
  type OutlineGenerateRequest,
  type OutlineRejectRequest,
  type OutlineReviewRequest,
  type OutlineSaveRequest,
  type ProjectBriefSaveRequest,
  type ProjectSourceContent,
  type ProjectSourceSaveRequest,
  type ScriptApproveRequest,
  type ScriptInitializeRequest
} from "../../schema/legacy-api.js";
import type { VideoProject } from "../../schema/video-project.js";
import { fetchApi } from "./api-client";

/**
 * Client calls for the retired planning workflow. The standard API client
 * intentionally does not export these functions; PC-05 can remove this
 * module with the legacy planning screens without changing current clients.
 */

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
