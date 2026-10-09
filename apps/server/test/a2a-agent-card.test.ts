import { AgentCard } from '@a2a-js/sdk';
import { DefaultAgentCardResolver } from '@a2a-js/sdk/client';
import { getSupportedVersions, validateVersion } from '@a2a-js/sdk/server';
import { API_TOKEN_HEADER } from '@spark-outpost/contracts';
import { describe, expect, it } from 'vitest';
import { a2aBaseUrl, agentCard, chatEndpoint, type CardFacts } from '../src/a2a/agent-card.ts';

const CHAT_ID = '0f0e0d0c-1a2b-4c3d-8e9f-001122334455';
const BASE = a2aBaseUrl(4310);

const member: CardFacts = {
  conversationId: CHAT_ID,
  title: 'Backend',
  handle: 'api',
  outpostName: 'Orders launch',
  projects: ['orders-api', 'billing'],
};

const plain: CardFacts = { ...member, handle: null, outpostName: null, projects: [] };

describe('a chat’s Agent Card', () => {
  it('names the chat by handle and title and says which outpost it is in', () => {
    const card = agentCard(member, BASE);
    expect(card.name).toBe('@api · Backend');
    expect(card.description).toContain('"Orders launch"');
    expect(agentCard(plain, BASE).name).toBe('Backend');
    expect(agentCard(plain, BASE).description).not.toContain('outpost');
  });

  it('declares one JSON-RPC 1.0 interface at the chat’s own loopback endpoint', () => {
    const card = agentCard(member, BASE);
    expect(card.supportedInterfaces).toEqual([
      {
        url: `http://127.0.0.1:4310/api/a2a/chats/${CHAT_ID}`,
        protocolBinding: 'JSONRPC',
        protocolVersion: '1.0',
        tenant: '',
      },
    ]);
    expect(card.supportedInterfaces[0]?.url).toBe(chatEndpoint(BASE, CHAT_ID));
    expect([...getSupportedVersions(card, 'JSONRPC')]).toEqual(['1.0']);
    expect(() => validateVersion('1.0', card, 'JSONRPC')).not.toThrow();
    expect(() => validateVersion('0.3', card, 'JSONRPC')).toThrow(/not supported/);
  });

  it('claims streaming and nothing it does not serve', () => {
    const card = agentCard(member, BASE);
    expect(card.capabilities).toEqual({
      streaming: true,
      pushNotifications: false,
      extendedAgentCard: false,
      extensions: [],
    });
    expect(card.defaultInputModes).toEqual(['text/plain']);
    expect(card.defaultOutputModes).toEqual(['text/plain']);
    expect(card.signatures).toEqual([]);
    expect(card.description).toContain('answered by the user in Spark');
  });

  it('has one skill that names the chat’s projects', () => {
    const [skill, ...others] = agentCard(member, BASE).skills;
    expect(others).toEqual([]);
    expect(skill?.description).toContain('orders-api, billing');
    expect(skill?.tags).toEqual(['outpost', 'orders-api', 'billing']);
    expect(agentCard(plain, BASE).skills[0]?.description).toContain('no linked project');
  });

  it('requires the launch token as an API key header and carries no value for it', () => {
    const card = agentCard(member, BASE);
    expect(card.securitySchemes.launchToken?.scheme).toEqual({
      $case: 'apiKeySecurityScheme',
      value: {
        description: expect.any(String),
        location: 'header',
        name: API_TOKEN_HEADER,
      },
    });
    expect(card.securityRequirements).toEqual([{ schemes: { launchToken: { list: [] } } }]);
  });

  it('holds no secret and no filesystem path', () => {
    const written = JSON.stringify(AgentCard.toJSON(agentCard(member, BASE)));
    expect(written).not.toMatch(/\/Users\/|\/home\/|\/tmp\//);
    expect(written).not.toMatch(/token["']?\s*[:=]\s*["'][A-Za-z0-9_-]{16,}/);
    expect(Object.keys(AgentCard.toJSON(agentCard(member, BASE)) as object).sort()).toEqual([
      'capabilities',
      'defaultInputModes',
      'defaultOutputModes',
      'description',
      'name',
      'securityRequirements',
      'securitySchemes',
      'skills',
      'supportedInterfaces',
      'version',
    ]);
  });

  it('reads back through the SDK resolver in its wire form', () => {
    const card = agentCard(member, BASE);
    const read = new DefaultAgentCardResolver().normalizeAgentCard(AgentCard.toJSON(card));
    expect(read.name).toBe(card.name);
    expect(read.supportedInterfaces).toEqual(card.supportedInterfaces);
    expect(read.securitySchemes).toEqual(card.securitySchemes);
    expect(read.capabilities?.streaming).toBe(true);
    expect(read.capabilities?.pushNotifications).toBe(false);
  });
});
