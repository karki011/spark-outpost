import { onEach, type Pair } from './pair-types.ts';

const GROUP = 'Command terminal';

export const COMMANDS: Pair[] = [
  ...onEach(GROUP, 'command.failed-state', 'var(--danger)', ['code'], 'text'),
  ...onEach(GROUP, 'command.passed-mark', 'var(--accent)', ['code'], 'ui'),
  ...onEach(GROUP, 'command.waiting-mark', 'var(--warn)', ['code'], 'ui'),
  ...onEach(GROUP, 'command.interrupted-mark', 'var(--muted)', ['code'], 'ui'),
  ...onEach(GROUP, 'command.focus-ring', 'var(--accent)', ['code'], 'focus'),
];
