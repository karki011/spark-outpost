import { describe, expect, it } from 'vitest';
import { calendarMyStatusSchema } from '@spark-outpost/contracts';
import { replyState } from './reply-status.ts';

describe('replyState', () => {
  it('draws accepted and not-invited events filled, and each other reply its own way', () => {
    expect(replyState('accepted').look).toBe('filled');
    expect(replyState('none').look).toBe('filled');
    expect(replyState('pending').look).toBe('dashed');
    expect(replyState('tentative').look).toBe('striped');
    expect(replyState('declined').look).toBe('struck');
  });

  it('says every answered state in a distinct word and nothing for an event without a reply', () => {
    expect(replyState('accepted').word).toBe('Accepted');
    expect(replyState('pending').word).toBe('Not answered');
    expect(replyState('tentative').word).toBe('Maybe');
    expect(replyState('declined').word).toBe('Declined');
    expect(replyState('none').word).toBeNull();
  });

  it('covers every status the contract can carry', () => {
    for (const status of calendarMyStatusSchema.options) {
      expect(replyState(status).look).toMatch(/^(filled|dashed|striped|struck)$/);
    }
  });
});
