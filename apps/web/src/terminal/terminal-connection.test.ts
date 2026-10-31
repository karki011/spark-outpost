// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TerminalConnection, TerminalHandlers } from './terminal-connection.ts';
import type { TerminalTicket } from './terminal-api.ts';

const calls: string[] = [];
const deleted: string[] = [];
let loads = 0;

function fakeXterm() {
  loads += 1;
  return {
    openXterm: (
      start: () => Promise<TerminalTicket>,
      element: HTMLElement,
      opening: TerminalHandlers<TerminalTicket>,
    ): TerminalConnection => {
      calls.push('opened');
      void start().then(
        (created) => opening.onOpen(created),
        (error: Error) => opening.onError(error.message),
      );
      element.append(Object.assign(document.createElement('div'), { className: 'xterm' }));
      return {
        run: () => calls.push('run'),
        notice: (text) => calls.push(`notice ${text}`),
        fit: () => calls.push('fit'),
        focus: () => calls.push('focus'),
        close: () => calls.push('close'),
        insertSelection: (kind, selected) => calls.push(`insert ${kind} ${selected}`) > 0,
        clearSelection: () => calls.push('clear selection'),
        dispose: () => calls.push('dispose'),
      };
    },
  };
}

const handlers = (errors: string[] = []): TerminalHandlers<TerminalTicket> => ({
  onOpen: () => undefined,
  onEnded: () => undefined,
  onError: (message) => errors.push(message),
});

const start = () => Promise.resolve({ id: 'session', token: 'stream-ticket' });
const loaded = () => new Promise((resolve) => setTimeout(resolve, 0));

async function freshModule(
  xterm: () => ReturnType<typeof fakeXterm> | Promise<ReturnType<typeof fakeXterm>> = fakeXterm,
) {
  vi.resetModules();
  vi.doMock('./terminal-api.ts', () => ({
    deleteTerminalSession: (id: string) => {
      deleted.push(id);
      return Promise.resolve();
    },
  }));
  vi.doMock('./xterm-terminal.ts', xterm);
  return import('./terminal-connection.ts');
}

beforeEach(() => {
  calls.length = 0;
  deleted.length = 0;
  loads = 0;
});

afterEach(() => {
  document.body.replaceChildren();
});

