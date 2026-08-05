import { fileURLToPath } from "node:url";

import {
  formatCharacterAssetIssues,
  validateCharacterAssets
} from "../src/validation/character-assets.js";

const sourceRoot = fileURLToPath(new URL("../doc/assets/", import.meta.url));
const publicRoot = fileURLToPath(new URL("../public/", import.meta.url));
const result = await validateCharacterAssets({ sourceRoot, publicRoot });

if (!result.valid) {
  console.error(formatCharacterAssetIssues(result.issues));
  process.exitCode = 1;
} else {
  console.log(
    `character assets verified: ${result.files.length} files, ${result.canvas.width}x${result.canvas.height}, alpha PNGs`
  );
}
