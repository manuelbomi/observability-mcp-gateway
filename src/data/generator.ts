/**
 * Synthetic dataset generator.
 *
 * Produces a deterministic (seeded) but deliberately "slightly messy" world:
 * inconsistent log message formatting, an occasional missing traceId, a
 * couple of services mid-incident, one resolved incident in the recent past.
 * Real observability data is never perfectly tidy, and a dataset that is
 * too clean makes for a misleading demo of tools like search_logs.
 *
 * Run directly with `npm run seed` to print a summary of what gets built;
 * the MCP server imports `generateDataset()` and loads it into SQLite at
 * startup.
 */
import { Rng } from "./rng.js";
import {
  type AlertRecord,
  type AlertSeverity,
  type LogEntry,
  type LogSeverity,
  type MetricPoint,
  SERVICE_NAMES,
  type ServiceName,
} from "./types.js";

export interface ServiceProfile {
  service: ServiceName;
  baselineLatencyMs: number;
  latencyJitterMs: number;
  baselineErrorRatePct: number;
  baselineRequestsPerMinute: number;
}

export const SERVICE_PROFILES: ServiceProfile[] = [
  {
    service: "checkout-api",
    baselineLatencyMs: 120,
    latencyJitterMs: 18,
    baselineErrorRatePct: 0.5,
    baselineRequestsPerMinute: 420,
  },
  {
    service: "payments-gateway",
    baselineLatencyMs: 230,
    latencyJitterMs: 35,
    baselineErrorRatePct: 1.8,
    baselineRequestsPerMinute: 260,
  },
  {
    service: "inventory-svc",
    baselineLatencyMs: 75,
    latencyJitterMs: 12,
    baselineErrorRatePct: 0.3,
    baselineRequestsPerMinute: 510,
  },
  {
    service: "notifications-worker",
    baselineLatencyMs: 310,
    latencyJitterMs: 60,
    baselineErrorRatePct: 1.4,
    baselineRequestsPerMinute: 140,
  },
  {
    service: "auth-service",
    baselineLatencyMs: 55,
    latencyJitterMs: 9,
    baselineErrorRatePct: 0.2,
    baselineRequestsPerMinute: 640,
  },
];

/** A window of elevated latency/error rate used to simulate an incident. */
interface IncidentWindow {
  service: ServiceName;
  severity: AlertSeverity;
  title: string;
  description: string;
  startMinutesAgo: number;
  endMinutesAgo: number; // 0 means "still ongoing"
  latencyMultiplier: number;
  errorRateMultiplier: number;
}

// Fixed "now" offsets relative to generation time. payments-gateway is
// mid-incident (endMinutesAgo = 0, i.e. still firing); notifications-worker
// had a backlog blow up earlier that has since recovered.
const INCIDENT_WINDOWS: IncidentWindow[] = [
  {
    service: "payments-gateway",
    severity: "critical",
    title: "Elevated error rate on payments-gateway",
    description:
      "Error rate on payments-gateway has exceeded the 5% threshold for the last 15+ minutes, correlated with a spike in upstream processor timeouts.",
    startMinutesAgo: 42,
    endMinutesAgo: 0,
    latencyMultiplier: 2.6,
    errorRateMultiplier: 6.5,
  },
  {
    service: "notifications-worker",
    severity: "warning",
    title: "Queue backlog on notifications-worker",
    description:
      "notifications-worker fell behind its SQS backlog for ~20 minutes due to a downstream email provider rate limit; backlog has since drained.",
    startMinutesAgo: 185,
    endMinutesAgo: 165,
    latencyMultiplier: 3.1,
    errorRateMultiplier: 4,
  },
  {
    service: "checkout-api",
    severity: "info",
    title: "Brief latency blip on checkout-api",
    description:
      "A short-lived GC pause on checkout-api pushed p95 latency up for a couple of minutes. Self-resolved, kept for the record.",
    startMinutesAgo: 95,
    endMinutesAgo: 93,
    latencyMultiplier: 1.8,
    errorRateMultiplier: 1.3,
  },
];

const LOG_WINDOW_MINUTES = 360; // 6 hours of history

const INFO_MESSAGES = [
  "request completed",
  "handled request successfully",
  "cache hit for key",
  "cache miss, falling back to origin",
  "scheduled job finished",
  "connection pool stats: healthy",
  "retrying downstream call",
  "health check ok",
];

const WARN_MESSAGES = [
  "slow downstream response",
  "retry attempt 2 for downstream call",
  "connection pool nearing capacity",
  "deprecated field used in request payload",
  "rate limit approaching threshold",
  "clock skew detected between nodes",
];

const ERROR_MESSAGES = [
  "downstream request timed out",
  "unhandled exception while processing request",
  "failed to acquire database connection",
  "payment processor returned 502",
  "validation failed for inbound payload",
  "circuit breaker open for downstream dependency",
  "null reference while serializing response",
];

const DEBUG_MESSAGES = [
  "entering handler",
  "payload size bytes computed",
  "feature flag evaluated",
  "trace context propagated",
];

function messagesFor(severity: LogSeverity): string[] {
  switch (severity) {
    case "debug":
      return DEBUG_MESSAGES;
    case "info":
      return INFO_MESSAGES;
    case "warn":
      return WARN_MESSAGES;
    case "error":
      return ERROR_MESSAGES;
  }
}

function randomTraceId(rng: Rng): string {
  const hex = "0123456789abcdef";
  let out = "";
  for (let i = 0; i < 16; i += 1) {
    out += hex[rng.int(0, 15)];
  }
  return out;
}

/**
 * Real log pipelines are inconsistent about formatting. We intentionally
 * vary casing/punctuation/whitespace instead of emitting one clean template,
 * so search_logs has to deal with text that actually looks field-collected.
 */
