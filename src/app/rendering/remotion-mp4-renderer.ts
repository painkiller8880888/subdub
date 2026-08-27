import { existsSync } from "node:fs";
import {
  copyFile,
  mkdtemp,
  mkdir,
  readdir,
  realpath,
  rm,
  stat
} from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { bundle } from "@remotion/bundler";
import {
  renderMedia,
  selectComposition,
  type BrowserExecutable
} from "@remotion/renderer";

import {
  getPreviewPresetDefinition,
  relativePosixPathSchema,
  type PreviewPreset,
  type RenderManifest,
  type RenderProfile,
  type VideoProject
} from "../../schema/index.js";
import { RENDER_JOB_ERROR_CODE, RenderJobError } from "./render-job-errors.js";
import type { Mp4RendererPort, RenderRendererInput } from "./renderers.js";

const compositionId = "BasicRemotionComposition" as const;

function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);
  return (
    relativePath === "" ||
    (relativePath !== ".." &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  );
}

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

export function browserExecutable(): BrowserExecutable | undefined {
  const candidates = [
    process.env.CHROME_BIN,
    process.env.CHROMIUM_BIN,
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
    "/opt/google/chrome/google-chrome",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
  ];
  return candidates.find(
    (candidate): candidate is string =>
      candidate !== undefined && existsSync(candidate)
  );
}

function normalizeManifestPath(projectId: string, value: string): string {
  const prefix = `projects/${projectId}/`;
  if (value.startsWith(prefix)) {
    return value.slice(prefix.length);
  }
  return value;
}

export function normalizeRenderAssetPath(
  projectId: string,
  value: string
): string {
  const normalized = normalizeManifestPath(projectId, value);
  const result = relativePosixPathSchema.safeParse(normalized);
  if (!result.success || normalized.includes("%")) {
    throw new RenderJobError(
      RENDER_JOB_ERROR_CODE.sourceAssetPathInvalid,
      422,
      "A render asset path is invalid."
    );
  }
  return result.data;
}

async function ensureSafeRoot(
  workspaceRoot: string,
  rootPath: string,
  kind: "source" | "staging"
): Promise<string> {
  let resolvedWorkspaceRoot: string;
  let resolvedRoot: string;
  try {
    resolvedWorkspaceRoot = await realpath(workspaceRoot);
    resolvedRoot = await realpath(rootPath);
  } catch (error) {
    if (kind === "source" && isMissingPathError(error)) {
      throw new RenderJobError(
        RENDER_JOB_ERROR_CODE.sourceAssetMissing,
        422,
        "A required render asset is missing."
      );
    }
    throw new RenderJobError(
      kind === "source"
        ? RENDER_JOB_ERROR_CODE.sourceAssetUnreadable
        : RENDER_JOB_ERROR_CODE.temporaryOutputWriteFailed,
      500,
      kind === "source"
        ? "A render source could not be resolved."
        : "A render staging directory could not be resolved."
    );
  }
  if (!isPathInside(resolvedWorkspaceRoot, resolvedRoot)) {
    throw new RenderJobError(
      kind === "source"
        ? RENDER_JOB_ERROR_CODE.sourceAssetPathInvalid
        : RENDER_JOB_ERROR_CODE.temporaryOutputWriteFailed,
      500,
      kind === "source"
        ? "A render source escaped the workspace."
        : "A render staging directory escaped the workspace."
    );
  }
  return resolvedRoot;
}

async function copySafeTree(
  sourceRoot: string,
  destinationRoot: string,
  workspaceRoot: string
): Promise<void> {
  let entries;
  try {
    entries = await readdir(sourceRoot, { withFileTypes: true });
  } catch (error) {
    if (isMissingPathError(error)) {
      return;
    }
    throw new RenderJobError(
      RENDER_JOB_ERROR_CODE.sourceAssetUnreadable,
      500,
      "A render source directory could not be read."
    );
  }

  await mkdir(destinationRoot, { recursive: true });
  const resolvedSourceRoot = await ensureSafeRoot(
    workspaceRoot,
    sourceRoot,
    "source"
  );
  for (const entry of entries) {
    const sourcePath = path.join(sourceRoot, entry.name);
    const destinationPath = path.join(destinationRoot, entry.name);
    let resolvedSourcePath: string;
    try {
      resolvedSourcePath = await realpath(sourcePath);
    } catch {
      throw new RenderJobError(
        RENDER_JOB_ERROR_CODE.sourceAssetUnreadable,
        500,
        "A render source could not be resolved."
      );
    }
    if (!isPathInside(resolvedSourceRoot, resolvedSourcePath)) {
      throw new RenderJobError(
        RENDER_JOB_ERROR_CODE.sourceAssetPathInvalid,
        422,
        "A render source escaped its managed directory."
      );
    }
    const sourceStats = await stat(resolvedSourcePath);
    if (sourceStats.isDirectory()) {
      await copySafeTree(sourcePath, destinationPath, workspaceRoot);
    } else if (sourceStats.isFile()) {
      await copyFile(resolvedSourcePath, destinationPath);
    }
  }
}

