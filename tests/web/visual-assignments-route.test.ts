import { promises as fs } from "node:fs";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";

import { VisualAssignmentsPage } from "../../src/web/VisualAssignmentsPage";
import { videoProjectFixture } from "../fixtures/video-project.js";

describe("generic visual assignment settings route", () => {
  it("renders the loading state through the project route", () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    });
    const markup = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(
          MemoryRouter,
          { initialEntries: ["/projects/visual-project/visual-assignments"] },
          createElement(
            Routes,
            null,
            createElement(Route, {
              element: createElement(VisualAssignmentsPage),
              path: "/projects/:projectId/visual-assignments"
            })
          )
        )
      )
    );

    expect(markup).toContain(
      "プロジェクトと現場素材の表示設定を読み込んでいます"
    );
  });

  it("renders the generic volume control when a project has a video assignment", () => {
    const project = structuredClone(videoProjectFixture);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    });
    queryClient.setQueryData(["projects", project.metadata.id], project);
    const markup = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(
          MemoryRouter,
          {
            initialEntries: [
              `/projects/${project.metadata.id}/visual-assignments`
            ]
          },
          createElement(
            Routes,
            null,
            createElement(Route, {
              element: createElement(VisualAssignmentsPage),
              path: "/projects/:projectId/visual-assignments"
            })
          )
        )
      )
    );

    expect(markup).toContain("動画の音量（0〜1）");
    expect(markup).toContain('type="range"');
  });

  it("connects the reachable auxiliary screen without restoring the panel to ScriptPage", async () => {
    const [appSource, scriptSource, previewSource, pageSource] =
      await Promise.all([
        fs.readFile("src/web/App.tsx", "utf8"),
        fs.readFile("src/web/ScriptPage.tsx", "utf8"),
        fs.readFile("src/web/preview-state.ts", "utf8"),
        fs.readFile("src/web/VisualAssignmentsPage.tsx", "utf8")
      ]);

    expect(appSource).toContain(
      'path="/projects/:projectId/visual-assignments"'
    );
    expect(scriptSource).toContain("visualAssignmentsPath(projectId)");
    expect(scriptSource).not.toContain("<VisualAssignmentPanel");
    expect(previewSource).toContain("/visual-assignments");
    expect(pageSource).toContain("<VisualAssignmentPanel");
    expect(pageSource).toContain("updateProjectVisualAssignment");
    expect(pageSource).toContain("deleteProjectVisualAssignment");
  });
});
