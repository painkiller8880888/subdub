import { startServer } from "./server.js";

startServer().catch(() => {
  process.exitCode = 1;
});
