import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { bearerAuth, loadAuthConfigFromEnv } from "../src/server/auth.js";

function mockRes() {
  const res: Partial<Response> & { statusCode?: number; body?: unknown } = {};
  res.status = vi.fn((code: number) => {
    res.statusCode = code;
    return res as Response;
  }) as unknown as Response["status"];
  res.json = vi.fn((body: unknown) => {
    res.body = body;
    return res as Response;
  }) as unknown as Response["json"];
  return res as Response & { statusCode?: number; body?: unknown };
}

function mockReq(headers: Record<string, string>): Request {
  return {
    header: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
}

describe("bearerAuth middleware", () => {
  const middleware = bearerAuth({ token: "correct-token" });

  it("calls next() when the bearer token matches", () => {
    const req = mockReq({ authorization: "Bearer correct-token" });
    const res = mockRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("rejects a missing Authorization header with 401", () => {
    const req = mockReq({});
    const res = mockRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it("rejects a malformed header (no Bearer prefix) with 401", () => {
    const req = mockReq({ authorization: "correct-token" });
    const res = mockRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it("rejects a wrong token with 403", () => {
    const req = mockReq({ authorization: "Bearer wrong-token" });
    const res = mockRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it("rejects a token of different length without throwing", () => {
    const req = mockReq({ authorization: "Bearer x" });
    const res = mockRes();
    const next = vi.fn();

    expect(() => middleware(req, res, next)).not.toThrow();
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });
});

describe("loadAuthConfigFromEnv", () => {
  it("throws when MCP_GATEWAY_TOKEN is not set", () => {
    const original = process.env.MCP_GATEWAY_TOKEN;
    delete process.env.MCP_GATEWAY_TOKEN;
    try {
      expect(() => loadAuthConfigFromEnv()).toThrow(/MCP_GATEWAY_TOKEN/);
    } finally {
      if (original !== undefined) process.env.MCP_GATEWAY_TOKEN = original;
    }
  });

  it("returns the token when set", () => {
    const original = process.env.MCP_GATEWAY_TOKEN;
    process.env.MCP_GATEWAY_TOKEN = "some-token";
    try {
      expect(loadAuthConfigFromEnv()).toEqual({ token: "some-token" });
    } finally {
      if (original !== undefined) process.env.MCP_GATEWAY_TOKEN = original;
      else delete process.env.MCP_GATEWAY_TOKEN;
    }
  });
});