async function copyReferencedAsset(
  workspaceRoot: string,
  projectId: string,
  relativePath: string,
  publicRoot: string
): Promise<void> {
  const safePath = normalizeRenderAssetPath(projectId, relativePath);
  const isSharedAsset = safePath.startsWith("shared-assets/");
  const isLibraryAsset = safePath.startsWith("library/");
  const sourceRoot = isSharedAsset
    ? path.join(workspaceRoot, "public", "shared-assets")
    : isLibraryAsset
      ? workspaceRoot
      : path.join(workspaceRoot, "projects", projectId);
  const sourceRelativePath = isSharedAsset
    ? safePath.slice("shared-assets/".length)
    : safePath;
  const sourcePath = path.resolve(sourceRoot, ...sourceRelativePath.split("/"));
  const destinationPath = path.resolve(publicRoot, ...safePath.split("/"));
  if (
    !isPathInside(sourceRoot, sourcePath) ||
    !isPathInside(publicRoot, destinationPath)
  ) {
    throw new RenderJobError(
      RENDER_JOB_ERROR_CODE.sourceAssetPathInvalid,
      422,
      "A render source path is invalid."
    );
  }

  let resolvedSourceRoot: string;
  let resolvedSourcePath: string;
  try {
    resolvedSourceRoot = await ensureSafeRoot(
      workspaceRoot,
      sourceRoot,
      "source"
    );
    resolvedSourcePath = await realpath(sourcePath);
  } catch (error) {
    if (error instanceof RenderJobError) {
      throw error;
    }
    if (isMissingPathError(error)) {
      throw new RenderJobError(
        RENDER_JOB_ERROR_CODE.sourceAssetMissing,
        422,
        "A required render asset is missing."
      );
    }
    throw new RenderJobError(
      RENDER_JOB_ERROR_CODE.sourceAssetUnreadable,
      500,
      "A render source could not be read."
    );
  }
  if (!isPathInside(resolvedSourceRoot, resolvedSourcePath)) {
    throw new RenderJobError(
      RENDER_JOB_ERROR_CODE.sourceAssetPathInvalid,
      422,
      "A render source escaped its managed directory."
    );
  }
  const sourceStats = await stat(resolvedSourcePath);
  if (!sourceStats.isFile()) {
    throw new RenderJobError(
      RENDER_JOB_ERROR_CODE.sourceAssetMissing,
      422,
      "A required render asset is not a file."
    );
  }
  await mkdir(path.dirname(destinationPath), { recursive: true });
  await copyFile(resolvedSourcePath, destinationPath);
}

export async function stagePublicDirectory(
  workspaceRoot: string,
  projectId: string,
  manifest: RenderManifest,
  stagingRoot: string,
  options: {
    readonly additionalAssetPaths?: readonly string[];
  } = {}
): Promise<string> {
  const publicRoot = path.join(stagingRoot, "public");
  await mkdir(publicRoot, { recursive: true });
  await copySafeTree(
    path.join(workspaceRoot, "public", "shared-assets"),
    path.join(publicRoot, "shared-assets"),
    workspaceRoot
  );
  await copySafeTree(
    path.join(workspaceRoot, "projects", projectId, "media"),
    path.join(publicRoot, "media"),
    workspaceRoot
  );
  const projectAudioRoot = path.join(
    workspaceRoot,
    "projects",
    projectId,
    "audio"
  );
  await copySafeTree(
    projectAudioRoot,
    path.join(publicRoot, "audio"),
    workspaceRoot
  );
  // Keep both the legacy fixture path and the project-prefixed VOICEVOX path
  // valid because the manifest is passed to Remotion without rewriting paths.
  await copySafeTree(
    projectAudioRoot,
    path.join(publicRoot, "projects", projectId, "audio"),
    workspaceRoot
  );
  for (const asset of manifest.sourceAssetChecksums) {
    await copyReferencedAsset(workspaceRoot, projectId, asset.path, publicRoot);
  }
  for (const assetPath of options.additionalAssetPaths ?? []) {
    await copyReferencedAsset(workspaceRoot, projectId, assetPath, publicRoot);
  }
  return publicRoot;
}

