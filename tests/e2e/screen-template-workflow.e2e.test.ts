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

import { screenTemplateContentHash } from "../../src/app/screen-templates/screen-template-hash.js";
import { browserExecutable } from "../../src/app/rendering/remotion-mp4-renderer.js";
import type {
  AssetDetail,
  AssetListItem,
  CharacterVisualCatalogSnapshot,
  ScreenTemplate,
  VideoProject
} from "../../src/schema/index.js";
import type {
  ScreenTemplateDetail,
  ScreenTemplateSummary,
  VoiceGenerationStatusData
} from "../../src/schema/api.js";
import { legacyCharacterVariantCatalog } from "../../src/app/character-visuals/character-visual-seed.js";
import {
  ALTERNATE_SCREEN_TEMPLATE_ID,
  createScreenTemplateProjectFixture,
  createStandardAndAlternateTemplateSnapshot,
  SCREEN_TEMPLATE_FIXTURE_TIMESTAMP
} from "../fixtures/e2e/screen-template-project.js";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const projectId = "manual-video-project";

type WorkflowState = {
  templates: Map<string, ScreenTemplate>;
  project: VideoProject;
  templateSaves: unknown[];
  scriptSaves: unknown[];
  templateDetailRequests: number;
};

function serverPort(server: ViteDevServer): number {
  const address = server.httpServer?.address();
  if (
    address === null ||
    address === undefined ||
    typeof address === "string"
  ) {
    throw new Error(
      "The ScreenTemplate workflow server did not expose a port."
    );
  }
  return (address as AddressInfo).port;
}

function templateDetail(template: ScreenTemplate): ScreenTemplateDetail {
  return {
    ...template,
    contentHash: screenTemplateContentHash(template)
  };
}

function templateSummary(template: ScreenTemplate): ScreenTemplateSummary {
  const detail = templateDetail(template);
  const { elements: _elements, createdAt: _createdAt, ...summary } = detail;
  void _elements;
  void _createdAt;
  return {
    ...summary,
    elementSummary: {
      total: template.elements.length,
      byType: {
        "dialogue-window": template.elements.filter(
          (element) => element.type === "dialogue-window"
        ).length,
        "section-title": template.elements.filter(
          (element) => element.type === "section-title"
        ).length,
        "character-visual": template.elements.filter(
          (element) => element.type === "character-visual"
        ).length,
        "content-slot": template.elements.filter(
          (element) => element.type === "content-slot"
        ).length
      }
    }
  };
}

function characterCatalog(): CharacterVisualCatalogSnapshot {
  return ["character-mentor", "character-learner"].map((visualId) => ({
    visualId,
    name: `${visualId} browser fixture`,
    description: "",
    status: "active",
    baseWidth: 600,
    baseHeight: 1000,
    variants: legacyCharacterVariantCatalog
      .filter((variant) => variant.characterId === visualId)
      .map((variant) => ({
        variantId: variant.variantId,
        label: variant.label,
        renderType: variant.renderType,
        status: "active" as const,
        tags: [...variant.tags],
        files: variant.files.map((file) => ({
          key: file.key,
          libraryPath: `library/character-visuals/${visualId}/${variant.variantId}/${file.key}.png`,
          mimeType: "image/png" as const,
          checksum: "a".repeat(64),
          sizeBytes: 1,
          width: 600,
          height: 1000
        }))
      })),
    createdAt: SCREEN_TEMPLATE_FIXTURE_TIMESTAMP,
    updatedAt: SCREEN_TEMPLATE_FIXTURE_TIMESTAMP
  }));
}

