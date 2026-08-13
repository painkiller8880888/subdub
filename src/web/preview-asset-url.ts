import { idSchema, relativePosixPathSchema } from "../schema/index.js";
import type { ManifestAssetUrlResolver } from "../remotion/asset-url";

function encodePathSegments(value: string): string {
  return value
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export function createProjectManifestAssetUrlResolver(
  projectId: string
): ManifestAssetUrlResolver {
  const safeProjectId = idSchema.parse(projectId);

  return (manifestPath) => {
    const safePath = relativePosixPathSchema.parse(manifestPath);
    if (
      safePath.includes("%") ||
      /^[A-Za-z][A-Za-z0-9+.-]*:/.test(safePath) ||
      safePath.includes("://")
    ) {
      throw new Error("プレビュー素材のパスが安全な相対パスではありません。");
    }

    if (safePath.startsWith("shared-assets/")) {
      return `/${encodePathSegments(safePath)}`;
    }

    const projectPrefix = `projects/${safeProjectId}/`;
    if (safePath.startsWith("projects/")) {
      if (!safePath.startsWith(projectPrefix)) {
        throw new Error("プレビュー素材が別のプロジェクトを参照しています。");
      }
      return `/api/projects/${encodeURIComponent(safeProjectId)}/files/${encodePathSegments(
        safePath.slice(projectPrefix.length)
      )}`;
    }

    return `/api/projects/${encodeURIComponent(safeProjectId)}/files/${encodePathSegments(
      safePath
    )}`;
  };
}
