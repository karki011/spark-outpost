import { app, ipcMain, Notification, type IpcMainEvent, type WebContents } from 'electron';
import {
  decideAttention,
  dockBadge,
  NO_ATTENTION,
  parseAttentionReport,
  type AttentionReport,
  type AttentionRequest,
} from './attention.ts';
import { IPC } from './ipc-channels.ts';

interface AttentionHostOptions {
  channelBadge: string | null;
  trusted: (event: IpcMainEvent) => boolean;
  enabled: () => boolean;
  islandShowing: () => boolean;
  sparkFocused: () => boolean;
  openChat: (chatId: string) => void;
  blocked: (on: boolean) => void;
  log: (line: string) => void;
}

export interface AttentionHost {
  refresh(): void;
  dispose(): void;
}

export function startAttentionHost(options: AttentionHostOptions): AttentionHost {
  let report: AttentionReport = NO_ATTENTION;
  let seen: ReadonlySet<string> = new Set();
  let reporter: WebContents | null = null;
  const shown = new Map<string, Notification>();

  const showBadge = () =>
    app.dock?.setBadge(dockBadge(options.channelBadge, report.count, options.enabled()));

  const forget = (key: string) => {
    shown.get(key)?.close();
    shown.delete(key);
  };

  const notify = (request: AttentionRequest) => {
    if (!Notification.isSupported()) return;
    const notification = new Notification({
      id: request.key,
      title: request.title,
      body: request.body,
    });
    notification.on('click', () => {
      forget(request.key);
      options.openChat(request.chatId);
    });
    notification.on('close', () => shown.delete(request.key));
    notification.on('show', () => options.blocked(false));
    notification.on('failed', (_event, error) => {
      shown.delete(request.key);
      options.blocked(true);
      options.log(`Could not show a notification: ${error}`);
    });
    shown.set(request.key, notification);
    notification.show();
  };

  const apply = () => {
    const decision = decideAttention({
      report,
      seen,
      enabled: options.enabled(),
      islandShowing: options.islandShowing(),
      sparkFocused: options.sparkFocused(),
    });
    seen = decision.seen;
    for (const key of [...shown.keys()]) {
      if (!seen.has(key)) forget(key);
    }
    showBadge();
    decision.notify.forEach(notify);
  };

  const reporterGone = () => {
    reporter = null;
    report = NO_ATTENTION;
    apply();
  };

  const onReport = (event: IpcMainEvent, payload: unknown) => {
    if (!options.trusted(event)) return;
    const parsed = parseAttentionReport(payload);
    if (!parsed) return;
    if (reporter !== event.sender) {
      reporter?.off('destroyed', reporterGone);
      reporter = event.sender;
      reporter.once('destroyed', reporterGone);
    }
    report = parsed;
    apply();
  };
  ipcMain.on(IPC.attentionReport, onReport);

  return {
    refresh: showBadge,
    dispose: () => {
      ipcMain.off(IPC.attentionReport, onReport);
      reporter?.off('destroyed', reporterGone);
      reporter = null;
      for (const key of [...shown.keys()]) forget(key);
      app.dock?.setBadge(options.channelBadge ?? '');
    },
  };
}
