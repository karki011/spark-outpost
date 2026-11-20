import type * as acp from '@agentclientprotocol/sdk/unstable';
import { objectFields } from './object-fields.ts';

export function advertisesSystemPrompt(init: acp.InitializeResponse): boolean {
  const capability = init.agentCapabilities?.sessionCapabilities?.systemPrompt;
  return capability !== undefined && capability !== null;
}

export function withStableSystemPrompt(
  request: acp.NewSessionRequest,
  init: acp.InitializeResponse,
): acp.NewSessionRequest {
  const meta = objectFields(request._meta);
  const appended = objectFields(meta.systemPrompt).append;
  if (typeof appended !== 'string' || !advertisesSystemPrompt(init)) return request;
  const rest = Object.fromEntries(Object.entries(meta).filter(([key]) => key !== 'systemPrompt'));
  if (appended.trim() === '') return { ...request, _meta: rest };
  return {
    ...request,
    _meta: rest,
    systemPrompt: { mode: 'append', content: [{ type: 'text', text: appended }] },
  };
}

export function withMcpOverStdin(
  request: acp.NewSessionRequest,
  overStdin: boolean,
): acp.NewSessionRequest {
  const meta = objectFields(request._meta);
  if (!overStdin || meta.claudeCode === undefined) return request;
  const claudeCode = objectFields(meta.claudeCode);
  const options = { ...objectFields(claudeCode.options), mcpServersDelivery: 'initialize' };
  return { ...request, _meta: { ...meta, claudeCode: { ...claudeCode, options } } };
}
