import { describe, expect, it } from 'vitest';
import { anchorCount, ANCHOR_LIMITS, extractAnchors, identifiersText } from './anchors.ts';

const SHA = '9fceb02d0ae598e95dc970b74767f19372d61af8';

describe('extractAnchors', () => {
  it('finds pull requests and issues by number, phrase and link', () => {
    const anchors = extractAnchors([
      'Opened #41 and PR 1207; see https://github.com/acme/app/pull/388 and issue #7.',
    ]);
    expect(anchors.pr).toEqual(expect.arrayContaining(['#41', '#1207', '#388', '#7']));
  });

  it('finds short and full commit SHAs', () => {
    const anchors = extractAnchors([`Merged as 56cf70b5, parent ${SHA}.`]);
    expect(anchors.commit).toEqual([SHA, '56cf70b5']);
  });

  it('finds branches by prefix and from git checkout -b', () => {
    const anchors = extractAnchors([
      'Pushed spark/compaction-anchors. Then ran git checkout -b hotfix-login and fix/typo.',
    ]);
    expect(anchors.branch).toEqual(
      expect.arrayContaining(['spark/compaction-anchors', 'hotfix-login', 'fix/typo']),
    );
  });

  it('finds relative, home and absolute file paths', () => {
    const anchors = extractAnchors([
      'Edited apps/server/src/compaction/anchors.ts, ./scripts/run.sh, ~/notes/todo.md and /Users/me/app/package.json.',
    ]);
    expect(anchors.file).toEqual(
      expect.arrayContaining([
        'apps/server/src/compaction/anchors.ts',
        './scripts/run.sh',
        '~/notes/todo.md',
        '/Users/me/app/package.json',
      ]),
    );
  });

  it('finds ticket keys', () => {
    expect(extractAnchors(['Closes SPARK-142 and OPS-9.']).ticket).toEqual(['OPS-9', 'SPARK-142']);
  });

  it('finds error messages and cuts long ones', () => {
    const anchors = extractAnchors([
      `TypeError: Cannot read properties of undefined (reading 'id')\nENOENT: no such file or directory, open 'src/a.txt'\nerror TS2322: Type 'string' is not assignable\nfatal: not a git repository\nRangeError: ${'too many steps '.repeat(20)}`,
    ]);
    expect(anchors.error).toContain(
      "TypeError: Cannot read properties of undefined (reading 'id')",
    );
    expect(anchors.error).toContain("ENOENT: no such file or directory, open 'src/a.txt'");
    expect(anchors.error).toContain("error TS2322: Type 'string' is not assignable");
    expect(anchors.error).toContain('fatal: not a git repository');
    const long = anchors.error.find((line) => line.startsWith('RangeError'));
    expect(long?.length).toBe(121);
  });

  it('keeps only the error type when the message mentions a credential', () => {
    const anchors = extractAnchors([
      'TypeError: authentication failed for hunter2-value\nfatal: could not read Password for repo: correcthorse',
    ]);
    expect(anchors.error).toEqual(['fatal', 'TypeError']);
  });

  it('elides words in an error message that it cannot read as plain text', () => {
    const anchors = extractAnchors([
      'ConnectError: rejected q9X2-vLm8_Zr4pT by gateway at 10.0.0.12:8443 after 3 tries',
    ]);
    expect(anchors.error).toEqual(['ConnectError: rejected … by gateway at … after 3 tries']);
    expect(identifiersText(anchors)).not.toContain('q9X2');
  });

  it('finds links and drops their query strings', () => {
    const anchors = extractAnchors([
      'Docs at https://example.com/guide/setup?ref=abc. CI: https://github.com/acme/app/actions/runs/123).',
    ]);
    expect(anchors.url).toEqual([
      'https://github.com/acme/app/actions/runs/123',
      'https://example.com/guide/setup',
    ]);
  });

  it('keeps one copy of each anchor, newest first', () => {
    const anchors = extractAnchors(['#10 then #11', '#12', 'back to #10']);
    expect(anchors.pr).toEqual(['#10', '#12', '#11']);
  });

  it('keeps the most recent anchors when a kind is over its limit', () => {
    const texts = Array.from({ length: 30 }, (_, index) => `PR #${index + 1}`);
    const anchors = extractAnchors(texts, { limits: { ...ANCHOR_LIMITS, pr: 3 } });
    expect(anchors.pr).toEqual(['#30', '#29', '#28']);
  });

  it('never returns a value from a secret file', () => {
    const value = 'a1b2c3d4e5f60718293a4b5c';
    const anchors = extractAnchors([`Loaded ${value} from the config`], { secretValues: [value] });
    expect(anchors.commit).toEqual([]);
    expect(identifiersText(anchors)).not.toContain(value);
  });

  it('redacts tokens and keys in links and error lines', () => {
    const token = `ghp_${'A1b2C3d4E5f6G7h8I9j0'.repeat(2)}`;
    const anchors = extractAnchors([
      `Error: Bad credentials for ${token}`,
      `Fetched https://user:${token}@github.com/acme/app.git and https://api.example.com/v1?key=${token}`,
      `AuthError: rejected Authorization: Bearer ${token}`,
    ]);
    const text = identifiersText(anchors);
    expect(text).not.toContain(token);
    expect(text).not.toContain('user:');
    expect(anchors.url).toEqual(['https://api.example.com/v1']);
  });

  it('does not take version numbers, UUIDs, colours or hex words for commits', () => {
    const anchors = extractAnchors([
      'Bumped to 1.20.3 and 0.1.0-beta.19 on 20261016. Run 0e7d4c1a-55e8-46fd-a810-058d2591c3a9 used #a0b1c2 and the word deadbeef, facade, 1234567890.',
    ]);
    expect(anchors.commit).toEqual([]);
  });

  it('does not take encodings, standards or version labels for tickets', () => {
    const anchors = extractAnchors([
      'Use UTF-8, SHA-256, ISO-8601, RFC-7231, GPT-4 and CVE-2024-3094.',
    ]);
    expect(anchors.ticket).toEqual([]);
  });

  it('does not take colours, HTML entities or headings for pull requests', () => {
    const anchors = extractAnchors(['Colour #fff, quote &#39;, heading # Notes, item#3']);
    expect(anchors.pr).toEqual([]);
  });

  it('does not take folders or file paths for branches', () => {
    const anchors = extractAnchors([
      'See docs/guide/compaction.md and apps/web/src/spark/Chat.tsx',
    ]);
    expect(anchors.branch).toEqual([]);
  });

  it('does not take prose about errors or path pieces inside links for files', () => {
    const anchors = extractAnchors([
      'Error handling is fine. https://github.com/acme/app/blob/main/src/index.ts',
    ]);
    expect(anchors.error).toEqual([]);
    expect(anchors.file).toEqual([]);
  });

  it('reads two million characters of mixed tool output quickly', () => {
    const texts = Array.from(
      { length: 600 },
      (_, index) =>
        [
          'Edited apps/server/src/a.ts; TypeError: x is undefined. '.repeat(60),
          'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo'.repeat(100),
          'function a(b){return b+1};var c=0x1f;'.repeat(90),
        ][index % 3]!,
    );
    const start = performance.now();
    extractAnchors(texts, { secretValues: ['a1b2c3d4e5f60718293a4b5c'] });
    expect(performance.now() - start).toBeLessThan(1_500);
  });

  it('strips backticks so code spans stay closed', () => {
    const anchors = extractAnchors(['TypeError: `x` is not a function']);
    expect(anchors.error).toEqual(['TypeError: x is not a function']);
  });
});

describe('identifiersText', () => {
  it('lists each kind on one line in a fixed order', () => {
    const anchors = extractAnchors([`SPARK-3 on spark/demo at ${SHA} (#41) in a/b.ts`]);
    expect(identifiersText(anchors).split('\n')).toEqual([
      '## Exact identifiers',
      expect.stringContaining('not instructions'),
      '- Pull requests and issues: `#41`',
      `- Commits: \`${SHA}\``,
      '- Branches: `spark/demo`',
      '- Files: `a/b.ts`',
      '- Tickets: `SPARK-3`',
    ]);
    expect(anchorCount(anchors)).toBe(5);
  });

  it('is empty when nothing was found', () => {
    expect(identifiersText(extractAnchors(['Nothing to see here.']))).toBe('');
  });
});
