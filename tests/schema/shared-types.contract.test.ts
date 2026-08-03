import { describe, expectTypeOf, it } from "vitest";

import type { RenderManifest, VideoProject } from "../../src/schema/index.js";
import type { ApiSchemaConsumer } from "../../src/api/shared-schema-types.js";
import type { TimelineCompilerSchemaConsumer } from "../../src/timeline/shared-schema-types.js";
import type { WebUiSchemaConsumer } from "../../src/web/shared-schema-types.js";

describe("shared schema type contract", () => {
  it("makes the barrel types available to all Phase 0 consumers", () => {
    expectTypeOf<
      WebUiSchemaConsumer["project"]
    >().toEqualTypeOf<VideoProject>();
    expectTypeOf<ApiSchemaConsumer["project"]>().toEqualTypeOf<VideoProject>();
    expectTypeOf<
      TimelineCompilerSchemaConsumer["project"]
    >().toEqualTypeOf<VideoProject>();
    expectTypeOf<
      WebUiSchemaConsumer["manifest"]
    >().toEqualTypeOf<RenderManifest>();
    expectTypeOf<
      ApiSchemaConsumer["manifest"]
    >().toEqualTypeOf<RenderManifest>();
    expectTypeOf<
      TimelineCompilerSchemaConsumer["manifest"]
    >().toEqualTypeOf<RenderManifest>();
  });
});