function assetForAssignment(
  assignment: VideoProject["visuals"]["assignments"][number]
): AssetDetail {
  const kind = assignment.display.kind;
  return {
    assetId: assignment.assetId,
    version: 1,
    kind,
    title: `${assignment.id} browser asset`,
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
    libraryMediaPath: `library/assets/${assignment.assetId}/asset.${kind === "video" ? "mp4" : kind === "document_scan" ? "pdf" : "png"}`,
    checksum: assignment.assetChecksum,
    sizeBytes: 1,
    width: 1920,
    height: 1080,
    durationMs: kind === "video" ? 5_000 : null,
    pageCount: kind === "document_scan" ? 3 : null,
    thumbnailPaths: [
      `library/assets/${assignment.assetId}/thumbnail-0.png`,
      `library/assets/${assignment.assetId}/thumbnail-1.png`
    ],
    status: "active",
    errorCode: null,
    errorMessage: null,
    createdAt: SCREEN_TEMPLATE_FIXTURE_TIMESTAMP,
    updatedAt: SCREEN_TEMPLATE_FIXTURE_TIMESTAMP
  };
}

function listItem(detail: AssetDetail): AssetListItem {
  return {
    assetId: detail.assetId,
    version: detail.version,
    kind: detail.kind,
    title: detail.title,
    description: detail.description,
    confidentiality: detail.confidentiality,
    department: detail.department,
    system: detail.system,
    mimeType: detail.mimeType,
    checksum: detail.checksum,
    sizeBytes: detail.sizeBytes,
    width: detail.width,
    height: detail.height,
    durationMs: detail.durationMs,
    pageCount: detail.pageCount,
    thumbnailPaths: detail.thumbnailPaths,
    tags: [],
    tagIds: [],
    status: detail.status,
    errorCode: detail.errorCode,
    errorMessage: detail.errorMessage,
    createdAt: detail.createdAt,
    updatedAt: detail.updatedAt
  };
}

function voiceStatus(project: VideoProject): VoiceGenerationStatusData {
  return {
    available: true,
    lines: project.script.sections.flatMap((section) =>
      section.lines.map((line) => ({ lineId: line.id, status: "current" }))
    ),
    jobs: []
  };
}

function errorResponse(status: number, message: string) {
  return {
    status,
    contentType: "application/json",
    body: JSON.stringify({
      error: {
        code: status === 404 ? "API_NOT_FOUND" : "TEST_API_ERROR",
        message,
        details: [],
        requestId: "screen-template-workflow-test"
      }
    })
  };
}

