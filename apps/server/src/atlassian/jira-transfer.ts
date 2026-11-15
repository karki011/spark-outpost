import { failure } from '../tickets/http.ts';
import { TicketApiError } from '../tickets/source.ts';
import { basicAuthorization, type AtlassianAccess } from './access.ts';

const TIMEOUT_MS = 60_000;

export interface Downloaded {
  data: Buffer;
  mimeType: string;
  truncated: boolean;
}

async function answered(response: Response, action: string): Promise<Response> {
  if (response.ok) return response;
  const text = await response.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  throw failure(
    'Jira',
    action,
    { status: response.status, data, retryAfter: response.headers.get('retry-after') },
    'ticket',
  );
}

async function reach(fetchImpl: typeof fetch, url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new TicketApiError(0, "Couldn't reach Jira. Check your connection, then try again.");
  }
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const MEDIA_HOSTS = /(^|\.)(atlassian\.net|atlassian\.com|atl-paas\.net)$/;

export function mediaTarget(location: string, siteUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(location, siteUrl);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  const sameSite = url.origin === new URL(siteUrl).origin;
  if (!sameSite && (url.protocol !== 'https:' || !MEDIA_HOSTS.test(url.hostname))) return null;
  return url.toString();
}

export function jiraTransfer(access: AtlassianAccess, fetchImpl: typeof fetch) {
  const authorization = basicAuthorization(access);
  return {
    async download(path: string, maxBytes: number, action: string): Promise<Downloaded> {
      const first = await reach(fetchImpl, `${access.siteUrl}${path}`, {
        headers: { authorization, accept: '*/*', 'user-agent': 'Spark-Outpost' },
        redirect: 'manual',
      });
      const location = REDIRECTS.has(first.status) ? first.headers.get('location') : null;
      const target = location ? mediaTarget(location, access.siteUrl) : null;
      if (REDIRECTS.has(first.status) && !target) {
        throw new TicketApiError(
          502,
          `Jira sent the file from an address Spark doesn't trust while ${action}.`,
        );
      }
      const response = await answered(
        target
          ? await reach(fetchImpl, target, {
              headers: { accept: '*/*', 'user-agent': 'Spark-Outpost' },
              redirect: 'follow',
            })
          : first,
        action,
      );
      const data = Buffer.from(await response.arrayBuffer());
      return {
        data: data.subarray(0, maxBytes),
        mimeType: (response.headers.get('content-type') ?? 'application/octet-stream').split(
          ';',
        )[0]!,
        truncated: data.length > maxBytes,
      };
    },
    async upload(
      path: string,
      file: { name: string; data: Buffer; mimeType: string },
      action: string,
    ) {
      const form = new FormData();
      form.append(
        'file',
        new Blob([new Uint8Array(file.data)], { type: file.mimeType }),
        file.name,
      );
      const response = await answered(
        await reach(fetchImpl, `${access.siteUrl}${path}`, {
          method: 'POST',
          headers: {
            authorization,
            accept: 'application/json',
            'user-agent': 'Spark-Outpost',
            'x-atlassian-token': 'no-check',
          },
          body: form,
        }),
        action,
      );
      return (await response.json().catch(() => null)) as unknown;
    },
  };
}
