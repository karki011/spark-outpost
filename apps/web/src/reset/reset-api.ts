import { resetReportSchema, type ResetReport } from '@spark-outpost/contracts';
import { request } from '../api/client.ts';

export function resetSparkOutpost(keepApiKeys: boolean): Promise<ResetReport> {
  return request(resetReportSchema, '/reset', {
    method: 'POST',
    body: JSON.stringify({ keepApiKeys }),
  });
}
