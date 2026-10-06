import { commandOutputResponseSchema, type CommandOutputResponse } from '@spark-outpost/contracts';
import { request } from '../../api/client.ts';

export const commandOutputKey = (runId: string, id: string) =>
  ['command-output', runId, id] as const;

export function fetchCommandOutput(runId: string, id: string): Promise<CommandOutputResponse> {
  return request(commandOutputResponseSchema, `/runs/${runId}/commands/${id}/output`);
}
