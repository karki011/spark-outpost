import { onEach, SURFACES, type Pair } from './pair-types.ts';

const GROUP = 'Phone';
const FRESH_ROW = SURFACES.selected;
const RING_TONES = { running: 'var(--accent)', expiring: 'var(--warn)' };

const countdownRing: Pair[] = Object.entries(RING_TONES).flatMap(([state, tone]) => [
  {
    id: `phone.ring-${state}`,
    group: GROUP,
    label: `countdown ring, ${state}`,
    fg: tone,
    bg: SURFACES.panel,
    kind: 'ui' as const,
  },
  {
    id: `phone.ring-${state}-on-track`,
    group: GROUP,
    label: `countdown ring against its track, ${state}`,
    fg: tone,
    bg: [`color-mix(in srgb, ${tone} 25%, var(--panel))`],
    kind: 'ui' as const,
  },
]);

export const PHONE: Pair[] = [
  {
    id: 'phone.qr',
    group: GROUP,
    label: 'QR ink on QR paper',
    fg: 'var(--qr-ink)',
    bg: ['var(--qr-paper)'],
    kind: 'text',
  },
  ...onEach(GROUP, 'phone.dot-off', 'var(--line-strong)', ['panel'], 'ui'),
  ...onEach(GROUP, 'phone.dot-on', 'var(--success)', ['panel'], 'ui'),
  ...onEach(GROUP, 'phone.dot-setup', 'var(--warn)', ['panel'], 'ui'),
  ...onEach(GROUP, 'phone.dot-error', 'var(--danger)', ['panel'], 'ui'),
  ...countdownRing,
  ...onEach(GROUP, 'phone.countdown-expiring', 'var(--warn)', ['panel'], 'text'),
  ...onEach(GROUP, 'phone.codes', 'var(--text)', ['panel', 'code'], 'text'),
  ...onEach(GROUP, 'phone.connected', 'var(--success)', ['panel'], 'text'),
  {
    id: 'phone.connected-on-fresh-row',
    group: GROUP,
    label: 'Connected on a just-paired row',
    fg: 'var(--success)',
    bg: FRESH_ROW,
    kind: 'text',
  },
  {
    id: 'phone.revoke-on-fresh-row',
    group: GROUP,
    label: 'Revoke on a just-paired row',
    fg: 'var(--danger)',
    bg: FRESH_ROW,
    kind: 'text',
  },
  ...onEach(GROUP, 'phone.revoke', 'var(--danger)', ['panel'], 'text'),
  ...onEach(GROUP, 'phone.scene-glyph', 'var(--muted)', ['panel'], 'ui'),
  ...onEach(GROUP, 'phone.scout-body', 'var(--accent)', ['panel'], 'ui'),
  {
    id: 'phone.scout-eyes',
    group: GROUP,
    label: 'scout eyes on its body',
    fg: 'var(--scout-eye)',
    bg: ['var(--accent)'],
    kind: 'ui',
  },
  ...onEach(GROUP, 'phone.pairing-field-text', 'var(--text)', ['canvas'], 'text'),
  ...onEach(GROUP, 'phone.pairing-placeholder', 'var(--faint)', ['canvas'], 'text'),
  ...onEach(GROUP, 'phone.pairing-error', 'var(--danger)', ['panel'], 'text'),
  {
    id: 'phone.pairing-button',
    group: GROUP,
    label: 'pairing page button label',
    fg: 'var(--accent-ink)',
    bg: ['var(--accent)'],
    kind: 'text',
  },
];
