import {
  githubReviewSettingsSchema,
  type GithubReviewSettings,
  type GithubReviewSettingsUpdate,
} from '@spark-outpost/contracts';
import { request } from '../api/client.ts';

export const reviewSettingsKey = ['github', 'review-settings'] as const;

export const reviewSettingsApi = {
  get: (): Promise<GithubReviewSettings> =>
    request(githubReviewSettingsSchema, '/github/review-settings'),
  save: (body: GithubReviewSettingsUpdate): Promise<GithubReviewSettings> =>
    request(githubReviewSettingsSchema, '/github/review-settings', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
};
