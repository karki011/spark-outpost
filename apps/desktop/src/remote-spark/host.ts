import {
  remoteSparkBridgeFromHostSchema,
  remoteSparkBridgeToHostSchema,
  type RemoteSparkBridgeFromHost,
} from '@spark-outpost/contracts';
import type { AppLockGate } from '../app-lock-gate.ts';
import type { BridgePort, WorkerBridge } from '../browser/bridge.ts';
import { endRemoteSession } from './end-session.ts';
import {
  clearRemoteSparkSession,
  remoteSparkSession,
  type RemoteSparkGuards,
} from './partition.ts';
import { startRemoteSparkWatcher } from './watcher.ts';
import { openRemoteSparkWindow, type RemoteSparkOpen, type RemoteSparkWindow } from './window.ts';

type SleepEvent = 'suspend' | 'resume';

interface SleepSource {
  on(event: SleepEvent, listener: () => void): unknown;
  off(event: SleepEvent, listener: () => void): unknown;
}

export interface RemoteSparkHostOptions extends RemoteSparkGuards {
  power: SleepSource;
  openExternal(url: string): void;
  gate?: AppLockGate;
}

export interface RemoteSparkHost {
  connect(port: BridgePort): WorkerBridge;
  dispose(): void;
}

export function startRemoteSparkHost(options: RemoteSparkHostOptions): RemoteSparkHost {
  const windows = new Map<string, RemoteSparkWindow>();
  const hostnames = new Map<string, string>();
  const ports = new Set<BridgePort>();

  const tell = (message: RemoteSparkBridgeFromHost) => {
    if (!remoteSparkBridgeFromHostSchema.safeParse(message).success) return;
    for (const port of ports) port.post(message);
  };

  const watcher = startRemoteSparkWatcher({
    guards: options,
    status: (id, reach) => tell({ kind: 'remote-spark:status', id, ...reach }),
    signedOut: (id) => tell({ kind: 'remote-spark:signed-out', id }),
  });
  let watchPort: BridgePort | null = null;
  options.power.on('suspend', watcher.pause);
  options.power.on('resume', watcher.resume);

  const open = (spark: RemoteSparkOpen) => {
    hostnames.set(spark.id, spark.hostname);
    const existing = windows.get(spark.id);
    if (existing) {
      existing.focus();
      return;
    }
    const { id, hostname } = spark;
    const window = openRemoteSparkWindow(spark, {
      guards: options,
      gate: options.gate,
      openExternal: options.openExternal,
      changed: (value) => tell({ kind: 'remote-spark:cookie', id, hostname, value }),
      accessChanged: (value) => tell({ kind: 'remote-spark:access', id, hostname, value }),
      signedOut: () => tell({ kind: 'remote-spark:signed-out', id }),
      closed: () => {
        if (windows.get(id) === window) windows.delete(id);
      },
    });
    windows.set(id, window);
  };

  const endSession = async (id: string) => {
    const hostname = hostnames.get(id);
    hostnames.delete(id);
    if (hostname === undefined) return;
    try {
      await endRemoteSession(remoteSparkSession(id, hostname, options), hostname);
    } catch {
      return;
    }
  };

  const close = async (id: string) => {
    watcher.forget(id);
    windows.get(id)?.close();
    windows.delete(id);
    await endSession(id);
    await clearRemoteSparkSession(id).catch(() =>
      options.log('Could not clear a remote Spark window session.'),
    );
  };

  return {
    connect(port) {
      return {
        receive(raw) {
          const parsed = remoteSparkBridgeToHostSchema.safeParse(raw);
          if (!parsed.success) return;
          ports.add(port);
          try {
            if (parsed.data.kind === 'remote-spark:open') open(parsed.data);
            else if (parsed.data.kind === 'remote-spark:close') void close(parsed.data.id);
            else {
              watchPort = port;
              for (const spark of parsed.data.sparks) hostnames.set(spark.id, spark.hostname);
              watcher.watch(parsed.data.sparks);
            }
          } catch (error) {
            options.log(`A remote Spark window did not open: ${(error as Error).message}`);
          }
        },
        close() {
          ports.delete(port);
          if (watchPort !== port) return;
          watchPort = null;
          watcher.stop();
        },
      };
    },
    dispose() {
      options.power.off('suspend', watcher.pause);
      options.power.off('resume', watcher.resume);
      watcher.stop();
      for (const window of windows.values()) window.close();
      windows.clear();
      ports.clear();
    },
  };
}
