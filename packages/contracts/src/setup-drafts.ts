import { z } from 'zod';

export const setupTargetSchema = z.enum([
  'claude',
  'codex',
  'zai',
  'custom',
  'atlassian',
  'servicenow',
  'linear',
  'github',
  'slack',
  'google_calendar',
  'microsoft_calendar',
  'zoom',
  'mcp_sign_in',
]);
export type SetupTarget = z.infer<typeof setupTargetSchema>;

export const SETUP_FIELD_MAX = 2048;

interface SetupTargetFacts {
  name: string;
  fields: readonly string[];
  place: string;
  route: string;
  finish: string;
}

const CONNECTORS = { place: 'Settings → Connectors', route: '#/settings/tools' };
const provider = (id: string) => ({
  place: 'Settings → AI providers',
  route: `#/settings/providers/${id}`,
});

export const setupTargets: Record<SetupTarget, SetupTargetFacts> = {
  claude: {
    name: 'Claude',
    fields: ['method'],
    ...provider('claude'),
    finish: 'Sign in with the Claude CLI or type your API key, then Connect.',
  },
  codex: {
    name: 'Codex',
    fields: ['method'],
    ...provider('codex'),
    finish: 'Sign in with the Codex CLI or type your API key, then Connect.',
  },
  zai: { name: 'Z.ai', fields: [], ...provider('zai'), finish: 'Type your Z.ai API key.' },
  custom: {
    name: 'Custom endpoint',
    fields: ['baseUrl', 'model', 'fastModel', 'keyHeader'],
    ...provider('custom'),
    finish: 'Type the endpoint’s API key, then Connect.',
  },
  atlassian: {
    name: 'Atlassian',
    fields: ['siteUrl', 'email'],
    ...CONNECTORS,
    finish: 'Type your Atlassian API token, then Connect.',
  },
  servicenow: {
    name: 'ServiceNow',
    fields: ['instanceUrl', 'username', 'authKind'],
    ...CONNECTORS,
    finish: 'Type your ServiceNow password or API key, then Connect.',
  },
  linear: { name: 'Linear', fields: [], ...CONNECTORS, finish: 'Type your Linear API key.' },
  github: { name: 'GitHub', fields: [], ...CONNECTORS, finish: 'Connect GitHub yourself.' },
  slack: { name: 'Slack', fields: [], ...CONNECTORS, finish: 'Connect Slack yourself.' },
  google_calendar: {
    name: 'Google Calendar',
    fields: [],
    ...CONNECTORS,
    finish: 'Sign in to Google in your browser.',
  },
  microsoft_calendar: {
    name: 'Microsoft 365 calendar',
    fields: [],
    ...CONNECTORS,
    finish: 'Sign in to Microsoft in your browser.',
  },
  zoom: { name: 'Zoom', fields: [], ...CONNECTORS, finish: 'Sign in to Zoom in your browser.' },
  mcp_sign_in: {
    name: 'MCP server sign-in',
    fields: ['server'],
    place: 'Settings → Connectors → MCP servers',
    route: '#/settings/tools',
    finish: 'Choose Sign in on the server.',
  },
};

export const setupFieldsSchema = z.record(
  z.string().max(40),
  z.string().trim().min(1).max(SETUP_FIELD_MAX),
);
export type SetupFields = z.infer<typeof setupFieldsSchema>;

export const prepareSetupActionSchema = z.object({
  action: z.literal('prepare_setup'),
  target: setupTargetSchema,
  name: z.string(),
  fields: setupFieldsSchema,
  place: z.string(),
  finish: z.string(),
});

export const setupDraftSchema = z.object({
  target: setupTargetSchema,
  fields: setupFieldsSchema,
  conversationId: z.uuid().nullable(),
  createdAt: z.string(),
});
export type SetupDraft = z.infer<typeof setupDraftSchema>;

export const setupDraftsSchema = z.object({ drafts: z.array(setupDraftSchema) });
export type SetupDrafts = z.infer<typeof setupDraftsSchema>;
