import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";

import { registerMediabunnyServer } from "@mediabunny/server";
import { chromium, type Browser } from "@playwright/test";
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import {
  ALL_FORMATS,
  AudioSampleSink,
  FilePathSource,
  Input
} from "mediabunny";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { createServer, type ViteDevServer } from "vite";

import { initializeServer } from "../../src/api/server.js";
import { AssetRepository } from "../../src/app/assets/asset-repository.js";
import { CharacterVisualRepository } from "../../src/app/character-visuals/character-visual-repository.js";
import { CharacterVisualCatalogService } from "../../src/app/character-visuals/character-visual-service.js";
import { OutlineGenerationService } from "../../src/app/projects/outline-generation-service.js";
import { ProjectRepository } from "../../src/app/projects/project-repository.js";
import { computeOutlineHash } from "../../src/app/projects/script-domain.js";
import { ScreenTemplateRepository } from "../../src/app/screen-templates/screen-template-repository.js";
import { createStandardScreenTemplate } from "../../src/app/screen-templates/screen-template-seed.js";
import {
  browserExecutable,
  stagePublicDirectory
} from "../../src/app/rendering/remotion-mp4-renderer.js";
import {
  computeSourceProjectHash,
  serializeRenderManifest
} from "../../src/app/rendering/render-manifest-compiler.js";
import { RenderManifestInputBuilder } from "../../src/app/rendering/render-manifest-compile-service.js";
import { computeRenderInputHash } from "../../src/app/rendering/render-job-worker.js";
import { RenderManifestStore } from "../../src/app/rendering/render-manifest-store.js";
import { RunLogStore } from "../../src/app/run-log-store.js";
import { VoicevoxAudioStore } from "../../src/app/voicevox/audio-store.js";
import { VoicevoxClient } from "../../src/voicevox/client.js";
import { tags } from "../../src/db/schema.js";
import {
  assetDetailResponseSchema,
  assetUploadResponseSchema,
  characterVisualResponseSchema,
  manifestCompileResponseSchema,
  manifestPreviewResponseSchema,
  projectCreateResponseSchema,
  projectDetailResponseSchema,
  projectMutationResponseSchema,
  renderAcceptedResponseSchema,
  renderRunStatusResponseSchema,
  terminologyPreviewResponseSchema,
  terminologyTermResponseSchema,
  voiceGenerationAcceptedResponseSchema,
  voiceGenerationStatusResponseSchema
} from "../../src/schema/api.js";
import {
  renderManifestSchema,
  type AssetDetail,
  type RenderManifest,
  type RenderRunLog,
  type VideoProject
} from "../../src/schema/index.js";
import { effectiveMediaDurationInFrames } from "../../src/media-frame.js";
import {
  buildMultipartBody,
  type MultipartPart
} from "../fixtures/asset-fixtures.js";
import { mediaFixture } from "../fixtures/media-fixtures.js";
import {
  createVoicevoxAudioQueryFixture,
  createVoicevoxSpeakersFixture,
  createVoicevoxWavFixture
} from "../fixtures/voicevox.js";
import {
  createRepresentativeFrameOutlineCandidate,
  createRepresentativeFrameScript,
  representativeFrameBrief,
  representativeFrameMarkdown
} from "../fixtures/e2e/representative-frame-project.js";
import { compareRepresentativeImages } from "../helpers/image-comparison.js";
import {
  ALTERNATE_SCREEN_TEMPLATE_ID,
  createAlternateScreenTemplate
} from "../fixtures/e2e/screen-template-project.js";

// Mediabunny's FFmpeg-backed metadata reader must be registered before Input
// instances are created. This is the same production adapter used by asset
// processing, not an ffprobe shell dependency.
registerMediabunnyServer();

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
type RepresentativeFrameGoldenPlatform = "linux" | "windows";
const BGM_MARKER_FREQUENCY_HZ = 440;
const SFX_MARKER_FREQUENCY_HZ = 880;

function listeningPort(server: {
  address(): string | AddressInfo | null;
}): number {
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("The local test server did not expose a TCP port.");
  }
  return address.port;
}

function createDistinctSoundEffectFixture(source: Buffer): Buffer {
  const output = Buffer.from(source);
  let sampleRate: number | undefined;
  let channels: number | undefined;
  let bitsPerSample: number | undefined;
  let dataOffset: number | undefined;
  let dataLength: number | undefined;
  let offset = 12;
  while (offset + 8 <= output.length) {
    const chunkId = output.toString("ascii", offset, offset + 4);
    const chunkLength = output.readUInt32LE(offset + 4);
    const chunkDataOffset = offset + 8;
    if (chunkDataOffset + chunkLength > output.length) {
      throw new Error(
        "The checked-in sound-effect fixture has invalid chunks."
      );
    }
    if (chunkId === "fmt ") {
      channels = output.readUInt16LE(chunkDataOffset + 2);
      sampleRate = output.readUInt32LE(chunkDataOffset + 4);
      bitsPerSample = output.readUInt16LE(chunkDataOffset + 14);
    } else if (chunkId === "data") {
      dataOffset = chunkDataOffset;
      dataLength = chunkLength;
    }
    offset += 8 + chunkLength + (chunkLength % 2);
  }
  if (
    sampleRate === undefined ||
    channels === undefined ||
    bitsPerSample !== 16 ||
    dataOffset === undefined ||
    dataLength === undefined ||
    channels <= 0
  ) {
    throw new Error("The checked-in sound-effect fixture is not 16-bit PCM.");
  }
  const frameCount = Math.floor(dataLength / (channels * 2));
  for (let frame = 0; frame < frameCount; frame += 1) {
    const sample = Math.round(
      Math.sin((2 * Math.PI * SFX_MARKER_FREQUENCY_HZ * frame) / sampleRate) *
        16_384
    );
    for (let channel = 0; channel < channels; channel += 1) {
      output.writeInt16LE(
        sample,
        dataOffset + (frame * channels + channel) * 2
      );
    }
  }
  return output;
}

// Remotion uses the browser's installed fonts, whose glyph rasterization and
// fallback selection differ between Ubuntu CI and Windows development runs.
// Keep strict pixel tolerances, but compare each renderer platform with the
// baseline produced by that same platform instead of weakening the assertion.
function resolveRepresentativeFrameGoldenPlatform(): RepresentativeFrameGoldenPlatform {
  if (process.platform === "linux") {
    return "linux";
  }
  if (process.platform === "win32") {
    return "windows";
  }
  throw new Error(
    `Representative frame goldens are not available for ${process.platform}; ` +
      "add a checked-in baseline for this renderer platform before running the E2E."
  );
}

const representativeFrameGoldenPlatform =
  resolveRepresentativeFrameGoldenPlatform();
const goldenRoot = path.join(
  repositoryRoot,
  "tests",
  "fixtures",
  "representative-frames",
  representativeFrameGoldenPlatform
);
const E2E_TIMEOUT_MS = 420_000;
const ASSET_PROCESSING_TIMEOUT_MS = 30_000;
// The final ED-09 MP4 render is CPU-bound on GitHub-hosted runners and can
// exceed three minutes even though the surrounding E2E remains bounded.
const RENDER_TIMEOUT_MS = 300_000;

type InitializedServer = Awaited<ReturnType<typeof initializeServer>>;

type UploadedAsset = {
  readonly receipt: ReturnType<typeof assetUploadResponseSchema.parse>["data"];
  readonly detail: AssetDetail;
};

type RepresentativeFrame = {
  readonly name:
    | "opening"
    | "video-content"
    | "photo-content"
    | "document-page-2"
    | "ed09-intro"
    | "ed09-cutin-1"
    | "ed09-cutin-2"
    | "ed09-section-content"
    | "ed09-outro";
  readonly frame: number;
};

type PreviewAssetExpectation = {
  readonly path: string;
  readonly contentType: RegExp;
};

type RenderWaitResult = {
  readonly log: Extract<RenderRunLog, { status: "succeeded" }>;
  readonly statuses: readonly RenderRunLog["status"][];
};

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function sha256File(filePath: string): Promise<string> {
  return sha256Bytes(await fs.readFile(filePath));
}

function resolvePosixPath(root: string, relativePath: string): string {
  return path.resolve(root, ...relativePath.split("/"));
}

function assertRelativeOutputPath(
  workspaceRoot: string,
  projectId: string,
  outputPath: string
): string {
  const normalized = outputPath.replaceAll("\\", "/");
  if (path.isAbsolute(outputPath) || normalized.includes("..")) {
    throw new Error(`Render output path is not relative: ${outputPath}`);
  }
  const projectRoot = path.resolve(workspaceRoot, "projects", projectId);
  const resolved = path.resolve(projectRoot, ...normalized.split("/"));
  const relative = path.relative(projectRoot, resolved);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(
      `Render output escaped the project directory: ${outputPath}`
    );
  }
  return resolved;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function allProjectLines(
  project: VideoProject
): VideoProject["script"]["sections"][number]["lines"] {
  return project.script.sections.flatMap((section) => section.lines);
}

function createFixtureOutlineGenerationService(
  repository: ProjectRepository
): OutlineGenerationService {
  const model = {
    id: "google/gemma-4-31b-it",
    displayName: "MVP final fixture model",
    contextLength: 131_072,
    inputPrice: "0",
    outputPrice: "0",
    outputModalities: ["text"],
    supportedParameters: ["structured_outputs"],
    expirationDate: null,
    structuredOutputs: true,
    zdrAvailable: true
  } as const;

  return new OutlineGenerationService({
    repository,
    modelService: {
      listModels: async () => ({
        models: [model],
        fetchedAt: "2026-08-11T00:00:00.000Z",
        cached: false
      })
    },
    chatAdapter: {
      complete: async () => ({
        candidate: createRepresentativeFrameOutlineCandidate(),
        responseModel: model.id,
        provider: "MVP fixture provider",
        usage: {
          promptTokens: 128,
          completionTokens: 96,
          totalTokens: 224,
          costCredits: 0
        },
        attempts: 1
      })
    },
    createId: () => "fixture-ai-outline-run"
  });
}

