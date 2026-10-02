import { describe, expect, it } from 'vitest';
import { clipText, clockText, commandFull, commandSummary, hideSecrets } from './status-text.ts';

describe('command summary', () => {
  it('keeps a short command whole', () => {
    expect(commandSummary('pnpm test')).toBe('pnpm test');
    expect(commandSummary("  git grep -l -i 'AI_USER'  ")).toBe("git grep -l -i 'AI_USER'");
  });

  it('cuts long commands at a word and marks the cut', () => {
    expect(commandSummary("git grep -l -i 'AI_USER' -- apps/web/src packages", 28)).toBe(
      "git grep -l -i 'AI_USER' …",
    );
    expect(commandSummary('git grep -l -i AI_USER', 12)).toBe('git grep -l …');
  });

  it('cuts a single long word hard', () => {
    expect(commandSummary('a'.repeat(60), 10)).toBe(`${'a'.repeat(10)} …`);
  });

  it('shows the first meaningful part of a chain', () => {
    expect(commandSummary('pnpm lint && pnpm test')).toBe('pnpm lint …');
    expect(commandSummary('cd apps/web && pnpm vitest run')).toBe('pnpm vitest run');
    expect(commandSummary('cd apps/web && pnpm build | tee out.log')).toBe('pnpm build …');
    expect(commandSummary('cat a.txt; echo done')).toBe('cat a.txt …');
    expect(commandSummary('pnpm test\npnpm lint')).toBe('pnpm test …');
  });

  it('does not split inside quotes', () => {
    expect(commandSummary(`git commit -m "fix: a && b"`)).toBe('git commit -m "fix: a && b"');
    expect(commandSummary(`grep -E 'a|b' src`)).toBe(`grep -E 'a|b' src`);
  });

  it('drops leading environment assignments, secret or not', () => {
    expect(commandSummary('NODE_ENV=test pnpm vitest')).toBe('pnpm vitest');
    expect(commandSummary('GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123 gh pr list')).toBe(
      'gh pr list',
    );
  });

  it('never shows secrets', () => {
    const shown = commandSummary(
      'curl -H "Authorization: Bearer abcdef1234567890" https://api.example.com',
      80,
    );
    expect(shown).not.toContain('abcdef1234567890');
    expect(shown).toContain('•••');
    expect(commandSummary('deploy --token s3cr3t-value-123 --env prod', 80)).toBe(
      'deploy --token ••• --env prod',
    );
    expect(commandSummary('psql postgres://ada:hunter2pass@db.local/app')).not.toContain(
      'hunter2pass',
    );
  });
});

describe('hiding secrets', () => {
  it('masks inline sensitive assignments and known token shapes', () => {
    expect(hideSecrets('cd x && API_KEY=abc123 node run.js')).toBe(
      'cd x && API_KEY=••• node run.js',
    );
    expect(hideSecrets('NODE_ENV=production node run.js')).toBe('NODE_ENV=production node run.js');
    expect(hideSecrets('echo sk-ant-api03-abcdefghijklmnopqrstuvwxyz')).toBe('echo •••');
    expect(hideSecrets('login --password=hunter2')).toBe('login --password=•••');
    expect(hideSecrets('GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123 gh pr list')).toBe(
      'GITHUB_TOKEN=••• gh pr list',
    );
  });

  it('keeps the full text otherwise, for the tooltip', () => {
    expect(commandFull('  pnpm lint && pnpm test  ')).toBe('pnpm lint && pnpm test');
  });
});

describe('short text', () => {
  it('clips phrases on a word', () => {
    expect(clipText('Which report do you mean: Spend or Usage?', 20)).toBe('Which report do you …');
    expect(clipText('Which repo?', 20)).toBe('Which repo?');
  });

  it('reads elapsed time like a clock', () => {
    expect(clockText(4_200)).toBe('4s');
    expect(clockText(134_000)).toBe('2m 14s');
    expect(clockText(3_780_000)).toBe('1h 3m');
  });
});
