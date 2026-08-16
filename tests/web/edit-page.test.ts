import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";

import type { ScriptSection } from "../../src/schema/video-project.js";
import { EditPage } from "../../src/web/EditPage";
import {
  createEditPlanReadModel,
  createEditSectionReadModels
} from "../../src/web/edit-page.js";

const sections = [
  {
    id: "section-intro",
    outlineSectionId: "outline-intro",
    name: "導入",
    background: { kind: "solid", colorToken: "background" },
    lines: []
  },
  {
    id: "section-main",
    outlineSectionId: "outline-main",
    name: "操作手順",
    background: { kind: "solid", colorToken: "background" },
    lines: []
  }
] satisfies ScriptSection[];

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
});
