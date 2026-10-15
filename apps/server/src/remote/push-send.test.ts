import { describe, expect, it } from 'vitest';
import { pushFailureReason } from './push-send.ts';

describe('a push service refusal', () => {
  it('keeps the reason Apple gives', () => {
    expect(pushFailureReason('{"reason":"BadJwtToken"}')).toBe('BadJwtToken');
  });

  it('keeps nothing from a body that is not a plain reason', () => {
    expect(pushFailureReason('<html>Forbidden</html>')).toBeNull();
    expect(pushFailureReason('{"reason":"see https://example.org"}')).toBeNull();
    expect(pushFailureReason('{"error":"x"}')).toBeNull();
    expect(pushFailureReason('null')).toBeNull();
    expect(pushFailureReason(undefined)).toBeNull();
  });
});
