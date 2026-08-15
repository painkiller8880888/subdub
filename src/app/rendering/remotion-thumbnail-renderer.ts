import { mkdtemp, rm } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { bundle } from "@remotion/bundler";
import {
  renderStill,
  selectComposition,
  type BrowserExecutable
} from "@remotion/renderer";

import {
  normalizeRenderAssetPath,
  browserExecutable,
  stagePublicDirectory
} from "./remotion-mp4-renderer.js";
import { RENDER_JOB_ERROR_CODE, RenderJobError } from "./render-job-errors.js";
import type {
  ThumbnailRendererPort,
  RenderRendererInput
} from "./renderers.js";
import {
  STANDARD_THUMBNAIL_COMPOSITION_ID,
  STANDARD_THUMBNAIL_DURATION_IN_FRAMES,
  STANDARD_THUMBNAIL_FPS,
  STANDARD_THUMBNAIL_HEIGHT,
  STANDARD_THUMBNAIL_WIDTH,
  type StandardThumbnailCompositionInput
} from "../../remotion/thumbnail-spec.js";

function optionalAssetPath(
  projectId: string,
  assetPath: string | null
): string | null {
  return assetPath === null
    ? null
    : normalizeRenderAssetPath(projectId, assetPath);
}

function resolveCharacterImagePath(input: RenderRendererInput): string | null {
  const characterId = input.project.thumbnail.characterId;
  if (characterId === null) {
    return null;
  }

  const character = input.manifest.characters.find(
    (candidate) => candidate.characterId === characterId
  );
  if (character === undefined) {
    throw new RenderJobError(
      RENDER_JOB_ERROR_CODE.thumbnailRenderFailed,
      500,
      "The thumbnail character reference is invalid."
    );
  }

  const variant = input.manifest.characterVariants.find(
    (candidate) =>
      candidate.variantId === character.idleVariantId &&
      candidate.visualId === character.visualId
  );
  if (variant === undefined) {
    throw new RenderJobError(
      RENDER_JOB_ERROR_CODE.thumbnailRenderFailed,
      500,
      "The thumbnail character variant reference is invalid."
    );
  }

  const imagePath =
    variant.renderType === "single-image"
      ? variant.files.single.path
      : variant.files.closed.path;
  return normalizeRenderAssetPath(input.projectId, imagePath);
}

function normalizedCompositionInput(input: RenderRendererInput): {
  readonly props: StandardThumbnailCompositionInput;
  readonly additionalAssetPaths: readonly string[];
} {
  const characterImagePath = resolveCharacterImagePath(input);
  const thumbnail = {
    ...input.project.thumbnail,
    backgroundImage: optionalAssetPath(
      input.projectId,
      input.project.thumbnail.backgroundImage
    ),
    representativeVisualPath: optionalAssetPath(
      input.projectId,
      input.project.thumbnail.representativeVisualPath
    )
  };
  const additionalAssetPaths = [
    thumbnail.backgroundImage,
    thumbnail.representativeVisualPath,
    characterImagePath
  ].filter((value): value is string => value !== null);

  return {
    props: { thumbnail, characterImagePath },
    additionalAssetPaths: [...new Set(additionalAssetPaths)]
  };
}

export type RemotionThumbnailRendererOptions = {
  readonly workspaceRoot: string;
  readonly entryPoint?: string;
  readonly bundleOptions?: {
    readonly onProgress?: (progress: number) => void;
  };
  readonly browserExecutable?: BrowserExecutable;
};

export class RemotionThumbnailRenderer implements ThumbnailRendererPort {
  private readonly workspaceRoot: string;
  private readonly entryPoint: string;
  private readonly bundleOptions: RemotionThumbnailRendererOptions["bundleOptions"];
  private readonly configuredBrowserExecutable: BrowserExecutable | undefined;

  constructor(options: RemotionThumbnailRendererOptions) {
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
      const { props, additionalAssetPaths } = normalizedCompositionInput(input);
      const publicRoot = await stagePublicDirectory(
        this.workspaceRoot,
        input.projectId,
        input.manifest,
        stagingRoot,
        { additionalAssetPaths }
      );

      let serveUrl: string;
      try {
        serveUrl = await bundle({
          entryPoint: this.entryPoint,
          outDir: path.join(stagingRoot, "bundle"),
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

      const selectedBrowser =
        this.configuredBrowserExecutable ?? browserExecutable();
      const inputProps = props as unknown as Record<string, unknown>;
      let composition;
      try {
        composition = await selectComposition({
          serveUrl,
          id: STANDARD_THUMBNAIL_COMPOSITION_ID,
          inputProps,
          browserExecutable: selectedBrowser
        });
      } catch {
        throw new RenderJobError(
          RENDER_JOB_ERROR_CODE.compositionSelectionFailed,
          500,
          "The thumbnail composition could not be selected."
        );
      }
      if (
        composition.width !== STANDARD_THUMBNAIL_WIDTH ||
        composition.height !== STANDARD_THUMBNAIL_HEIGHT ||
        composition.fps !== STANDARD_THUMBNAIL_FPS ||
        composition.durationInFrames !== STANDARD_THUMBNAIL_DURATION_IN_FRAMES
      ) {
        throw new RenderJobError(
          RENDER_JOB_ERROR_CODE.compositionSelectionFailed,
          500,
          "The thumbnail composition metadata does not match the standard layout."
        );
      }

      try {
        await renderStill({
          serveUrl,
          composition,
          inputProps,
          browserExecutable: selectedBrowser,
          frame: 0,
          imageFormat: "png",
          output: input.outputPath,
          overwrite: true,
          logLevel: "error"
        });
      } catch {
        throw new RenderJobError(
          RENDER_JOB_ERROR_CODE.thumbnailRenderFailed,
          500,
          "The thumbnail render failed."
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
