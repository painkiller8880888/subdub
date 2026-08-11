import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { registerMediabunnyServer } from "@mediabunny/server";
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import { ALL_FORMATS, FilePathSource, Input } from "mediabunny";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { initializeServer } from "../../src/api/server.js";
import type { VoicevoxGenerationServicePort } from "../../src/api/routes/voice-generation.js";
import { ProjectRepository } from "../../src/app/projects/project-repository.js";
import { computeOutlineHash } from "../../src/app/projects/script-domain.js";
import {
  browserExecutable,
  stagePublicDirectory
} from "../../src/app/rendering/remotion-mp4-renderer.js";
import {
  computeSourceProjectHash,
  serializeRenderManifest,
  type RenderManifestAssetMetadata
} from "../../src/app/rendering/render-manifest-compiler.js";
import { RenderManifestStore } from "../../src/app/rendering/render-manifest-store.js";
import { VoicevoxAudioStore } from "../../src/app/voicevox/audio-store.js";
import {
  characterVariantCatalog,
  characterVariantMapping
} from "../../src/assets/character-asset-manifest.js";
import { tags } from "../../src/db/schema.js";
import {
  assetDetailResponseSchema,
  assetUploadResponseSchema,
  manifestPreviewResponseSchema,
  projectCreateResponseSchema,
  projectMutationResponseSchema,
  renderAcceptedResponseSchema,
  renderRunStatusResponseSchema,
  terminologyPreviewResponseSchema,
  terminologyTermResponseSchema,
  voiceGenerateRequestSchema,
  type VoiceGenerationStatusData
} from "../../src/schema/api.js";
import {
  renderManifestSchema,
  type AssetDetail,
  type RenderManifest,
  type RenderRunLog,
  type VideoProject
} from "../../src/schema/index.js";
import {
  buildMultipartBody,
  type MultipartPart
} from "../fixtures/asset-fixtures.js";
import { mediaFixture } from "../fixtures/media-fixtures.js";
import {
  createVoicevoxAudioQueryFixture,
  createVoicevoxWavFixture
} from "../fixtures/voicevox.js";
import {
  createRepresentativeFrameOutline,
  createRepresentativeFrameScript,
  representativeFrameBrief,
  representativeFrameMarkdown
} from "../fixtures/e2e/representative-frame-project.js";
import { compareRepresentativeImages } from "../helpers/image-comparison.js";

// Mediabunny's FFmpeg-backed metadata reader must be registered before Input
// instances are created. This is the same production adapter used by asset
// processing, not an ffprobe shell dependency.
registerMediabunnyServer();

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
type RepresentativeFrameGoldenPlatform = "linux" | "windows";

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
const RENDER_TIMEOUT_MS = 180_000;

type InitializedServer = Awaited<ReturnType<typeof initializeServer>>;

type UploadedAsset = {
  readonly receipt: ReturnType<typeof assetUploadResponseSchema.parse>["data"];
  readonly detail: AssetDetail;
};

