import { redactText } from '../../audit/redact.ts';
import type { RunCommand } from '../../setup/command.ts';
import { GitHubApiError, type GitHubRequest, type GitHubResponse } from './connection.ts';

const REQUEST_TIMEOUT_MS = 20_000;
const GH_TIMEOUT_MS = 30_000;
const USER_AGENT = 'Spark-Outpost';

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function tokenRequest(
  apiBase: string,
  token: string,
  fetchImpl: typeof fetch,
): GitHubRequest {
  return async (method, path, body) => {
    let response: Response;
    try {
      response = await fetchImpl(`${apiBase}${path}`, {
        method,
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${token}`,
          'x-github-api-version': '2022-11-28',
          'user-agent': USER_AGENT,
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new GitHubApiError(0, "Couldn't reach GitHub. Check your connection, then try again.");
    }
    const data = parseJson(await response.text());
    return {
      status: response.status,
      data,
      header: (name) => response.headers.get(name),
    };
  };
}

function fieldArgs(body: Record<string, string | boolean> | undefined): string[] {
  if (!body) return [];
  return Object.entries(body).flatMap(([key, value]) =>
    typeof value === 'string' ? ['-f', `${key}=${value}`] : ['-F', `${key}=${String(value)}`],
  );
}

const HTTP_STATUS = /\(HTTP (\d{3})\)/;

function ghDetail(stderr: string): string {
  const line = redactText(stderr).trim().split('\n').at(-1)?.slice(0, 200);
  return line ? ` (${line})` : '';
}

export function ghCliRequest(ghPath: string, host: string, run: RunCommand): GitHubRequest {
  return async (method, path, body): Promise<GitHubResponse> => {
    const result = await run(
      ghPath,
      ['api', '--hostname', host, '-X', method, path.replace(/^\//, ''), ...fieldArgs(body)],
      GH_TIMEOUT_MS,
    );
    const data = parseJson(result.stdout);
    if (result.code === 0) return { status: 200, data, header: () => null };
    const status = Number(HTTP_STATUS.exec(result.stderr)?.[1] ?? 0);
    if (!status) {
      throw new GitHubApiError(
        0,
        result.timedOut
          ? 'The gh CLI took too long to answer.'
          : `The gh CLI could not reach GitHub${ghDetail(result.stderr)}. Run \`gh auth status\` in a terminal to check your login.`,
      );
    }
    return { status, data, header: () => null };
  };
}
