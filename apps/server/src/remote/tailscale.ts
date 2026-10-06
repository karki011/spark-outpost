import type { TailscaleState } from '@spark-outpost/contracts';
import type { Db } from '../persistence/db.ts';
import {
  recordRemoteAudit,
  remoteAccess,
  saveRemoteHostname,
  saveServeTarget,
  serveTarget,
} from './store.ts';
import type { DeviceStreams } from './streams.ts';
import type { TailscaleCli, TailscaleReading } from './tailscale-cli.ts';

export interface TailscaleServeDeps {
  db: Db;
  workspaceId: string;
  port: number;
  cli: TailscaleCli;
  streams: DeviceStreams;
}

export interface TailscaleServe {
  state(): Promise<TailscaleState>;
  turnOn(): Promise<TailscaleState>;
  turnOff(): Promise<TailscaleState>;
  reconcile(): Promise<void>;
}

const FUNNEL_ON =
  'Tailscale Funnel is on for this address, which would put Spark Outpost on the public internet. Turn Funnel off in Tailscale, then try again.';
const TAKEN =
  'Tailscale Serve already shares something else at this address. Remove it in Tailscale, then try again.';
const DRIFTED =
  'Tailscale Serve is no longer pointing at Spark Outpost. Turn phone access off, then on again.';
const NOT_APPLIED = 'Tailscale Serve did not start sharing Spark Outpost. Try again.';
const STOPPED_AT_START =
  'Phone access was turned off because Tailscale Serve stopped pointing at Spark Outpost.';

function addressOf(hostname: string): string {
  return `https://${hostname}`;
}

function notReady(
  reading: Exclude<TailscaleReading, { kind: 'ready' }>,
  message: string | null = null,
): TailscaleState {
  if (reading.kind === 'error') {
    return { status: 'error', hostname: null, address: null, message: reading.message };
  }
  const hostname = reading.kind === 'https_off' ? reading.hostname : null;
  return { status: reading.kind, hostname, address: null, message };
}

export function tailscaleServe(deps: TailscaleServeDeps): TailscaleServe {
  const { db, workspaceId, cli, streams } = deps;
  const target = `http://127.0.0.1:${deps.port}`;
  let notice: string | null = null;

  const failed = (hostname: string | null, message: string): TailscaleState => ({
    status: 'error',
    hostname,
    address: null,
    message,
  });

  const setHostname = async (hostname: string | null, reason: string) => {
    const before = await remoteAccess(db, workspaceId);
    if (before.hostname === hostname) return;
    await saveRemoteHostname(db, workspaceId, hostname);
    streams.closeAll();
    await recordRemoteAudit(db, workspaceId, {
      action: 'hostname_changed',
      detail: { on: hostname !== null, reason },
    });
  };

  const ours = async (handler: string | null): Promise<boolean> =>
    handler !== null && (handler === target || handler === (await serveTarget(db, workspaceId)));

  const state = async (): Promise<TailscaleState> => {
    const [reading, access] = await Promise.all([cli.read(), remoteAccess(db, workspaceId)]);
    if (reading.kind !== 'ready') return notReady(reading, notice);
    const { hostname } = reading;
    if (!access.hostname) return { status: 'off', hostname, address: null, message: notice };
    if (reading.funnel) return failed(hostname, FUNNEL_ON);
    if (reading.handler !== target || access.hostname !== hostname) {
      return failed(hostname, DRIFTED);
    }
    return { status: 'on', hostname, address: addressOf(hostname), message: null };
  };

  const point = async (
    reading: Extract<TailscaleReading, { kind: 'ready' }>,
  ): Promise<string | null> => {
    if (reading.funnel) return FUNNEL_ON;
    if (reading.handler !== null && !(await ours(reading.handler))) return TAKEN;
    if (reading.handler !== target) {
      const error = await cli.serve(target);
      if (error) return error;
      const after = await cli.read();
      if (after.kind !== 'ready' || after.handler !== target) return NOT_APPLIED;
      if (after.funnel) return FUNNEL_ON;
    }
    await saveServeTarget(db, workspaceId, target);
    return null;
  };

  return {
    state,

    async turnOn() {
      notice = null;
      const reading = await cli.read();
      if (reading.kind !== 'ready') return notReady(reading);
      const error = await point(reading);
      if (error) return failed(reading.hostname, error);
      await setHostname(reading.hostname, 'turned_on');
      return state();
    },

    async turnOff() {
      notice = null;
      await setHostname(null, 'turned_off');
      const reading = await cli.read();
      if (reading.kind !== 'ready') return notReady(reading);
      if (await ours(reading.handler)) {
        const error = await cli.stopServing();
        if (error) return failed(reading.hostname, error);
      }
      await saveServeTarget(db, workspaceId, null);
      return state();
    },

    async reconcile() {
      const access = await remoteAccess(db, workspaceId);
      if (!access.hostname) return;
      const reading = await cli.read();
      if (reading.kind !== 'ready') return;
      const stale = reading.handler !== target && (await ours(reading.handler));
      const moved = stale ? await point(reading) : null;
      const serving = moved === null && (stale || reading.handler === target) && !reading.funnel;
      if (serving) {
        await saveServeTarget(db, workspaceId, target);
        await setHostname(reading.hostname, 'address_changed');
        return;
      }
      if (stale && moved !== FUNNEL_ON && moved !== TAKEN) return;
      await setHostname(null, 'serve_missing');
      notice = STOPPED_AT_START;
    },
  };
}
