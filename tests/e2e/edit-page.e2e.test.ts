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

import { createEmptyVideoProject } from "../../src/app/projects/empty-video-project.js";
import { browserExecutable } from "../../src/app/rendering/remotion-mp4-renderer.js";
import {
  videoProjectSchema,
  type EditPlan,
  type ScriptSection,
  type VideoProject
} from "../../src/schema/index.js";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const projectId = "edit-page-dnd-ui-project";

const sections = [
  {
    id: "section-first",
    outlineSectionId: "outline-first",
    name: "最初のセクション",
    screenTemplateId: "screen-template-standard",
    background: { kind: "solid", colorToken: "background" },
    lines: []
  },
  {
    id: "section-second",
    outlineSectionId: "outline-second",
    name: "二番目のセクション",
    screenTemplateId: "screen-template-standard",
    background: { kind: "solid", colorToken: "background" },
    lines: []
  },
  {
    id: "section-third",
    outlineSectionId: "outline-third",
    name: "三番目のセクション",
    screenTemplateId: "screen-template-standard",
    background: { kind: "solid", colorToken: "background" },
    lines: []
  }
] satisfies ScriptSection[];

const videoAsset = {
  assetId: "edit-page-dnd-video",
  version: 1,
  kind: "video" as const,
  title: "UIテスト用カットイン",
  description: "",
  confidentiality: "internal",
  department: null,
  system: null,
  mimeType: "video/mp4",
  libraryMediaPath: "media/edit-page-dnd-video.mp4",
  checksum: "a".repeat(64),
  sizeBytes: 100,
  width: 1920,
  height: 1080,
  durationMs: 1000,
  pageCount: null,
  thumbnailPaths: ["media/edit-page-dnd-video/thumbnail-0.png"],
  status: "active" as const,
  errorCode: null,
  errorMessage: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z"
};

function cutin(
  id: string,
  sectionId: string,
  order: number
): EditPlan["videoElements"][number] {
  return {
    id,
    role: "cutin",
    assetId: videoAsset.assetId,
    assetVersion: videoAsset.version,
    assetChecksum: videoAsset.checksum,
    projectMediaPath: `media/${id}.mp4`,
    placement: { kind: "before_section", sectionId, order },
    startMs: null,
    playbackRate: 1,
    volume: 1,
    text: "",
    textTemplateId: null
  };
}

const initialEdit: EditPlan = {
  videoElements: [
    cutin("cutin-a", "section-second", 5),
    cutin("cutin-b", "section-second", 10)
  ],
  sectionBgms: []
};

const boundaryEdit: EditPlan = {
  videoElements: [
    cutin("cutin-a", "section-second", 5),
    cutin("cutin-b", "section-third", 10)
  ],
  sectionBgms: []
};

const emptyProject = createEmptyVideoProject({
  projectId,
  title: "DnD UIテスト",
  createdAt: "2026-01-01T00:00:00.000Z"
});

const initialProject = videoProjectSchema.parse({
  ...emptyProject,
  outline: {
    ...emptyProject.outline,
    sections: sections.map((section, index) => ({
      id: section.outlineSectionId,
      order: index + 1,
      role:
        index === 0
          ? "intro"
          : index === sections.length - 1
            ? "outro"
            : "main",
      title: section.name,
      overview: section.name,
      keyPoints: [],
      targetDurationSec: 1,
      sourceRefs: [{ sourceId: emptyProject.source.id, headingPath: [] }],
      openQuestions: [],
      humanDirectives: {
        requiredItems: [],
        prohibitedItems: [],
        scriptConstraints: []
      },
      lockedFields: []
    }))
  },
  script: {
    ...emptyProject.script,
    sections
  },
  edit: initialEdit
});

function projectWithEdit(edit: EditPlan, revision: number): VideoProject {
  return videoProjectSchema.parse({
    ...initialProject,
    revision,
    edit
  });
}

