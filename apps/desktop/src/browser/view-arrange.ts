import type { Input, WebContents } from 'electron';
import {
  clampSplitRatio,
  splitHolds,
  type BrowserBounds,
  type BrowserPaneTab,
  type BrowserProfile,
  type BrowserViewCommand,
  type BrowserViewSlot,
  type BrowserViewSplit,
} from '@spark-outpost/contracts';
import { OptionKey, type LinkGesture } from './link-gesture.ts';
import type { BrowserPanes } from './panes.ts';
import type { PaneTab } from './tab.ts';
import {
  splitAlive,
  splitForLink,
  splitFromMarks,
  splitMark,
  splitOf,
  splitSurvivor,
  type SplitMark,
} from './view-split.ts';

const BLANK = 'about:blank';

interface Slot {
  bounds: BrowserBounds;
  covered: boolean;
}

interface Arrangement {
  split: BrowserViewSplit | null;
  showing: boolean;
  peek: { tabId: string; openerId: string } | null;
  slots: Map<string, Slot>;
}

export type ArrangeCommand = Extract<
  BrowserViewCommand,
  { command: 'split_with' | 'split_leave' | 'split_ratio' | 'peek_close' | 'peek_promote' }
>;

const ARRANGE_COMMANDS: ReadonlySet<string> = new Set([
  'split_with',
  'split_leave',
  'split_ratio',
  'peek_close',
  'peek_promote',
]);

export function isArrangeCommand(action: BrowserViewCommand): action is ArrangeCommand {
  return ARRANGE_COMMANDS.has(action.command);
}

export interface ArrangeOptions {
  panes(): BrowserPanes;
  snapshot(profile: BrowserProfile, tabId: string, image: string | null): void;
  log(line: string): void;
}

