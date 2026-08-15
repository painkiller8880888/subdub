import { characterVisualFileParamsSchema } from "../schema/api.js";
import { idSchema, relativePosixPathSchema } from "../schema/index.js";
import type { ManifestAssetUrlResolver } from "../remotion/asset-url";

const characterVisualLibraryPrefix = "library/character-visuals/";
const characterVisualFileKeys = ["single", "closed", "open"] as const;

type CharacterVisualFileKey = (typeof characterVisualFileKeys)[number];

function encodePathSegments(value: string): string {
  return value
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function parseCharacterVisualFileKey(fileName: string): CharacterVisualFileKey {
  if (!fileName.endsWith(".png")) {
    throw new Error("キャラクタービジュアルの画像パスが不正です。");
  }

  const fileStem = fileName.slice(0, -".png".length);
  const fileKey = characterVisualFileKeys.find(
    (candidate) => fileStem === candidate || fileStem.endsWith(`-${candidate}`)
  );
  if (fileKey === undefined) {
    throw new Error("キャラクタービジュアルの画像slotが不正です。");
  }
  return fileKey;
}

function resolveCharacterVisualAssetUrl(manifestPath: string): string | null {
  if (!manifestPath.startsWith(characterVisualLibraryPrefix)) {
    return null;
  }

  const segments = manifestPath.split("/");
  if (segments.length !== 5) {
    throw new Error("キャラクタービジュアルの画像パスが不正です。");
  }

  const visualId = segments[2];
  const variantId = segments[3];
  const fileName = segments[4];
  const fileKey = parseCharacterVisualFileKey(fileName);
  const parsedParams = characterVisualFileParamsSchema.safeParse({
    visualId,
    variantId,
    fileKey
  });
  if (!parsedParams.success) {
    throw new Error("キャラクタービジュアルの識別子が不正です。");
  }

  return `/api/character-visuals/${encodeURIComponent(
    parsedParams.data.visualId
  )}/${encodeURIComponent(parsedParams.data.variantId)}/${encodeURIComponent(
    parsedParams.data.fileKey
  )}`;
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

    const characterVisualUrl = resolveCharacterVisualAssetUrl(safePath);
    if (characterVisualUrl !== null) {
      return characterVisualUrl;
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
