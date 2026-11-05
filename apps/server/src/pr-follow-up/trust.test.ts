import { describe, expect, it } from 'vitest';
import { restConnection } from '../ship/github/connection.ts';
import { canWrite, isTrusted, writersAmong } from './trust.ts';

describe('trust filter', () => {
  it('counts write, maintain and admin as write access', () => {
    expect(canWrite({ permission: 'write' })).toBe(true);
    expect(canWrite({ permission: 'admin' })).toBe(true);
    expect(canWrite({ permission: 'read', role_name: 'maintain' })).toBe(true);
    expect(canWrite({ permission: 'read', role_name: 'triage' })).toBe(false);
    expect(canWrite(null)).toBe(false);
  });

  it('trusts failing checks from the PR’s own CI and only writers’ comments', () => {
    const writers = new Set(['alice']);
    expect(isTrusted({ kind: 'check', author: 'github-actions' }, writers)).toBe(true);
    expect(isTrusted({ kind: 'review_comment', author: 'Alice' }, writers)).toBe(true);
    expect(isTrusted({ kind: 'issue_comment', author: 'mallory' }, writers)).toBe(false);
  });

  it('asks GitHub once per human author, never for bots, and distrusts failed lookups', async () => {
    const asked: string[] = [];
    const connection = restConnection('token', 'github.com', async (_method, path) => {
      asked.push(path);
      if (path.includes('/alice/'))
        return { status: 200, data: { permission: 'write' }, header: () => null };
      if (path.includes('/bob/')) return { status: 500, data: {}, header: () => null };
      return { status: 200, data: { permission: 'read' }, header: () => null };
    });
    const writers = await writersAmong(connection, { owner: 'acme', name: 'widgets' }, [
      'alice',
      'alice',
      'bob',
      'mallory',
      'coderabbitai[bot]',
    ]);
    expect([...writers]).toEqual(['alice']);
    expect(asked).toHaveLength(3);
    expect(asked.some((path) => path.includes('coderabbitai'))).toBe(false);
  });
});
