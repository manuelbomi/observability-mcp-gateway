/**
 * Registers all MCP tools on the given server instance.
 *
 * Each tool is a thin adapter: validate args (Zod, via inputSchema), call
 * the corresponding ObservabilityStore method (the actual "business
 * logic", unit-tested on its own in tests/store.test.ts), then shape the
 * result as both a structuredContent payload (per its outputSchema) and a
 * human-readable text block, since not every MCP client renders
 * structured content.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ObservabilityStore } from "../../data/store.js";
import { serviceNameSchema, logSeveritySchema, logEntrySchema, alertRecordSchema, serviceHealthSnapshotSchema, latencyPercentilesSchema } from "./schemas.js";

export function registerTools(server: McpServer, store: ObservabilityStore): void {
  server.registerTool(
    "search_logs",
    {
      title: "Search logs",
      description:
        "Search raw log lines by service, severity, free-text substring, and/or a recency window. Returns the most recent matches first.",
      inputSchema: {
        service: serviceNameSchema.optional().describe("Restrict to a single service"),
        severity: logSeveritySchema.optional().describe("Restrict to a single severity level"),
        text: z.string().optional().describe("Case-insensitive substring to search for in the log message"),
        sinceMinutesAgo: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Only include logs from the last N minutes"),
        limit: z.number().int().positive().max(500).optional().describe("Max rows to return (default 50, max 500)"),
      },
      outputSchema: {
        logs: z.array(logEntrySchema),
        matchCount: z.number(),
      },
    },
    async ({ service, severity, text, sinceMinutesAgo, limit }) => {
      const logs = store.searchLogs({ service, severity, text, sinceMinutesAgo, limit });
      const structuredContent = { logs, matchCount: logs.length };
      return {
        structuredContent,
        content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
      };
    },
  );

  server.registerTool(
    "get_service_health",
    {
      title: "Get service health",
      description:
        "Current health snapshot for one service: derived status (healthy/degraded/down), p95 latency over the last 15 minutes, current error rate, and active alert count.",
      inputSchema: {
        service: serviceNameSchema.describe("Service to check"),
      },
      outputSchema: serviceHealthSnapshotSchema.shape,
    },
    async ({ service }) => {
      const health = store.getServiceHealth(service);
      return {
        structuredContent: { ...health } as Record<string, unknown>,
        content: [{ type: "text", text: JSON.stringify(health, null, 2) }],
      };
    },
  );

  server.registerTool(
    "list_active_alerts",
    {
      title: "List active alerts",
      description: "List currently firing alerts, optionally scoped to a single service.",
      inputSchema: {
        service: serviceNameSchema.optional().describe("Restrict to a single service"),
      },
      outputSchema: {
        alerts: z.array(alertRecordSchema),
        count: z.number(),
      },
    },
    async ({ service }) => {
      const alerts = store.listActiveAlerts(service);
      const structuredContent = { alerts, count: alerts.length };
      return {
        structuredContent,
        content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
      };
    },
  );

  server.registerTool(
    "get_latency_percentiles",
    {
      title: "Get latency percentiles",
      description: "p50/p95/p99 request latency (ms) for a service over a trailing time window.",
      inputSchema: {
        service: serviceNameSchema.describe("Service to measure"),
        windowMinutes: z
          .number()
          .int()
          .positive()
          .max(360)
          .optional()
          .describe("Trailing window in minutes (default 60, max 360 - the full retained history)"),
      },
      outputSchema: latencyPercentilesSchema.shape,
    },
    async ({ service, windowMinutes }) => {
      const percentiles = store.getLatencyPercentiles(service, windowMinutes);
      return {
        structuredContent: { ...percentiles } as Record<string, unknown>,
        content: [{ type: "text", text: JSON.stringify(percentiles, null, 2) }],
      };
    },
  );

  server.registerTool(
    "query_recent_errors",
    {
      title: "Query recent errors",
      description: "Shorthand for search_logs filtered to severity=error, optionally scoped to a service.",
      inputSchema: {
        service: serviceNameSchema.optional().describe("Restrict to a single service"),
        limit: z.number().int().positive().max(200).optional().describe("Max rows to return (default 20, max 200)"),
      },
      outputSchema: {
        errors: z.array(logEntrySchema),
        count: z.number(),
      },
    },
    async ({ service, limit }) => {
      const errors = store.queryRecentErrors(service, limit);
      const structuredContent = { errors, count: errors.length };
      return {
        structuredContent,
        content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
      };
    },
  );
}
