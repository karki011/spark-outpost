import { describe, expect, it, vi } from 'vitest';
import { onPaneUrl, queuePaneUrl, takePaneUrl } from './pending-pane-url.ts';

describe('a page waiting for its chat pane', () => {
  it('is taken once, by its own chat, with the latest address winning', () => {
    const heard = vi.fn();
    const stop = onPaneUrl(heard);
    queuePaneUrl('a', 'http://localhost:3000/');
    queuePaneUrl('a', 'http://localhost:5173/');
    expect(heard).toHaveBeenCalledTimes(2);
    expect(takePaneUrl('b')).toBeNull();
    expect(takePaneUrl('a')).toBe('http://localhost:5173/');
    expect(takePaneUrl('a')).toBeNull();
    stop();
    queuePaneUrl('a', 'http://localhost:4000/');
    expect(heard).toHaveBeenCalledTimes(2);
    takePaneUrl('a');
  });
});
