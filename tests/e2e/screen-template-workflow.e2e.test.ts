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
import { applyEditedScript } from "../../src/app/projects/script-invalidation.js";
import { browserExecutable } from "../../src/app/rendering/remotion-mp4-renderer.js";
import type {
  AssetDetail,
  AssetListItem,
  CharacterVisualCatalogSnapshot,
  ScreenTemplate,
  VideoProject,
  VisualAssignment
} from "../../src/schema/index.js";
import type {
  ScreenTemplateDetail,
  ScreenTemplateSummary,
  VoiceAdjustmentSnapshot,
  VoiceGenerationStatusData
} from "../../src/schema/api.js";
import { legacyCharacterVariantCatalog } from "../../src/app/character-visuals/character-visual-seed.js";
import { screenLayoutElementBounds } from "../../src/remotion/screen-template-layout.js";
import {
  createVoicevoxAudioQueryFixture,
  syntheticVoicevoxStyleId
} from "../fixtures/voicevox.js";
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
  voiceStatusOverride?: VoiceGenerationStatusData;
  templateSaves: unknown[];
  scriptSaves: Array<{
    script: VideoProject["script"];
    expectedRevision: number;
  }>;
  overlaySaves: Array<{
    overlays: VideoProject["overlays"];
    expectedRevision: number;
  }>;
  visualAssignmentUpdates: Array<{
    assetId: string;
    assetVersion?: number;
  }>;
  visualAssignmentSplits: Array<{
    assignmentId: string;
    selectedLineId: string;
    assetId: string;
    assetVersion?: number;
  }>;
  assetCatalog?: readonly AssetDetail[];
  templateDetailRequests: number;
};

type BrowserRect = {
  readonly height: number;
  readonly right: number;
  readonly width: number;
};

type BrowserFocusable = {
  hasAttribute(name: string): boolean;
};

type BrowserComputedStyle = {
  readonly fontSize: string;
  getPropertyValue(property: string): string;
};

