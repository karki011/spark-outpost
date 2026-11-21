import { planSettled, type SubChatRow } from '@spark-outpost/contracts';
import { insertChatAsk } from '../persistence/chat-asks.ts';
import { withTransaction, type Db } from '../persistence/db.ts';
import { newId } from '../persistence/ids.ts';
import { openPlans, type PlanRow } from '../persistence/sub-chat-plans.ts';
import { claimWrapUp, subChatRows } from '../persistence/sub-chats.ts';
import { storedMessage } from './asks.ts';
import { reportFacts, type ReadBranchWork } from './report-facts.ts';
import { WRAP_UP_FROM, wrapUpBody, type WrapUpPiece } from './wrap-up.ts';

async function wrapUpPiece(db: Db, row: SubChatRow, read?: ReadBranchWork): Promise<WrapUpPiece> {
  return {
    id: row.id,
    title: row.title,
    position: row.position,
    status: row.status,
    reason: row.why,
    record: row.status === 'held' ? null : await reportFacts(db, row, read),
    stackedOn: row.stackedOn?.id ?? null,
  };
}

async function writeWrapUp(db: Db, pieces: readonly PlanRow[], read?: ReadBranchWork) {
  const parent = pieces[0];
  if (!parent) return false;
  const seen = new Set(pieces.map((piece) => piece.id));
  const rows = (await subChatRows(db, parent.parentId)).filter((row) => seen.has(row.id));
  const told: WrapUpPiece[] = [];
  for (const row of rows) told.push(await wrapUpPiece(db, row, read));
  const body = storedMessage(wrapUpBody(told));
  return withTransaction(db, async (client) => {
    if (!(await claimWrapUp(client, parent.parentId, [...seen]))) return false;
    await insertChatAsk(client, {
      id: newId(),
      workspaceId: parent.workspaceId,
      kind: 'wrap_up',
      fromConversationId: null,
      fromRunId: null,
      fromTitle: WRAP_UP_FROM,
      toConversationId: parent.parentId,
      body,
      replyTo: null,
      wantsReply: false,
    });
    return true;
  });
}

export async function queueWrapUps(db: Db, read?: ReadBranchWork): Promise<number> {
  let written = 0;
  for (const pieces of await openPlans(db)) {
    if (pieces.every((piece) => piece.wrappedUp) || !planSettled(pieces)) continue;
    if (await writeWrapUp(db, pieces, read)) written += 1;
  }
  return written;
}
