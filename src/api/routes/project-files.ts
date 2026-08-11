import { createReadStream } from "node:fs";

import type { FastifyInstance } from "fastify";

import {
  ProjectFileService,
  ProjectFileServiceError
} from "../../app/projects/project-file-service.js";

export type ProjectFileServicePort = Pick<ProjectFileService, "resolveFile">;

type ProjectFileRequest = {
  Params: {
    projectId: string;
    "*": string;
  };
};

type ByteRange = {
  readonly start: number;
  readonly end: number;
};

function hasEncodedTraversal(rawUrl: string | undefined): boolean {
  if (rawUrl === undefined) {
    return false;
  }
  const pathPart = rawUrl.split("?", 1)[0] ?? rawUrl;
  return /%(?:2e|2f|5c|25)/i.test(pathPart);
}

function parseByteRange(value: unknown, size: number): ByteRange | null {
  if (value === undefined) {
    return null;
  }
  if (typeof value !== "string" || !value.startsWith("bytes=")) {
    throw new RangeError("invalid range");
  }
  const ranges = value.slice("bytes=".length).split(",");
  if (ranges.length !== 1) {
    throw new RangeError("multiple ranges are not supported");
  }
  const range = ranges[0]?.trim() ?? "";
  const separator = range.indexOf("-");
  if (separator < 0) {
    throw new RangeError("invalid range");
  }

  const startText = range.slice(0, separator).trim();
  const endText = range.slice(separator + 1).trim();
  if (startText === "" && endText === "") {
    throw new RangeError("invalid range");
  }

  let start: number;
  let end: number;
  if (startText === "") {
    const suffixLength = Number(endText);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      throw new RangeError("invalid range");
    }
    if (size === 0) {
      throw new RangeError("unsatisfiable range");
    }
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(startText);
    end = endText === "" ? size - 1 : Number(endText);
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end < start ||
      start >= size
    ) {
      throw new RangeError("unsatisfiable range");
    }
    end = Math.min(end, size - 1);
  }

  return { start, end };
}

function sendRangeError(
  reply: {
    code: (statusCode: number) => typeof reply;
    header: (name: string, value: string | number) => typeof reply;
    send: (payload?: unknown) => unknown;
  },
  size: number
): unknown {
  return reply
    .code(416)
    .header("accept-ranges", "bytes")
    .header("content-range", `bytes */${size}`)
    .header("content-length", "0")
    .send();
}

export function registerProjectFileRoutes(
  app: FastifyInstance,
  projectFileService: ProjectFileServicePort
): void {
  app.route<ProjectFileRequest>({
    method: ["GET", "HEAD"],
    url: "/api/projects/:projectId/files/*",
    handler: async (request, reply) => {
      if (hasEncodedTraversal(request.raw.url)) {
        throw new ProjectFileServiceError("PROJECT_FILE_PATH_INVALID", 400);
      }

      const descriptor = await projectFileService.resolveFile(
        request.params.projectId,
        request.params["*"]
      );

      let byteRange: ByteRange | null;
      try {
        byteRange = parseByteRange(request.headers.range, descriptor.size);
      } catch {
        return sendRangeError(reply, descriptor.size);
      }

      const statusCode = byteRange === null ? 200 : 206;
      const contentLength =
        byteRange === null
          ? descriptor.size
          : byteRange.end - byteRange.start + 1;
      reply
        .code(statusCode)
        .type(descriptor.contentType)
        .header("accept-ranges", "bytes")
        .header("content-length", String(contentLength));
      if (byteRange !== null) {
        reply.header(
          "content-range",
          `bytes ${byteRange.start}-${byteRange.end}/${descriptor.size}`
        );
      }

      if (request.method === "HEAD") {
        return reply.send();
      }
      return reply.send(
        byteRange === null
          ? createReadStream(descriptor.filePath)
          : createReadStream(descriptor.filePath, {
              start: byteRange.start,
              end: byteRange.end
            })
      );
    }
  });
}
