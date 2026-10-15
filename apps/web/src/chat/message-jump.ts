import { useEffect, useSyncExternalStore, type RefObject } from 'react';
import type { SearchMatch } from '@spark-outpost/contracts';
import { turnAnchor } from './outline/outline-model.ts';

const JUMP_EXPIRES_MS = 10_000;

interface PendingJump {
  conversationId: string;
  match: SearchMatch;
  at: number;
}

let pending: PendingJump | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): PendingJump | null {
  return pending;
}

export function requestMessageJump(conversationId: string, match: SearchMatch): void {
  pending = { conversationId, match, at: Date.now() };
  listeners.forEach((listener) => listener());
}

function jumpTarget(root: HTMLElement, match: SearchMatch): HTMLElement | null {
  const id = CSS.escape(match.messageId);
  const user = root.querySelector<HTMLElement>(`[data-message-id="${id}"] .bubble`);
  if (user) return user;
  const turn = root.querySelector<HTMLElement>(`[data-assistant-message-id="${id}"]`);
  if (turn) return turn.querySelector<HTMLElement>('.md') ?? turn;
  return match.runId ? document.getElementById(turnAnchor(match.runId)) : null;
}

function takeJump(jump: PendingJump, root: HTMLElement): HTMLElement | null {
  if (Date.now() - jump.at > JUMP_EXPIRES_MS) {
    pending = null;
    return null;
  }
  const target = jumpTarget(root, jump.match);
  if (target) pending = null;
  return target;
}

export function useMessageJump(
  conversationId: string,
  scroller: RefObject<HTMLDivElement | null>,
  release: () => void,
  revision: unknown,
): void {
  const jump = useSyncExternalStore(subscribe, snapshot);
  useEffect(() => {
    const root = scroller.current;
    if (!jump || jump.conversationId !== conversationId || !root) return;
    const target = takeJump(jump, root);
    if (!target) return;
    release();
    target.scrollIntoView({ block: 'center' });
    target.classList.remove('flash');
    void target.offsetWidth;
    target.classList.add('flash');
  }, [jump, conversationId, scroller, release, revision]);
}
