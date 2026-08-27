import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { computeSourceProjectHash } from "../../src/app/rendering/render-manifest-compiler.js";
import { ManifestPreviewService } from "../../src/app/rendering/manifest-preview-service.js";
import { RenderManifestStore } from "../../src/app/rendering/render-manifest-store.js";
import { computeOutlineHash } from "../../src/app/projects/script-domain.js";
import { createStandardScreenTemplate } from "../../src/app/screen-templates/screen-template-seed.js";
import type { ScreenTemplateSnapshotPort } from "../../src/app/projects/screen-template-selection.js";
import type { VoicevoxAudioIndex } from "../../src/app/voicevox/audio-index.js";
import type { InsertTextTemplate } from "../../src/schema/insert-text-template.js";
import type { VoiceGenerationStatusData } from "../../src/schema/api.js";
import type { RenderManifest, VideoProject } from "../../src/schema/index.js";
import { renderManifestFixture } from "../fixtures/render-manifest.js";
import { createRenderManifestAudioIndex } from "../fixtures/render-manifest-input.js";
import { videoProjectFixture } from "../fixtures/video-project.js";
import { createAlternateScreenTemplate } from "../fixtures/e2e/screen-template-project.js";

const projectId = "manual-video-project";
const roots: string[] = [];

async function createRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(tmpdir(), "subdub-preview-"));
  roots.push(root);
  return root;
}

function createProject(): VideoProject {
  const project = structuredClone(videoProjectFixture) as VideoProject;
  project.script.outlineHash = computeOutlineHash(project.outline);
  return project;
}

function createManifest(project: VideoProject): RenderManifest {
  const manifest = structuredClone(renderManifestFixture) as RenderManifest;
  const audioIndex = createRenderManifestAudioIndex(project);
  manifest.sourceProjectHash = computeSourceProjectHash(project);
  manifest.sourceAssetChecksums = [];
  manifest.lines = manifest.lines.map((line) => ({
    ...line,
    audioPath: audioIndex[line.id]?.audioPath ?? line.audioPath
  }));
  return manifest;
}

function audioStore(audioIndex: VoicevoxAudioIndex) {
  return {
    readIndex: async () => audioIndex
  };
}

function currentVoiceStatus(project: VideoProject): VoiceGenerationStatusData {
  return {
    available: true,
    lines: project.script.sections.flatMap((section) =>
      section.lines.map((line) => ({ lineId: line.id, status: "current" }))
    ),
    jobs: []
  };
}

async function createService(
  root: string,
  project: VideoProject,
  options: {
    manifest?: RenderManifest;
    audioIndex?: VoicevoxAudioIndex;
    projectFileService?: {
      resolveFile: (
        projectId: unknown,
        relativePath: unknown
      ) => Promise<{
        filePath: string;
        size: number;
        contentType: string;
      }>;
    };
    voiceGenerationService?: {
      getStatus: (projectId: unknown) => Promise<VoiceGenerationStatusData>;
    };
    screenTemplateCatalog?: ScreenTemplateSnapshotPort;
    insertTextTemplateCatalog?: {
      findById: (templateId: string) => InsertTextTemplate | undefined;
    };
  } = {}
): Promise<ManifestPreviewService> {
  const manifestStore = new RenderManifestStore({ workspaceRoot: root });
  if (options.manifest !== undefined) {
    await manifestStore.write(projectId, options.manifest);
  }
  return new ManifestPreviewService({
    workspaceRoot: root,
    projectRepository: { read: async () => project },
    screenTemplateCatalog: options.screenTemplateCatalog ?? {
      findById: (templateId) =>
        templateId === "screen-template-standard"
          ? createStandardScreenTemplate("2026-08-10T00:00:00.000Z")
          : undefined
    },
    insertTextTemplateCatalog: options.insertTextTemplateCatalog,
    manifestStore,
    audioStore: audioStore(
      options.audioIndex ?? createRenderManifestAudioIndex(project)
    ),
    voiceGenerationService: options.voiceGenerationService ?? {
      getStatus: async () => currentVoiceStatus(project)
    },
    projectFileService: options.projectFileService
  });
}

