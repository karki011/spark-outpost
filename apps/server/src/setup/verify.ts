import {
  apiKeyHint,
  maskApiKey,
  type ConnectableId,
  type ProviderModel,
  type VerifyFailureCode,
} from '@spark-outpost/contracts';
import type { CatalogEntry } from '../providers/catalog.ts';
import type { RunCommand } from './command.ts';
import { modelSummary, parseModels } from './model-list.ts';
import { ZAI_CHECK_MODEL, zaiFailureReason, zaiModels } from './zai-key.ts';
import { bearerMessageRequest } from './messages-request.ts';

export type VerifyStep =
  | { type: 'step_started'; label: string }
  | { type: 'step_succeeded'; label: string }
  | { type: 'step_failed'; label: string; code?: VerifyFailureCode };

export interface VerifiedConnection {
  method: 'cli' | 'api_key';
  detail: string;
  summary: string;
  models: ProviderModel[];
  secret?: string;
}

export type Verification = AsyncGenerator<VerifyStep, VerifiedConnection | null>;

export interface ApiEndpoints {
  anthropicBaseUrl: string;
  openaiBaseUrl: string;
  typesafeBaseUrl: string;
  zaiBaseUrl: string;
  fetch: typeof fetch;
}

export interface KeyedService {
  id: ConnectableId;
  name: string;
  maker: string;
  keyPrefix: string;
  keyHint: string;
}

const started = (label: string): VerifyStep => ({ type: 'step_started', label });
const succeeded = (label: string): VerifyStep => ({ type: 'step_succeeded', label });
const failed = (label: string, code?: VerifyFailureCode): VerifyStep =>
  code ? { type: 'step_failed', label, code } : { type: 'step_failed', label };

const REQUEST_TIMEOUT_MS = 15_000;

type ModelListResult = { ok: true; models: ProviderModel[] } | { ok: false; message: string };

function modelsRequest(entry: KeyedService, key: string, endpoints: ApiEndpoints) {
  if (entry.id === 'claude') {
    return new Request(`${endpoints.anthropicBaseUrl}/v1/models?limit=100`, {
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    });
  }
  const baseUrl = entry.id === 'jev' ? endpoints.typesafeBaseUrl : endpoints.openaiBaseUrl;
  return new Request(`${baseUrl}/v1/models`, {
    headers: { authorization: `Bearer ${key}` },
  });
}

function failureMessage(entry: KeyedService, status: number): string {
  if (status === 401) {
    return `${entry.maker} rejected this key (401 Unauthorized). Check that it's active and copied in full.`;
  }
  if (status === 403) {
    return `${entry.maker} accepted the key but denied access (403 Forbidden). Check the key's permissions.`;
  }
  if (status === 429) {
    return `${entry.maker} is rate limiting this key (429 Too Many Requests). Wait a minute, then try again.`;
  }
  return `${entry.maker} responded with ${status}. Try again in a minute.`;
}

function checkRequest(entry: KeyedService, key: string, endpoints: ApiEndpoints): Request {
  if (entry.id === 'zai') {
    return bearerMessageRequest(endpoints.zaiBaseUrl, key, ZAI_CHECK_MODEL, 'Reply with OK.');
  }
  return modelsRequest(entry, key, endpoints);
}

