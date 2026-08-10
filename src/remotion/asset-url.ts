import { staticFile } from "remotion";

/** Resolve a manifest relative POSIX path without probing the filesystem. */
export function resolveManifestAssetUrl(relativePosixPath: string): string {
  return staticFile(relativePosixPath);
}