async function waitForVoiceJob(
  server: InitializedServer,
  projectId: string,
  runId: string,
  timeoutMs = 30_000
): Promise<void> {
  const startedAt = Date.now();
  let lastStatus: string | undefined;
  while (Date.now() - startedAt < timeoutMs) {
    const response = await server.app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/voice/status`
    });
    expect(response.statusCode).toBe(200);
    const status = voiceGenerationStatusResponseSchema.parse(
      response.json()
    ).data;
    const job = status.jobs.find((candidate) => candidate.runId === runId);
    lastStatus = job?.status;
    if (job?.status === "succeeded") {
      return;
    }
    if (job?.status === "failed") {
      throw new Error(`Voice run ${runId} failed.`);
    }
    await yieldToEventLoop();
  }
  throw new Error(
    `Voice run ${runId} timed out after ${timeoutMs}ms; last status=${lastStatus ?? "unknown"}`
  );
}

async function insertConfirmTag(server: InitializedServer): Promise<void> {
  const now = "2026-08-11T00:00:00.000Z";
  server.database.database
    .insert(tags)
    .values({
      tagId: "confirm",
      axis: "task",
      canonicalName: "confirm",
      normalizedName: "confirm",
      status: "active",
      createdAt: now,
      updatedAt: now
    })
    .run();
}

async function readAssetDetail(
  server: InitializedServer,
  assetId: string
): Promise<AssetDetail> {
  const response = await server.app.inject({
    method: "GET",
    url: `/api/assets/${assetId}`
  });
  expect(response.statusCode).toBe(200);
  return assetDetailResponseSchema.parse(response.json()).data;
}

async function waitForActiveAsset(
  server: InitializedServer,
  assetId: string
): Promise<AssetDetail> {
  const startedAt = Date.now();
  let lastDetail: AssetDetail | undefined;
  while (Date.now() - startedAt < ASSET_PROCESSING_TIMEOUT_MS) {
    const detail = await readAssetDetail(server, assetId);
    lastDetail = detail;
    if (detail.status === "active") {
      return detail;
    }
    if (detail.status === "error") {
      throw new Error(
        `Asset processing failed for ${assetId}: ${detail.errorCode} ${detail.errorMessage}`
      );
    }
    await yieldToEventLoop();
  }
  throw new Error(
    `Asset processing timed out for ${assetId}; last status=${lastDetail?.status ?? "unknown"}`
  );
}

async function uploadAsset(
  server: InitializedServer,
  workspaceRoot: string,
  input: {
    readonly fileName: string;
    readonly kind: "video" | "bgm" | "photo" | "document_scan" | "sound_effect";
    readonly mimeType: string;
    readonly title: string;
    readonly tagIds?: readonly string[];
    readonly data?: Buffer;
  }
): Promise<UploadedAsset> {
  const parts: MultipartPart[] = [
    { name: "kind", value: input.kind },
    { name: "title", value: input.title },
    { name: "description", value: `P5-09 ${input.kind} fixture` },
    { name: "department", value: "Operations" },
    { name: "system", value: "SubDub" }
  ];
  for (const tagId of input.tagIds ?? []) {
    parts.push({ name: "tagIds", value: tagId });
  }
  parts.push({
    name: "file",
    filename: input.fileName,
    mimeType: input.mimeType,
    data: input.data ?? (await mediaFixture(input.fileName))
  });

  const { body, contentType } = buildMultipartBody(parts);
  const response = await server.app.inject({
    method: "POST",
    url: "/api/assets",
    payload: body,
    headers: { "content-type": contentType }
  });
  expect(response.statusCode, response.body).toBe(200);
  const receipt = assetUploadResponseSchema.parse(response.json()).data;
  expect(receipt.status).toBe("processing");
  const detail = await waitForActiveAsset(server, receipt.assetId);
  expect(detail.status).toBe("active");
  expect(detail.checksum).toMatch(/^[0-9a-f]{64}$/);
  expect(detail.sizeBytes).toBeGreaterThan(0);
  expect(detail.libraryMediaPath).toMatch(/^media\//);

  const expectedThumbnailCount =
    input.kind === "document_scan"
      ? 3
      : input.kind === "bgm" || input.kind === "sound_effect"
        ? 0
        : 1;
  expect(detail.thumbnailPaths).toHaveLength(expectedThumbnailCount);
  for (const thumbnailPath of detail.thumbnailPaths) {
    expect(thumbnailPath).toMatch(/^thumbnails\//);
    const absoluteThumbnailPath = resolvePosixPath(
      path.join(workspaceRoot, "library"),
      thumbnailPath
    );
    expect(await pathExists(absoluteThumbnailPath)).toBe(true);
  }
  if (detail.thumbnailPaths.length > 0) {
    const thumbnailResponse = await server.app.inject({
      method: "GET",
      url: `/api/assets/${receipt.assetId}/thumbnails/0`
    });
    expect(thumbnailResponse.statusCode).toBe(200);
    expect(thumbnailResponse.headers["content-type"]).toMatch(/^image\/png/);
    expect(thumbnailResponse.body.length).toBeGreaterThan(0);
  }

  if (input.kind === "video") {
    expect(detail.width).toBeGreaterThan(0);
    expect(detail.height).toBeGreaterThan(0);
    expect(detail.durationMs).toBeGreaterThan(0);
  } else if (input.kind === "photo") {
    expect(detail.width).toBeGreaterThan(0);
    expect(detail.height).toBeGreaterThan(0);
  } else if (input.kind === "document_scan") {
    expect(detail.pageCount).toBe(3);
  } else {
    expect(detail.durationMs).toBeGreaterThan(0);
  }

  return { receipt, detail };
}

function visualDisplay(
  kind: "video" | "bgm" | "photo" | "document_scan" | "sound_effect"
) {
  if (kind === "sound_effect" || kind === "bgm") {
    throw new Error("Audio assets cannot be visual assignments.");
  }
  const common = {
    fit: "contain" as const,
    crop: { x: 0, y: 0, width: 1, height: 1 },
    scale: 1,
    position: { x: 0.5, y: 0.5 },
    prioritizeVisual: true,
    annotations: []
  };
  if (kind === "video") {
    return {
      ...common,
      kind,
      startMs: 0,
      endMs: 2_000,
      playbackRate: 1,
      volume: 0
    };
  }
  if (kind === "document_scan") {
    return { ...common, kind, page: 2 };
  }
  return { ...common, kind };
}

async function assignVisual(
  server: InitializedServer,
  workspaceRoot: string,
  project: VideoProject,
  input: {
    readonly id: string;
    readonly startLineId: string;
    readonly endLineId: string;
    readonly asset: UploadedAsset;
  }
): Promise<{
  readonly project: VideoProject;
  readonly assignment: VideoProject["visuals"]["assignments"][number];
}> {
  const response = await server.app.inject({
    method: "PUT",
    url: `/api/projects/${project.metadata.id}/visual-assignments`,
    payload: {
      expectedRevision: project.revision,
      assignment: {
        id: input.id,
        startLineId: input.startLineId,
        endLineId: input.endLineId,
        assetId: input.asset.receipt.assetId,
        display: visualDisplay(input.asset.receipt.kind)
      }
    }
  });
  expect(response.statusCode).toBe(200);
  const nextProject = projectMutationResponseSchema.parse(response.json()).data;
  const assignment = nextProject.visuals.assignments.find(
    (candidate) => candidate.id === input.id
  );
  if (assignment === undefined) {
    throw new Error(`Visual assignment was not saved: ${input.id}`);
  }
  expect(assignment.assetId).toBe(input.asset.receipt.assetId);
  expect(assignment.assetChecksum).toBe(input.asset.detail.checksum);
  expect(assignment.projectMediaPath).toMatch(/^media\//);
  const placedPath = resolvePosixPath(
    path.join(workspaceRoot, "projects", project.metadata.id),
    assignment.projectMediaPath
  );
  expect(await pathExists(placedPath)).toBe(true);
  expect(await sha256File(placedPath)).toBe(input.asset.detail.checksum);
  return { project: nextProject, assignment };
}

async function waitForRenderRun(
  server: InitializedServer,
  projectId: string,
  runId: string,
  timeoutMs: number
): Promise<RenderWaitResult> {
  const startedAt = Date.now();
  const statuses: RenderRunLog["status"][] = ["queued"];
  let lastStatus: RenderRunLog["status"] = "queued";
  while (Date.now() - startedAt < timeoutMs) {
    const response = await server.app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/render/${runId}`
    });
    expect(response.statusCode).toBe(200);
    const log = renderRunStatusResponseSchema.parse(response.json()).data;
    lastStatus = log.status;
    if (statuses[statuses.length - 1] !== log.status) {
      statuses.push(log.status);
    }
    if (log.status === "succeeded") {
      return { log, statuses };
    }
    if (log.status === "failed") {
      throw new Error(`Render run ${runId} failed: ${log.errorCode}`);
    }
    await yieldToEventLoop();
  }
  throw new Error(
    `Render run ${runId} timed out after ${timeoutMs}ms; last status=${lastStatus}`
  );
}

async function renderRepresentativeFrames(
  workspaceRoot: string,
  projectId: string,
  manifest: RenderManifest,
  frames: readonly RepresentativeFrame[],
  repeatFrame: RepresentativeFrame
): Promise<{
  readonly actualPaths: Readonly<Record<string, string>>;
  readonly repeatPath: string;
}> {
  const stagingRoot = await fs.mkdtemp(
    path.join(workspaceRoot, ".subdub-representative-")
  );
  const actualRoot = path.join(
    workspaceRoot,
    "test-results",
    "representative-frames"
  );
  await fs.mkdir(actualRoot, { recursive: true });
  try {
    const publicRoot = await stagePublicDirectory(
      workspaceRoot,
      projectId,
      manifest,
      stagingRoot
    );
    const serveUrl = await bundle({
      entryPoint: path.join(
        repositoryRoot,
        "src",
        "remotion",
        "entry-point.tsx"
      ),
      outDir: path.join(stagingRoot, "bundle"),
      publicDir: publicRoot
    });
    const composition = await selectComposition({
      serveUrl,
      id: "BasicRemotionComposition",
      inputProps: manifest as unknown as Record<string, unknown>,
      browserExecutable: browserExecutable()
    });
    expect(composition.width).toBe(manifest.width);
    expect(composition.height).toBe(manifest.height);
    expect(composition.fps).toBe(manifest.fps);
    expect(composition.durationInFrames).toBe(manifest.durationInFrames);

    const actualPaths: Record<string, string> = {};
    for (const frame of frames) {
      const outputPath = path.join(actualRoot, `${frame.name}.png`);
      await renderStill({
        serveUrl,
        composition,
        inputProps: manifest as unknown as Record<string, unknown>,
        browserExecutable: browserExecutable(),
        frame: frame.frame,
        imageFormat: "png",
        output: outputPath,
        overwrite: true,
        logLevel: "error"
      });
      actualPaths[frame.name] = outputPath;
    }

    const repeatPath = path.join(actualRoot, `${repeatFrame.name}-repeat.png`);
    await renderStill({
      serveUrl,
      composition,
      inputProps: manifest as unknown as Record<string, unknown>,
      browserExecutable: browserExecutable(),
      frame: repeatFrame.frame,
      imageFormat: "png",
      output: repeatPath,
      overwrite: true,
      logLevel: "error"
    });
    return { actualPaths, repeatPath };
  } finally {
    await fs.rm(stagingRoot, { recursive: true, force: true });
  }
}

async function writeOrRequireGolden(
  actualPath: string,
  goldenPath: string,
  frameName: string
): Promise<void> {
  if (process.env.UPDATE_REPRESENTATIVE_GOLDENS === "1") {
    await fs.mkdir(path.dirname(goldenPath), { recursive: true });
    await fs.copyFile(actualPath, goldenPath);
    return;
  }
  if (!(await pathExists(goldenPath))) {
    throw new Error(
      `Golden image is missing for ${frameName} in the ` +
        `${representativeFrameGoldenPlatform} baseline. Run ` +
        "$env:UPDATE_REPRESENTATIVE_GOLDENS='1'; pnpm test -- tests/e2e/project-rendering.e2e.test.ts " +
        "once to update the explicit baseline."
    );
  }
}

