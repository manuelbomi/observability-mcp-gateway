import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ObservabilityStore } from "../data/store.js";
import { registerTools } from "./tools/index.js";
import { registerServiceHealthResource } from "./resources/serviceHealthResource.js";

export const SERVER_NAME = "observability-mcp-gateway";
export const SERVER_VERSION = "0.1.0";

/** Builds a fresh McpServer bound to the given data store. */
export function createMcpServer(store: ObservabilityStore): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {}, resources: {} } },
  );

  registerTools(server, store);
  registerServiceHealthResource(server, store);

  return server;
}
