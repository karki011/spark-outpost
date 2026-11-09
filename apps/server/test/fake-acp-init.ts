import type * as acp from '@agentclientprotocol/sdk/unstable';

export const FAKE_AGENT_INFO = { name: '@fake/fake-acp-agent', title: 'Fake', version: '1.2.3' };

export function fakeMcpCapabilities(): Pick<acp.AgentCapabilities, 'mcpCapabilities'> {
  const configured = process.env.FAKE_ACP_MCP_CAPABILITIES;
  return configured ? { mcpCapabilities: JSON.parse(configured) as acp.McpCapabilities } : {};
}
