import { app, ipcMain, Notification, type IpcMainEvent, type WebContents } from 'electron';
import type { AttentionReport } from '@spark-outpost/contracts';
import {
  decideAttention,
  dockBadge,
  NO_ATTENTION,
  parseAttentionReport,
  withdrawn,
  type AttentionNotice,
} from './attention.ts';
import { startAttentionFeed, type AttentionFeed } from './attention-feed.ts';
import { attentionSources } from './attention-sources.ts';
import { IPC } from './ipc-channels.ts';

interface AttentionHostOptions {
  channelBadge: string | null;
  origin: string;
  token: string;
  trusted: (event: IpcMainEvent) => boolean;
  enabled: () => boolean;
  islandShowing: () => boolean;
  sparkFocused: () => boolean;
  openChat: (chatId: string) => void;
  showSpark: () => void;
  blocked: (on: boolean) => void;
  log: (line: string) => void;
}

export interface AttentionHost {
  refresh(): void;
  dispose(): void;
}

interface Shown {
  notice: AttentionNotice;
  notification: Notification;
}

export function startAttentionHost(options: AttentionHostOptions): AttentionHost {
  let report: AttentionReport = NO_ATTENTION;
  let seen: ReadonlySet<string> = new Set();
  let feed: AttentionFeed | null = null;
  const pages = attentionSources<WebContents>();
  const pageGone = new Map<WebContents, () => void>();
  const shown = new Map<string, Shown>();

  const showBadge = () => {
    const badge = dockBadge(options.channelBadge, report.count, options.enabled());
    app.dock?.setBadge(badge);
    return badge;
  };

  const forget = (key: string) => {
    shown.get(key)?.notification.close();
    shown.delete(key);
  };

  const notify = (notice: AttentionNotice) => {
    if (!Notification.isSupported()) return;
    const notification = new Notification({
      id: notice.key,
      title: notice.title,
      body: notice.body,
    });
    notification.on('click', () => {
      forget(notice.key);
      if (notice.chatId) options.openChat(notice.chatId);
      else options.showSpark();
    });
    notification.on('close', () => shown.delete(notice.key));
    notification.on('show', () => options.blocked(false));
    notification.on('failed', (_event, error) => {
      shown.delete(notice.key);
      options.blocked(true);
      options.log(`Could not show a notification: ${error}`);
    });
    shown.set(notice.key, { notice, notification });
    notification.show();
  };

  const take = (next: AttentionReport, from: string) => {
    report = next;
    const decision = decideAttention({
      report,
      seen,
      enabled: options.enabled(),
      islandShowing: options.islandShowing(),
      sparkFocused: options.sparkFocused(),
    });
    seen = decision.seen;
    for (const [key, { notice }] of [...shown]) {
      if (withdrawn(notice, seen)) forget(key);
    }
    const badge = showBadge();
    decision.notify.forEach(notify);
    options.log(
      `Attention from ${from}: ${report.count} waiting, Dock badge "${badge}", ${decision.notify.length} notified.`,
    );
  };

  const forgetPage = (page: WebContents) => {
    pageGone.delete(page);
    const left = pages.gone(page);
    if (left) take(left, 'the page still open');
    else {
      feed ??= startAttentionFeed({
        origin: options.origin,
        token: options.token,
        onReport: (next) => take(next, 'the event stream'),
      });
    }
  };

  const watchPage = (page: WebContents) => {
    if (pageGone.has(page)) return;
    const gone = () => forgetPage(page);
    pageGone.set(page, gone);
    page.once('destroyed', gone);
  };

  const onReport = (event: IpcMainEvent, payload: unknown) => {
    if (!options.trusted(event)) return;
    const parsed = parseAttentionReport(payload);
    if (!parsed) return;
    feed?.stop();
    feed = null;
    watchPage(event.sender);
    pages.report(event.sender, parsed);
    take(parsed, 'a page');
  };
  ipcMain.on(IPC.attentionReport, onReport);

  return {
    refresh: showBadge,
    dispose: () => {
      ipcMain.off(IPC.attentionReport, onReport);
      feed?.stop();
      feed = null;
      for (const [page, gone] of pageGone) page.off('destroyed', gone);
      pageGone.clear();
      for (const key of [...shown.keys()]) forget(key);
      app.dock?.setBadge(options.channelBadge ?? '');
    },
  };
}
