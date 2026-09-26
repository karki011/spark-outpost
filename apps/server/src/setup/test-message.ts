import os from 'node:os';
import type { ProviderConnection, ProviderId } from '@spark-outpost/contracts';
import { catalogEntry, type CatalogEntry } from '../providers/catalog.ts';
import type { RunCommand } from './command.ts';
import type { SecretStore } from './secrets.ts';
import { locateCli, type ApiEndpoints } from './verify.ts';

export interface TestMessageDeps {
  run: RunCommand;
  loginShell: string | null;
  endpoints: ApiEndpoints;
  secrets: SecretStore;
}

export interface TestOutcome {
  ok: boolean;
  message: string;
}

const PROMPT = 'Reply with the single word OK.';
const CLI_TIMEOUT_MS = 90_000;
const API_TIMEOUT_MS = 30_000;

export function canSendTestMessage(
  provider: ProviderId,
  method: ProviderConnection['method'],
): boolean {
  return method === 'api_key' || provider === 'claude';
}

function answered(startedAt: number, model: string | null): TestOutcome {
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  return {
    ok: true,
    message: `Test message answered in ${seconds} s${model ? ` by ${model}` : ''}`,
  };
}

function failedWith(reason: string): TestOutcome {
  return { ok: false, message: `The test message failed: ${reason}` };
}

function httpReason(entry: CatalogEntry, status: number): string {
  if (status === 401) return `${entry.maker} rejected the stored key (401). Verify the key again.`;
  if (status === 429)
    return `${entry.maker} is rate limiting this key (429). Wait a minute, then try again.`;
  return `${entry.maker} responded with ${status}.`;
}

interface ClaudeResult {
  is_error?: unknown;
  result?: unknown;
  modelUsage?: unknown;
}

function firstModel(modelUsage: unknown): string | null {
  if (!modelUsage || typeof modelUsage !== 'object') return null;
  return Object.keys(modelUsage)[0] ?? null;
}

function parseClaudeResult(stdout: string): ClaudeResult | null {
  try {
    return JSON.parse(stdout) as ClaudeResult;
  } catch {
    return null;
  }
}

async function testClaudeCli(entry: CatalogEntry, deps: TestMessageDeps): Promise<TestOutcome> {
  const path = await locateCli(entry.cli, deps.run, deps.loginShell);
  if (!path) return failedWith(`\`${entry.cli}\` is no longer on your PATH.`);
  const startedAt = Date.now();
  const result = await deps.run(path, ['-p', PROMPT, '--output-format', 'json'], CLI_TIMEOUT_MS);
  if (result.timedOut) {
    return failedWith(`\`${entry.cli}\` didn't answer within ${CLI_TIMEOUT_MS / 1000} seconds.`);
  }
  const parsed = parseClaudeResult(result.stdout);
  if (result.code !== 0 || !parsed || parsed.is_error) {
    const detail = typeof parsed?.result === 'string' ? parsed.result : result.stderr.trim();
    return failedWith(detail || `\`${entry.cli}\` exited with code ${result.code}.`);
  }
  return answered(startedAt, firstModel(parsed.modelUsage));
}

function jsonLines(stdout: string): unknown[] {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('{'))
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as unknown];
      } catch {
        return [];
      }
    });
}

function findString(value: unknown, key: string): string | null {
  if (!value || typeof value !== 'object') return null;
  for (const [name, inner] of Object.entries(value)) {
    if (name === key && typeof inner === 'string' && inner) return inner;
    const nested = findString(inner, key);
    if (nested) return nested;
  }
  return null;
}

function hasValue(value: unknown, key: string, expected: string): boolean {
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(
    ([name, inner]) => (name === key && inner === expected) || hasValue(inner, key, expected),
  );
}

function codexError(events: unknown[]): string | null {
  for (const event of events) {
    const type = findString(event, 'type') ?? '';
    if (/error|failed/i.test(type)) return findString(event, 'message') ?? type;
  }
  return null;
}

async function testCodexCli(entry: CatalogEntry, deps: TestMessageDeps): Promise<TestOutcome> {
  const path = await locateCli(entry.cli, deps.run, deps.loginShell);
  if (!path) return failedWith(`\`${entry.cli}\` is no longer on your PATH.`);
  const startedAt = Date.now();
  const result = await deps.run(
    path,
    [
      'exec',
      '--skip-git-repo-check',
      '--ephemeral',
      '-s',
      'read-only',
      '--json',
      '-C',
      os.tmpdir(),
      PROMPT,
    ],
    CLI_TIMEOUT_MS,
  );
  if (result.timedOut) {
    return failedWith(`\`${entry.cli}\` didn't answer within ${CLI_TIMEOUT_MS / 1000} seconds.`);
  }
  const events = jsonLines(result.stdout);
  const error = codexError(events);
  const replied = events.some((event) => hasValue(event, 'type', 'agent_message'));
  if (!replied && !error && result.code === 0) {
    return failedWith(`\`${entry.cli}\` finished without replying.`);
  }
  if (result.code !== 0 || error) {
    return failedWith(
      error ?? (result.stderr.trim() || `\`${entry.cli}\` exited with code ${result.code}.`),
    );
  }
  const model = events.map((event) => findString(event, 'model')).find(Boolean) ?? null;
  return answered(startedAt, model);
}

async function postJson(
  deps: TestMessageDeps,
  url: string,
  headers: Record<string, string>,
  body: unknown,
) {
  return deps.endpoints.fetch(
    new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
    { signal: AbortSignal.timeout(API_TIMEOUT_MS) },
  );
}

async function testApiKey(
  entry: CatalogEntry,
  connection: ProviderConnection,
  deps: TestMessageDeps,
): Promise<TestOutcome> {
  const key = await deps.secrets.get(entry.id);
  if (!key) return failedWith('the stored key is missing from the keychain. Verify the key again.');
  if (!connection.model) return failedWith('no default model is selected.');
  const startedAt = Date.now();
  let response: Response;
  try {
    response =
      entry.id === 'claude'
        ? await postJson(
            deps,
            `${deps.endpoints.anthropicBaseUrl}/v1/messages`,
            { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
            {
              model: connection.model,
              max_tokens: 16,
              messages: [{ role: 'user', content: PROMPT }],
            },
          )
        : await postJson(
            deps,
            `${deps.endpoints.openaiBaseUrl}/v1/chat/completions`,
            { authorization: `Bearer ${key}` },
            {
              model: connection.model,
              max_completion_tokens: 16,
              messages: [{ role: 'user', content: PROMPT }],
            },
          );
  } catch {
    return failedWith(`couldn't reach ${entry.maker}. Check your internet connection.`);
  }
  if (!response.ok) return failedWith(httpReason(entry, response.status));
  const payload = (await response.json().catch(() => null)) as { model?: unknown } | null;
  const model = typeof payload?.model === 'string' ? payload.model : connection.model;
  return answered(startedAt, model);
}

export async function sendTestMessage(
  provider: ProviderId,
  connection: ProviderConnection,
  deps: TestMessageDeps,
): Promise<TestOutcome> {
  const entry = catalogEntry(provider);
  if (connection.method === 'api_key') return testApiKey(entry, connection, deps);
  return provider === 'claude' ? testClaudeCli(entry, deps) : testCodexCli(entry, deps);
}
