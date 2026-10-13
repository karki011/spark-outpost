import { describe, expect, it } from 'vitest';
import type { Approval, ConversationSummary } from '@spark-outpost/contracts';
import { API_CHAT, FE_CHAT, OUTPOST_ID, chat } from '../outposts/test-fixtures.ts';
import type { Card, CardKind } from './island-model.ts';
import { restLine, restLineTitle, waitingTitle } from './island-rest-line.ts';

function approval(id: string, patch: Partial<Approval> = {}): Approval {
  return {
    id,
    kind: 'execute',
    title: 'npm install sharp',
    payload: { command: 'npm install sharp', paths: [] },
    ...patch,
  } as Approval;
}

function card(
  kind: CardKind,
  about: ConversationSummary,
  request: Approval | null = null,
  loading = false,
): Card {
  return { kind, chat: about, approval: request, loading };
}

const install = card('approval', chat(FE_CHAT, { title: 'Add the image library' }), approval('a1'));
const member = chat(API_CHAT, {
  title: 'Orders endpoint',
  outpost: { id: OUTPOST_ID, name: 'Orders launch', handle: 'api' },
});
const quiet = { sparkFocused: false, cards: [], moment: null, momentText: null };

describe('what is waiting, in one line', () => {
  it('names the command, the file or the force-push being asked for', () => {
    expect(waitingTitle(install)).toBe('Approve: run npm install sharp');
    const edit = approval('a2', {
      kind: 'edit',
      payload: { paths: ['src/upload/resize.ts'] } as Approval['payload'],
    });
    expect(waitingTitle(card('approval', install.chat, edit))).toBe('Approve: change resize.ts');
    expect(waitingTitle(card('force', install.chat, approval('a3')))).toBe('Approve: force-push');
  });

  it('names who has a question, and the member chat that needs the user', () => {
    const asking = chat(FE_CHAT, {
      title: 'Pick a cache',
      attention: { kind: 'input', agentName: 'Claude' } as ConversationSummary['attention'],
    });
    expect(waitingTitle(card('question', asking))).toBe('Claude has a question');
    expect(waitingTitle(card('question', chat(FE_CHAT, { title: 'Pick a cache' })))).toBe(
      'Pick a cache has a question',
    );
    expect(waitingTitle(card('question', member))).toBe('@api needs you in Orders launch');
    expect(waitingTitle(card('open', member))).toBe('@api needs you in Orders launch');
    expect(waitingTitle(card('open', install.chat))).toBe('Add the image library needs you');
  });

  it('names the member chat whose approval is waiting', () => {
    const run = card('approval', member, approval('a4'));
    expect(waitingTitle(run)).toBe('@api: approve run npm install sharp');
    expect(restLineTitle(restLine({ ...quiet, cards: [run] })!)).toBe(
      '@api: approve run npm install sharp · Review',
    );
    const edit = approval('a5', {
      kind: 'edit',
      payload: { paths: ['src/a.ts', 'src/b.ts'] } as Approval['payload'],
    });
    expect(waitingTitle(card('approval', member, edit))).toBe('@api: approve change 2 files');
    expect(waitingTitle(card('force', member, approval('a6')))).toBe('@api: approve force-push');
  });
});

describe('the line beside Scout at rest', () => {
  it('shows the oldest waiting request and counts the others', () => {
    const others = [card('open', member), card('question', chat(API_CHAT))];
    const line = restLine({ ...quiet, cards: [install, ...others] });
    expect(line).toMatchObject({
      kind: 'waiting',
      text: 'Approve: run npm install sharp',
      more: 2,
      chatId: FE_CHAT,
      card: install,
    });
    expect(restLineTitle(line!)).toBe('Approve: run npm install sharp · Review · +2 more');
    expect(restLineTitle(restLine({ ...quiet, cards: [install] })!)).toBe(
      'Approve: run npm install sharp · Review',
    );
  });

  it('says nothing while Spark is focused or nothing is waiting', () => {
    expect(restLine(quiet)).toBeNull();
    expect(restLine({ ...quiet, cards: [install], sparkFocused: true })).toBeNull();
  });

  it('waits for a request to load before naming it', () => {
    const loading = card('open', chat(API_CHAT), null, true);
    expect(restLine({ ...quiet, cards: [loading] })).toBeNull();
    expect(restLine({ ...quiet, cards: [loading, install] })).toMatchObject({
      text: 'Approve: run npm install sharp',
      more: 1,
    });
  });

  it('shows a chat that just finished or failed ahead of what is waiting', () => {
    const moment = { kind: 'done' as const, chatId: API_CHAT, runId: 'r1' };
    const done = restLine({
      ...quiet,
      cards: [install],
      moment,
      momentText: 'Orders endpoint is done.',
    });
    expect(done).toMatchObject({ kind: 'done', text: 'Orders endpoint is done.', more: 0 });
    expect(done!.card).toBeNull();
    expect(restLineTitle(done!)).toBe('Orders endpoint is done.');
    const failed = restLine({
      ...quiet,
      moment: { ...moment, kind: 'failed' },
      momentText: 'Orders endpoint couldn’t finish.',
    });
    expect(failed).toMatchObject({ kind: 'failed', chatId: API_CHAT });
    expect(restLine({ ...quiet, moment, momentText: null })).toBeNull();
    expect(
      restLine({ ...quiet, sparkFocused: true, moment, momentText: 'Orders endpoint is done.' }),
    ).toBeNull();
  });
});
