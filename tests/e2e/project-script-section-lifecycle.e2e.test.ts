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
  renderManifestSchema,
  videoProjectSchema,
  type Script,
  type RenderManifest,
  type VideoProject
} from "../../src/schema/index.js";
import { createScreenTemplateProjectFixture } from "../fixtures/e2e/screen-template-project.js";
import { renderManifestFixture } from "../fixtures/render-manifest.js";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const projectId = "pc-05-script-section-browser";
const previewProjectId = "pc-05-preview-section-browser";
const downstreamOverlayId = "overlay-main-confirm";
const downstreamVoiceOverrides = { speedScale: 1.1 };
const desktopViewport = { width: 1800, height: 1000 };
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

function downstreamPreviewProject(): VideoProject {
  const project = createScreenTemplateProjectFixture();
  project.metadata.id = previewProjectId;
  project.metadata.title = "PC-05 downstream preview project";
  project.visuals = {
    ...project.visuals,
    assignments: project.visuals.assignments.filter(
      (assignment) => assignment.id === "visual-main-photo"
    )
  };
  for (const section of project.script.sections) {
    section.screenTemplateId = standardTemplate.templateId;
  }
  const mainLearnerLine = project.script.sections
    .find((section) => section.id === "section-main")
    ?.lines.find((line) => line.id === "main-learner-1");
  if (mainLearnerLine === undefined) {
    throw new Error("downstream voice fixture is missing");
  }
  mainLearnerLine.voiceOverrides = { ...downstreamVoiceOverrides };
  project.overlays = {
    ...project.overlays,
    lineOverlays: [
      {
        id: downstreamOverlayId,
        lineId: "main-learner-1",
        kind: "label",
        text: "確認",
        transform: {
          x: 0.24,
          y: 0.24,
          width: 0.2,
          height: 0.1,
          rotationDeg: 0
        },
        colorToken: "accent",
        animation: "pulse"
      }
    ]
  };
  return videoProjectSchema.parse(project);
}

