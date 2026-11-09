import { describe, expect, it } from 'vitest';
import { addressOrigin, textWithAddressOrigins, withAddressOrigins } from './address-origins.ts';

const SECRET = 'sk-live-4f9a8b7c6d5e';
const URL = `https://auth.example.com:8443/authorize?client_id=docs&token=${SECRET}#x`;
const ORIGIN = 'https://auth.example.com:8443';

describe('addresses a paired device is shown', () => {
  it('keeps only the scheme, host and port', () => {
    expect(addressOrigin(URL)).toBe(ORIGIN);
    expect(addressOrigin('not an address')).toBe('');
  });

  it('cuts a card’s address wherever the card sits, and leaves the rest', () => {
    const card = {
      title: 'Open this address?',
      payload: {
        command: null,
        openAddress: { url: URL, host: 'auth.example.com:8443', message: 'Hi' },
      },
    };
    const shown = withAddressOrigins({ approvals: [card], other: { url: URL } });
    expect(shown).toEqual({
      approvals: [
        {
          ...card,
          payload: { ...card.payload, openAddress: { ...card.payload.openAddress, url: ORIGIN } },
        },
      ],
      other: { url: URL },
    });
  });

  it('cuts the address in an agent’s url elicitation as the audit logs it', () => {
    const logged = {
      method: 'elicitation/create',
      params: { mode: 'url', url: URL, elicitationId: 'mcp-oauth-1', message: 'Hi' },
    };
    expect(JSON.stringify(withAddressOrigins(logged))).not.toContain(SECRET);
  });

  it('cuts addresses in streamed event and log lines, with no path, query or secret', () => {
    const card = { openAddress: { url: URL, host: 'auth.example.com:8443', message: '' } };
    const text = `id: 3\ndata: ${JSON.stringify({ event: { approval: { payload: card } } })}\n\n${JSON.stringify(card)}\n`;
    const shown = textWithAddressOrigins(text);
    expect(shown).not.toContain(SECRET);
    expect(shown).not.toContain('/authorize');
    expect(shown).toContain(`"url":"${ORIGIN}"`);
    expect(shown.startsWith('id: 3\ndata: {')).toBe(true);
    expect(textWithAddressOrigins(': keep-alive\n\n')).toBe(': keep-alive\n\n');
  });
});
