/**
 * Runnable demo client for the gateway.
 *
 * Connects over StreamableHTTP (the client-side half of the same transport
 * the server speaks), lists what the server exposes, then calls every tool
 * once with representative arguments and reads the live resource. This is
 * what you'd point at the real deployed gateway; a unit test exercises the
 * same transport against an ephemeral in-process server (see
 * tests/integration.test.ts).
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SERVICE_HEALTH_RESOURCE_URI } from "../server/resources/serviceHealthResource.js";

const SERVER_URL = process.env.MCP_GATEWAY_URL ?? "http://127.0.0.1:8787/mcp";
const TOKEN = process.env.MCP_GATEWAY_TOKEN;

function section(title: string): void {
  console.log(`\n=== ${title} ===`);
}

async function main(): Promise<void> {
  if (!TOKEN) {
    throw new Error("Set MCP_GATEWAY_TOKEN to the same token the server was started with.");
  }

  const transport = new StreamableHTTPClientTransport(new URL(SERVER_URL), {
    requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
  });
  const client = new Client({ name: "observability-mcp-gateway-demo-client", version: "0.1.0" });

  console.log(`connecting to ${SERVER_URL} ...`);
  await client.connect(transport);
  console.log("connected.");

  section("tools/list");
  const { tools } = await client.listTools();
  for (const tool of tools) {
    console.log(`- ${tool.name}: ${tool.description}`);
  }

  section("search_logs: errors mentioning 'timed out' on payments-gateway");
  await callAndPrint(client, "search_logs", {
    service: "payments-gateway",
    severity: "error",
    text: "timed out",
    limit: 5,
  });

  section("get_service_health: payments-gateway");
  await callAndPrint(client, "get_service_health", { service: "payments-gateway" });

  section("list_active_alerts (all services)");
  await callAndPrint(client, "list_active_alerts", {});

  section("get_latency_percentiles: checkout-api over the last 60 minutes");
  await callAndPrint(client, "get_latency_percentiles", { service: "checkout-api", windowMinutes: 60 });

  section("query_recent_errors: notifications-worker");
  await callAndPrint(client, "query_recent_errors", { service: "notifications-worker", limit: 5 });

  section(`resources/read: ${SERVICE_HEALTH_RESOURCE_URI}`);
  const resource = await client.readResource({ uri: SERVICE_HEALTH_RESOURCE_URI });
  for (const content of resource.contents) {
    if ("text" in content) {
      console.log(content.text);
    }
  }

  await client.close();
  console.log("\ndone.");
}

async function callAndPrint(client: Client, name: string, args: Record<string, unknown>): Promise<void> {
  const result = await client.callTool({ name, arguments: args });
  if (result.structuredContent) {
    console.log(JSON.stringify(result.structuredContent, null, 2));
    return;
  }
  for (const item of result.content as { type: string; text?: string }[]) {
    if (item.type === "text" && item.text) {
      console.log(item.text);
    }
  }
}

main().catch((error: unknown) => {
  console.error("client failed:", error);
  process.exitCode = 1;
});
