import {
  remoteSparkBridgeFromHostSchema,
  remoteSparkBridgeToHostSchema,
  type RemoteSparkBridgeFromHost,
} from '@spark-outpost/contracts';
import type { AppLockGate } from '../app-lock-gate.ts';
import type { BridgePort, WorkerBridge } from '../browser/bridge.ts';
import { clearRemoteSparkSession, type RemoteSparkGuards } from './partition.ts';
import { openRemoteSparkWindow, type RemoteSparkOpen, type RemoteSparkWindow } from './window.ts';

export interface RemoteSparkHostOptions extends RemoteSparkGuards {
  openExternal(url: string): void;
  gate?: AppLockGate;
}

export interface RemoteSparkHost {
  connect(port: BridgePort): WorkerBridge;
  dispose(): void;
}

export function startRemoteSparkHost(options: RemoteSparkHostOptions): RemoteSparkHost {
  const windows = new Map<string, RemoteSparkWindow>();
  const ports = new Set<BridgePort>();

  const tell = (message: RemoteSparkBridgeFromHost) => {
    if (!remoteSparkBridgeFromHostSchema.safeParse(message).success) return;
    for (const port of ports) port.post(message);
  };

  const open = (spark: RemoteSparkOpen) => {
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
      signedOut: () => tell({ kind: 'remote-spark:signed-out', id }),
      closed: () => {
        if (windows.get(id) === window) windows.delete(id);
      },
    });
    windows.set(id, window);
  };

  const close = (id: string) => {
    windows.get(id)?.close();
    windows.delete(id);
    clearRemoteSparkSession(id).catch(() =>
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
            else close(parsed.data.id);
          } catch (error) {
            options.log(`A remote Spark window did not open: ${(error as Error).message}`);
          }
        },
        close: () => void ports.delete(port),
      };
    },
    dispose() {
      for (const window of windows.values()) window.close();
      windows.clear();
      ports.clear();
    },
  };
}
