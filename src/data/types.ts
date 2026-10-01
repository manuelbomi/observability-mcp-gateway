/** Shared domain types for the synthetic observability dataset. */

export const SERVICE_NAMES = [
  "checkout-api",
  "payments-gateway",
  "inventory-svc",
  "notifications-worker",
  "auth-service",
] as const;

export type ServiceName = (typeof SERVICE_NAMES)[number];

export const LOG_SEVERITIES = ["debug", "info", "warn", "error"] as const;
export type LogSeverity = (typeof LOG_SEVERITIES)[number];

export const ALERT_SEVERITIES = ["info", "warning", "critical"] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export const ALERT_STATUSES = ["firing", "resolved"] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

export const SERVICE_STATUSES = ["healthy", "degraded", "down"] as const;
export type ServiceStatus = (typeof SERVICE_STATUSES)[number];

export interface LogEntry {
  id: number;
  timestamp: string; // ISO-8601
  service: ServiceName;
  severity: LogSeverity;
  message: string;
  traceId: string | null;
}

export interface MetricPoint {
  id: number;
  timestamp: string; // ISO-8601, one point per minute per service
  service: ServiceName;
  latencyMs: number;
  errorRatePct: number;
  requestCount: number;
}

export interface AlertRecord {
  id: number;
  service: ServiceName;
  severity: AlertSeverity;
  status: AlertStatus;
  title: string;
  description: string;
  startedAt: string; // ISO-8601
  resolvedAt: string | null;
}

export interface ServiceHealthSnapshot {
  service: ServiceName;
  status: ServiceStatus;
  latencyP95Ms: number;
  errorRatePct: number;
  activeAlertCount: number;
  lastUpdated: string; // ISO-8601
}