type RepresentativeFrame = {
  readonly name:
    "opening" | "video-content" | "photo-content" | "document-page-2";
  readonly frame: number;
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

function createFixtureVoiceGenerationService(
  repository: Pick<ProjectRepository, "read">
): VoicevoxGenerationServicePort {
  const lineIds = async (projectId: unknown): Promise<string[]> => {
    const project = await repository.read(projectId);
    return allProjectLines(project).map((line) => line.id);
  };

  return {
    async generate(projectId: unknown, input: unknown) {
      const request = voiceGenerateRequestSchema.parse(input);
      const availableLineIds = await lineIds(projectId);
      return {
        runId: "fixture-voice-run",
        status: "queued" as const,
        lineIds: request.lineIds.filter((lineId) =>
          availableLineIds.includes(lineId)
        )
      };
    },
    async generateAll(projectId: unknown) {
      return {
        runId: "fixture-voice-run-all",
        status: "queued" as const,
        lineIds: await lineIds(projectId)
      };
    },
    async getStatus(projectId: unknown): Promise<VoiceGenerationStatusData> {
      return {
        available: true,
        lines: (await lineIds(projectId)).map((lineId) => ({
          lineId,
          status: "current" as const
        })),
        jobs: []
      };
    }
  };
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
    readonly kind: "video" | "photo" | "document_scan" | "sound_effect";
    readonly mimeType: string;
    readonly title: string;
    readonly tagIds?: readonly string[];
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
    data: await mediaFixture(input.fileName)
  });

  const { body, contentType } = buildMultipartBody(parts);
  const response = await server.app.inject({
    method: "POST",
    url: "/api/assets",
    payload: body,
    headers: { "content-type": contentType }
  });
  expect(response.statusCode).toBe(200);
  const receipt = assetUploadResponseSchema.parse(response.json()).data;
  expect(receipt.status).toBe("processing");
  const detail = await waitForActiveAsset(server, receipt.assetId);
  expect(detail.status).toBe("active");
  expect(detail.checksum).toMatch(/^[0-9a-f]{64}$/);
  expect(detail.sizeBytes).toBeGreaterThan(0);
  expect(detail.libraryMediaPath).toMatch(/^media\//);

  const expectedThumbnailCount =
    input.kind === "document_scan" ? 3 : input.kind === "sound_effect" ? 0 : 1;
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
  kind: "video" | "photo" | "document_scan" | "sound_effect"
) {
  if (kind === "sound_effect") {
    throw new Error("Sound effects cannot be visual assignments.");
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
      muted: true
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
  // Normal runs are read-only. Baseline changes require an explicit opt-in
  // environment variable so a render cannot silently rewrite checked-in PNGs.
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
    // Container/audio timestamp rounding may add a few decoded samples; keep
    // the check explicit and well below a frame-sized regression.
    expect(
      Math.abs(durationSeconds - manifest.durationInFrames / manifest.fps)
    ).toBeLessThanOrEqual(0.25);
  } finally {
    input.dispose();
  }
}

async function validateThumbnailOutput(outputPath: string): Promise<void> {
  const metadata = await sharp(outputPath).metadata();
  expect(metadata.format).toBe("png");
  expect(metadata.width).toBe(1280);
  expect(metadata.height).toBe(720);
  expect(metadata.channels).toBeGreaterThan(0);
  expect((await fs.stat(outputPath)).size).toBeGreaterThan(0);
}

async function buildAssetMetadata(
  workspaceRoot: string,
  projectId: string,
  project: VideoProject,
  audioStore: VoicevoxAudioStore,
  assetDetails: ReadonlyMap<string, AssetDetail>
): Promise<readonly RenderManifestAssetMetadata[]> {
  const metadata: RenderManifestAssetMetadata[] = [];
  const audioIndex = await audioStore.readIndex(projectId);
  for (const entry of Object.values(audioIndex)) {
    metadata.push({
      path: entry.audioPath,
      kind: "audio",
      sha256: entry.audioSha256,
      durationMs: entry.durationMs
    });
  }

  for (const assignment of project.visuals.assignments) {
    const detail = assetDetails.get(assignment.assetId);
    if (detail === undefined || detail.checksum === null) {
      throw new Error(`Missing active detail for visual ${assignment.id}`);
    }
    metadata.push({
      path: assignment.projectMediaPath,
      kind: assignment.display.kind,
      sha256: assignment.assetChecksum,
      ...(detail.durationMs === null ? {} : { durationMs: detail.durationMs }),
      ...(detail.pageCount === null ? {} : { pageCount: detail.pageCount })
    });
  }

  for (const effect of project.audio.soundEffects) {
    const detail = assetDetails.get(effect.soundEffectAssetId);
    if (detail === undefined || detail.checksum === null) {
      throw new Error(`Missing active detail for sound effect ${effect.id}`);
    }
    metadata.push({
      path: effect.projectMediaPath,
      kind: "sound_effect",
      sha256: effect.assetChecksum,
      durationMs: detail.durationMs
    });
  }

  await fs.access(path.join(workspaceRoot, "public", "shared-assets"));
  for (const variant of characterVariantCatalog) {
    for (const file of variant.files) {
      const filePath = path.join(
        workspaceRoot,
        "public",
        ...file.destinationPath.split("/")
      );
      metadata.push({
        path: file.destinationPath,
        kind: "character",
        sha256: await sha256File(filePath)
      });
    }
  }
  return metadata;
}

