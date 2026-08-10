import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

import { cancelRender, continueRender, delayRender } from "remotion";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";

import type { RenderVisual } from "../schema/index";
import {
  defaultManifestAssetUrlResolver,
  resolveManifestAssetUrl,
  type ManifestAssetUrlResolver
} from "./asset-url";
import { MediaFrame, mediaAssetStyle } from "./layout";

type RenderDocumentScan = Extract<RenderVisual, { kind: "document_scan" }>;

GlobalWorkerOptions.workerSrc = new URL(
  "../../node_modules/pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url
).toString();

export function DocumentVisual({
  visual,
  assetUrlResolver = defaultManifestAssetUrlResolver
}: {
  visual: RenderDocumentScan;
  assetUrlResolver?: ManifestAssetUrlResolver;
}): ReactNode {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const delayHandleRef = useRef<number | null>(null);
  const continuedRef = useRef(false);

  if (delayHandleRef.current === null) {
    delayHandleRef.current = delayRender("Rendering document page");
  }

  useEffect(() => {
    let disposed = false;
    const delayHandle = delayHandleRef.current;
    if (delayHandle === null) {
      throw new Error("document render delay handle was not created");
    }

    const finishDelay = () => {
      if (!continuedRef.current) {
        continuedRef.current = true;
        continueRender(delayHandle);
      }
    };

    const loadingTask = getDocument({
      url: resolveManifestAssetUrl(visual.src, assetUrlResolver)
    });

    void loadingTask.promise
      .then(async (pdf) => {
        const page = await pdf.getPage(visual.display.page);
        const viewport = page.getViewport({ scale: 2 });
        const canvas = canvasRef.current;
        if (disposed || canvas === null) {
          await loadingTask.destroy();
          return;
        }

        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({ canvas, viewport }).promise;
        await loadingTask.destroy();
        if (!disposed) {
          finishDelay();
        }
      })
      .catch((error: unknown) => {
        if (!disposed) {
          cancelRender(error);
        }
      });

    return () => {
      disposed = true;
      finishDelay();
      void loadingTask.destroy();
    };
  }, [assetUrlResolver, visual.display.page, visual.src]);

  return (
    <MediaFrame display={visual.display}>
      <canvas
        ref={canvasRef}
        style={{
          ...mediaAssetStyle,
          objectFit: visual.display.fit
        }}
      />
    </MediaFrame>
  );
}