async function validateMp4Output(
  outputPath: string,
  manifest: RenderManifest
): Promise<void> {
  const input = new Input({
    source: new FilePathSource(outputPath),
    formats: ALL_FORMATS
  });
  try {
    const videoTrack = await input.getPrimaryVideoTrack();
    const audioTrack = await input.getPrimaryAudioTrack();
    expect(videoTrack).not.toBeNull();
    expect(audioTrack).not.toBeNull();
    if (videoTrack === null || audioTrack === null) {
      throw new Error("Rendered MP4 is missing its required media streams.");
    }
    expect(await videoTrack.getDisplayWidth()).toBe(1920);
    expect(await videoTrack.getDisplayHeight()).toBe(1080);
    expect(await videoTrack.getCodec()).not.toBeNull();
    expect(await audioTrack.getCodec()).not.toBeNull();
    expect(await audioTrack.getSampleRate()).toBe(48_000);
    expect(await audioTrack.getNumberOfChannels()).toBe(2);
    const packetStats = await videoTrack.computePacketStats();
    expect(packetStats.averagePacketRate).toBeCloseTo(manifest.fps, 1);
    const durationSeconds = await input.computeDuration();
    expect(
      Math.abs(durationSeconds - manifest.durationInFrames / manifest.fps)
    ).toBeLessThanOrEqual(0.25);
  } finally {
    input.dispose();
  }
}

async function validateWebPreviewPath(
  server: InitializedServer,
  projectId: string,
  manifest: RenderManifest,
  expectedAssets: readonly PreviewAssetExpectation[],
  expectedInitialVideoTimeMs?: number
): Promise<void> {
  const executable = browserExecutable();
  if (typeof executable !== "string") {
    throw new Error(
      "A local Chrome/Chromium/Edge executable is required for the Web preview E2E."
    );
  }

  await server.app.listen({ host: "127.0.0.1", port: 0 });
  const apiPort = listeningPort(server.app.server);
  let webServer: ViteDevServer | undefined;
  let browser: Browser | undefined;
  try {
    webServer = await createServer({
      configFile: path.join(repositoryRoot, "vite.config.ts"),
      logLevel: "error",
      server: {
        host: "127.0.0.1",
        port: 0,
        strictPort: false,
        proxy: {
          "/api": {
            target: `http://127.0.0.1:${apiPort}`
          }
        }
      }
    });
    await webServer.listen();
    if (webServer.httpServer === null) {
      throw new Error("The Vite preview server did not start.");
    }
    const webPort = listeningPort(webServer.httpServer);
    browser = await chromium.launch({
      executablePath: executable,
      headless: true
    });
    const page = await browser.newPage();
    const requestedAssetPaths = new Set<string>();
    const assetResponses = new Map<
      string,
      { readonly status: number; readonly contentType: string | undefined }
    >();
    const projectFilePrefix = `/api/projects/${encodeURIComponent(
      projectId
    )}/files/`;
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith(projectFilePrefix)) {
        requestedAssetPaths.add(url.pathname.slice(projectFilePrefix.length));
      }
    });
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (url.pathname.startsWith(projectFilePrefix)) {
        assetResponses.set(url.pathname.slice(projectFilePrefix.length), {
          status: response.status(),
          contentType: response.headers()["content-type"]
        });
      }
    });

    const encodedProjectId = encodeURIComponent(projectId);
    const manifestResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        response.request().method() === "GET" &&
        url.pathname === `/api/projects/${encodedProjectId}/manifest`
      );
    });
    const pageResponse = await page.goto(
      `http://127.0.0.1:${webPort}/projects/${encodedProjectId}/preview`,
      { waitUntil: "domcontentloaded" }
    );
    expect(pageResponse?.status()).toBe(200);
    const manifestResponse = await manifestResponsePromise;
    expect(manifestResponse.status()).toBe(200);
    const webPreview = manifestPreviewResponseSchema.parse(
      await manifestResponse.json()
    ).data;
    expect(webPreview.manifest).not.toBeNull();
    if (webPreview.manifest === null) {
      throw new Error("The Web preview response did not contain a manifest.");
    }
    expect(serializeRenderManifest(webPreview.manifest)).toBe(
      serializeRenderManifest(manifest)
    );

    const playerPanel = page.locator(".preview-player-panel");
    await playerPanel.waitFor({ state: "visible", timeout: 30_000 });
    expect(await playerPanel.locator('[role="alert"]').count()).toBe(0);
    const playButton = page.getByRole("button", { name: "Play video" });
    await playButton.waitFor({ state: "visible", timeout: 30_000 });
    const previewVideo = playerPanel.locator("video").first();
    if (expectedInitialVideoTimeMs !== undefined) {
      await previewVideo.waitFor({ state: "attached", timeout: 30_000 });
      const expectedInitialVideoTimeSeconds = expectedInitialVideoTimeMs / 1000;
      const initialVideoTimeDeadline = Date.now() + 10_000;
      let initialVideoTimeSeconds = 0;
      while (
        Date.now() < initialVideoTimeDeadline &&
        Math.abs(initialVideoTimeSeconds - expectedInitialVideoTimeSeconds) >
          0.4
      ) {
        initialVideoTimeSeconds = await previewVideo.evaluate(
          (element) =>
            (element as unknown as { currentTime: number }).currentTime
        );
        if (
          Math.abs(initialVideoTimeSeconds - expectedInitialVideoTimeSeconds) >
          0.4
        ) {
          await page.waitForTimeout(100);
        }
      }
      expect(initialVideoTimeSeconds).toBeCloseTo(
        expectedInitialVideoTimeSeconds,
        0
      );
      await page.waitForTimeout(300);
      const stoppedVideoTimeSeconds = await previewVideo.evaluate(
        (element) => (element as unknown as { currentTime: number }).currentTime
      );
      expect(stoppedVideoTimeSeconds).toBeCloseTo(initialVideoTimeSeconds, 1);
    }
    await playButton.click();
    await page
      .getByRole("button", { name: "Pause video" })
      .waitFor({ state: "visible", timeout: 5_000 });
    if (expectedInitialVideoTimeMs !== undefined) {
      const playingVideoTimeSeconds = await previewVideo.evaluate(
        (element) => (element as unknown as { currentTime: number }).currentTime
      );
      await page.waitForTimeout(500);
      const advancedVideoTimeSeconds = await previewVideo.evaluate(
        (element) => (element as unknown as { currentTime: number }).currentTime
      );
      expect(advancedVideoTimeSeconds).toBeGreaterThan(
        playingVideoTimeSeconds + 0.05
      );
    }

    const startedAt = Date.now();
    while (
      Date.now() - startedAt < 15_000 &&
      expectedAssets.some(
        (asset) =>
          !requestedAssetPaths.has(asset.path) ||
          !assetResponses.has(asset.path)
      )
    ) {
      await page.waitForTimeout(100);
    }
    for (const asset of expectedAssets) {
      expect([...requestedAssetPaths]).toContain(asset.path);
      const assetResponse = assetResponses.get(asset.path);
      expect(assetResponse).toBeDefined();
      if (assetResponse === undefined) {
        throw new Error(
          `No response was observed for preview asset ${asset.path}.`
        );
      }
      expect(
        assetResponse.status,
        `Preview asset ${asset.path} did not load successfully`
      ).toBeGreaterThanOrEqual(200);
      expect(assetResponse.status).toBeLessThan(300);
      expect(assetResponse.contentType).toMatch(asset.contentType);
    }
    await page.waitForTimeout(500);
    expect(await playerPanel.locator('[role="alert"]').count()).toBe(0);
  } finally {
    if (browser !== undefined) {
      await browser.close();
    }
    if (webServer !== undefined) {
      await webServer.close();
    }
  }
}

async function readMp4MonoPcm(outputPath: string): Promise<{
  readonly sampleRate: number;
  readonly samples: Float32Array;
}> {
  const input = new Input({
    source: new FilePathSource(outputPath),
    formats: ALL_FORMATS
  });
  try {
    const audioTrack = await input.getPrimaryAudioTrack();
    if (audioTrack === null) {
      throw new Error("Rendered MP4 is missing its audio track.");
    }
    const sampleRate = await audioTrack.getSampleRate();
    const durationSeconds = await input.computeDuration();
    const samples = new Float32Array(
      Math.ceil(durationSeconds * sampleRate) + sampleRate
    );
    const sink = new AudioSampleSink(audioTrack);
    for await (const sample of sink.samples(0, durationSeconds + 0.25)) {
      try {
        const mono = new Float32Array(sample.numberOfFrames);
        sample.copyTo(mono, { format: "f32-planar", planeIndex: 0 });
        const startFrame = Math.max(
          0,
          Math.round(sample.timestamp * sampleRate)
        );
        if (startFrame >= samples.length) {
          continue;
        }
        samples.set(
          mono.subarray(0, Math.min(mono.length, samples.length - startFrame)),
          startFrame
        );
      } finally {
        sample.close();
      }
    }
    return { sampleRate, samples };
  } finally {
    input.dispose();
  }
}

function pcmToneMagnitude(
  samples: Float32Array,
  sampleRate: number,
  startSeconds: number,
  durationSeconds: number,
  frequencyHz: number
): number {
  const startFrame = Math.max(0, Math.floor(startSeconds * sampleRate));
  const endFrame = Math.min(
    samples.length,
    Math.ceil((startSeconds + durationSeconds) * sampleRate)
  );
  const count = endFrame - startFrame;
  if (count <= 0) {
    return 0;
  }
  let real = 0;
  let imaginary = 0;
  for (let frame = startFrame; frame < endFrame; frame += 1) {
    const sample = samples[frame] ?? 0;
    const angle = (2 * Math.PI * frequencyHz * frame) / sampleRate;
    real += sample * Math.cos(angle);
    imaginary -= sample * Math.sin(angle);
  }
  return (2 * Math.hypot(real, imaginary)) / count;
}

function assertRenderedTone(
  pcm: Awaited<ReturnType<typeof readMp4MonoPcm>>,
  input: {
    readonly fromFrame: number;
    readonly durationInFrames: number;
    readonly fps: number;
    readonly frequencyHz: number;
    readonly label: string;
  }
): void {
  const startSeconds =
    (input.fromFrame + Math.min(15, input.durationInFrames / 2)) / input.fps;
  const durationSeconds = Math.min(
    0.4,
    Math.max(0.2, (input.durationInFrames - input.fps) / input.fps)
  );
  const targetMagnitude = pcmToneMagnitude(
    pcm.samples,
    pcm.sampleRate,
    startSeconds,
    durationSeconds,
    input.frequencyHz
  );
  const controlMagnitude = pcmToneMagnitude(
    pcm.samples,
    pcm.sampleRate,
    startSeconds,
    durationSeconds,
    input.frequencyHz + 317
  );
  expect(
    targetMagnitude,
    `${input.label} marker was not present in the rendered MP4 PCM output`
  ).toBeGreaterThan(0.01);
  expect(
    targetMagnitude,
    `${input.label} marker was not distinguishable from the control frequency`
  ).toBeGreaterThan(controlMagnitude * 1.5);
}

