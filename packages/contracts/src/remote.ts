import { z } from 'zod';

export const REMOTE_DEVICE_COOKIE = '__Host-spark_device';
export const REMOTE_DEVICE_IDLE_DAYS = 30;
export const REMOTE_DEVICE_NAME_MAX = 60;
export const PAIRING_TTL_MS = 2 * 60 * 1000;
export const PAIRING_CODE_LENGTH = 12;
export const REMOTE_ENTRY_PARAM = 'spark_entry';

export const remoteSwitchSchema = z.enum([
  'settings',
  'connections',
  'projects',
  'agentMode',
  'highRiskCards',
  'signIns',
  'reset',
  'devices',
  'passkeys',
  'terminal',
  'terminalApprove',
  'notifications',
  'notifyUpdates',
  'notifyAwayOnly',
  'artifacts',
]);
export type RemoteSwitch = z.infer<typeof remoteSwitchSchema>;

export const remoteSwitchesSchema = z.object({
  settings: z.boolean(),
  connections: z.boolean(),
  projects: z.boolean(),
  agentMode: z.boolean(),
  highRiskCards: z.boolean(),
  signIns: z.boolean(),
  reset: z.boolean(),
  devices: z.boolean(),
  passkeys: z.boolean(),
  terminal: z.boolean(),
  terminalApprove: z.boolean(),
  notifications: z.boolean(),
  notifyUpdates: z.boolean(),
  notifyAwayOnly: z.boolean(),
  artifacts: z.boolean(),
});
export type RemoteSwitches = z.infer<typeof remoteSwitchesSchema>;

export const REMOTE_SWITCH_DEFAULTS: RemoteSwitches = {
  settings: true,
  connections: true,
  projects: true,
  agentMode: true,
  highRiskCards: true,
  signIns: true,
  reset: true,
  devices: false,
  passkeys: true,
  terminal: false,
  terminalApprove: false,
  notifications: false,
  notifyUpdates: false,
  notifyAwayOnly: true,
  artifacts: false,
};

export const REMOTE_MAC_ONLY_SWITCHES: readonly RemoteSwitch[] = ['devices'];
export const REMOTE_SIGN_IN_SWITCHES: readonly RemoteSwitch[] = ['passkeys'];

export const REMOTE_SWITCH_LABELS: Record<RemoteSwitch, string> = {
  settings: 'Change settings',
  connections: 'Add or change providers and connections',
  projects: 'Link a new folder or clone a repo',
  agentMode: 'Raise agent mode or autonomy',
  highRiskCards: 'Answer high-risk cards (git hooks, git config, secret files)',
  signIns: 'Add, change and approve saved sign-ins',
  reset: 'Reset or delete data',
  devices: 'Pair another device and manage devices',
  passkeys: 'Sign in with a passkey',
  terminal: 'Follow, type in and stop Terminal sessions',
  terminalApprove: 'Approve in Terminal sessions',
  notifications: 'Notify when a chat needs you',
  notifyUpdates: 'Notify when a turn finishes or fails',
  notifyAwayOnly: "Only notify my devices when I'm away from the Mac",
  artifacts: 'Open artifacts',
};

export const remoteCardKindSchema = z.enum(['crew', 'plugins', 'calendar', 'rules', 'macControl']);
export type RemoteCardKind = z.infer<typeof remoteCardKindSchema>;

export const REMOTE_CARD_KINDS = remoteCardKindSchema.options;

export const REMOTE_CARD_KIND_LABELS: Record<RemoteCardKind, string> = {
  crew: 'Sparks and workflows',
  plugins: 'Plugins',
  calendar: 'Calendar',
  rules: 'Spark rules',
  macControl: 'Mac control',
};

export const remoteCardAnsweringSchema = z.object({
  from: z.enum(['mac', 'devices']),
  macOnly: z.array(remoteCardKindSchema).max(REMOTE_CARD_KINDS.length),
});
export type RemoteCardAnswering = z.infer<typeof remoteCardAnsweringSchema>;

export const REMOTE_CARD_ANSWERING_DEFAULT: RemoteCardAnswering = {
  from: 'mac',
  macOnly: ['rules', 'macControl'],
};