async function installApiRoutes(
  page: Page,
  state: WorkflowState
): Promise<void> {
  const catalog = characterCatalog();
  const assets = new Map(
    state.project.visuals.assignments.map((assignment) => {
      const detail = assetForAssignment(assignment);
      return [detail.assetId, detail];
    })
  );

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;

    if (request.method() === "GET" && pathname === "/api/character-visuals") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: catalog, revision: 0 })
      });
      return;
    }
    if (request.method() === "GET" && pathname === "/api/screen-templates") {
      const active = [...state.templates.values()].filter(
        (template) => template.status === "active"
      );
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: active.map(templateSummary),
          revision: 0
        })
      });
      return;
    }
    const templateMatch = pathname.match(/^\/api\/screen-templates\/([^/]+)$/u);
    if (request.method() === "GET" && templateMatch !== null) {
      state.templateDetailRequests += 1;
      const template = state.templates.get(
        decodeURIComponent(templateMatch[1]!)
      );
      if (template === undefined) {
        await route.fulfill(errorResponse(404, "template missing"));
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: templateDetail(template), revision: 0 })
      });
      return;
    }
    if (request.method() === "PUT" && templateMatch !== null) {
      const templateId = decodeURIComponent(templateMatch[1]!);
      const current = state.templates.get(templateId);
      const body = JSON.parse(request.postData() ?? "{}") as {
        name: string;
        description: string;
        expectedRevision: number;
        elements: ScreenTemplate["elements"];
      };
      if (current === undefined) {
        await route.fulfill(errorResponse(404, "template missing"));
        return;
      }
      state.templateSaves.push(body);
      const updated: ScreenTemplate = {
        ...current,
        name: body.name,
        description: body.description,
        elements: body.elements,
        revision: current.revision + 1,
        updatedAt: "2026-08-19T00:10:00.000Z"
      };
      state.templates.set(templateId, updated);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: templateDetail(updated), revision: 0 })
      });
      return;
    }
    if (
      request.method() === "GET" &&
      pathname === `/api/projects/${projectId}`
    ) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: state.project,
          revision: state.project.revision
        })
      });
      return;
    }
    if (
      request.method() === "GET" &&
      pathname === `/api/projects/${projectId}/voice/status`
    ) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: voiceStatus(state.project) })
      });
      return;
    }
    if (
      request.method() === "PUT" &&
      pathname === `/api/projects/${projectId}/script`
    ) {
      const body = JSON.parse(request.postData() ?? "{}") as {
        script: VideoProject["script"];
        expectedRevision: number;
      };
      state.scriptSaves.push(body);
      state.project = {
        ...state.project,
        revision: state.project.revision + 1,
        script: body.script
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: state.project,
          revision: state.project.revision
        })
      });
      return;
    }
    if (request.method() === "GET" && pathname === "/api/assets") {
      const items = [...assets.values()].map(listItem);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            items,
            page: 1,
            pageSize: 100,
            total: items.length,
            hasNextPage: false
          },
          revision: 0
        })
      });
      return;
    }
    const assetMatch = pathname.match(/^\/api\/assets\/([^/]+)$/u);
    if (request.method() === "GET" && assetMatch !== null) {
      const asset = assets.get(decodeURIComponent(assetMatch[1]!));
      if (asset === undefined) {
        await route.fulfill(errorResponse(404, "asset missing"));
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: asset, revision: 0 })
      });
      return;
    }
    if (
      request.method() === "GET" &&
      /^\/api\/assets\/[^/]+\/thumbnails\/\d+$/u.test(pathname)
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
      /^\/api\/character-visuals\/[^/]+\/[^/]+\/[^/]+$/u.test(pathname)
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

    await route.fulfill(
      errorResponse(404, `unhandled ${request.method()} ${pathname}`)
    );
  });
}