type BrowserElement = {
  readonly children: ArrayLike<{
    getBoundingClientRect(): BrowserRect;
  }>;
  readonly clientWidth: number;
  readonly ownerDocument: {
    readonly activeElement: unknown;
    readonly defaultView: {
      getComputedStyle(element: unknown): BrowserComputedStyle;
    } | null;
  };
  readonly scrollWidth: number;
  contains(node: unknown): boolean;
  getBoundingClientRect(): BrowserRect;
  querySelector(selector: string): BrowserElement | null;
  querySelectorAll(selector: string): ArrayLike<BrowserFocusable>;
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
    glowColor: visualId === "character-mentor" ? "#e78ac3" : "#75c97a",
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

function createMediaWorkflowProjectFixture(): VideoProject {
  const project = createScreenTemplateProjectFixture();
  const main = project.script.sections.find(
    (section) => section.id === "section-main"
  );
  if (main === undefined) {
    throw new Error("media workflow main section is missing");
  }
  const finalLine = main.lines.at(-1);
  if (finalLine === undefined) {
    throw new Error("media workflow final line is missing");
  }
  main.lines = [
    ...main.lines,
    {
      ...finalLine,
      id: "main-learner-2",
      speakerId: "character-learner",
      spokenText: "これで操作は完了なのだ。",
      subtitleText: "これで操作は完了です。",
      characterVariantId: "character-learner-speak-normal-v1"
    }
  ];
  project.visuals.assignments = project.visuals.assignments.filter(
    (assignment) => assignment.id !== "visual-main-photo"
  );
  return project;
}

function createSectionEndAppendMediaWorkflowProjectFixture(): VideoProject {
  const project = createScreenTemplateProjectFixture();
  const main = project.script.sections.find(
    (section) => section.id === "section-main"
  );
  if (main === undefined) {
    throw new Error("section-end append main section is missing");
  }
  main.lines = main.lines.filter((line) => line.id !== "main-mentor-2");
  project.visuals.assignments = project.visuals.assignments.filter(
    (assignment) => assignment.id !== "visual-main-photo"
  );
  return project;
}

function createMediaReplacementAsset(project: VideoProject): AssetDetail {
  const videoAssignment = project.visuals.assignments.find(
    (assignment) => assignment.display.kind === "video"
  );
  if (videoAssignment === undefined) {
    throw new Error("media workflow video assignment is missing");
  }
  return {
    ...assetForAssignment({
      ...videoAssignment,
      id: "media-replacement-source",
      assetId: "asset-media-replacement",
      assetChecksum: "b".repeat(64)
    }),
    title: "差し替え用動画"
  };
}

function createMediaSplitAsset(project: VideoProject): AssetDetail {
  const source = project.visuals.assignments.find(
    (assignment) => assignment.id === "visual-main-photo"
  );
  if (source === undefined) {
    throw new Error("media workflow photo assignment is missing");
  }
  return {
    ...assetForAssignment({
      ...source,
      id: "media-split-source",
      assetId: "asset-media-split"
    }),
    title: "境界切り替え用静止画"
  };
}

function voiceStatus(project: VideoProject): VoiceGenerationStatusData {
  return {
    available: true,
    lines: project.script.sections.flatMap((section) =>
      section.lines.map((line) => ({
        lineId: line.id,
        status: "current" as const,
        audioPath: `projects/${project.metadata.id}/audio/voice/${line.id}.wav`
      }))
    ),
    jobs: []
  };
}

function voiceAdjustmentSnapshot(lineId: string): VoiceAdjustmentSnapshot {
  return {
    lineId,
    status: "current",
    query: createVoicevoxAudioQueryFixture(),
    adjustment: null,
    currentBase: {
      baseHash: "a".repeat(64),
      resolvedSpokenText: "内容を確認してから登録します。",
      speakerUuid: "speaker-fixture-uuid",
      styleName: "ノーマル",
      resolvedStyleId: syntheticVoicevoxStyleId(),
      voicevoxEngineVersion: "engine-fixture-1"
    }
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
  for (const detail of state.assetCatalog ?? []) {
    assets.set(detail.assetId, detail);
  }

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
      request.method() === "PUT" &&
      pathname === `/api/projects/${projectId}/overlays`
    ) {
      const body = JSON.parse(request.postData() ?? "{}") as {
        overlays: VideoProject["overlays"];
        expectedRevision: number;
      };
      state.overlaySaves.push(body);
      state.project = {
        ...state.project,
        overlays: body.overlays,
        revision: state.project.revision + 1
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
    if (
      request.method() === "GET" &&
      pathname === `/api/projects/${projectId}/voice/status`
    ) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: state.voiceStatusOverride ?? voiceStatus(state.project)
        })
      });
      return;
    }
    const voiceAdjustmentMatch = pathname.match(
      new RegExp(`^/api/projects/${projectId}/voice/adjustments/([^/]+)$`, "u")
    );
    if (request.method() === "GET" && voiceAdjustmentMatch !== null) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: voiceAdjustmentSnapshot(
            decodeURIComponent(voiceAdjustmentMatch[1]!)
          )
        })
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
      const { project: editedProject } = applyEditedScript(
        state.project,
        body.script
      );
      state.project = {
        ...editedProject,
        revision: state.project.revision + 1
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
      const requestedKind = url.searchParams.get("kind");
      const searchQuery = url.searchParams.get("q")?.toLocaleLowerCase();
      const items = [...assets.values()]
        .filter(
          (asset) =>
            (requestedKind === null || asset.kind === requestedKind) &&
            (searchQuery === undefined ||
              searchQuery.length === 0 ||
              asset.assetId.toLocaleLowerCase().includes(searchQuery) ||
              asset.title.toLocaleLowerCase().includes(searchQuery))
        )
        .map(listItem);
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
    const visualAssignmentSplitMatch = pathname.match(
      new RegExp(
        `^/api/projects/${projectId}/visual-assignments/([^/]+)/split$`,
        "u"
      )
    );
    if (request.method() === "POST" && visualAssignmentSplitMatch !== null) {
      const assignmentId = decodeURIComponent(visualAssignmentSplitMatch[1]!);
      const body = JSON.parse(request.postData() ?? "{}") as {
        assignment: Pick<VisualAssignment, "id" | "assetId" | "display">;
        expectedRevision: number;
        selectedLineId: string;
        assetVersion?: number;
        removeOutsidePlaybackCues?: boolean;
      };
      const currentAssignments = state.project.visuals.assignments;
      const currentIndex = currentAssignments.findIndex(
        (candidate) => candidate.id === assignmentId
      );
      const current = currentAssignments[currentIndex];
      const asset = assets.get(body.assignment.assetId);
      const section = state.project.script.sections.find((candidate) =>
        candidate.lines.some((line) => line.id === body.selectedLineId)
      );
      const selectedIndex =
        section?.lines.findIndex((line) => line.id === body.selectedLineId) ??
        -1;
      const previousLine = section?.lines[selectedIndex - 1];
      const sectionEnd = section?.lines.at(-1);
      if (
        current === undefined ||
        asset === undefined ||
        asset.checksum === null ||
        section === undefined ||
        selectedIndex < 0 ||
        sectionEnd === undefined
      ) {
        await route.fulfill(errorResponse(404, "visual assignment missing"));
        return;
      }
      state.visualAssignmentSplits.push({
        assignmentId,
        selectedLineId: body.selectedLineId,
        assetId: body.assignment.assetId,
        assetVersion: body.assetVersion
      });
      const replacement: VisualAssignment = {
        ...body.assignment,
        startLineId: body.selectedLineId,
        endLineId: sectionEnd.id,
        assetChecksum: asset.checksum,
        projectMediaPath: `media/${asset.assetId}.png`
      };
      const nextAssignments =
        selectedIndex === 0 || previousLine === undefined
          ? currentAssignments.map((candidate, index) =>
              index === currentIndex
                ? { ...replacement, id: current.id }
                : candidate
            )
          : currentAssignments.flatMap((candidate, index) =>
              index === currentIndex
                ? [{ ...current, endLineId: previousLine.id }, replacement]
                : [candidate]
            );
      state.project = {
        ...state.project,
        revision: state.project.revision + 1,
        visuals: { ...state.project.visuals, assignments: nextAssignments }
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
    const visualAssignmentMatch = pathname.match(
      new RegExp(
        `^/api/projects/${projectId}/visual-assignments(?:/([^/]+))?$`,
        "u"
      )
    );
    if (request.method() === "PUT" && visualAssignmentMatch !== null) {
      const assignmentIdFromPath = visualAssignmentMatch[1]
        ? decodeURIComponent(visualAssignmentMatch[1])
        : undefined;
      const body = JSON.parse(request.postData() ?? "{}") as {
        assignment: Pick<
          VisualAssignment,
          "id" | "startLineId" | "endLineId" | "assetId" | "display"
        >;
        expectedRevision: number;
        assetVersion?: number;
      };
      state.visualAssignmentUpdates.push({
        assetId: body.assignment.assetId,
        assetVersion: body.assetVersion
      });
      const asset = assets.get(body.assignment.assetId);
      if (asset?.checksum === null || asset === undefined) {
        await route.fulfill(errorResponse(404, "visual asset missing"));
        return;
      }
      const assignment: VisualAssignment = {
        ...body.assignment,
        assetChecksum: asset.checksum,
        projectMediaPath: `media/${asset.assetId}.${
          asset.kind === "video"
            ? "mp4"
            : asset.kind === "document_scan"
              ? "pdf"
              : "png"
        }`
      };
      const currentAssignments = state.project.visuals.assignments;
      const existingIndex = currentAssignments.findIndex(
        (candidate) => candidate.id === body.assignment.id
      );
      if (assignmentIdFromPath === undefined && existingIndex >= 0) {
        await route.fulfill(
          errorResponse(409, "visual assignment already exists")
        );
        return;
      }
      if (
        assignmentIdFromPath !== undefined &&
        (assignmentIdFromPath !== body.assignment.id || existingIndex < 0)
      ) {
        await route.fulfill(errorResponse(404, "visual assignment missing"));
        return;
      }
      const assignments =
        existingIndex < 0
          ? [...currentAssignments, assignment]
          : currentAssignments.map((candidate, index) =>
              index === existingIndex ? assignment : candidate
            );
      state.project = {
        ...state.project,
        revision: state.project.revision + 1,
        visuals: { ...state.project.visuals, assignments }
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
      overlaySaves: [],
      visualAssignmentUpdates: [],
      visualAssignmentSplits: [],
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

  async function openScript(
    project = createScreenTemplateProjectFixture(),
    assetCatalog: readonly AssetDetail[] = [],
    voiceStatusOverride?: VoiceGenerationStatusData
  ): Promise<{
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
      project,
      voiceStatusOverride,
      templateSaves: [],
      scriptSaves: [],
      overlaySaves: [],
      visualAssignmentUpdates: [],
      visualAssignmentSplits: [],
      assetCatalog,
      templateDetailRequests: 0
    };
    await installApiRoutes(page, state);
    await page.setViewportSize({ width: 1800, height: 1000 });
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

  async function renderEndedMediaPane(page: Page): Promise<void> {
    await page.setContent('<div id="ended-media-pane-fixture"></div>');
    await page.evaluate(async (baseUrl) => {
      const mainSource = await fetch(`${baseUrl}/main.tsx`).then((response) =>
        response.text()
      );
      const moduleUrl = (pattern: RegExp): string => {
        const match = pattern.exec(mainSource)?.[1];
        if (match === undefined) {
          throw new Error(`Vite module URL is missing: ${pattern}`);
        }
        return new URL(match, baseUrl).href;
      };
      const dynamicImport = (url: string): Promise<unknown> =>
        new Function("url", "return import(url);")(url) as Promise<unknown>;
      const [reactModule, reactDomModule, paneModule] = await Promise.all([
        dynamicImport(moduleUrl(/from "([^"]*react\.js\?v=[^"]+)"/u)),
        dynamicImport(
          moduleUrl(/from "([^"]*react-dom_client\.js\?v=[^"]+)"/u)
        ),
        dynamicImport(`${baseUrl}/ScriptMediaPane.tsx`)
      ]);
      const { ScriptMediaPane } = paneModule as {
        ScriptMediaPane: unknown;
      };
      const reactExports = reactModule as {
        createElement?: (
          type: unknown,
          props: Record<string, unknown> | null
        ) => unknown;
        default?: {
          createElement?: (
            type: unknown,
            props: Record<string, unknown> | null
          ) => unknown;
        };
      };
      const reactDomExports = reactDomModule as {
        createRoot?: (container: unknown) => {
          render(element: unknown): void;
        };
        default?: {
          createRoot?: (container: unknown) => {
            render(element: unknown): void;
          };
        };
      };
      const createElement =
        reactExports.createElement ?? reactExports.default?.createElement;
      const createRoot =
        reactDomExports.createRoot ?? reactDomExports.default?.createRoot;
      if (createElement === undefined || createRoot === undefined) {
        throw new Error("React browser exports are missing");
      }
      const assignment = {
        id: "ended-assignment",
        startLineId: "line-one",
        endLineId: "line-three",
        assetId: "asset-ended",
        assetChecksum: "a".repeat(64),
        projectMediaPath: "media/ended.mp4",
        display: {
          kind: "video",
          playbackCues: []
        }
      };
      const asset = {
        assetId: "asset-ended",
        version: 1,
        kind: "video",
        title: "ended browser asset",
        thumbnailPaths: [],
        durationMs: 1_000
      };
      const browserDocument = (
        globalThis as unknown as {
          document: {
            getElementById(id: string): unknown;
          };
        }
      ).document;
      const fixture = browserDocument.getElementById(
        "ended-media-pane-fixture"
      );
      if (fixture === null) {
        throw new Error("ended media pane fixture is missing");
      }
      createRoot(fixture).render(
        createElement(ScriptMediaPane, {
          line: { id: "line-two" },
          assignments: [assignment],
          presentationStates: [
            {
              assignmentId: assignment.id,
              assetId: assignment.assetId,
              assetChecksum: assignment.assetChecksum,
              projectMediaPath: assignment.projectMediaPath,
              lifecycle: "ended",
              display: assignment.display,
              assetResolution: "resolved",
              playbackIssues: []
            }
          ],
          assets: new Map([
            [`${assignment.assetId}:${assignment.projectMediaPath}`, asset]
          ]),
          isPending: false,
          onStart: () => undefined,
          onPause: () => undefined,
          onResume: () => undefined,
          onEnd: () => undefined,
          onReplace: () => undefined,
          onSplit: () => undefined
        })
      );
    }, webUrl);
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
    "saves the same overlay kind on two ScriptPage lines with project-wide unique ids",
    { timeout: 60_000 },
    async () => {
      const { context, page, state } = await openScript();
      try {
        const saveOverlayForLine = async (lineId: string): Promise<string> => {
          const lineCard = page.locator(
            `.script-line-card[aria-label="セリフ ${lineId}"]`
          );
          await lineCard
            .getByRole("button", {
              name: `${lineId}のオーバーレイを編集`,
              exact: true
            })
            .click();
          const dialog = page.getByRole("dialog", {
            name: `${lineId} の画面注釈`,
            exact: true
          });
          await dialog.waitFor({ state: "visible" });
          await dialog
            .getByRole("button", { name: "+ 円", exact: true })
            .click();
          const item = dialog.locator(".line-overlay-editor-item");
          await item.waitFor({ state: "visible" });
          const itemLabel = await item.getAttribute("aria-label");
          const idMatch = /^円 (.+)$/u.exec(itemLabel ?? "");
          if (idMatch?.[1] === undefined) {
            throw new Error(`overlay id is missing for ${lineId}`);
          }

          const saveResponse = page.waitForResponse(
            (response) =>
              response.request().method() === "PUT" &&
              new URL(response.url()).pathname ===
                `/api/projects/${projectId}/overlays`
          );
          await dialog
            .getByRole("button", {
              name: "このセリフの注釈を保存",
              exact: true
            })
            .click();
          await saveResponse;
          await dialog.waitFor({ state: "hidden" });
          return idMatch[1];
        };

        const firstId = await saveOverlayForLine("main-mentor-1");
        const secondId = await saveOverlayForLine("main-learner-1");

        expect(firstId).not.toBe(secondId);
        expect(state.overlaySaves).toHaveLength(2);
        expect(state.overlaySaves.map((save) => save.expectedRevision)).toEqual(
          [0, 1]
        );
        expect(state.project.overlays.lineOverlays).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: firstId,
              kind: "circle",
              lineId: "main-mentor-1"
            }),
            expect.objectContaining({
              id: secondId,
              kind: "circle",
              lineId: "main-learner-1"
            })
          ])
        );
        expect(
          new Set(
            state.project.overlays.lineOverlays.map((overlay) => overlay.id)
          )
        ).toHaveLength(2);

        await page.reload({ waitUntil: "domcontentloaded" });
        await page.locator("#section-main-screen-template").waitFor({
          state: "visible"
        });

        const persistedOverlayIdForLine = async (
          lineId: string
        ): Promise<string> => {
          const lineCard = page.locator(
            `.script-line-card[aria-label="セリフ ${lineId}"]`
          );
          await lineCard
            .getByRole("button", {
              name: `${lineId}のオーバーレイを編集`,
              exact: true
            })
            .click();
          const dialog = page.getByRole("dialog", {
            name: `${lineId} の画面注釈`,
            exact: true
          });
          await dialog.waitFor({ state: "visible" });
          const itemLabel = await dialog
            .locator(".line-overlay-editor-item")
            .getAttribute("aria-label");
          await dialog.getByRole("button", { name: "キャンセル" }).click();
          await dialog.waitFor({ state: "hidden" });
          const idMatch = /^円 (.+)$/u.exec(itemLabel ?? "");
          if (idMatch?.[1] === undefined) {
            throw new Error(`persisted overlay id is missing for ${lineId}`);
          }
          return idMatch[1];
        };

        expect(await persistedOverlayIdForLine("main-mentor-1")).toBe(firstId);
        expect(await persistedOverlayIdForLine("main-learner-1")).toBe(
          secondId
        );
      } finally {
        await context.close();
      }
    }
  );

  it(
    "keeps section-only template selection and actual previews through ScriptPage autosave",
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
        const firstLineCard = page.locator(
          '.script-line-card[aria-label="セリフ main-mentor-1"]'
        );
        const introLineCard = page.locator(
          '.script-line-card[aria-label="セリフ intro-mentor-1"]'
        );
        expect(await lineCard.textContent()).toContain(
          "内容を確認してから登録します。"
        );
        const introMediaPane = introLineCard.locator(".script-line-media-pane");
        await introMediaPane.waitFor({ state: "visible" });
        expect(await introMediaPane.getAttribute("aria-label")).toContain(
          "playing（再生中）"
        );
        expect(
          await introMediaPane.getByRole("button", { name: "一時停止" }).count()
        ).toBe(1);
        expect(
          await introMediaPane
            .getByRole("button", { name: "一時停止" })
            .isDisabled()
        ).toBe(true);
        expect(
          await introMediaPane.getByRole("button", { name: "再開" }).count()
        ).toBe(0);
        expect(
          await lineCard
            .locator(".script-line-media-pane")
            .getByRole("button", { name: "一時停止" })
            .count()
        ).toBe(0);
        expect(
          await lineCard
            .locator(".script-line-media-pane")
            .getByRole("button", { name: "再開" })
            .count()
        ).toBe(0);
        const staticMediaPane = lineCard.locator(".script-line-media-pane");
        expect(
          await staticMediaPane
            .getByRole("button", {
              name: "停止",
              exact: true
            })
            .count()
        ).toBe(1);
        expect(
          await staticMediaPane
            .getByRole("button", {
              name: "変更",
              exact: true
            })
            .count()
        ).toBe(1);
        expect(await staticMediaPane.locator("video").count()).toBe(0);
        expect(await staticMediaPane.locator("img").count()).toBe(1);
        expect(
          await firstLineCard
            .locator(
              '.script-line-card-full-preview img[src*="/api/character-visuals/"]'
            )
            .count()
        ).toBe(2);
        expect(
          await firstLineCard
            .locator(
              '.script-line-card-full-preview img[src*="application-system.png"]'
            )
            .count()
        ).toBe(1);
        expect(
          await lineCard.locator(".script-line-card-full-preview").count()
        ).toBe(0);
        expect(
          await lineCard.locator(".script-line-card-dialogue-preview").count()
        ).toBe(1);
        const alternateCompactPreview = lineCard.locator(
          ".script-line-card-dialogue-preview"
        );
        await alternateCompactPreview.waitFor({ state: "visible" });
        const alternateCompactBox = await alternateCompactPreview.boundingBox();
        if (alternateCompactBox === null) {
          throw new Error("alternate compact preview bounds are missing");
        }
        const alternateTemplate =
          createStandardAndAlternateTemplateSnapshot()[1]!;
        const alternateDialogueElement = alternateTemplate.elements.find(
          (element) => element.type === "dialogue-window"
        );
        if (alternateDialogueElement === undefined) {
          throw new Error("alternate dialogue element is missing");
        }
        const alternateDialogueBounds = screenLayoutElementBounds(
          alternateDialogueElement,
          alternateTemplate.canvasWidth,
          alternateTemplate.canvasHeight
        );
        const alternateDialogueAspectRatio =
          (alternateDialogueBounds.width * alternateTemplate.canvasWidth) /
          (alternateDialogueBounds.height * alternateTemplate.canvasHeight);
        const alternateCompactTypography =
          await alternateCompactPreview.evaluate((element) => {
            const browserElement = element as unknown as BrowserElement;
            const canvas = browserElement.querySelector(
              ".screen-layout-dialogue-only-canvas"
            );
            const dialogue = browserElement.querySelector(
              ".screen-layout-dialogue-card"
            );
            const view = browserElement.ownerDocument.defaultView;
            if (canvas === null || dialogue === null || view === null) {
              throw new Error("alternate compact dialogue markup is missing");
            }
            const dialogueStyle = view.getComputedStyle(dialogue);
            return {
              canvasWidth: canvas.getBoundingClientRect().width,
              fontSize: Number.parseFloat(dialogueStyle.fontSize),
              innerContainerType: view
                .getComputedStyle(canvas)
                .getPropertyValue("container-type")
            };
          });
        expect(
          alternateCompactBox.width / alternateCompactBox.height
        ).toBeCloseTo(alternateDialogueAspectRatio, 2);
        expect(alternateCompactTypography.innerContainerType).toBe(
          "inline-size"
        );
        expect(alternateCompactTypography.fontSize).toBeCloseTo(
          (alternateCompactTypography.canvasWidth *
            alternateDialogueElement.fontSize) /
            alternateTemplate.canvasWidth,
          1
        );
        const scriptPageLayout = await page
          .locator(".script-editor-page")
          .evaluate((element) => {
            const pageElement = element as unknown as BrowserElement;
            return {
              clientWidth: pageElement.clientWidth,
              scrollWidth: pageElement.scrollWidth
            };
          });
        expect(scriptPageLayout.clientWidth).toBeGreaterThanOrEqual(1450);
        expect(scriptPageLayout.clientWidth).toBeLessThanOrEqual(1500);
        expect(scriptPageLayout.scrollWidth).toBeLessThanOrEqual(
          scriptPageLayout.clientWidth
        );
        expect(
          await page.locator(".script-production-main").evaluate((element) => {
            const main = element as unknown as BrowserElement;
            return main.clientWidth;
          })
        ).toBeGreaterThanOrEqual(1400);
        await page.setViewportSize({ width: 600, height: 900 });
        const narrowPageLayout = await page
          .locator("body")
          .evaluate((element) => {
            const body = element as unknown as BrowserElement;
            return {
              clientWidth: body.clientWidth,
              scrollWidth: body.scrollWidth
            };
          });
        expect(narrowPageLayout.scrollWidth).toBeLessThanOrEqual(
          narrowPageLayout.clientWidth
        );
        await page.setViewportSize({ width: 1800, height: 1000 });
        expect(await lineCard.locator(".script-line-text-row").count()).toBe(2);
        expect(
          await lineCard.locator(".script-line-primary-controls").count()
        ).toBe(1);
        expect(await lineCard.locator(".script-line-action-row").count()).toBe(
          1
        );
        expect(
          await lineCard.locator(".script-line-details-dialog").count()
        ).toBe(0);
        expect(await lineCard.locator("audio[controls]").count()).toBe(0);
        expect(
          await lineCard
            .locator(
              'audio[src*="/api/projects/manual-video-project/files/audio/voice/main-learner-1.wav"]'
            )
            .count()
        ).toBe(1);
        expect(
          await lineCard
            .getByRole("button", {
              name: "main-learner-1の音声を再生",
              exact: true
            })
            .count()
        ).toBe(1);
        const primaryRowLayout = await lineCard
          .locator(".script-line-primary-row")
          .evaluate((element) => {
            const row = element as unknown as BrowserElement;
            const bounds = row.getBoundingClientRect();
            const childBounds = Array.from(row.children).map((child) =>
              child.getBoundingClientRect()
            );
            return {
              clientWidth: row.clientWidth,
              maxChildRight: Math.max(
                ...childBounds.map((child) => child.right)
              ),
              rowRight: bounds.right,
              scrollWidth: row.scrollWidth
            };
          });
        expect(primaryRowLayout.scrollWidth).toBeLessThanOrEqual(
          primaryRowLayout.clientWidth
        );
        expect(primaryRowLayout.maxChildRight).toBeLessThanOrEqual(
          primaryRowLayout.rowRight + 1
        );
        await firstLineCard
          .locator(
            '.script-line-card-full-preview img[src*="/api/assets/asset-application-form/"]'
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
        await page
          .locator("#section-main-screen-template")
          .selectOption(ALTERNATE_SCREEN_TEMPLATE_ID);
        await waitForScriptSave();
        const savedMainLine = state.scriptSaves
          .at(-1)
          ?.script.sections.find(
            (section: { id: string }) => section.id === "section-main"
          )
          ?.lines.find((line: { id: string }) => line.id === "main-learner-1");
        expect(savedMainLine).not.toHaveProperty("screenTemplateId");

        await page.reload({ waitUntil: "domcontentloaded" });
        await page.locator("#section-main-screen-template").waitFor({
          state: "visible"
        });
        expect(
          await page.locator("#section-main-screen-template").inputValue()
        ).toBe(ALTERNATE_SCREEN_TEMPLATE_ID);
        await lineCard.waitFor({ state: "visible" });

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
          .getByRole("button", { name: "音声調整" })
          .first()
          .waitFor({ state: "visible" });
        const adjustmentTrigger = lineCard.getByRole("button", {
          name: "音声調整"
        });
        await adjustmentTrigger.focus();
        expect(
          await adjustmentTrigger.evaluate(
            (element) =>
              (element as unknown as BrowserElement).ownerDocument
                .activeElement === element
          )
        ).toBe(true);
        await adjustmentTrigger.click();
        const voiceDialog = page.getByRole("dialog", {
          name: "セリフ main-learner-1"
        });
        await voiceDialog.waitFor({ state: "visible" });
        expect(await voiceDialog.locator("h2").textContent()).toContain(
          "セリフ main-learner-1"
        );
        await voiceDialog.getByRole("tab", { name: "基本" }).waitFor({
          state: "visible"
        });
        const focusableCount = await voiceDialog.evaluate((dialog) => {
          const dialogElement = dialog as unknown as BrowserElement;
          return Array.from(
            dialogElement.querySelectorAll(
              'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
            )
          ).filter((element) => !element.hasAttribute("disabled")).length;
        });
        expect(focusableCount).toBeGreaterThan(1);
        const closeButton = voiceDialog.getByRole("button", {
          name: "閉じる"
        });
        expect(
          await closeButton.evaluate(
            (element) =>
              (element as unknown as BrowserElement).ownerDocument
                .activeElement === element
          )
        ).toBe(true);
        await page.keyboard.press("Shift+Tab");
        expect(
          await voiceDialog.evaluate((dialog) => {
            const dialogElement = dialog as unknown as BrowserElement;
            return dialogElement.contains(
              dialogElement.ownerDocument.activeElement
            );
          })
        ).toBe(true);
        await page.keyboard.press("Tab");
        expect(
          await closeButton.evaluate(
            (element) =>
              (element as unknown as BrowserElement).ownerDocument
                .activeElement === element
          )
        ).toBe(true);
        await page.keyboard.press("Tab");
        expect(
          await voiceDialog.evaluate((dialog) => {
            const dialogElement = dialog as unknown as BrowserElement;
            return dialogElement.contains(
              dialogElement.ownerDocument.activeElement
            );
          })
        ).toBe(true);
        await page.keyboard.press("Escape");
        await voiceDialog.waitFor({ state: "detached" });
        expect(
          await adjustmentTrigger.evaluate(
            (element) =>
              (element as unknown as BrowserElement).ownerDocument
                .activeElement === element
          )
        ).toBe(true);

        const detailsTrigger = lineCard.getByRole("button", {
          name: "詳細設定"
        });
        await detailsTrigger.focus();
        await detailsTrigger.click();
        const detailsDialog = page.getByRole("dialog", {
          name: "セリフ main-learner-1の詳細設定"
        });
        await detailsDialog.waitFor({ state: "visible" });
        expect(
          await detailsDialog.locator("#main-learner-1-expression").count()
        ).toBe(1);
        const detailsCloseButton = detailsDialog.getByRole("button", {
          name: "閉じる"
        });
        expect(
          await detailsCloseButton.evaluate(
            (element) =>
              (element as unknown as BrowserElement).ownerDocument
                .activeElement === element
          )
        ).toBe(true);
        await page.keyboard.press("Shift+Tab");
        expect(
          await detailsDialog.evaluate((dialog) => {
            const dialogElement = dialog as unknown as BrowserElement;
            return dialogElement.contains(
              dialogElement.ownerDocument.activeElement
            );
          })
        ).toBe(true);
        await page.keyboard.press("Tab");
        expect(
          await detailsCloseButton.evaluate(
            (element) =>
              (element as unknown as BrowserElement).ownerDocument
                .activeElement === element
          )
        ).toBe(true);
        await page.keyboard.press("Escape");
        await detailsDialog.waitFor({ state: "detached" });
        expect(
          await detailsTrigger.evaluate(
            (element) =>
              (element as unknown as BrowserElement).ownerDocument
                .activeElement === element
          )
        ).toBe(true);
      } finally {
        await context.close();
      }
    }
  );

  it(
    "keeps an unassigned media pane to a single insert action",
    { timeout: 60_000 },
    async () => {
      const project = createScreenTemplateProjectFixture();
      project.visuals.assignments = project.visuals.assignments.filter(
        (assignment) => assignment.id !== "visual-outro-document"
      );
      const { context, page } = await openScript(project);
      try {
        const emptyPane = page.locator(
          '.script-line-card[aria-label="セリフ outro-mentor-1"] .script-line-media-pane'
        );
        await emptyPane.waitFor({ state: "visible" });
        expect(await emptyPane.getAttribute("aria-label")).toContain(
          "素材未挿入"
        );
        expect(
          await emptyPane.getByRole("button", { name: "素材を挿入" }).count()
        ).toBe(1);
        expect(await emptyPane.locator("header, h3, p, dl").count()).toBe(0);
      } finally {
        await context.close();
      }
    }
  );

  it(
    "keeps ended media actionable without pause or resume controls",
    { timeout: 60_000 },
    async () => {
      const { context, page } = await openScript();
      try {
        await renderEndedMediaPane(page);
        const pane = page.locator(
          "#ended-media-pane-fixture .script-line-media-pane"
        );
        await pane.waitFor({ state: "visible" });
        expect(await pane.getAttribute("data-lifecycle")).toBe("ended");
        expect(
          await pane.getByRole("button", { name: "停止", exact: true }).count()
        ).toBe(1);
        expect(
          await pane.getByRole("button", { name: "変更", exact: true }).count()
        ).toBe(1);
        expect(
          await pane
            .getByRole("button", { name: "停止", exact: true })
            .isEnabled()
        ).toBe(true);
        expect(
          await pane.getByRole("button", { name: "一時停止" }).count()
        ).toBe(0);
        expect(await pane.getByRole("button", { name: "再開" }).count()).toBe(
          0
        );
        expect(await pane.locator("video").count()).toBe(1);
      } finally {
        await context.close();
      }
    }
  );

  it(
    "keeps fallback voice line statuses visible while VOICEVOX is unavailable",
    { timeout: 60_000 },
    async () => {
      const project = createScreenTemplateProjectFixture();
      const voiceStatusOverride: VoiceGenerationStatusData = {
        available: false,
        unavailableCode: "VOICEVOX_ENGINE_UNAVAILABLE",
        lines: project.script.sections.flatMap((section) =>
          section.lines.map((line) => ({
            lineId: line.id,
            status:
              line.id === "main-learner-1"
                ? ("generating" as const)
                : line.id === "main-mentor-1"
                  ? ("failed" as const)
                  : ("stale" as const),
            ...(line.id === "main-mentor-1"
              ? { errorCode: "VOICEVOX_GENERATION_FAILED" }
              : {})
          }))
        ),
        jobs: []
      };
      const { context, page } = await openScript(
        project,
        [],
        voiceStatusOverride
      );
      try {
        const generatingStatus = page.locator(
          '.script-line-card[aria-label="セリフ main-learner-1"] .voice-status'
        );
        const failedStatus = page.locator(
          '.script-line-card[aria-label="セリフ main-mentor-1"] .voice-status'
        );
        const staleStatus = page.locator(
          '.script-line-card[aria-label="セリフ main-mentor-2"] .voice-status'
        );
        await generatingStatus.waitFor({ state: "visible" });
        expect(await generatingStatus.getAttribute("aria-label")).toBe(
          "音声状態: 生成中"
        );
        expect(await failedStatus.getAttribute("aria-label")).toBe(
          "音声状態: 失敗"
        );
        expect(await staleStatus.getAttribute("aria-label")).toBe(
          "音声状態: 再生成が必要"
        );
        expect(await page.locator(".message-panel-warning").count()).toBe(1);
      } finally {
        await context.close();
      }
    }
  );

  it(
    "extends a started video assignment through ScriptPage appends and reload",
    { timeout: 60_000 },
    async () => {
      const project = createSectionEndAppendMediaWorkflowProjectFixture();
      const { context, page, state } = await openScript(project);
      try {
        const startLineCard = page.locator(
          '.script-line-card[aria-label="セリフ main-mentor-1"]'
        );
        await startLineCard.getByRole("button", { name: "素材を挿入" }).click();
        const startPicker = page.getByRole("dialog", {
          name: "表示素材を選択"
        });
        await startPicker.waitFor({ state: "visible" });
        const startItem = startPicker.locator("li").filter({
          hasText: "visual-intro-video browser asset"
        });
        const startSave = page.waitForResponse(
          (response) =>
            response.request().method() === "PUT" &&
            new URL(response.url()).pathname.startsWith(
              `/api/projects/${projectId}/visual-assignments`
            )
        );
        await startItem.getByRole("button", { name: "この素材を選択" }).click();
        await startSave;

        const createdAssignment = state.project.visuals.assignments.find(
          (assignment) => assignment.startLineId === "main-mentor-1"
        );
        if (createdAssignment === undefined) {
          throw new Error("section-end append assignment was not created");
        }
        const createdAssignmentId = createdAssignment.id;
        expect(createdAssignment.endLineId).toBe("main-learner-1");

        const mainSectionCard = page
          .locator(".script-section-card")
          .filter({ hasText: "section-main" })
          .first();
        const waitForScriptSave = () =>
          page.waitForResponse(
            (response) =>
              response.request().method() === "PUT" &&
              new URL(response.url()).pathname ===
                `/api/projects/${projectId}/script`
          );
        const appendLine = async (lineId: string): Promise<void> => {
          await mainSectionCard
            .getByRole("button", { name: "セリフを追加" })
            .click();
          const lineCard = page.locator(
            `.script-line-card[aria-label="セリフ ${lineId}"]`
          );
          await lineCard.waitFor({ state: "visible" });
          const scriptSave = waitForScriptSave();
          await lineCard.locator(`#${lineId}-subtitle`).fill("追加字幕");
          await lineCard
            .locator(`#${lineId}-spoken`)
            .fill("追加された読み上げ");
          await scriptSave;
        };

        await appendLine("draft-line-1");
        expect(
          state.project.visuals.assignments.find(
            (assignment) => assignment.id === createdAssignmentId
          )
        ).toMatchObject({
          id: createdAssignmentId,
          startLineId: "main-mentor-1",
          endLineId: "draft-line-1"
        });

        await appendLine("draft-line-2");
        expect(
          state.project.visuals.assignments.find(
            (assignment) => assignment.id === createdAssignmentId
          )
        ).toMatchObject({
          id: createdAssignmentId,
          startLineId: "main-mentor-1",
          endLineId: "draft-line-2"
        });
        expect(state.visualAssignmentUpdates).toHaveLength(1);

        await page.reload({ waitUntil: "domcontentloaded" });
        await page.locator("#section-main-screen-template").waitFor({
          state: "visible"
        });
        for (const lineId of ["draft-line-1", "draft-line-2"]) {
          const mediaPane = page
            .locator(`.script-line-card[aria-label="セリフ ${lineId}"]`)
            .locator(".script-line-media-pane");
          await mediaPane.waitFor({ state: "visible" });
          expect(await mediaPane.getAttribute("aria-label")).toContain(
            "playing（再生中）"
          );
          expect(await mediaPane.locator("video").count()).toBe(1);
        }
        expect(
          state.project.visuals.assignments.find(
            (assignment) => assignment.id === createdAssignmentId
          )
        ).toMatchObject({
          id: createdAssignmentId,
          startLineId: "main-mentor-1",
          endLineId: "draft-line-2"
        });
      } finally {
        await context.close();
      }
    }
  );

  it(
    "persists the media pane start, pause, resume, end, replace, and reload flow",
    { timeout: 60_000 },
    async () => {
      const mediaProject = createMediaWorkflowProjectFixture();
      const replacementAsset = createMediaReplacementAsset(mediaProject);
      const { context, page, state } = await openScript(mediaProject, [
        replacementAsset
      ]);
      try {
        const startLineCard = page.locator(
          '.script-line-card[aria-label="セリフ main-mentor-1"]'
        );
        const pauseLineCard = page.locator(
          '.script-line-card[aria-label="セリフ main-learner-1"]'
        );
        const resumeEndLineCard = page.locator(
          '.script-line-card[aria-label="セリフ main-mentor-2"]'
        );
        const waitForVisualSave = () =>
          page.waitForResponse(
            (response) =>
              response.request().method() === "PUT" &&
              new URL(response.url()).pathname.startsWith(
                `/api/projects/${projectId}/visual-assignments`
              )
          );

        await startLineCard.getByRole("button", { name: "素材を挿入" }).click();
        const startPicker = page.getByRole("dialog", {
          name: "表示素材を選択"
        });
        await startPicker.waitFor({ state: "visible" });
        const startItem = startPicker.locator("li").filter({
          hasText: "visual-intro-video browser asset"
        });
        const startSave = waitForVisualSave();
        await startItem.getByRole("button", { name: "この素材を選択" }).click();
        await startSave;
        const createdAssignment = state.project.visuals.assignments.find(
          (assignment) => assignment.startLineId === "main-mentor-1"
        );
        if (createdAssignment === undefined) {
          throw new Error("media workflow assignment was not created");
        }
        expect(createdAssignment).toMatchObject({
          endLineId: "main-learner-2",
          display: { kind: "video", playbackCues: [] }
        });

        const pauseSave = waitForVisualSave();
        await pauseLineCard.getByRole("button", { name: "一時停止" }).click();
        await pauseSave;
        expect(
          state.project.visuals.assignments.find(
            (assignment) => assignment.id === createdAssignment.id
          )?.display
        ).toMatchObject({
          playbackCues: [
            { lineId: "main-learner-1", edge: "before", action: "pause" }
          ]
        });

        const resumeSave = waitForVisualSave();
        await resumeEndLineCard.getByRole("button", { name: "再開" }).click();
        await resumeSave;
        expect(
          state.project.visuals.assignments.find(
            (assignment) => assignment.id === createdAssignment.id
          )?.display
        ).toMatchObject({
          playbackCues: [
            { lineId: "main-learner-1", edge: "before", action: "pause" },
            { lineId: "main-mentor-2", edge: "before", action: "resume" }
          ]
        });

        const endSave = waitForVisualSave();
        await resumeEndLineCard
          .getByRole("button", { name: "停止", exact: true })
          .click();
        await endSave;
        expect(
          state.project.visuals.assignments.find(
            (assignment) => assignment.id === createdAssignment.id
          )
        ).toMatchObject({ endLineId: "main-mentor-2" });

        await resumeEndLineCard
          .getByRole("button", { name: "変更", exact: true })
          .click();
        const picker = page.getByRole("dialog", {
          name: "表示素材を差し替え"
        });
        await picker.waitFor({ state: "visible" });
        const replacementItem = picker.locator("li").filter({
          hasText: replacementAsset.title
        });
        const replaceSave = waitForVisualSave();
        await replacementItem
          .getByRole("button", { name: "この素材を選択" })
          .click();
        await replaceSave;
        expect(state.visualAssignmentUpdates.at(-1)).toEqual({
          assetId: replacementAsset.assetId,
          assetVersion: replacementAsset.version
        });
        expect(
          state.project.visuals.assignments.find(
            (assignment) => assignment.id === createdAssignment.id
          )
        ).toMatchObject({
          assetId: replacementAsset.assetId,
          endLineId: "main-mentor-2"
        });

        await page.reload({ waitUntil: "domcontentloaded" });
        await page.locator("#section-main-screen-template").waitFor({
          state: "visible"
        });
        const reloadedPane = resumeEndLineCard.locator(
          ".script-line-media-pane"
        );
        await reloadedPane.waitFor({ state: "visible" });
        expect(
          await reloadedPane
            .locator(
              `video[aria-label="${replacementAsset.title}の管理素材プレビュー"]`
            )
            .count()
        ).toBe(1);
        expect(await reloadedPane.textContent()).not.toContain(
          replacementAsset.title
        );
        expect(await reloadedPane.getAttribute("aria-label")).toContain(
          "playing（再生中）"
        );
        expect(
          state.project.visuals.assignments.find(
            (assignment) => assignment.id === createdAssignment.id
          )?.display
        ).toMatchObject({
          kind: "video",
          playbackCues: [
            { lineId: "main-learner-1", edge: "before", action: "pause" },
            { lineId: "main-mentor-2", edge: "before", action: "resume" }
          ]
        });
      } finally {
        await context.close();
      }
    }
  );

  it(
    "splits a same-section visual assignment from the selected line and reloads the boundary state",
    { timeout: 60_000 },
    async () => {
      const splitProject = createScreenTemplateProjectFixture();
      const splitAsset = createMediaSplitAsset(splitProject);
      const original = splitProject.visuals.assignments.find(
        (assignment) => assignment.id === "visual-main-photo"
      );
      if (original === undefined) {
        throw new Error("media workflow photo assignment is missing");
      }
      const { context, page, state } = await openScript(splitProject, [
        splitAsset
      ]);
      try {
        const boundaryLineCard = page.locator(
          '.script-line-card[aria-label="セリフ main-learner-1"]'
        );
        const pane = boundaryLineCard.locator(".script-line-media-pane");
        await pane.waitFor({ state: "visible" });
        expect(
          await pane.getByRole("button", { name: "この行から変更" }).count()
        ).toBe(1);

        await pane.getByRole("button", { name: "この行から変更" }).click();
        const picker = page.getByRole("dialog", {
          name: "この行から表示素材を変更"
        });
        await picker.waitFor({ state: "visible" });
        const replacementItem = picker.locator("li").filter({
          hasText: splitAsset.title
        });
        const splitSave = page.waitForResponse(
          (response) =>
            response.request().method() === "POST" &&
            new URL(response.url()).pathname ===
              `/api/projects/${projectId}/visual-assignments/${original.id}/split`
        );
        await replacementItem
          .getByRole("button", { name: "この素材を選択" })
          .click();
        await splitSave;

        expect(state.visualAssignmentSplits).toEqual([
          {
            assignmentId: original.id,
            selectedLineId: "main-learner-1",
            assetId: splitAsset.assetId,
            assetVersion: splitAsset.version
          }
        ]);
        expect(
          state.project.visuals.assignments.find(
            (assignment) => assignment.id === original.id
          )
        ).toEqual({
          ...original,
          endLineId: "main-mentor-1"
        });
        expect(
          state.project.visuals.assignments.find(
            (assignment) =>
              assignment.startLineId === "main-learner-1" &&
              assignment.assetId === splitAsset.assetId
          )
        ).toMatchObject({
          startLineId: "main-learner-1",
          endLineId: "main-mentor-2",
          assetId: splitAsset.assetId
        });

        await page.reload({ waitUntil: "domcontentloaded" });
        await page.locator("#section-main-screen-template").waitFor({
          state: "visible"
        });
        const reloadedPane = page
          .locator('.script-line-card[aria-label="セリフ main-learner-1"]')
          .locator(".script-line-media-pane");
        await reloadedPane.waitFor({ state: "visible" });
        expect(
          await reloadedPane.locator("img[src*='asset-media-split']").count()
        ).toBe(1);
      } finally {
        await context.close();
      }
    }
  );
});
