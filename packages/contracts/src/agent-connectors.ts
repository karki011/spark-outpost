import { z } from 'zod';

export const agentConnectorIdSchema = z.enum([
  'github',
  'jira',
  'confluence',
  'linear',
  'servicenow',
  'slack',
  'calendar',
]);
export type AgentConnectorId = z.infer<typeof agentConnectorIdSchema>;

export const agentConnectorStateSchema = z.enum(['on', 'switch_off', 'not_connected']);
export type AgentConnectorState = z.infer<typeof agentConnectorStateSchema>;

export const agentConnectorSchema = z.object({
  id: agentConnectorIdSchema,
  state: agentConnectorStateSchema,
});
export type AgentConnector = z.infer<typeof agentConnectorSchema>;

export const agentConnectorsResponseSchema = z.object({
  connectors: z.array(agentConnectorSchema),
});
export type AgentConnectorsResponse = z.infer<typeof agentConnectorsResponseSchema>;
