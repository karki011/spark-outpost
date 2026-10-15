import { existsSync } from 'node:fs';
import { app, globalShortcut, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import {
  MAC_ACCESSIBILITY_SETTINGS_URL,
  type MacControlStatus,
  type MacIndicator,
} from '@spark-outpost/contracts';
import { IPC } from '../ipc-channels.ts';
import type { BridgePort, WorkerBridge } from '../browser/bridge.ts';
import { connectMacBridge } from './bridge.ts';
import { createMacControl } from './control.ts';
import { startMacHelper } from './helper-process.ts';
import { openMacIndicator } from './indicator-window.ts';

export const MAC_STOP_SHORTCUT = 'Control+Alt+Command+.';

export interface MacControlHostOptions {
  helperPath: string;
  origin(): string | null;
  preload: string;
  trusted(event: IpcMainInvokeEvent): boolean;
  log(line: string): void;
}

export interface MacControlHost {
  connectWorker(port: BridgePort): WorkerBridge;
  dispose(): void;
}

const CHANNELS = [
  IPC.macControlStatus,
  IPC.macControlPrompt,
  IPC.macControlOpenSettings,
  IPC.macControlStop,
  IPC.macControlResume,
  IPC.macControlIndicator,
];

function sparkPids(helperPid: number | null): ReadonlySet<number> {
  const pids = new Set<number>([process.pid, ...app.getAppMetrics().map((metric) => metric.pid)]);
  if (helperPid !== null) pids.add(helperPid);
  return pids;
}

export function startMacControlHost(options: MacControlHostOptions): MacControlHost {
  const supported = process.platform === 'darwin';
  const helper = startMacHelper({ binary: options.helperPath, log: options.log });
  const indicator = openMacIndicator(options.origin, options.preload);
  let shown: MacIndicator | null = null;

  const shortcut = (on: boolean) => {
    const registered = globalShortcut.isRegistered(MAC_STOP_SHORTCUT);
    if (on && !registered) {
      if (!globalShortcut.register(MAC_STOP_SHORTCUT, () => control.stop())) {
        options.log(`Could not register ${MAC_STOP_SHORTCUT} to stop Mac control.`);
      }
    } else if (!on && registered) {
      globalShortcut.unregister(MAC_STOP_SHORTCUT);
    }
  };

  const control = createMacControl({
    helper,
    sparkPids: () => sparkPids(helper.pid),
    indicator: (state) => {
      shown = state;
      indicator.show(state);
      shortcut(state !== null);
    },
  });

  const status = async (): Promise<MacControlStatus> => {
    if (!supported) return { supported, trusted: false, helper: 'missing' };
    if (!existsSync(options.helperPath)) return { supported, trusted: false, helper: 'missing' };
    try {
      const answer = await helper.call({ op: 'status' });
      return { supported, trusted: answer.trusted, helper: 'ready' };
    } catch (error) {
      options.log(`Mac control status failed: ${(error as Error).message}`);
      return { supported, trusted: false, helper: 'failed' };
    }
  };

  const allowed = (event: IpcMainInvokeEvent) =>
    options.trusted(event) || indicator.owns(event.sender.id);

  ipcMain.handle(IPC.macControlStatus, (event) => (options.trusted(event) ? status() : null));
  ipcMain.handle(IPC.macControlPrompt, async (event) => {
    if (!options.trusted(event) || !supported) return null;
    await helper.call({ op: 'prompt' }).catch((error: unknown) => {
      options.log(`Mac control could not ask for Accessibility: ${(error as Error).message}`);
    });
    return status();
  });
  ipcMain.handle(IPC.macControlOpenSettings, (event) => {
    if (options.trusted(event)) void shell.openExternal(MAC_ACCESSIBILITY_SETTINGS_URL);
  });
  ipcMain.handle(IPC.macControlStop, (event) => {
    if (allowed(event)) control.stop();
  });
  ipcMain.handle(IPC.macControlResume, (event) => {
    if (allowed(event)) control.resume();
  });
  ipcMain.handle(IPC.macControlIndicator, (event) => (allowed(event) ? shown : null));

  return {
    connectWorker: (port) =>
      connectMacBridge(port, (request, signal) => control.run(request, signal)),
    dispose() {
      for (const channel of CHANNELS) ipcMain.removeHandler(channel);
      shortcut(false);
      helper.kill();
      indicator.dispose();
    },
  };
}