describe('opening a terminal before its code has loaded', () => {
  it('shows a placeholder, then opens and replays what was asked meanwhile, in order', async () => {
    const { openTerminal } = await freshModule();
    const host = document.createElement('div');
    document.body.append(host);
    const connection = openTerminal(start, host, handlers());
    expect(host.querySelector('.term-skel')).not.toBeNull();
    expect(host.querySelector('.term-skel')?.getAttribute('aria-hidden')).toBe('true');
    connection.notice('Started in the project folder');
    connection.focus();
    expect(calls).toEqual([]);

    await loaded();
    expect(host.querySelector('.term-skel')).toBeNull();
    expect(host.querySelector('.xterm')).not.toBeNull();
    expect(calls).toEqual(['opened', 'notice Started in the project folder', 'focus']);

    connection.fit();
    connection.run();
    connection.close();
    connection.dispose();
    connection.dispose();
    expect(calls.slice(3)).toEqual(['fit', 'run', 'close', 'dispose']);
  });

  it('inserts a selection only once the terminal is open, and never replays it', async () => {
    const { openTerminal } = await freshModule();
    const connection = openTerminal(start, document.createElement('div'), handlers());
    expect(connection.insertSelection('add', 'early')).toBe(false);
    await loaded();
    expect(connection.insertSelection('ask', 'pnpm check')).toBe(true);
    connection.clearSelection();
    expect(calls).toEqual(['opened', 'insert ask pnpm check', 'clear selection']);
  });

  it('never opens a terminal that was closed while loading', async () => {
    const { openTerminal } = await freshModule();
    const host = document.createElement('div');
    const connection = openTerminal(start, host, handlers());
    connection.focus();
    connection.dispose();
    expect(host.querySelector('.term-skel')).toBeNull();
    await loaded();
    expect(calls).toEqual([]);
  });

  it('loads the terminal code once for a preload and every terminal after it', async () => {
    const { openTerminal, preloadTerminal } = await freshModule();
    await preloadTerminal();
    openTerminal(start, document.createElement('div'), handlers());
    openTerminal(start, document.createElement('div'), handlers());
    await loaded();
    expect(loads).toBe(1);
    expect(calls).toEqual(['opened', 'opened']);
  });

  it('reports a failed load and tries again for the next terminal', async () => {
    let broken = true;
    const { openTerminal } = await freshModule(() => {
      if (broken) throw new Error('chunk missing');
      return fakeXterm();
    });
    const errors: string[] = [];
    const host = document.createElement('div');
    openTerminal(start, host, handlers(errors));
    await loaded();
    expect(errors).toEqual(['The terminal could not load. Close it and open it again.']);
    expect(host.querySelector('.term-skel')).toBeNull();

    broken = false;
    openTerminal(start, document.createElement('div'), handlers(errors));
    await loaded();
    expect(calls).toEqual(['opened']);
    expect(errors).toHaveLength(1);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function heldChunk(broken = false) {
  const chunk = deferred<void>();
  const load = async () => {
    await chunk.promise;
    if (broken) throw new Error('chunk missing');
    return fakeXterm();
  };
  return { load, release: () => chunk.resolve() };
}

function earlyHandlers(
  events: string[],
  preserveSession = false,
): TerminalHandlers<TerminalTicket> {
  return {
    startEarly: true,
    preserveSession,
    onCreated: (created) => events.push(`created ${created.id}`),
    onOpen: (created) => events.push(`open ${created.id}`),
    onEnded: () => undefined,
    onError: (message) => events.push(`error ${message}`),
  };
}

describe('starting the session while the terminal code loads', () => {
  it('asks for the session before the code arrives and names the tab from the reply', async () => {
    const chunk = heldChunk();
    const { openTerminal } = await freshModule(chunk.load);
    const events: string[] = [];
    const session = deferred<TerminalTicket>();
    const starts = vi.fn(() => session.promise);
    openTerminal(starts, document.createElement('div'), earlyHandlers(events));
    expect(starts).toHaveBeenCalledTimes(1);

    session.resolve({ id: 'shell-1', token: 't' });
    await loaded();
    expect(events).toEqual(['created shell-1']);
    expect(calls).toEqual([]);

    chunk.release();
    await loaded();
    expect(starts).toHaveBeenCalledTimes(1);
    expect(events).toEqual(['created shell-1', 'open shell-1']);
    expect(deleted).toEqual([]);
  });

  it('stops a session that arrives after its tab was closed, once', async () => {
    const chunk = heldChunk();
    const { openTerminal } = await freshModule(chunk.load);
    const events: string[] = [];
    const session = deferred<TerminalTicket>();
    const connection = openTerminal(
      () => session.promise,
      document.createElement('div'),
      earlyHandlers(events),
    );
    connection.dispose();
    connection.dispose();
    session.resolve({ id: 'shell-2', token: 't' });
    chunk.release();
    await loaded();
    expect(deleted).toEqual(['shell-2']);
    expect(events).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('keeps a session the caller asked to preserve when its tab closes early', async () => {
    const chunk = heldChunk();
    const { openTerminal } = await freshModule(chunk.load);
    const connection = openTerminal(
      () => Promise.resolve({ id: 'kept', token: 't' }),
      document.createElement('div'),
      earlyHandlers([], true),
    );
    connection.dispose();
    chunk.release();
    await loaded();
    expect(deleted).toEqual([]);
  });

  it('stops the session and shows the load error when the code fails to load', async () => {
    const chunk = heldChunk(true);
    const { openTerminal } = await freshModule(chunk.load);
    const events: string[] = [];
    const host = document.createElement('div');
    const connection = openTerminal(
      () => Promise.resolve({ id: 'shell-3', token: 't' }),
      host,
      earlyHandlers(events),
    );
    chunk.release();
    await loaded();
    connection.dispose();
    await loaded();
    expect(deleted).toEqual(['shell-3']);
    expect(events.filter((event) => event.startsWith('error'))).toEqual([
      'error The terminal could not load. Close it and open it again.',
    ]);
    expect(host.querySelector('.term-skel')).toBeNull();
  });

  it('shows the start error once the code has loaded when the session could not start', async () => {
    const chunk = heldChunk();
    const { openTerminal } = await freshModule(chunk.load);
    const events: string[] = [];
    openTerminal(
      () => Promise.reject(new Error('Close a terminal before opening another.')),
      document.createElement('div'),
      earlyHandlers(events),
    );
    await loaded();
    expect(events).toEqual([]);
    chunk.release();
    await loaded();
    expect(events).toEqual(['error Close a terminal before opening another.']);
    expect(deleted).toEqual([]);
  });
});
