import type { RenderManifest, VideoProject } from "../../schema/index.js";
import { RENDER_JOB_ERROR_CODE, RenderJobError } from "./render-job-errors.js";

export type RenderRendererInput = {
  readonly projectId: string;
  readonly runId: string;
  readonly project: VideoProject;
  readonly manifest: RenderManifest;
  readonly outputPath: string;
};

export type RenderRendererPort = {
  render(input: RenderRendererInput): Promise<void>;
};

export type Mp4RendererPort = RenderRendererPort;
export type ThumbnailRendererPort = RenderRendererPort;

export function createLazyMp4Renderer(options: {
  readonly workspaceRoot: string;
}): Mp4RendererPort {
  let rendererPromise: Promise<RenderRendererPort> | undefined;
  return {
    async render(input) {
      rendererPromise ??= import("./remotion-mp4-renderer.js").then(
        ({ RemotionMp4Renderer }) =>
          new RemotionMp4Renderer({ workspaceRoot: options.workspaceRoot })
      );
      return (await rendererPromise).render(input);
    }
  };
}

export class UnavailableThumbnailRenderer implements ThumbnailRendererPort {
  async render(): Promise<void> {
    throw new RenderJobError(
      RENDER_JOB_ERROR_CODE.thumbnailRenderFailed,
      500,
      "Thumbnail rendering is not available until the P5-08 renderer is implemented."
    );
  }
}
