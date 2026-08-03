import type { RenderManifest, VideoProject } from "../schema/index.js";

export type TimelineCompilerSchemaConsumer = {
  readonly project: VideoProject;
  readonly manifest: RenderManifest;
};
