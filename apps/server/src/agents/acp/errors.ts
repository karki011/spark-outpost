import { PROTOCOL_VERSION, RequestError, type InitializeResponse } from '@agentclientprotocol/sdk';
import { redactText } from '../../audit/redact.ts';
import { ModelRejectedError, ProviderError } from '../../providers/provider.ts';
import { AgentExitedError } from './agent-process.ts';
import { objectFields } from './object-fields.ts';
import {
  classifyFailure,
  failureText,
  plainDetail,
  type FailureSignal,
} from './provider-failures.ts';
import type { AgentFailure } from './session-updates.ts';

const AUTH_REQUIRED = -32000;
const MAX_DETAIL = 300;
const MAX_RAW = 2000;

function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  if (error instanceof RequestError && error.data !== undefined) {
    return `${error.message} ${JSON.stringify(error.data)}`;
  }
  return error.message;
}

function statusOf(error: unknown): number | null {
  if (!(error instanceof Error)) return null;
  const fields = error as Error & { code?: unknown; status?: unknown };
  const status = typeof fields.status === 'number' ? fields.status : fields.code;
  return typeof status === 'number' && status >= 400 && status < 600 ? status : null;
}

function errorKindOf(error: unknown): string | null {
  if (!(error instanceof RequestError)) return null;
  const kind = objectFields(error.data).errorKind;
  return typeof kind === 'string' ? kind : null;
}

const rawDetails = (raw: string) => redactText(raw).slice(0, MAX_RAW);

function shown(raw: string): string {
  return redactText(plainDetail(raw)).slice(0, MAX_DETAIL);
}

function classified(
  agentName: string,
  signal: FailureSignal,
  only: 'model' | 'other',
): ProviderError | null {
  const found = classifyFailure(signal);
  if (!found) return null;
  const rejected = found.kind === 'model_unsupported';
  if (rejected !== (only === 'model')) return null;
  const details = rawDetails(signal.text);
  if (found.kind === 'model_unsupported') {
    return new ModelRejectedError(agentName, found.model, details);
  }
  return new ProviderError(failureText(found.kind, agentName), details);
}

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
  const signal = { text: errorText(error), status: statusOf(error), errorKind: errorKindOf(error) };
  const known = classified(agentName, signal, 'model') ?? classified(agentName, signal, 'other');
  if (known) return known;
  if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
    return new ProviderError(`The ${agentName} agent could not start. Reinstall Spark Outpost.`);
  }
  const message = error instanceof Error ? error.message : String(error);
  return new ProviderError(
    `${agentName} reported an error: ${shown(message)}`,
    rawDetails(message),
  );
}

export function failureError(agentName: string, failure: AgentFailure): ProviderError {
  const title = shown(failure.title);
  const details = rawDetails(failure.title);
  const signal = { text: failure.title, category: failure.category };
  const rejected = classified(agentName, signal, 'model');
  if (rejected) return rejected;
  if (failure.category === 'auth_required' || failure.category === 'access') {
    return new ProviderError(
      `${agentName} couldn't sign in (${title}). Open Settings, reconnect ${agentName}, and try again.`,
      details,
    );
  }
  const known = classified(agentName, signal, 'other');
  if (known) return known;
  if (failure.category === 'connection' || failure.category === 'transport_lost') {
    return new ProviderError(
      `${agentName} is not available right now (${title}). Try again.`,
      details,
    );
  }
  return new ProviderError(`${agentName} stopped with an error: ${title}`, details);
}

export function assertProtocolVersion(agentName: string, init: InitializeResponse): void {
  if (init.protocolVersion === PROTOCOL_VERSION) return;
  throw new ProviderError(
    `${agentName} speaks ACP version ${init.protocolVersion}, but Spark Outpost needs ${PROTOCOL_VERSION}.`,
  );
}
