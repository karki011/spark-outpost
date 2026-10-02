import type { Pair } from './pair-types.ts';

const ISLAND = ['var(--panel)'];
const CARD = ['color-mix(in srgb, var(--raise) 70%, var(--panel))'];
const BUTTON = [...CARD, 'color-mix(in srgb, var(--text) 7%, transparent)'];
const TILE = [
  'color-mix(in srgb, var(--text) 4%, color-mix(in srgb, var(--raise) 70%, var(--panel)))',
  'color-mix(in srgb, var(--text) 9%, color-mix(in srgb, var(--raise) 70%, var(--panel)))',
];

const pair = (
  id: string,
  label: string,
  fg: string,
  bg: string[],
  kind: Pair['kind'] = 'text',
): Pair => ({
  id: `island.${id}`,
  group: 'Desktop companion',
  label,
  fg,
  bg,
  kind,
});

export const ISLAND_PAIRS: Pair[] = [
  pair('wing-label', 'wing label on the island', 'var(--text)', ISLAND),
  pair('wing-meta', 'wing status on the island', 'var(--muted)', ISLAND),
  pair('key-hint', 'keyboard hint under a card', 'var(--faint)', ISLAND),
  pair('badge', 'needs-you count badge', 'var(--warn-ink)', ['var(--warn)']),
  pair('badge-done', 'finished check badge', 'var(--accent-ink)', ['var(--success)']),
  pair('badge-failed', 'failed ! badge', 'var(--panel)', ['var(--danger)']),
  pair('button-label', 'secondary button label on a card', 'var(--text)', BUTTON),
  pair('button-primary', 'Allow once and Send labels', 'var(--accent-ink)', ['var(--accent)']),
  pair('command', 'command in an approval card', 'var(--text)', ['var(--code)']),
  pair('command-dim', 'working folder before a command', 'var(--faint)', ['var(--code)']),
  pair('danger-line', 'force-push and failure line on a card', 'var(--danger)', CARD),
  pair('waiting-chip', 'Waiting for you chip in sessions', 'var(--warn)', ISLAND),
  pair('working-chip', 'Working chip in sessions', 'var(--accent-text)', ISLAND),
  pair('failed-chip', 'Failed chip in sessions', 'var(--danger)', ISLAND),
  pair('quick-tag', 'new chat tag on the live row', 'var(--accent-text)', [
    ...ISLAND,
    'var(--accent-soft)',
  ]),
  pair('hover-row-meta', 'status and time in the hover list', 'var(--muted)', [
    ...ISLAND,
    'color-mix(in srgb, var(--text) 7%, transparent)',
    'color-mix(in srgb, var(--warn) 14%, transparent)',
  ]),
  pair('hover-row-waiting', 'needs-you row in the hover list', 'var(--text)', [
    ...ISLAND,
    'color-mix(in srgb, var(--warn) 14%, transparent)',
  ]),
  pair('hover-row-failed', 'failed status in the hover list', 'var(--danger)', ISLAND),
  pair('tip', 'session blob tooltip status', 'var(--muted)', ['var(--panel)']),
  pair('ask-question', 'your question in Ask', 'var(--user-text)', ['var(--user)']),
  pair('peek-badge-ring', 'waiting badge on the peeking blob', 'var(--warn)', ISLAND, 'ui'),
  pair('scout', 'Scout on the island', 'var(--accent)', ISLAND, 'ui'),
  pair('focus', 'focus ring around a card or blob', 'var(--accent)', CARD, 'focus'),
  pair('tab-icon', 'Home, Chats and New tab icons', 'var(--muted)', ISLAND, 'ui'),
  pair('chimes-on', 'chimes button while on', 'var(--accent-text)', ISLAND, 'ui'),
  pair('now-title', 'session title on the Now card', 'var(--text)', CARD),
  pair('now-meta', 'agent, step count and older steps on the Now card', 'var(--muted)', CARD),
  pair('now-active', 'marker of the step in progress', 'var(--accent-text)', CARD, 'ui'),
  pair('now-failed', 'marker of a failed step', 'var(--danger)', CARD, 'ui'),
  pair('tile-label', 'Spark name on a Home tile', 'var(--text)', TILE),
];
