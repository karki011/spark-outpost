import { fakeElectron } from './electron.fixture.ts';

export const ipc = new Map<string, (...args: unknown[]) => unknown>();

export const fakeElectronWithIpc = {
  ...fakeElectron,
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
      ipc.set(channel, handler),
    removeHandler: (channel: string) => ipc.delete(channel),
  },
  Menu: { buildFromTemplate: () => ({ popup: () => undefined }) },
  clipboard: { writeText: () => undefined },
};
