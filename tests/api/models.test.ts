import { promises as fs } from "node:fs";
import { PassThrough } from "node:stream";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../../src/api/app.js";
import { mapApiError } from "../../src/api/errors/api-error.js";
import {
  OpenRouterAdapterError,
  OPENROUTER_ERROR_CODE
} from "../../src/openrouter/errors.js";
import { OpenRouterModelService } from "../../src/openrouter/model-service.js";
import { initializeServer } from "../../src/api/server.js";
import {
  apiErrorResponseSchema,
  modelsResponseSchema
} from "../../src/schema/api.js";

function modelList() {
  return {
    models: [
      {
        id: "eligible/model",
        displayName: "Eligible Model",
        contextLength: 8192,
        inputPrice: "0.000001",
        outputPrice: "0.000002",
        outputModalities: ["text"],
        supportedParameters: ["structured_outputs"],
        expirationDate: null,
        structuredOutputs: true,
        zdrAvailable: true
      },
      {
        id: "no-structured/model",
        displayName: "No Structured Model",
        contextLength: 8192,
        inputPrice: "0.1",
        outputPrice: "0.2",
        outputModalities: ["text"],
        supportedParameters: ["max_tokens"],
        expirationDate: null,
        structuredOutputs: false,
        zdrAvailable: true
      },
      {
        id: "image-only/model",
        displayName: "Image Only Model",
        contextLength: 8192,
        inputPrice: "0.1",
        outputPrice: "0.2",
        outputModalities: ["image"],
        supportedParameters: ["structured_outputs"],
        expirationDate: null,
        structuredOutputs: true,
        zdrAvailable: true
      },
      {
        id: "expired/model",
        displayName: "Expired Model",
        contextLength: 8192,
        inputPrice: "0.1",
        outputPrice: "0.2",
        outputModalities: ["text"],
        supportedParameters: ["structured_outputs"],
        expirationDate: "2020-01-01T00:00:00.000Z",
        structuredOutputs: true,
        zdrAvailable: true
      }
    ],
    fetchedAt: "2026-08-04T00:00:00.000Z",
    cached: false
  } as const;
}

describe("models API", () => {
  const apps: Array<Awaited<ReturnType<typeof buildApp>>> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("validates refresh strictly and returns the shared success envelope", async () => {
    const calls: Array<{ refresh: boolean | undefined }> = [];
    const app = buildApp({
      modelService: {
        listModels: async (options) => {
          calls.push({ refresh: options?.refresh });
          return modelList();
        }
      }
    });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/models?refresh=true"
    });
    expect(response.statusCode).toBe(200);
    expect(
      modelsResponseSchema.parse(response.json()).data.models
    ).toHaveLength(1);
    expect(modelsResponseSchema.parse(response.json()).data.models[0]?.id).toBe(
      "eligible/model"
    );
    expect(calls).toEqual([{ refresh: true }]);
    expect(
      modelsResponseSchema.safeParse({
        data: { ...modelList(), unknown: true }
      }).success
    ).toBe(false);

    const invalid = await app.inject({
      method: "GET",
      url: "/api/models?unknown=true"
    });
    expect(invalid.statusCode).toBe(422);
    expect(apiErrorResponseSchema.parse(invalid.json()).error.code).toBe(
      "REQUEST_VALIDATION_FAILED"
    );
  });

  it("maps OpenRouter failures without exposing upstream secrets", async () => {
    const secret = "sk-or-v1-upstream-secret";
    const logStream = new PassThrough();
    const chunks: string[] = [];
    logStream.on("data", (chunk: Buffer) =>
      chunks.push(chunk.toString("utf8"))
    );
    const app = buildApp({
      logger: { level: "error", stream: logStream },
      modelService: {
        listModels: async () => {
          throw new OpenRouterAdapterError(OPENROUTER_ERROR_CODE.authFailed);
        }
      }
    });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/models" });
    expect(response.statusCode).toBe(502);
    const error = apiErrorResponseSchema.parse(response.json()).error;
    expect(error.code).toBe(OPENROUTER_ERROR_CODE.authFailed);
    expect(JSON.stringify(response.json())).not.toContain(secret);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(chunks.join("")).not.toContain(secret);
    logStream.destroy();
  });

  it("keeps the existing status mapping for all four OpenRouter states", () => {
    expect(
      mapApiError(
        new OpenRouterAdapterError(OPENROUTER_ERROR_CODE.notConfigured)
      )
    ).toMatchObject({
      code: OPENROUTER_ERROR_CODE.notConfigured,
      status: 503,
      shouldLog: false
    });
    expect(
      mapApiError(new OpenRouterAdapterError(OPENROUTER_ERROR_CODE.authFailed))
    ).toMatchObject({
      code: OPENROUTER_ERROR_CODE.authFailed,
      status: 502
    });
    expect(
      mapApiError(new OpenRouterAdapterError(OPENROUTER_ERROR_CODE.unavailable))
    ).toMatchObject({
      code: OPENROUTER_ERROR_CODE.unavailable,
      status: 503
    });
    expect(
      mapApiError(
        new OpenRouterAdapterError(OPENROUTER_ERROR_CODE.responseInvalid)
      )
    ).toMatchObject({
      code: OPENROUTER_ERROR_CODE.responseInvalid,
      status: 502
    });
  });

  it("keeps project creation and source saving available without OpenRouter", async () => {
    const workspaceRoot = await fs.mkdtemp(
      path.join(tmpdir(), "subdub-models-no-key-")
    );
    const server = await initializeServer({
      workspaceRoot,
      modelService: new OpenRouterModelService({ env: {} })
    });

    try {
      const modelsResponse = await server.app.inject({
        method: "GET",
        url: "/api/models"
      });
      expect(modelsResponse.statusCode).toBe(503);

      const createdResponse = await server.app.inject({
        method: "POST",
        url: "/api/projects",
        payload: { title: "No OpenRouter project" }
      });
      expect(createdResponse.statusCode).toBe(200);
      const created = createdResponse.json();

      const sourceResponse = await server.app.inject({
        method: "PUT",
        url: `/api/projects/${created.data.metadata.id}/source`,
        payload: {
          markdown: "# Non-AI editing remains available",
          expectedRevision: created.revision
        }
      });
      expect(sourceResponse.statusCode).toBe(200);
    } finally {
      await server.app.close();
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});
