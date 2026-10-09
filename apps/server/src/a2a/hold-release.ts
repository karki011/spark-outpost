import { released } from '../outposts/dependency-release.ts';
import type { Queryable } from '../persistence/db.ts';
import { heldRequests, releaseHold } from '../persistence/outpost-posts.ts';

export async function releaseAnswered(db: Queryable): Promise<number> {
  let freed = 0;
  for (const { post, after } of await heldRequests(db)) {
    if (!released(post, after.facts)) continue;
    if (await releaseHold(db, post.id)) freed += 1;
  }
  return freed;
}
