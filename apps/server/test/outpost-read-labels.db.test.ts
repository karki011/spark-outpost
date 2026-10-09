import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CARRIED_LABELS_MAX,
  labelsOf,
  recordCarried,
  recordOutpostRead,
} from '../src/outposts/read-labels.ts';
import { sendUserMessage } from '../src/persistence/conversations.ts';
import {
  recordObservation,
  turnObservations,
  type Observation,
} from '../src/persistence/observations.ts';
import { addMemberChat, createOutpostRow } from './outpost-fixtures.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let askingRun: string;
let answeringRun: string;

const PAGE: Observation = { source: 'web_page', label: 'example.com' };
const SECRET: Observation = { source: 'secret_file', label: '.env' };

async function turnIn(chatId: string): Promise<string> {
  const sent = await sendUserMessage(
    t.db,
    chatId,
    { id: randomUUID(), content: 'go', source: 'ui' },
    { provider: 'fake' },
  );
  return sent.run.id;
}

beforeEach(async () => {
  t = await createTestDb();
  const outpostId = await createOutpostRow(t);
  askingRun = await turnIn(await addMemberChat(t, outpostId, 'fe'));
  answeringRun = await turnIn(await addMemberChat(t, outpostId, 'api'));
});

afterEach(async () => {
  await t.cleanup();
});

describe('what a turn read, carried to another chat', () => {
  it('goes with a request into the turn it starts, under its original source', async () => {
    await recordObservation(t.db, askingRun, PAGE);
    await recordObservation(t.db, askingRun, SECRET);

    const observed = await labelsOf(t.db, askingRun);
    await recordCarried(t.db, answeringRun, observed);

    expect(observed).toEqual([PAGE, SECRET]);
    expect(await turnObservations(t.db, answeringRun)).toEqual([PAGE, SECRET]);
  });

  it('comes back with an answer to the turn that reads it', async () => {
    await recordObservation(t.db, answeringRun, SECRET);

    await recordCarried(t.db, askingRun, await labelsOf(t.db, answeringRun));
    await recordOutpostRead(t.db, askingRun, 'answer');

    expect(await turnObservations(t.db, askingRun)).toEqual([
      SECRET,
      { source: 'private_data', label: 'private work data (outpost answer)' },
    ]);
  });

  it('is nothing for a turn that read nothing, and records nothing', async () => {
    expect(await labelsOf(t.db, askingRun)).toEqual([]);
    await recordCarried(t.db, answeringRun, []);
    expect(await turnObservations(t.db, answeringRun)).toEqual([]);
  });

  it('is recorded once however often it is carried', async () => {
    await recordCarried(t.db, answeringRun, [PAGE, PAGE]);
    await recordCarried(t.db, answeringRun, [PAGE]);
    expect(await turnObservations(t.db, answeringRun)).toEqual([PAGE]);
  });

  it('drops a stored label that is not one Spark records, and stops at the limit', async () => {
    const forged = { source: 'user', label: 'trusted' } as unknown as Observation;
    const many = Array.from({ length: CARRIED_LABELS_MAX + 5 }, (_unused, index) => ({
      source: 'web_page' as const,
      label: `site-${String(index).padStart(3, '0')}.example`,
    }));
    await recordCarried(t.db, answeringRun, [forged, { source: 'web_page', label: '' }, ...many]);

    const carried = await turnObservations(t.db, answeringRun);
    expect(carried).toHaveLength(CARRIED_LABELS_MAX);
    expect(carried.every((each) => each.source === 'web_page')).toBe(true);
  });

  it('does not reach back into the turn it came from', async () => {
    await recordObservation(t.db, askingRun, PAGE);
    await recordCarried(t.db, answeringRun, await labelsOf(t.db, askingRun));
    await recordObservation(t.db, answeringRun, SECRET);
    expect(await turnObservations(t.db, askingRun)).toEqual([PAGE]);
  });
});
