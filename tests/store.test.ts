import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { ObservabilityStore, percentile } from "../src/data/store.js";

describe("percentile()", () => {
  it("returns 0 for an empty array", () => {
    expect(percentile([], 95)).toBe(0);
  });

  it("picks the exact value for a single-element array regardless of p", () => {
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 99)).toBe(42);
  });

  it("uses nearest-rank so p99 of 100 sorted samples is the max", () => {
    const samples = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
    expect(percentile(samples, 99)).toBe(99);
    expect(percentile(samples, 100)).toBe(100);
    expect(percentile(samples, 50)).toBe(50);
  });
});

describe("ObservabilityStore", () => {
  let store: ObservabilityStore;

  beforeEach(() => {
    // Fixed seed (the store's default) so assertions about specific
    // services being degraded/healthy are deterministic across runs.
    store = new ObservabilityStore();
  });

  afterEach(() => {
    store.close();
  });

  it("searchLogs filters by service", () => {
    const logs = store.searchLogs({ service: "auth-service", limit: 500 });
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.every((l) => l.service === "auth-service")).toBe(true);
  });

  it("searchLogs filters by severity", () => {
    const logs = store.searchLogs({ severity: "error", limit: 500 });
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.every((l) => l.severity === "error")).toBe(true);
  });

  it("searchLogs filters by case-insensitive text match", () => {
    const logs = store.searchLogs({ text: "circuit breaker", limit: 500 });
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.every((l) => l.message.toLowerCase().includes("circuit breaker"))).toBe(true);
  });

  it("searchLogs clamps limit to the 1..500 range", () => {
    expect(store.searchLogs({ limit: 0 }).length).toBeLessThanOrEqual(1);
    expect(store.searchLogs({ limit: 10_000 }).length).toBeLessThanOrEqual(500);
  });

  it("queryRecentErrors only returns error-severity logs", () => {
    const errors = store.queryRecentErrors(undefined, 50);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.every((l) => l.severity === "error")).toBe(true);
  });

  it("listActiveAlerts only returns firing alerts", () => {
    const active = store.listActiveAlerts();
    expect(active.length).toBeGreaterThan(0);
    expect(active.every((a) => a.status === "firing")).toBe(true);
  });

  it("listAlertsForService includes resolved alerts for that service", () => {
    const alerts = store.listAlertsForService("notifications-worker");
    expect(alerts.some((a) => a.status === "resolved")).toBe(true);
  });

  it("getLatencyPercentiles returns p50 <= p95 <= p99", () => {
    const result = store.getLatencyPercentiles("checkout-api", 120);
    expect(result.sampleCount).toBeGreaterThan(0);
    expect(result.p50).toBeLessThanOrEqual(result.p95);
    expect(result.p95).toBeLessThanOrEqual(result.p99);
  });

  it("getServiceHealth marks the known mid-incident service as down", () => {
    // payments-gateway is seeded with an ongoing critical alert + elevated
    // error rate (see src/data/generator.ts INCIDENT_WINDOWS).
    const health = store.getServiceHealth("payments-gateway");
    expect(health.status).toBe("down");
    expect(health.activeAlertCount).toBeGreaterThanOrEqual(1);
  });

  it("getServiceHealth marks a quiet service as healthy", () => {
    const health = store.getServiceHealth("auth-service");
    expect(health.status).toBe("healthy");
    expect(health.activeAlertCount).toBe(0);
  });

  it("getAllServiceHealth returns one entry per known service", () => {
    const all = store.getAllServiceHealth();
    expect(all).toHaveLength(5);
  });
});