function errorResponse(
  status: number,
  code: string,
  message: string
): { status: number; contentType: string; body: string } {
  return {
    status,
    contentType: "application/json",
    body: JSON.stringify({
      error: {
        code,
        message,
        details: [],
        requestId: `edit-page-dnd-${code.toLowerCase()}`
      }
    })
  };
}

function serverPort(server: ViteDevServer): number {
  const address = server.httpServer?.address();
  if (
    address === null ||
    address === undefined ||
    typeof address === "string"
  ) {
    throw new Error("The edit page E2E web server did not expose a TCP port.");
  }
  return (address as AddressInfo).port;
}

async function readElementOrder(page: Page): Promise<string[]> {
  return page.locator("[data-edit-video-element-id]").evaluateAll((elements) =>
    elements
      .map((element) =>
        (
          element as unknown as {
            getAttribute: (name: string) => string | null;
          }
        ).getAttribute("data-edit-video-element-id")
      )
      .filter((id): id is string => id !== null)
  );
}

async function selectFirstCutinAndMoveDown(page: Page): Promise<void> {
  const handle = page.locator(
    '[data-edit-video-element-id="cutin-a"] .edit-drag-handle'
  );
  await handle.focus();
  await handle.press("Space");
  await page.locator(".edit-dnd-status").waitFor({ state: "visible" });
  await handle.press("ArrowDown");
  await handle.press("Enter");
}

