import {
  githubReviewListSchema,
  githubReviewSchema,
  type GithubReview,
} from '@spark-outpost/contracts';
import { request } from '../../api/client.ts';

export const reviewKeys = {
  pull: (pull: string) => ['github', 'reviews', pull] as const,
};

export const reviewApi = {
  list: async (pull: string): Promise<GithubReview[]> => {
    const query = new URLSearchParams({ pull });
    const list = await request(githubReviewListSchema, `/github/reviews?${query.toString()}`);
    return list.reviews;
  },
  request: (pull: string): Promise<GithubReview> =>
    request(githubReviewSchema, '/github/reviews', {
      method: 'POST',
      body: JSON.stringify({ pull }),
    }),
  stop: (id: string): Promise<GithubReview> =>
    request(githubReviewSchema, `/github/reviews/${encodeURIComponent(id)}/stop`, {
      method: 'POST',
      body: '{}',
    }),
};
