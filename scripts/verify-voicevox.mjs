import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { initializeServer } from "../src/api/server.js";
import {
  apiErrorResponseSchema,
  voicevoxStatusResponseSchema
} from "../src/schema/api.js";

const usage = `使い方:
  pnpm verify:voicevox

VOICEVOX ENGINE を起動し、必要に応じて .env の VOICEVOX_ENGINE_URL を設定してから実行してください。`;

function requireNoArguments(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(usage);
    return false;
  }
  if (argv.length !== 0) {
    throw new Error(`引数が不正です。\n\n${usage}`);
  }
  return true;
}

function getApiErrorMessage(response) {
  const parsed = apiErrorResponseSchema.safeParse(response.json());
  if (parsed.success) {
    return `${parsed.data.error.code}: ${parsed.data.error.message}`;
  }
  return `API ${response.statusCode} の応答形式が不正です。`;
}

async function main() {
  if (!requireNoArguments(process.argv.slice(2))) {
    return;
  }

  let workspaceRoot;
  let server;
  try {
    workspaceRoot = await fs.mkdtemp(
      path.join(tmpdir(), "subdub-voicevox-status-")
    );
    server = await initializeServer({ workspaceRoot });

    const response = await server.app.inject({
      method: "GET",
      url: "/api/voicevox/status"
    });
    if (response.statusCode !== 200) {
      throw new Error(getApiErrorMessage(response));
    }

    const status = voicevoxStatusResponseSchema.parse(response.json()).data;
    console.log(
      "[OK] VOICEVOX の両話者とノーマル style の解決に成功しました。"
    );
    for (const speaker of status.speakers) {
      console.log(`speakerName: ${speaker.speakerName}`);
      console.log(`speakerUuid: ${speaker.speakerUuid}`);
      console.log(`styleName: ${speaker.styleName}`);
      console.log(`resolvedStyleId: ${speaker.resolvedStyleId}`);
    }
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
  if (error instanceof Error) {
    console.error(`[FAIL] ${error.message}`);
  } else {
    console.error("[FAIL] VOICEVOX の実ENGINE確認に失敗しました。");
  }
  process.exitCode = 1;
});
