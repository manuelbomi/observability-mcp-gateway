/**
 * A live resource (as opposed to a tool): clients that just want "what's
 * the current state of the world" can read this instead of calling
 * get_service_health five times. Recomputed on every read from the same
 * store queries the tools use, so it's never stale by more than the
 * latest ingested metric point.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ObservabilityStore } from "../../data/store.js";

export const SERVICE_HEALTH_RESOURCE_URI = "observability://service-health/snapshot";

export function registerServiceHealthResource(server: McpServer, store: ObservabilityStore): void {
  server.registerResource(
    "service-health-snapshot",
    SERVICE_HEALTH_RESOURCE_URI,
    {
      title: "Service health snapshot",
      description: "Live health status, p95 latency, error rate, and active alert count for every known service.",
      mimeType: "application/json",
    },
    async () => {
      const snapshot = store.getAllServiceHealth();
      return {
        contents: [
          {
            uri: SERVICE_HEALTH_RESOURCE_URI,
            mimeType: "application/json",
            text: JSON.stringify({ generatedAt: new Date().toISOString(), services: snapshot }, null, 2),
          },
        ],
      };
    },
  );
}
