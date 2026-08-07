import { describe, expect, it } from "vitest";

import { createRealMediaProcessingPort } from "../../src/app/assets/processing/real-media-processing.js";
import type { AssetProcessedMedia } from "../../src/app/assets/processing/types.js";
import { realMediaFixtures } from "../fixtures/media-fixtures.js";

const port = createRealMediaProcessingPort();

function isPng(buffer: Buffer): boolean {
  return (
    buffer.length > 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  );
}

describe("real media processing port", () => {
  for (const fixture of realMediaFixtures) {
    it(`processes ${fixture.fileName} with expected metadata`, async () => {
      const processed: AssetProcessedMedia = await port.processMedia({
        mediaPath: fixturePath(fixture.fileName),
        kind: fixture.kind,
        maxThumbnailEdgePx: 480
      });

      expect(processed.metadata).toEqual({
        width: fixture.expected.width,
        height: fixture.expected.height,
        durationMs: fixture.expected.durationMs,
        pageCount: fixture.expected.pageCount
      });
      expect(processed.thumbnails).toHaveLength(
        fixture.expected.thumbnailCount
      );
      for (const thumbnail of processed.thumbnails) {
        expect(isPng(thumbnail)).toBe(true);
        expect(thumbnail.length).toBeGreaterThan(0);
      }
    });
  }
});

function fixturePath(fileName: string): string {
  return `${process.cwd()}/tests/fixtures/media/${fileName}`;
}
