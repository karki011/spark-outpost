import { describe, expect, it } from 'vitest';
import { carriesMessageText } from './json-body.ts';

const ID = '00000000-0000-4000-8000-000000000001';

describe('routes that get the message body bound', () => {
  it('covers every route a user sends message text to', () => {
    for (const path of [
      `/api/conversations/${ID}/messages`,
      `/api/conversations/${ID}/queue`,
      `/api/conversations/${ID}/queue/send-now`,
      `/api/conversations/${ID}/queue/${ID}`,
      `/api/runs/${ID}/messages`,
      `/api/tasks/${ID}/steer`,
      `/api/tasks/${ID}/pieces/P2/notes`,
    ]) {
      expect(carriesMessageText(path), path).toBe(true);
    }
  });

  it('leaves other routes on the small bound', () => {
    for (const path of [
      '/api/conversations',
      `/api/conversations/${ID}`,
      `/api/conversations/${ID}/settings`,
      `/api/tasks/${ID}/pieces`,
      '/api/remote/pair',
    ]) {
      expect(carriesMessageText(path), path).toBe(false);
    }
  });
});
