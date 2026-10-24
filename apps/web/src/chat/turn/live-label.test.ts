import { describe, expect, it } from 'vitest';
import { liveLabel } from './live-label.ts';

const command = (status: 'running' | 'completed', description: string | null = null) => ({
  status,
  description,
  command: 'python3 -c "import time; time.sleep(9)"',
});

describe('liveLabel', () => {
  it('names a working sub-agent first, then the running command', () => {
    expect(liveLabel([{ state: 'working' }], [command('running')])).toBe('Running agent');
    expect(liveLabel([{ state: 'working' }, { state: 'working' }], [])).toBe('Running 2 agents');
    expect(liveLabel([{ state: 'done' }], [command('running')])).toBe('Running python3…');
    expect(liveLabel([], [command('running', 'Wait for the build')])).toBe(
      'Running Wait for the build',
    );
  });

  it('says Working when nothing named is running', () => {
    expect(liveLabel([], [command('completed')])).toBe('Working');
  });
});
