import { readFile } from "node:fs/promises";

import {
  getDocument,
  type PDFDocumentProxy,
  type PDFPageProxy
} from "pdfjs-dist/legacy/build/pdf.mjs";
import { createCanvas } from "@napi-rs/canvas";

import { AssetProcessingError } from "../asset-processing-errors.js";
import type { AssetProcessedMedia } from "./types.js";

type RenderParameters = Parameters<PDFPageProxy["render"]>[0];

async function renderPagePng(
  document: PDFDocumentProxy,
  pageNumber: number,
  maxThumbnailEdgePx: number
): Promise<Buffer> {
  const page = await document.getPage(pageNumber);
  try {
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = Math.min(
      1,
      maxThumbnailEdgePx / Math.max(baseViewport.width, baseViewport.height)
    );
    const viewport = page.getViewport({ scale: Math.max(0.1, scale) });
    const canvas = createCanvas(
      Math.max(1, Math.ceil(viewport.width)),
      Math.max(1, Math.ceil(viewport.height))
    );
    const context = canvas.getContext("2d");
    const renderParameters: RenderParameters = {
      canvas: null,
      canvasContext: context as unknown as RenderParameters["canvasContext"],
      viewport
    };
    await page.render(renderParameters).promise;
    return canvas.toBuffer("image/png");
  } finally {
    page.cleanup();
  }
}

export async function processPdfMedia(
  mediaPath: string,
  maxThumbnailEdgePx: number
): Promise<AssetProcessedMedia> {
  const data = await readFile(mediaPath);
  const loadingTask = getDocument({
    data: new Uint8Array(data)
  });
  try {
    const document = await loadingTask.promise;
    const pageCount = document.numPages;
    if (!Number.isInteger(pageCount) || pageCount <= 0) {
      throw new AssetProcessingError("PROCESSING_METADATA_FAILED");
    }

    const firstPage = await document.getPage(1);
    let width: number;
    let height: number;
    try {
      const firstViewport = firstPage.getViewport({ scale: 1 });
      width = Math.round(firstViewport.width);
      height = Math.round(firstViewport.height);
    } finally {
      firstPage.cleanup();
    }

    const thumbnails: Buffer[] = [];
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
      thumbnails.push(
        await renderPagePng(document, pageNumber, maxThumbnailEdgePx)
      );
    }

    return {
      metadata: {
        width,
        height,
        durationMs: null,
        pageCount
      },
      thumbnails
    };
  } catch (error) {
    if (error instanceof AssetProcessingError) {
      throw error;
    }
    throw new AssetProcessingError("PROCESSING_MEDIA_CORRUPTED", {
      cause: error
    });
  } finally {
    await loadingTask.destroy().catch(() => {
      // Best-effort release of the PDF document.
    });
  }
}
