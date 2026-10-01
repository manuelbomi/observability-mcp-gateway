import { ObservabilityStore } from "../data/store.js";
import { createHttpApp } from "./httpServer.js";
import { loadAuthConfigFromEnv } from "./auth.js";

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "127.0.0.1";

function main(): void {
  const auth = loadAuthConfigFromEnv();
  const store = new ObservabilityStore();
  const app = createHttpApp({ store, auth, host: HOST });

  app.listen(PORT, HOST, () => {
    console.log(`observability-mcp-gateway listening on http://${HOST}:${PORT}${"/mcp"}`);
    console.log(`health check: http://${HOST}:${PORT}/healthz`);
    console.log("auth: bearer token required (MCP_GATEWAY_TOKEN)");
  });

  const shutdown = (): void => {
    console.log("shutting down...");
    store.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
