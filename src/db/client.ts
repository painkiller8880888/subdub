import { drizzle } from "drizzle-orm/better-sqlite3";

import type { NativeSqliteConnection } from "./connection.js";
import { schema } from "./schema.js";

export function createDrizzleClient(
  connection: NativeSqliteConnection
) {
  // better-sqlite3 12 does not ship declarations. The native boundary is
  // typed locally in connection.ts; Drizzle owns the concrete client shape.
  return drizzle(connection as never, { schema });
}

export type WorkspaceDatabase = ReturnType<typeof createDrizzleClient>;
