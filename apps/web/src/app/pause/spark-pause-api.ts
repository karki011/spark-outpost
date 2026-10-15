import { sparkPauseSchema, type SparkPause } from '@spark-outpost/contracts';
import { request } from '../../api/client.ts';

export const sparkPauseKey = ['spark-pause'] as const;

export const sparkPauseApi = {
  get: (): Promise<SparkPause> => request(sparkPauseSchema, '/spark-pause'),
  set: (paused: boolean): Promise<SparkPause> =>
    request(sparkPauseSchema, '/spark-pause', {
      method: 'PUT',
      body: JSON.stringify({ paused }),
    }),
};
