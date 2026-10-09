import { readFileSync } from 'node:fs';
import {
  A2A_PROTOCOL_VERSION,
  A2A_VERSION_HEADER,
  AGENT_CARD_PATH,
  AgentCard,
  TaskState,
  taskStateFromJSON,
  taskStateToJSON,
} from '@a2a-js/sdk';
import {
  ClientFactory,
  ClientFactoryOptions,
  DefaultAgentCardResolver,
  JsonRpcTransportFactory,
} from '@a2a-js/sdk/client';
import { A2A_ERROR_CODE, TaskNotFoundError, UnsupportedOperationError } from '@a2a-js/sdk/errors';
import { getSupportedVersions, validateVersion } from '@a2a-js/sdk/server';
import { jsonRpcHandler, UserBuilder } from '@a2a-js/sdk/server/express';
import { describe, expect, it } from 'vitest';

const ENDPOINT = 'http://127.0.0.1:4310/api/a2a/chats/0f0e0d0c-1a2b-4c3d-8e9f-001122334455';

const card: AgentCard = {
  name: '@api · Backend',
  description: 'A chat in the outpost Orders launch.',
  version: '1',
  supportedInterfaces: [
    { url: ENDPOINT, protocolBinding: 'JSONRPC', protocolVersion: '1.0', tenant: '' },
  ],
  provider: undefined,
  capabilities: { streaming: true, pushNotifications: false, extensions: [] },
  securitySchemes: {
    launchToken: {
      scheme: {
        $case: 'apiKeySecurityScheme',
        value: { description: '', location: 'header', name: 'x-launch-token' },
      },
    },
  },
  securityRequirements: [],
  defaultInputModes: ['text/plain'],
  defaultOutputModes: ['text/plain'],
  skills: [],
  signatures: [],
};

describe('the pinned A2A SDK', () => {
  it('is pinned at exactly 1.3.0', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { dependencies: Record<string, string> };
    expect(manifest.dependencies['@a2a-js/sdk']).toBe('1.3.0');
  });

  it('implements A2A 1.0 and names the header and card path the design relies on', () => {
    expect(A2A_PROTOCOL_VERSION).toBe('1.0');
    expect(A2A_VERSION_HEADER).toBe('A2A-Version');
    expect(AGENT_CARD_PATH).toBe('.well-known/agent-card.json');
  });

  it('writes task states on the wire by their 1.0 names', () => {
    const names = [
      TaskState.TASK_STATE_SUBMITTED,
      TaskState.TASK_STATE_WORKING,
      TaskState.TASK_STATE_INPUT_REQUIRED,
      TaskState.TASK_STATE_COMPLETED,
      TaskState.TASK_STATE_FAILED,
      TaskState.TASK_STATE_REJECTED,
      TaskState.TASK_STATE_CANCELED,
      TaskState.TASK_STATE_AUTH_REQUIRED,
    ].map(taskStateToJSON);
    expect(names).toEqual([
      'TASK_STATE_SUBMITTED',
      'TASK_STATE_WORKING',
      'TASK_STATE_INPUT_REQUIRED',
      'TASK_STATE_COMPLETED',
      'TASK_STATE_FAILED',
      'TASK_STATE_REJECTED',
      'TASK_STATE_CANCELED',
      'TASK_STATE_AUTH_REQUIRED',
    ]);
    expect(taskStateFromJSON('TASK_STATE_INPUT_REQUIRED')).toBe(
      TaskState.TASK_STATE_INPUT_REQUIRED,
    );
  });

  it('accepts a call only for a version the card declares for JSON-RPC', () => {
    expect([...getSupportedVersions(card, 'JSONRPC')]).toEqual(['1.0']);
    expect(() => validateVersion('1.0', card, 'JSONRPC')).not.toThrow();
    expect(() => validateVersion('0.3', card, 'JSONRPC')).toThrow(/not supported/);
    expect(() => validateVersion('1.0', { ...card, supportedInterfaces: [] }, 'JSONRPC')).toThrow(
      /not supported/,
    );
  });

  it('keeps the security scheme of a card only when it is written with AgentCard.toJSON', () => {
    const resolver = new DefaultAgentCardResolver();
    const written = resolver.normalizeAgentCard(AgentCard.toJSON(card));
    expect(written.securitySchemes).toEqual(card.securitySchemes);
    expect(written.supportedInterfaces).toEqual(card.supportedInterfaces);
    const stringified = resolver.normalizeAgentCard(JSON.parse(JSON.stringify(card)));
    expect(stringified.securitySchemes.launchToken?.scheme).toBeUndefined();
  });

  it('exports the server, client and error pieces lane C builds on', () => {
    expect(typeof jsonRpcHandler).toBe('function');
    expect(typeof UserBuilder.noAuthentication).toBe('function');
    const factory = new ClientFactory(
      ClientFactoryOptions.createFrom(ClientFactoryOptions.default, {
        transports: [new JsonRpcTransportFactory({ fetchImpl: fetch })],
        cardResolver: new DefaultAgentCardResolver({ fetchImpl: fetch }),
      }),
    );
    expect(typeof factory.createFromUrl).toBe('function');
    expect(A2A_ERROR_CODE.TASK_NOT_FOUND).toBe(-32001);
    expect(A2A_ERROR_CODE.UNSUPPORTED_OPERATION).toBe(-32004);
    expect(A2A_ERROR_CODE.VERSION_NOT_SUPPORTED).toBe(-32009);
    expect(new TaskNotFoundError('gone')).toBeInstanceOf(Error);
    expect(new UnsupportedOperationError('no')).toBeInstanceOf(Error);
  });
});