describe("ScreenTemplate workflow browser E2E", () => {
  let webServer: ViteDevServer;
  let browser: Browser;
  let webUrl: string;

  beforeAll(async () => {
    const executable = browserExecutable();
    if (typeof executable !== "string") {
      throw new Error(
        "A local Chromium executable is required for workflow E2E."
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

  async function openEditor(): Promise<{
    context: BrowserContext;
    page: Page;
    state: WorkflowState;
  }> {
    const context = await browser.newContext();
    const page = await context.newPage();
    const state: WorkflowState = {
      templates: new Map(
        createStandardAndAlternateTemplateSnapshot().map((template) => [
          template.templateId,
          template
        ])
      ),
      project: createScreenTemplateProjectFixture(),
      templateSaves: [],
      scriptSaves: [],
      templateDetailRequests: 0
    };
    await installApiRoutes(page, state);
    await page.goto(
      `${webUrl}/screen-templates/${ALTERNATE_SCREEN_TEMPLATE_ID}`,
      { waitUntil: "domcontentloaded" }
    );
    await page.locator(".screen-template-editor-page h1").waitFor({
      state: "visible"
    });
    return { context, page, state };
  }

  async function openScript(): Promise<{
    context: BrowserContext;
    page: Page;
    state: WorkflowState;
  }> {
    const context = await browser.newContext();
    const page = await context.newPage();
    const state: WorkflowState = {
      templates: new Map(
        createStandardAndAlternateTemplateSnapshot().map((template) => [
          template.templateId,
          template
        ])
      ),
      project: createScreenTemplateProjectFixture(),
      templateSaves: [],
      scriptSaves: [],
      templateDetailRequests: 0
    };
    await installApiRoutes(page, state);
    await page.goto(`${webUrl}/projects/${projectId}/script`, {
      waitUntil: "domcontentloaded"
    });
    await page.locator(".script-editor-page h1").waitFor({ state: "visible" });
    await page.locator("#section-main-screen-template").waitFor({
      state: "visible"
    });
    expect(state.templateDetailRequests).toBe(2);
    return { context, page, state };
  }

  it(
    "edits alternate geometry with real previews, saves, and reloads without persisting preview selections",
    { timeout: 60_000 },
    async () => {
      const { context, page, state } = await openEditor();
      try {
        expect(
          await page
            .locator('.screen-template-element-list [role="option"]')
            .count()
        ).toBe(5);
        expect(
          await page.locator('img[src*="/api/character-visuals/"]').count()
        ).toBe(2);
        await page.locator("#screen-template-content-asset").selectOption({
          value: "asset-application-form"
        });
        await page
          .locator('img[src*="/api/assets/asset-application-form/"]')
          .waitFor({ state: "visible" });

        const contentOption = page.getByRole("option").filter({
          hasText: "コンテンツ予約領域"
        });
        await contentOption.click();
        const contentBox = page.locator(
          '[aria-label="コンテンツ予約領域を選択。ドラッグで移動"]'
        );
        const contentBounds = await contentBox.boundingBox();
        if (contentBounds === null) {
          throw new Error("content selection bounds are missing");
        }
        await page.mouse.move(
          contentBounds.x + contentBounds.width / 2,
          contentBounds.y + contentBounds.height / 2
        );
        await page.mouse.down();
        await page.mouse.move(
          contentBounds.x + contentBounds.width / 2 + 12,
          contentBounds.y + contentBounds.height / 2 + 8
        );
        await page.mouse.up();

        const resizeHandle = page.locator('[aria-label="右下をリサイズ"]');
        const resizeBounds = await resizeHandle.boundingBox();
        if (resizeBounds === null) {
          throw new Error("resize handle bounds are missing");
        }
        await page.mouse.move(
          resizeBounds.x + resizeBounds.width / 2,
          resizeBounds.y + resizeBounds.height / 2
        );
        await page.mouse.down();
        await page.mouse.move(
          resizeBounds.x + resizeBounds.width / 2 + 8,
          resizeBounds.y + resizeBounds.height / 2 + 5
        );
        await page.mouse.up();

        const rotationHandle = page.locator('[aria-label="回転"]');
        const rotationBounds = await rotationHandle.boundingBox();
        if (rotationBounds === null) {
          throw new Error("rotation handle bounds are missing");
        }
        await page.mouse.move(
          rotationBounds.x + rotationBounds.width / 2,
          rotationBounds.y + rotationBounds.height / 2
        );
        await page.mouse.down();
        await page.mouse.move(
          rotationBounds.x + rotationBounds.width / 2 + 10,
          rotationBounds.y + rotationBounds.height / 2 - 10
        );
        await page.mouse.up();

        await page
          .getByRole("option")
          .filter({ hasText: "話者ビジュアル（speaker-2）" })
          .click();
        await page.locator("#screen-template-property-rotation").fill("9");
        await page.getByLabel("flipX（左右反転）").check();
        await page
          .locator("#screen-template-sample-dialogue")
          .fill("字幕".repeat(200));
        await page
          .locator("#screen-template-sample-section-title")
          .fill("長いセクションタイトル".repeat(30));
        expect(
          await page
            .getByRole("button", { name: "保存", exact: true })
            .isEnabled()
        ).toBe(true);

        const saveResponse = page.waitForResponse(
          (response) =>
            response.request().method() === "PUT" &&
            new URL(response.url()).pathname ===
              `/api/screen-templates/${ALTERNATE_SCREEN_TEMPLATE_ID}`
        );
        await page.getByRole("button", { name: "保存", exact: true }).click();
        await saveResponse;
        await page
          .locator(".screen-template-save-state-saved")
          .waitFor({ state: "visible" });
        expect(
          await page.locator(".screen-template-save-state-saved").textContent()
        ).toBe("保存済み");

        expect(state.templateSaves).toHaveLength(1);
        const save = state.templateSaves[0] as {
          elements: ScreenTemplate["elements"];
        };
        expect(
          save.elements.find(
            (element) =>
              element.type === "character-visual" &&
              element.slot === "speaker-2"
          )
        ).toMatchObject({ flipX: true });
        expect(JSON.stringify(state.templateSaves[0])).not.toContain(
          "asset-application-form"
        );

        await page.reload({ waitUntil: "domcontentloaded" });
        await page.locator(".screen-template-editor-page h1").waitFor({
          state: "visible"
        });
        await page
          .getByRole("option")
          .filter({ hasText: "話者ビジュアル（speaker-2）" })
          .click();
        expect(await page.getByLabel("flipX（左右反転）").isChecked()).toBe(
          true
        );
        expect(
          await page.locator("#screen-template-content-asset").inputValue()
        ).toBe("");
        await page.locator("#screen-template-property-x").fill("-0.06");
        await page.locator("#screen-template-property-width").fill("1.1");
        expect(
          await page.locator("#screen-template-property-x").inputValue()
        ).toBe("-0.06");
        expect(
          await page.locator("#screen-template-property-width").inputValue()
        ).toBe("1.1");

        await page
          .locator("#screen-template-editor-name")
          .fill("保持するテンプレート名");
        await page
          .locator("#screen-template-editor-description")
          .fill("保持するテンプレート説明");
        await page
          .locator("#screen-template-sample-dialogue")
          .fill("リセット後も保持するサンプル");
        await page
          .locator("#screen-template-sample-section-title")
          .fill("リセット後も保持するタイトル");
        await page.locator("#screen-template-content-asset").selectOption({
          value: "asset-application-form"
        });
        await page
          .locator('img[src*="/api/assets/asset-application-form/"]')
          .waitFor({ state: "visible" });

        const resetResponse = page.waitForResponse(
          (response) =>
            response.request().method() === "PUT" &&
            new URL(response.url()).pathname ===
              `/api/screen-templates/${ALTERNATE_SCREEN_TEMPLATE_ID}`
        );
        await page
          .getByRole("button", { name: "デフォルトに戻す", exact: true })
          .click();
        await resetResponse;
        await page
          .locator(".screen-template-save-state-saved")
          .waitFor({ state: "visible" });

        expect(state.templateSaves).toHaveLength(2);
        const resetSave = state.templateSaves.at(-1) as {
          name: string;
          description: string;
          elements: ScreenTemplate["elements"];
        };
        expect(resetSave).toMatchObject({
          name: "保持するテンプレート名",
          description: "保持するテンプレート説明"
        });
        const canonicalElements =
          createStandardAndAlternateTemplateSnapshot()[0]!.elements;
        const currentElementIds =
          createStandardAndAlternateTemplateSnapshot()[1]!.elements;
        expect(resetSave.elements).toEqual(
          canonicalElements.map((element, index) => ({
            ...element,
            elementId: currentElementIds[index]!.elementId
          }))
        );
        expect(
          await page.locator("#screen-template-sample-dialogue").inputValue()
        ).toBe("リセット後も保持するサンプル");
        expect(
          await page
            .locator("#screen-template-sample-section-title")
            .inputValue()
        ).toBe("リセット後も保持するタイトル");
        expect(
          await page.locator("#screen-template-content-asset").inputValue()
        ).toBe("asset-application-form");
        expect(await page.getByLabel("flipX（左右反転）").isChecked()).toBe(
          false
        );
      } finally {
        await context.close();
      }
    }
  );

  it(
    "keeps section inheritance, explicit line overrides, actual previews, and null revert through ScriptPage autosave",
    { timeout: 60_000 },
    async () => {
      const { context, page, state } = await openScript();
      try {
        expect(
          await page.locator("#section-main-screen-template").inputValue()
        ).toBe(ALTERNATE_SCREEN_TEMPLATE_ID);
        const lineCard = page.locator(
          '.script-line-card[aria-label="セリフ main-learner-1"]'
        );
        expect(await lineCard.textContent()).toContain("個別設定: Standard");
        expect(await lineCard.textContent()).toContain(
          "内容を確認してから登録します。"
        );
        expect(
          await lineCard
            .locator(
              '.script-line-card-screen-preview img[src*="/api/character-visuals/"]'
            )
            .count()
        ).toBe(2);
        expect(
          await lineCard
            .locator(
              '.script-line-card-screen-preview img[src*="application-system.png"]'
            )
            .count()
        ).toBe(1);
        await lineCard
          .locator(
            '.script-line-card-screen-preview img[src*="/api/assets/asset-application-form/"]'
          )
          .waitFor({ state: "visible" });

        const waitForScriptSave = async () => {
          await page.waitForResponse(
            (response) =>
              response.request().method() === "PUT" &&
              new URL(response.url()).pathname ===
                `/api/projects/${projectId}/script`
          );
        };

        await page
          .locator("#section-main-screen-template")
          .selectOption("screen-template-standard");
        await waitForScriptSave();
        expect(state.scriptSaves.at(-1)).toMatchObject({
          script: {
            sections: expect.arrayContaining([
              expect.objectContaining({
                id: "section-main",
                screenTemplateId: "screen-template-standard"
              })
            ])
          }
        });
        expect(state.scriptSaves.at(-1)).toMatchObject({
          script: {
            sections: expect.arrayContaining([
              expect.objectContaining({
                id: "section-main",
                lines: expect.arrayContaining([
                  expect.objectContaining({
                    id: "main-learner-1",
                    screenTemplateId: "screen-template-standard"
                  })
                ])
              })
            ])
          }
        });

        await page
          .locator("#section-main-screen-template")
          .selectOption(ALTERNATE_SCREEN_TEMPLATE_ID);
        await waitForScriptSave();
        expect(await lineCard.textContent()).toContain("個別設定: Standard");

        await lineCard
          .getByRole("button", { name: "セクション設定に戻す" })
          .click();
        await waitForScriptSave();
        expect(state.scriptSaves.at(-1)).toMatchObject({
          script: {
            sections: expect.arrayContaining([
              expect.objectContaining({
                id: "section-main",
                lines: expect.arrayContaining([
                  expect.objectContaining({
                    id: "main-learner-1",
                    screenTemplateId: null
                  })
                ])
              })
            ])
          }
        });

        await page.reload({ waitUntil: "domcontentloaded" });
        await page.locator("#section-main-screen-template").waitFor({
          state: "visible"
        });
        expect(
          await page.locator("#section-main-screen-template").inputValue()
        ).toBe(ALTERNATE_SCREEN_TEMPLATE_ID);
        await page
          .locator('.script-line-card[aria-label="セリフ main-learner-1"]')
          .getByText("セクション設定を使用: Alternate")
          .waitFor({ state: "visible" });

        const subtitle = page.locator("#main-learner-1-subtitle");
        await subtitle.fill("テンプレート継承後の字幕");
        await waitForScriptSave();
        expect(await subtitle.inputValue()).toBe("テンプレート継承後の字幕");
        await lineCard
          .getByRole("button", { name: "ビジュアルを変更" })
          .click();
        const picker = page.getByRole("dialog", {
          name: /のビジュアルを選択/
        });
        await picker.waitFor({ state: "visible" });
        await picker.getByRole("button", { name: "閉じる" }).click();
        await page
          .getByRole("button", { name: "このセリフの音声を調整" })
          .first()
          .waitFor({ state: "visible" });
      } finally {
        await context.close();
      }
    }
  );
});
