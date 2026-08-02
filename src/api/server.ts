import { buildApp, type AppOptions } from "./app.js";
import { API_HOST, API_PORT } from "./config.js";

export const SERVER_HOST = API_HOST;
export const SERVER_PORT = API_PORT;

export async function startServer(options: AppOptions = {}): Promise<void> {
  const app = buildApp(options);

  try {
    await app.listen({ host: SERVER_HOST, port: SERVER_PORT });
  } catch (error) {
    app.log.error(error);
    await app.close();
    throw error;
  }
}
