import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";

import { videoProjectFixture } from "../fixtures/video-project.js";
import { EditPage } from "../../src/web/EditPage";
import { InsertTextTemplateEditorPage } from "../../src/web/InsertTextTemplateEditorPage";

function renderWithQueryClient(
  queryClient: QueryClient,
  element: ReactElement,
  path: string,
  entry: string
): string {
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(
        MemoryRouter,
        { initialEntries: [entry] },
        createElement(Routes, null, createElement(Route, { element, path }))
      )
    )
  );
}

async function seedQueryError(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  message: string
): Promise<void> {
  await queryClient
    .fetchQuery({
      queryKey,
      queryFn: async () => {
        throw new Error(message);
      },
      retry: false
    })
    .catch(() => undefined);
}

describe("insert text template error states", () => {
  it("renders the editor error state when the initial template GET fails", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, retryOnMount: false } }
    });
    await seedQueryError(
      queryClient,
      ["insert-text-templates", "missing-template"],
      "template service unavailable"
    );

    const markup = renderWithQueryClient(
      queryClient,
      createElement(InsertTextTemplateEditorPage),
      "/insert-text-templates/:templateId",
      "/insert-text-templates/missing-template"
    );

    expect(markup).toContain("テンプレートを取得できません");
    expect(markup).toContain("再読み込み");
    expect(markup).not.toContain("挿入文字テンプレートを読み込んでいます");
  });

  it("shows a retryable catalog error instead of treating the catalog as empty", async () => {
    const projectId = videoProjectFixture.metadata.id;
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, retryOnMount: false } }
    });
    queryClient.setQueryData(["projects", projectId], videoProjectFixture);
    queryClient.setQueryData(["projects", projectId, "edit"], {
      data: videoProjectFixture.edit,
      revision: videoProjectFixture.revision
    });
    await seedQueryError(
      queryClient,
      ["insert-text-templates", "active"],
      "catalog service unavailable"
    );

    const markup = renderWithQueryClient(
      queryClient,
      createElement(EditPage),
      "/projects/:projectId/edit",
      `/projects/${projectId}/edit`
    );

    expect(markup).toContain("挿入文字テンプレートを取得できません");
    expect(markup).toContain("catalog service unavailable");
    expect(markup).toContain("再読み込み");
  });
});
