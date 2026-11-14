import { describe, expect, it } from 'vitest';
import type { TurnAttachment } from '../../providers/provider.ts';
import {
  CHAT_ONLY_NOTE,
  CHAT_TOOLS_NOTE,
  commandFirstBlocks,
  commandPreamble,
  contextSteps,
  conversationBlocks,
  conversationPrompt,
  doProjectNote,
  projectNote,
} from './conversation-prompt.ts';

const image: TurnAttachment = {
  name: 'shot.png',
  mediaType: 'image/png',
  kind: 'image',
  data: Buffer.from([1, 2, 3]),
};
const text = (name: string, content: string): TurnAttachment => ({
  name,
  mediaType: 'text/markdown',
  kind: 'text',
  data: Buffer.from(content),
});
const full = { image: true, embeddedContext: true };

describe('conversation prompt', () => {
  it('sends the chat-only note and the message when there is no history', () => {
    expect(conversationPrompt([], 'Hi')).toBe(`${CHAT_ONLY_NOTE}\n\nHi`);
  });

  it('hands a very long message to the agent whole, in one text block', () => {
    const long = `${'word '.repeat(40_000)}end`;
    const history = [{ role: 'user' as const, content: 'earlier' }];

    const blocks = conversationBlocks(history, long);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: 'text' });
    expect(conversationPrompt(history, long).endsWith(long)).toBe(true);
  });

  it('lets a chat without a folder use the tools its session offers, but not change files', () => {
    const [withTools] = conversationBlocks([], 'Hi', { toolsAvailable: true });
    expect(withTools).toEqual({ type: 'text', text: `${CHAT_TOOLS_NOTE}\n\nHi` });
    expect(CHAT_TOOLS_NOTE).toContain('spark_* tools');
    expect(CHAT_TOOLS_NOTE).toContain('cannot read or change files');
    expect(CHAT_TOOLS_NOTE).not.toMatch(/do not attempt tool calls/);
    expect(CHAT_ONLY_NOTE).toMatch(/do not attempt tool calls/);
    const [project] = conversationBlocks([], 'Hi', {
      projectRoots: ['/work/app'],
      toolsAvailable: true,
    });
    expect(project?.type === 'text' && project.text.startsWith(projectNote(['/work/app']))).toBe(
      true,
    );
  });

  it('replaces the chat-only note with the read-only folder note in a project', () => {
    const history = [{ role: 'user' as const, content: 'Earlier' }];
    for (const turns of [[], history]) {
      const [first] = conversationBlocks(turns, 'Hi', { projectRoots: ['/work/app'] });
      expect(first).toMatchObject({ type: 'text' });
      const intro = first?.type === 'text' ? first.text : '';
      expect(intro.startsWith(projectNote(['/work/app']))).toBe(true);
      expect(intro).not.toContain(CHAT_ONLY_NOTE);
    }
    expect(projectNote(['/work/app'])).toContain('/work/app');
    expect(projectNote(['/work/app'])).toMatch(/must not create, change, or delete files/);
  });

  it('tells an Ask turn with an approval gate that it may run commands, but never change files', () => {
    const note = projectNote(['/work/app'], true);
    expect(note).toContain('run shell commands');
    expect(note).toContain('may ask the user before other commands');
    expect(note).toContain('including through commands');
    expect(note).toContain('ask for the change in a message');
    expect(note).not.toContain('press');
    expect(projectNote(['/work/app'])).not.toContain('shell commands');
    const [first] = conversationBlocks([], 'Hi', {
      projectRoots: ['/work/app'],
      commandsAllowed: true,
    });
    expect(first?.type === 'text' && first.text.startsWith(note)).toBe(true);
  });

  it('lets Ask and Do turns read the crew folders but never change them', () => {
    const crew = ['/data/sparks', '/data/workflows'];
    for (const note of [
      projectNote(['/work/app'], true, crew),
      doProjectNote(['/work/app'], crew),
    ]) {
      expect(note).toContain(
        'you may read files in /data/sparks, /data/workflows, but never change them',
      );
    }
    expect(projectNote(['/work/app'])).not.toContain('crew folders');
  });

  it('lists every linked folder and marks the primary one', () => {
    const note = projectNote(['/work/app', '/work/lib']);
    expect(note).toContain('/work/app (primary, your working directory), /work/lib');
    expect(note).toMatch(/must not read files outside them/);
    const [first] = conversationBlocks([], 'Hi', { projectRoots: ['/work/app', '/work/lib'] });
    expect(first?.type === 'text' && first.text.startsWith(note)).toBe(true);
  });

  it('includes earlier turns oldest first before the latest message', () => {
    const prompt = conversationPrompt(
      [
        { role: 'user', content: 'My codename is Heron.' },
        { role: 'assistant', content: 'Noted.' },
      ],
      'What is my codename?',
    );
    expect(prompt).toContain('User: My codename is Heron.\n\nAssistant: Noted.');
    expect(prompt.endsWith('Reply to the latest message:\n\nWhat is my codename?')).toBe(true);
  });

  it('keeps the newest turns that fit and says how many were left out', () => {
    const history = [
      { role: 'user' as const, content: 'a'.repeat(50) },
      { role: 'assistant' as const, content: 'b'.repeat(50) },
      { role: 'user' as const, content: 'recent' },
    ];
    const prompt = conversationPrompt(history, 'now', 40);
    expect(prompt).toContain('(2 earlier messages were left out to fit the context budget.)');
    expect(prompt).toContain('User: recent');
    expect(prompt).not.toContain('aaaa');
  });

  it('sends images and embedded resources after the message', () => {
    const blocks = conversationBlocks([], 'Look', {
      attachments: [image, text('my notes.md', '# Hi')],
      support: full,
    });
    expect(blocks).toEqual([
      { type: 'text', text: `${CHAT_ONLY_NOTE}\n\nLook\n\n[Attached image: shot.png]` },
      { type: 'image', data: 'AQID', mimeType: 'image/png' },
      {
        type: 'resource',
        resource: { uri: 'attachment:///my%20notes.md', mimeType: 'text/markdown', text: '# Hi' },
      },
    ]);
  });

  it('inlines text files in a fence longer than any backtick run inside them', () => {
    const blocks = conversationBlocks([], 'Read', {
      attachments: [text('a.md', 'x ```` y')],
      support: { image: true, embeddedContext: false },
    });
    expect(blocks).toEqual([
      {
        type: 'text',
        text: [CHAT_ONLY_NOTE, 'Read', 'Attached file a.md:\n`````\nx ```` y\n`````'].join('\n\n'),
      },
    ]);
  });

  it('keeps history attachments next to their turn and names images the agent cannot read', () => {
    const blocks = conversationBlocks(
      [{ role: 'user', content: 'See this', attachments: [image] }],
      'And now?',
      { support: { image: false, embeddedContext: false } },
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      text: expect.stringContaining('User: See this\n\n[Image not shown: shot.png]'),
    });
  });

  it('counts text attachments against the history budget but not images', () => {
    const history = [
      { role: 'user' as const, content: 'old', attachments: [text('big.txt', 'z'.repeat(100))] },
      { role: 'user' as const, content: 'pic', attachments: [image] },
    ];
    const prompt = conversationBlocks(history, 'now', { budget: 60, support: full });
    const texts = prompt.map((block) => (block.type === 'text' ? block.text : '')).join('');
    expect(texts).toContain('(1 earlier message was left out');
    expect(texts).toContain('User: pic');
    expect(prompt.some((block) => block.type === 'image')).toBe(true);

    const crowded = conversationBlocks(history.slice(1), 'now', {
      budget: 60,
      attachments: [text('current.txt', 'y'.repeat(60))],
      support: full,
    });
    expect(crowded[0]).toMatchObject({ text: expect.stringContaining('1 earlier message was') });
  });

  it('describes the files and history it hands the agent as steps', () => {
    const history = [
      { role: 'user' as const, content: 'first', attachments: [text('old.md', 'x')] },
      { role: 'assistant' as const, content: 'reply' },
    ];
    expect(contextSteps([], { attachments: [text('AGENTS.md', 'x'), image] })).toEqual([
      'Read `AGENTS.md`',
      'Looked at `shot.png`',
    ]);
    expect(contextSteps(history)).toEqual(['Recalled 2 earlier messages and 1 file']);
    expect(contextSteps(history, { budget: 20 })).toEqual([
      'Recalled 1 earlier message',
      'Left out 1 older message to fit the context',
    ]);
  });
});