async function listModels(
  entry: KeyedService,
  key: string,
  endpoints: ApiEndpoints,
): Promise<ModelListResult> {
  let response: Response;
  try {
    response = await endpoints.fetch(checkRequest(entry, key, endpoints), {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return {
      ok: false,
      message: `Couldn't reach ${entry.maker}. Check your internet connection, then try again.`,
    };
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const zai = entry.id === 'zai' ? zaiFailureReason(response.status, payload) : null;
    return { ok: false, message: zai ?? failureMessage(entry, response.status) };
  }
  return { ok: true, models: entry.id === 'zai' ? zaiModels() : parseModels(entry.id, payload) };
}

export async function* verifyApiKey(
  entry: KeyedService,
  rawKey: string,
  endpoints: ApiEndpoints,
): Verification {
  const key = rawKey.trim();
  yield started('Checking key format');
  const hint = apiKeyHint(entry, key);
  if (!hint.valid) {
    yield failed(hint.message);
    return null;
  }
  yield succeeded('Format looks right');

  yield started(`Verifying with ${entry.maker}`);
  const result = await listModels(entry, key, endpoints);
  if (!result.ok) {
    yield failed(result.message);
    return null;
  }
  yield succeeded('Key accepted');

  yield started('Checking model access');
  if (result.models.length === 0) {
    yield failed(
      `${entry.maker} accepted the key, but it can't use any models. Check the key's project.`,
    );
    return null;
  }
  yield succeeded(modelSummary(entry.id, result.models));
  return {
    method: 'api_key',
    detail: entry.keyPrefix ? maskApiKey(key) : maskApiKey(key, 0),
    summary: 'Key accepted',
    models: result.models,
    secret: key,
  };
}

const VERSION_TIMEOUT_MS = 10_000;
const TEST_REQUEST_TIMEOUT_MS = 90_000;

function parseVersion(output: string): string {
  return output.match(/\d+\.\d+\.\d+/)?.[0] ?? 'unknown version';
}

const authMethodLabels: Record<string, string> = {
  'claude.ai': 'Logged in with your Claude account',
  console: 'Logged in with your Anthropic Console account',
  apiKey: 'Logged in with an API key',
};

interface ClaudeAuthStatus {
  loggedIn?: unknown;
  authMethod?: unknown;
}

function parseAuthStatus(stdout: string): ClaudeAuthStatus | null {
  try {
    const parsed: unknown = JSON.parse(stdout);
    return parsed && typeof parsed === 'object' ? (parsed as ClaudeAuthStatus) : null;
  } catch {
    return null;
  }
}

async function* claudeTestRequest(
  entry: CatalogEntry,
  path: string,
  run: RunCommand,
): AsyncGenerator<VerifyStep, string | null> {
  yield started('Sending a test request');
  const startedAt = Date.now();
  const result = await run(
    path,
    ['-p', 'Reply with the single word OK.', '--output-format', 'json'],
    TEST_REQUEST_TIMEOUT_MS,
  );
  let isError = result.code !== 0;
  try {
    isError ||= Boolean((JSON.parse(result.stdout) as { is_error?: unknown }).is_error);
  } catch {
    isError = true;
  }
  if (isError) {
    yield failed(
      `The test request through \`${entry.cli}\` failed. ${entry.loginHint}`,
      'not_logged_in',
    );
    return null;
  }
  const label = `Test request succeeded in ${Date.now() - startedAt} ms`;
  yield succeeded(label);
  return label;
}

export interface CliLogin {
  signedIn: boolean;
  label: string;
}

async function claudeLogin(path: string, run: RunCommand): Promise<CliLogin | null> {
  const result = await run(path, ['auth', 'status', '--json'], VERSION_TIMEOUT_MS);
  const status = parseAuthStatus(result.stdout);
  if (!status) return null;
  const method = typeof status.authMethod === 'string' ? status.authMethod : '';
  return { signedIn: status.loggedIn === true, label: authMethodLabels[method] ?? 'Logged in' };
}

async function codexLogin(path: string, run: RunCommand): Promise<CliLogin> {
  const result = await run(path, ['login', 'status'], VERSION_TIMEOUT_MS);
  const label = `${result.stdout}${result.stderr}`.trim().split('\n')[0] || 'Logged in';
  return { signedIn: result.code === 0, label };
}

export function cliLogin(
  cli: 'claude' | 'codex',
  path: string,
  run: RunCommand,
): Promise<CliLogin | null> {
  return cli === 'claude' ? claudeLogin(path, run) : codexLogin(path, run);
}

function notLoggedIn(entry: CatalogEntry): VerifyStep {
  return failed(
    `You're not logged in to the \`${entry.cli}\` CLI. ${entry.loginHint}`,
    'not_logged_in',
  );
}

async function* checkClaudeLogin(
  entry: CatalogEntry,
  path: string,
  run: RunCommand,
): AsyncGenerator<VerifyStep, string | null> {
  yield started('Checking your CLI login');
  const login = await claudeLogin(path, run);
  if (!login) {
    yield succeeded('This CLI version has no login status command');
    return yield* claudeTestRequest(entry, path, run);
  }
  if (!login.signedIn) {
    yield notLoggedIn(entry);
    return null;
  }
  yield succeeded(login.label);
  return login.label;
}

async function* checkCodexLogin(
  entry: CatalogEntry,
  path: string,
  run: RunCommand,
): AsyncGenerator<VerifyStep, string | null> {
  yield started('Checking your CLI login');
  const login = await codexLogin(path, run);
  if (!login.signedIn) {
    yield notLoggedIn(entry);
    return null;
  }
  yield succeeded(login.label);
  return login.label;
}

export async function locateCli(
  cli: string,
  run: RunCommand,
  shell: string | null,
): Promise<string | null> {
  const direct = await run('/usr/bin/which', [cli], VERSION_TIMEOUT_MS);
  if (direct.code === 0 && direct.stdout.trim()) return direct.stdout.trim();
  if (!shell) return null;
  const viaShell = await run(shell, ['-ilc', `command -v ${cli}`], VERSION_TIMEOUT_MS);
  if (viaShell.code !== 0) return null;
  return (
    viaShell.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('/') && line.endsWith(`/${cli}`))
      .at(-1) ?? null
  );
}

interface FoundCli {
  path: string;
  version: string;
}

export async function* findCli(
  entry: CatalogEntry,
  run: RunCommand,
  shell: string | null,
  missing: string,
): AsyncGenerator<VerifyStep, FoundCli | null> {
  yield started(`Looking for \`${entry.cli}\` on your PATH`);
  const path = await locateCli(entry.cli, run, shell);
  if (!path) {
    yield failed(`${missing} ${entry.installHint}`, 'cli_missing');
    return null;
  }
  const version = parseVersion((await run(path, ['--version'], VERSION_TIMEOUT_MS)).stdout);
  yield succeeded(`Found \`${entry.cli} ${version}\` at \`${path}\``);
  return { path, version };
}

export async function* verifyApiKeyWithCli(
  entry: CatalogEntry,
  rawKey: string,
  endpoints: ApiEndpoints,
  run: RunCommand,
  shell: string | null,
): Verification {
  const needs = entry.methods.includes('cli') ? 'API key mode' : entry.name;
  const found = yield* findCli(
    entry,
    run,
    shell,
    `${needs} also needs the \`${entry.cli}\` CLI installed.`,
  );
  if (!found) return null;
  return yield* verifyApiKey(entry, rawKey, endpoints);
}

export async function* verifyCli(
  entry: CatalogEntry,
  run: RunCommand,
  shell: string | null = process.env.SHELL || '/bin/zsh',
): Verification {
  const found = yield* findCli(
    entry,
    run,
    shell,
    `The \`${entry.cli}\` CLI isn't installed or isn't on your PATH.`,
  );
  if (!found) return null;
  const { path, version } = found;

  const summary =
    entry.id === 'claude'
      ? yield* checkClaudeLogin(entry, path, run)
      : yield* checkCodexLogin(entry, path, run);
  if (!summary) return null;
  return { method: 'cli', detail: `${entry.cli} ${version}`, summary, models: [] };
}
