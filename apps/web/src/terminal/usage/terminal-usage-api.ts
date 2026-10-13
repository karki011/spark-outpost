import { nativeTerminalUsageSchema } from '@spark-outpost/contracts';
import { request } from '../../api/client.ts';

export const terminalUsageQuery = (conversationId: string) => ({
  queryKey: ['native-terminal', conversationId, 'usage'] as const,
  queryFn: () =>
    request(nativeTerminalUsageSchema, `/conversations/${conversationId}/terminal/usage`),
  refetchInterval: 2000,
});
