import { describe, expectTypeOf, it } from "vitest";

import type { RenderManifest, VideoProject } from "../../src/schema/index.js";

type WebUiConsumer = {
  project: VideoProject;
  manifest: RenderManifest;
};

type ApiConsumer = {
  project: VideoProject;
  manifest: RenderManifest;
};

type TimelineCompilerConsumer = {
  project: VideoProject;
  manifest: RenderManifest;
};

describe("shared schema type contract", () => {
  it("makes the barrel types available to all Phase 0 consumers", () => {
    expectTypeOf<WebUiConsumer>().toEqualTypeOf<ApiConsumer>();
    expectTypeOf<ApiConsumer>().toEqualTypeOf<TimelineCompilerConsumer>();
    expectTypeOf<WebUiConsumer["project"]>().toEqualTypeOf<VideoProject>();
    expectTypeOf<WebUiConsumer["manifest"]>().toEqualTypeOf<RenderManifest>();
  });
});
