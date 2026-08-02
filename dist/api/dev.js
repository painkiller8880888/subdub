import { startServer } from "./server.js";
startServer().catch((error) => {
    console.error("Fastifyの起動に失敗しました。", error);
    process.exitCode = 1;
});
//# sourceMappingURL=dev.js.map