function messify(rng: Rng, message: string): string {
  let out = message;
  if (rng.chance(0.08)) {
    out = out.toUpperCase();
  } else if (rng.chance(0.05)) {
    out = `${out[0]?.toUpperCase() ?? ""}${out.slice(1)}`;
  }
  if (rng.chance(0.1)) {
    out = `${out}  `; // stray trailing whitespace
  }
  if (rng.chance(0.06)) {
    out = out.replace(/ /g, "  "); // double-spaced, as if templated badly
  }
  if (rng.chance(0.04)) {
    out = `${out} (retry #${rng.int(1, 3)})`;
  }
  return out;
}

export interface GeneratedDataset {
  logs: LogEntry[];
  metrics: MetricPoint[];
  alerts: AlertRecord[];
  generatedAt: Date;
}

export function generateDataset(seed = 42): GeneratedDataset {
  const rng = new Rng(seed);
  const now = new Date();

  const metrics: MetricPoint[] = [];
  const logs: LogEntry[] = [];
  let metricId = 1;
  let logId = 1;

  const activeIncidentFor = (
    service: ServiceName,
    minutesAgo: number,
  ): IncidentWindow | undefined =>
    INCIDENT_WINDOWS.find(
      (w) =>
        w.service === service &&
        minutesAgo <= w.startMinutesAgo &&
        minutesAgo >= w.endMinutesAgo,
    );

  for (const profile of SERVICE_PROFILES) {
    for (let minutesAgo = LOG_WINDOW_MINUTES; minutesAgo >= 0; minutesAgo -= 1) {
      const timestamp = new Date(now.getTime() - minutesAgo * 60_000);
      const incident = activeIncidentFor(profile.service, minutesAgo);

      const latencyMultiplier = incident?.latencyMultiplier ?? 1;
      const errorMultiplier = incident?.errorRateMultiplier ?? 1;

      const latencyMs = Math.max(
        5,
        Math.round(
          rng.gaussian(
            profile.baselineLatencyMs * latencyMultiplier,
            profile.latencyJitterMs,
          ),
        ),
      );
      const errorRatePct = Math.min(
        100,
        Math.max(
          0,
          Number(
            rng
              .gaussian(
                profile.baselineErrorRatePct * errorMultiplier,
                profile.baselineErrorRatePct * 0.4 + 0.05,
              )
              .toFixed(2),
          ),
        ),
      );
      const requestCount = Math.max(
        0,
        Math.round(rng.gaussian(profile.baselineRequestsPerMinute, profile.baselineRequestsPerMinute * 0.15)),
      );

      metrics.push({
        id: metricId,
        timestamp: timestamp.toISOString(),
        service: profile.service,
        latencyMs,
        errorRatePct,
        requestCount,
      });
      metricId += 1;

      // Sample a handful of log lines for this minute, weighted toward
      // info/debug normally and shifted toward warn/error during incidents.
      const linesThisMinute = rng.int(2, 6);
      for (let i = 0; i < linesThisMinute; i += 1) {
        const roll = rng.float();
        let severity: LogSeverity;
        if (incident) {
          if (roll < 0.35) severity = "error";
          else if (roll < 0.65) severity = "warn";
          else if (roll < 0.9) severity = "info";
          else severity = "debug";
        } else {
          if (roll < 0.03) severity = "error";
          else if (roll < 0.12) severity = "warn";
          else if (roll < 0.75) severity = "info";
          else severity = "debug";
        }

        const template = rng.pick(messagesFor(severity));
        const message = messify(rng, template);
        // ~6% of log lines are missing a traceId, as happens with
        // fire-and-forget background work or malformed middleware.
        const traceId = rng.chance(0.06) ? null : randomTraceId(rng);

        logs.push({
          id: logId,
          timestamp: new Date(timestamp.getTime() + rng.int(0, 59_000)).toISOString(),
          service: profile.service,
          severity,
          message,
          traceId,
        });
        logId += 1;
      }
    }
  }

  logs.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  metrics.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const alerts: AlertRecord[] = INCIDENT_WINDOWS.map((window, index) => {
    const startedAt = new Date(now.getTime() - window.startMinutesAgo * 60_000);
    const resolvedAt =
      window.endMinutesAgo === 0
        ? null
        : new Date(now.getTime() - window.endMinutesAgo * 60_000);
    return {
      id: index + 1,
      service: window.service,
      severity: window.severity,
      status: resolvedAt ? "resolved" : "firing",
      title: window.title,
      description: window.description,
      startedAt: startedAt.toISOString(),
      resolvedAt: resolvedAt ? resolvedAt.toISOString() : null,
    } satisfies AlertRecord;
  });

  return { logs, metrics, alerts, generatedAt: now };
}

// Allow `npm run seed` (via tsx) to print a quick summary without starting
// the server.
const isMain = process.argv[1]?.endsWith("generator.ts") || process.argv[1]?.endsWith("generator.js");
if (isMain) {
  const dataset = generateDataset();
  console.log(`generated ${dataset.logs.length} log lines`);
  console.log(`generated ${dataset.metrics.length} metric points`);
  console.log(`generated ${dataset.alerts.length} alerts:`);
  for (const alert of dataset.alerts) {
    console.log(`  [${alert.status}] (${alert.severity}) ${alert.service}: ${alert.title}`);
  }
  const bySeverity = dataset.logs.reduce<Record<string, number>>((acc, log) => {
    acc[log.severity] = (acc[log.severity] ?? 0) + 1;
    return acc;
  }, {});
  console.log("log severity breakdown:", bySeverity);
  for (const service of SERVICE_NAMES) {
    const missingTrace = dataset.logs.filter((l) => l.service === service && l.traceId === null).length;
    console.log(`  ${service}: ${missingTrace} log lines missing traceId`);
  }
}
