import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import {
  ManagedVariantImage,
  VisualListItem
} from "../../src/web/CharacterVisualsPage";
import {
  characterVisualDraftFromSet,
  characterVisualFileUrl,
  shouldInitializeSelectedVisualDraft
} from "../../src/web/character-visuals-view";
import type { CharacterVisualSet } from "../../src/schema/character-visual.js";

const firstChecksum = "a".repeat(64);
const secondChecksum = "b".repeat(64);

function makeVisual(checksum: string): CharacterVisualSet {
  return {
    visualId: "visual-1",
    name: "霊夢",
    description: "主人公",
    status: "inactive",
    baseWidth: 640,
    baseHeight: 360,
    variants: [
      {
        variantId: "variant-1",
        label: "通常",
        renderType: "single-image",
        status: "active",
        tags: ["default"],
        files: [
          {
            key: "single",
            libraryPath:
              "library/character-visuals/visual-1/variant-1/single.png",
            mimeType: "image/png",
            checksum,
            sizeBytes: 1,
            width: 640,
            height: 360
          }
        ]
      }
    ],
    createdAt: "2026-08-14T00:00:00.000Z",
    updatedAt: "2026-08-14T00:00:00.000Z"
  };
}

describe("character visual view behavior", () => {
  it("changes managed file URLs when a replacement checksum changes", () => {
    const oldUrl = characterVisualFileUrl(
      "visual-1",
      "variant-1",
      "single",
      firstChecksum
    );
    const newUrl = characterVisualFileUrl(
      "visual-1",
      "variant-1",
      "single",
      secondChecksum
    );

    expect(oldUrl).toContain(`?v=${firstChecksum}`);
    expect(newUrl).toContain(`?v=${secondChecksum}`);
    expect(newUrl).not.toBe(oldUrl);
  });

  it("renders checksum-busted URLs in the managed preview and list preview", () => {
    const visual = makeVisual(firstChecksum);
    const managedMarkup = renderToStaticMarkup(
      createElement(ManagedVariantImage, {
        checksum: firstChecksum,
        fileKey: "single",
        label: "通常・画像",
        variantId: "variant-1",
        visualId: "visual-1"
      })
    );
    const listMarkup = renderToStaticMarkup(
      createElement(VisualListItem, {
        onSelect: () => undefined,
        selected: false,
        visual
      })
    );

    expect(managedMarkup).toContain(`?v=${firstChecksum}`);
    expect(listMarkup).toContain(`?v=${firstChecksum}`);
    expect(listMarkup).toContain("inactive");
  });

  it("initializes a draft only for a newly selected visual", () => {
    const visual = makeVisual(firstChecksum);

    expect(
      shouldInitializeSelectedVisualDraft("visual-1", "visual-1", visual)
    ).toBe(false);
    expect(
      shouldInitializeSelectedVisualDraft("visual-1", "visual-2", visual)
    ).toBe(false);
    expect(shouldInitializeSelectedVisualDraft(null, "visual-1", visual)).toBe(
      true
    );
    expect(
      shouldInitializeSelectedVisualDraft("visual-1", "visual-1", undefined)
    ).toBe(false);
  });

  it("copies only server metadata when a selected visual draft is initialized", () => {
    const visual = makeVisual(firstChecksum);

    expect(characterVisualDraftFromSet(visual)).toEqual({
      description: "主人公",
      name: "霊夢",
      status: "inactive"
    });
  });
});