describe('command-first prompt', () => {
  const full = { image: true, embeddedContext: true };

  it('ends with the command alone, after the preamble and the files', () => {
    const blocks = commandFirstBlocks([], 'Spark preamble', '/egm:egm-review design.md', {
      attachments: [text('notes.md', 'hello'), image],
      support: full,
    });
    expect(blocks.at(-1)).toEqual({ type: 'text', text: '/egm:egm-review design.md' });
    expect(blocks[0]).toEqual({
      type: 'text',
      text: `${CHAT_ONLY_NOTE}\n\nSpark preamble\n\n${'Attached file notes.md:'}\n\`\`\`\nhello\n\`\`\`\n\n[Attached image: shot.png]`,
    });
    expect(blocks.some((block) => block.type === 'resource')).toBe(false);
    expect(blocks.filter((block) => block.type === 'image')).toHaveLength(1);
  });

  it('keeps earlier messages ahead of the command', () => {
    const blocks = commandFirstBlocks([{ role: 'user', content: 'earlier' }], '', '/deploy', {});
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.type === 'text' && blocks[0].text).toContain('User: earlier');
    expect(blocks[1]).toEqual({ type: 'text', text: '/deploy' });
  });

  it('puts the preamble, the outpost note and the title request before the command', () => {
    expect(commandPreamble({ preamble: 'P', turnPreamble: 'T', askTitle: true } as never)).toMatch(
      /^P\n\nT\n\n/,
    );
    expect(commandPreamble({} as never)).toBe('');
  });
});
