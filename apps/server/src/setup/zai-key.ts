import type { ProviderModel } from '@spark-outpost/contracts';
import { ZAI_MODELS } from '../agents/acp/zai.ts';

export const ZAI_CHECK_MODEL = 'glm-5.3-flash';

export const zaiModels = (): ProviderModel[] =>
  ZAI_MODELS.map((model) => ({ id: model.slot, label: model.label }));

const QUOTA_CODES = new Set(['1308', '1309', '1310', '1311', '1313', '1314', '1315']);

function errorCode(payload: unknown): string | null {
  const error =
    payload && typeof payload === 'object' && 'error' in payload
      ? (payload as { error?: { code?: unknown; message?: unknown } }).error
      : undefined;
  if (typeof error?.code === 'string' || typeof error?.code === 'number') return String(error.code);
  const message = typeof error?.message === 'string' ? error.message : '';
  return /\b(1\d{3})\b/.exec(message)?.[1] ?? null;
}

export function zaiFailureReason(status: number, payload: unknown): string | null {
  const code = errorCode(payload);
  if (code === '1113') {
    return 'Z.ai accepted the key, but the account has no balance or GLM Coding Plan for this endpoint (1113). Top up or check the plan, then try again.';
  }
  if (code === '1302' || code === '1305') {
    return `Z.ai is rate limiting or overloaded (${code}). Wait a minute, then try again.`;
  }
  if (code && (QUOTA_CODES.has(code) || (Number(code) >= 1316 && Number(code) <= 1321))) {
    return `Z.ai refused the request because of the key's plan or quota (${code}). Check your Z.ai plan and usage.`;
  }
  if (status === 401) {
    return "Z.ai rejected this key (401 Unauthorized). Check that it's active and copied in full.";
  }
  return null;
}
