import { z } from 'zod';
import type { ArtifactShareDays, ArtifactShareTheme } from '@spark-outpost/contracts';

export const SHARE_TIMEOUT_MS = 20_000;

export interface ShareService {
  origin: string;
  fetch: typeof fetch;
  timeoutMs: number;
}

interface ShareUpload {
  id: string;
  deleteToken: string;
  title: string;
  html: string;
  expiresInDays: ArtifactShareDays;
  passcode: string | null;
  theme: ArtifactShareTheme | null;
}

export class ShareServiceError extends Error {}

export class ShareUnansweredError extends ShareServiceError {}

const createdSchema = z.object({
  id: z.string(),
  url: z.string(),
  expiresAt: z.iso.datetime({ offset: true }),
});

const FAILURES: Record<number, string> = {
  400: "The share service didn't accept this page.",
  413: 'This page is too large for the share service.',
  429: 'The share service is busy. Try again in a few minutes.',
};

export function sharePageUrl(service: ShareService, id: string): string {
  return `${service.origin}/a/${id}`;
}

async function call(service: ShareService, path: string, init: RequestInit): Promise<Response> {
  try {
    return await service.fetch(`${service.origin}${path}`, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(service.timeoutMs),
    });
  } catch {
    throw new ShareUnansweredError("Spark couldn't reach the share service. Try again later.");
  }
}

export async function uploadShare(service: ShareService, upload: ShareUpload): Promise<Date> {
  const response = await call(service, '/v1/shares', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: upload.id,
      deleteToken: upload.deleteToken,
      title: upload.title,
      html: upload.html,
      expiresInDays: upload.expiresInDays,
      ...(upload.passcode ? { passcode: upload.passcode } : {}),
      ...(upload.theme ? { theme: upload.theme } : {}),
    }),
  });
  if (response.status !== 201) {
    await response.body?.cancel().catch(() => undefined);
    throw new ShareServiceError(
      FAILURES[response.status] ??
        `The share service answered ${response.status}. Try again later.`,
    );
  }
  const parsed = createdSchema.safeParse(await response.json().catch(() => null));
  if (
    !parsed.success ||
    parsed.data.id !== upload.id ||
    parsed.data.url !== sharePageUrl(service, upload.id)
  ) {
    throw new ShareServiceError('The share service sent an answer Spark could not use.');
  }
  return new Date(parsed.data.expiresAt);
}

export async function removeShare(
  service: ShareService,
  id: string,
  deleteToken: string,
): Promise<204 | 404> {
  const response = await call(service, `/v1/shares/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${deleteToken}` },
  });
  await response.body?.cancel().catch(() => undefined);
  if (response.status !== 204 && response.status !== 404) {
    throw new ShareServiceError(
      `The share service answered ${response.status}. The link is still open; try again.`,
    );
  }
  return response.status === 204 ? 204 : 404;
}
