import type {
  AdvisorSetup,
  ProviderIssue,
  ProviderSetup,
  VerifyFailureCode,
} from '@spark-outpost/contracts';
import { liveIssue, problemText } from '../home/provider-status.ts';
import { connectionTitle, isEndpoint } from './verify-log.ts';

export type TileTone = 'off' | 'ok' | 'warn' | 'bad';

export interface VerifyFailure {
  code: VerifyFailureCode | null;
  label: string;
}

export interface TileStatus {
  tone: TileTone;
  label: string;
  hint: string;
}

type TileSetup = ProviderSetup | AdvisorSetup;

function connectHint(setup: TileSetup): string {
  if (isEndpoint(setup)) return 'Connect with a server address and model';
  const viaCli = setup.methods.includes('cli');
  const viaKey = setup.methods.includes('api_key');
  if (viaCli && viaKey) return `Connect with the ${setup.cli} CLI or an API key`;
  if (viaCli) return `Connect with the ${setup.cli} CLI`;
  return 'Connect with an API key';
}

function connectedHint(setup: TileSetup, when: (iso: string) => string): string {
  const connection = setup.connection;
  if (!connection) return connectHint(setup);
  if ('lastTest' in connection && connection.lastTest) {
    return `Last test ${connection.lastTest.ok ? 'passed' : 'failed'} · ${when(connection.lastTest.testedAt)}`;
  }
  if ('lastTest' in connection) return 'Send a test message to check it';
  return `Verified ${when(connection.verifiedAt)}`;
}

function failureStatus(setup: TileSetup, failure: VerifyFailure): TileStatus {
  if (failure.code === 'cli_missing') {
    const hint =
      'installCommand' in setup
        ? `Install it with ${setup.installCommand}`
        : `Install the ${setup.cli} CLI`;
    return { tone: 'warn', label: 'CLI not installed', hint };
  }
  if (failure.code === 'not_logged_in') {
    return { tone: 'warn', label: 'Needs sign-in', hint: `Sign in to ${setup.name}` };
  }
  return { tone: 'bad', label: 'Error', hint: failure.label };
}

export function tileStatus(
  setup: TileSetup,
  issue: ProviderIssue | null,
  failure: VerifyFailure | null,
  when: (iso: string) => string,
): TileStatus {
  const connection = setup.connection;
  if (!connection) {
    if (failure) return failureStatus(setup, failure);
    return { tone: 'off', label: 'Not set up', hint: connectHint(setup) };
  }
  const problem = problemText(connection, issue, when);
  if (problem && liveIssue(connection, issue)?.kind === 'auth') {
    return { tone: 'warn', label: 'Needs sign-in', hint: problem };
  }
  if (problem) return { tone: 'bad', label: 'Error', hint: problem };
  return {
    tone: 'ok',
    label: `Connected · ${connectionTitle(setup, connection.method)}`,
    hint: connectedHint(setup, when),
  };
}
