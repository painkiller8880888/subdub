import { fileURLToPath } from "node:url";

import { startServer } from "./server.js";

const webRoot = fileURLToPath(new URL("../web/", import.meta.url));

startServer({ staticRoot: webRoot }).catch((error: unknown) => {
  console.error("Fastifyの起動に失敗しました。", error);
  process.exitCode = 1;
});
