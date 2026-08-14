import { fileURLToPath } from "node:url";

import {
  CharacterVisualCatalogService,
  CharacterVisualRepository
} from "../src/app/character-visuals/index.js";
import {
  legacyCharacterVisualDescriptions,
  legacyCharacterVisualNames,
  legacyCharacterVisualSeed
} from "../src/app/character-visuals/character-visual-seed.js";
import { initializeWorkspaceDatabase } from "../src/db/initialize.js";

const workspaceRoot = process.cwd();
const sourceRoot = fileURLToPath(new URL("../doc/assets/", import.meta.url));
const database = await initializeWorkspaceDatabase({ workspaceRoot });

try {
  const service = new CharacterVisualCatalogService({
    repository: new CharacterVisualRepository(database.database),
    workspaceRoot
  });
  const snapshot = await service.seedLegacyCatalog({
    sourceRoot,
    catalog: legacyCharacterVisualSeed,
    names: legacyCharacterVisualNames,
    descriptions: legacyCharacterVisualDescriptions
  });
  const variantCount = snapshot.reduce(
    (count, visual) => count + visual.variants.length,
    0
  );
  const fileCount = snapshot.reduce(
    (count, visual) =>
      count +
      visual.variants.reduce(
        (variantCount, variant) => variantCount + variant.files.length,
        0
      ),
    0
  );
  console.log(
    `character visual catalog seeded: ${snapshot.length} visuals, ${variantCount} variants, ${fileCount} files`
  );
} finally {
  database.close();
}