async function saveFixtureAudio(
  workspaceRoot: string,
  project: VideoProject,
  termId: string,
  previewByLineId: ReadonlyMap<
    string,
    ReturnType<typeof terminologyPreviewResponseSchema.parse>["data"]
  >
): Promise<VoicevoxAudioStore> {
  const audioStore = new VoicevoxAudioStore({ workspaceRoot });
  const wavBytes = createVoicevoxWavFixture({ durationMs: 1_000 });
  const query = JSON.stringify(createVoicevoxAudioQueryFixture(), null, 2);
  const mentor = project.characters.find(
    (character) => character.id === "character-mentor"
  );
  const learner = project.characters.find(
    (character) => character.id === "character-learner"
  );
  if (mentor === undefined || learner === undefined) {
    throw new Error("Fixture characters are missing.");
  }

  for (const [sectionIndex, section] of project.script.sections.entries()) {
    for (const [lineIndex, line] of section.lines.entries()) {
      const queryPath = `projects/${project.metadata.id}/cache/voicevox-query/${line.id}.json`;
      const queryFilePath = resolvePosixPath(workspaceRoot, queryPath);
      await fs.mkdir(path.dirname(queryFilePath), { recursive: true });
      await fs.writeFile(queryFilePath, query, "utf8");
      const preview = previewByLineId.get(line.id);
      if (preview === undefined) {
        throw new Error(`Missing terminology preview for ${line.id}`);
      }
      const character = line.speakerId === mentor.id ? mentor : learner;
      const cacheKey = `${String(sectionIndex + 1).padStart(2, "0")}${String(
        lineIndex + 1
      ).padStart(2, "0")}${"a".repeat(60)}`;
      await audioStore.save({
        projectId: project.metadata.id,
        lineId: line.id,
        sectionOrder: sectionIndex + 1,
        lineOrder: lineIndex + 1,
        prepared: {
          cacheKey,
          queryPath,
          resolvedSpokenText: preview.resolvedSpokenText,
          appliedTerms: preview.appliedTerms,
          voicevoxEngineVersion: "fixture-voicevox-1",
          resolvedSpeaker: {
            speakerName: character.voicevox.speakerName,
            speakerUuid: `${character.id}-fixture-uuid`,
            styleName: character.voicevox.styleName,
            resolvedStyleId: line.speakerId === mentor.id ? 10_001 : 10_002
          }
        },
        audioBytes: wavBytes
      });
      expect(preview.appliedTerms.every((term) => term.termId === termId)).toBe(
        true
      );
    }
  }
  const index = await audioStore.readIndex(project.metadata.id);
  expect(Object.keys(index)).toHaveLength(allProjectLines(project).length);
  for (const line of allProjectLines(project)) {
    const entry = index[line.id];
    expect(entry).toBeDefined();
    expect(entry?.durationMs).toBe(1_000);
    expect(entry?.audioSha256).toBe(sha256Bytes(wavBytes));
    expect(entry?.resolvedSpokenText).toBe(
      previewByLineId.get(line.id)?.resolvedSpokenText
    );
    expect(entry?.appliedTerms).toEqual(
      previewByLineId.get(line.id)?.appliedTerms
    );
  }
  return audioStore;
}

