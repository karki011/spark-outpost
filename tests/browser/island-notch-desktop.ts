import { expect, type Page } from '@playwright/test';
import type { IslandSize } from '../../packages/contracts/src/island-size.ts';

export const NOTCH = { width: 186, height: 32, menuBar: 38 };
export const VIEWPORT = { width: 1280, height: 720 };

export const island = (page: Page) => page.getByRole('region', { name: 'Spark Island' });

export interface NotchSetup {
  size: IslandSize;
  autoExpand: boolean;
  sparkFocused?: boolean;
  theme?: string;
  notch?: boolean;
  cutout?: { width: number; height: number; menuBar: number };
  windowTop?: number;
  docked?: boolean;
  asScreen?: boolean;
}

export interface RestSize {
  width: number;
  height: number;
}

export interface NotchWindow {
  islandFocus: boolean[];
  islandRest: (RestSize | null)[];
  islandDrags: string[];
  sparkFocus(focused: boolean): void;
  islandCommand(action: string): void;
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function notchBox(): Box {
  const left = (VIEWPORT.width - NOTCH.width) / 2;
  return { left, top: 0, right: left + NOTCH.width, bottom: NOTCH.height };
}

export async function openNotchIsland(page: Page, setup: NotchSetup) {
  await page.addInitScript(
    ({ setup, notch }) => {
      const windowTop = setup.windowTop ?? 0;
      const now = new Date();
      localStorage.setItem('spark-outpost.theme', setup.theme ?? 'graphite');
      localStorage.setItem(
        'spark-outpost.island',
        JSON.stringify({
          lastSeen: now.getTime(),
          greetedDay: `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`,
        }),
      );
      const none = () => () => undefined;
      const hasNotch = setup.notch !== false;
      const focus: boolean[] = [];
      const rest: ({ width: number; height: number } | null)[] = [];
      const drags: string[] = [];
      Object.assign(window, {
        islandFocus: focus,
        islandRest: rest,
        islandDrags: drags,
        sparkDesktop: {
          platform: 'darwin',
          companion: {
            get: async () => ({
              supported: true,
              enabled: true,
              shortcuts: { quick: 'Alt+Space', sessions: 'Alt+Shift+Space' },
              failed: [],
              islandSize: setup.size,
              autoExpand: setup.autoExpand,
            }),
            onChange: none,
          },
          island: {
            geometry: async () => ({
              notch: hasNotch,
              top: hasNotch ? notch.menuBar : 24,
              notchWidth: hasNotch ? notch.width : 0,
              notchHeight: hasNotch ? notch.height : 0,
              docked: setup.docked !== false,
              menuBar: hasNotch ? notch.menuBar : 24,
              windowTop,
            }),
            onGeometry: none,
            onCommand: (callback: (action: string) => void) => {
              Object.assign(window, { islandCommand: callback });
              return () => undefined;
            },
            onEscape: none,
            sparkFocused: async () => setup.sparkFocused === true,
            onSparkFocus: (callback: (focused: boolean) => void) => {
              Object.assign(window, { sparkFocus: callback });
              return () => undefined;
            },
            pickFolder: async () => null,
            pathForFile: () => null,
            setInteractive: () => undefined,
            setFocusable: (on: boolean) => focus.push(on),
            drag: (phase: string) => drags.push(phase),
            openChat: () => undefined,
            setRestSize: (size: { width: number; height: number } | null) => rest.push(size),
          },
          onOpenChat: none,
        },
      });
      if (setup.asScreen) {
        window.addEventListener('DOMContentLoaded', () => {
          document.body.style.transform = `translateY(${windowTop}px)`;
        });
      }
      if (!hasNotch) return;
      window.addEventListener('DOMContentLoaded', () => {
        const cutout = document.createElement('div');
        cutout.dataset.testNotch = '';
        cutout.style.cssText = `position:fixed;top:${setup.asScreen ? 0 : -windowTop}px;left:50%;width:${notch.width}px;height:${notch.height}px;margin-left:${-notch.width / 2}px;background:#000;border-radius:0 0 9px 9px;z-index:99;pointer-events:none`;
        (setup.asScreen ? document.documentElement : document.body).append(cutout);
      });
    },
    { setup, notch: setup.cutout ?? NOTCH },
  );
  await page.setViewportSize(VIEWPORT);
  await page.goto('/island');
  await expect(island(page)).toBeVisible();
}

export async function settled(page: Page) {
  let last = '';
  await expect
    .poll(async () => {
      const box = JSON.stringify(await island(page).boundingBox());
      const same = box === last;
      last = box;
      return same;
    })
    .toBe(true);
}

const CONTENT = [
  'button',
  '.isl-wlabel',
  '.isl-wr > *',
  '.isl-nowbar-text > *',
  '.isl-scout-wrap svg',
  '.isl-pbadge',
  '.isl-view',
].join(', ');

export async function underNotch(page: Page): Promise<string[]> {
  await settled(page);
  return page.evaluate(
    ({ selector, notch }) => {
      const hits: string[] = [];
      for (const element of document.querySelectorAll<HTMLElement>(`.isl-root :is(${selector})`)) {
        const style = getComputedStyle(element);
        if (style.visibility === 'hidden' || style.pointerEvents === 'none') {
          if (element.matches('button')) continue;
        }
        if (element.closest('[disabled]')) continue;
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0 || !element.textContent?.trim()) {
          if (!element.matches('button, svg')) continue;
        }
        const overlaps =
          rect.left < notch.right &&
          notch.left < rect.right &&
          rect.top < notch.bottom &&
          notch.top < rect.bottom;
        if (overlaps) hits.push(`${element.tagName}.${element.className} @ ${rect.x},${rect.y}`);
      }
      return hits;
    },
    { selector: CONTENT, notch: notchBox() },
  );
}

