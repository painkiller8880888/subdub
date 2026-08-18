import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";

import type { AssetListItem } from "../../src/schema/asset.js";
import type { ScriptSection } from "../../src/schema/video-project.js";
import { EditPage } from "../../src/web/EditPage";
import {
  addEditVideoElement,
  addSectionBgm,
  createProjectEditInput,
  createEditCutinDropTargets,
  createEditPlanReadModel,
  createEditSectionReadModels,
  editAssetSearchInput,
  isSelectableEditAsset,
  moveEditVideoElement,
  reconcileSavedEditPlan,
  removeEditVideoElement,
  removeSectionBgm,
  replaceEditVideoElement,
  replaceSectionBgm,
  type SelectableEditAsset
} from "../../src/web/edit-page.js";

const sections = [
  {
    id: "section-intro",
    outlineSectionId: "outline-intro",
    name: "導入",
    screenTemplateId: "screen-template-standard",
    background: { kind: "solid", colorToken: "background" },
    lines: []
  },
  {
    id: "section-main",
    outlineSectionId: "outline-main",
    name: "操作手順",
    screenTemplateId: "screen-template-standard",
    background: { kind: "solid", colorToken: "background" },
    lines: []
  }
] satisfies ScriptSection[];

const videoAsset = {
  assetId: "video-asset",
  version: 1,
  kind: "video",
  title: "イントロ素材",
  description: "",
  confidentiality: "internal",
  department: null,
  system: null,
  mimeType: "video/mp4",
  checksum: "a".repeat(64),
  sizeBytes: 100,
  width: 1920,
  height: 1080,
  durationMs: 2000,
  pageCount: null,
  thumbnailPaths: ["media/video-asset/thumbnail-0.png"],
  tags: [],
  tagIds: [],
  status: "active",
  errorCode: null,
  errorMessage: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z"
} satisfies AssetListItem;

const replacementVideoAsset = {
  ...videoAsset,
  assetId: "video-replacement",
  title: "差し替え素材",
  checksum: "b".repeat(64)
} satisfies AssetListItem;

const bgmAsset = {
  ...videoAsset,
  assetId: "bgm-asset",
  kind: "bgm",
  title: "操作説明 BGM",
  mimeType: "audio/mpeg",
  checksum: "c".repeat(64),
  thumbnailPaths: []
} satisfies AssetListItem;

