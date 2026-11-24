import { existsSync } from 'node:fs';
import { powerMonitor, shell } from 'electron';
import { CALENDAR_SETTINGS_URL, type CalendarHostRequest } from '@spark-outpost/contracts';
import type { BridgePort, WorkerBridge } from '../browser/bridge.ts';
import {
  CalendarHostError,
  connectCalendarBridge,
  type CalendarBridge,
  type CalendarRun,
} from './bridge.ts';
import { createEventWindow } from './event-window.ts';
import { startCalendarHelper, type CalendarHelper } from './helper-process.ts';
import { runCalendarSeed } from './seed.ts';

export interface CalendarHostOptions {
  helperPath: string;
  seedPath: string | null;
  log(line: string): void;
  platform?: NodeJS.Platform;
}

export interface CalendarHost {
  connectWorker(port: BridgePort): WorkerBridge;
  dispose(): void;
}

const NOT_ON_THIS_COMPUTER = 'macOS Calendar isn’t available on this computer.';

async function unsupported(request: CalendarHostRequest): Promise<unknown> {
  if (request.op === 'status') return { helper: 'unsupported', authorization: null };
  if (request.op === 'stop') return { stopped: true };
  throw new CalendarHostError('missing', NOT_ON_THIS_COMPUTER);
}

function workerBridges(run: CalendarRun) {
  const bridges = new Set<CalendarBridge>();
  return {
    bridges,
    connectWorker(port: BridgePort): WorkerBridge {
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
    closeAll() {
      for (const bridge of bridges) bridge.close();
      bridges.clear();
    },
  };
}

export function startCalendarHost(options: CalendarHostOptions): CalendarHost {
  if ((options.platform ?? process.platform) !== 'darwin') {
    const workers = workerBridges(unsupported);
    return { connectWorker: workers.connectWorker, dispose: workers.closeAll };
  }
  return startMacCalendarHost(options);
}

function startMacCalendarHost(options: CalendarHostOptions): CalendarHost {
  const workers = workerBridges((request) => run(request));
  const announce = () => {
    for (const bridge of workers.bridges) bridge.changed();
  };
  const helper: CalendarHelper = startCalendarHelper({
    binary: options.helperPath,
    log: options.log,
    changed: () => window.invalidate(),
  });
  const window = createEventWindow({ helper, now: Date.now, changed: announce });
  const onResume = () => window.invalidate();
  powerMonitor.on('resume', onResume);

  const present = () => existsSync(options.helperPath);
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
      case 'refresh':
        ready();
        window.invalidate();
        return { refreshed: true };
      case 'range':
        ready();
        return window.range(request.from, request.to);
      case 'request': {
        ready();
        const answer = await helper.call({ op: 'request' });
        window.invalidate();
        return answer;
      }
      case 'save':
      case 'remove': {
        ready();
        const answer = await helper.call(request);
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
    connectWorker: workers.connectWorker,
    dispose() {
      powerMonitor.off('resume', onResume);
      window.stop();
      helper.kill();
      workers.closeAll();
    },
  };
}
