import { useCallback, useState } from 'react';
import { usePhone } from '../ui/breakpoints.ts';
import type { OverviewTab } from './OverviewPane.tsx';
import { postAnchor } from './post-text.ts';
import { threadRowId } from './ThreadsTab.tsx';

export type PhoneView = 'conversation' | 'overview';

const OVERVIEW_KEY = 'spark-outpost.outpost-overview';

function savedOverview(): boolean {
  try {
    return localStorage.getItem(OVERVIEW_KEY) !== 'hidden';
  } catch {
    return true;
  }
}

function saveOverview(open: boolean): void {
  try {
    localStorage.setItem(OVERVIEW_KEY, open ? 'shown' : 'hidden');
  } catch {
    return;
  }
}

function focusAfterBack(postId: string): void {
  requestAnimationFrame(() => {
    const row = document.getElementById(threadRowId(postId));
    if (row) {
      row.focus();
      return;
    }
    document
      .getElementById(postAnchor(postId))
      ?.querySelector<HTMLElement>('button[aria-expanded]')
      ?.focus();
  });
}

export function useOutpostLayout() {
  const phone = usePhone();
  const [overviewOpen, setOverviewOpen] = useState(savedOverview);
  const [tab, setTab] = useState<OverviewTab>('threads');
  const [threadId, setThreadId] = useState<string | null>(null);
  const [phoneView, setPhoneView] = useState<PhoneView>('conversation');

  const toggleOverview = useCallback(() => {
    if (threadId) {
      setThreadId(null);
      setOverviewOpen(true);
      saveOverview(true);
      return;
    }
    setOverviewOpen((open) => {
      saveOverview(!open);
      return !open;
    });
  }, [threadId]);

  const openThread = useCallback((postId: string) => setThreadId(postId), []);

  const backToOverview = useCallback(() => {
    if (threadId) focusAfterBack(threadId);
    setThreadId(null);
    setOverviewOpen(true);
    setTab('threads');
    setPhoneView('overview');
  }, [threadId]);

  const showConversation = useCallback(() => {
    setThreadId(null);
    setPhoneView('conversation');
  }, []);

  return {
    phone,
    overviewOpen,
    tab,
    setTab,
    threadId,
    phoneView,
    setPhoneView,
    toggleOverview,
    openThread,
    backToOverview,
    showConversation,
  };
}
