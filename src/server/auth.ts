/**
 * Bearer-token gate for the remote MCP endpoint.
 *
 * This is intentionally the simplest thing that demonstrates the point: a
 * remote HTTP MCP server is just an HTTP server, so it needs the same access
 * control any other API would. A stdio MCP server gets this "for free"
 * because the client spawns it as a local child process; a remote one does
 * not, and shipping it without auth means anyone who can reach the port can
 * read your observability data (or worse, call tools that mutate state).
 *
 * For a real deployment, swap this out for OAuth 2.1 with the SDK's
 * `ProxyOAuthServerProvider` / `mcpAuthRouter` (the spec requires MCP
 * servers to act as an OAuth resource server as of the 2025-03-26 auth
 * spec), backed by your IdP of choice. The shape of the swap:
 *   1. Replace this middleware with `requireBearerAuth` from
 *      `@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js`,
 *      configured with a real `OAuthTokenVerifier`.
 *   2. Mount `mcpAuthRouter` to serve `/.well-known/oauth-protected-resource`
 *      and the authorization/token endpoints (or proxy to your IdP).
 *   3. Validate scopes per tool (e.g. `observability:read`) instead of the
 *      current all-or-nothing token.
 * Static tokens are fine for a side project; they are not fine for anything
 * with real users.
 */
import { timingSafeEqual as nodeTimingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

const AUTH_HEADER = "authorization";
const BEARER_PREFIX = "Bearer ";

export interface AuthConfig {
  token: string;
}

export function loadAuthConfigFromEnv(): AuthConfig {
  const token = process.env.MCP_GATEWAY_TOKEN;
  if (!token) {
    throw new Error(
      "MCP_GATEWAY_TOKEN is not set. Refusing to start without an access token configured " +
        "(see .env.example / README for how to set one).",
    );
  }
  return { token };
}

export function bearerAuth(config: AuthConfig) {
  return function bearerAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
    const header = req.header(AUTH_HEADER);
    if (!header || !header.startsWith(BEARER_PREFIX)) {
      res.status(401).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Missing or malformed Authorization header. Expected 'Bearer <token>'." },
        id: null,
      });
      return;
    }

    const presented = header.slice(BEARER_PREFIX.length).trim();
    if (!timingSafeEqual(presented, config.token)) {
      res.status(403).json({
        jsonrpc: "2.0",
        error: { code: -32002, message: "Invalid bearer token." },
        id: null,
      });
      return;
    }

    next();
  };
}

/** Avoids leaking token length/content via timing differences on string compare. */
function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = Buffer.from(a);
  const bBytes = Buffer.from(b);
  if (aBytes.length !== bBytes.length) {
    // Still run a constant-time comparison (against a same-length buffer)
    // so the failure path takes comparable time regardless of which
    // branch we hit, then report false regardless of its result.
    nodeTimingSafeEqual(aBytes, Buffer.alloc(aBytes.length));
    return false;
  }
  return nodeTimingSafeEqual(aBytes, bBytes);
}
