import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loginShellSpawner } from './pty.ts';
import { pullRequestScan, type TerminalPullRequest } from './pull-request-scan.ts';
import { defaultLimits, TerminalSessions } from './sessions.ts';
import { shellWatchers } from './shell-watchers.ts';

const URL = 'https://github.com/acme/widgets/pull/2198';
const OPENED = new Date('2026-10-05T10:00:00Z');

function scanFor(conversationId: string | null = 'chat-a') {
  const found: TerminalPullRequest[] = [];
  const scan = pullRequestScan(
    (sighting) => found.push(sighting),
    () => OPENED,
  );
  scan.opened({ id: 'shell-1', conversationId, label: 'app', cwd: '/tmp', pid: 1 });
  return { found, scan };
}

describe('scanning a chat terminal for pull requests', () => {
  it('reports a pull request link once, with the chat and when its tab opened', () => {
    const { found, scan } = scanFor();
    scan.output('shell-1', `Creating pull request for spark/x into main\r\n${URL}\r\n`);
    scan.output('shell-1', `${URL}\r\n`);
    expect(found).toEqual([{ conversationId: 'chat-a', url: URL, shellOpenedAt: OPENED }]);
  });

  it('reads a link that arrives in pieces and through colour codes', () => {
    const { found, scan } = scanFor();
    scan.output('shell-1', '\u001b[32mhttps://github.com/acme/wid');
    scan.output('shell-1', 'gets/pull/21');
    expect(found).toEqual([]);
    scan.output('shell-1', '98\u001b[0m\r\n$ ');
    expect(found.map((sighting) => sighting.url)).toEqual([URL]);
  });

  it('ignores terminals that belong to no chat and output after the tab closed', () => {
    const none = scanFor(null);
    none.scan.output('shell-1', `${URL}\n`);
    expect(none.found).toEqual([]);

    const closed = scanFor();
    closed.scan.ended('shell-1');
    closed.scan.output('shell-1', `${URL}\n`);
    expect(closed.found).toEqual([]);
  });

  it('ignores links that are not pull requests', () => {
    const { found, scan } = scanFor();
    scan.output('shell-1', 'https://github.com/acme/widgets/pull/new/spark/x\n');
    scan.output('shell-1', 'https://github.com/acme/widgets/issues/4\n');
    expect(found).toEqual([]);
  });
});

describe('a chat shell', () => {
  let sessions: TerminalSessions | null = null;
  let folder = '';

  afterEach(() => {
    sessions?.killAll();
    rmSync(folder, { recursive: true, force: true });
  });

  it('hands what a tool prints in the tab to the scan', async () => {
    folder = realpathSync(mkdtempSync(path.join(tmpdir(), 'spark-shell-scan-')));
    const found: TerminalPullRequest[] = [];
    const ended: string[] = [];
    sessions = new TerminalSessions(
      loginShellSpawner('/bin/sh'),
      defaultLimits,
      shellWatchers(
        { opened: () => undefined, ended: (id) => ended.push(id) },
        pullRequestScan((sighting) => found.push(sighting)),
      ),
    );
    const created = sessions.createShell({ cwd: folder, conversationId: 'chat-a' });
    const client = { output: () => undefined, send: () => undefined, close: () => undefined };
    const terminal = sessions.attach(created.id, created.token, client, { cols: 200, rows: 24 });
    terminal.input('printf "%s/pull/%s\\n" https://github.com/acme/widgets 2198\r');
    const deadline = Date.now() + 8000;
    while (found.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(found.map((sighting) => sighting.url)).toEqual([URL]);
    expect(found[0]!.conversationId).toBe('chat-a');
    terminal.close();
    expect(ended).toEqual([created.id]);
  }, 15_000);
});
