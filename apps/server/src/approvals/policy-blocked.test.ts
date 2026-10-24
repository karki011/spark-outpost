import { describe, expect, it } from 'vitest';
import { blockedNote, policyDenial, shortCommand } from './policy-blocked.ts';

const LONG_REASON =
  "this chat's message didn't ask to open a pull request, and the chat isn't at Full auto → PR";

describe('blockedNote', () => {
  it('names what was refused and the whole reason', () => {
    expect(blockedNote('`gh pr create`', LONG_REASON)).toBe(
      `Refused \`gh pr create\` — ${LONG_REASON}`,
    );
  });

  it('names the Spark rule instead of the reason when one is given', () => {
    expect(blockedNote('`gh pr create`', LONG_REASON, 'PullRequest')).toBe(
      'Refused `gh pr create` — Spark rules: PullRequest',
    );
  });
});

describe('policyDenial', () => {
  it('tells the agent the full command and reason', () => {
    const denial = policyDenial('`gh pr create --title "Fix" --body "Long body"`', LONG_REASON);
    expect(denial).toContain('gh pr create --title "Fix" --body "Long body"');
    expect(denial).toContain(LONG_REASON);
    expect(denial).toContain("not the user's choice");
  });
});

describe('shortCommand', () => {
  it('keeps a short command whole', () => {
    expect(shortCommand("sed -n '1,40p'   apps/server/x.ts")).toBe(
      "sed -n '1,40p' apps/server/x.ts",
    );
  });

  it('keeps the program and its subcommand for a long command', () => {
    const command = 'gh pr create --title "Fix the step line" --body "A long body that goes on"';
    expect(shortCommand(command)).toBe('gh pr create');
  });

  it('skips a change of folder and leading variables', () => {
    expect(shortCommand('cd apps/web && GH_PAGER= gh pr edit 12 --body "a much longer body"')).toBe(
      'gh pr edit',
    );
  });

  it('drops a path to the program', () => {
    expect(shortCommand('/usr/local/bin/git push origin spark/very-long-branch-name-here')).toBe(
      'git push origin',
    );
  });
});
