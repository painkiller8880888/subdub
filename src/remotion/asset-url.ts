import { staticFile } from "remotion";

export type ManifestAssetUrlResolver = (relativePosixPath: string) => string;

export const defaultManifestAssetUrlResolver: ManifestAssetUrlResolver = (
  relativePosixPath
) => staticFile(relativePosixPath);

/** Resolve a manifest relative POSIX path without probing the filesystem. */
export function resolveManifestAssetUrl(
  relativePosixPath: string,
  resolver: ManifestAssetUrlResolver = defaultManifestAssetUrlResolver
): string {
  return resolver(relativePosixPath);
}
