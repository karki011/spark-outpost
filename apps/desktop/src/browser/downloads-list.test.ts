import { describe, expect, it, vi } from 'vitest';
import type { BrowserDownload } from '@spark-outpost/contracts';
import type { InputMarks } from './clipboard-permission.ts';
import {
  DownloadsList,
  downloadStarter,
  type DownloadFile,
  type DownloadTab,
} from './downloads-list.ts';
import { quarantineValue } from './quarantine.ts';

const NOW = Date.parse('2026-10-23T12:00:00Z');

function marks(change: Partial<InputMarks> = {}): InputMarks {
  return { shown: true, agentBusy: 0, userInputAt: NOW - 500, agentDoneAt: null, ...change };
}

function file(name = 'report.pdf') {
  const listeners: { updated?: () => void; done?: (event: unknown, state: string) => void } = {};
  let savePath = '';
  const fake = {
    getFilename: () => name,
    getURL: () => 'https://files.example.com/report.pdf?token=1',
    getReceivedBytes: () => 2048,
    getTotalBytes: () => 4096,
    getSavePath: () => savePath,
    setSaveDialogOptions: vi.fn(),
    cancel: vi.fn(),
    on: (_event: 'updated', listener: () => void) => (listeners.updated = listener),
    once: (_event: 'done', listener: (event: unknown, state: string) => void) =>
      (listeners.done = listener),
  } satisfies DownloadFile;
  return {
    fake,
    finish(state: string, savedTo: string) {
      savePath = savedTo;
      listeners.done?.({}, state);
    },
  };
}

function setup() {
  const lists: BrowserDownload[][] = [];
  const reveal = vi.fn();
  const quarantine = vi.fn().mockResolvedValue(true);
  const log = vi.fn();
  const list = new DownloadsList({
    downloadsDir: '/Users/me/Downloads',
    changed: (entries) => lists.push(entries),
    reveal,
    quarantine,
    log,
    now: () => new Date(NOW),
  });
  const tab = (chatId: string, input: InputMarks) => ({ chatId, inputMarks: () => input });
  return { list, lists, reveal, quarantine, log, tab };
}

describe('who started a download', () => {
  it('is the user right after their own click or key on a shown tab', () => {
    expect(downloadStarter(marks(), NOW)).toBe('you');
    expect(downloadStarter(marks({ userInputAt: NOW - 10_000 }), NOW)).toBe('page');
    expect(downloadStarter(marks({ shown: false }), NOW)).toBe('page');
    expect(downloadStarter(null, NOW)).toBe('page');
  });

  it('is the agent while its call runs or when it acted after the user', () => {
    expect(downloadStarter(marks({ agentBusy: 1 }), NOW)).toBe('agent');
    expect(downloadStarter(marks({ agentDoneAt: NOW - 100 }), NOW)).toBe('agent');
    expect(downloadStarter(marks({ userInputAt: null, agentDoneAt: NOW - 100 }), NOW)).toBe(
      'agent',
    );
  });
});

describe('the downloads list', () => {
  it('asks where to save a download the user started, in Downloads by default', async () => {
    const { list, lists, reveal, quarantine, tab } = setup();
    const download = file('../../etc/report.pdf');
    expect(list.decide(download.fake, tab('personal', marks()))).toBe(true);
    expect(download.fake.setSaveDialogOptions).toHaveBeenCalledWith({
      title: 'Save download',
      defaultPath: '/Users/me/Downloads/report.pdf',
    });
    const [entry] = lists.at(-1)!;
    expect(entry).toMatchObject({ where: 'personal', by: 'you', state: 'saving' });
    expect(entry?.host).toBe('files.example.com');
    expect(list.act(entry!.id, 'show')).toBe(false);

    download.finish('completed', '/Users/me/Desktop/report.pdf');
    await vi.waitFor(() =>
      expect(lists.at(-1)![0]).toMatchObject({ state: 'saved', receivedBytes: 2048 }),
    );
    expect(quarantine).toHaveBeenCalledWith('/Users/me/Desktop/report.pdf');
    expect(list.act(entry!.id, 'show')).toBe(true);
    expect(reveal).toHaveBeenCalledWith('/Users/me/Desktop/report.pdf');
  });

  it('cancels a download an agent started and lists it as the agent’s', () => {
    const { list, lists, log, tab } = setup();
    const download = file();
    const agentTab: DownloadTab = tab(
      '0b0e8f0e-5d6b-4d6f-9a8b-2f6f9d1c1a10',
      marks({ agentBusy: 1 }),
    );
    expect(list.decide(download.fake, agentTab)).toBe(false);
    expect(download.fake.setSaveDialogOptions).not.toHaveBeenCalled();
    expect(agentTab.downloadRefused).toBe(true);
    expect(lists.at(-1)![0]).toMatchObject({ where: 'chat', by: 'agent', state: 'blocked' });
    expect(log).toHaveBeenCalledWith('Cancelled a download that an agent started.');
  });

  it('lets the user cancel a download that is saving, and keeps the newest 30', () => {
    const { list, lists, tab } = setup();
    const download = file();
    list.decide(download.fake, tab('work', marks()));
    const id = lists.at(-1)![0]!.id;
    expect(list.act(id, 'cancel')).toBe(true);
    expect(download.fake.cancel).toHaveBeenCalled();
    for (let index = 0; index < 35; index += 1) list.decide(file().fake, null);
    expect(list.list()).toHaveLength(30);
    expect(list.list().every((entry) => entry.by === 'page')).toBe(true);
  });
});

describe('the quarantine mark', () => {
  it('says the file was downloaded, when and by which app', () => {
    expect(
      quarantineValue(new Date(NOW), 'Spark; Outpost', 'a1b2c3d4-0000-4000-8000-000000000000'),
    ).toBe('0081;6adb4c40;Spark  Outpost;A1B2C3D4-0000-4000-8000-000000000000');
  });
});
