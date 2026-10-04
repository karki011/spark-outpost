import path from 'node:path';
import { expect, type Page } from '@playwright/test';

export const SHOTS = process.env.ISLAND_SHOTS ?? '';

export const island = (page: Page) => page.getByRole('region', { name: 'Spark Island' });

export interface FakeIsland {
  openedChats: string[];
  openedTurns: (string | null)[];
  settings: string[];
  sound: boolean[];
  chimes: number;
}

export async function fakeHomeDesktop(page: Page, theme = 'graphite') {
  await page.addInitScript((theme) => {
    const now = new Date();
    localStorage.setItem('spark-outpost.theme', theme);
    localStorage.setItem(
      'spark-outpost.island',
      JSON.stringify({
        lastSeen: now.getTime(),
        greetedDay: `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`,
      }),
    );
    const none = () => () => undefined;
    const fake = {
      openedChats: [] as string[],
      openedTurns: [] as (string | null)[],
      settings: [] as string[],
      sound: [] as boolean[],
      chimes: 0,
    };
    const listeners = new Set<(status: unknown) => void>();
    const status = () => ({
      supported: true,
      enabled: true,
      shortcuts: { quick: 'Alt+Space', sessions: 'Alt+Shift+Space' },
      failed: [],
      sound: sessionStorage.getItem('fake-island-sound') === 'on',
    });
    class FakeAudio {
      currentTime = 0;
      destination = {};
      createOscillator() {
        return {
          type: 'sine',
          frequency: { value: 0 },
          connect: (next: unknown) => next,
          start: () => {
            fake.chimes += 1;
          },
          stop: () => undefined,
        };
      }
      createGain() {
        const ramp = () => undefined;
        return {
          gain: {
            setValueAtTime: ramp,
            exponentialRampToValueAtTime: ramp,
          },
          connect: (next: unknown) => next,
        };
      }
    }
    Object.assign(window, {
      fakeIsland: fake,
      AudioContext: FakeAudio,
      sparkDesktop: {
        platform: 'darwin',
        companion: {
          get: async () => status(),
          setSound: async (on: boolean) => {
            fake.sound.push(on);
            sessionStorage.setItem('fake-island-sound', on ? 'on' : 'off');
            const next = status();
            listeners.forEach((listener) => listener(next));
            return next;
          },
          onChange: (listener: (status: unknown) => void) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
        },
        island: {
          geometry: async () => ({
            notch: false,
            top: 24,
            notchWidth: 0,
            docked: true,
            menuBar: 24,
          }),
          onGeometry: none,
          onCommand: (callback: (action: string) => void) => {
            Object.assign(window, { islandCommand: callback });
            return () => undefined;
          },
          onEscape: (callback: () => void) => {
            Object.assign(window, { islandEscape: callback });
            return () => undefined;
          },
          sparkFocused: async () => true,
          onSparkFocus: none,
          pickFolder: async () => null,
          pathForFile: () => null,
          setInteractive: () => undefined,
          setFocusable: () => undefined,
          drag: () => undefined,
          openChat: (id: string, runId?: string) => {
            fake.openedChats.push(id);
            fake.openedTurns.push(runId ?? null);
          },
          openSettings: (target: string) => fake.settings.push(target),
          setRestSize: () => undefined,
        },
        onOpenChat: none,
      },
    });
  }, theme);
}

export function fakeState(page: Page): Promise<FakeIsland> {
  return page.evaluate(() => (window as unknown as { fakeIsland: FakeIsland }).fakeIsland);
}

export async function openIsland(page: Page) {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/island');
  await expect(island(page)).toBeVisible();
}

export async function openHome(page: Page) {
  await page.mouse.move(640, 600);
  await island(page)
    .getByRole('button', { name: /Open Spark Island/ })
    .click();
  await expect(island(page).getByRole('tab', { name: 'Home' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
}

export const nowCard = (page: Page) => island(page).getByRole('region', { name: /^Now/ });

export async function shot(page: Page, name: string, settle = 900) {
  if (!SHOTS) return;
  await page.waitForTimeout(settle);
  await page.screenshot({
    path: path.join(SHOTS, `${name}.png`),
    clip: { x: 260, y: 0, width: 760, height: 420 },
  });
}
