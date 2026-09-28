import path from 'node:path';
import type * as acp from '@agentclientprotocol/sdk';
import { acpMcpServer, supportsTransport, type NamedMcpServer } from './repo-session.ts';

export interface SessionRequestInput {
  agentName: string;
  cwd: string;
  extraRoots: readonly string[];
  meta: Record<string, unknown> | null;
  init: acp.InitializeResponse;
  mcpServers?: readonly NamedMcpServer[];
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

export function unsupportedMcpNote(agentName: string, server: NamedMcpServer): string {
  return `${agentName} can't use the ${server.config.transport.toUpperCase()} MCP server ${server.name}; skipped it`;
}

function mcpPlan(input: SessionRequestInput) {
  const servers = input.mcpServers ?? [];
  const usable = servers.filter((server) => supportsTransport(input.init, server.config.transport));
  const notes = servers
    .filter((server) => !usable.includes(server))
    .map((server) => unsupportedMcpNote(input.agentName, server));
  return { servers: usable.map((server) => acpMcpServer(server)), notes };
}

export function newSessionRequest(input: SessionRequestInput): SessionRequestPlan {
  const mcp = mcpPlan(input);
  const request: acp.NewSessionRequest = {
    cwd: input.cwd,
    mcpServers: mcp.servers,
    _meta: input.meta,
  };
  if (input.extraRoots.length === 0) return { request, notes: mcp.notes };
  if (!supportsAdditionalDirectories(input.init)) {
    return { request, notes: [...mcp.notes, oneRepoNote(input.agentName, input.cwd)] };
  }
  return {
    request: { ...request, additionalDirectories: [...input.extraRoots] },
    notes: mcp.notes,
  };
}
