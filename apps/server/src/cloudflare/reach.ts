import { randomBytes } from 'node:crypto';
import {
  CLOUDFLARE_REACH_PERMISSIONS,
  CLOUDFLARE_REACH_STEPS,
  type CloudflareReach,
  type CloudflareReachPermission,
  type CloudflareReachStep,
  type CloudflareReachStepId,
  type StartCloudflareReachRequest,
} from '@spark-outpost/contracts';
import type { Db } from '../persistence/db.ts';
import { remoteAccess } from '../remote/store.ts';
import { CLOUDFLARE_TUNNEL_TOKEN_SECRET, type SecretStore } from '../setup/secrets.ts';
import { firstAccount, type CloudflareAccount, type CloudflareAccountApi } from './account-api.ts';
import type { CloudflareClientConfig } from './client.ts';
import { revokeCloudflareToken, type CloudflareToken } from './oauth.ts';
import {
  accessAppHasPolicy,
  accessAppId,
  allowEmail,
  createAccessApp,
  createCname,
  createTunnel,
  dnsRecordsNamed,
  listZones,
  pointTunnel,
  tunnelNamed,
  tunnelToken,
  type CloudflareZone,
} from './reach-api.ts';
import {
  REACH_BUSY,
  REACH_NOT_CONNECTED,
  REACH_NO_TUNNEL_PROGRAM,
  REACH_RECORD_TAKEN,
  REACH_SCOPES,
  REACH_TOKEN_NOT_SAVED,
  REACH_UNAVAILABLE,
  reachFailure,
  reachNoDomain,
  reachNotAllowed,
} from './reach-problems.ts';
import { deleteReach, reachRow, saveReach } from './reach-store.ts';
import { CLOUDFLARE_DASH_URL, SETUP_SIGN_IN_ENDED, StepFailure } from './setup-problems.ts';
import { beginCloudflareSignIn, type CloudflareSignIn } from './sign-in.ts';
import type { TunnelRunner } from './tunnel-runner.ts';

const EXPIRY_MARGIN_MS = 60_000;
const SETUP_GRACE_MS = 10 * 60_000;
export const REACH_RECONCILE_MS = 60_000;

export interface CloudflareReachDeps {
  db: Db;
  workspaceId: string;
  secrets: SecretStore;
  client: CloudflareClientConfig | null;
  runner: TunnelRunner | null;
  forwardTo: string;
  fetch: typeof fetch;
  now?: () => number;
}

export interface CloudflareReachService {
  view(): CloudflareReach;
  start(request: StartCloudflareReachRequest): Promise<CloudflareReach>;
  resume(): Promise<CloudflareReach>;
  cancel(): Promise<CloudflareReach>;
  remove(): Promise<CloudflareReach>;
  reconcile(): Promise<void>;
  boot(): void;
  settled(): Promise<void>;
}

interface Progress {
  hostname: string | null;
  email: string | null;
  account: CloudflareAccount | null;
  granted: string[] | null;
  zone: CloudflareZone | null;
  tunnelId: string | null;
}

type Work = Exclude<CloudflareReachStepId, 'signIn'>;

const STEP_PERMISSION: Record<Work, CloudflareReachPermission> = {
  domain: 'domains',
  tunnel: 'tunnel',
  address: 'dns',
  signInPage: 'access',
  start: 'tunnel',
};

const todo = (id: CloudflareReachStepId): CloudflareReachStep => ({
  id,
  state: 'todo',
  problem: null,
  fix: null,
  fixUrl: null,
});
const freshSteps = () => CLOUDFLARE_REACH_STEPS.map(todo);
const freshProgress = (): Progress => ({
  hostname: null,
  email: null,
  account: null,
  granted: null,
  zone: null,
  tunnelId: null,
});

function zoneOf(zones: CloudflareZone[], hostname: string): CloudflareZone | null {
  const owning = zones.filter(
    (zone) => hostname === zone.name || hostname.endsWith(`.${zone.name}`),
  );
  return owning.sort((a, b) => b.name.length - a.name.length)[0] ?? null;
}

