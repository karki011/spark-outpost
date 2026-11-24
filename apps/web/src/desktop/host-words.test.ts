// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hostWords } from './host-words.ts';

describe('hostWords', () => {
  it('keeps the Mac words off Windows', () => {
    expect(hostWords(false)).toEqual({
      computer: 'Mac',
      tray: 'menu bar',
      taskbar: 'Dock',
      fileManager: 'Finder',
      app: 'Mac app',
    });
  });

  it('uses the Windows words on Windows', () => {
    expect(hostWords(true)).toEqual({
      computer: 'PC',
      tray: 'system tray',
      taskbar: 'taskbar',
      fileManager: 'File Explorer',
      app: 'Windows app',
    });
  });
});

describe('the host a paired device reaches', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });
  afterEach(() => {
    delete (window as { sparkDesktop?: unknown }).sparkDesktop;
  });

  async function fresh() {
    const hint = await import('../app/connection/remote-hint.ts');
    const words = await import('./host-words.ts');
    return { ...hint, ...words };
  }

  it('says Mac when no server has said which host it is', async () => {
    const { hostWords: words } = await fresh();
    expect(words().computer).toBe('Mac');
  });

  it('says PC once the server reports a Windows host', async () => {
    const { rememberRemoteClient, hostWords: words } = await fresh();
    rememberRemoteClient(true, 'windows');
    expect(words().computer).toBe('PC');
  });

  it('keeps the reported host across a reload', async () => {
    (await fresh()).rememberRemoteClient(true, 'windows');
    vi.resetModules();
    const { hostWords: words, rememberedRemoteHost } = await fresh();
    expect(rememberedRemoteHost()).toBe('windows');
    expect(words().computer).toBe('PC');
  });

  it('keeps the last host when an older server reports none', async () => {
    const { rememberRemoteClient, hostWords: words } = await fresh();
    rememberRemoteClient(true, 'windows');
    rememberRemoteClient(true);
    expect(words().computer).toBe('PC');
  });

  it('follows the reported host over the desktop app it runs in', async () => {
    (window as { sparkDesktop?: unknown }).sparkDesktop = { platform: 'win32' };
    const { rememberRemoteClient, hostWords: words } = await fresh();
    expect(words().computer).toBe('PC');
    rememberRemoteClient(true, 'mac');
    expect(words().computer).toBe('Mac');
  });

  it('names the PC in the paired device copy once the server reports Windows', async () => {
    const { rememberRemoteClient } = await fresh();
    rememberRemoteClient(true, 'windows');
    const { offlineCopy, backOnlineBody } = await import('../app/connection/connection-copy.ts');
    const { phoneSwitchOff } = await import('../phone/use-remote-client.ts');
    expect(offlineCopy('unreachable', true).title).toBe("Can't reach your PC");
    expect(backOnlineBody(true)).toBe('Your PC is answering again.');
    expect(phoneSwitchOff()).toBe('Turned off for remote control on your PC');
  });

  it('keeps the Mac in the paired device copy for a Mac host', async () => {
    const { rememberRemoteClient } = await fresh();
    rememberRemoteClient(true, 'mac');
    const { offlineCopy } = await import('../app/connection/connection-copy.ts');
    expect(offlineCopy('unreachable', true).title).toBe("Can't reach your Mac");
  });
});
