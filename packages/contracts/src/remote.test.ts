import { describe, expect, it } from 'vitest';
import {
  REMOTE_CARD_ANSWERING_DEFAULT,
  REMOTE_SWITCH_DEFAULTS,
  remoteHostOf,
  remoteSessionSchema,
} from './remote.ts';

describe('the host a paired device reaches', () => {
  it('reports Windows only for a Windows host', () => {
    expect(remoteHostOf('win32')).toBe('windows');
    expect(remoteHostOf('darwin')).toBe('mac');
    expect(remoteHostOf('linux')).toBe('mac');
  });

  it('reads a session from an older server that names no host', () => {
    const session = remoteSessionSchema.parse({
      remote: true,
      device: null,
      address: null,
      switches: REMOTE_SWITCH_DEFAULTS,
      cardAnswering: REMOTE_CARD_ANSWERING_DEFAULT,
      passkey: false,
    });
    expect(session.host).toBeUndefined();
  });
});
