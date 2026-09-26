import path from 'node:path';
import type * as acp from '@agentclientprotocol/sdk';

export interface SessionRequestInput {
  agentName: string;
  cwd: string;
  extraRoots: readonly string[];
  meta: Record<string, unknown> | null;
  init: acp.InitializeResponse;
}

export interface SessionRequestPlan {
  request: acp.NewSessionRequest;
  notes: string[];
}

export function supportsAdditionalDirectories(init: acp.InitializeResponse): boolean {
  const capability = init.agentCapabilities?.sessionCapabilities?.additionalDirectories;
  return capability !== undefined && capability !== null;
}

export function oneRepoNote(agentName: string, cwd: string): string {
  return `${agentName} can only open one repo per chat; using ${path.basename(cwd)}`;
}

export function newSessionRequest(input: SessionRequestInput): SessionRequestPlan {
  const request: acp.NewSessionRequest = { cwd: input.cwd, mcpServers: [], _meta: input.meta };
  if (input.extraRoots.length === 0) return { request, notes: [] };
  if (!supportsAdditionalDirectories(input.init)) {
    return { request, notes: [oneRepoNote(input.agentName, input.cwd)] };
  }
  return { request: { ...request, additionalDirectories: [...input.extraRoots] }, notes: [] };
}
