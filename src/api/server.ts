import { mkdir } from "node:fs/promises";
import * as path from "node:path";

import { buildApp, type AppOptions } from "./app.js";
import { API_HOST, API_PORT } from "./config.js";

export const SERVER_HOST = API_HOST;
export const SERVER_PORT = API_PORT;

export type ServerOptions = AppOptions & {
  workspaceRoot?: string;
};

export async function ensureWorkspaceDirectories(
  workspaceRoot = process.cwd()
): Promise<void> {
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
  await Promise.all([
    mkdir(path.join(resolvedWorkspaceRoot, "library"), { recursive: true }),
    mkdir(path.join(resolvedWorkspaceRoot, "projects"), { recursive: true })
  ]);
}

export async function startServer(options: ServerOptions = {}): Promise<void> {
  const { workspaceRoot = process.cwd(), ...appOptions } = options;
  await ensureWorkspaceDirectories(workspaceRoot);

  const app = buildApp(appOptions);

  try {
    await app.listen({ host: SERVER_HOST, port: SERVER_PORT });
  } catch (error) {
    await app.close();
    throw error;
  }
}
