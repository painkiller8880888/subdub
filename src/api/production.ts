import { fileURLToPath } from "node:url";

import { startServer } from "./server.js";

const webRoot = fileURLToPath(new URL("../web/", import.meta.url));

startServer({ staticRoot: webRoot }).catch(() => {
  process.exitCode = 1;
});
