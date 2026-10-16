import { existsSync } from 'node:fs';
import { powerMonitor, shell } from 'electron';
import { CALENDAR_SETTINGS_URL, type CalendarHostRequest } from '@spark-outpost/contracts';
import type { BridgePort, WorkerBridge } from '../browser/bridge.ts';
import { CalendarHostError, connectCalendarBridge, type CalendarBridge } from './bridge.ts';
import { createEventWindow } from './event-window.ts';
import { startCalendarHelper, type CalendarHelper } from './helper-process.ts';
import { runCalendarSeed } from './seed.ts';

export interface CalendarHostOptions {
  helperPath: string;
  seedPath: string | null;
  log(line: string): void;
}

export interface CalendarHost {
  connectWorker(port: BridgePort): WorkerBridge;
  dispose(): void;
}

export function startCalendarHost(options: CalendarHostOptions): CalendarHost {
  const supported = process.platform === 'darwin';
  const bridges = new Set<CalendarBridge>();
  const announce = () => {
    for (const bridge of bridges) bridge.changed();
  };
  const helper: CalendarHelper = startCalendarHelper({
    binary: options.helperPath,
    log: options.log,
    changed: () => window.invalidate(),
  });
  const window = createEventWindow({ helper, now: Date.now, changed: announce });
  const onResume = () => window.invalidate();
  powerMonitor.on('resume', onResume);

  const present = () => supported && existsSync(options.helperPath);
  const ready = () => {
    if (!present()) throw new CalendarHostError('missing', "The calendar helper isn't available.");
  };

  const status = async () => {
    if (!present()) return { helper: 'missing' as const, authorization: null };
    try {
      const answer = await helper.call({ op: 'status' });
      return { helper: 'ready' as const, authorization: answer.authorization };
    } catch (error) {
      options.log(`Calendar status failed: ${(error as Error).message}`);
      return { helper: 'failed' as const, authorization: null };
    }
  };

  const run = async (request: CalendarHostRequest): Promise<unknown> => {
    switch (request.op) {
      case 'status':
        return status();
      case 'open_settings':
        await shell.openExternal(CALENDAR_SETTINGS_URL);
        return { opened: true };
      case 'stop':
        window.stop();
        helper.kill();
        return { stopped: true };
      case 'window':
        ready();
        return window.read();
      case 'request': {
        ready();
        const answer = await helper.call({ op: 'request' });
        window.invalidate();
        return answer;
      }
      default:
        ready();
        return helper.call(request);
    }
  };

  runCalendarSeed({ seedPath: options.seedPath, env: process.env, log: options.log });

  return {
    connectWorker(port) {
      const bridge = connectCalendarBridge(port, run);
      bridges.add(bridge);
      return {
        receive: (message) => bridge.receive(message),
        close: () => {
          bridges.delete(bridge);
          bridge.close();
        },
      };
    },
    dispose() {
      powerMonitor.off('resume', onResume);
      window.stop();
      helper.kill();
      for (const bridge of bridges) bridge.close();
      bridges.clear();
    },
  };
}