describe("P5-09 representative frame and render E2E", () => {
  it(
    "recreates one fixture through manifest, representative frames, MP4, and thumbnail",
    async () => {
      const workspaceRoot = await fs.mkdtemp(
        path.join(tmpdir(), "subdub-p5-09-e2e-")
      );
      let server: InitializedServer | undefined;
      let cleanupVerified: boolean;
      try {
        await fs.cp(
          path.join(repositoryRoot, "public", "shared-assets"),
          path.join(workspaceRoot, "public", "shared-assets"),
          { recursive: true }
        );
        const projectRepository = new ProjectRepository({ workspaceRoot });
        server = await initializeServer({
          workspaceRoot,
          projectRepository,
          voiceGenerationService:
            createFixtureVoiceGenerationService(projectRepository)
        });

        const createResponse = await server.app.inject({
          method: "POST",
          url: "/api/projects",
          payload: {
            title: "P5-09 representative frame fixture",
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

        const outlineResponse = await server.app.inject({
          method: "PUT",
          url: `/api/projects/${projectId}/outline`,
          payload: {
            outline: createRepresentativeFrameOutline(sourceHash),
            expectedRevision: project.revision
          }
        });
        expect(outlineResponse.statusCode).toBe(200);
        project = projectMutationResponseSchema.parse(
          outlineResponse.json()
        ).data;
        expect(project.revision).toBe(3);
        expect(project.outline.status).toBe("needs_review");
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

        const scriptDraft = createRepresentativeFrameScript(
          computeOutlineHash(project.outline),
          project.outline.sections.map((section) => section.id)
        );
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
        const soundEffectAsset = await uploadAsset(server, workspaceRoot, {
          fileName: "effect-1s.wav",
          kind: "sound_effect",
          mimeType: "audio/wav",
          title: "Fixture confirmation effect",
          tagIds: ["confirm"]
        });
        const assetDetails = new Map<string, AssetDetail>([
          [videoAsset.receipt.assetId, videoAsset.detail],
          [photoAsset.receipt.assetId, photoAsset.detail],
          [documentAsset.receipt.assetId, documentAsset.detail],
          [soundEffectAsset.receipt.assetId, soundEffectAsset.detail]
        ]);

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

        const currentProject = await projectRepository.read(projectId);
        const mainSectionId = currentProject.script.sections[1]?.id;
        const effectLineId = currentProject.script.sections[1]?.lines[1]?.id;
        const representativeVisualPath =
          photoAssignment.assignment.projectMediaPath;
        if (mainSectionId === undefined || effectLineId === undefined) {
          throw new Error("The fixture main section is missing.");
        }
        project = await projectRepository.save(
          projectId,
          {
            ...currentProject,
            audio: {
              sectionBgms: [],
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
            inserts: {
              ...currentProject.inserts,
              eyeCatches: [
                {
                  id: "insert-fixture-eye-catch",
                  kind: "placeholder",
                  slot: "eye_catch",
                  beforeSectionId: mainSectionId,
                  durationMs: 2_000
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
        expect(project.audio.soundEffects).toHaveLength(1);
        expect(project.audio.soundEffects[0]).toMatchObject({
          soundEffectAssetId: soundEffectAsset.receipt.assetId,
          assetChecksum: soundEffectAsset.detail.checksum,
          projectMediaPath: effectProjectMediaPath
        });
        expect(project.thumbnail.representativeVisualPath).toBe(
          representativeVisualPath
        );

        const audioStore = await saveFixtureAudio(
          workspaceRoot,
          project,
          terminology.termId,
          previewByLineId
        );
        const audioIndex = await audioStore.readIndex(projectId);
        const assetMetadata = await buildAssetMetadata(
          workspaceRoot,
          projectId,
          project,
          audioStore,
          assetDetails
        );
        const manifestStore = new RenderManifestStore({ workspaceRoot });
        const compilerInput = {
          project,
          audioIndex,
          assetMetadata,
          characterVariantCatalog,
          characterVariantMapping
        };
        const firstCompile = await manifestStore.compileAndStore(
          projectId,
          compilerInput
        );
        expect(firstCompile.status).toBe("compiled");
        if (firstCompile.manifest === null) {
          throw new Error(
            `Manifest compilation failed: ${JSON.stringify(firstCompile.diagnostics)}`
          );
        }
        const manifest = renderManifestSchema.parse(firstCompile.manifest);
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
            (visual) => visual.id === "visual-fixture-document"
          )?.display
        ).toMatchObject({ page: 2 });
        expect(manifest.soundEffects).toHaveLength(1);
        expect(
          manifest.inserts.some((insert) => insert.slot === "eye_catch")
        ).toBe(true);

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

        const secondCompile = await manifestStore.compileAndStore(
          projectId,
          compilerInput
        );
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

        const videoVisual = manifest.visuals.find(
          (visual) => visual.id === "visual-fixture-video"
        );
        const photoVisual = manifest.visuals.find(
          (visual) => visual.id === "visual-fixture-photo"
        );
        const documentVisual = manifest.visuals.find(
          (visual) => visual.id === "visual-fixture-document"
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
        await validateMp4Output(mp4Path, manifest);

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

        const stagingEntries = (await fs.readdir(workspaceRoot)).filter(
          (entry) =>
            entry.startsWith(".subdub-render-") ||
            entry.startsWith(".subdub-representative-")
        );
        expect(stagingEntries).toEqual([]);
      } finally {
        if (server !== undefined) {
          await server.app.close();
        }
        await fs.rm(workspaceRoot, { recursive: true, force: true });
        cleanupVerified = !(await pathExists(workspaceRoot));
      }
      expect(cleanupVerified).toBe(true);
    },
    E2E_TIMEOUT_MS
  );
});
