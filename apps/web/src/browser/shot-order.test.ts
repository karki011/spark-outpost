import { describe, expect, it } from 'vitest';
import type { BrowserShot } from '@spark-outpost/contracts';
import { anchorIndex, outsideFence, replyParts, shotCaption, thumbSize } from './shot-order.ts';

function shot(id: string, said: string | null, held = 0): BrowserShot {
  return {
    id,
    runId: 'run',
    turnRunId: 'run',
    attachment: { id, name: `${id}.png`, mediaType: 'image/png', size: 1, kind: 'image' },
    page: 'http://localhost:5173/',
    title: 'Home',
    width: 1280,
    height: 800,
    textOffset: said === null ? null : said.length + held,
    textBefore: said === null ? null : said.slice(-80),
    textHeld: said === null ? null : held,
    createdAt: '2026-10-06T10:00:00.000Z',
  };
}

function outline(text: string, shots: BrowserShot[]): string[] {
  return replyParts(text, shots).map((part) =>
    part.kind === 'text' ? part.text.trim() : part.shots.map((entry) => entry.id).join('+'),
  );
}

describe('replyParts', () => {
  it('keeps the whole reply as one part when there are no screenshots', () => {
    expect(replyParts('Hello there.', [])).toEqual([
      { kind: 'text', key: 'text-0', text: 'Hello there.' },
    ]);
    expect(replyParts('', [])).toEqual([]);
  });

  it('puts a screenshot between the text written before and after it', () => {
    const before = 'Opening the page.\n\n';
    expect(outline(`${before}The header is right.`, [shot('a', before)])).toEqual([
      'Opening the page.',
      'a',
      'The header is right.',
    ]);
  });

  it('keeps the first text part mounted under the same key while later text streams in', () => {
    const before = 'Opening the page.';
    const taken = replyParts(before, [shot('a', before)]);
    const later = replyParts(`${before} Then more.`, [shot('a', before)]);
    expect(taken.map((part) => part.key)).toEqual(['text-0', 'shots-a']);
    expect(later.map((part) => part.key)).toEqual(['text-0', 'shots-a', 'text-1']);
    expect(later[0]).toEqual(taken[0]);
  });

  it('places two screenshots in one turn at their own points', () => {
    const first = 'One. ';
    const second = `${first}Two. `;
    expect(outline(`${second}Three.`, [shot('a', first), shot('b', second)])).toEqual([
      'One.',
      'a',
      'Two.',
      'b',
      'Three.',
    ]);
  });

  it('groups screenshots taken back to back into one row, oldest first', () => {
    const said = 'Both sizes:\n\n';
    const parts = replyParts(`${said}Done.`, [shot('a', said), shot('b', said)]);
    expect(parts.map((part) => part.kind)).toEqual(['text', 'shots', 'text']);
    expect(outline(`${said}Done.`, [shot('a', said), shot('b', said)])[1]).toBe('a+b');
  });

  it('shows a screenshot taken before any text first', () => {
    expect(outline('All good.', [shot('a', '')])).toEqual(['a', 'All good.']);
  });

  it('puts a screenshot with no stored position after the text, not above it', () => {
    expect(outline('Older reply.', [shot('old', null)])).toEqual(['Older reply.', 'old']);
    expect(outline('', [shot('old', null)])).toEqual(['old']);
  });

  it('finds the place again when the stored reply has text added in front', () => {
    const before = 'I opened the settings page.';
    const stored = `Plan ready.\n\n${before}\n\nThe toggle works.\n\nChecks passed.`;
    expect(outline(stored, [shot('a', `  ${before}\n\n`)])).toEqual([
      'Plan ready.\n\nI opened the settings page.',
      'a',
      'The toggle works.\n\nChecks passed.',
    ]);
  });

  it('picks the repeat of the text nearest the stored position', () => {
    const text = 'Done. First.\n\nDone. Second.';
    const said = 'Done. First.\n\nDone.';
    expect(outline(text, [shot('a', said)])).toEqual(['Done. First.\n\nDone.', 'a', 'Second.']);
  });

  it('waits at the end until the streamed text catches up with the screenshot', () => {
    const before = 'Opening the page now.';
    expect(outline('Opening', [shot('a', before)])).toEqual(['Opening', 'a']);
    expect(outline(`${before} Next.`, [shot('a', before)])).toEqual([before, 'a', 'Next.']);
  });

  it('counts the last word the server was still holding back when the screenshot was taken', () => {
    const shown = 'Both views check ';
    expect(outline('Both views check', [shot('a', shown, 4)])).toEqual(['Both views check', 'a']);
    expect(outline('Both views check out. Next.', [shot('a', shown, 4)])).toEqual([
      'Both views check out.',
      'a',
      'Next.',
    ]);
    const stored = `Plan ready.\n\n${shown}out.\n\nChecks passed.`;
    expect(outline(stored, [shot('a', `\n${shown}`, 4)])).toEqual([
      'Plan ready.\n\nBoth views check out.',
      'a',
      'Checks passed.',
    ]);
  });

  it('falls back to the end when the text before the screenshot is gone', () => {
    expect(outline('A different reply.', [shot('a', 'Not in the reply')])).toEqual([
      'A different reply.',
      'a',
    ]);
  });

  it('never splits a code block', () => {
    const before = 'Run this:\n\n```sh\npnpm dev\n';
    const text = `${before}pnpm test\n\`\`\`\n\nThen look.`;
    expect(outline(text, [shot('a', before)])).toEqual([
      'Run this:\n\n```sh\npnpm dev\npnpm test\n```',
      'a',
      'Then look.',
    ]);
  });
});

describe('outsideFence', () => {
  it('leaves a position outside code alone', () => {
    const text = 'a\n```\ncode\n```\nb';
    expect(outsideFence(text, 1)).toBe(1);
    expect(outsideFence(text, text.length)).toBe(text.length);
  });

  it('moves to the end of the text while the code block is still open', () => {
    const text = 'a\n~~~\ncode';
    expect(outsideFence(text, 8)).toBe(text.length);
  });
});

describe('anchorIndex', () => {
  it('clamps a bare position to the text there is', () => {
    expect(anchorIndex('abc', { ...shot('a', ''), textOffset: 9, textBefore: null })).toBe(3);
  });

  it('puts an anchor taken before any visible text at the start', () => {
    expect(anchorIndex('There it is.', { textOffset: 1, textBefore: '', textHeld: 1 })).toBe(0);
    expect(anchorIndex('There it is.', { textOffset: 1, textBefore: '\n', textHeld: 0 })).toBe(0);
  });

  it('moves a position inside a word to the end of that word', () => {
    expect(anchorIndex('Opened it.', { textOffset: 1, textBefore: null, textHeld: 0 })).toBe(6);
    expect(anchorIndex('Check out. Next.', shot('a', 'Check ou'))).toBe(10);
  });
});

describe('thumbSize', () => {
  it('scales a page screenshot down to the thumbnail width', () => {
    expect(thumbSize(1280, 800)).toEqual({ width: 160, height: 100 });
  });

  it('caps a full-page screenshot at the thumbnail height', () => {
    expect(thumbSize(1280, 6000)).toEqual({ width: 160, height: 120 });
  });

  it('never enlarges a small screenshot', () => {
    expect(thumbSize(90, 40)).toEqual({ width: 90, height: 40 });
    expect(thumbSize(1, 1)).toEqual({ width: 1, height: 1 });
  });
});

describe('shotCaption', () => {
  it('drops the scheme to keep the caption short', () => {
    expect(shotCaption('http://localhost:5173/settings')).toBe('localhost:5173/settings');
  });
});
