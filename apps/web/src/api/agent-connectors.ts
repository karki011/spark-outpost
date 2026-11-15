import {
  agentConnectorsResponseSchema,
  type AgentConnectorsResponse,
} from '@spark-outpost/contracts';
import { request } from './client.ts';

export const agentConnectorsKey = ['agent-connectors'] as const;

export function fetchAgentConnectors(): Promise<AgentConnectorsResponse> {
  return request(agentConnectorsResponseSchema, '/agent-connectors');
}
