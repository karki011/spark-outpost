import { describe, expect, it } from 'vitest';
import { stepActivity } from './step-activity.ts';

const line = (name: string) => {
  const activity = stepActivity(name);
  return activity.target ? `${activity.verb} · ${activity.target}` : activity.verb;
};

describe('live step lines', () => {
  it('turns agent tool titles into a verb and a short target', () => {
    expect(line("`git grep -l -i 'AI_USER' -- apps/web/src packages/contracts`")).toBe(
      "Running · git grep -l -i 'AI_USER' -- apps/web/src …",
    );
    expect(line('Edit `monitors-table.tsx`')).toBe('Editing · monitors-table.tsx');
    expect(line('Read /Users/ada/work/app/src/types.ts:12')).toBe('Reading · types.ts');
    expect(line('Write `src/lib/a.ts`')).toBe('Editing · a.ts');
    expect(line('Thinking')).toBe('Thinking…');
    expect(line('grep "invoice" src/lib')).toBe('Searching · "invoice" src/lib');
  });

  it('marks commands as code and keeps the full text for the tooltip', () => {
    const activity = stepActivity('`pnpm lint && pnpm test`');
    expect(activity).toMatchObject({ kind: 'run', target: 'pnpm lint …', code: true });
    expect(activity.full).toBe('pnpm lint && pnpm test');
    expect(stepActivity('Run `pnpm test`')).toMatchObject({ verb: 'Running', target: 'pnpm test' });
  });

  it('keeps plain sentences as they are', () => {
    expect(line('Reading your message')).toBe('Reading your message');
    expect(line('Writing a reply')).toBe('Writing a reply');
    expect(line('Compacting the chat')).toBe('Compacting the chat');
  });

  it('never shows a secret', () => {
    const activity = stepActivity('`GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123 gh pr list`');
    expect(activity.target).toBe('gh pr list');
    expect(activity.full).not.toContain('ghp_');
    expect(line('Read sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789')).not.toContain('sk-ant');
  });
});
