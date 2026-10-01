/**
 * SQLite-backed store for the synthetic dataset.
 *
 * SQLite (via better-sqlite3, synchronous + in-memory) is overkill for a
 * toy dataset that would fit in a few arrays, but it buys us real
 * indexed WHERE/LIKE/ORDER BY queries so the MCP tools below read like the
 * queries you'd actually write against a logs/metrics table, not bespoke
 * array-filtering code.
 */
import Database from "better-sqlite3";
import { generateDataset } from "./generator.js";
import type {
  AlertRecord,
  AlertStatus,
  LogEntry,
  LogSeverity,
  MetricPoint,
  ServiceHealthSnapshot,
  ServiceName,
  ServiceStatus,
} from "./types.js";
import { SERVICE_NAMES } from "./types.js";

export interface SearchLogsParams {
  service?: ServiceName;
  severity?: LogSeverity;
  text?: string;
  sinceMinutesAgo?: number;
  limit?: number;
}

export interface LatencyPercentiles {
  service: ServiceName;
  windowMinutes: number;
  sampleCount: number;
  p50: number;
  p95: number;
  p99: number;
}

export class ObservabilityStore {
  private readonly db: Database.Database;

  constructor(seed = 42) {
    this.db = new Database(":memory:");
    this.db.pragma("journal_mode = WAL");
    this.initSchema();
    this.load(seed);
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE logs (
        id INTEGER PRIMARY KEY,
        timestamp TEXT NOT NULL,
        service TEXT NOT NULL,
        severity TEXT NOT NULL,
        message TEXT NOT NULL,
        traceId TEXT
      );
      CREATE INDEX idx_logs_service ON logs(service);
      CREATE INDEX idx_logs_timestamp ON logs(timestamp);
      CREATE INDEX idx_logs_severity ON logs(severity);

      CREATE TABLE metrics (
        id INTEGER PRIMARY KEY,
        timestamp TEXT NOT NULL,
        service TEXT NOT NULL,
        latencyMs REAL NOT NULL,
        errorRatePct REAL NOT NULL,
        requestCount INTEGER NOT NULL
      );
      CREATE INDEX idx_metrics_service_ts ON metrics(service, timestamp);

      CREATE TABLE alerts (
        id INTEGER PRIMARY KEY,
        service TEXT NOT NULL,
        severity TEXT NOT NULL,
        status TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        startedAt TEXT NOT NULL,
        resolvedAt TEXT
      );
      CREATE INDEX idx_alerts_status ON alerts(status);
    `);
  }

  private load(seed: number): void {
    const { logs, metrics, alerts } = generateDataset(seed);

    const insertLog = this.db.prepare(
      `INSERT INTO logs (id, timestamp, service, severity, message, traceId) VALUES (@id, @timestamp, @service, @severity, @message, @traceId)`,
    );
    const insertMetric = this.db.prepare(
      `INSERT INTO metrics (id, timestamp, service, latencyMs, errorRatePct, requestCount) VALUES (@id, @timestamp, @service, @latencyMs, @errorRatePct, @requestCount)`,
    );
    const insertAlert = this.db.prepare(
      `INSERT INTO alerts (id, service, severity, status, title, description, startedAt, resolvedAt) VALUES (@id, @service, @severity, @status, @title, @description, @startedAt, @resolvedAt)`,
    );

    const tx = this.db.transaction(() => {
      for (const log of logs) insertLog.run(log);
      for (const metric of metrics) insertMetric.run(metric);
      for (const alert of alerts) insertAlert.run(alert);
    });
    tx();
  }

  searchLogs(params: SearchLogsParams): LogEntry[] {
    const clauses: string[] = [];
    const args: Record<string, unknown> = {};

    if (params.service) {
      clauses.push("service = @service");
      args.service = params.service;
    }
    if (params.severity) {
      clauses.push("severity = @severity");
      args.severity = params.severity;
    }
    if (params.text) {
      clauses.push("message LIKE @text COLLATE NOCASE");
      args.text = `%${params.text}%`;
    }
    if (params.sinceMinutesAgo !== undefined) {
      const cutoff = new Date(Date.now() - params.sinceMinutesAgo * 60_000).toISOString();
      clauses.push("timestamp >= @cutoff");
      args.cutoff = cutoff;
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = Math.min(Math.max(params.limit ?? 50, 1), 500);
    const rows = this.db
      .prepare(`SELECT * FROM logs ${where} ORDER BY timestamp DESC LIMIT @limit`)
      .all({ ...args, limit }) as LogEntry[];
    return rows;
  }

  queryRecentErrors(service: ServiceName | undefined, limit = 20): LogEntry[] {
    return this.searchLogs({
      service,
      severity: "error",
      limit,
    });
  }

  listActiveAlerts(service?: ServiceName): AlertRecord[] {
    const status: AlertStatus = "firing";
    if (service) {
      return this.db
        .prepare(`SELECT * FROM alerts WHERE status = @status AND service = @service ORDER BY startedAt DESC`)
        .all({ status, service }) as AlertRecord[];
    }
    return this.db
      .prepare(`SELECT * FROM alerts WHERE status = @status ORDER BY startedAt DESC`)
      .all({ status }) as AlertRecord[];
  }

  listAlertsForService(service: ServiceName): AlertRecord[] {
    return this.db
      .prepare(`SELECT * FROM alerts WHERE service = @service ORDER BY startedAt DESC`)
      .all({ service }) as AlertRecord[];
  }

  getLatencyPercentiles(service: ServiceName, windowMinutes = 60): LatencyPercentiles {
    const cutoff = new Date(Date.now() - windowMinutes * 60_000).toISOString();
    const rows = this.db
      .prepare(
        `SELECT latencyMs FROM metrics WHERE service = @service AND timestamp >= @cutoff ORDER BY latencyMs ASC`,
      )
      .all({ service, cutoff }) as { latencyMs: number }[];

    const latencies = rows.map((r) => r.latencyMs);
    return {
      service,
      windowMinutes,
      sampleCount: latencies.length,
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      p99: percentile(latencies, 99),
    };
  }

  /** Latest metric point for a service, used by health + the resource. */
  getLatestMetric(service: ServiceName): MetricPoint | undefined {
    return this.db
      .prepare(`SELECT * FROM metrics WHERE service = @service ORDER BY timestamp DESC LIMIT 1`)
      .get({ service }) as MetricPoint | undefined;
  }

  getServiceHealth(service: ServiceName): ServiceHealthSnapshot {
    const latest = this.getLatestMetric(service);
    const p95 = this.getLatencyPercentiles(service, 15).p95;
    const activeAlerts = this.listActiveAlerts(service);

    const status = deriveStatus(latest?.errorRatePct ?? 0, activeAlerts.length);

    return {
      service,
      status,
      latencyP95Ms: p95,
      errorRatePct: latest?.errorRatePct ?? 0,
      activeAlertCount: activeAlerts.length,
      lastUpdated: latest?.timestamp ?? new Date().toISOString(),
    };
  }

  getAllServiceHealth(): ServiceHealthSnapshot[] {
    return SERVICE_NAMES.map((service) => this.getServiceHealth(service));
  }

  close(): void {
    this.db.close();
  }
}

function deriveStatus(errorRatePct: number, activeAlertCount: number): ServiceStatus {
  if (errorRatePct >= 5 || activeAlertCount >= 2) return "down";
  if (errorRatePct >= 1.5 || activeAlertCount >= 1) return "degraded";
  return "healthy";
}

/** Nearest-rank percentile over a pre-sorted ascending array. */
export function percentile(sortedAscending: number[], p: number): number {
  if (sortedAscending.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sortedAscending.length) - 1;
  const index = Math.min(Math.max(rank, 0), sortedAscending.length - 1);
  return Math.round(sortedAscending[index] ?? 0);
}