async function validateThumbnailOutput(outputPath: string): Promise<void> {
  const metadata = await sharp(outputPath).metadata();
  expect(metadata.format).toBe("png");
  expect(metadata.width).toBe(1280);
  expect(metadata.height).toBe(720);
  expect(metadata.channels).toBeGreaterThan(0);
  expect((await fs.stat(outputPath)).size).toBeGreaterThan(0);
}

describe("MVP final verification E2E", () => {
  it(
    "recreates the Phase 0-6 MVP fixture through all 11 final-check operations",
    async () => {
      const workspaceRoot = await fs.mkdtemp(
        path.join(tmpdir(), "subdub-mvp-final-e2e-")
      );
      let server: InitializedServer | undefined;
      let restartedServer: InitializedServer | undefined;
      const voicevoxSpies: Array<{ mockRestore: () => void }> = [];
      let cleanupVerified: boolean;
      try {
        await fs.cp(
          path.join(repositoryRoot, "public", "shared-assets"),
          path.join(workspaceRoot, "public", "shared-assets"),
          { recursive: true }
        );
        const projectRepository = new ProjectRepository({ workspaceRoot });
        const outlineGenerationService =
          createFixtureOutlineGenerationService(projectRepository);
        server = await initializeServer({
          workspaceRoot,
          projectRepository,
          outlineGenerationService
        });

        const metanStyleId = 10_001;
        const zundamonStyleId = 10_002;
        voicevoxSpies.push(
          vi.spyOn(VoicevoxClient.prototype, "getSpeakers").mockResolvedValue(
            createVoicevoxSpeakersFixture({
              metanStyleId,
              zundamonStyleId
            })
          ),
          vi
            .spyOn(VoicevoxClient.prototype, "getVersion")
            .mockResolvedValue("mvp-final-voicevox-1"),
          vi
            .spyOn(VoicevoxClient.prototype, "getAudioQuery")
            .mockResolvedValue(createVoicevoxAudioQueryFixture()),
          vi
            .spyOn(VoicevoxClient.prototype, "synthesize")
            .mockResolvedValue(createVoicevoxWavFixture({ durationMs: 1_000 }))
        );

        const createResponse = await server.app.inject({
          method: "POST",
          url: "/api/projects",
          payload: {
            title: "MVP final verification fixture",
            department: "Operations",
            manualVersion: "2026.08"
          }
        });
        expect(createResponse.statusCode).toBe(200);
        let project = projectCreateResponseSchema.parse(
          createResponse.json()
        ).data;
        const projectId = project.metadata.id;
        expect(project.revision).toBe(0);
        expect(project.characters).toHaveLength(2);

        const sourceResponse = await server.app.inject({
          method: "PUT",
          url: `/api/projects/${projectId}/source`,
          payload: {
            markdown: representativeFrameMarkdown,
            expectedRevision: project.revision
          }
        });
        expect(sourceResponse.statusCode).toBe(200);
        project = projectMutationResponseSchema.parse(
          sourceResponse.json()
        ).data;
        const sourceHash = createHash("sha256")
          .update(representativeFrameMarkdown, "utf8")
          .digest("hex");
        expect(project.revision).toBe(1);
        expect(project.source.sha256).toBe(sourceHash);

        const briefResponse = await server.app.inject({
          method: "PUT",
          url: `/api/projects/${projectId}/brief`,
          payload: {
            brief: representativeFrameBrief,
            expectedRevision: project.revision
          }
        });
        expect(briefResponse.statusCode).toBe(200);
        project = projectMutationResponseSchema.parse(
          briefResponse.json()
        ).data;
        expect(project.revision).toBe(2);
        expect(project.brief).toEqual(representativeFrameBrief);

        const aiOutlineResponse = await server.app.inject({
          method: "POST",
          url: `/api/projects/${projectId}/outline/generate`,
          payload: {
            expectedRevision: project.revision,
            modelId: "google/gemma-4-31b-it"
          }
        });
        expect(aiOutlineResponse.statusCode, aiOutlineResponse.body).toBe(200);
        project = projectMutationResponseSchema.parse(
          aiOutlineResponse.json()
        ).data;
        expect(project.revision).toBe(3);
        expect(project.outline.status).toBe("needs_review");

        const aiGeneratedTitle = project.outline.sections[0]?.title;
        if (aiGeneratedTitle === undefined) {
          throw new Error(
            "The AI outline fixture did not contain a first section."
          );
        }
        const humanOutline = structuredClone(project.outline);
        const firstHumanSection = humanOutline.sections[0];
        if (firstHumanSection === undefined) {
          throw new Error(
            "The human outline fixture did not contain a first section."
          );
        }
        firstHumanSection.title = `${aiGeneratedTitle} (human revised)`;
        firstHumanSection.humanDirectives = {
          ...firstHumanSection.humanDirectives,
          requiredItems: ["Human-approved purpose"]
        };
        expect(firstHumanSection.title).not.toBe(aiGeneratedTitle);
        const humanOutlineResponse = await server.app.inject({
          method: "PUT",
          url: `/api/projects/${projectId}/outline`,
          payload: {
            outline: humanOutline,
            expectedRevision: project.revision
          }
        });
        expect(humanOutlineResponse.statusCode).toBe(200);
        project = projectMutationResponseSchema.parse(
          humanOutlineResponse.json()
        ).data;
        expect(project.outline.sections[0]?.title).toBe(
          firstHumanSection.title
        );
        expect(project.outline.sections[0]?.title).not.toBe(aiGeneratedTitle);
        const outlineApprovalResponse = await server.app.inject({
          method: "POST",
          url: `/api/projects/${projectId}/outline/approve`,
          payload: { expectedRevision: project.revision }
        });
        expect(outlineApprovalResponse.statusCode).toBe(200);
        project = projectMutationResponseSchema.parse(
          outlineApprovalResponse.json()
        ).data;
        expect(project.outline.status).toBe("approved");

        const initializeScriptResponse = await server.app.inject({
          method: "POST",
          url: `/api/projects/${projectId}/script/initialize`,
          payload: { expectedRevision: project.revision }
        });
        expect(initializeScriptResponse.statusCode).toBe(200);
        project = projectMutationResponseSchema.parse(
          initializeScriptResponse.json()
        ).data;
        expect(project.script.sections).toHaveLength(3);
        expect(
          project.script.sections.every((section) => section.lines.length === 0)
        ).toBe(true);

        const customVisualCreateResponse = await server.app.inject({
          method: "POST",
          url: "/api/character-visuals",
          headers: { "content-type": "application/json" },
          payload: JSON.stringify({
            name: "E2E registered visual",
            description: "Created through the SQLite-backed API.",
            status: "active"
          })
        });
        expect(customVisualCreateResponse.statusCode).toBe(200);
        const customVisual = characterVisualResponseSchema.parse(
          customVisualCreateResponse.json()
        ).data;
        if (server === undefined) {
          throw new Error("The E2E server was not initialized.");
        }
        const characterVisualServer = server;
        const registerMouthPair = async (
          label: string,
          sourceVariantId: string
        ) => {
          const sourceRoot = path.join(
            workspaceRoot,
            "library",
            "character-visuals",
            "character-mentor",
            sourceVariantId
          );
          const [closedSource, openSource] = await Promise.all([
            fs.readFile(path.join(sourceRoot, "closed.png")),
            fs.readFile(path.join(sourceRoot, "open.png"))
          ]);
          const [closedImage, openImage] = await Promise.all([
            sharp(closedSource).png({ compressionLevel: 0 }).toBuffer(),
            sharp(openSource).png({ compressionLevel: 0 }).toBuffer()
          ]);
          const multipart = buildMultipartBody([
            { name: "label", value: label },
            { name: "renderType", value: "mouth-pair" },
            { name: "tags", value: "e2e" },
            {
              name: "closed",
              filename: `${label.toLowerCase().replaceAll(" ", "-")}-closed.png`,
              mimeType: "image/png",
              data: closedImage
            },
            {
              name: "open",
              filename: `${label.toLowerCase().replaceAll(" ", "-")}-open.png`,
              mimeType: "image/png",
              data: openImage
            }
          ]);
          const response = await characterVisualServer.app.inject({
            method: "POST",
            url: `/api/character-visuals/${customVisual.visualId}/variants`,
            headers: { "content-type": multipart.contentType },
            payload: multipart.body
          });
          expect(response.statusCode, response.body).toBe(200);
          return characterVisualResponseSchema.parse(response.json()).data;
        };
        const registerSingleImage = async (
          label: string,
          sourceVariantId: string
        ) => {
          const sourcePath = path.join(
            workspaceRoot,
            "library",
            "character-visuals",
            "character-mentor",
            sourceVariantId,
            "single.png"
          );
          const image = await sharp(await fs.readFile(sourcePath))
            .png({ compressionLevel: 0 })
            .toBuffer();
          const multipart = buildMultipartBody([
            { name: "label", value: label },
            { name: "renderType", value: "single-image" },
            { name: "tags", value: "e2e" },
            {
              name: "single",
              filename: `${label.toLowerCase().replaceAll(" ", "-")}.png`,
              mimeType: "image/png",
              data: image
            }
          ]);
          const response = await characterVisualServer.app.inject({
            method: "POST",
            url: `/api/character-visuals/${customVisual.visualId}/variants`,
            headers: { "content-type": multipart.contentType },
            payload: multipart.body
          });
          expect(response.statusCode, response.body).toBe(200);
          return characterVisualResponseSchema.parse(response.json()).data;
        };
        const pointingVisual = await registerMouthPair(
          "E2E pointing mouth pair",
          "character-mentor-speak-pointing-v1"
        );
        const normalVisual = await registerMouthPair(
          "E2E normal mouth pair",
          "character-mentor-speak-normal-v1"
        );
        const registeredVisual = await registerSingleImage(
          "E2E idle image",
          "character-mentor-stand-v1"
        );
        expect(registeredVisual.visualId).toBe(customVisual.visualId);
        expect(pointingVisual.visualId).toBe(registeredVisual.visualId);
        expect(normalVisual.visualId).toBe(registeredVisual.visualId);
        const registeredPointingVariant = registeredVisual.variants.find(
          (variant) => variant.label === "E2E pointing mouth pair"
        );
        const registeredNormalVariant = registeredVisual.variants.find(
          (variant) => variant.label === "E2E normal mouth pair"
        );
        if (
          registeredPointingVariant === undefined ||
          registeredNormalVariant === undefined
        ) {
          throw new Error(
            "The E2E visual registration did not create both variants."
          );
        }
        const registeredIdleVariant = registeredVisual.variants.find(
          (variant) => variant.label === "E2E idle image"
        );
        if (registeredIdleVariant === undefined) {
          throw new Error(
            "The E2E visual registration did not create the idle variant."
          );
        }
        const registeredPointingClosedFile =
          registeredPointingVariant.files.find((file) => file.key === "closed");
        const registeredPointingOpenFile = registeredPointingVariant.files.find(
          (file) => file.key === "open"
        );
        const registeredNormalClosedFile = registeredNormalVariant.files.find(
          (file) => file.key === "closed"
        );
        const registeredNormalOpenFile = registeredNormalVariant.files.find(
          (file) => file.key === "open"
        );
        const registeredIdleFile = registeredIdleVariant.files.find(
          (file) => file.key === "single"
        );
        if (
          registeredPointingClosedFile === undefined ||
          registeredPointingOpenFile === undefined ||
          registeredNormalClosedFile === undefined ||
          registeredNormalOpenFile === undefined ||
          registeredIdleFile === undefined
        ) {
          throw new Error(
            "The E2E visual registration did not create both mouth-pair files."
          );
        }

        const characterBindingResponse = await server.app.inject({
          method: "PUT",
          url: `/api/projects/${projectId}/characters`,
          payload: {
            expectedRevision: project.revision,
            characters: [
              {
                characterId: "character-mentor",
                characterVisual: {
                  visualId: registeredVisual.visualId,
                  idleVariantId: registeredIdleVariant.variantId
                }
              },
              {
                characterId: "character-learner",
                characterVisual: {
                  visualId: "character-learner",
                  idleVariantId: "character-learner-stand-v1"
                }
              }
            ]
          }
        });
        expect(characterBindingResponse.statusCode).toBe(200);
        project = projectMutationResponseSchema.parse(
          characterBindingResponse.json()
        ).data;

        const baseScriptDraft = createRepresentativeFrameScript(
          computeOutlineHash(project.outline),
          project.outline.sections.map((section) => section.id)
        );
        const scriptDraft = {
          ...baseScriptDraft,
          sections: baseScriptDraft.sections.map((section) => ({
            ...section,
            lines: section.lines.map((line) => {
              if (line.speakerId !== "character-mentor") {
                return line;
              }
              const characterVariantId =
                line.expression === "neutral" || line.expression === "smile"
                  ? registeredNormalVariant.variantId
                  : registeredPointingVariant.variantId;
              return { ...line, characterVariantId };
            })
          }))
        };
        const scriptResponse = await server.app.inject({
          method: "PUT",
          url: `/api/projects/${projectId}/script`,
          payload: { script: scriptDraft, expectedRevision: project.revision }
        });
        expect(scriptResponse.statusCode, scriptResponse.body).toBe(200);
        project = projectMutationResponseSchema.parse(
          scriptResponse.json()
        ).data;
        expect(project.script.status).toBe("draft");
        expect(allProjectLines(project)).toHaveLength(5);

        const scriptApprovalResponse = await server.app.inject({
          method: "POST",
          url: `/api/projects/${projectId}/script/approve`,
          payload: { expectedRevision: project.revision }
        });
        expect(scriptApprovalResponse.statusCode).toBe(200);
        project = projectMutationResponseSchema.parse(
          scriptApprovalResponse.json()
        ).data;
        expect(project.script.status).toBe("approved");

        const terminologyResponse = await server.app.inject({
          method: "POST",
          url: "/api/terminology",
          payload: {
            surface: "SubDub",
            readingKatakana: "\u30b5\u30d6\u30c0\u30d6",
            category: "system",
            notes: "P5-09 fixture dictionary term"
          }
        });
        expect(terminologyResponse.statusCode).toBe(200);
        const terminology = terminologyTermResponseSchema.parse(
          terminologyResponse.json()
        ).data;
        const previewByLineId = new Map<
          string,
          ReturnType<typeof terminologyPreviewResponseSchema.parse>["data"]
        >();
        for (const line of allProjectLines(project)) {
          const previewResponse = await server.app.inject({
            method: "POST",
            url: "/api/terminology/preview",
            payload: {
              spokenText: line.spokenText,
              pronunciation: line.pronunciation
            }
          });
          expect(previewResponse.statusCode).toBe(200);
          const preview = terminologyPreviewResponseSchema.parse(
            previewResponse.json()
          ).data;
          previewByLineId.set(line.id, preview);
          if (line.spokenText.includes("SubDub")) {
            expect(preview.appliedTerms).toEqual(
              expect.arrayContaining([
                expect.objectContaining({ termId: terminology.termId })
              ])
            );
            expect(preview.resolvedSpokenText).not.toBe(line.spokenText);
          }
        }

        await insertConfirmTag(server);
        const videoAsset = await uploadAsset(server, workspaceRoot, {
          fileName: "clip.mp4",
          kind: "video",
          mimeType: "video/mp4",
          title: "Fixture application video"
        });
        const photoAsset = await uploadAsset(server, workspaceRoot, {
          fileName: "oriented.jpg",
          kind: "photo",
          mimeType: "image/jpeg",
          title: "Fixture request photo"
        });
        const documentAsset = await uploadAsset(server, workspaceRoot, {
          fileName: "scan-3pages.pdf",
          kind: "document_scan",
          mimeType: "application/pdf",
          title: "Fixture completion report"
        });
        const soundEffectFixture = createDistinctSoundEffectFixture(
          await mediaFixture("effect-1s.wav")
        );
        const soundEffectAsset = await uploadAsset(server, workspaceRoot, {
          fileName: "effect-1s.wav",
          kind: "sound_effect",
          mimeType: "audio/wav",
          title: "Fixture confirmation effect",
          tagIds: ["confirm"],
          data: soundEffectFixture
        });
        const bgmAsset = await uploadAsset(server, workspaceRoot, {
          fileName: "bgm-1s.mp3",
          kind: "bgm",
          mimeType: "audio/mpeg",
          title: "Fixture section BGM"
        });
        const introLines = project.script.sections[0]?.lines ?? [];
        const mainLines = project.script.sections[1]?.lines ?? [];
        const outroLines = project.script.sections[2]?.lines ?? [];
        if (
          introLines.length < 2 ||
          mainLines.length < 2 ||
          outroLines.length < 1
        ) {
          throw new Error(
            "The fixture script does not have its line structure."
          );
        }
        const videoAssignment = await assignVisual(
          server,
          workspaceRoot,
          project,
          {
            id: "visual-fixture-video",
            startLineId: introLines[0].id,
            endLineId: introLines[1].id,
            asset: videoAsset
          }
        );
        project = videoAssignment.project;
        const photoAssignment = await assignVisual(
          server,
          workspaceRoot,
          project,
          {
            id: "visual-fixture-photo",
            startLineId: mainLines[0].id,
            endLineId: mainLines[1].id,
            asset: photoAsset
          }
        );
        project = photoAssignment.project;
        const documentAssignment = await assignVisual(
          server,
          workspaceRoot,
          project,
          {
            id: "visual-fixture-document",
            startLineId: outroLines[0].id,
            endLineId: outroLines[0].id,
            asset: documentAsset
          }
        );
        project = documentAssignment.project;

        const visualApprovalResponse = await server.app.inject({
          method: "POST",
          url: `/api/projects/${projectId}/visuals/approve`,
          payload: { expectedRevision: project.revision }
        });
        expect(visualApprovalResponse.statusCode).toBe(200);
        project = projectMutationResponseSchema.parse(
          visualApprovalResponse.json()
        ).data;
        expect(project.visuals.status).toBe("approved");

        const effectProjectMediaPath = "media/fixture-confirm.wav";
        const effectSourcePath = resolvePosixPath(
          path.join(workspaceRoot, "library"),
          soundEffectAsset.detail.libraryMediaPath
        );
        const effectTargetPath = resolvePosixPath(
          path.join(workspaceRoot, "projects", projectId),
          effectProjectMediaPath
        );
        await fs.mkdir(path.dirname(effectTargetPath), { recursive: true });
        await fs.copyFile(effectSourcePath, effectTargetPath);
        expect(await sha256File(effectTargetPath)).toBe(
          soundEffectAsset.detail.checksum
        );
        const effectFileResponse = await server.app.inject({
          method: "GET",
          url: `/api/projects/${projectId}/files/${effectProjectMediaPath}`
        });
        expect(effectFileResponse.statusCode).toBe(200);
        expect(effectFileResponse.headers["content-type"]).toMatch(
          /^audio\/wav/
        );

        const bgmProjectMediaPath = "media/fixture-section-bgm.mp3";
        const bgmSourcePath = resolvePosixPath(
          path.join(workspaceRoot, "library"),
          bgmAsset.detail.libraryMediaPath
        );
        const bgmTargetPath = resolvePosixPath(
          path.join(workspaceRoot, "projects", projectId),
          bgmProjectMediaPath
        );
        await fs.copyFile(bgmSourcePath, bgmTargetPath);
        const bgmChecksum = bgmAsset.detail.checksum;
        if (bgmChecksum === null) {
          throw new Error("The uploaded BGM checksum is missing.");
        }
        expect(await sha256File(bgmTargetPath)).toBe(bgmChecksum);

        const currentProject = await projectRepository.read(projectId);
        const mainSectionId = currentProject.script.sections[1]?.id;
        const effectLineId = currentProject.script.sections[2]?.lines[0]?.id;
        const representativeVisualPath =
          photoAssignment.assignment.projectMediaPath;
        if (mainSectionId === undefined || effectLineId === undefined) {
          throw new Error("The fixture main/outro section is missing.");
        }
        project = await projectRepository.save(
          projectId,
          {
            ...currentProject,
            audio: {
              soundEffects: [
                {
                  id: "effect-fixture-confirm",
                  soundEffectAssetId: soundEffectAsset.receipt.assetId,
                  assetChecksum: soundEffectAsset.detail.checksum!,
                  projectMediaPath: effectProjectMediaPath,
                  category: "confirm",
                  lineId: effectLineId,
                  offsetMs: 0,
                  volume: 0.2
                }
              ]
            },
            edit: {
              ...currentProject.edit,
              sectionBgms: [
                {
                  id: "bgm-fixture-main",
                  sectionId: mainSectionId,
                  assetId: bgmAsset.receipt.assetId,
                  assetVersion: bgmAsset.detail.version,
                  assetChecksum: bgmChecksum,
                  projectMediaPath: bgmProjectMediaPath,
                  volume: 0.1
                }
              ]
            },
            thumbnail: {
              backgroundImage: null,
              title: "SubDub request fixture",
              subtitle: "Create, verify, and confirm",
              departmentOrSystem: "Operations / SubDub",
              manualVersion: "2026.08",
              characterId: "character-mentor",
              representativeVisualPath,
              layout: "standard"
            }
          },
          currentProject.revision
        );
        expect(project.edit.sectionBgms).toHaveLength(1);
        expect(project.edit.sectionBgms[0]).toMatchObject({
          sectionId: mainSectionId,
          projectMediaPath: bgmProjectMediaPath,
          volume: 0.1
        });
        expect(project.audio.soundEffects).toHaveLength(1);
        expect(project.audio.soundEffects[0]).toMatchObject({
          soundEffectAssetId: soundEffectAsset.receipt.assetId,
          assetChecksum: soundEffectAsset.detail.checksum,
          projectMediaPath: effectProjectMediaPath
        });
        expect(project.thumbnail.representativeVisualPath).toBe(
          representativeVisualPath
        );

        const voiceAcceptedResponse = await server.app.inject({
          method: "POST",
          url: `/api/projects/${projectId}/voice/generate-all`,
          payload: {}
        });
        expect(voiceAcceptedResponse.statusCode).toBe(202);
        const voiceAccepted = voiceGenerationAcceptedResponseSchema.parse(
          voiceAcceptedResponse.json()
        ).data;
        expect(voiceAccepted).toMatchObject({ status: "queued" });
        expect(voiceAccepted.lineIds).toHaveLength(
          allProjectLines(project).length
        );
        await waitForVoiceJob(server, projectId, voiceAccepted.runId);

        const audioStore = new VoicevoxAudioStore({ workspaceRoot });
        const audioIndex = await audioStore.readIndex(projectId);
        expect(Object.keys(audioIndex)).toHaveLength(
          allProjectLines(project).length
        );
        for (const line of allProjectLines(project)) {
          const entry = audioIndex[line.id];
          expect(entry).toBeDefined();
          expect(entry?.durationMs).toBe(1_000);
          if (line.spokenText.includes("SubDub")) {
            expect(entry?.appliedTerms).toEqual(
              expect.arrayContaining([
                expect.objectContaining({ termId: terminology.termId })
              ])
            );
          }
        }
        const firstCompileResponse = await server.app.inject({
          method: "POST",
          url: `/api/projects/${projectId}/manifest/compile`
        });
        expect(firstCompileResponse.statusCode, firstCompileResponse.body).toBe(
          200
        );
        const firstCompile = manifestCompileResponseSchema.parse(
          firstCompileResponse.json()
        ).data;
        expect(firstCompile.status).toBe("compiled");
        if (firstCompile.manifest === null) {
          throw new Error(
            `Manifest compilation failed: ${JSON.stringify(firstCompile.diagnostics)}`
          );
        }
        const manifest = renderManifestSchema.parse(firstCompile.manifest);
        const mentorManifestCharacter = manifest.characters.find(
          (character) => character.characterId === "character-mentor"
        );
        expect(mentorManifestCharacter).toMatchObject({
          visualId: registeredVisual.visualId,
          idleVariantId: registeredIdleVariant.variantId
        });
        const registeredManifestIdleVariant = manifest.characterVariants.find(
          (variant) =>
            variant.visualId === registeredVisual.visualId &&
            variant.variantId === registeredIdleVariant.variantId
        );
        expect(registeredManifestIdleVariant).toMatchObject({
          visualId: registeredVisual.visualId,
          variantId: registeredIdleVariant.variantId,
          renderType: "single-image",
          files: { single: { sha256: registeredIdleFile.checksum } }
        });
        const registeredManifestPointingVariant =
          manifest.characterVariants.find(
            (variant) =>
              variant.visualId === registeredVisual.visualId &&
              variant.variantId === registeredPointingVariant.variantId
          );
        expect(registeredManifestPointingVariant).toMatchObject({
          visualId: registeredVisual.visualId,
          variantId: registeredPointingVariant.variantId,
          renderType: "mouth-pair",
          files: {
            closed: { sha256: registeredPointingClosedFile.checksum },
            open: { sha256: registeredPointingOpenFile.checksum }
          }
        });
        const registeredManifestNormalVariant = manifest.characterVariants.find(
          (variant) =>
            variant.visualId === registeredVisual.visualId &&
            variant.variantId === registeredNormalVariant.variantId
        );
        expect(registeredManifestNormalVariant).toMatchObject({
          visualId: registeredVisual.visualId,
          variantId: registeredNormalVariant.variantId,
          renderType: "mouth-pair",
          files: {
            closed: { sha256: registeredNormalClosedFile.checksum },
            open: { sha256: registeredNormalOpenFile.checksum }
          }
        });
        expect(manifest.width).toBe(1920);
        expect(manifest.height).toBe(1080);
        expect(manifest.fps).toBe(30);
        expect(manifest.durationInFrames).toBeGreaterThan(0);
        expect(manifest.sourceProjectHash).toBe(
          computeSourceProjectHash(project)
        );
        expect(manifest.sourceAssetChecksums).toEqual(
          expect.arrayContaining(
            Object.values(audioIndex).map((entry) =>
              expect.objectContaining({
                path: entry.audioPath,
                sha256: entry.audioSha256
              })
            )
          )
        );
        expect(
          manifest.visuals.find(
            (visual) => visual.sourceAssignmentId === "visual-fixture-document"
          )?.display
        ).toMatchObject({ page: 2 });
        expect(manifest.audioTracks).toHaveLength(1);
        expect(manifest.audioTracks[0]).toMatchObject({
          sectionId: mainSectionId,
          src: bgmProjectMediaPath,
          loop: true
        });
        expect(manifest.soundEffects).toHaveLength(1);
        expect(manifest.inserts).toEqual([]);

        const storedManifestResponse = await server.app.inject({
          method: "GET",
          url: `/api/projects/${projectId}/manifest`
        });
        expect(storedManifestResponse.statusCode).toBe(200);
        const preview = manifestPreviewResponseSchema.parse(
          storedManifestResponse.json()
        ).data;
        expect(preview.state).toBe("current");
        expect(preview.canPlay).toBe(true);
        expect(preview.blockers).toEqual([]);
        expect(preview.manifest).toEqual(manifest);
        if (preview.manifest === null) {
          throw new Error("The preview did not return the stored manifest.");
        }
        const previewManifest = renderManifestSchema.parse(preview.manifest);
        expect(serializeRenderManifest(previewManifest)).toBe(
          serializeRenderManifest(manifest)
        );
        await validateWebPreviewPath(server, projectId, previewManifest, [
          { path: bgmProjectMediaPath, contentType: /^audio\//i },
          { path: effectProjectMediaPath, contentType: /^audio\//i }
        ]);

        const secondCompileResponse = await server.app.inject({
          method: "POST",
          url: `/api/projects/${projectId}/manifest/compile`
        });
        expect(
          secondCompileResponse.statusCode,
          secondCompileResponse.body
        ).toBe(200);
        const secondCompile = manifestCompileResponseSchema.parse(
          secondCompileResponse.json()
        ).data;
        expect(secondCompile.status).toBe("reused");
        if (secondCompile.manifest === null) {
          throw new Error(
            "The second manifest compilation did not return a manifest."
          );
        }
        expect(serializeRenderManifest(secondCompile.manifest)).toBe(
          serializeRenderManifest(manifest)
        );
        expect(secondCompile.manifest.compilerInputHash).toBe(
          manifest.compilerInputHash
        );

        const manifestStore = new RenderManifestStore({ workspaceRoot });
        const compilerInput = await new RenderManifestInputBuilder({
          workspaceRoot,
          projectRepository,
          screenTemplateCatalog: {
            findById: () =>
              createStandardScreenTemplate("2026-08-10T00:00:00.000Z")
          },
          assetRepository: new AssetRepository(server.database.database),
          characterVisualCatalogService: new CharacterVisualCatalogService({
            repository: new CharacterVisualRepository(server.database.database),
            workspaceRoot
          }),
          audioStore
        }).build(projectId);
        const runLogStore = new RunLogStore({ workspaceRoot });
        const manifestRunLog = await runLogStore.read(
          projectId,
          firstCompile.runId
        );
        expect(manifestRunLog).toMatchObject({
          kind: "manifest",
          projectId,
          status: "succeeded",
          projectRevision: project.revision
        });
        expect(manifestRunLog.inputHash).toMatch(/^[0-9a-f]{64}$/);
        const manifestOutput = manifestRunLog.outputs.find(
          (output) => output.path !== undefined
        );
        expect(manifestOutput?.path).toBe(
          `projects/${projectId}/cache/render-manifest.json`
        );
        expect(manifestOutput?.checksum).toMatch(/^[0-9a-f]{64}$/);
        const manifestPath = manifestStore.getManifestPath(projectId);
        const manifestFileChecksum = await sha256File(manifestPath);
        expect(manifestFileChecksum).toBe(manifestOutput?.checksum);

        const videoVisual = manifest.visuals.find(
          (visual) => visual.sourceAssignmentId === "visual-fixture-video"
        );
        const photoVisual = manifest.visuals.find(
          (visual) => visual.sourceAssignmentId === "visual-fixture-photo"
        );
        const documentVisual = manifest.visuals.find(
          (visual) => visual.sourceAssignmentId === "visual-fixture-document"
        );
        if (
          videoVisual === undefined ||
          photoVisual === undefined ||
          documentVisual === undefined
        ) {
          throw new Error("Representative visual ranges are missing.");
        }
        const representativeFrames: RepresentativeFrame[] = [
          { name: "opening", frame: 0 },
          {
            name: "video-content",
            frame:
              videoVisual.from + Math.min(5, videoVisual.durationInFrames - 1)
          },
          {
            name: "photo-content",
            frame:
              photoVisual.from + Math.min(5, photoVisual.durationInFrames - 1)
          },
          {
            name: "document-page-2",
            frame:
              documentVisual.from +
              Math.min(5, documentVisual.durationInFrames - 1)
          }
        ];
        for (const frame of representativeFrames) {
          expect(frame.frame).toBeLessThan(manifest.durationInFrames);
        }
        const renderedFrames = await renderRepresentativeFrames(
          workspaceRoot,
          projectId,
          manifest,
          representativeFrames,
          representativeFrames[1]
        );
        for (const frame of representativeFrames) {
          const actualPath = renderedFrames.actualPaths[frame.name];
          if (actualPath === undefined) {
            throw new Error(
              `Representative frame did not render: ${frame.name}`
            );
          }
          const goldenPath = path.join(goldenRoot, `${frame.name}.png`);
          await writeOrRequireGolden(actualPath, goldenPath, frame.name);
          const stats = await compareRepresentativeImages(
            actualPath,
            goldenPath,
            frame.name
          );
          expect(stats.width).toBe(manifest.width);
          expect(stats.height).toBe(manifest.height);
        }
        await compareRepresentativeImages(
          renderedFrames.actualPaths["video-content"],
          renderedFrames.repeatPath,
          "same-input-rerender"
        );

        const changedFramePath = path.join(
          workspaceRoot,
          "test-results",
          "representative-frames",
          "intentional-change.png"
        );
        const actualPhotoPath = renderedFrames.actualPaths["photo-content"];
        const photoMetadata = await sharp(actualPhotoPath).metadata();
        const overlay = await sharp({
          create: {
            width: Math.max(1, Math.floor((photoMetadata.width ?? 1) / 2)),
            height: Math.max(1, Math.floor((photoMetadata.height ?? 1) / 2)),
            channels: 4,
            background: { r: 255, g: 0, b: 0, alpha: 1 }
          }
        })
          .png()
          .toBuffer();
        await sharp(actualPhotoPath)
          .composite([{ input: overlay, left: 0, top: 0 }])
          .ensureAlpha()
          .png()
          .toFile(changedFramePath);
        await expect(
          compareRepresentativeImages(
            changedFramePath,
            path.join(goldenRoot, "photo-content.png"),
            "intentional-change"
          )
        ).rejects.toThrow(/Representative frame intentional-change/);

        const mp4AcceptedResponse = await server.app.inject({
          method: "POST",
          url: `/api/projects/${projectId}/render`
        });
        expect(mp4AcceptedResponse.statusCode).toBe(202);
        const mp4Accepted = renderAcceptedResponseSchema.parse(
          mp4AcceptedResponse.json()
        ).data;
        expect(mp4Accepted).toMatchObject({ status: "queued", kind: "mp4" });
        const mp4Run = await waitForRenderRun(
          server,
          projectId,
          mp4Accepted.runId,
          RENDER_TIMEOUT_MS
        );
        expect(mp4Run.statuses).toEqual(
          expect.arrayContaining(["queued", "running", "succeeded"])
        );
        const mp4Path = assertRelativeOutputPath(
          workspaceRoot,
          projectId,
          mp4Run.log.outputPath
        );
        expect(mp4Run.log.outputPath).not.toContain(".tmp");
        const mp4Bytes = await fs.readFile(mp4Path);
        expect(mp4Bytes.length).toBeGreaterThan(0);
        expect(sha256Bytes(mp4Bytes)).toBe(mp4Run.log.outputChecksum);
        const mp4RunLog = await runLogStore.read(projectId, mp4Accepted.runId);
        expect(mp4RunLog).toMatchObject({
          kind: "render",
          renderKind: "mp4",
          projectId,
          status: "succeeded",
          projectRevision: project.revision
        });
        expect(mp4RunLog.inputHash).toBe(
          computeRenderInputHash(previewManifest, "mp4")
        );
        const mp4OutputChecksum = mp4Run.log.outputChecksum;
        await validateMp4Output(mp4Path, manifest);
        const renderedPcm = await readMp4MonoPcm(mp4Path);
        const renderedBgm = manifest.audioTracks[0];
        const renderedSoundEffect = manifest.soundEffects[0];
        if (renderedBgm === undefined || renderedSoundEffect === undefined) {
          throw new Error("The manifest audio markers are incomplete.");
        }
        assertRenderedTone(renderedPcm, {
          fromFrame: renderedBgm.from,
          durationInFrames: renderedBgm.durationInFrames,
          fps: manifest.fps,
          frequencyHz: BGM_MARKER_FREQUENCY_HZ,
          label: "BGM"
        });
        assertRenderedTone(renderedPcm, {
          fromFrame: renderedSoundEffect.from,
          durationInFrames: renderedSoundEffect.durationInFrames,
          fps: manifest.fps,
          frequencyHz: SFX_MARKER_FREQUENCY_HZ,
          label: "SFX"
        });

        const thumbnailAcceptedResponse = await server.app.inject({
          method: "POST",
          url: `/api/projects/${projectId}/thumbnail/render`
        });
        expect(thumbnailAcceptedResponse.statusCode).toBe(202);
        const thumbnailAccepted = renderAcceptedResponseSchema.parse(
          thumbnailAcceptedResponse.json()
        ).data;
        expect(thumbnailAccepted).toMatchObject({
          status: "queued",
          kind: "thumbnail"
        });
        const thumbnailRun = await waitForRenderRun(
          server,
          projectId,
          thumbnailAccepted.runId,
          RENDER_TIMEOUT_MS
        );
        expect(thumbnailRun.statuses).toEqual(
          expect.arrayContaining(["queued", "running", "succeeded"])
        );
        const thumbnailPath = assertRelativeOutputPath(
          workspaceRoot,
          projectId,
          thumbnailRun.log.outputPath
        );
        expect(thumbnailRun.log.outputPath).not.toContain(".tmp");
        const thumbnailBytes = await fs.readFile(thumbnailPath);
        expect(thumbnailBytes.length).toBeGreaterThan(0);
        expect(sha256Bytes(thumbnailBytes)).toBe(
          thumbnailRun.log.outputChecksum
        );
        const thumbnailRunLog = await runLogStore.read(
          projectId,
          thumbnailAccepted.runId
        );
        expect(thumbnailRunLog).toMatchObject({
          kind: "render",
          renderKind: "thumbnail",
          projectId,
          status: "succeeded",
          projectRevision: project.revision
        });
        expect(thumbnailRunLog.inputHash).toBe(
          computeRenderInputHash(previewManifest, "thumbnail")
        );
        const thumbnailOutputChecksum = thumbnailRun.log.outputChecksum;
        await validateThumbnailOutput(thumbnailPath);
        const thumbnailGoldenPath = path.join(goldenRoot, "thumbnail.png");
        await writeOrRequireGolden(
          thumbnailPath,
          thumbnailGoldenPath,
          "thumbnail"
        );
        const thumbnailStats = await compareRepresentativeImages(
          thumbnailPath,
          thumbnailGoldenPath,
          "thumbnail"
        );
        expect(thumbnailStats.width).toBe(1280);
        expect(thumbnailStats.height).toBe(720);

        const aiRunId = project.outline.generationRunId;
        if (aiRunId === null) {
          throw new Error("The approved outline did not retain its AI run ID.");
        }
        const aiRunLog = await runLogStore.read(projectId, aiRunId);
        expect(aiRunLog).toMatchObject({
          kind: "ai",
          taskKind: "outline_generation",
          projectId,
          status: "succeeded",
          schemaValidation: "passed"
        });
        expect(aiRunLog.projectRevision).toBeLessThan(project.revision);
        expect(aiRunLog.inputHash).toMatch(/^[0-9a-f]{64}$/);
        expect(aiRunLog.outputs[0]?.checksum).toMatch(/^[0-9a-f]{64}$/);

        const voiceRunLog = await runLogStore.read(
          projectId,
          voiceAccepted.runId
        );
        expect(voiceRunLog).toMatchObject({
          kind: "voice",
          projectId,
          status: "succeeded",
          engine: "VOICEVOX",
          generatedCount: allProjectLines(project).length,
          targetCount: allProjectLines(project).length
        });
        expect(voiceRunLog.inputHash).toMatch(/^[0-9a-f]{64}$/);
        expect(voiceRunLog.outputs).toHaveLength(
          allProjectLines(project).length
        );
        expect(
          voiceRunLog.outputs.every(
            (output) =>
              output.path !== undefined &&
              output.checksum !== undefined &&
              /^[0-9a-f]{64}$/.test(output.checksum)
          )
        ).toBe(true);

        const runKinds = (await runLogStore.list(projectId)).map(
          (runLog) => runLog.kind
        );
        expect(runKinds).toEqual(
          expect.arrayContaining(["ai", "voice", "manifest", "render"])
        );

        const normalProject = await projectRepository.read(projectId);
        const firstLineId = allProjectLines(project)[0]?.id;
        if (firstLineId === undefined) {
          throw new Error("The fixture has no line for failure injection.");
        }
        const brokenAudioIndex = { ...audioIndex };
        delete brokenAudioIndex[firstLineId];
        const failedCompile = await manifestStore.compileAndStore(projectId, {
          ...compilerInput,
          audioIndex: brokenAudioIndex
        });
        expect(failedCompile.status).toBe("failed");
        expect(failedCompile.manifest).toBeNull();
        expect(failedCompile.diagnostics.length).toBeGreaterThan(0);
        const failureRunLog = await runLogStore.read(
          projectId,
          failedCompile.runId
        );
        expect(failureRunLog).toMatchObject({
          kind: "manifest",
          projectId,
          status: "failed"
        });
        expect(failureRunLog.errorCode).toMatch(/^[A-Z][A-Z0-9_]*$/);
        expect(failureRunLog.outputs).toEqual([]);
        expect(await projectRepository.read(projectId)).toEqual(normalProject);
        expect(await sha256File(manifestPath)).toBe(manifestFileChecksum);
        expect(await sha256File(mp4Path)).toBe(mp4OutputChecksum);
        expect(await sha256File(thumbnailPath)).toBe(thumbnailOutputChecksum);

        if (server === undefined) {
          throw new Error("The initial server was not initialized.");
        }
        await server.app.close();
        server = undefined;
        restartedServer = await initializeServer({ workspaceRoot });

        const reloadedProjectResponse = await restartedServer.app.inject({
          method: "GET",
          url: `/api/projects/${projectId}`
        });
        expect(reloadedProjectResponse.statusCode).toBe(200);
        const reloadedProject = projectDetailResponseSchema.parse(
          reloadedProjectResponse.json()
        ).data;
        expect(reloadedProject.metadata.id).toBe(projectId);
        expect(reloadedProject.source.sha256).toBe(sourceHash);
        expect(reloadedProject.outline.status).toBe("approved");
        expect(reloadedProject.script.status).toBe("approved");
        expect(reloadedProject.script.origin).toBe("manual");
        expect(reloadedProject.visuals.status).toBe("approved");
        expect(reloadedProject.edit.sectionBgms).toEqual(
          project.edit.sectionBgms
        );
        expect(reloadedProject.thumbnail).toEqual(project.thumbnail);

        const reloadedPreviewResponse = await restartedServer.app.inject({
          method: "GET",
          url: `/api/projects/${projectId}/manifest`
        });
        expect(reloadedPreviewResponse.statusCode).toBe(200);
        const reloadedPreview = manifestPreviewResponseSchema.parse(
          reloadedPreviewResponse.json()
        ).data;
        expect(reloadedPreview.state).toBe("current");
        expect(reloadedPreview.canPlay).toBe(true);
        expect(reloadedPreview.manifest).not.toBeNull();
        expect(serializeRenderManifest(reloadedPreview.manifest!)).toBe(
          serializeRenderManifest(previewManifest)
        );

        expect(await pathExists(manifestPath)).toBe(true);
        expect(await pathExists(mp4Path)).toBe(true);
        expect(await pathExists(thumbnailPath)).toBe(true);
        expect(await sha256File(manifestPath)).toBe(manifestFileChecksum);
        expect(await sha256File(mp4Path)).toBe(mp4OutputChecksum);
        expect(await sha256File(thumbnailPath)).toBe(thumbnailOutputChecksum);

        for (const runId of [
          aiRunId,
          voiceAccepted.runId,
          firstCompile.runId,
          mp4Accepted.runId,
          thumbnailAccepted.runId
        ]) {
          const persistedRun = await runLogStore.read(projectId, runId);
          expect(persistedRun.projectId).toBe(projectId);
          expect(persistedRun.status).toBe("succeeded");
          expect(persistedRun.projectRevision).toBeGreaterThanOrEqual(0);
        }

        if (restartedServer === undefined) {
          throw new Error(
            "The restarted server is required for the ED-09 fixture."
          );
        }
        const ed09AlternateTemplate = createAlternateScreenTemplate(
          "2026-08-19T00:00:00.000Z"
        );
        new ScreenTemplateRepository(restartedServer.database.database).insert(
          ed09AlternateTemplate
        );
        const ed09BaseProject = await projectRepository.read(projectId);
        const ed09IntroSectionId = ed09BaseProject.script.sections[0]?.id;
        const ed09MainSectionId = ed09BaseProject.script.sections[1]?.id;
        const ed09VideoChecksum = videoAsset.detail.checksum;
        if (
          ed09IntroSectionId === undefined ||
          ed09MainSectionId === undefined ||
          ed09VideoChecksum === null
        ) {
          throw new Error(
            "The ED-09 fixture sections or video asset are missing."
          );
        }
        const createEd09VideoElement = (
          id: string,
          role: VideoProject["edit"]["videoElements"][number]["role"],
          placement: VideoProject["edit"]["videoElements"][number]["placement"],
          volume: number,
          startMs: number | null,
          playbackRate: VideoProject["edit"]["videoElements"][number]["playbackRate"]
        ): VideoProject["edit"]["videoElements"][number] => ({
          id,
          role,
          assetId: videoAsset.receipt.assetId,
          assetVersion: videoAsset.detail.version,
          assetChecksum: ed09VideoChecksum,
          projectMediaPath: videoAssignment.assignment.projectMediaPath,
          placement,
          startMs,
          playbackRate,
          volume,
          text: "",
          textTemplateId: null
        });
        project = await projectRepository.save(
          projectId,
          {
            ...ed09BaseProject,
            script: {
              ...ed09BaseProject.script,
              sections: ed09BaseProject.script.sections.map(
                (section, sectionIndex) =>
                  sectionIndex !== 1
                    ? section
                    : {
                        ...section,
                        screenTemplateId: ALTERNATE_SCREEN_TEMPLATE_ID
                      }
              )
            },
            edit: {
              ...ed09BaseProject.edit,
              videoElements: [
                createEd09VideoElement(
                  "insert-ed09-intro",
                  "intro",
                  { kind: "before_first_section" },
                  0.4,
                  5_000,
                  0.5
                ),
                createEd09VideoElement(
                  "insert-ed09-cutin-1",
                  "cutin",
                  {
                    kind: "before_section",
                    sectionId: ed09MainSectionId,
                    order: 0
                  },
                  0.25,
                  2_500,
                  2
                ),
                createEd09VideoElement(
                  "insert-ed09-cutin-2",
                  "cutin",
                  {
                    kind: "before_section",
                    sectionId: ed09MainSectionId,
                    order: 1
                  },
                  0.75,
                  1_000,
                  1.5
                ),
                createEd09VideoElement(
                  "insert-ed09-outro",
                  "outro",
                  { kind: "after_last_section" },
                  0.6,
                  0,
                  3
                )
              ],
              sectionBgms: [
                {
                  id: "bgm-ed09-intro",
                  sectionId: ed09IntroSectionId,
                  assetId: bgmAsset.receipt.assetId,
                  assetVersion: bgmAsset.detail.version,
                  assetChecksum: bgmChecksum,
                  projectMediaPath: bgmProjectMediaPath,
                  volume: 0.15
                },
                {
                  id: "bgm-ed09-main",
                  sectionId: ed09MainSectionId,
                  assetId: bgmAsset.receipt.assetId,
                  assetVersion: bgmAsset.detail.version,
                  assetChecksum: bgmChecksum,
                  projectMediaPath: bgmProjectMediaPath,
                  volume: 0.1
                }
              ]
            }
          },
          ed09BaseProject.revision
        );
        expect(project.edit.videoElements).toHaveLength(4);
        expect(project.edit.sectionBgms).toHaveLength(2);

        const ed09CompileResponse = await restartedServer.app.inject({
          method: "POST",
          url: `/api/projects/${projectId}/manifest/compile`
        });
        expect(ed09CompileResponse.statusCode, ed09CompileResponse.body).toBe(
          200
        );
        const ed09Compile = manifestCompileResponseSchema.parse(
          ed09CompileResponse.json()
        ).data;
        expect(ed09Compile.status).toBe("compiled");
        if (ed09Compile.manifest === null) {
          throw new Error(
            `ED-09 manifest compilation failed: ${JSON.stringify(ed09Compile.diagnostics)}`
          );
        }
        const ed09Manifest = renderManifestSchema.parse(ed09Compile.manifest);
        expect(ed09Manifest.inserts.map((insert) => insert.role)).toEqual([
          "intro",
          "cutin",
          "cutin",
          "outro"
        ]);
        expect(ed09Manifest.inserts.map((insert) => insert.volume)).toEqual([
          0.4, 0.25, 0.75, 0.6
        ]);
        expect(ed09Manifest.inserts.map((insert) => insert.startMs)).toEqual([
          5_000, 2_500, 1_000, 0
        ]);
        expect(
          ed09Manifest.inserts.map((insert) => insert.playbackRate)
        ).toEqual([0.5, 2, 1.5, 3]);
        if (videoAsset.detail.durationMs === null) {
          throw new Error("The ED-09 video asset duration is missing.");
        }
        expect(
          ed09Manifest.inserts.map((insert) => insert.durationInFrames)
        ).toEqual(
          [0.5, 2, 1.5, 3].map((playbackRate, index) =>
            effectiveMediaDurationInFrames(
              videoAsset.detail.durationMs!,
              [5_000, 2_500, 1_000, 0][index]!,
              playbackRate,
              ed09Manifest.fps
            )
          )
        );
        expect(ed09Manifest.inserts[0]).toMatchObject({
          from: 0,
          src: videoAssignment.assignment.projectMediaPath
        });
        expect(
          (ed09Manifest.inserts[1]?.from ?? 0) +
            (ed09Manifest.inserts[1]?.durationInFrames ?? 0)
        ).toBe(ed09Manifest.inserts[2]?.from);
        expect(
          (ed09Manifest.inserts[3]?.from ?? 0) +
            (ed09Manifest.inserts[3]?.durationInFrames ?? 0)
        ).toBe(ed09Manifest.durationInFrames);
        expect(ed09Manifest.audioTracks).toHaveLength(2);
        expect(ed09Manifest.audioTracks[0]).toMatchObject({
          sectionId: ed09IntroSectionId,
          src: bgmProjectMediaPath,
          volume: 0.15,
          loop: true
        });
        expect(ed09Manifest.audioTracks[1]).toMatchObject({
          sectionId: ed09MainSectionId,
          src: bgmProjectMediaPath,
          volume: 0.1,
          loop: true
        });
        expect(
          ed09Manifest.audioTracks.every((track) =>
            ed09Manifest.inserts.every(
              (insert) =>
                track.from + track.durationInFrames <= insert.from ||
                insert.from + insert.durationInFrames <= track.from
            )
          )
        ).toBe(true);

        const ed09PreviewResponse = await restartedServer.app.inject({
          method: "GET",
          url: `/api/projects/${projectId}/manifest`
        });
        expect(ed09PreviewResponse.statusCode).toBe(200);
        const ed09Preview = manifestPreviewResponseSchema.parse(
          ed09PreviewResponse.json()
        ).data;
        expect(ed09Preview.state).toBe("current");
        expect(ed09Preview.canPlay).toBe(true);
        expect(ed09Preview.manifest).not.toBeNull();
        expect(serializeRenderManifest(ed09Preview.manifest!)).toBe(
          serializeRenderManifest(ed09Manifest)
        );
        await validateWebPreviewPath(
          restartedServer,
          projectId,
          ed09Manifest,
          [
            { path: bgmProjectMediaPath, contentType: /^audio\//i },
            {
              path: videoAssignment.assignment.projectMediaPath,
              contentType: /^video\//i
            }
          ],
          5000
        );

        const ed09SectionVisual = ed09Manifest.visuals.find(
          (visual) => visual.sourceAssignmentId === "visual-fixture-photo"
        );
        const ed09IntroInsert = ed09Manifest.inserts[0];
        const ed09FirstCutin = ed09Manifest.inserts[1];
        const ed09SecondCutin = ed09Manifest.inserts[2];
        const ed09OutroInsert = ed09Manifest.inserts[3];
        if (
          ed09SectionVisual === undefined ||
          ed09IntroInsert === undefined ||
          ed09FirstCutin === undefined ||
          ed09SecondCutin === undefined ||
          ed09OutroInsert === undefined
        ) {
          throw new Error("The ED-09 representative ranges are incomplete.");
        }
        const ed09Frames: RepresentativeFrame[] = [
          { name: "ed09-intro", frame: ed09IntroInsert.from + 5 },
          { name: "ed09-cutin-1", frame: ed09FirstCutin.from + 5 },
          { name: "ed09-cutin-2", frame: ed09SecondCutin.from + 5 },
          {
            name: "ed09-section-content",
            frame: ed09SectionVisual.from + 5
          },
          { name: "ed09-outro", frame: ed09OutroInsert.from + 5 }
        ];
        for (const frame of ed09Frames) {
          expect(frame.frame).toBeLessThan(ed09Manifest.durationInFrames);
        }
        const ed09RenderedFrames = await renderRepresentativeFrames(
          workspaceRoot,
          projectId,
          ed09Manifest,
          ed09Frames,
          ed09Frames[0]
        );
        for (const frame of ed09Frames) {
          const outputPath = ed09RenderedFrames.actualPaths[frame.name];
          if (outputPath === undefined) {
            throw new Error(
              `ED-09 representative frame did not render: ${frame.name}`
            );
          }
          expect((await fs.stat(outputPath)).size).toBeGreaterThan(0);
        }
        await compareRepresentativeImages(
          ed09RenderedFrames.actualPaths["ed09-intro"]!,
          ed09RenderedFrames.repeatPath,
          "ed09-insert-rerender"
        );

        const ed09Mp4AcceptedResponse = await restartedServer.app.inject({
          method: "POST",
          url: `/api/projects/${projectId}/render`
        });
        expect(ed09Mp4AcceptedResponse.statusCode).toBe(202);
        const ed09Mp4Accepted = renderAcceptedResponseSchema.parse(
          ed09Mp4AcceptedResponse.json()
        ).data;
        const ed09Mp4Run = await waitForRenderRun(
          restartedServer,
          projectId,
          ed09Mp4Accepted.runId,
          RENDER_TIMEOUT_MS
        );
        const ed09Mp4Path = assertRelativeOutputPath(
          workspaceRoot,
          projectId,
          ed09Mp4Run.log.outputPath
        );
        await validateMp4Output(ed09Mp4Path, ed09Manifest);

        const stagingEntries = (await fs.readdir(workspaceRoot)).filter(
          (entry) =>
            entry.startsWith(".subdub-render-") ||
            entry.startsWith(".subdub-representative-")
        );
        expect(stagingEntries).toEqual([]);
      } finally {
        if (restartedServer !== undefined) {
          await restartedServer.app.close();
        }
        if (server !== undefined) {
          await server.app.close();
        }
        for (const spy of voicevoxSpies) {
          spy.mockRestore();
        }
        await fs.rm(workspaceRoot, { recursive: true, force: true });
        cleanupVerified = !(await pathExists(workspaceRoot));
      }
      expect(cleanupVerified).toBe(true);
    },
    E2E_TIMEOUT_MS
  );
});
