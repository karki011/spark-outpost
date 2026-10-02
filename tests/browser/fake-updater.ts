import path from 'node:path';
import type { Page } from '@playwright/test';

const SHOTS = process.env.SPARK_SHOTS_DIR;
const RELAUNCH_KEY = 'fake-updater-relaunch';

export async function shot(page: Page, name: string): Promise<void> {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `update-${name}.png`) });
}

export async function railShot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  const rail = await page.getByRole('navigation', { name: 'Main' }).boundingBox();
  const viewport = page.viewportSize();
  if (!rail || !viewport) return;
  const top = Math.max(0, rail.y + rail.height - 220);
  await page.screenshot({
    path: path.join(SHOTS, `update-${name}.png`),
    clip: { x: 0, y: top, width: 300, height: viewport.height - top },
  });
}

export async function fakeUpdater(page: Page, start: Record<string, unknown> = {}) {
  await page.addInitScript(
    ({ patch, relaunchKey }) => {
      const listeners = new Set<(status: unknown) => void>();
      const calls: unknown[][] = [];
      const relaunched = JSON.parse(localStorage.getItem(relaunchKey) ?? '{}') as Record<
        string,
        unknown
      >;
      const state = {
        runs: 1,
        status: {
          currentVersion: '0.2.0',
          channel: 'stable',
          autoDownload: true,
          phase: 'idle',
          offReason: null as string | null,
          availableVersion: null as string | null,
          progress: null as number | null,
          installRequested: false,
          waitingForRuns: false,
          lastCheckedAt: null as string | null,
          error: null,
          skippedVersion: null,
          releaseNotesUrl: 'https://updates.example.com/spark/release-notes.html' as string | null,
          devBuild: false,
          preview: false,
          previewUpdatedTo: null as string | null,
          ...patch,
          ...relaunched,
        },
      };
      const publish = () => {
        const copy = structuredClone(state.status);
        listeners.forEach((listener) => listener(copy));
        return copy;
      };
      const noop = () => () => undefined;
      const waiting = 'Spark will update when your work finishes.';
      Object.assign(window, {
        desktopCalls: calls,
        fakeUpdates: {
          push: (next: Partial<typeof state.status>) => {
            Object.assign(state.status, next);
            publish();
          },
          setRuns: (runs: number) => {
            state.runs = runs;
          },
          relaunch: (next: Partial<typeof state.status>) => {
            localStorage.setItem(relaunchKey, JSON.stringify(next));
            sessionStorage.clear();
          },
        },
        sparkDesktop: {
          platform: 'darwin',
          companion: { get: async () => null, onChange: noop },
          island: { geometry: async () => null, onGeometry: noop, onCommand: noop },
          updates: {
            get: async () => structuredClone(state.status),
            check: async () => {
              calls.push(['check']);
              state.status.lastCheckedAt = new Date().toISOString();
              return publish();
            },
            setChannel: async (channel: string) => {
              calls.push(['channel', channel]);
              state.status.channel = channel;
              return publish();
            },
            setAutoDownload: async (on: boolean) => {
              calls.push(['autoDownload', on]);
              state.status.autoDownload = on;
              return publish();
            },
            preview: async () => {
              calls.push(['preview']);
              Object.assign(state.status, {
                preview: true,
                phase: 'idle',
                offReason: null,
                previewUpdatedTo: null,
              });
              return publish();
            },
            install: async () => {
              calls.push(['install']);
              if (state.status.phase === 'available') {
                Object.assign(state.status, {
                  phase: 'downloading',
                  installRequested: true,
                  progress: 0,
                });
                publish();
                return { status: 'downloading' };
              }
              if (state.runs > 0) {
                Object.assign(state.status, { installRequested: true, waitingForRuns: true });
                publish();
                return { status: 'waiting', reason: waiting };
              }
              Object.assign(state.status, { phase: 'installing', waitingForRuns: false });
              publish();
              return { status: 'installing' };
            },
            onChange: (listener: (status: unknown) => void) => {
              listeners.add(listener);
              return () => listeners.delete(listener);
            },
          },
          onOpenChat: noop,
        },
      });
    },
    { patch: start, relaunchKey: RELAUNCH_KEY },
  );
}

export async function desktopCalls(page: Page) {
  return page.evaluate(() => (window as unknown as { desktopCalls: unknown[] }).desktopCalls);
}

export async function pushUpdate(page: Page, patch: Record<string, unknown>) {
  await page.evaluate((next) => {
    (window as unknown as { fakeUpdates: { push: (p: unknown) => void } }).fakeUpdates.push(next);
  }, patch);
}

export async function setRuns(page: Page, runs: number) {
  await page.evaluate((count) => {
    (window as unknown as { fakeUpdates: { setRuns: (n: number) => void } }).fakeUpdates.setRuns(
      count,
    );
  }, runs);
}

export async function relaunchWith(page: Page, patch: Record<string, unknown>) {
  await page.evaluate((next) => {
    (window as unknown as { fakeUpdates: { relaunch: (p: unknown) => void } }).fakeUpdates.relaunch(
      next,
    );
  }, patch);
  await page.reload();
}
