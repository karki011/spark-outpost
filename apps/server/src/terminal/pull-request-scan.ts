import { findPullRequests } from '../tasks/pr-links.ts';
import { stripAnsi } from './hints.ts';
import type { ShellWatcher } from './sessions.ts';

export interface TerminalPullRequest {
  conversationId: string;
  url: string;
  shellOpenedAt: Date;
}

interface ScannedShell {
  conversationId: string;
  openedAt: Date;
  carry: string;
  seen: Set<string>;
}

const MAX_CARRY = 400;
const MAX_SEEN = 50;
const MARKER = '/pull/';
const BREAK = /\s(?=\S*$)/;

function settledText(text: string): string {
  const lastBreak = text.search(BREAK);
  return lastBreak < 0 ? '' : text.slice(0, lastBreak + 1);
}

export function pullRequestScan(
  found: (sighting: TerminalPullRequest) => void,
  now: () => Date = () => new Date(),
): Required<ShellWatcher> {
  const shells = new Map<string, ScannedShell>();
  return {
    opened(shell) {
      if (!shell.conversationId) return;
      shells.set(shell.id, {
        conversationId: shell.conversationId,
        openedAt: now(),
        carry: '',
        seen: new Set(),
      });
    },
    output(id, data) {
      const shell = shells.get(id);
      if (!shell) return;
      const raw = shell.carry + data;
      shell.carry = raw.slice(-MAX_CARRY);
      if (!raw.includes(MARKER)) return;
      for (const { url } of findPullRequests(settledText(stripAnsi(raw)))) {
        if (shell.seen.has(url) || shell.seen.size >= MAX_SEEN) continue;
        shell.seen.add(url);
        found({ conversationId: shell.conversationId, url, shellOpenedAt: shell.openedAt });
      }
    },
    ended(id) {
      shells.delete(id);
    },
  };
}