describe("edit page read model", () => {
  it("renders the loading state through the edit route", () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    });
    const markup = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(
          MemoryRouter,
          { initialEntries: ["/projects/edit-page-project/edit"] },
          createElement(
            Routes,
            null,
            createElement(Route, {
              element: createElement(EditPage),
              path: "/projects/:projectId/edit"
            })
          )
        )
      )
    );

    expect(markup).toContain("プロジェクトと編集情報を読み込んでいます");
  });

  it("derives only script-ordered section cards for an empty edit plan", () => {
    const readModel = createEditPlanReadModel({
      videoElements: [],
      sectionBgms: []
    });
    const sectionModels = createEditSectionReadModels(sections, readModel);

    expect(readModel.hasVideoElements).toBe(false);
    expect(readModel.hasSectionBgms).toBe(false);
    expect(sectionModels.map((model) => model.section.name)).toEqual([
      "導入",
      "操作手順"
    ]);
    expect(sectionModels.map((model) => model.order)).toEqual([1, 2]);
    expect(sectionModels.every((model) => model.bgm === undefined)).toBe(true);
  });

  it("recognizes intro, outro, cutin, and section BGM without changing section order", () => {
    const readModel = createEditPlanReadModel({
      videoElements: [
        {
          id: "intro",
          role: "intro",
          assetId: "video-intro",
          assetVersion: 1,
          assetChecksum: "a".repeat(64),
          projectMediaPath: "media/intro.mp4",
          placement: { kind: "before_first_section" },
          volume: 1
        },
        {
          id: "cutin",
          role: "cutin",
          assetId: "video-cutin",
          assetVersion: 2,
          assetChecksum: "b".repeat(64),
          projectMediaPath: "media/cutin.mp4",
          placement: {
            kind: "before_section",
            sectionId: "section-main",
            order: 0
          },
          volume: 0.5
        },
        {
          id: "outro",
          role: "outro",
          assetId: "video-outro",
          assetVersion: 1,
          assetChecksum: "c".repeat(64),
          projectMediaPath: "media/outro.mp4",
          placement: { kind: "after_last_section" },
          volume: 0.8
        }
      ],
      sectionBgms: [
        {
          id: "bgm-main",
          sectionId: "section-main",
          assetId: "bgm",
          assetVersion: 3,
          assetChecksum: "d".repeat(64),
          projectMediaPath: "media/bgm.mp3",
          volume: 0.25
        }
      ]
    });
    const sectionModels = createEditSectionReadModels(sections, readModel);

    expect(readModel.intro?.id).toBe("intro");
    expect(readModel.outro?.id).toBe("outro");
    expect(readModel.cutins.map((element) => element.id)).toEqual(["cutin"]);
    expect(sectionModels[0]?.cutins).toHaveLength(0);
    expect(sectionModels[1]?.cutins.map((element) => element.id)).toEqual([
      "cutin"
    ]);
    expect(sectionModels[1]?.bgm?.assetId).toBe("bgm");
  });

  it("filters picker assets and strips server-owned snapshots from save input", () => {
    expect(isSelectableEditAsset(videoAsset, "video")).toBe(true);
    expect(
      isSelectableEditAsset({ ...videoAsset, status: "inactive" }, "video")
    ).toBe(false);
    expect(
      isSelectableEditAsset({ ...videoAsset, durationMs: null }, "video")
    ).toBe(false);
    expect(isSelectableEditAsset(bgmAsset, "bgm")).toBe(true);

    const editPlan = {
      videoElements: [
        {
          id: "intro",
          role: "intro" as const,
          assetId: videoAsset.assetId,
          assetVersion: videoAsset.version!,
          assetChecksum: videoAsset.checksum!,
          projectMediaPath: "media/intro.mp4",
          placement: { kind: "before_first_section" as const },
          volume: 0
        }
      ],
      sectionBgms: []
    };

    expect(createProjectEditInput(editPlan)).toEqual({
      videoElements: [
        {
          id: "intro",
          role: "intro",
          assetId: videoAsset.assetId,
          assetVersion: videoAsset.version,
          placement: { kind: "before_first_section" },
          volume: 0
        }
      ],
      sectionBgms: []
    });
  });

  it("keeps picker pages explicit so later assets can be loaded", () => {
    expect(editAssetSearchInput("video", 2)).toMatchObject({
      kind: "video",
      format: "mp4",
      status: "active",
      page: 2,
      pageSize: 100
    });
    expect(editAssetSearchInput("bgm", 3).page).toBe(3);
  });

  it("adds unique intro/outro, multiple boundary cutins, and one BGM per section", () => {
    const emptyPlan = { videoElements: [], sectionBgms: [] };
    const selectableVideo = videoAsset as SelectableEditAsset;
    const selectableReplacement = replacementVideoAsset as SelectableEditAsset;
    const selectableBgm = bgmAsset as SelectableEditAsset;
    const withIntro = addEditVideoElement(
      emptyPlan,
      "intro",
      undefined,
      selectableVideo
    );
    const duplicateIntro = addEditVideoElement(
      withIntro,
      "intro",
      undefined,
      selectableReplacement
    );
    expect(duplicateIntro.videoElements).toHaveLength(1);

    const withCutins = addEditVideoElement(
      addEditVideoElement(withIntro, "cutin", "section-main", selectableVideo),
      "cutin",
      "section-main",
      selectableReplacement
    );
    expect(
      withCutins.videoElements
        .filter((element) => element.role === "cutin")
        .map((element) =>
          element.placement.kind === "before_section"
            ? element.placement.order
            : -1
        )
    ).toEqual([0, 1]);

    const withBgm = addSectionBgm(withCutins, "section-main", selectableBgm);
    expect(
      addSectionBgm(withBgm, "section-main", selectableBgm).sectionBgms
    ).toHaveLength(1);
  });

  it("does not add a cutin before the first script section", () => {
    const emptyPlan = { videoElements: [], sectionBgms: [] };
    const selectableVideo = videoAsset as SelectableEditAsset;

    expect(
      addEditVideoElement(
        emptyPlan,
        "cutin",
        "section-intro",
        selectableVideo,
        sections[0]?.id
      )
    ).toEqual(emptyPlan);

    expect(
      addEditVideoElement(
        emptyPlan,
        "cutin",
        "section-main",
        selectableVideo,
        sections[0]?.id
      ).videoElements
    ).toHaveLength(1);
  });

  it("moves cutins between valid boundaries and normalizes each order", () => {
    const dndSections = [
      ...sections,
      {
        id: "section-outro",
        outlineSectionId: "outline-outro",
        name: "まとめ",
        screenTemplateId: "screen-template-standard",
        background: { kind: "solid", colorToken: "background" },
        lines: []
      },
      {
        id: "section-tail",
        outlineSectionId: "outline-tail",
        name: "補足",
        screenTemplateId: "screen-template-standard",
        background: { kind: "solid", colorToken: "background" },
        lines: []
      }
    ] satisfies ScriptSection[];
    const cutin = (id: string, sectionId: string, order: number) => ({
      id,
      role: "cutin" as const,
      assetId: `asset-${id}`,
      assetVersion: 1,
      assetChecksum: "a".repeat(64),
      projectMediaPath: `media/${id}.mp4`,
      placement: { kind: "before_section" as const, sectionId, order },
      volume: 1
    });
    const editPlan = {
      videoElements: [
        cutin("cutin-a", "section-main", 0),
        cutin("cutin-b", "section-main", 1),
        cutin("cutin-c", "section-outro", 0),
        cutin("cutin-d", "section-tail", 5),
        cutin("cutin-e", "section-tail", 10)
      ],
      sectionBgms: []
    };
    const sectionModels = createEditSectionReadModels(
      dndSections,
      createEditPlanReadModel(editPlan)
    );

    expect(createEditCutinDropTargets(sectionModels)).toEqual([
      { sectionId: "section-main", index: 0 },
      { sectionId: "section-main", index: 1 },
      { sectionId: "section-main", index: 2 },
      { sectionId: "section-outro", index: 0 },
      { sectionId: "section-outro", index: 1 },
      { sectionId: "section-tail", index: 0 },
      { sectionId: "section-tail", index: 1 },
      { sectionId: "section-tail", index: 2 }
    ]);

    const reordered = moveEditVideoElement(
      editPlan,
      "cutin-a",
      { sectionId: "section-main", index: 2 },
      dndSections.map((section) => section.id)
    );
    expect(
      reordered.videoElements.map((element) => [element.id, element.placement])
    ).toEqual([
      [
        "cutin-a",
        { kind: "before_section", sectionId: "section-main", order: 1 }
      ],
      [
        "cutin-b",
        { kind: "before_section", sectionId: "section-main", order: 0 }
      ],
      [
        "cutin-c",
        { kind: "before_section", sectionId: "section-outro", order: 0 }
      ],
      [
        "cutin-d",
        { kind: "before_section", sectionId: "section-tail", order: 5 }
      ],
      [
        "cutin-e",
        { kind: "before_section", sectionId: "section-tail", order: 10 }
      ]
    ]);

    const movedBoundary = moveEditVideoElement(
      editPlan,
      "cutin-a",
      { sectionId: "section-outro", index: 1 },
      dndSections.map((section) => section.id)
    );
    expect(
      movedBoundary.videoElements.map((element) => element.placement)
    ).toEqual([
      { kind: "before_section", sectionId: "section-outro", order: 1 },
      { kind: "before_section", sectionId: "section-main", order: 0 },
      { kind: "before_section", sectionId: "section-outro", order: 0 },
      { kind: "before_section", sectionId: "section-tail", order: 5 },
      { kind: "before_section", sectionId: "section-tail", order: 10 }
    ]);

    expect(
      moveEditVideoElement(
        editPlan,
        "cutin-a",
        { sectionId: "section-intro", index: 0 },
        dndSections.map((section) => section.id)
      )
    ).toEqual(editPlan);
  });

  it("replaces and removes edit elements without changing their placement", () => {
    const selectableVideo = videoAsset as SelectableEditAsset;
    const selectableReplacement = replacementVideoAsset as SelectableEditAsset;
    const selectableBgm = bgmAsset as SelectableEditAsset;
    const plan = addSectionBgm(
      addEditVideoElement(
        { videoElements: [], sectionBgms: [] },
        "outro",
        undefined,
        selectableVideo
      ),
      "section-main",
      selectableBgm
    );
    const replacedVideo = replaceEditVideoElement(
      plan,
      plan.videoElements[0]!.id,
      selectableReplacement
    );
    expect(replacedVideo.videoElements[0]?.assetId).toBe(
      replacementVideoAsset.assetId
    );
    expect(replacedVideo.videoElements[0]?.placement).toEqual({
      kind: "after_last_section"
    });

    const replacedBgm = replaceSectionBgm(
      replacedVideo,
      replacedVideo.sectionBgms[0]!.id,
      selectableBgm
    );
    expect(replacedBgm.sectionBgms[0]?.sectionId).toBe("section-main");
    expect(
      removeSectionBgm(
        removeEditVideoElement(replacedBgm, replacedBgm.videoElements[0]!.id),
        replacedBgm.sectionBgms[0]!.id
      )
    ).toEqual({ videoElements: [], sectionBgms: [] });
  });

  it("keeps server-owned snapshots after an edit save", () => {
    const submitted = {
      videoElements: [
        {
          id: "intro",
          role: "intro" as const,
          assetId: videoAsset.assetId,
          assetVersion: 1,
          assetChecksum: videoAsset.checksum!,
          projectMediaPath: "media/pending-edit-asset",
          placement: { kind: "before_first_section" as const },
          volume: 1
        }
      ],
      sectionBgms: []
    };
    const saved = {
      ...submitted,
      videoElements: [
        {
          ...submitted.videoElements[0]!,
          assetChecksum: "d".repeat(64),
          projectMediaPath: "media/edits/video-asset/v1.mp4"
        }
      ]
    };

    const reconciled = reconcileSavedEditPlan(submitted, saved, submitted);
    expect(reconciled.videoElements[0]?.assetChecksum).toBe("d".repeat(64));
    expect(reconciled.videoElements[0]?.projectMediaPath).toBe(
      "media/edits/video-asset/v1.mp4"
    );
  });
});
