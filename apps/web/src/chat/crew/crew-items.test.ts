import { describe, expect, it } from 'vitest';
import type { Approval, CrewMember, Message } from '@spark-outpost/contracts';
import { handOffAt, memberTexts, shownApprovals, turnApprovals } from './crew-items.ts';

const approval = (
  id: string,
  runId: string,
  status: Approval['status'] = 'pending',
  decidedBy: Approval['decidedBy'] = null,
) =>
  ({
    id,
    runId,
    status,
    decidedBy,
    kind: 'execute',
    payload: {},
    createdAt: `2026-09-27T00:00:0${id.length}Z`,
  }) as Approval;

describe('turnApprovals', () => {
  it("keeps only the approvals of this turn's runs, so a later turn's cards render once", () => {
    const stored = [approval('p1', 'turn-1'), approval('p2', 'turn-2'), approval('e1', 'bolt-1')];
    expect(turnApprovals(['turn-1', 'bolt-1'], stored, []).map((item) => item.id)).toEqual([
      'p1',
      'e1',
    ]);
  });

  it('prefers a decided streamed copy over the stored pending one', () => {
    const merged = turnApprovals(
      ['turn-1'],
      [approval('p1', 'turn-1')],
      [approval('p1', 'turn-1', 'allowed', 'user')],
    );
    expect(merged.map((item) => item.status)).toEqual(['allowed']);
  });
});

describe('shownApprovals', () => {
  it('keeps what the user answered after the stream stops carrying it', () => {
    const answered = approval('a1', 'bolt-1', 'denied', 'user');
    expect(shownApprovals([answered], [])).toEqual([answered]);
  });

  it('drops approvals settled without the user, such as a Stop', () => {
    const stopped = approval('a1', 'bolt-1', 'cancelled', 'stop');
    const allowlisted = approval('a22', 'bolt-1', 'allowed', 'allowlist');
    expect(shownApprovals([], [stopped, allowlisted])).toEqual([]);
  });
});

const reply = (runId: string, content: string, second: number) =>
  ({
    role: 'assistant',
    runId,
    content,
    createdAt: `2026-09-29T00:00:0${second}Z`,
  }) as Message;

describe('memberTexts', () => {
  const crew = [
    { runId: 'root', startedAt: '2026-09-29T00:00:01Z' },
    { runId: 'bolt', startedAt: '2026-09-29T00:00:04Z' },
  ] as CrewMember[];

  it("keeps an in-place Scout to its own replies, not the turn's closing summary", () => {
    const messages = [
      reply('root', 'Which report?', 2),
      reply('root', 'Spend, then.', 3),
      reply('bolt', 'Done. fake-edit=allowed', 5),
      reply('root', 'Done. fake-edit=allowed', 6),
    ];
    const texts = memberTexts(messages, 'root', handOffAt(crew, 'root'));
    expect(texts.get('root')).toBe('Which report?\n\nSpend, then.');
    expect(texts.get('bolt')).toBe('Done. fake-edit=allowed');
  });

  it('uses the latest root reply when nothing was handed off', () => {
    const messages = [reply('root', 'Draft', 2), reply('root', 'Answer', 3)];
    expect(handOffAt(crew.slice(0, 1), 'root')).toBeNull();
    expect(memberTexts(messages, 'root', null).get('root')).toBe('Answer');
  });
});
