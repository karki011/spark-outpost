import { z } from 'zod';

export const REMOTE_DEVICE_COOKIE = '__Host-spark_device';
export const REMOTE_DEVICE_IDLE_DAYS = 30;
export const REMOTE_DEVICE_NAME_MAX = 60;
export const PAIRING_TTL_MS = 2 * 60 * 1000;
export const PAIRING_CODE_LENGTH = 12;

export const remoteSwitchSchema = z.enum([
  'settings',
  'connections',
  'projects',
  'agentMode',
  'highRiskCards',
  'signIns',
  'reset',
  'devices',
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
});
export type RemoteSwitches = z.infer<typeof remoteSwitchesSchema>;

export const REMOTE_SWITCH_DEFAULTS: RemoteSwitches = {
  settings: true,
  connections: true,
  projects: true,
  agentMode: true,
  highRiskCards: true,
  signIns: false,
  reset: false,
  devices: false,
};

export const REMOTE_SWITCH_LABELS: Record<RemoteSwitch, string> = {
  settings: 'Change settings',
  connections: 'Add or change providers and connections',
  projects: 'Link a new folder or clone a repo',
  agentMode: 'Raise agent mode or autonomy',
  highRiskCards: 'Answer high-risk cards (git hooks, git config, secret files)',
  signIns: 'Add, change and approve saved sign-ins',
  reset: 'Reset or delete data',
  devices: 'Pair another device and manage devices',
};

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

export const remoteAccessSchema = z.object({
  hostname: z.string().nullable(),
  switches: remoteSwitchesSchema,
});
export type RemoteAccess = z.infer<typeof remoteAccessSchema>;

export const updateRemoteAccessRequestSchema = z.object({
  hostname: remoteHostnameSchema.nullable(),
});
export type UpdateRemoteAccessRequest = z.infer<typeof updateRemoteAccessRequestSchema>;

const deviceName = z.string().trim().min(1).max(REMOTE_DEVICE_NAME_MAX);

export const remoteDeviceSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  createdAt: z.string(),
  lastSeenAt: z.string(),
  revokedAt: z.string().nullable(),
  expired: z.boolean(),
  connected: z.boolean(),
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
  matchCode: z.string(),
  expiresAt: z.string(),
});
export type PendingPairing = z.infer<typeof pendingPairingSchema>;

export const pendingPairingListSchema = z.object({ pairings: z.array(pendingPairingSchema) });
export type PendingPairingList = z.infer<typeof pendingPairingListSchema>;

export const pairingSubmitRequestSchema = z.object({
  code: z.string().min(1).max(40),
  deviceName,
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

export const remoteAuditActionSchema = z.enum([
  'hostname_changed',
  'switches_changed',
  'pairing_started',
  'pairing_submitted',
  'pairing_failed',
  'pairing_confirmed',
  'pairing_denied',
  'device_paired',
  'device_renamed',
  'device_revoked',
  'devices_disconnected',
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
