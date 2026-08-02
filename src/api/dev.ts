import { startServer } from "./server.js";

startServer().catch((error: unknown) => {
  console.error("Fastifyの起動に失敗しました。", error);
  process.exitCode = 1;
});
