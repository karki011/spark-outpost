import type { Queryable } from '../persistence/db.ts';
import { introLine, taskLine } from './handshake.ts';
import { memberFacts, type MemberFacts } from './member-facts.ts';
import type { PostWithFacts, StoredOutpost } from './ports.ts';
import type { IntroView } from './post-view.ts';

function openingRequest(posts: readonly PostWithFacts[], conversationId: string): string | null {
  const found = posts.find(({ post }) => post.opening && post.toConversationId === conversationId);
  return found ? taskLine(found.post.body) : null;
}

export async function introViews(
  db: Queryable,
  outpost: StoredOutpost,
  posts: readonly PostWithFacts[],
): Promise<Map<string, IntroView>> {
  const views = new Map<string, IntroView>();
  const known = new Map<string, MemberFacts | null>();
  for (const { post } of posts) {
    const conversationId = post.fromConversationId;
    if (post.kind !== 'notice' || conversationId === null) continue;
    if (!known.has(conversationId))
      known.set(conversationId, await memberFacts(db, conversationId));
    const facts = known.get(conversationId);
    const member = outpost.members.find((joined) => joined.conversationId === conversationId);
    const handle = member?.handle ?? post.fromHandle;
    if (!facts || !handle) continue;
    views.set(post.id, {
      body: introLine({ handle, ...facts }),
      intro: { conversationId, task: openingRequest(posts, conversationId) },
    });
  }
  return views;
}