export function startViewArrange(options: ArrangeOptions) {
  const arrangements = new Map<string, Arrangement>();
  const option = new OptionKey();
  let watchedChrome: WebContents | null = null;
  const of = (profile: string): Arrangement => {
    let arrangement = arrangements.get(profile);
    if (!arrangement) {
      arrangement = { split: null, showing: false, peek: null, slots: new Map() };
      arrangements.set(profile, arrangement);
    }
    return arrangement;
  };
  const listed = (profile: string) =>
    options
      .panes()
      .tabsOf(profile)
      .filter((tab) => !tab.peek);
  const activeId = (profile: string) => listed(profile).find((tab) => tab.active)?.id ?? null;
  const focusShowing = (profile: string) => {
    listed(profile)
      .find((tab) => tab.active)
      ?.contents()
      ?.focus();
  };
  const problem = (error: Error) => options.log(`A Browser view page failed: ${error.message}`);

  const closePeek = (profile: string) => {
    const arrangement = of(profile);
    const peek = arrangement.peek;
    if (!peek) return;
    arrangement.peek = null;
    arrangement.slots.delete(peek.tabId);
    options.panes().close(profile, peek.tabId);
    focusShowing(profile);
  };

  const promotePeek = (profile: string) => {
    const arrangement = of(profile);
    const peek = arrangement.peek;
    const tab = peek && options.panes().tab(profile, peek.tabId);
    if (!peek || !tab) return;
    arrangement.peek = null;
    arrangement.slots.delete(peek.tabId);
    tab.peek = false;
    options.panes().select(profile, tab.id);
    tab.contents()?.focus();
  };

  const openPeek = (opener: PaneTab, url: string): boolean => {
    const profile = opener.chatId;
    const arrangement = of(profile);
    const current = arrangement.peek && options.panes().tab(profile, arrangement.peek.tabId);
    if (current && opener.peek) {
      void current.load(url).catch(problem);
      return true;
    }
    closePeek(profile);
    const tab = options
      .panes()
      .createTab(profile, { owner: 'user', runId: null, url: BLANK, peek: true });
    if (!tab) return false;
    arrangement.peek = { tabId: tab.id, openerId: opener.id };
    options.panes().noteChange(profile);
    void tab
      .load(url)
      .then(() => {
        tab.contents()?.focus();
        options.panes().layout();
      })
      .catch(problem);
    return true;
  };

  const openSplit = (opener: PaneTab, url: string): boolean => {
    const profile = opener.chatId;
    const arrangement = of(profile);
    const left = opener.peek ? arrangement.peek?.openerId : opener.id;
    const tab = options.panes().createTab(profile, { owner: 'user', runId: null, url: BLANK });
    if (!left || !tab) return false;
    arrangement.split = splitForLink(arrangement.split, left, tab.id);
    closePeek(profile);
    options.panes().select(profile, tab.id);
    void tab
      .load(url)
      .then(() => {
        tab.contents()?.focus();
        options.panes().layout();
      })
      .catch(problem);
    return true;
  };

  const splitWith = (profile: string, otherId: string | null) => {
    const arrangement = of(profile);
    const left = activeId(profile);
    if (!left) return;
    const other = otherId ? listed(profile).find((tab) => tab.id === otherId) : null;
    if (otherId && !other) return;
    const right =
      other ?? options.panes().createTab(profile, { owner: 'user', runId: null, url: BLANK });
    if (!right) return;
    arrangement.split = splitOf(left, right.id, arrangement.split?.ratio);
    if (!other) options.panes().select(profile, right.id);
    options.panes().noteChange(profile);
  };

  const held = (arrangement: Arrangement, tabId: string) =>
    arrangement.peek?.tabId === tabId || splitHolds(arrangement.split, tabId);

  return {
    state(profile: string): { split: BrowserViewSplit | null; peek: BrowserPaneTab | null } {
      const arrangement = of(profile);
      const peekId = arrangement.peek?.tabId;
      const peek = peekId ? options.panes().tab(profile, peekId) : null;
      return { split: arrangement.split, peek: peek?.paneTab() ?? null };
    },

    command(profile: string, action: ArrangeCommand): void {
      const arrangement = of(profile);
      if (action.command === 'split_with') splitWith(profile, action.tabId);
      else if (action.command === 'peek_close') closePeek(profile);
      else if (action.command === 'peek_promote') promotePeek(profile);
      else if (action.command === 'split_leave') {
        arrangement.split = null;
        options.panes().noteChange(profile);
      } else if (arrangement.split) {
        arrangement.split = { ...arrangement.split, ratio: clampSplitRatio(action.ratio) };
        options.panes().noteChange(profile);
      }
    },

    openLink(opener: PaneTab, url: string, gesture: LinkGesture): boolean {
      return gesture === 'peek' ? openPeek(opener, url) : openSplit(opener, url);
    },

    shiftedLink(opener: PaneTab, url: string): boolean {
      return option.held(Date.now()) ? openSplit(opener, url) : openPeek(opener, url);
    },

    watchChrome(contents: WebContents | null): void {
      if (!contents || contents === watchedChrome) return;
      watchedChrome = contents;
      contents.on('before-input-event', (_event, input) => option.note(input, Date.now()));
    },

    async placeSlot(slot: BrowserViewSlot): Promise<void> {
      const arrangement = of(slot.profile);
      const tab = options.panes().tab(slot.profile, slot.tabId);
      if (!tab || !held(arrangement, tab.id)) return;
      const before = arrangement.slots.get(tab.id);
      if (slot.bounds && slot.covered && !before?.covered) {
        const image = await options
          .panes()
          .capture(tab)
          .catch(() => null);
        if (image) options.snapshot(slot.profile, tab.id, image);
      }
      if (slot.bounds) {
        arrangement.slots.set(tab.id, { bounds: slot.bounds, covered: slot.covered });
      } else arrangement.slots.delete(tab.id);
      if (slot.bounds && !tab.view() && tab.currentUrl() !== BLANK) await tab.wake();
      options.panes().layout();
      if (before?.covered && !slot.covered) options.snapshot(slot.profile, tab.id, null);
    },

    slotBounds(tab: PaneTab): BrowserBounds | null | undefined {
      const arrangement = of(tab.chatId);
      const slot = arrangement.slots.get(tab.id);
      const shownBounds = slot && !slot.covered ? slot.bounds : null;
      if (arrangement.peek?.tabId === tab.id) return shownBounds;
      if (!arrangement.showing || !splitHolds(arrangement.split, tab.id)) return undefined;
      return slot || !tab.active ? shownBounds : undefined;
    },

    tabUsed(tab: PaneTab): void {
      const arrangement = of(tab.chatId);
      if (tab.peek || tab.active || !arrangement.showing) return;
      if (splitHolds(arrangement.split, tab.id)) options.panes().select(tab.chatId, tab.id);
    },

    pageKey(tab: PaneTab, input: Input): boolean {
      option.note(input, Date.now());
      if (input.type !== 'keyDown' || input.key !== 'Escape' || input.isComposing) return false;
      if (!of(tab.chatId).peek) return false;
      closePeek(tab.chatId);
      return true;
    },

    isPeek(profile: string, tabId: string): boolean {
      return of(profile).peek?.tabId === tabId;
    },

    settle(profile: string): void {
      const arrangement = of(profile);
      const liveIds = listed(profile).map((tab) => tab.id);
      if (arrangement.split && !splitAlive(arrangement.split, liveIds)) {
        const survivor = splitSurvivor(arrangement.split, liveIds);
        const wasShowing = arrangement.showing;
        arrangement.split = null;
        if (wasShowing && survivor) {
          options.panes().select(profile, survivor);
          focusShowing(profile);
        }
      }
      const active = activeId(profile);
      arrangement.showing = splitHolds(arrangement.split, active);
      const peek = arrangement.peek;
      if (peek && !options.panes().tab(profile, peek.tabId)) arrangement.peek = null;
      else if (peek && active !== peek.openerId) closePeek(profile);
      for (const tabId of arrangement.slots.keys()) {
        if (!held(arrangement, tabId)) arrangement.slots.delete(tabId);
      }
      options.panes().layout();
      options.panes().wakeShowing(profile);
    },

    mark(profile: string, tabId: string): SplitMark | undefined {
      return splitMark(of(profile).split, tabId);
    },

    restore(profile: string, tabs: readonly { id: string; split?: SplitMark | undefined }[]): void {
      of(profile).split = splitFromMarks(tabs);
    },
  };
}
