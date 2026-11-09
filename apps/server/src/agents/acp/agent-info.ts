import type { InitializeResponse } from '@agentclientprotocol/sdk/unstable';
import { z } from 'zod';
import type { ProviderOutput } from '../../providers/provider.ts';

const printable = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .regex(/^[\x20-\x7e]+$/);

const agentInfoSchema = z.object({
  name: printable(200),
  version: printable(100),
});

export function agentInfoOutputs(init: Pick<InitializeResponse, 'agentInfo'>): ProviderOutput[] {
  const parsed = agentInfoSchema.safeParse(init.agentInfo);
  if (!parsed.success) return [];
  return [{ kind: 'agent_info', ...parsed.data }];
}
