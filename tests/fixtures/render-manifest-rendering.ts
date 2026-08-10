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
