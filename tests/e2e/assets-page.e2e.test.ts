import * as path from "node:path";
import { fileURLToPath } from "node:url";

import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page
} from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { browserExecutable } from "../../src/app/rendering/remotion-mp4-renderer.js";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);

const timestamp = "2026-08-24T00:00:00.000Z";
const assetId = "asset-page-e2e";

type AssetLifecycle = "processing" | "active" | "inactive";

type AssetE2eState = {
  lifecycle: AssetLifecycle;
  detailRequestsAfterCreate: number;
  replacementAccepted: boolean;
  metadataRevisions: number[];
  metadataConflictOnce: boolean;
  revision: number;
  title: string;
};

function tagDictionary() {
  return [
    {
      tagId: "confirm",
      axis: "action",
      canonicalName: "confirm",
      normalizedName: "confirm",
      aliases: []
    }
  ];
}

function assetListItem(state: AssetE2eState) {
  const processing = state.lifecycle === "processing";
  return {
    assetId,
    revision: state.revision,
    currentVersion: processing ? null : 1,
    version: 1,
    versionStatus: processing ? "processing" : "ready",
    kind: "video",
    title: state.title,
    description: "E2E description",
    confidentiality: "internal",
    department: "総務部",
    system: "申請システム",
    mimeType: "video/mp4",
    checksum: processing ? null : "a".repeat(64),
    sizeBytes: processing ? null : 1,
    width: processing ? null : 1920,
    height: processing ? null : 1080,
    durationMs: processing ? null : 1000,
    pageCount: null,
    thumbnailPaths: processing
      ? []
      : [`thumbnails/${assetId}/v1/frame-0001.png`],
    tags: [],
    tagIds: [],
    status: state.lifecycle,
    errorCode: null,
    errorMessage: null,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function assetDetail(state: AssetE2eState) {
  const processing = state.lifecycle === "processing";
  const currentVersion = processing ? null : 1;
  const pendingVersion = state.replacementAccepted
    ? {
        version: 2,
        status: "processing",
        checksum: null,
        errorCode: null,
        errorMessage: null,
        createdAt: timestamp,
        updatedAt: timestamp
      }
    : null;
  return {
    assetId,
    revision: state.revision,
    currentVersion,
    version: 1,
    versionStatus: processing ? "processing" : "ready",
    versionHistory: [
      ...(state.replacementAccepted ? [pendingVersion] : []),
      {
        version: 1,
        status: processing ? "processing" : "ready",
        checksum: processing ? null : "a".repeat(64),
        errorCode: null,
        errorMessage: null,
        createdAt: timestamp,
        updatedAt: timestamp
      }
    ],
    pendingVersion,
    tags: [],
    tagIds: [],
    kind: "video",
    title: state.title,
    description: "E2E description",
    confidentiality: "internal",
    department: "総務部",
    system: "申請システム",
    mimeType: "video/mp4",
    libraryMediaPath: `media/${assetId}/v1.mp4`,
    checksum: processing ? null : "a".repeat(64),
    sizeBytes: processing ? null : 1,
    width: processing ? null : 1920,
    height: processing ? null : 1080,
    durationMs: processing ? null : 1000,
    pageCount: null,
    thumbnailPaths: processing
      ? []
      : [`thumbnails/${assetId}/v1/frame-0001.png`],
    status: state.lifecycle,
    errorCode: null,
    errorMessage: null,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function jsonResponse(data: unknown) {
  return {
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ data })
  };
}

function serverPort(server: ViteDevServer): number {
  const address = server.httpServer?.address();
  if (
    address === null ||
    address === undefined ||
    typeof address === "string"
  ) {
    throw new Error("The assets E2E web server did not expose a TCP port.");
  }
  return address.port;
}

async function installRoutes(page: Page, state: AssetE2eState): Promise<void> {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;

    if (request.method() === "GET" && pathname === "/api/asset-tags") {
      await route.fulfill(jsonResponse(tagDictionary()));
      return;
    }
    if (request.method() === "GET" && pathname === "/api/assets") {
      await route.fulfill(
        jsonResponse({
          items: [assetListItem(state)],
          page: Number(url.searchParams.get("page") ?? 1),
          pageSize: Number(url.searchParams.get("pageSize") ?? 24),
          total: 1,
          hasNextPage: false
        })
      );
      return;
    }
    const detailMatch = pathname.match(/^\/api\/assets\/([^/]+)$/u);
    if (request.method() === "GET" && detailMatch !== null) {
      if (state.lifecycle === "processing") {
        state.detailRequestsAfterCreate += 1;
        if (state.detailRequestsAfterCreate > 1) {
          state.lifecycle = "active";
          state.revision = 2;
        }
      }
      await route.fulfill(jsonResponse(assetDetail(state)));
      return;
    }
    if (request.method() === "POST" && pathname === "/api/assets") {
      state.lifecycle = "processing";
      state.detailRequestsAfterCreate = 0;
      state.revision = 1;
      await route.fulfill(
        jsonResponse({
          assetId,
          version: 1,
          revision: 1,
          currentVersion: null,
          kind: "video",
          title: "E2E 素材",
          description: "E2E description",
          mimeType: "video/mp4",
          confidentiality: "internal",
          department: "総務部",
          system: "申請システム",
          tagIds: [],
          status: "processing",
          createdAt: timestamp,
          updatedAt: timestamp
        })
      );
      return;
    }
    if (request.method() === "PUT" && detailMatch !== null) {
      const body = JSON.parse(request.postData() ?? "{}") as {
        expectedRevision: number;
        title: string;
      };
      if (state.metadataConflictOnce) {
        state.metadataConflictOnce = false;
        state.title = "外部更新";
        state.revision += 1;
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({
            error: {
              code: "ASSET_REVISION_CONFLICT",
              message: "素材が別の内容へ更新されています。",
              details: [],
              requestId: "assets-page-e2e-conflict"
            }
          })
        });
        return;
      }
      state.metadataRevisions.push(body.expectedRevision);
      state.title = body.title;
      state.revision = body.expectedRevision + 1;
      await route.fulfill(jsonResponse(assetDetail(state)));
      return;
    }
    if (request.method() === "POST" && pathname.endsWith("/replace")) {
      state.replacementAccepted = true;
      state.revision += 1;
      await route.fulfill(
        jsonResponse({
          assetId,
          version: 2,
          revision: state.revision,
          currentVersion: 1,
          kind: "video",
          status: "processing",
          createdAt: timestamp,
          updatedAt: timestamp
        })
      );
      return;
    }
    if (request.method() === "POST" && pathname.endsWith("/deactivate")) {
      state.lifecycle = "inactive";
      state.revision += 1;
      await route.fulfill(jsonResponse(assetDetail(state)));
      return;
    }
    if (request.method() === "POST" && pathname.endsWith("/activate")) {
      state.lifecycle = "active";
      state.revision += 1;
      await route.fulfill(jsonResponse(assetDetail(state)));
      return;
    }
    if (request.method() === "GET" && pathname.includes("/thumbnails/")) {
      await route.fulfill({
        status: 200,
        contentType: "image/png",
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
          "base64"
        )
      });
      return;
    }
    if (request.method() === "GET" && pathname.includes("/media")) {
      await route.fulfill({
        status: 200,
        contentType: "video/mp4",
        body: Buffer.alloc(0)
      });
      return;
    }
    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "API_NOT_FOUND",
          message: `unhandled ${request.method()} ${pathname}`,
          details: [],
          requestId: "assets-page-e2e"
        }
      })
    });
  });
}

