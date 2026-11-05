import {
  auditLogPageSchema,
  auditSummarySchema,
  chainVerificationSchema,
  type AuditLogPage,
  type AuditSummary,
  type ChainVerification,
  type ProtocolDirection,
} from '@spark-outpost/contracts';
import { request } from '../api/client.ts';

export interface LogFilters {
  direction: ProtocolDirection | null;
  method: string | null;
  q: string;
  subagent?: string | null;
}

export const LOG_PAGE_SIZE = 100;

export const auditKeys = {
  all: ['audit'] as const,
  summary: (conversationId: string) => ['audit', conversationId, 'summary'] as const,
  verify: (runId: string) => ['audit', 'verify', runId] as const,
  log: (runId: string, filters: LogFilters) => ['audit', 'log', runId, filters] as const,
};

function logQuery(after: number, filters: LogFilters): string {
  const params = new URLSearchParams({ after: String(after), limit: String(LOG_PAGE_SIZE) });
  if (filters.direction) params.set('direction', filters.direction);
  if (filters.method) params.set('method', filters.method);
  const q = filters.q.trim();
  if (q) params.set('q', q);
  if (filters.subagent) params.set('subagent', filters.subagent);
  return params.toString();
}

export const auditApi = {
  summary: (conversationId: string): Promise<AuditSummary> =>
    request(auditSummarySchema, `/conversations/${conversationId}/audit/summary`),
  verify: (runId: string): Promise<ChainVerification> =>
    request(chainVerificationSchema, `/runs/${runId}/audit/verify`),
  log: (runId: string, after: number, filters: LogFilters): Promise<AuditLogPage> =>
    request(auditLogPageSchema, `/runs/${runId}/audit/log?${logQuery(after, filters)}`),
  exportUrl: (conversationId: string, format: 'jsonl' | 'csv') =>
    `/api/conversations/${conversationId}/audit/export.${format}`,
};
