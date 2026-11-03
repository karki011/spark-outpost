import { describe, expect, it } from 'vitest';
import {
  replyOptions,
  turnReplyOptions,
  withoutOptionList,
  type OptionTurn,
} from './reply-options.ts';

const done: OptionTurn = { streaming: false, succeeded: true, latest: true, asked: false };

describe('replyOptions offers a closing list of choices', () => {
  it('reads a bulleted list after a question in the paragraph before it', () => {
    const text =
      'I found two ways to store runs.\n\nWhich would you prefer?\n\n- Postgres\n- SQLite';
    expect(replyOptions(text)).toEqual(['Postgres', 'SQLite']);
  });

  it('reads a list that follows its question with no blank line', () => {
    expect(replyOptions('Which one should I use?\n- Vitest\n- Jest\n- Mocha')).toEqual([
      'Vitest',
      'Jest',
      'Mocha',
    ]);
  });

  it('takes the last sentence of a longer lead paragraph', () => {
    const text = 'The fix is in. Tests pass. What would you like next?\n\n- Add docs\n- Open a PR';
    expect(replyOptions(text)).toEqual(['Add docs', 'Open a PR']);
  });

  it('accepts an offer that ends with a colon', () => {
    expect(replyOptions('Want me to:\n\n- Rename the file\n- Keep the old name')).toEqual([
      'Rename the file',
      'Keep the old name',
    ]);
    expect(replyOptions('Here are a few options:\n\n- Cache it\n- Recompute')).toEqual([
      'Cache it',
      'Recompute',
    ]);
  });

  it('accepts a numbered list after a question', () => {
    expect(replyOptions('Which approach?\n\n1. Retry on failure\n2. Fail fast')).toEqual([
      'Retry on failure',
      'Fail fast',
    ]);
  });

  it('accepts Option A/B items without a lead line', () => {
    const text =
      'Done.\n\n```ts\nconst a = 1;\n```\n\n- **Option A:** Keep it\n- **Option B:** Drop it';
    expect(replyOptions(text)).toEqual(['Option A: Keep it', 'Option B: Drop it']);
  });

  it('accepts items that are offers phrased as questions', () => {
    const text = 'All set.\n\n- Want me to add tests?\n- Should I update the docs?';
    expect(replyOptions(text)).toEqual(['Want me to add tests?', 'Should I update the docs?']);
  });

  it('strips Markdown from the choice text', () => {
    const text = 'Which do you want?\n\n- **Keep** the `old` API\n- Use the [new one](https://x.y)';
    expect(replyOptions(text)).toEqual(['Keep the old API', 'Use the new one']);
  });

  it('reads a heading lead and ignores trailing whitespace', () => {
    expect(replyOptions('## Which should I pick?\n\n- Red\n- Blue\n\n  \n')).toEqual([
      'Red',
      'Blue',
    ]);
  });

  it('accepts six items and an item of exactly 140 characters', () => {
    const long = 'x'.repeat(140);
    const six = ['a1', 'b2', 'c3', 'd4', 'e5', long];
    expect(replyOptions(`Which one?\n\n${six.map((item) => `- ${item}`).join('\n')}`)).toEqual(six);
  });
  it('accepts a real reply with longer choices', () => {
    const items = [
      'Check both pages live and correct anything I got wrong above',
      'Compare cmux with Spark Outpost or other agent terminals (Warp, Ghostty, tmux setups)',
      'Write a short evaluation of whether cmux fits your workflow, with pros, cons and open questions',
    ];
    expect(
      replyOptions(
        `Which of these would you like next?\n\n${items.map((item) => `- ${item}`).join('\n')}`,
      ),
    ).toEqual(items);
  });
});