describe("edit page DnD UI", () => {
  let webServer: ViteDevServer;
  let browser: Browser;
  let webUrl: string;

  beforeAll(async () => {
    const executable = browserExecutable();
    if (typeof executable !== "string") {
      throw new Error(
        "A local Chrome/Chromium/Edge executable is required for the edit page UI E2E."
      );
    }

    webServer = await createServer({
      configFile: path.join(repositoryRoot, "vite.config.ts"),
      logLevel: "error",
      server: {
        host: "127.0.0.1",
        port: 0,
        strictPort: false
      }
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

  async function openPage(
    saveMode: "success" | "error" | "conflict",
    editPlan: EditPlan = initialEdit
  ): Promise<{
    readonly context: BrowserContext;
    readonly page: Page;
    readonly saveRequests: unknown[];
  }> {
    const context = await browser.newContext();
    const page = await context.newPage();
    const saveRequests: unknown[] = [];
    const project = projectWithEdit(editPlan, 0);

    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());

      if (
        request.method() === "GET" &&
        url.pathname === `/api/projects/${projectId}`
      ) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: project,
            revision: project.revision
          })
        });
        return;
      }
      if (
        request.method() === "GET" &&
        url.pathname === `/api/projects/${projectId}/edit`
      ) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: editPlan,
            revision: project.revision
          })
        });
        return;
      }
      if (
        request.method() === "GET" &&
        url.pathname.startsWith(`/api/assets/${videoAsset.assetId}/thumbnails/`)
      ) {
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
      if (
        request.method() === "GET" &&
        url.pathname === `/api/assets/${videoAsset.assetId}`
      ) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: videoAsset })
        });
        return;
      }
      if (
        request.method() === "PUT" &&
        url.pathname === `/api/projects/${projectId}/edit`
      ) {
        const body = JSON.parse(request.postData() ?? "{}");
        saveRequests.push(body);
        if (saveMode === "error") {
          await route.fulfill(
            errorResponse(500, "INTERNAL_SERVER_ERROR", "UIテスト用の保存失敗")
          );
          return;
        }
        if (saveMode === "conflict") {
          await route.fulfill(
            errorResponse(
              409,
              "PROJECT_REVISION_CONFLICT",
              "プロジェクトが別の内容へ更新されています。"
            )
          );
          return;
        }

        const submittedEdit = body.edit as EditPlan;
        const savedEdit: EditPlan = {
          ...editPlan,
          videoElements: editPlan.videoElements.map((element) => {
            const submitted = submittedEdit.videoElements.find(
              (candidate) => candidate.id === element.id
            );
            return submitted === undefined
              ? element
              : { ...element, ...submitted };
          })
        };
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: projectWithEdit(savedEdit, 1),
            revision: 1
          })
        });
        return;
      }

      await route.fulfill(errorResponse(404, "API_NOT_FOUND", "Not found"));
    });

    await page.goto(`${webUrl}/projects/${projectId}/edit`, {
      waitUntil: "domcontentloaded"
    });
    await page.locator(".edit-page h1").waitFor({ state: "visible" });
    await page.locator(".edit-drag-handle").first().waitFor({
      state: "visible"
    });
    return { context, page, saveRequests };
  }

  it(
    "moves a cutin with Space, ArrowDown, and Enter through the rendered UI",
    { timeout: 30_000 },
    async () => {
      const { context, page, saveRequests } = await openPage("success");
      try {
        const saveRequestPromise = page.waitForRequest(
          (request) =>
            request.method() === "PUT" &&
            new URL(request.url()).pathname ===
              `/api/projects/${projectId}/edit`
        );
        await selectFirstCutinAndMoveDown(page);
        const saveRequest = await saveRequestPromise;
        const requestBody = JSON.parse(saveRequest.postData() ?? "{}");

        await page.getByText("保存済み", { exact: true }).waitFor({
          state: "visible"
        });
        expect(requestBody.expectedRevision).toBe(0);
        expect(
          requestBody.edit.videoElements.map(
            (element: { readonly id: string }) => element.id
          )
        ).toEqual(["cutin-a", "cutin-b"]);
        expect(
          requestBody.edit.videoElements.map(
            (element: {
              readonly id: string;
              readonly placement: { readonly order: number };
            }) => [element.id, element.placement.order]
          )
        ).toEqual([
          ["cutin-a", 1],
          ["cutin-b", 0]
        ]);
        expect(await readElementOrder(page)).toEqual(["cutin-b", "cutin-a"]);
        expect(saveRequests).toHaveLength(1);
      } finally {
        await context.close();
      }
    }
  );

  it(
    "saves start, playback rate, and mute controls for an edit video",
    { timeout: 30_000 },
    async () => {
      const { context, page, saveRequests } = await openPage("success");
      try {
        const card = page.locator('[data-edit-video-element-id="cutin-a"]');
        const startSaveRequest = page.waitForRequest(
          (request) =>
            request.method() === "PUT" &&
            new URL(request.url()).pathname ===
              `/api/projects/${projectId}/edit`
        );
        await card.getByLabel("開始秒").fill("0.5");
        await card.getByLabel("再生速度").selectOption({ label: "x2.0" });
        const firstRequest = await startSaveRequest;
        const firstBody = JSON.parse(firstRequest.postData() ?? "{}");
        expect(firstBody.edit.videoElements).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: "cutin-a",
              startMs: 500,
              playbackRate: 2,
              volume: 1
            })
          ])
        );
        await page.getByText("保存済み", { exact: true }).waitFor({
          state: "visible"
        });

        const muteSaveRequest = page.waitForRequest(
          (request) =>
            request.method() === "PUT" &&
            new URL(request.url()).pathname ===
              `/api/projects/${projectId}/edit`
        );
        await card.getByLabel("無音").check();
        const mutedRequest = await muteSaveRequest;
        const mutedBody = JSON.parse(mutedRequest.postData() ?? "{}");
        expect(mutedBody.edit.videoElements).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: "cutin-a", volume: 0 })
          ])
        );
        await page.getByText("保存済み", { exact: true }).waitFor({
          state: "visible"
        });

        const unmuteSaveRequest = page.waitForRequest(
          (request) =>
            request.method() === "PUT" &&
            new URL(request.url()).pathname ===
              `/api/projects/${projectId}/edit`
        );
        await card.getByLabel("無音").uncheck();
        const unmutedRequest = await unmuteSaveRequest;
        const unmutedBody = JSON.parse(unmutedRequest.postData() ?? "{}");
        expect(unmutedBody.edit.videoElements).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: "cutin-a", volume: 1 })
          ])
        );
        await expect.poll(() => saveRequests.length).toBe(3);
      } finally {
        await context.close();
      }
    }
  );

  it(
    "does not autosave an invalid start second over the existing value",
    { timeout: 30_000 },
    async () => {
      const editWithExistingStart: EditPlan = {
        ...initialEdit,
        videoElements: initialEdit.videoElements.map((element) =>
          element.id === "cutin-a" ? { ...element, startMs: 5_000 } : element
        )
      };
      const { context, page, saveRequests } = await openPage(
        "success",
        editWithExistingStart
      );
      try {
        const startInput = page
          .locator('[data-edit-video-element-id="cutin-a"]')
          .getByLabel("開始秒");
        expect(await startInput.inputValue()).toBe("5");

        await startInput.fill("-1");
        await page
          .getByText("0以上の数字を入力してください。", { exact: true })
          .waitFor({ state: "visible" });
        await page.waitForTimeout(750);

        expect(await startInput.inputValue()).toBe("-1");
        expect(saveRequests).toHaveLength(0);
      } finally {
        await context.close();
      }
    }
  );

  it(
    "moves a cutin to the next boundary before the existing cutin",
    { timeout: 30_000 },
    async () => {
      const { context, page, saveRequests } = await openPage(
        "success",
        boundaryEdit
      );
      try {
        const handle = page.locator(
          '[data-edit-video-element-id="cutin-a"] .edit-drag-handle'
        );
        const saveRequestPromise = page.waitForRequest(
          (request) =>
            request.method() === "PUT" &&
            new URL(request.url()).pathname ===
              `/api/projects/${projectId}/edit`
        );
        await handle.focus();
        await handle.press("Space");
        await page.locator(".edit-dnd-status").waitFor({ state: "visible" });
        await handle.press("ArrowDown");
        expect(await page.locator(".edit-dnd-status").textContent()).toContain(
          "三番目のセクション"
        );
        await handle.press("Enter");

        const saveRequest = await saveRequestPromise;
        const requestBody = JSON.parse(saveRequest.postData() ?? "{}");
        await page.getByText("保存済み", { exact: true }).waitFor({
          state: "visible"
        });
        expect(
          requestBody.edit.videoElements.map(
            (element: {
              readonly id: string;
              readonly placement: {
                readonly sectionId: string;
                readonly order: number;
              };
            }) => [
              element.id,
              element.placement.sectionId,
              element.placement.order
            ]
          )
        ).toEqual([
          ["cutin-a", "section-third", 0],
          ["cutin-b", "section-third", 1]
        ]);
        expect(await readElementOrder(page)).toEqual(["cutin-a", "cutin-b"]);
        expect(saveRequests).toHaveLength(1);
      } finally {
        await context.close();
      }
    }
  );

  it(
    "rolls the rendered order back when the reorder mutation fails",
    { timeout: 30_000 },
    async () => {
      const { context, page, saveRequests } = await openPage("error");
      try {
        await selectFirstCutinAndMoveDown(page);
        await page
          .getByRole("heading", { name: "保存できませんでした" })
          .waitFor();
        await page
          .getByText(
            "並べ替えの保存に失敗したため、変更前の順序へ戻しました。",
            {
              exact: true
            }
          )
          .waitFor();
        expect(await readElementOrder(page)).toEqual(["cutin-a", "cutin-b"]);
        expect(saveRequests).toHaveLength(1);
      } finally {
        await context.close();
      }
    }
  );

  it(
    "shows the conflict UI and does not implicitly overwrite after a 409",
    { timeout: 30_000 },
    async () => {
      const { context, page, saveRequests } = await openPage("conflict");
      try {
        await selectFirstCutinAndMoveDown(page);
        await page.getByRole("heading", { name: "保存競合" }).waitFor();
        await page
          .getByText("競合した並べ替えは適用せず、変更前の順序へ戻しました。", {
            exact: true
          })
          .waitFor();
        expect(await readElementOrder(page)).toEqual(["cutin-a", "cutin-b"]);
        await page.waitForTimeout(500);
        expect(saveRequests).toHaveLength(1);
      } finally {
        await context.close();
      }
    }
  );
});
