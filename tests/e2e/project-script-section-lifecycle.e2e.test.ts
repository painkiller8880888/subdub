import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";

import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page
} from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { normalizeEditedScriptIds } from "../../src/app/projects/current-script-domain.js";
import { createEmptyVideoProject } from "../../src/app/projects/empty-video-project.js";
import { browserExecutable } from "../../src/app/rendering/remotion-mp4-renderer.js";
import { createStandardScreenTemplate } from "../../src/app/screen-templates/screen-template-seed.js";
import {
  videoProjectSchema,
  type Script,
  type VideoProject
} from "../../src/schema/index.js";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const projectId = "pc-05-script-section-browser";
const createdAt = "2026-01-01T00:00:00.000Z";
const initialProject = createEmptyVideoProject({
  projectId,
  title: "PC-05 browser project",
  createdAt
});
const standardTemplate = createStandardScreenTemplate(createdAt);
const standardTemplateSummary = {
  templateId: standardTemplate.templateId,
  name: standardTemplate.name,
  description: standardTemplate.description,
  status: standardTemplate.status,
  canvasWidth: standardTemplate.canvasWidth,
  canvasHeight: standardTemplate.canvasHeight,
  revision: standardTemplate.revision,
  contentHash: "b".repeat(64),
  updatedAt: standardTemplate.updatedAt,
  elementSummary: {
    total: 5,
    byType: {
      "dialogue-window": 1,
      "section-title": 1,
      "character-visual": 2,
      "content-slot": 1
    }
  }
};

function serverPort(server: ViteDevServer): number {
  const address = server.httpServer?.address();
  if (
    address === null ||
    address === undefined ||
    typeof address === "string"
  ) {
    throw new Error("The PC-05 browser E2E web server has no TCP port.");
  }
  return (address as AddressInfo).port;
}

function jsonResponse(data: unknown, revision?: number) {
  return {
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      data,
      ...(revision === undefined ? {} : { revision })
    })
  };
}

function errorResponse(status: number, code: string, message: string) {
  return {
    status,
    contentType: "application/json",
    body: JSON.stringify({
      error: {
        code,
        message,
        details: [],
        requestId: `pc-05-${code.toLowerCase()}`
      }
    })
  };
}

function projectSummary(project: VideoProject) {
  return {
    id: project.metadata.id,
    title: project.metadata.title,
    department: project.metadata.department,
    manualVersion: project.metadata.manualVersion,
    revision: project.revision,
    createdAt: project.metadata.createdAt,
    updatedAt: project.metadata.updatedAt
  };
}

function manifestPreview(project: VideoProject) {
  return {
    project: { id: project.metadata.id, title: project.metadata.title },
    state: "missing",
    canPlay: false,
    manifest: null,
    blockers: []
  };
}

async function sectionNames(page: Page): Promise<string[]> {
  return page
    .locator(".script-section-name-input")
    .evaluateAll((elements) =>
      elements.map(
        (element) => (element as unknown as { readonly value: string }).value
      )
    );
}

function isScriptSaveRequest(request: { method(): string; url(): string }) {
  return (
    request.method() === "PUT" &&
    new URL(request.url()).pathname === `/api/projects/${projectId}/script`
  );
}

