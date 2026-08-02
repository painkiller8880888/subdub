import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";

export type AppOptions = {
  staticRoot?: string;
};

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get("/api/health", async () => ({ status: "ok" }));

  if (options.staticRoot !== undefined) {
    app.register(fastifyStatic, {
      root: options.staticRoot,
      prefix: "/"
    });

    app.setNotFoundHandler((request, reply) => {
      if (request.method === "GET" && !request.url.startsWith("/api/")) {
        return reply.sendFile("index.html");
      }

      return reply.code(404).send({ error: "Not Found" });
    });
  }

  return app;
}
