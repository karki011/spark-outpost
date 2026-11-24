// @vitest-environment jsdom
import { MutationObserver, QueryClient, QueryObserver } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SAVE_SETTLE_MS,
  announceSettingChanges,
  announceSettings,
  followSettingsWindow,
} from './settings-sync.ts';

const posted: unknown[] = [];
let listeners: ((event: MessageEvent<unknown>) => void)[] = [];

class FakeChannel {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  constructor() {
    listeners.push((event) => this.onmessage?.(event));
  }
  postMessage(news: unknown) {
    posted.push(news);
    for (const listener of listeners) listener({ data: news } as MessageEvent<unknown>);
  }
  close() {
    this.onmessage = null;
  }
}

let stops: (() => void)[] = [];
let focused = false;

beforeEach(() => {
  vi.stubGlobal('BroadcastChannel', FakeChannel);
  vi.spyOn(document, 'hasFocus').mockImplementation(() => focused);
});

afterEach(() => {
  for (const stop of stops) stop();
  stops = [];
  posted.length = 0;
  listeners = [];
  focused = false;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function watched(client: QueryClient, key: readonly string[], read: () => unknown) {
  const queryFn = vi.fn(async () => read());
  const observer = new QueryObserver(client, { queryKey: key, queryFn, staleTime: Infinity });
  stops.push(observer.subscribe(() => undefined));
  await vi.waitFor(() => expect(client.getQueryData(key)).toBeDefined());
  return queryFn;
}

async function save(client: QueryClient, onSuccess: () => unknown = () => undefined) {
  const mutation = new MutationObserver(client, { mutationFn: async () => 'saved', onSuccess });
  await mutation.mutate();
}

describe('the Settings window announcing what a save changed', () => {
  it('names the data a save replaced, then says a save finished', async () => {
    const client = new QueryClient();
    await watched(client, ['setup'], () => ({ codeMode: false }));
    stops.push(announceSettingChanges(client));

    await save(client, () => client.setQueryData(['setup'], { codeMode: true }));

    expect(posted).toEqual([{ changed: ['setup'] }, 'changed']);
  });

  it('names data refetched after a save only when it came back different', async () => {
    const client = new QueryClient();
    let plugins = ['a'];
    await watched(client, ['plugins'], () => plugins);
    await watched(client, ['projects'], () => ['same']);
    stops.push(announceSettingChanges(client));

    plugins = ['a', 'b'];
    await save(client, () => client.invalidateQueries());

    expect(posted).toEqual([{ changed: ['plugins'] }, 'changed']);
  });

  it('stays quiet for first loads and for refreshes no save caused', async () => {
    const client = new QueryClient();
    let clock = 0;
    stops.push(announceSettingChanges(client, () => clock));
    let usage = 1;
    await watched(client, ['usage'], () => usage);

    usage = 2;
    await client.invalidateQueries();
    await save(client);
    clock += SAVE_SETTLE_MS;
    usage = 3;
    await client.invalidateQueries();

    expect(posted).toEqual(['changed']);
  });

  it('says nothing when a save fails', async () => {
    const client = new QueryClient();
    stops.push(announceSettingChanges(client));
    const mutation = new MutationObserver(client, {
      mutationFn: async () => Promise.reject(new Error('no')),
    });

    await mutation.mutate().catch(() => undefined);

    expect(posted).toEqual([]);
  });
});

describe('the main window following the Settings window', () => {
  it('refreshes only the named data while it is in the background', async () => {
    const client = new QueryClient();
    const setup = await watched(client, ['setup'], () => 'setup');
    const chats = await watched(client, ['conversations'], () => 'chats');
    stops.push(followSettingsWindow(client));

    announceSettings({ changed: ['setup'] });
    announceSettings('changed');

    await vi.waitFor(() => expect(setup).toHaveBeenCalledTimes(2));
    expect(chats).toHaveBeenCalledTimes(1);
  });

  it('refreshes the rest once when it is used again, however many saves there were', async () => {
    const client = new QueryClient();
    const chats = await watched(client, ['conversations'], () => 'chats');
    stops.push(followSettingsWindow(client));
    announceSettings('changed');
    announceSettings('changed');

    window.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => expect(chats).toHaveBeenCalledTimes(2));
    window.dispatchEvent(new Event('focus'));
    await Promise.resolve();

    expect(chats).toHaveBeenCalledTimes(2);
  });

  it('refreshes everything at once when it is the window in use', async () => {
    const client = new QueryClient();
    const chats = await watched(client, ['conversations'], () => 'chats');
    stops.push(followSettingsWindow(client));
    focused = true;

    announceSettings('changed');

    await vi.waitFor(() => expect(chats).toHaveBeenCalledTimes(2));
  });

  it('ignores a message that names no data', async () => {
    const client = new QueryClient();
    const chats = await watched(client, ['conversations'], () => 'chats');
    stops.push(followSettingsWindow(client));

    new FakeChannel().postMessage({ changed: 'everything' });
    await Promise.resolve();

    expect(chats).toHaveBeenCalledTimes(1);
  });
});
