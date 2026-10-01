/**
 * Wires the MCP server up to a real HTTP endpoint.
 *
 * This uses the SDK's *stateless* StreamableHTTP mode: a fresh McpServer +
 * transport pair is created per request, with `sessionIdGenerator:
 * undefined` so no session is tracked across calls. That trades away
 * resumable streams/notifications tied to a session for a much simpler
 * deployment story (no session affinity, no sticky load balancing, works
 * behind any plain reverse proxy). A stateful server - one long-lived
 * McpServer with a session id per client, supporting server-initiated
 * notifications over a persistent SSE stream - is the better choice when a
 * client needs long-running subscriptions; this gateway's tools are all
 * simple request/response reads, so stateless is the right trade-off here.
 */
import type { Express, Request, Response } from "express";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { ObservabilityStore } from "../data/store.js";
import { createMcpServer } from "./mcpServer.js";
import { bearerAuth, type AuthConfig } from "./auth.js";

const MCP_PATH = "/mcp";

export interface HttpAppOptions {
  store: ObservabilityStore;
  auth: AuthConfig;
  /** 127.0.0.1 enables the SDK's DNS-rebinding protection; use 0.0.0.0 to accept non-local traffic. */
  host?: string;
}

export function createHttpApp({ store, auth, host = "127.0.0.1" }: HttpAppOptions): Express {
  const app = createMcpExpressApp({ host });

  app.get("/healthz", (_req: Request, res: Response) => {
    res.status(200).json({ status: "ok", service: "observability-mcp-gateway" });
  });

  app.use(MCP_PATH, bearerAuth(auth));

  app.post(MCP_PATH, async (req: Request, res: Response) => {
    const server = createMcpServer(store);
    try {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
    } catch (error) {
      console.error("error handling MCP request:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "internal server error" },
          id: null,
        });
      }
    }
  });

  // Stateless mode has no server-initiated stream or session to delete, so
  // GET (would open a notification stream) and DELETE (would end a session)
  // aren't supported. Respond per spec instead of 404ing silently.
  const methodNotAllowed = (_req: Request, res: Response): void => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "method not allowed in stateless mode" },
      id: null,
    });
  };
  app.get(MCP_PATH, methodNotAllowed);
  app.delete(MCP_PATH, methodNotAllowed);

  return app;
}
