import type { RequestHandler, Router } from 'express';
import type { Db } from '../persistence/db.ts';
import { remoteGateway } from './gateway.ts';
import { Pairings } from './pairing.ts';
import { PasskeyChallenges } from './passkey-challenges.ts';
import { pushKeys, type PushKeys } from './push-keys.ts';
import { generateVapidKeys } from './push-send.ts';
import { remoteRoutes } from './routes.ts';
import type { RunCommand } from '../setup/command.ts';
import type { SecretStore } from '../setup/secrets.ts';
import { DeviceStreams } from './streams.ts';
import { tailscaleServe } from './tailscale.ts';
import { tailscaleCli } from './tailscale-cli.ts';

export interface RemoteAccessDeps {
  db: Db;
  workspaceId: string;
  port: number;
  webRoot?: string | undefined;
  runCommand: RunCommand;
  loginShell: string | null;
  secrets: SecretStore;
  pushKeys?: PushKeys;
  pairingAttemptsPerMinute?: number;
}

export interface RemoteAccessParts {
  guard(local: readonly RequestHandler[]): RequestHandler;
  bodyGuard: RequestHandler;
  routes: Router;
  reconcile(): Promise<void>;
}

export function remoteAccessParts(deps: RemoteAccessDeps): RemoteAccessParts {
  const streams = new DeviceStreams();
  const gateway = remoteGateway({ ...deps, streams });
  const tailscale = tailscaleServe({
    db: deps.db,
    workspaceId: deps.workspaceId,
    port: deps.port,
    cli: tailscaleCli(deps.runCommand, deps.loginShell),
    streams,
  });
  return {
    guard: gateway.guard,
    bodyGuard: gateway.bodyGuard,
    routes: remoteRoutes({
      db: deps.db,
      workspaceId: deps.workspaceId,
      pairings: new Pairings(Date.now, deps.pairingAttemptsPerMinute),
      challenges: new PasskeyChallenges(),
      streams,
      tailscale,
      pushKeys: deps.pushKeys ?? pushKeys(deps.secrets, generateVapidKeys),
    }),
    reconcile: tailscale.reconcile,
  };
}
