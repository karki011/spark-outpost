import { describe, expect, it } from 'vitest';
import { addressCard, OPEN_ADDRESS_TITLE } from './address-card.ts';

const ask = {
  toolCallId: 'elicitation:1',
  rpcId: '4',
  agent: 'Codex',
  url: 'https://auth.example.com/authorize?client_id=docs',
  message: '  Authenticate with MCP server docs  ',
  secretFiles: [],
};

describe('the Open this address card', () => {
  it('names the host and keeps the agent’s message apart from the address', () => {
    const card = addressCard('run-1', ask, []);
    expect(card).toMatchObject({
      kind: 'other',
      title: OPEN_ADDRESS_TITLE,
      options: [
        { optionId: 'open', name: 'Open', kind: 'allow_once' },
        { optionId: 'dont', kind: 'reject_once' },
      ],
      payload: {
        openAddress: {
          url: ask.url,
          host: 'auth.example.com',
          message: 'Authenticate with MCP server docs',
        },
      },
    });
    expect(card.payload.secretSend).toBeUndefined();
    expect(card.payload.observed).toBeUndefined();
  });

  it('holds to confirm when the address holds a secret value, and notes what was read', () => {
    const card = addressCard('run-1', { ...ask, secretFiles: ['.env'] }, ['web page a.test']);
    expect(card.payload).toMatchObject({
      secretSend: ['.env'],
      observed: ['web page a.test'],
      sendsTo: 'to auth.example.com',
    });
  });

  it('cuts a long message', () => {
    const card = addressCard('run-1', { ...ask, message: 'x'.repeat(5000) }, []);
    expect(card.payload.openAddress?.message).toHaveLength(1000);
  });
});
