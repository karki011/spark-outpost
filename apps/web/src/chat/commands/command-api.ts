import { commandOutputResponseSchema, type CommandOutputResponse } from '@spark-outpost/contracts';
import { request } from '../../api/client.ts';

export const commandOutputKey = (runId: string, id: string, running: boolean) =>
  ['command-output', runId, id, running ? 'running' : 'ended'] as const;

export function fetchCommandOutput(runId: string, id: string): Promise<CommandOutputResponse> {
  return request(commandOutputResponseSchema, `/runs/${runId}/commands/${id}/output`);
}