export const updateRemoteCardAnsweringRequestSchema = remoteCardAnsweringSchema
  .partial()
  .strict()
  .refine((change) => Object.keys(change).length > 0);
export type UpdateRemoteCardAnsweringRequest = z.infer<
  typeof updateRemoteCardAnsweringRequestSchema
>;

export const REMOTE_ALWAYS_ALLOWED_LINE =
  'Read chats, send messages, answer ordinary cards, read sub-chats';

export interface RemoteSwitchGroup {
  id: 'everyday' | 'setup' | 'high-risk';
  title: string;
  description: string;
  switches: readonly RemoteSwitch[];
}

export const REMOTE_SWITCH_GROUPS: readonly RemoteSwitchGroup[] = [
  {
    id: 'everyday',
    title: 'Everyday',
    description: 'Helpful away from your desk. Low risk.',
    switches: [
      'notifications',
      'notifyUpdates',
      'notifyAwayOnly',
      'terminal',
      'passkeys',
      'artifacts',
    ],
  },
  {
    id: 'setup',
    title: 'Set up work',
    description: 'Changes what Spark can reach or how freely agents run.',
    switches: ['projects', 'agentMode', 'settings', 'connections'],
  },
  {
    id: 'high-risk',
    title: 'High risk',
    description:
      'Turn these off unless you need them. A lost phone could do real damage with these.',
    switches: ['highRiskCards', 'terminalApprove', 'signIns', 'reset', 'devices'],
  },
];

export const updateRemoteSwitchesRequestSchema = remoteSwitchesSchema
  .partial()
  .strict()
  .refine((change) => Object.keys(change).length > 0);
export type UpdateRemoteSwitchesRequest = z.infer<typeof updateRemoteSwitchesRequestSchema>;

const HOST_LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';

export const remoteHostnameSchema = z
  .string()
  .min(1)
  .max(253)
  .regex(new RegExp(`^${HOST_LABEL}(?:\\.${HOST_LABEL})+$`))
  .refine((host) => host !== 'localhost' && !/^[0-9.]+$/.test(host));

export const remoteReachSchema = z.enum(['tailscale', 'custom']);
export type RemoteReach = z.infer<typeof remoteReachSchema>;

export const REMOTE_REACH_LABELS: Record<RemoteReach, string> = {
  tailscale: 'Tailscale',
  custom: 'Custom domain',
};

export const CUSTOM_DOMAIN_PROBLEMS = {
  tailscale: 'That is a Tailscale address. Choose Tailscale to use it.',
  unconfirmed: 'Confirm that you control who can reach this domain.',
} as const;

export const remoteAccessSchema = z.object({
  hostname: z.string().nullable(),
  reach: remoteReachSchema,
  forwardTo: z.string().nullable(),
  switches: remoteSwitchesSchema,
  cardAnswering: remoteCardAnsweringSchema,
});
export type RemoteAccess = z.infer<typeof remoteAccessSchema>;

export const updateRemoteAccessRequestSchema = z.object({
  hostname: remoteHostnameSchema.nullable(),
  confirmed: z.boolean().optional(),
});
export type UpdateRemoteAccessRequest = z.infer<typeof updateRemoteAccessRequestSchema>;

const deviceName = z.string().trim().min(1).max(REMOTE_DEVICE_NAME_MAX);

export const remoteDeviceKindSchema = z.enum(['browser', 'spark']);
export type RemoteDeviceKind = z.infer<typeof remoteDeviceKindSchema>;

export const remotePasskeySchema = z.object({
  id: z.uuid(),
  label: z.string().nullable(),
  synced: z.boolean(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
});
export type RemotePasskey = z.infer<typeof remotePasskeySchema>;

export const remotePasskeyListSchema = z.object({ passkeys: z.array(remotePasskeySchema) });
export type RemotePasskeyList = z.infer<typeof remotePasskeyListSchema>;

export const remoteDeviceSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  kind: remoteDeviceKindSchema,
  createdAt: z.string(),
  lastSeenAt: z.string(),
  revokedAt: z.string().nullable(),
  replacedBy: z.uuid().nullable(),
  duplicateOf: z.uuid().nullable(),
  expired: z.boolean(),
  connected: z.boolean(),
  passkeys: z.array(remotePasskeySchema),
});
export type RemoteDevice = z.infer<typeof remoteDeviceSchema>;

