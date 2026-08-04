import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { initializeServer } from "../src/api/server.js";
import { getOpenRouterApiKey } from "../src/openrouter/config.js";
import { aiRunLogSchema } from "../src/schema/ai-run-log.js";
import {
  apiErrorResponseSchema,
  projectCreateResponseSchema,
  projectMutationResponseSchema
} from "../src/schema/api.js";

const sourceMarkdown = `# 概要

この短い資料は実API確認専用のfixtureです。

## 手順

1. 画面を開きます。
2. 内容を確認します。

# 完了

保存結果を確認します。`;

const usage = `使い方:
  pnpm verify:openrouter:outline
  pnpm verify:openrouter:outline -- --model-id <provider/model>

リポジトリ直下の .env に既存の OPENROUTER_API_KEY を設定してから実行してください。`;

function isRecord(value) {
  return typeof value === "object" && value !== null;
}

function parseArguments(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(usage);
    return null;
  }

  if (argv.length === 0) {
    return {};
  }

  if (argv.length === 2 && argv[0] === "--model-id" && argv[1]) {
    return { modelId: argv[1] };
  }

  throw new Error(`引数が不正です。\n\n${usage}`);
}

function safeResponseError(response) {
  const body = response.json();
  const parsed = apiErrorResponseSchema.safeParse(body);
  if (parsed.success) {
    return new Error(
      `API ${response.statusCode} ${parsed.data.error.code}: ${parsed.data.error.message}`
    );
  }

  return new Error(`API ${response.statusCode} の応答形式が不正です。`);
}

function requireStatus(response, expectedStatus) {
  if (response.statusCode !== expectedStatus) {
    throw safeResponseError(response);
  }

  return response.json();
}

function printRunSummary(runLog) {
  console.log(`runId: ${runLog.runId}`);
  console.log(`model: ${runLog.modelId ?? "(not reported)"}`);
  console.log(
    `modelSelectionSource: ${runLog.modelSelectionSource ?? "(not reported)"}`
  );
  console.log(`responseModel: ${runLog.responseModel ?? "(not reported)"}`);
  console.log(`provider: ${runLog.provider ?? "(not reported)"}`);
  console.log(`httpAttempts: ${runLog.httpAttemptCount}`);
  console.log(
    `tokens: prompt=${runLog.promptTokens ?? "null"}, completion=${runLog.completionTokens ?? "null"}, total=${runLog.totalTokens ?? "null"}`
  );
}

async function main() {
  const argumentsResult = parseArguments(process.argv.slice(2));
  if (argumentsResult === null) {
    return;
  }

  if (getOpenRouterApiKey() === undefined) {
    throw new Error(
      "OPENROUTER_API_KEY が未設定です。.env に既存のキーを設定してください。"
    );
  }

  let workspaceRoot;
  let server;

  try {
    workspaceRoot = await fs.mkdtemp(
      path.join(tmpdir(), "subdub-openrouter-outline-")
    );
    server = await initializeServer({ workspaceRoot });

    const createdResponse = await server.app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { title: "OpenRouter実API確認" }
    });
    const created = projectCreateResponseSchema.parse(
      requireStatus(createdResponse, 200)
    ).data;
    const projectId = created.metadata.id;

    const sourceResponse = await server.app.inject({
      method: "PUT",
      url: `/api/projects/${projectId}/source`,
      payload: {
        markdown: sourceMarkdown,
        expectedRevision: 0
      }
    });
    const sourceSaved = projectMutationResponseSchema.parse(
      requireStatus(sourceResponse, 200)
    );
    if (sourceSaved.revision !== 1) {
      throw new Error("fixture source のrevisionが想定外です。");
    }

    const briefResponse = await server.app.inject({
      method: "PUT",
      url: `/api/projects/${projectId}/brief`,
      payload: {
        brief: {
          ...created.brief,
          audience: "手順を初めて読む担当者",
          postViewingGoal: "基本手順と確認方法を理解する",
          targetDurationSec: 30,
          requiredItems: ["開始前の確認"],
          prohibitedItems: ["実在の個人情報"],
          globalDirectives: ["資料にない事実は補完しない"]
        },
        expectedRevision: 1
      }
    });
    const briefSaved = projectMutationResponseSchema.parse(
      requireStatus(briefResponse, 200)
    );
    if (briefSaved.revision !== 2) {
      throw new Error("fixture brief のrevisionが想定外です。");
    }

    const generatePayload = { expectedRevision: 2 };
    if (argumentsResult.modelId !== undefined) {
      generatePayload.modelId = argumentsResult.modelId;
    }

    const generatedResponse = await server.app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/outline/generate`,
      payload: generatePayload
    });
    const generated = projectMutationResponseSchema.parse(
      requireStatus(generatedResponse, 200)
    );
    const outline = generated.data.outline;
    if (generated.revision !== 3 || outline.status !== "needs_review") {
      throw new Error("生成後のoutline/revisionが想定外です。");
    }

    const roles = outline.sections.map((section) => section.role);
    if (
      roles.length < 3 ||
      roles[0] !== "intro" ||
      roles.at(-1) !== "outro" ||
      roles.slice(1, -1).some((role) => role !== "main")
    ) {
      throw new Error("生成されたsection順が想定外です。");
    }

    if (outline.generationRunId === null) {
      throw new Error("generationRunIdが付与されていません。");
    }

    const runLogPath = path.join(
      workspaceRoot,
      "projects",
      projectId,
      "runs",
      `${outline.generationRunId}.json`
    );
    const runLog = aiRunLogSchema.parse(
      JSON.parse(await fs.readFile(runLogPath, "utf8"))
    );
    if (
      runLog.status !== "succeeded" ||
      runLog.schemaValidation !== "passed" ||
      runLog.errorCode !== null ||
      runLog.httpAttemptCount < 1
    ) {
      throw new Error("成功run logの内容が想定外です。");
    }

    const runLogText = JSON.stringify(runLog);
    if (
      runLogText.includes("OPENROUTER_API_KEY") ||
      runLogText.includes(sourceMarkdown)
    ) {
      throw new Error("run logに禁止情報が含まれています。");
    }

    console.log("[OK] OpenRouter実APIによる構成案生成が完了しました。");
    console.log(`projectRevision: ${generated.revision}`);
    console.log(`sections: ${roles.join(" -> ")}`);
    printRunSummary(runLog);
    console.log("fixture workspace: temporary workspace was removed");
  } finally {
    if (server !== undefined) {
      await server.app.close().catch(() => undefined);
    }
    if (workspaceRoot !== undefined) {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  }
}

await main().catch((error) => {
  if (isRecord(error) && typeof error.message === "string") {
    console.error(`[FAIL] ${error.message}`);
  } else {
    console.error("[FAIL] 実API確認に失敗しました。");
  }
  process.exitCode = 1;
});
