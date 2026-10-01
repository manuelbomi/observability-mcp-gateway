/** Shared Zod shapes for tool inputs/outputs. Kept separate from the
 * registration code so the schemas are easy to scan and reuse. */
import { z } from "zod";
import { ALERT_SEVERITIES, ALERT_STATUSES, LOG_SEVERITIES, SERVICE_NAMES, SERVICE_STATUSES } from "../../data/types.js";

export const serviceNameSchema = z.enum(SERVICE_NAMES);
export const logSeveritySchema = z.enum(LOG_SEVERITIES);
export const alertSeveritySchema = z.enum(ALERT_SEVERITIES);
export const alertStatusSchema = z.enum(ALERT_STATUSES);
export const serviceStatusSchema = z.enum(SERVICE_STATUSES);

export const logEntrySchema = z.object({
  id: z.number(),
  timestamp: z.string(),
  service: serviceNameSchema,
  severity: logSeveritySchema,
  message: z.string(),
  traceId: z.string().nullable(),
});

export const alertRecordSchema = z.object({
  id: z.number(),
  service: serviceNameSchema,
  severity: alertSeveritySchema,
  status: alertStatusSchema,
  title: z.string(),
  description: z.string(),
  startedAt: z.string(),
  resolvedAt: z.string().nullable(),
});

export const serviceHealthSnapshotSchema = z.object({
  service: serviceNameSchema,
  status: serviceStatusSchema,
  latencyP95Ms: z.number(),
  errorRatePct: z.number(),
  activeAlertCount: z.number(),
  lastUpdated: z.string(),
});

export const latencyPercentilesSchema = z.object({
  service: serviceNameSchema,
  windowMinutes: z.number(),
  sampleCount: z.number(),
  p50: z.number(),
  p95: z.number(),
  p99: z.number(),
});