export function createCloudflareReach(deps: CloudflareReachDeps): CloudflareReachService {
  const { db, workspaceId, secrets, client, runner } = deps;
  const now = deps.now ?? Date.now;
  let status: CloudflareReach['status'] = 'idle';
  let steps = freshSteps();
  let progress = freshProgress();
  let token: CloudflareToken | null = null;
  let signIn: CloudflareSignIn | null = null;
  let generation = 0;
  let graceUntil = 0;
  let connected: string | null = null;
  let work: Promise<void> = Promise.resolve();

  const set = (id: CloudflareReachStepId, change: Partial<CloudflareReachStep>) => {
    steps = steps.map((step) => (step.id === id ? { ...todo(id), ...change } : step));
  };
  const stop = (id: CloudflareReachStepId, failure: StepFailure) => {
    set(id, {
      state: 'failed',
      problem: failure.message,
      fix: failure.fix,
      fixUrl: failure.fixUrl,
    });
    status = 'stopped';
  };
  const revoke = (gone: CloudflareToken) =>
    client ? revokeCloudflareToken({ fetch: deps.fetch, client }, gone.accessToken) : null;
  const dropToken = async () => {
    const live = token;
    token = null;
    if (live) await revoke(live);
  };
  const tokenLive = () => token !== null && token.expiresAt - EXPIRY_MARGIN_MS > now();

  const api = (permission: CloudflareReachPermission): CloudflareAccountApi => {
    if (!client) throw new StepFailure(REACH_UNAVAILABLE, null);
    if (!token || !tokenLive()) throw new StepFailure(SETUP_SIGN_IN_ENDED, 'allow');
    if (!token.scopes.includes(REACH_SCOPES[permission])) throw reachNotAllowed(permission);
    return { fetch: deps.fetch, apiUrl: client.apiUrl, token: token.accessToken };
  };

  const need = <T>(value: T | null): T => {
    if (value === null) throw new StepFailure(SETUP_SIGN_IN_ENDED, 'allow');
    return value;
  };

  const WORK: Record<Work, (mine: number) => Promise<void>> = {
    async domain() {
      const hostname = need(progress.hostname);
      const zone = zoneOf(await listZones(api('domains'), need(progress.account).id), hostname);
      if (!zone) throw new StepFailure(reachNoDomain(hostname), null);
      progress.zone = zone;
    },
    async tunnel(mine) {
      const hostname = need(progress.hostname);
      const accountId = need(progress.account).id;
      const tunnels = api('tunnel');
      const name = `spark-outpost-${hostname}`;
      const tunnelId =
        (await tunnelNamed(tunnels, accountId, name)) ??
        (await createTunnel(tunnels, accountId, name, randomBytes(32).toString('base64')));
      await pointTunnel(tunnels, accountId, tunnelId, { hostname, service: deps.forwardTo });
      const runToken = await tunnelToken(tunnels, accountId, tunnelId);
      if (mine !== generation) return;
      try {
        await secrets.set(CLOUDFLARE_TUNNEL_TOKEN_SECRET, runToken);
      } catch {
        throw new StepFailure(REACH_TOKEN_NOT_SAVED, 'retry');
      }
      progress.tunnelId = tunnelId;
      await saveReach(db, workspaceId, {
        hostname,
        accountId,
        zoneId: need(progress.zone).id,
        tunnelId,
      });
      connected = hostname;
    },
    async address() {
      const hostname = need(progress.hostname);
      const zone = need(progress.zone);
      const target = `${need(progress.tunnelId)}.cfargotunnel.com`;
      const records = await dnsRecordsNamed(api('dns'), zone.id, hostname);
      if (records.some((record) => record.type === 'CNAME' && record.content === target)) return;
      if (records.length > 0) {
        const accountId = need(progress.account).id;
        throw new StepFailure(
          REACH_RECORD_TAKEN,
          'cloudflare',
          `${CLOUDFLARE_DASH_URL}/${accountId}/${zone.name}/dns/records`,
        );
      }
      await createCname(api('dns'), zone.id, hostname, target);
    },
    async signInPage() {
      const hostname = need(progress.hostname);
      const zone = need(progress.zone);
      const access = api('access');
      const appId =
        (await accessAppId(access, zone.id, hostname)) ??
        (await createAccessApp(access, zone.id, { name: 'Spark Outpost', hostname }));
      if (await accessAppHasPolicy(access, zone.id, appId)) return;
      await allowEmail(access, zone.id, appId, need(progress.email));
    },
    async start() {
      if (!runner) throw new StepFailure(REACH_NO_TUNNEL_PROGRAM, null);
      const runToken = await secrets.get(CLOUDFLARE_TUNNEL_TOKEN_SECRET);
      if (!runToken) throw new StepFailure(REACH_TOKEN_NOT_SAVED, 'retry');
      graceUntil = now() + SETUP_GRACE_MS;
      if (!(await runner.start(runToken))) throw new StepFailure(REACH_NOT_CONNECTED, 'retry');
    },
  };

  const run = async (mine: number) => {
    status = 'working';
    for (const id of ['domain', 'tunnel', 'address', 'signInPage', 'start'] as const) {
      if (steps.find((step) => step.id === id)?.state === 'done') continue;
      set(id, { state: 'working' });
      try {
        await WORK[id](mine);
      } catch (error) {
        if (mine !== generation) return;
        stop(id, reachFailure(error, STEP_PERMISSION[id]));
        return;
      }
      if (mine !== generation) return;
      set(id, { state: 'done' });
    }
    status = 'done';
    await dropToken();
  };

  const signedIn = async (fresh: CloudflareToken, mine: number) => {
    if (mine !== generation) {
      await revoke(fresh);
      return;
    }
    await dropToken();
    if (mine !== generation) {
      await revoke(fresh);
      return;
    }
    token = fresh;
    set('signIn', { state: 'working' });
    status = 'working';
    try {
      const account = await firstAccount(api('account'));
      if (mine !== generation) return;
      if (progress.account && progress.account.id !== account.id) {
        steps = freshSteps();
        progress = { ...freshProgress(), hostname: progress.hostname, email: progress.email };
      }
      progress = { ...progress, account, granted: fresh.scopes };
    } catch (error) {
      if (mine !== generation) return;
      await dropToken();
      stop('signIn', new StepFailure(reachFailure(error, 'account').message, 'allow'));
      return;
    }
    set('signIn', { state: 'done' });
    await run(mine);
  };

  const beginSignIn = async (config: CloudflareClientConfig) => {
    signIn?.cancel();
    signIn = null;
    const mine = generation;
    const begun = await beginCloudflareSignIn(
      { client: config, fetch: deps.fetch, now },
      Object.values(REACH_SCOPES),
      async (result) => {
        if (signIn === begun) signIn = null;
        if (mine !== generation) {
          if (result.ok) await revoke(result.token);
          return;
        }
        if (result.ok) await signedIn(result.token, mine);
        else stop('signIn', new StepFailure(result.problem, 'allow'));
      },
    );
    if (mine !== generation) {
      begun.cancel();
      return;
    }
    signIn = begun;
    status = 'waiting';
    steps = steps.map((step) => (step.state === 'failed' ? todo(step.id) : step));
    set('signIn', { state: 'working' });
  };

  const canResume = (): boolean => {
    const failed = steps.find((step) => step.state === 'failed');
    if (status !== 'stopped' || !failed || failed.fix === 'allow' || failed.id === 'signIn') {
      return false;
    }
    return failed.id === 'start' || tokenLive();
  };

  const view = (): CloudflareReach => ({
    available: client !== null && runner !== null,
    status,
    authorizeUrl: signIn?.authorizeUrl ?? null,
    account: progress.account?.name ?? null,
    signedIn: tokenLive(),
    hostname: progress.hostname,
    connected,
    tunnel: runner?.state() ?? 'off',
    permissions: CLOUDFLARE_REACH_PERMISSIONS.map((id) => ({
      id,
      state: !progress.granted
        ? 'needed'
        : progress.granted.includes(REACH_SCOPES[id])
          ? 'allowed'
          : 'missing',
    })),
    steps,
  });

  const reset = async () => {
    generation += 1;
    signIn?.cancel();
    signIn = null;
    status = 'idle';
    steps = freshSteps();
    progress = freshProgress();
    await dropToken();
  };

  const reconcile = async () => {
    if (!runner) return;
    const row = await reachRow(db, workspaceId);
    connected = row?.hostname ?? null;
    const access = await remoteAccess(db, workspaceId);
    const serving = row !== null && access.reach === 'custom' && access.hostname === row.hostname;
    if (serving) {
      if (runner.state() !== 'off') return;
      const runToken = await secrets.get(CLOUDFLARE_TUNNEL_TOKEN_SECRET);
      if (runToken) void runner.start(runToken);
      return;
    }
    if (now() >= graceUntil && runner.state() !== 'off') runner.stop();
  };

  return {
    view,
    reconcile,
    settled: () => (signIn ? signIn.settled().then(() => work) : work),
    boot() {
      const quietly = () => void reconcile().catch(() => undefined);
      quietly();
      setInterval(quietly, REACH_RECONCILE_MS).unref();
    },
    async start(request) {
      if (!client) throw new StepFailure(REACH_UNAVAILABLE, null);
      if (!runner) throw new StepFailure(REACH_NO_TUNNEL_PROGRAM, null);
      if (status === 'working') throw new StepFailure(REACH_BUSY, null);
      await reset();
      progress = { ...freshProgress(), hostname: request.hostname, email: request.email };
      await beginSignIn(client);
      return view();
    },
    async resume() {
      if (!client) throw new StepFailure(REACH_UNAVAILABLE, null);
      if (status === 'working') return view();
      if (!progress.hostname) throw new StepFailure(REACH_UNAVAILABLE, null);
      if (canResume()) {
        const mine = generation;
        status = 'working';
        work = run(mine);
        return view();
      }
      await beginSignIn(client);
      return view();
    },
    async cancel() {
      await reset();
      return view();
    },
    async remove() {
      await reset();
      await work.catch(() => undefined);
      graceUntil = 0;
      runner?.stop();
      await secrets.delete(CLOUDFLARE_TUNNEL_TOKEN_SECRET);
      await deleteReach(db, workspaceId);
      connected = null;
      return view();
    },
  };
}