describe("project create and ScriptPage section lifecycle browser E2E", () => {
  let webServer: ViteDevServer;
  let browser: Browser;
  let webUrl: string;

  beforeAll(async () => {
    const executable = browserExecutable();
    if (typeof executable !== "string") {
      throw new Error(
        "A local Chrome/Chromium/Edge executable is required for PC-05 browser E2E."
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

  async function openPage(): Promise<{
    readonly context: BrowserContext;
    readonly page: Page;
    readonly saveRequests: unknown[];
    readonly currentProject: () => VideoProject;
  }> {
    const context = await browser.newContext();
    const page = await context.newPage();
    const saveRequests: unknown[] = [];
    let project = initialProject;
    let generatedSectionNumber = 0;

    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const pathname = url.pathname;

      if (request.method() === "POST" && pathname === "/api/projects") {
        const body = JSON.parse(request.postData() ?? "{}");
        project = videoProjectSchema.parse({
          ...initialProject,
          metadata: {
            ...initialProject.metadata,
            title: body.title,
            department: body.department,
            manualVersion: body.manualVersion ?? "",
            updatedAt: createdAt
          }
        });
        await route.fulfill(jsonResponse(project, project.revision));
        return;
      }

      if (request.method() === "GET" && pathname === "/api/projects") {
        await route.fulfill(
          jsonResponse([projectSummary(project)], project.revision)
        );
        return;
      }

      if (
        request.method() === "GET" &&
        pathname === `/api/projects/${projectId}`
      ) {
        await route.fulfill(jsonResponse(project, project.revision));
        return;
      }

      if (
        request.method() === "GET" &&
        pathname === `/api/projects/${projectId}/manifest`
      ) {
        await route.fulfill(jsonResponse(manifestPreview(project)));
        return;
      }

      if (
        request.method() === "GET" &&
        pathname === `/api/projects/${projectId}/voice/status`
      ) {
        await route.fulfill(
          jsonResponse({ available: false, lines: [], jobs: [] })
        );
        return;
      }

      if (request.method() === "GET" && pathname === "/api/character-visuals") {
        await route.fulfill(jsonResponse([]));
        return;
      }

      if (
        request.method() === "GET" &&
        pathname === "/api/screen-templates/screen-template-standard"
      ) {
        await route.fulfill(
          jsonResponse({ ...standardTemplate, contentHash: "b".repeat(64) })
        );
        return;
      }

      if (request.method() === "GET" && pathname === "/api/screen-templates") {
        await route.fulfill(jsonResponse([standardTemplateSummary]));
        return;
      }

      if (isScriptSaveRequest(request)) {
        const body = JSON.parse(request.postData() ?? "{}");
        saveRequests.push(body);
        const candidate = body.script as Script;
        const normalizedScript = normalizeEditedScriptIds(
          project,
          candidate,
          () => {
            generatedSectionNumber += 1;
            return `server-section-${generatedSectionNumber}`;
          }
        );
        project = videoProjectSchema.parse({
          ...project,
          revision: project.revision + 1,
          metadata: { ...project.metadata, updatedAt: createdAt },
          script: normalizedScript
        });
        await route.fulfill(jsonResponse(project, project.revision));
        return;
      }

      await route.fulfill(
        errorResponse(
          404,
          "API_NOT_FOUND",
          `Unhandled ${request.method()} ${pathname}`
        )
      );
    });

    return {
      context,
      page,
      saveRequests,
      currentProject: () => project
    };
  }

  it(
    "starts at ScriptPage and persists rename, add, reorder, deactivate, reload, and reactivate",
    { timeout: 60_000 },
    async () => {
      const { context, page, saveRequests, currentProject } = await openPage();
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      try {
        await page.goto(`${webUrl}/projects/new`, {
          waitUntil: "domcontentloaded"
        });
        await page
          .getByLabel("プロジェクト名（必須）")
          .fill(initialProject.metadata.title);
        await page.getByRole("button", { name: "作成する" }).click();
        await page.waitForURL(
          (url) => url.pathname === `/projects/${projectId}/script`
        );
        await page
          .getByRole("heading", { name: initialProject.metadata.title })
          .waitFor();
        await page.locator(".script-section-name-input").first().waitFor();

        expect(await sectionNames(page)).toEqual(["導入", "本編", "締め"]);
        expect(await page.locator(".workflow-step").allTextContents()).toEqual([
          "1台本",
          "2編集",
          "3出力"
        ]);
        await fs.mkdir(path.join(repositoryRoot, "artifacts", "issue-205"), {
          recursive: true
        });
        await page.screenshot({
          fullPage: true,
          path: path.join(
            repositoryRoot,
            "artifacts",
            "issue-205",
            "script-starter-sections.png"
          )
        });

        const renameInput = page.locator(".script-section-name-input").nth(1);
        const renameRequestPromise = page.waitForRequest(isScriptSaveRequest);
        await renameInput.fill("操作説明");
        await renameInput.press("Tab");
        const renameRequest = await renameRequestPromise;
        const renameBody = JSON.parse(renameRequest.postData() ?? "{}");
        expect(renameBody.expectedRevision).toBe(0);
        expect(renameBody.script.sections[1].id).toBe(
          initialProject.script.sections[1]?.id
        );
        expect(await sectionNames(page)).toEqual(["導入", "操作説明", "締め"]);

        const addInput = page.getByLabel("新しいセクション名");
        await addInput.fill("注意事項");
        const addRequestPromise = page.waitForRequest(isScriptSaveRequest);
        await page.getByRole("button", { name: "セクションを追加" }).click();
        const addRequest = await addRequestPromise;
        const addBody = JSON.parse(addRequest.postData() ?? "{}");
        const requestOnlySection = addBody.script.sections.at(-1);
        expect(addBody.expectedRevision).toBe(1);
        expect(requestOnlySection.id).toMatch(/^pending-script-section-/u);
        expect(await sectionNames(page)).toEqual([
          "導入",
          "操作説明",
          "締め",
          "注意事項"
        ]);
        const addedSectionId = currentProject().script.sections.at(-1)?.id;
        expect(addedSectionId).toMatch(/^script-section-server-section-/u);

        const addedSectionCard = page.locator(".script-section-card").nth(3);
        const reorderRequestPromise = page.waitForRequest(isScriptSaveRequest);
        await addedSectionCard
          .getByRole("button", { name: "上へ移動" })
          .click();
        const reorderRequest = await reorderRequestPromise;
        const reorderBody = JSON.parse(reorderRequest.postData() ?? "{}");
        expect(reorderBody.expectedRevision).toBe(2);
        expect(await sectionNames(page)).toEqual([
          "導入",
          "操作説明",
          "注意事項",
          "締め"
        ]);

        const outroCard = page.locator(".script-section-card").nth(3);
        const disableRequestPromise = page.waitForRequest(isScriptSaveRequest);
        await outroCard.getByRole("button", { name: "無効化" }).click();
        const disableRequest = await disableRequestPromise;
        const disableBody = JSON.parse(disableRequest.postData() ?? "{}");
        expect(disableBody.expectedRevision).toBe(3);
        expect(disableBody.script.sections).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: initialProject.script.sections[2]?.id,
              enabled: false
            })
          ])
        );
        await page
          .getByRole("heading", { name: "無効なセクション (1)" })
          .waitFor();
        expect(await sectionNames(page)).toEqual([
          "導入",
          "操作説明",
          "注意事項"
        ]);
        expect(
          await page.locator(".script-disabled-section-item code").textContent()
        ).toBe(initialProject.script.sections[2]?.id);
        await page.screenshot({
          fullPage: true,
          path: path.join(
            repositoryRoot,
            "artifacts",
            "issue-205",
            "script-disabled-retained.png"
          )
        });

        await page.reload({ waitUntil: "domcontentloaded" });
        await page
          .getByRole("heading", { name: initialProject.metadata.title })
          .waitFor();
        expect(await sectionNames(page)).toEqual([
          "導入",
          "操作説明",
          "注意事項"
        ]);
        expect(
          await page.locator(".script-disabled-section-item").count()
        ).toBe(1);

        const reactivateRequestPromise =
          page.waitForRequest(isScriptSaveRequest);
        await page.getByRole("button", { name: "再有効化" }).click();
        const reactivateRequest = await reactivateRequestPromise;
        const reactivateBody = JSON.parse(reactivateRequest.postData() ?? "{}");
        expect(reactivateBody.expectedRevision).toBe(4);
        expect(await sectionNames(page)).toEqual([
          "導入",
          "操作説明",
          "注意事項",
          "締め"
        ]);
        expect(
          await page.locator(".script-disabled-section-item").count()
        ).toBe(0);
        await page.screenshot({
          fullPage: true,
          path: path.join(
            repositoryRoot,
            "artifacts",
            "issue-205",
            "script-reactivated.png"
          )
        });

        expect(saveRequests).toHaveLength(5);
        expect(
          saveRequests.map(
            (request) =>
              (request as { readonly expectedRevision: number })
                .expectedRevision
          )
        ).toEqual([0, 1, 2, 3, 4]);
        expect(pageErrors).toEqual([]);

        await page.goto(`${webUrl}/projects/${projectId}/outline`, {
          waitUntil: "domcontentloaded"
        });
        await page
          .getByRole("heading", { name: "ページが見つかりません" })
          .waitFor();
        expect(saveRequests).toHaveLength(5);
      } finally {
        await context.close();
      }
    }
  );
});
