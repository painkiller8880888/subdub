import type { RenderManifest, VideoProject } from "../schema/index.js";

export type WebUiSchemaConsumer = {
  readonly project: VideoProject;
  readonly manifest: RenderManifest;
};
