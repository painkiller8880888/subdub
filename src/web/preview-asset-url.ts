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
      throw new Error("Manifest asset path is not a safe relative path.");
    }

    if (safePath.startsWith("shared-assets/")) {
      return `/${encodePathSegments(safePath)}`;
    }

    const projectPrefix = `projects/${safeProjectId}/`;
    if (safePath.startsWith("projects/")) {
      if (!safePath.startsWith(projectPrefix)) {
        throw new Error("Manifest asset belongs to another project.");
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