export const focusCalls = (page: Page) =>
  page.evaluate(() => (window as unknown as NotchWindow).islandFocus);

export const restSize = (page: Page) =>
  page.evaluate(() => (window as unknown as NotchWindow).islandRest.at(-1) ?? null);

export const shownText = (page: Page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('.isl *, .isl-peekrow-wrap *'))
      .filter((element) =>
        element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }),
      )
      .flatMap((element) => Array.from(element.childNodes))
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent?.trim() ?? '')
      .filter(Boolean)
      .join(' '),
  );

export const sparkFocus = (page: Page, focused: boolean) =>
  page.evaluate((next) => (window as unknown as NotchWindow).sparkFocus(next), focused);

export const command = (page: Page, action: 'quick' | 'sessions') =>
  page.evaluate((next) => (window as unknown as NotchWindow).islandCommand(next), action);

export const dragPhases = (page: Page) =>
  page.evaluate(() => (window as unknown as NotchWindow).islandDrags);

export interface ScoutLook {
  top: number;
  bottom: number;
  size: number;
  hidden: number;
  tucked: boolean;
  eyesTop: number;
}

export const scoutLook = (page: Page): Promise<ScoutLook> =>
  island(page).evaluate((root) => {
    const wrap = root.querySelector<HTMLElement>('.isl-scout-wrap')!;
    const box = wrap.getBoundingClientRect();
    const clip = /inset\(([\d.]+)px/.exec(
      getComputedStyle(wrap.querySelector('svg.scout')!).clipPath,
    );
    const eyes = Array.from(wrap.querySelectorAll('.sc-eye'), (eye) => eye.getBoundingClientRect());
    return {
      top: box.top,
      bottom: box.bottom,
      size: box.height,
      hidden: Math.max(clip ? Number(clip[1]) : 0, -box.top, 0),
      tucked: root.classList.contains('tucked'),
      eyesTop: Math.min(...eyes.map((eye) => eye.top)),
    };
  });
