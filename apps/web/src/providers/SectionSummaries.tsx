import type { AdvisorSetup, ProviderConnection, ProviderSetup } from '@spark-outpost/contracts';
import { relativeTime } from '../ui/relative-time.ts';
import { useDefaultsSummary } from './ProviderDefaults.tsx';
import type { TestMessage } from './test-message.ts';
import type { TileStatus } from './tile-status.ts';
import type { ProviderConnect } from './use-provider-connect.ts';
import { connectionTitle, ENDPOINT_TITLE, isEndpoint, methodTitle } from './verify-log.ts';

type Setup = ProviderSetup | AdvisorSetup;

export function connectSummary(setup: Setup, status: TileStatus): string {
  const connection = setup.connection;
  if (connection) {
    const shown = isEndpoint(setup) ? connection.detail : (connection.summary ?? connection.detail);
    return `${connectionTitle(setup, connection.method)} · ${shown}`;
  }
  if (status.tone !== 'off') return status.label;
  if (isEndpoint(setup)) return ENDPOINT_TITLE;
  return setup.methods.map(methodTitle).join(' or ');
}

export function testSummary(setup: Setup, connect: ProviderConnect, test: TestMessage): string {
  if (connect.verifying) return 'Checking…';
  if (test.phase === 'asking') return `Waiting for ${setup.name}…`;
  const connection = setup.connection;
  if (!connection) return connect.log.at(-1)?.status === 'bad' ? 'Check failed' : 'Not run yet';
  if (!('lastTest' in connection)) return `Verified ${relativeTime(connection.verifiedAt)}`;
  const last = connection.lastTest;
  if (!last) return 'Not sent yet';
  return `${last.ok ? 'Passed' : 'Failed'} ${relativeTime(last.testedAt)}`;
}

export function DefaultsSummary({
  provider,
  connection,
}: {
  provider: ProviderSetup;
  connection: ProviderConnection;
}) {
  return <>{useDefaultsSummary(provider, connection)}</>;
}
