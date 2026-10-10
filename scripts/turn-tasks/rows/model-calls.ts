import { reportedModel } from '../../../apps/server/src/agents/acp/long-context.ts';
import { fields, type LogRow } from './types.ts';

export interface ModelCall {
  seq: number;
  model: string | null;
}

export function modelCalls(rows: readonly LogRow[]): ModelCall[] {
  return rows.flatMap((row) => {
    if (row.direction !== 'from_agent' || row.method !== 'session/update') return [];
    const update = fields(fields(fields(row.payload).params).update);
    if (update.sessionUpdate !== 'usage_update') return [];
    return [{ seq: row.seq, model: reportedModel(update._meta) }];
  });
}
