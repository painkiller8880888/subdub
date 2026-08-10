import type { RenderManifest } from "../../src/schema/index.js";
import { renderManifestFixture } from "./render-manifest.js";

const renderAssetPaths: Record<string, string> = {
  "media/application-demo.mp4": "media/clip.mp4",
  "media/application-form.png": "media/oriented.jpg",
  "media/completion-report.pdf": "media/scan-3pages.pdf"
};

function renderingPath(path: string): string {
  return renderAssetPaths[path] ?? path;
}

export const renderManifestRenderingFixture = {
  ...renderManifestFixture,
  sourceAssetChecksums: renderManifestFixture.sourceAssetChecksums.map(
    (asset) => ({ ...asset, path: renderingPath(asset.path) })
  ),
  visuals: renderManifestFixture.visuals.map((visual) => {
    if (visual.kind === "document_scan") {
      return {
        ...visual,
        src: renderingPath(visual.src),
        display: { ...visual.display, page: 2 }
      };
    }
    if (visual.kind === "photo") {
      return {
        ...visual,
        src: renderingPath(visual.src),
        display: {
          ...visual.display,
          annotations: [
            {
              id: "photo-arrow",
              kind: "arrow",
              text: null,
              x: 0.2,
              y: 0.3,
              width: 0.25,
              height: 0,
              colorToken: "warning"
            }
          ]
        }
      };
    }
    return { ...visual, src: renderingPath(visual.src) };
  }),
  backgrounds: renderManifestFixture.backgrounds.map((background) =>
    background.background.kind === "image"
      ? {
          ...background,
          background: {
            ...background.background,
            src: "media/shot.png"
          }
        }
      : background
  )
} satisfies RenderManifest;
