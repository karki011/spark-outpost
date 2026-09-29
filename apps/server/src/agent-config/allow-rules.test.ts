import { describe, expect, it } from 'vitest';
import { allowlistCovers } from '../approvals/commands.ts';
import { appliedAllowRules, classifyAllowRule, commandAllowlistFromRules } from './allow-rules.ts';

describe('repo allow rules against the safety floor', () => {
  it.each([
    'Bash(npm test:*)',
    'Bash(npm run lint)',
    'Bash(pnpm vitest run *)',
    'Bash(git status:*)',
    'Bash(git diff)',
    'Read(src/**)',
    'Read(**)',
    'Read(.env.example)',
    'Edit(src/**/*.ts)',
    'WebFetch(domain:docs.example.com)',
    'mcp__echo',
  ])('applies %s', (rule) => {
    expect(classifyAllowRule(rule)).toEqual({ rule, applied: true, reason: null });
  });

  it.each([
    ['Bash', 'Allows every command'],
    ['Bash(*)', 'Allows every command'],
    ['Bash(:*)', 'Allows every command'],
    ['Edit', 'Allows every Edit call'],
    ['Write(*)', 'Allows every Write call'],
    ['Bash(git push:*)', 'Could push code or change remotes'],
    ['Bash(git push origin main)', 'Could push code or change remotes'],
    ['Bash(git:*)', 'Could push code or change remotes'],
    ['Bash(git remote:*)', 'Could push code or change remotes'],
    ['Bash(git remote set-url origin x)', 'Could push code or change remotes'],
    ['Bash(gh pr create:*)', 'Could push code or change remotes'],
    ['Bash(hub:*)', 'Could push code or change remotes'],
    ['Bash(glab mr create)', 'Could push code or change remotes'],
    ['Bash(bash -c:*)', 'Can run any command'],
    ['Bash(sudo npm:*)', 'Can run any command'],
    ['Bash(timeout:*)', 'Can run any command'],
    ['Bash(nice:*)', 'Can run any command'],
    ['Bash(npm test && git push)', 'Chains or redirects commands'],
    ['Bash(git * main)', 'Has a wildcard in the middle'],
    ['Read(.env)', 'Could read secret files'],
    ['Read(**/.env*)', 'Could read secret files'],
    ['Read(~/.ssh/id_rsa)', 'Could read secret files'],
    ['Read(certs/*.pem)', 'Could read secret files'],
    ['Edit(/etc/hosts)', 'Writes outside the project'],
    ['Write(../other/file.ts)', 'Writes outside the project'],
    ['Edit(.env.local)', 'Could change secret files'],
    ['not a rule(', 'Not a rule Spark Outpost understands'],
  ])('drops %s: %s', (rule, reason) => {
    expect(classifyAllowRule(rule)).toEqual({ rule, applied: false, reason });
  });

  it('keeps only applied rules, once each', () => {
    expect(
      appliedAllowRules(['Bash(npm test:*)', 'Bash', 'Bash(npm test:*)', 'Read(.env)']),
    ).toEqual(['Bash(npm test:*)']);
  });
});

describe('command allowlist from allow rules', () => {
  it('turns applied Bash rules into allowlist prefixes and skips everything else', () => {
    const allowlist = commandAllowlistFromRules([
      'Bash(npm test:*)',
      'Bash(npm run lint)',
      'Bash(pnpm vitest run *)',
      'Bash(git push:*)',
      'Bash(*)',
      'Edit(src/**)',
      'WebFetch(domain:docs.example.com)',
      'Bash(npm test)',
    ]);
    expect(allowlist).toEqual(['npm test', 'npm run lint', 'pnpm vitest run']);
    expect(allowlistCovers(allowlist, 'npm test -- --watch=false')).toBe(true);
    expect(allowlistCovers(allowlist, 'npm test && git push')).toBe(false);
    expect(allowlistCovers(allowlist, 'git push')).toBe(false);
  });
});