export function remotionOptionsFromProject(
  project: VideoProject,
  renderProfile?: RenderProfile
) {
  if (renderProfile?.kind === "preview") {
    const preset = getPreviewPresetDefinition(renderProfile.previewPreset);
    return {
      codec: "h264" as const,
      pixelFormat: "yuv420p" as const,
      audioCodec: "aac" as const,
      sampleRate: 48000 as const,
      audioBitrate: "128k" as const,
      crf: 23 as const,
      x264Preset: "veryfast" as const,
      scale: previewScaleForPreset(preset.preset)
    };
  }

  const settings = project.metadata.outputSettings;
  return {
    codec: settings.videoCodec,
    pixelFormat: settings.pixelFormat,
    audioCodec: settings.audioCodec,
    sampleRate: settings.audioSampleRate
  } as const;
}

function previewScaleForPreset(preset: PreviewPreset): number {
  // 854x480 is the conventional SD target, but it is not an exact 16:9
  // scale of 1920x1080. Render at an integer 1708x960 intermediate size and
  // use Remotion's scale option to produce the exact requested dimensions.
  return preset === "sd" ? 0.5 : preset === "hd" ? 2 / 3 : 1;
}

type RemotionComposition = Awaited<ReturnType<typeof selectComposition>>;

export function remotionCompositionForProfile(
  composition: RemotionComposition,
  renderProfile?: RenderProfile
): RemotionComposition {
  if (renderProfile?.kind !== "preview") {
    return composition;
  }
  const preset = getPreviewPresetDefinition(renderProfile.previewPreset);
  const scale = previewScaleForPreset(preset.preset);
  return {
    ...composition,
    width: preset.width / scale,
    height: preset.height / scale
  };
}

export type RemotionMp4RendererOptions = {
  readonly workspaceRoot: string;
  readonly entryPoint?: string;
  readonly bundleOptions?: {
    readonly onProgress?: (progress: number) => void;
  };
  readonly browserExecutable?: BrowserExecutable;
};

export class RemotionMp4Renderer implements Mp4RendererPort {
  private readonly workspaceRoot: string;
  private readonly entryPoint: string;
  private readonly bundleOptions: RemotionMp4RendererOptions["bundleOptions"];
  private readonly configuredBrowserExecutable: BrowserExecutable | undefined;

  constructor(options: RemotionMp4RendererOptions) {
    this.workspaceRoot = path.resolve(options.workspaceRoot);
    this.entryPoint =
      options.entryPoint ??
      fileURLToPath(new URL("../../remotion/entry-point.tsx", import.meta.url));
    this.bundleOptions = options.bundleOptions;
    this.configuredBrowserExecutable = options.browserExecutable;
  }

  async render(input: RenderRendererInput): Promise<void> {
    const stagingRoot = await mkdtemp(
      path.join(this.workspaceRoot, ".subdub-render-")
    );
    try {
      const publicRoot = await stagePublicDirectory(
        this.workspaceRoot,
        input.projectId,
        input.manifest,
        stagingRoot
      );

      let serveUrl: string;
      try {
        serveUrl = await bundle({
          entryPoint: this.entryPoint,
          publicDir: publicRoot,
          onProgress: this.bundleOptions?.onProgress ?? (() => undefined)
        });
      } catch {
        throw new RenderJobError(
          RENDER_JOB_ERROR_CODE.bundleFailed,
          500,
          "The Remotion bundle could not be created."
        );
      }

      const browser = this.configuredBrowserExecutable ?? browserExecutable();
      let composition;
      try {
        composition = await selectComposition({
          serveUrl,
          id: compositionId,
          inputProps: input.manifest as unknown as Record<string, unknown>,
          browserExecutable: browser
        });
      } catch {
        throw new RenderJobError(
          RENDER_JOB_ERROR_CODE.compositionSelectionFailed,
          500,
          "The Remotion composition could not be selected."
        );
      }
      if (
        composition.width !== input.manifest.width ||
        composition.height !== input.manifest.height ||
        composition.fps !== input.manifest.fps ||
        composition.durationInFrames !== input.manifest.durationInFrames
      ) {
        throw new RenderJobError(
          RENDER_JOB_ERROR_CODE.compositionSelectionFailed,
          500,
          "The Remotion composition metadata does not match the manifest."
        );
      }

      try {
        const renderComposition = remotionCompositionForProfile(
          composition,
          input.renderProfile
        );
        await renderMedia({
          serveUrl,
          composition: renderComposition,
          inputProps: input.manifest as unknown as Record<string, unknown>,
          outputLocation: input.outputPath,
          overwrite: true,
          browserExecutable: browser,
          logLevel: "error",
          ...remotionOptionsFromProject(input.project, input.renderProfile)
        });
      } catch {
        throw new RenderJobError(
          RENDER_JOB_ERROR_CODE.mp4RenderFailed,
          500,
          "The MP4 render failed."
        );
      }
    } finally {
      try {
        await rm(stagingRoot, { recursive: true, force: true });
      } catch {
        // Staging cleanup must not replace the render failure.
      }
    }
  }
}
