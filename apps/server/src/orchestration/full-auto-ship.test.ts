import { describe, expect, it } from 'vitest';
import { shipFailureLine } from './full-auto-ship.ts';

describe('shipFailureLine', () => {
  it('names the failure whatever was thrown', () => {
    expect(shipFailureLine(new Error('push rejected'))).toBe(
      'Full auto → PR kept the change but could not ship it: push rejected',
    );
    expect(shipFailureLine('gh missing')).toBe(
      'Full auto → PR kept the change but could not ship it: gh missing',
    );
    expect(shipFailureLine(null)).toBe(
      'Full auto → PR kept the change but could not ship it: null',
    );
  });
});
