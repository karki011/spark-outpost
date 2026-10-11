import type { Queryable } from '../persistence/db.ts';
import { requestAnswer } from '../persistence/outpost-answers.ts';
import { getPost, listPosts, markAnswersSeen } from '../persistence/outpost-posts.ts';
import { storyTaskOf } from '../persistence/outpost-stories.ts';
import { outpostOf } from '../persistence/outposts.ts';
import { readLabels } from './read-labels.ts';
import type { PreambleDeps } from './turn-preamble.ts';

export function preambleDeps(db: Queryable, workspaceId: string): PreambleDeps {
  return {
    db,
    labels: readLabels,
    stores: {
      outpostOf,
      listPosts,
      getPost,
      storyTaskOf,
      markAnswersSeen,
      answerOf: (queryable, request) => requestAnswer(queryable, workspaceId, request),
    },
  };
}
