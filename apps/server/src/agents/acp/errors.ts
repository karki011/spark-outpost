import { PROTOCOL_VERSION, RequestError, type InitializeResponse } from '@agentclientprotocol/sdk';
import { redactText } from '../../audit/redact.ts';
import { ProviderError } from '../../providers/provider.ts';
import { AgentExitedError } from './agent-process.ts';
import type { AgentFailure } from './session-updates.ts';

const AUTH_REQUIRED = -32000;
const MAX_DETAIL = 300;
const RATE_LIMITED = 429;
const RATE_LIMIT_TEXT = /\b429\b|rate[\s_-]?limit|too many requests/i;

function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  if (error instanceof RequestError && error.data !== undefined) {
    return `${error.message} ${JSON.stringify(error.data)}`;
  }
  return error.message;
}

function isRateLimited(error: unknown): boolean {
  if (error instanceof Error) {
    const fields = error as Error & { code?: unknown; status?: unknown };
    if (fields.code === RATE_LIMITED || fields.status === RATE_LIMITED) return true;
  }
  return RATE_LIMIT_TEXT.test(errorText(error));
}

const rateLimited = (agentName: string) =>
  new ProviderError(`${agentName} is rate limited. Try again in a minute.`);

export function toProviderError(agentName: string, error: unknown, stderrTail: string): Error {
  if (error instanceof ProviderError) return error;
  if (error instanceof RequestError && error.code === AUTH_REQUIRED) {
    return new ProviderError(
      `${agentName} isn't signed in. Open Settings, reconnect ${agentName}, and try again.`,
    );
  }
  if (stderrTail.trim()) console.error(`${agentName} agent stderr:\n${redactText(stderrTail)}`);
  if (error instanceof AgentExitedError) {
    return new ProviderError(
      `${agentName} stopped unexpectedly (exit code ${error.exitCode ?? 'none'}). Try again.`,
    );
  }
  if (isRateLimited(error)) return rateLimited(agentName);
  if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
    return new ProviderError(`The ${agentName} agent could not start. Reinstall Spark Outpost.`);
  }
  const detail = redactText(error instanceof Error ? error.message : String(error));
  return new ProviderError(`${agentName} reported an error: ${detail.slice(0, MAX_DETAIL)}`);
}

export function failureError(agentName: string, failure: AgentFailure): ProviderError {
  const title = redactText(failure.title).slice(0, MAX_DETAIL);
  if (failure.category === 'auth_required' || failure.category === 'access') {
    return new ProviderError(
      `${agentName} couldn't sign in (${title}). Open Settings, reconnect ${agentName}, and try again.`,
    );
  }
  if (isRateLimited(failure.category) || isRateLimited(failure.title)) {
    return rateLimited(agentName);
  }
  if (failure.category === 'connection' || failure.category === 'transport_lost') {
    return new ProviderError(`${agentName} is not available right now (${title}). Try again.`);
  }
  return new ProviderError(`${agentName} stopped with an error: ${title}`);
}

export function assertProtocolVersion(agentName: string, init: InitializeResponse): void {
  if (init.protocolVersion === PROTOCOL_VERSION) return;
  throw new ProviderError(
    `${agentName} speaks ACP version ${init.protocolVersion}, but Spark Outpost needs ${PROTOCOL_VERSION}.`,
  );
}