describe('replyOptions leaves other lists alone', () => {
  const none = (text: string) => expect(replyOptions(text)).toEqual([]);

  it('ignores numbered steps', () => {
    none('To set it up:\n\n1. Open Settings\n2. Choose a provider\n3. Sign in');
    none('To get started, pick a template:\n\n1. Open Settings\n2. Click New');
  });

  it('ignores a how-to question followed by steps', () => {
    none('How does this work?\n\n- It reads the file\n- It writes a cache');
  });

  it('ignores a summary of changes', () => {
    none('I made these changes:\n\n- Added a test\n- Fixed the parser\n- Renamed `foo`');
    none('What changed?\n\n- Added a test\n- Fixed the parser');
  });

  it('ignores file lists', () => {
    none('Which files changed?\n\n- `src/a.ts`\n- `src/b.ts`');
    none('Which file should I edit?\n\n- src/a.ts\n- README.md');
    none("Here's which files changed:\n\n- parser\n- lexer");
  });

  it('ignores links-only items', () => {
    none('Which doc?\n\n- [Guide](https://a.b)\n- [API](https://a.c)');
  });

  it('ignores long items', () => {
    none(`Which one?\n\n- ${'x'.repeat(141)}\n- Short`);
  });

  it('ignores one item or more than six', () => {
    none('Which one?\n\n- Only this');
    none(
      `Which one?\n\n${['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((item) => `- ${item}`).join('\n')}`,
    );
  });

  it('ignores a list in the middle of a reply', () => {
    none('Which do you prefer?\n\n- Postgres\n- SQLite\n\nLet me know.');
    none('- Postgres\n- SQLite\n\nWhich one?');
  });

  it('ignores nested lists, continuation lines and code', () => {
    none('Which one?\n\n- Postgres\n  - with pooling\n- SQLite');
    none('Which one?\n\n- Postgres\n  runs as a server\n- SQLite');
    none('Which one?\n\n- Postgres\n- SQLite\n```sh\nrm -rf x\n```');
  });

  it('ignores task lists and mixed markers', () => {
    none('Which do you want?\n\n- [ ] Tests\n- [ ] Docs');
    none('Which one?\n\n- Postgres\n1. SQLite');
  });

  it('ignores lists with no lead or a statement lead', () => {
    none('- Postgres\n- SQLite');
    none('Choose a provider in Settings.\n\n- Claude\n- Codex');
    none('Next steps:\n\n- Merge\n- Release');
  });

  it('ignores a lead that is code, a table or a quote', () => {
    none('```\nWhich one?\n```\n\n- A thing\n- B thing');
    none('| Which one? |\n| --- |\n\n- A thing\n- B thing');
    none('> Which one?\n\n- A thing\n- B thing');
  });

  it('ignores duplicate items and question items that are not offers', () => {
    none('Which one?\n\n- Same\n- Same');
    none('Open questions:\n\n- Why does it fail?\n- When did it start?');
  });

  it('ignores a reply that carries a clarify block', () => {
    none('Which one?\n\n```clarify\n{}\n```\n\n- A thing\n- B thing');
  });
});

describe('turnReplyOptions shows choices only on a finished latest turn', () => {
  const text = 'Which one?\n\n- Postgres\n- SQLite';

  it('shows them when the turn succeeded and is the latest', () => {
    expect(turnReplyOptions(text, done)).toEqual(['Postgres', 'SQLite']);
  });

  it('hides them while the reply is streaming', () => {
    expect(turnReplyOptions(text, { ...done, streaming: true })).toEqual([]);
  });

  it('hides them on a failed or stopped turn, an older turn, or with a question card', () => {
    expect(turnReplyOptions(text, { ...done, succeeded: false })).toEqual([]);
    expect(turnReplyOptions(text, { ...done, latest: false })).toEqual([]);
    expect(turnReplyOptions(text, { ...done, asked: true })).toEqual([]);
  });
});

describe('withoutOptionList', () => {
  it('drops the closing list and keeps its lead in the same block', () => {
    expect(withoutOptionList('Done.\n\nWhich one?\n- Postgres\n- SQLite\n')).toBe(
      'Done.\n\nWhich one?',
    );
  });

  it('drops a loose list and keeps a separate lead paragraph', () => {
    expect(withoutOptionList('Which one?\n\n- Postgres\n\n- SQLite')).toBe('Which one?');
  });
});