export const remoteDeviceListSchema = z.object({ devices: z.array(remoteDeviceSchema) });
export type RemoteDeviceList = z.infer<typeof remoteDeviceListSchema>;

export const renameRemoteDeviceRequestSchema = z.object({ name: deviceName });

export const pairingStartSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  expiresAt: z.string(),
});
export type PairingStart = z.infer<typeof pairingStartSchema>;

export const pendingPairingSchema = z.object({
  id: z.uuid(),
  deviceName: z.string(),
  kind: remoteDeviceKindSchema,
  matchCode: z.string(),
  expiresAt: z.string(),
});
export type PendingPairing = z.infer<typeof pendingPairingSchema>;

export const pendingPairingListSchema = z.object({ pairings: z.array(pendingPairingSchema) });
export type PendingPairingList = z.infer<typeof pendingPairingListSchema>;

export const pairingSubmitRequestSchema = z.object({
  code: z.string().min(1).max(40),
  deviceName,
  kind: remoteDeviceKindSchema.optional(),
});

export const pairingSubmitResponseSchema = z.object({
  claim: z.string(),
  matchCode: z.string(),
  expiresAt: z.string(),
});
export type PairingSubmitResponse = z.infer<typeof pairingSubmitResponseSchema>;

export const pairingClaimRequestSchema = z.object({ claim: z.string().min(1).max(100) });

export const pairingClaimResponseSchema = z.object({ status: z.enum(['waiting', 'paired']) });
export type PairingClaimResponse = z.infer<typeof pairingClaimResponseSchema>;

export const remoteHostSchema = z.enum(['mac', 'windows']);
export type RemoteHost = z.infer<typeof remoteHostSchema>;

export function remoteHostOf(platform: string): RemoteHost {
  return platform === 'win32' ? 'windows' : 'mac';
}

export const remoteSessionSchema = z.object({
  remote: z.boolean(),
  host: remoteHostSchema.optional(),
  device: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  address: z.string().nullable(),
  switches: remoteSwitchesSchema,
  cardAnswering: remoteCardAnsweringSchema,
  passkey: z.boolean(),
});
export type RemoteSession = z.infer<typeof remoteSessionSchema>;

export const tailscaleStatusSchema = z.enum([
  'not_installed',
  'signed_out',
  'https_off',
  'off',
  'on',
  'error',
]);
export type TailscaleStatus = z.infer<typeof tailscaleStatusSchema>;

export const tailscaleStateSchema = z.object({
  status: tailscaleStatusSchema,
  hostname: z.string().nullable(),
  address: z.string().nullable(),
  message: z.string().nullable(),
});
export type TailscaleState = z.infer<typeof tailscaleStateSchema>;

export function pairingLink(hostname: string, code: string): string {
  return `https://${hostname}/#code=${code}`;
}

export const remoteAuditActionSchema = z.enum([
  'hostname_changed',
  'switches_changed',
  'card_answering_changed',
  'card_step_up',
  'card_step_up_failed',
  'pairing_started',
  'pairing_submitted',
  'pairing_failed',
  'pairing_confirmed',
  'pairing_denied',
  'device_paired',
  'device_paired_again',
  'pairing_page_shown',
  'device_renamed',
  'device_revoked',
  'devices_disconnected',
  'device_passkey_added',
  'device_passkey_sign_in',
  'device_passkeys_removed',
  'passkey_sign_in_failed',
  'notification_sent',
  'push_contact_changed',
  'folder_created',
  'request',
  'refused',
]);
export type RemoteAuditAction = z.infer<typeof remoteAuditActionSchema>;

export const remoteAuditEntrySchema = z.object({
  id: z.uuid(),
  at: z.string(),
  action: remoteAuditActionSchema,
  deviceId: z.uuid().nullable(),
  deviceName: z.string().nullable(),
  method: z.string().nullable(),
  path: z.string().nullable(),
  status: z.number().int().nullable(),
  detail: z.record(z.string(), z.unknown()),
});
export type RemoteAuditEntry = z.infer<typeof remoteAuditEntrySchema>;

export const remoteAuditListSchema = z.object({ entries: z.array(remoteAuditEntrySchema) });
export type RemoteAuditList = z.infer<typeof remoteAuditListSchema>;
