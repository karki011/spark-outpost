import type { SubChatReport } from '@spark-outpost/contracts';
import { redactText, storableText } from '../audit/redact.ts';
import {
  insertChatAsk,
  settleChatAsk,
  type AskOutcome,
  type EndedAsk,
} from '../persistence/chat-asks.ts';
import { withTransaction, type Db, type Queryable } from '../persistence/db.ts';
import { newId } from '../persistence/ids.ts';
import { getSubChat, saveSubChatReport, subChatRow } from '../persistence/sub-chats.ts';
import { auditAskEnd, storedMessage } from './asks.ts';
import { reportFacts, type ReadBranchWork } from './report-facts.ts';
import { buildReport, reportText, type ReportTurn } from './report.ts';

export async function reportsToParent(db: Queryable, ended: EndedAsk): Promise<boolean> {
  const { ask } = ended;
  if (ask.kind === 'task') return true;
  if (ask.kind !== 'message' || ask.deliveredAs !== 'turn' || ask.from.id === null) return false;
  return (await getSubChat(db, ask.to.id))?.parentConversationId === ask.from.id;
}

export async function reportOf(
  db: Queryable,
  conversationId: string,
  turn: ReportTurn,
  read?: ReadBranchWork,
): Promise<SubChatReport | null> {
  const row = await subChatRow(db, conversationId);
  if (!row) return null;
  const reply = storableText(redactText(turn.reply));
  return buildReport({ ...turn, reply }, await reportFacts(db, row, read));
}

function outcomeOf(report: SubChatReport): AskOutcome {
  return report.reason === null
    ? { state: 'replied' }
    : { state: 'no_reply', reason: report.reason };
}

async function parentWorkspace(db: Queryable, parentId: string | null): Promise<string | null> {
  if (parentId === null) return null;
  const { rows } = await db.query<{ workspace_id: string }>(
    'SELECT workspace_id FROM conversations WHERE id = $1',
    [parentId],
  );
  return rows[0]?.workspace_id ?? null;
}

export async function sendReport(
  db: Db,
  ended: EndedAsk,
  read?: ReadBranchWork,
): Promise<string | null> {
  const { ask } = ended;
  const turn = { status: ended.runStatus, reply: ended.finalReply, error: ended.error };
  const report = await reportOf(db, ask.to.id, turn, read);
  if (!report) return null;
  const reportId = await withTransaction(db, async (client) => {
    if (!(await settleChatAsk(client, ask.id, outcomeOf(report)))) return null;
    await saveSubChatReport(client, ask.to.id, report);
    const workspaceId = await parentWorkspace(client, ask.from.id);
    if (workspaceId === null) return null;
    const id = newId();
    await insertChatAsk(client, {
      id,
      workspaceId,
      kind: 'report',
      fromConversationId: ask.to.id,
      fromRunId: ask.runId,
      fromTitle: ask.to.title,
      toConversationId: ask.from.id!,
      body: storedMessage(reportText(report)),
      replyTo: ask.id,
      wantsReply: false,
      report,
    });
    return id;
  });
  if (reportId) {
    await auditAskEnd(db, ask, 'report', report.reason ?? 'its turn succeeded').catch(
      () => undefined,
    );
  }
  return reportId;
}

interface LaterTurn {
  conversation_id: string;
  status: ReportTurn['status'];
  error: string | null;
  reply: string;
}

export async function refreshReports(db: Db, read?: ReadBranchWork): Promise<number> {
  const { rows } = await db.query<LaterTurn>(
    `SELECT s.conversation_id, r.status, r.error,
       COALESCE(said.final_reply, said.content, '') AS reply
     FROM sub_chats s
     JOIN LATERAL (
       SELECT id, status, error, finished_at FROM runs
       WHERE conversation_id = s.conversation_id AND parent_run_id IS NULL
       ORDER BY created_at DESC, id DESC LIMIT 1
     ) r ON true
     LEFT JOIN LATERAL (
       SELECT m.content, m.final_reply FROM messages m
       WHERE m.run_id = r.id AND m.role = 'assistant'
       ORDER BY m.created_at, m.id LIMIT 1
     ) said ON true
     WHERE s.started_at IS NOT NULL
       AND r.status NOT IN ('queued', 'running', 'awaiting_approval')
       AND r.finished_at > COALESCE(s.reported_at, s.started_at)
       AND NOT EXISTS (
         SELECT 1 FROM chat_asks a
         WHERE a.run_id = r.id AND a.state = 'waiting' AND a.delivered_as = 'turn'
       )
     ORDER BY s.conversation_id`,
  );
  let refreshed = 0;
  for (const row of rows) {
    const report = await reportOf(db, row.conversation_id, row, read);
    if (report && (await saveSubChatReport(db, row.conversation_id, report))) refreshed += 1;
  }
  return refreshed;
}
