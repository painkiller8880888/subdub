import type { RenderManifest, VideoProject } from "../schema/index.js";

export type ApiSchemaConsumer = {
  readonly project: VideoProject;
  readonly manifest: RenderManifest;
};