describe("ManifestPreviewService", () => {
  afterEach(async () => {
    await Promise.all(
      roots
        .splice(0)
        .map((root) => fs.rm(root, { recursive: true, force: true }))
    );
  });

  it("returns a playable current manifest using the saved manifest", async () => {
    const root = await createRoot();
    const project = createProject();
    const manifest = createManifest(project);
    const service = await createService(root, project, { manifest });

    await expect(service.get(projectId)).resolves.toMatchObject({
      state: "current",
      canPlay: true,
      project: { id: projectId, title: project.metadata.title },
      manifest,
      blockers: []
    });
  });

  it("reports a missing manifest as a normal blocked state", async () => {
    const root = await createRoot();
    const project = createProject();
    const service = await createService(root, project);

    const result = await service.get(projectId);
    expect(result.state).toBe("missing");
    expect(result.canPlay).toBe(false);
    expect(result.manifest).toBeNull();
    expect(result.blockers.map((blocker) => blocker.code)).toContain(
      "MANIFEST_NOT_FOUND"
    );
  });

  it("blocks output preparation for missing or inactive template references", async () => {
    const root = await createRoot();
    const project = createProject();
    project.script.sections[0]!.screenTemplateId = "missing-template";
    const manifest = createManifest(project);
    const service = await createService(root, project, {
      manifest,
      screenTemplateCatalog: {
        findById: (templateId) => {
          if (templateId === "inactive-template") {
            const template = createStandardScreenTemplate(
              "2026-08-10T00:00:00.000Z"
            );
            template.templateId = templateId;
            template.status = "inactive";
            return template;
          }
          return templateId === "screen-template-standard"
            ? createStandardScreenTemplate("2026-08-10T00:00:00.000Z")
            : undefined;
        }
      }
    });

    const result = await service.get(projectId);
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "SCREEN_TEMPLATE_REFERENCE_INVALID",
          target: { kind: "script", sectionId: "section-intro" }
        })
      ])
    );
    expect(result.canPlay).toBe(false);
  });

  it("targets invalid insert text references at the edit page", async () => {
    const root = await createRoot();
    const project = createProject();
    const videoAssignment = project.visuals.assignments.find(
      (assignment) => assignment.display.kind === "video"
    );
    if (videoAssignment === undefined) {
      throw new Error("fixture video assignment is missing");
    }
    project.edit.videoElements = [
      {
        id: "edit-intro",
        role: "intro",
        assetId: videoAssignment.assetId,
        assetVersion: 1,
        assetChecksum: videoAssignment.assetChecksum,
        projectMediaPath: videoAssignment.projectMediaPath,
        placement: { kind: "before_first_section" },
        volume: 1,
        text: "表示文字",
        textTemplateId: "missing-template"
      }
    ];
    const service = await createService(root, project, {
      manifest: createManifest(project),
      insertTextTemplateCatalog: {
        findById: () => undefined
      }
    });

    const result = await service.get(projectId);

    expect(result.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "INSERT_TEXT_TEMPLATE_REFERENCE_INVALID",
          target: { kind: "edit", elementId: "edit-intro" }
        })
      ])
    );
  });

  it("keeps the previous manifest and reports project staleness", async () => {
    const root = await createRoot();
    const project = createProject();
    const manifest = createManifest(project);
    const service = await createService(root, project, { manifest });
    project.metadata.title = "更新後のタイトル";

    const result = await service.get(projectId);
    expect(result.state).toBe("stale");
    expect(result.canPlay).toBe(false);
    expect(result.manifest).toEqual(manifest);
    expect(result.blockers.map((blocker) => blocker.code)).toContain(
      "MANIFEST_PROJECT_STALE"
    );
  });

  it.each(["revision", "content hash"])(
    "reports a stale manifest when the referenced screen template changes by %s",
    async (change) => {
      const root = await createRoot();
      const project = createProject();
      const manifest = createManifest(project);
      const currentTemplate = createStandardScreenTemplate(
        "2026-08-10T00:00:00.000Z"
      );
      const service = await createService(root, project, {
        manifest,
        screenTemplateCatalog: {
          findById: (templateId) =>
            templateId === currentTemplate.templateId
              ? currentTemplate
              : undefined
        }
      });

      if (change === "revision") {
        currentTemplate.revision += 1;
      } else {
        currentTemplate.elements[0]!.transform.rect.x += 0.01;
      }

      const result = await service.get(projectId);
      expect(result.state).toBe("stale");
      expect(result.canPlay).toBe(false);
      expect(result.blockers.map((blocker) => blocker.code)).toContain(
        "MANIFEST_SCREEN_TEMPLATE_STALE"
      );
    }
  );

  it("ignores edits to an unreferenced screen template", async () => {
    const root = await createRoot();
    const project = createProject();
    const manifest = createManifest(project);
    const standard = createStandardScreenTemplate("2026-08-10T00:00:00.000Z");
    const alternate = createAlternateScreenTemplate("2026-08-10T00:00:00.000Z");
    const service = await createService(root, project, {
      manifest,
      screenTemplateCatalog: {
        findById: (templateId) =>
          templateId === standard.templateId
            ? standard
            : templateId === alternate.templateId
              ? alternate
              : undefined
      }
    });

    alternate.revision += 1;
    alternate.elements[0]!.transform.rect.x += 0.01;

    await expect(service.get(projectId)).resolves.toMatchObject({
      state: "current",
      canPlay: true,
      blockers: []
    });
  });

  it("uses the voice current-status result instead of audio integrity alone", async () => {
    const root = await createRoot();
    const project = createProject();
    const manifest = createManifest(project);
    const staleLineId = project.script.sections[0]?.lines[0]?.id;
    if (staleLineId === undefined) {
      throw new Error("a voice line is required");
    }
    const status: VoiceGenerationStatusData = {
      available: true,
      lines: project.script.sections.flatMap((section) =>
        section.lines.map((line) => ({
          lineId: line.id,
          status: line.id === staleLineId ? "stale" : "current"
        }))
      ),
      jobs: []
    };
    const service = await createService(root, project, {
      manifest,
      voiceGenerationService: {
        getStatus: async () => status
      }
    });

    const result = await service.get(projectId);

    expect(result.canPlay).toBe(false);
    expect(
      result.blockers.some(
        (blocker) =>
          blocker.code === "AUDIO_ENTRY_STALE" &&
          blocker.target.lineId === staleLineId
      )
    ).toBe(true);
  });

  it.each([
    [
      "outline approval",
      (project: VideoProject) => (project.outline.status = "draft"),
      "OUTLINE_NOT_APPROVED"
    ],
    [
      "outline freshness",
      (project: VideoProject) => (project.outline.sourceHash = "f".repeat(64)),
      "OUTLINE_SOURCE_HASH_MISMATCH"
    ],
    [
      "script freshness",
      (project: VideoProject) => (project.script.outlineHash = "f".repeat(64)),
      "SCRIPT_OUTLINE_HASH_MISMATCH"
    ]
  ])("distinguishes %s blockers", async (_name, change, expectedCode) => {
    const root = await createRoot();
    const project = createProject();
    const manifest = createManifest(project);
    const service = await createService(root, project, { manifest });
    change(project);

    const result = await service.get(projectId);
    expect(result.blockers.map((blocker) => blocker.code)).toContain(
      expectedCode
    );
  });

  it("does not gate preview on script or visual approval status", async () => {
    const root = await createRoot();
    const project = createProject();
    project.script.status = "draft";
    project.visuals.status = "needs_review";
    const manifest = createManifest(project);
    const service = await createService(root, project, { manifest });

    await expect(service.get(projectId)).resolves.toMatchObject({
      state: "current",
      canPlay: true,
      blockers: []
    });
  });

  it("treats invalid JSON safely without exposing a file path", async () => {
    const root = await createRoot();
    const project = createProject();
    const manifestPath = path.join(
      root,
      "projects",
      projectId,
      "cache",
      "render-manifest.json"
    );
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.writeFile(manifestPath, "{ invalid", "utf8");
    const service = await createService(root, project);

    const result = await service.get(projectId);
    expect(result.state).toBe("invalid");
    expect(result.blockers.map((blocker) => blocker.code)).toContain(
      "MANIFEST_INVALID"
    );
    expect(JSON.stringify(result)).not.toContain(root);
  });

  it("reports a checksum mismatch from the actual project asset", async () => {
    const root = await createRoot();
    const project = createProject();
    const assetPath = path.join(
      root,
      "projects",
      projectId,
      "media",
      "clip.bin"
    );
    await fs.mkdir(path.dirname(assetPath), { recursive: true });
    await fs.writeFile(assetPath, "actual", "utf8");
    const manifest = createManifest(project);
    manifest.sourceAssetChecksums = [
      { path: "media/clip.bin", sha256: "0".repeat(64) }
    ];
    const service = await createService(root, project, {
      manifest,
      projectFileService: {
        resolveFile: async () => ({
          filePath: assetPath,
          size: 6,
          contentType: "application/octet-stream"
        })
      }
    });

    const result = await service.get(projectId);
    expect(result.blockers.map((blocker) => blocker.code)).toContain(
      "ASSET_CHECKSUM_MISMATCH"
    );
  });

  it("resolves SQLite-managed character files from the workspace library", async () => {
    const root = await createRoot();
    const project = createProject();
    const libraryPath =
      "library/character-visuals/visual-custom/variant-custom/single.png";
    const filePath = path.join(root, ...libraryPath.split("/"));
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, "character-data", "utf8");

    const manifest = createManifest(project);
    manifest.sourceAssetChecksums = [
      {
        path: libraryPath,
        sha256: createHash("sha256").update("character-data").digest("hex")
      }
    ];
    const service = await createService(root, project, { manifest });

    await expect(service.get(projectId)).resolves.toMatchObject({
      state: "current",
      canPlay: true,
      blockers: []
    });
  });
});
