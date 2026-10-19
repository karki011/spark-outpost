import type { Cdp } from './cdp.ts';
import { BoundedLog, withoutQuery } from './bounded-log.ts';
import { NetworkLog } from './network-capture.ts';

interface RemoteValue {
  type?: string;
  value?: unknown;
  description?: string;
}

function argText(arg: RemoteValue): string {
  if (typeof arg.value === 'string') return arg.value;
  if (arg.value !== undefined) return JSON.stringify(arg.value);
  return arg.description ?? arg.type ?? '';
}

export interface PageLogs {
  console: BoundedLog;
  network: NetworkLog;
  reset(): void;
  stop(): void;
}

const SHELL_WARNING = /^%c?Electron Security Warning \(/;

export function fromTheShell(text: string): boolean {
  return SHELL_WARNING.test(text);
}

export async function capturePageLogs(cdp: Cdp): Promise<PageLogs> {
  const consoleLog = new BoundedLog();
  const network = new NetworkLog();

  const onConsole = (params: Record<string, unknown>) => {
    const args = (params.args as RemoteValue[] | undefined) ?? [];
    const text = args.map(argText).join(' ');
    if (fromTheShell(text)) return;
    consoleLog.push({
      level: String(params.type ?? 'log'),
      text,
      source: null,
      status: null,
      method: null,
    });
  };
  const onException = (params: Record<string, unknown>) => {
    const details = (params.exceptionDetails ?? {}) as {
      text?: string;
      url?: string;
      lineNumber?: number;
      exception?: RemoteValue;
    };
    consoleLog.push({
      level: 'error',
      text: details.exception?.description ?? details.text ?? 'Uncaught error',
      source: details.url ? `${withoutQuery(details.url)}:${details.lineNumber ?? 0}` : null,
      status: null,
      method: null,
    });
  };
  const onLogEntry = (params: Record<string, unknown>) => {
    const entry = (params.entry ?? {}) as { level?: string; text?: string; url?: string };
    consoleLog.push({
      level: entry.level ?? 'info',
      text: entry.text ?? '',
      source: entry.url ? withoutQuery(entry.url) : null,
      status: null,
      method: null,
    });
  };
  const handlers: Record<string, (params: Record<string, unknown>) => void> = {
    'Runtime.consoleAPICalled': onConsole,
    'Runtime.exceptionThrown': onException,
    'Log.entryAdded': onLogEntry,
    'Network.requestWillBeSent': (params) => network.requestWillBeSent(params),
    'Network.responseReceived': (params) => network.responseReceived(params),
    'Network.requestServedFromCache': (params) => network.servedFromCache(params),
    'Network.dataReceived': (params) => network.dataReceived(params),
    'Network.loadingFinished': (params) => network.loadingFinished(params),
    'Network.loadingFailed': (params) => network.loadingFailed(params),
  };
  const stop = cdp.listen((method, params) => handlers[method]?.(params));
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Network.enable', { maxTotalBufferSize: 1024, maxResourceBufferSize: 1024 });
  const reset = () => {
    consoleLog.clear();
    network.clear();
  };
  return { console: consoleLog, network, reset, stop };
}
