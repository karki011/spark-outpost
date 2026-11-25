import type { SetupTarget } from '@spark-outpost/contracts';

export const PROVIDER_SETUPS: readonly SetupTarget[] = ['claude', 'codex', 'zai', 'custom'];

export const CONNECTOR_SETUPS: readonly SetupTarget[] = [
  'atlassian',
  'servicenow',
  'linear',
  'github',
  'slack',
  'google_calendar',
  'microsoft_calendar',
  'zoom',
  'mcp_sign_in',
];
