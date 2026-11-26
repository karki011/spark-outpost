import { z } from 'zod';
import {
  ARTIFACT_SHARE_FINAL_HEADER,
  shareServiceOrigin,
  type ArtifactShareDays,
  type ArtifactShareTheme,
} from '@spark-outpost/contracts';

export const SHARE_TIMEOUT_MS = 20_000;

export interface ShareService {
  origin: string | null;
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

export function sharePageUrl(origin: string, id: string): string {
  return `${origin}/a/${id}`;
}

function storedOrigin(pageUrl: string): string {
  const origin = URL.canParse(pageUrl) ? shareServiceOrigin(new URL(pageUrl).origin) : null;
  if (!origin) {
    throw new ShareServiceError('Spark can’t tell which share service holds this page.');
  }
  return origin;
}

async function call(service: ShareService, url: string, init: RequestInit): Promise<Response> {
  try {
    return await service.fetch(url, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(service.timeoutMs),
    });
  } catch {
    throw new ShareUnansweredError("Spark couldn't reach the share service. Try again later.");
  }
}

export async function uploadShare(
  service: ShareService,
  origin: string,
  upload: ShareUpload,
  uploadKey: string | null = null,
): Promise<Date> {
  const response = await call(service, `${origin}/v1/shares`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(uploadKey ? { authorization: `Bearer ${uploadKey}` } : {}),
    },
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
    parsed.data.url !== sharePageUrl(origin, upload.id)
  ) {
    throw new ShareServiceError('The share service sent an answer Spark could not use.');
  }
  return new Date(parsed.data.expiresAt);
}

export interface SharedPage {
  shareId: string;
  url: string;
}

type Removal = 'removed' | 'none_can_arrive' | 'not_found';

export async function removeShare(
  service: ShareService,
  page: SharedPage,
  deleteToken: string,
): Promise<Removal> {
  const address = `${storedOrigin(page.url)}/v1/shares/${encodeURIComponent(page.shareId)}`;
  const response = await call(service, address, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${deleteToken}` },
  });
  await response.body?.cancel().catch(() => undefined);
  if (response.status !== 204 && response.status !== 404) {
    throw new ShareServiceError(
      `The share service answered ${response.status}. The link is still open; try again.`,
    );
  }
  if (response.status === 204) return 'removed';
  return response.headers.get(ARTIFACT_SHARE_FINAL_HEADER) === '1'
    ? 'none_can_arrive'
    : 'not_found';
}
