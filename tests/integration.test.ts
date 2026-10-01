/**
 * End-to-end test: starts the real HTTP app (ObservabilityStore +
 * createHttpApp) on an ephemeral port, then drives it with the actual
 * MCP client/transport from the SDK - the same code path the demo client
 * in src/client/index.ts uses against a real deployment.
 */
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ObservabilityStore } from "../src/data/store.js";
import { createHttpApp } from "../src/server/httpServer.js";
import { SERVICE_HEALTH_RESOURCE_URI } from "../src/server/resources/serviceHealthResource.js";

const TOKEN = "test-token";
let server: Server;
let baseUrl: string;
let store: ObservabilityStore;

beforeAll(async () => {
  store = new ObservabilityStore();
  const app = createHttpApp({ store, auth: { token: TOKEN } });
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("expected server to bind to a TCP port");
  }
  baseUrl = `http://127.0.0.1:${address.port}/mcp`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  store.close();
});

async function connectClient(): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(baseUrl), {
    requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
  });
  const client = new Client({ name: "integration-test-client", version: "0.0.0" });
  await client.connect(transport);
  return client;
}

describe("observability-mcp-gateway over streamable http", () => {
  it("rejects requests without a bearer token at the http layer", async () => {
    const res = await fetch(baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(401);
  });

  it("lists all five registered tools", async () => {
    const client = await connectClient();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      ["get_latency_percentiles", "get_service_health", "list_active_alerts", "query_recent_errors", "search_logs"].sort(),
    );
    await client.close();
  });

  it("calls search_logs and gets back matching structured content", async () => {
    const client = await connectClient();
    const result = await client.callTool({
      name: "search_logs",
      arguments: { service: "payments-gateway", severity: "error", limit: 3 },
    });
    const structured = result.structuredContent as { logs: { service: string; severity: string }[]; matchCount: number };
    expect(structured.logs.length).toBeGreaterThan(0);
    expect(structured.logs.length).toBeLessThanOrEqual(3);
    for (const log of structured.logs) {
      expect(log.service).toBe("payments-gateway");
      expect(log.severity).toBe("error");
    }
    await client.close();
  });

  it("calls get_service_health and gets a well-formed snapshot", async () => {
    const client = await connectClient();
    const result = await client.callTool({ name: "get_service_health", arguments: { service: "auth-service" } });
    const structured = result.structuredContent as { service: string; status: string };
    expect(structured.service).toBe("auth-service");
    expect(["healthy", "degraded", "down"]).toContain(structured.status);
    await client.close();
  });

  it("calls list_active_alerts and only gets firing alerts", async () => {
    const client = await connectClient();
    const result = await client.callTool({ name: "list_active_alerts", arguments: {} });
    const structured = result.structuredContent as { alerts: { status: string }[] };
    expect(structured.alerts.length).toBeGreaterThan(0);
    expect(structured.alerts.every((a) => a.status === "firing")).toBe(true);
    await client.close();
  });

  it("calls get_latency_percentiles and gets ordered percentiles", async () => {
    const client = await connectClient();
    const result = await client.callTool({
      name: "get_latency_percentiles",
      arguments: { service: "checkout-api", windowMinutes: 60 },
    });
    const structured = result.structuredContent as { p50: number; p95: number; p99: number };
    expect(structured.p50).toBeLessThanOrEqual(structured.p95);
    expect(structured.p95).toBeLessThanOrEqual(structured.p99);
    await client.close();
  });

  it("calls query_recent_errors and only gets error-severity logs", async () => {
    const client = await connectClient();
    const result = await client.callTool({ name: "query_recent_errors", arguments: { limit: 5 } });
    const structured = result.structuredContent as { errors: { severity: string }[] };
    expect(structured.errors.every((e) => e.severity === "error")).toBe(true);
    await client.close();
  });

  it("flags an invalid tool argument as an MCP tool error", async () => {
    const client = await connectClient();
    const result = await client.callTool({
      name: "get_service_health",
      arguments: { service: "not-a-real-service" },
    });
    expect(result.isError).toBe(true);
    await client.close();
  });

  it("reads the live service-health resource", async () => {
    const client = await connectClient();
    const result = await client.readResource({ uri: SERVICE_HEALTH_RESOURCE_URI });
    expect(result.contents).toHaveLength(1);
    const [content] = result.contents;
    expect(content?.mimeType).toBe("application/json");
    if (!content || !("text" in content)) {
      throw new Error("expected a text resource content block");
    }
    const parsed = JSON.parse(content.text) as { services: { service: string }[] };
    expect(parsed.services).toHaveLength(5);
    await client.close();
  });
});
