import {
  ghPrefixProblem,
  type Approval,
  type SparkRuleAnswer,
  type SparkRuleRefusal,
} from '@spark-outpost/contracts';
import { addToQueue } from '../persistence/chat-queue.ts';
import {
  ApprovalConflictError,
  ApprovalInputError,
  ApprovalNotFoundError,
  notifyApprovalChanged,
  toApproval,
  type ApprovalRow,
} from '../persistence/approvals.ts';
import { withTransaction, type Db, type Queryable } from '../persistence/db.ts';
import { newId } from '../persistence/ids.ts';
import { allowGhPrefix, saveSparkRules } from '../persistence/spark-rules.ts';
import { drainQueue, type ResolveTarget } from './queue-drain.ts';

export function retryMessage(command: string, rule: SparkRuleRefusal, answer: SparkRuleAnswer) {
  const allowed =
    answer === 'allow_once'
      ? 'the user allowed it once, for this command only'
      : rule.group === 'workflows'
        ? 'the user set Run a workflow to follow your mode'
        : `the user added ${rule.prefix} to the allowed commands`;
  return `Spark rules now allow the command Spark refused (${allowed}). Run it again:\n\n\`${command}\``;
}

interface Answered {
  card: Approval;
  conversationId: string;
  retries: boolean;
}

async function lockedCard(client: Queryable, workspaceId: string, id: string) {
  const { rows } = await client.query<ApprovalRow & { conversation_id: string }>(
    `SELECT a.*, r.conversation_id FROM approvals a
     JOIN runs r ON r.id = a.run_id
     JOIN conversations c ON c.id = r.conversation_id
     WHERE a.id = $1 AND c.workspace_id = $2 AND a.decided_by = 'policy'
       AND a.payload ? 'sparkRule'
     FOR UPDATE OF a`,
    [id, workspaceId],
  );
  return rows[0] ?? null;
}

async function allowGroup(client: Queryable, workspaceId: string, rule: SparkRuleRefusal) {
  if (rule.group === 'workflows') {
    await saveSparkRules(client, workspaceId, { workflows: 'mode' });
    return;
  }
  const problem = ghPrefixProblem(rule.prefix);
  if (problem) throw new ApprovalInputError(`${rule.prefix} can't be added: ${problem}`);
  if (!(await allowGhPrefix(client, workspaceId, rule.prefix))) {
    throw new ApprovalInputError('Spark rules hold 20 allowed commands. Remove one first.');
  }
}

export async function answerRuleCard(
  db: Db,
  workspaceId: string,
  id: string,
  answer: SparkRuleAnswer,
  resolveTarget: ResolveTarget,
): Promise<Approval> {
  const answered = await withTransaction(db, async (client): Promise<Answered> => {
    const row = await lockedCard(client, workspaceId, id);
    const rule = row?.payload.sparkRule;
    const command = row?.payload.command;
    if (!row || !rule || !command) throw new ApprovalNotFoundError();
    if (row.rule_answer) throw new ApprovalConflictError('This card was already answered.');
    if (answer === 'allow_group') await allowGroup(client, workspaceId, rule);
    await client.query('UPDATE approvals SET rule_answer = $2 WHERE id = $1', [id, answer]);
    const retries = answer !== 'keep';
    if (retries) {
      await addToQueue(client, row.conversation_id, {
        id: newId(),
        content: retryMessage(command, rule, answer),
        sparkRuleCardId: id,
      });
    }
    await notifyApprovalChanged(client, id);
    return {
      card: toApproval({ ...row, rule_answer: answer }),
      conversationId: row.conversation_id,
      retries,
    };
  });
  if (answered.retries) {
    await drainQueue(db, answered.conversationId, resolveTarget).catch((error: unknown) => {
      console.error('Could not send the Spark rules retry', error);
    });
  }
  return answered.card;
}
