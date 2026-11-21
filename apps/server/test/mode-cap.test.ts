import { describe, expect, it } from 'vitest';
import { proposedAboveOwnMode } from '../src/sub-chats/mode-cap.ts';

describe('the mode a sub-chat may start in', () => {
  it('names the sub-chat in the refusal', () => {
    expect(proposedAboveOwnMode('“Orders page”')).toContain('“Orders page” cannot be proposed');
  });
});
