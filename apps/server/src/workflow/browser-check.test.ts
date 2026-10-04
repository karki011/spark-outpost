import { describe, expect, it } from 'vitest';
import { BROWSER_CHECK_LINE, withBrowserCheck, type BrowserCheckTurn } from './browser-check.ts';

const turn = (change: Partial<BrowserCheckTurn> = {}): BrowserCheckTurn => ({
  prompt: 'Role: Builder.\n\n## Request\nMake the Save button wider',
  userRequest: 'Make the Save button wider',
  editsFiles: true,
  browserPane: true,
  ...change,
});

describe('the browser check line in an agent brief', () => {
  it('is added once to a brief for interface work when the session has the Browser pane', () => {
    const brief = withBrowserCheck(turn());
    expect(brief.endsWith(BROWSER_CHECK_LINE)).toBe(true);
    expect(brief.startsWith(turn().prompt)).toBe(true);
    expect(BROWSER_CHECK_LINE).toContain('suggestion, not a requirement');
    expect(BROWSER_CHECK_LINE).toContain('spark_browser_open');
  });

  it('is added when the likely files are interface files, whatever the request says', () => {
    const prompt =
      'Role: Builder.\n\n## Request\nFix the retry count\n\nLikely files (a ranking hint, not a limit): apps/web/src/chat/Composer.tsx (0.81), apps/server/src/queue.ts (0.40)';
    expect(withBrowserCheck(turn({ prompt, userRequest: 'Fix the retry count' }))).toContain(
      BROWSER_CHECK_LINE,
    );
  });

  it('is left out without the Browser pane, for a turn that does not edit, and for other work', () => {
    expect(withBrowserCheck(turn({ browserPane: false }))).toBe(turn().prompt);
    expect(withBrowserCheck(turn({ editsFiles: false }))).toBe(turn().prompt);
    const backend = turn({
      prompt: 'Role: Builder.\n\n## Request\nFix the retry count in apps/server/src/queue.ts',
      userRequest: 'Fix the retry count in apps/server/src/queue.ts',
    });
    expect(withBrowserCheck(backend)).toBe(backend.prompt);
  });
});