function manifestForEnabledSections(
  enabledSectionIds: ReadonlySet<string>
): RenderManifest {
  const manifest = structuredClone(renderManifestFixture) as RenderManifest;
  const lines = manifest.lines.filter((line) =>
    enabledSectionIds.has(line.sectionId)
  );
  const lineIds = new Set(lines.map((line) => line.id));
  const filtered = {
    ...manifest,
    sectionLayouts: manifest.sectionLayouts.filter((layout) =>
      enabledSectionIds.has(layout.sectionId)
    ),
    layoutIntervals: manifest.layoutIntervals.filter((interval) =>
      enabledSectionIds.has(interval.sectionId)
    ),
    lines,
    visuals: manifest.visuals.filter((visual) =>
      enabledSectionIds.has(visual.sectionId)
    ),
    backgrounds: manifest.backgrounds.filter((background) =>
      enabledSectionIds.has(background.sectionId)
    ),
    audioTracks: manifest.audioTracks.filter((track) =>
      enabledSectionIds.has(track.sectionId)
    ),
    soundEffects: manifest.soundEffects.filter((effect) =>
      lineIds.has(effect.lineId)
    ),
    lineOverlays: manifest.lineOverlays.filter((overlay) =>
      lineIds.has(overlay.lineId)
    ),
    inserts: manifest.inserts.filter(
      (insert) =>
        insert.id !== "insert-eye-main" || enabledSectionIds.has("section-main")
    )
  };
  return renderManifestSchema.parse(filtered);
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

async function waitForSectionNames(
  page: Page,
  expectedNames: readonly string[]
): Promise<void> {
  await page.waitForFunction(
    `(names) => {
      const actualNames = Array.from(
        document.querySelectorAll(".script-section-name-input")
      ).map((input) => input.value);
      return JSON.stringify(actualNames) === JSON.stringify(names);
    }`,
    [...expectedNames]
  );
}

async function expectNoHorizontalOverflow(
  page: Page,
  selector: string
): Promise<void> {
  const layouts = await page.locator(selector).evaluateAll((elements) =>
    elements.map((element) => {
      const browserElement = element as unknown as {
        readonly clientWidth: number;
        readonly scrollWidth: number;
      };
      return {
        clientWidth: browserElement.clientWidth,
        scrollWidth: browserElement.scrollWidth
      };
    })
  );
  expect(layouts.length).toBeGreaterThan(0);
  for (const layout of layouts) {
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
  }
}

function isScriptSaveRequestFor(
  request: { method(): string; url(): string },
  targetProjectId: string
) {
  return (
    request.method() === "PUT" &&
    new URL(request.url()).pathname ===
      `/api/projects/${targetProjectId}/script`
  );
}

function isScriptSaveRequest(request: { method(): string; url(): string }) {
  return isScriptSaveRequestFor(request, projectId);
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

  async function openPreviewPage(seedProject: VideoProject): Promise<{
    readonly context: BrowserContext;
    readonly page: Page;
    readonly saveRequests: unknown[];
    readonly previewRequests: Array<{
      readonly enabledSectionIds: readonly string[];
      readonly manifestSectionIds: readonly string[];
    }>;
    readonly compileRequests: string[];
    readonly previewRenderRequests: string[];
    readonly mp4RenderRequests: string[];
    readonly currentProject: () => VideoProject;
  }> {
    const context = await browser.newContext();
    const page = await context.newPage();
    const saveRequests: unknown[] = [];
    const previewRequests: Array<{
      readonly enabledSectionIds: readonly string[];
      readonly manifestSectionIds: readonly string[];
    }> = [];
    const compileRequests: string[] = [];
    const previewRenderRequests: string[] = [];
    const mp4RenderRequests: string[] = [];
    let project = structuredClone(seedProject) as VideoProject;
    let generatedSectionNumber = 0;

    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const pathname = url.pathname;

      if (
        request.method() === "GET" &&
        pathname === `/api/projects/${previewProjectId}`
      ) {
        await route.fulfill(jsonResponse(project, project.revision));
        return;
      }

      if (
        request.method() === "GET" &&
        pathname === `/api/projects/${previewProjectId}/manifest`
      ) {
        const enabledSectionIds = project.script.sections
          .filter((section) => section.enabled)
          .map((section) => section.id);
        if (enabledSectionIds.length === 0) {
          previewRequests.push({
            enabledSectionIds,
            manifestSectionIds: []
          });
          await route.fulfill(
            jsonResponse({
              project: {
                id: project.metadata.id,
                title: project.metadata.title
              },
              state: "missing",
              canPlay: false,
              manifest: null,
              blockers: [
                {
                  code: "NO_ENABLED_SECTION",
                  message: "有効なセクションがありません。",
                  target: { kind: "script" }
                },
                {
                  code: "MANIFEST_NOT_FOUND",
                  message: "プレビューはまだ生成されていません。",
                  target: { kind: "manifest" }
                }
              ]
            })
          );
          return;
        }

        const manifest = manifestForEnabledSections(new Set(enabledSectionIds));
        previewRequests.push({
          enabledSectionIds,
          manifestSectionIds: manifest.sectionLayouts.map(
            (layout) => layout.sectionId
          )
        });
        await route.fulfill(
          jsonResponse({
            project: {
              id: project.metadata.id,
              title: project.metadata.title
            },
            state: "current",
            canPlay: true,
            manifest,
            blockers: []
          })
        );
        return;
      }

      if (
        request.method() === "GET" &&
        pathname === `/api/projects/${previewProjectId}/voice/status`
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

      if (request.method() === "GET" && pathname === "/api/assets") {
        await route.fulfill(
          jsonResponse({
            items: [],
            page: 1,
            pageSize: 100,
            total: 0,
            hasNextPage: false
          })
        );
        return;
      }

      if (request.method() === "GET" && pathname.startsWith("/api/assets/")) {
        const assetId = decodeURIComponent(
          pathname.slice("/api/assets/".length)
        );
        const assignment = project.visuals.assignments.find(
          (candidate) => candidate.assetId === assetId
        );
        if (assignment === undefined) {
          await route.fulfill(
            errorResponse(404, "ASSET_NOT_FOUND", `Unknown asset ${assetId}`)
          );
          return;
        }
        const kind = assignment.display.kind;
        await route.fulfill(
          jsonResponse({
            assetId,
            revision: 1,
            currentVersion: 1,
            version: 1,
            versionStatus: "ready",
            kind,
            title: `${assetId} preview asset`,
            description: "",
            confidentiality: "internal",
            department: null,
            system: null,
            mimeType:
              kind === "video"
                ? "video/mp4"
                : kind === "document_scan"
                  ? "application/pdf"
                  : "image/png",
            libraryMediaPath: assignment.projectMediaPath,
            checksum: assignment.assetChecksum,
            sizeBytes: 1,
            width: 1920,
            height: 1080,
            durationMs: kind === "video" ? 5_000 : null,
            pageCount: kind === "document_scan" ? 1 : null,
            thumbnailPaths: [],
            tags: [],
            tagIds: [],
            status: "active",
            errorCode: null,
            errorMessage: null,
            createdAt,
            updatedAt: createdAt
          })
        );
        return;
      }

      const projectFilesPrefix = `/api/projects/${previewProjectId}/files/`;
      if (
        request.method() === "GET" &&
        pathname.startsWith(projectFilesPrefix)
      ) {
        const filePath = pathname
          .slice(projectFilesPrefix.length)
          .toLowerCase();
        const file = filePath.endsWith(".mp4")
          ? {
              name: "clip.mp4",
              contentType: "video/mp4"
            }
          : filePath.endsWith(".png")
            ? {
                name: "shot.png",
                contentType: "image/png"
              }
            : filePath.endsWith(".pdf")
              ? {
                  name: "scan-1page.pdf",
                  contentType: "application/pdf"
                }
              : filePath.endsWith(".ogg") || filePath.endsWith(".mp3")
                ? {
                    name: "bgm-1s.mp3",
                    contentType: "audio/mpeg"
                  }
                : filePath.endsWith(".wav")
                  ? {
                      name: "effect-1s.wav",
                      contentType: "audio/wav"
                    }
                  : undefined;
        if (file === undefined) {
          await route.fulfill(
            errorResponse(404, "FILE_NOT_FOUND", `Unhandled file ${filePath}`)
          );
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: file.contentType,
          path: path.join(
            repositoryRoot,
            "tests",
            "fixtures",
            "media",
            file.name
          )
        });
        return;
      }

      if (isScriptSaveRequestFor(request, previewProjectId)) {
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

      if (
        request.method() === "POST" &&
        pathname === `/api/projects/${previewProjectId}/manifest/compile`
      ) {
        compileRequests.push(pathname);
        await route.fulfill(
          errorResponse(
            422,
            "NO_ENABLED_SECTION",
            "At least one script section must be enabled before rendering."
          )
        );
        return;
      }

      if (
        request.method() === "POST" &&
        pathname === `/api/projects/${previewProjectId}/preview/render`
      ) {
        previewRenderRequests.push(pathname);
        await route.fulfill(
          errorResponse(
            422,
            "NO_ENABLED_SECTION",
            "At least one script section must be enabled before rendering."
          )
        );
        return;
      }

      if (
        request.method() === "POST" &&
        pathname === `/api/projects/${previewProjectId}/render`
      ) {
        mp4RenderRequests.push(pathname);
        await route.fulfill(
          errorResponse(
            422,
            "NO_ENABLED_SECTION",
            "At least one script section must be enabled before rendering."
          )
        );
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
      previewRequests,
      compileRequests,
      previewRenderRequests,
      mp4RenderRequests,
      currentProject: () => project
    };
  }

  async function navigateToPreview(page: Page): Promise<void> {
    const manifestResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        response.request().method() === "GET" &&
        url.pathname === `/api/projects/${previewProjectId}/manifest`
      );
    });
    await page.getByRole("link", { name: "出力", exact: true }).click();
    await page.waitForURL(
      (url) => url.pathname === `/projects/${previewProjectId}/preview`
    );
    await manifestResponsePromise;
  }

  it(
    "starts at ScriptPage and persists rename, add, reorder, deactivate, reload, and reactivate",
    { timeout: 60_000 },
    async () => {
      const { context, page, saveRequests, currentProject } = await openPage();
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      try {
        await page.setViewportSize(desktopViewport);
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
        const firstSection = page.locator(".script-section-card").first();
        const firstSectionCollapseButton = firstSection.locator(
          ".script-section-collapse-button"
        );
        const firstSectionBody = firstSection.locator(".script-section-body");
        expect(
          await firstSectionCollapseButton.getAttribute("aria-expanded")
        ).toBe("true");
        expect(
          await firstSectionCollapseButton.getAttribute("aria-label")
        ).toBe("導入を折りたたむ");
        await firstSectionCollapseButton.click();
        expect(await firstSectionBody.getAttribute("hidden")).not.toBeNull();
        expect(
          await firstSectionCollapseButton.getAttribute("aria-expanded")
        ).toBe("false");
        expect(
          await firstSectionCollapseButton.getAttribute("aria-label")
        ).toBe("導入を展開");
        await firstSectionCollapseButton.click();
        expect(await firstSectionBody.getAttribute("hidden")).toBeNull();
        expect(await page.locator(".workflow-step").allTextContents()).toEqual([
          "1台本",
          "2編集",
          "3出力"
        ]);
        await expectNoHorizontalOverflow(page, ".script-editor-page");
        await expectNoHorizontalOverflow(page, ".script-section-header");
        await expectNoHorizontalOverflow(
          page,
          ".script-section-header-actions"
        );
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
        await waitForSectionNames(page, [
          "導入",
          "操作説明",
          "締め",
          "注意事項"
        ]);
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
        await waitForSectionNames(page, [
          "導入",
          "操作説明",
          "注意事項",
          "締め"
        ]);
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
        await expectNoHorizontalOverflow(page, ".script-editor-page");
        await expectNoHorizontalOverflow(page, ".script-section-header");
        await expectNoHorizontalOverflow(
          page,
          ".script-section-header-actions"
        );
        await expectNoHorizontalOverflow(page, ".script-disabled-sections");
        await expectNoHorizontalOverflow(page, ".script-disabled-section-item");
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
        await waitForSectionNames(page, [
          "導入",
          "操作説明",
          "注意事項",
          "締め"
        ]);
        expect(await sectionNames(page)).toEqual([
          "導入",
          "操作説明",
          "注意事項",
          "締め"
        ]);
        expect(
          await page.locator(".script-disabled-section-item").count()
        ).toBe(0);
        await expectNoHorizontalOverflow(page, ".script-editor-page");
        await expectNoHorizontalOverflow(page, ".script-section-header");
        await expectNoHorizontalOverflow(
          page,
          ".script-section-header-actions"
        );
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

  it(
    "keeps downstream data when a section is disabled, previewed, and re-enabled",
    { timeout: 60_000 },
    async () => {
      const seedProject = downstreamPreviewProject();
      const { context, page, saveRequests, previewRequests, currentProject } =
        await openPreviewPage(seedProject);
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      const downstreamSectionId = "section-main";
      try {
        await page.goto(`${webUrl}/projects/${previewProjectId}/script`, {
          waitUntil: "domcontentloaded"
        });
        await page
          .getByRole("heading", {
            name: seedProject.metadata.title
          })
          .waitFor();
        await page.locator(".script-section-name-input").first().waitFor();

        const downstreamSection = currentProject().script.sections.find(
          (section) => section.id === downstreamSectionId
        );
        const downstreamOverlay = currentProject().overlays.lineOverlays.find(
          (overlay) => overlay.id === downstreamOverlayId
        );
        if (downstreamOverlay === undefined) {
          throw new Error("downstream overlay fixture is missing");
        }
        expect(downstreamSection?.lines.length).toBeGreaterThan(0);
        expect(currentProject().edit.sectionBgms).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ sectionId: downstreamSectionId })
          ])
        );
        expect(currentProject().edit.videoElements).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              placement: expect.objectContaining({
                kind: "before_section",
                sectionId: downstreamSectionId
              })
            })
          ])
        );
        expect(currentProject().visuals.assignments).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: "visual-main-photo",
              startLineId: "main-mentor-1",
              endLineId: "main-mentor-2"
            })
          ])
        );
        expect(currentProject().audio.soundEffects).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ lineId: "main-learner-1" })
          ])
        );
        expect(
          currentProject().script.sections.find(
            (section) => section.id === downstreamSectionId
          )?.lines
        ).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: "main-learner-1",
              voiceOverrides: downstreamVoiceOverrides
            })
          ])
        );
        expect(downstreamOverlay).toEqual({
          id: downstreamOverlayId,
          lineId: "main-learner-1",
          kind: "label",
          text: "確認",
          transform: {
            x: 0.24,
            y: 0.24,
            width: 0.2,
            height: 0.1,
            rotationDeg: 0
          },
          colorToken: "accent",
          animation: "pulse"
        });

        const mainSectionCard = page.locator(".script-section-card").nth(1);
        const disableRequestPromise = page.waitForRequest((request) =>
          isScriptSaveRequestFor(request, previewProjectId)
        );
        await mainSectionCard.getByRole("button", { name: "無効化" }).click();
        const disableRequest = await disableRequestPromise;
        const disableBody = JSON.parse(disableRequest.postData() ?? "{}");
        expect(disableBody.script.sections).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: downstreamSectionId,
              enabled: false
            })
          ])
        );
        await page
          .getByRole("heading", { name: "無効なセクション (1)" })
          .waitFor();
        const retainedSectionItem = page.locator(
          ".script-disabled-section-item"
        );
        expect(
          await retainedSectionItem
            .locator(".script-disabled-section-meta code")
            .textContent()
        ).toBe(downstreamSectionId);
        expect(
          currentProject().script.sections.find(
            (section) => section.id === downstreamSectionId
          )?.lines.length
        ).toBe(downstreamSection?.lines.length);
        expect(currentProject().edit.sectionBgms).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ sectionId: downstreamSectionId })
          ])
        );
        expect(currentProject().edit.videoElements).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              placement: expect.objectContaining({
                kind: "before_section",
                sectionId: downstreamSectionId
              })
            })
          ])
        );
        expect(currentProject().visuals.assignments).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: "visual-main-photo" })
          ])
        );
        expect(currentProject().audio.soundEffects).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ lineId: "main-learner-1" })
          ])
        );
        expect(
          currentProject().script.sections.find(
            (section) => section.id === downstreamSectionId
          )?.lines
        ).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: "main-learner-1",
              voiceOverrides: downstreamVoiceOverrides
            })
          ])
        );
        expect(currentProject().overlays.lineOverlays).toEqual(
          expect.arrayContaining([downstreamOverlay])
        );

        await navigateToPreview(page);
        await page.getByRole("heading", { name: "最新のプレビュー" }).waitFor();
        expect(previewRequests.at(-1)).toEqual({
          enabledSectionIds: ["section-intro", "section-outro"],
          manifestSectionIds: ["section-intro", "section-outro"]
        });

        await page.getByRole("link", { name: "台本へ戻る" }).click();
        await page.waitForURL(
          (url) => url.pathname === `/projects/${previewProjectId}/script`
        );
        await page
          .getByRole("heading", { name: seedProject.metadata.title })
          .waitFor();
        await page
          .locator(".script-disabled-section-item code")
          .filter({ hasText: downstreamSectionId })
          .waitFor();

        const reactivateRequestPromise = page.waitForRequest((request) =>
          isScriptSaveRequestFor(request, previewProjectId)
        );
        await page.getByRole("button", { name: "再有効化" }).click();
        const reactivateRequest = await reactivateRequestPromise;
        const reactivateBody = JSON.parse(reactivateRequest.postData() ?? "{}");
        expect(reactivateBody.script.sections).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: downstreamSectionId,
              enabled: true
            })
          ])
        );
        await page
          .getByRole("heading", { name: "無効なセクション (0)" })
          .waitFor({ state: "detached" });
        expect(
          currentProject().script.sections.find(
            (section) => section.id === downstreamSectionId
          )?.enabled
        ).toBe(true);
        expect(
          currentProject().script.sections.find(
            (section) => section.id === downstreamSectionId
          )?.lines
        ).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: "main-learner-1",
              voiceOverrides: downstreamVoiceOverrides
            })
          ])
        );
        expect(currentProject().overlays.lineOverlays).toEqual(
          expect.arrayContaining([downstreamOverlay])
        );

        await navigateToPreview(page);
        await page.getByRole("heading", { name: "最新のプレビュー" }).waitFor();
        expect(previewRequests.at(-1)).toEqual({
          enabledSectionIds: ["section-intro", "section-main", "section-outro"],
          manifestSectionIds: ["section-intro", "section-main", "section-outro"]
        });
        expect(saveRequests).toHaveLength(2);
        expect(currentProject().edit.sectionBgms).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ sectionId: downstreamSectionId })
          ])
        );
        expect(currentProject().edit.videoElements).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              placement: expect.objectContaining({
                kind: "before_section",
                sectionId: downstreamSectionId
              })
            })
          ])
        );
        expect(currentProject().visuals.assignments).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: "visual-main-photo" })
          ])
        );
        expect(currentProject().audio.soundEffects).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ lineId: "main-learner-1" })
          ])
        );
        expect(pageErrors).toEqual([]);
      } finally {
        await context.close();
      }
    }
  );

  it(
    "fails closed for Preview and MP4 when every section is disabled",
    { timeout: 60_000 },
    async () => {
      const seedProject = downstreamPreviewProject();
      const {
        context,
        page,
        saveRequests,
        previewRequests,
        compileRequests,
        previewRenderRequests,
        mp4RenderRequests,
        currentProject
      } = await openPreviewPage(seedProject);
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      try {
        await page.goto(`${webUrl}/projects/${previewProjectId}/script`, {
          waitUntil: "domcontentloaded"
        });
        await page
          .getByRole("heading", {
            name: seedProject.metadata.title
          })
          .waitFor();
        await page.locator(".script-section-name-input").first().waitFor();

        for (
          let index = 0;
          index < seedProject.script.sections.length;
          index += 1
        ) {
          const saveRequestPromise = page.waitForRequest((request) =>
            isScriptSaveRequestFor(request, previewProjectId)
          );
          await page.getByRole("button", { name: "無効化" }).first().click();
          await saveRequestPromise;
          await page
            .getByRole("heading", {
              name: `無効なセクション (${index + 1})`
            })
            .waitFor();
        }

        expect(
          currentProject().script.sections.every(
            (section) => section.enabled === false
          )
        ).toBe(true);
        expect(currentProject().edit.sectionBgms).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ sectionId: "section-main" })
          ])
        );
        expect(currentProject().edit.videoElements).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              placement: expect.objectContaining({
                kind: "before_section",
                sectionId: "section-main"
              })
            })
          ])
        );
        expect(saveRequests).toHaveLength(seedProject.script.sections.length);

        await navigateToPreview(page);
        await page
          .getByRole("heading", {
            name: "レンダリング対象の有効なセクションがありません"
          })
          .waitFor();
        expect(
          await page.getByText("NO_ENABLED_SECTION", { exact: true }).count()
        ).toBeGreaterThan(0);
        const compileButton = page.getByRole("button", {
          name: "有効なセクションがありません",
          exact: true
        });
        await compileButton.waitFor();
        expect(await compileButton.isDisabled()).toBe(true);
        const previewSaveButton = page.getByRole("button", {
          name: "プレビューを保存",
          exact: true
        });
        await previewSaveButton.waitFor();
        expect(await previewSaveButton.isDisabled()).toBe(true);
        expect(previewRequests.at(-1)).toEqual({
          enabledSectionIds: [],
          manifestSectionIds: []
        });
        expect(compileRequests).toHaveLength(0);
        expect(previewRenderRequests).toHaveLength(0);
        expect(mp4RenderRequests).toHaveLength(0);

        const failClosedResults = await page.evaluate(async (baseUrl) => {
          const requests = [
            {
              kind: "manifest-compile",
              path: "/api/projects/pc-05-preview-section-browser/manifest/compile"
            },
            {
              kind: "preview",
              path: "/api/projects/pc-05-preview-section-browser/preview/render"
            },
            {
              kind: "mp4",
              path: "/api/projects/pc-05-preview-section-browser/render"
            }
          ] as const;
          const results: Array<{
            readonly kind: (typeof requests)[number]["kind"];
            readonly status: number;
            readonly code: string | undefined;
          }> = [];
          for (const request of requests) {
            const response = await fetch(`${baseUrl}${request.path}`, {
              method: "POST",
              headers:
                request.kind === "preview"
                  ? { "content-type": "application/json" }
                  : undefined,
              body:
                request.kind === "preview"
                  ? JSON.stringify({ previewPreset: "hd" })
                  : undefined
            });
            const body = (await response.json()) as {
              readonly error?: { readonly code?: string };
            };
            results.push({
              kind: request.kind,
              status: response.status,
              code: body.error?.code
            });
          }
          return results;
        }, webUrl);
        expect(failClosedResults).toEqual([
          {
            kind: "manifest-compile",
            status: 422,
            code: "NO_ENABLED_SECTION"
          },
          { kind: "preview", status: 422, code: "NO_ENABLED_SECTION" },
          { kind: "mp4", status: 422, code: "NO_ENABLED_SECTION" }
        ]);
        expect(compileRequests).toHaveLength(1);
        expect(previewRenderRequests).toHaveLength(1);
        expect(mp4RenderRequests).toHaveLength(1);
        expect(pageErrors).toEqual([]);
      } finally {
        await context.close();
      }
    }
  );
});
