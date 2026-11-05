import { z } from 'zod';
import type { ShipPreview } from '@spark-outpost/contracts';
import { redactText } from '../audit/redact.ts';
import type { StoredFeedback, Watch } from '../persistence/pr-watches.ts';
import { getTaskShip, saveTaskShip } from '../persistence/task-ships.ts';
import { repoPath, type GitHubConnection } from '../ship/github/connection.ts';
import type { ShipDeps } from '../ship/prepare.ts';
import { shipPreview, shipTask } from '../ship/service.ts';
import { SPARK_REPLY_MARKER } from './gather.ts';
import { noteKind, noteText } from './prompt.ts';

const replySchema = z.object({ id: z.number().int() });

export class FollowUpBlocked extends Error {}

async function continuePullRequest(deps: ShipDeps, watch: Watch, taskId: string) {
  if (taskId === watch.taskId || (await getTaskShip(deps.db, taskId))) return;
  const ship = await getTaskShip(deps.db, watch.taskId);
  if (ship) await saveTaskShip(deps.db, taskId, ship);
}

export async function pendingPush(
  deps: ShipDeps,
  watch: Watch,
  taskId: string,
): Promise<ShipPreview | null> {
  await continuePullRequest(deps, watch, taskId);
  const preview = await shipPreview(deps, taskId);
  if (preview.blocked?.reason === 'nothing_new') return null;
  if (preview.blocked) throw new FollowUpBlocked(preview.blocked.message);
  if (preview.branch !== watch.branch) {
    throw new FollowUpBlocked(
      `The changes are on ${preview.branch}, not the PR branch ${watch.branch}, so Spark did not push them.`,
    );
  }
  if (!preview.modes.includes('push')) {
    throw new FollowUpBlocked(preview.notes[0] ?? 'Spark cannot push this branch.');
  }
  return preview.files.length > 0 ? preview : null;
}

export async function pushRound(
  deps: ShipDeps,
  watch: Watch,
  taskId: string,
): Promise<string | null> {
  if (!(await pendingPush(deps, watch, taskId))) return null;
  const result = await shipTask(deps, taskId, {
    mode: 'push',
    title: `Address review feedback on #${watch.number}`,
  });
  return result.commit;
}

export function replyText(item: StoredFeedback, note: string | null, commit: string | null) {
  const kind = noteKind(note, item.triage === 'question');
  if (kind === 'left' || note === null) return null;
  const text = noteText(note);
  if (kind === 'answer') return text || null;
  if (kind === 'pushed_back') return text ? `Not changed: ${text}` : null;
  if (!commit) return null;
  return text ? `Fixed in ${commit}: ${text}` : `Fixed in ${commit}.`;
}

export async function postReply(
  connection: GitHubConnection,
  watch: Watch,
  item: StoredFeedback,
  reply: string,
): Promise<string> {
  const text = redactText(reply);
  const repo = { owner: watch.owner, name: watch.repo };
  const pull = `${repoPath(repo)}/pulls/${watch.number}`;
  if (item.kind === 'review_comment') {
    const posted = await connection.post(
      `${pull}/comments/${item.githubId}/replies`,
      { body: `${text}\n\n${SPARK_REPLY_MARKER}` },
      replySchema,
      'replying to the review comment',
    );
    return String(posted.id);
  }
  const quote = item.body.split('\n')[0]!.slice(0, 200);
  const body = `> ${quote}\n\n@${item.author} ${text}\n\n${SPARK_REPLY_MARKER}`;
  const posted = await connection.post(
    `${repoPath(repo)}/issues/${watch.number}/comments`,
    { body },
    replySchema,
    'commenting on the pull request',
  );
  return String(posted.id);
}
