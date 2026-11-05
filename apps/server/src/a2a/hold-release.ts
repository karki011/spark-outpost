import { released } from '../outposts/dependency-release.ts';
import type { HeldRequest } from '../outposts/ports.ts';
import type { ParentWorkReady } from '../outposts/stacked-parent-work.ts';
import type { Queryable } from '../persistence/db.ts';
import { heldRequests, releaseHold } from '../persistence/outpost-posts.ts';
import { chatSparkPaused } from '../persistence/spark-pause.ts';

async function parentReady(held: HeldRequest, ready?: ParentWorkReady): Promise<boolean> {
  if (!ready) return true;
  try {
    return await ready(held.post, held.after.post);
  } catch (error) {
    const reason = error instanceof Error ? error.name : 'unknown error';
    console.error(
      `Outpost request ${held.post.id} stays held: its parent's work was not committed (${reason}).`,
    );
    return false;
  }
}

async function sparkHolds(db: Queryable, held: HeldRequest): Promise<boolean> {
  const chatId = held.post.toConversationId;
  return chatId !== null && (await chatSparkPaused(db, chatId));
}

export async function releaseAnswered(db: Queryable, ready?: ParentWorkReady): Promise<number> {
  let freed = 0;
  for (const held of await heldRequests(db)) {
    if (!released(held.post, held.after.facts)) continue;
    if (await sparkHolds(db, held)) continue;
    if (!(await parentReady(held, ready))) continue;
    if (await releaseHold(db, held.post.id)) freed += 1;
  }
  return freed;
}