describe("AssetsPage browser E2E", () => {
  let webServer: ViteDevServer;
  let browser: Browser;
  let webUrl: string;

  beforeAll(async () => {
    const executable = browserExecutable();
    if (typeof executable !== "string") {
      throw new Error(
        "A local Chromium executable is required for assets E2E."
      );
    }
    webServer = await createServer({
      configFile: path.join(repositoryRoot, "vite.config.ts"),
      logLevel: "error",
      server: { host: "127.0.0.1", port: 0, strictPort: false }
    });
    await webServer.listen();
    webUrl = `http://127.0.0.1:${serverPort(webServer)}`;
    browser = await chromium.launch({
      executablePath: executable,
      headless: true
    });
  }, 30_000);

  afterAll(async () => {
    await browser?.close();
    await webServer?.close();
  }, 30_000);

  it(
    "creates, processes, edits, replaces, deactivates, and reactivates an asset",
    { timeout: 60_000 },
    async () => {
      const context: BrowserContext = await browser.newContext();
      const page = await context.newPage();
      const state: AssetE2eState = {
        lifecycle: "active",
        detailRequestsAfterCreate: 0,
        replacementAccepted: false,
        metadataRevisions: [],
        metadataConflictOnce: false,
        revision: 2,
        title: "E2E 素材"
      };
      await installRoutes(page, state);
      try {
        await page.goto(`${webUrl}/assets`, { waitUntil: "domcontentloaded" });
        await page
          .getByRole("heading", { name: "登録済み素材" })
          .waitFor({ state: "visible" });

        await page.getByRole("button", { name: "素材を追加" }).first().click();
        const createDialog = page.getByRole("dialog");
        await createDialog
          .getByRole("heading", { name: "素材を追加" })
          .waitFor({ state: "visible" });
        expect(
          await createDialog.locator("#asset-create-kind option").count()
        ).toBe(5);
        await createDialog.locator("#asset-create-title").fill("E2E 素材");
        await createDialog
          .locator("#asset-create-file")
          .setInputFiles(
            path.join(repositoryRoot, "tests", "fixtures", "media", "clip.mp4")
          );
        await createDialog.getByRole("button", { name: "素材を追加" }).click();
        await page
          .getByText("素材を処理しています")
          .waitFor({ state: "visible" });
        await page.getByText("E2E 素材").first().waitFor({ state: "visible" });
        await page
          .locator(".asset-status-badge")
          .filter({ hasText: "利用中" })
          .first()
          .waitFor({ state: "visible", timeout: 8_000 });

        const detailDialog = page.getByRole("dialog");
        await detailDialog.getByRole("button", { name: "編集" }).click();
        await detailDialog.locator("#asset-edit-title").fill("E2E 素材 更新");
        await detailDialog.getByRole("button", { name: "変更を保存" }).click();
        expect(state.metadataRevisions).toEqual([2]);
        await detailDialog
          .getByText("E2E 素材 更新")
          .waitFor({ state: "visible" });

        await detailDialog
          .locator("#asset-replacement-file")
          .setInputFiles(
            path.join(repositoryRoot, "tests", "fixtures", "media", "clip.mp4")
          );
        await detailDialog
          .getByRole("button", { name: "差し替えを受付" })
          .click();
        await detailDialog
          .getByText("v2（処理中")
          .waitFor({ state: "visible" });
        await detailDialog
          .getByText("現在: v1（利用中）")
          .waitFor({ state: "visible" });

        await detailDialog.getByRole("button", { name: "利用停止" }).click();
        const confirmation = page.getByRole("dialog").last();
        await confirmation
          .getByText("DB・media・version history は削除されません。")
          .waitFor({ state: "visible" });
        await confirmation
          .getByRole("button", { name: "利用停止する" })
          .click();
        await detailDialog
          .getByRole("button", { name: "再有効化" })
          .waitFor({ state: "visible" });
        await detailDialog.getByRole("button", { name: "再有効化" }).click();
        await detailDialog
          .getByRole("button", { name: "利用停止" })
          .waitFor({ state: "visible" });
      } finally {
        await context.close();
      }
    }
  );

  it(
    "resets the metadata form before retrying after a revision conflict",
    { timeout: 30_000 },
    async () => {
      const context: BrowserContext = await browser.newContext();
      const page = await context.newPage();
      const state: AssetE2eState = {
        lifecycle: "active",
        detailRequestsAfterCreate: 0,
        replacementAccepted: false,
        metadataRevisions: [],
        metadataConflictOnce: true,
        revision: 2,
        title: "E2E 素材"
      };
      await installRoutes(page, state);
      try {
        await page.goto(`${webUrl}/assets`, { waitUntil: "domcontentloaded" });
        await page
          .getByRole("button", { name: "E2E 素材の詳細を開く" })
          .click();
        const detailDialog = page.getByRole("dialog");
        await detailDialog
          .getByRole("button", { name: "編集" })
          .waitFor({ state: "visible" });
        await detailDialog.getByRole("button", { name: "編集" }).click();
        const titleInput = detailDialog.locator("#asset-edit-title");
        await titleInput.fill("自分の更新");
        await detailDialog.getByRole("button", { name: "変更を保存" }).click();
        await detailDialog
          .getByText("編集内容は保存されていません")
          .waitFor({ state: "visible" });

        await detailDialog
          .getByRole("button", { name: "最新の内容を表示" })
          .click();
        await page.waitForFunction(() => {
          const input =
            document.querySelector<HTMLInputElement>("#asset-edit-title");
          return input?.value === "外部更新";
        });
        expect(await titleInput.inputValue()).toBe("外部更新");
        await titleInput.fill("再入力後");
        await detailDialog.getByRole("button", { name: "変更を保存" }).click();
        expect(state.metadataRevisions).toEqual([3]);
        await detailDialog.getByText("再入力後").waitFor({ state: "visible" });
      } finally {
        await context.close();
      }
    }
  );
});
