import {
  pairingStartSchema,
  passkeyCreationOptionsSchema,
  pendingPairingListSchema,
  pushContactStateSchema,
  pushStateSchema,
  remoteAuditListSchema,
  remoteDeviceListSchema,
  remoteDeviceSchema,
  remotePasskeyListSchema,
  remoteSessionSchema,
  remoteSwitchesSchema,
  tailscaleStateSchema,
  type PairingStart,
  type PasskeyCreationOptions,
  type PasskeyRegistration,
  type PendingPairing,
  type PushContactState,
  type PushState,
  type PushSubscribeRequest,
  type RemoteAuditEntry,
  type RemoteDevice,
  type RemotePasskey,
  type RemoteSession,
  type RemoteSwitches,
  type TailscaleState,
} from '@spark-outpost/contracts';
import { request } from '../api/client.ts';

export const phoneKeys = {
  all: ['phone'] as const,
  session: ['phone', 'session'] as const,
  tailscale: ['phone', 'tailscale'] as const,
  devices: ['phone', 'devices'] as const,
  pairings: ['phone', 'pairings'] as const,
  audit: ['phone', 'audit'] as const,
  passkeys: ['phone', 'passkeys'] as const,
  push: ['phone', 'push'] as const,
  pushLocal: ['phone', 'push', 'local'] as const,
  pushContact: ['phone', 'push', 'contact'] as const,
};

const post = { method: 'POST', body: '{}' };

export const phoneApi = {
  session: (): Promise<RemoteSession> => request(remoteSessionSchema, '/remote/session'),
  tailscale: (): Promise<TailscaleState> => request(tailscaleStateSchema, '/remote/tailscale'),
  turn: (to: 'on' | 'off'): Promise<TailscaleState> =>
    request(tailscaleStateSchema, `/remote/tailscale/${to}`, post),
  devices: async (): Promise<RemoteDevice[]> =>
    (await request(remoteDeviceListSchema, '/remote/devices')).devices,
  rename: (id: string, name: string): Promise<RemoteDevice> =>
    request(remoteDeviceSchema, `/remote/devices/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),
  revoke: async (id: string): Promise<RemoteDevice[]> =>
    (await request(remoteDeviceListSchema, `/remote/devices/${id}`, { method: 'DELETE' })).devices,
  disconnectAll: async (): Promise<RemoteDevice[]> =>
    (await request(remoteDeviceListSchema, '/remote/devices/disconnect-all', post)).devices,
  startPairing: (): Promise<PairingStart> => request(pairingStartSchema, '/remote/pairings', post),
  pairings: async (): Promise<PendingPairing[]> =>
    (await request(pendingPairingListSchema, '/remote/pairings')).pairings,
  answerPairing: async (id: string, answer: 'confirm' | 'deny'): Promise<PendingPairing[]> =>
    (await request(pendingPairingListSchema, `/remote/pairings/${id}/${answer}`, post)).pairings,
  setSwitches: (change: Partial<RemoteSwitches>): Promise<RemoteSwitches> =>
    request(remoteSwitchesSchema, '/remote/switches', {
      method: 'PATCH',
      body: JSON.stringify(change),
    }),
  audit: async (): Promise<RemoteAuditEntry[]> =>
    (await request(remoteAuditListSchema, '/remote/audit')).entries,
  removePasskeys: async (deviceId: string): Promise<RemoteDevice[]> =>
    (
      await request(remoteDeviceListSchema, `/remote/devices/${deviceId}/passkeys`, {
        method: 'DELETE',
      })
    ).devices,
  passkeys: async (): Promise<RemotePasskey[]> =>
    (await request(remotePasskeyListSchema, '/remote/passkeys')).passkeys,
  passkeyOptions: (): Promise<PasskeyCreationOptions> =>
    request(passkeyCreationOptionsSchema, '/remote/passkeys/options', post),
  savePasskey: async (registration: PasskeyRegistration): Promise<RemotePasskey[]> =>
    (
      await request(remotePasskeyListSchema, '/remote/passkeys', {
        method: 'POST',
        body: JSON.stringify(registration),
      })
    ).passkeys,
  pushContact: (): Promise<PushContactState> =>
    request(pushContactStateSchema, '/remote/push/contact'),
  savePushContact: (contact: string | null): Promise<PushContactState> =>
    request(pushContactStateSchema, '/remote/push/contact', {
      method: 'PUT',
      body: JSON.stringify({ contact }),
    }),
  push: (): Promise<PushState> => request(pushStateSchema, '/remote/push'),
  subscribePush: (subscription: PushSubscribeRequest): Promise<PushState> =>
    request(pushStateSchema, '/remote/push/subscription', {
      method: 'PUT',
      body: JSON.stringify(subscription),
    }),
  unsubscribePush: (endpoint: string): Promise<PushState> =>
    request(pushStateSchema, '/remote/push/subscription', {
      method: 'DELETE',
      body: JSON.stringify({ endpoint }),
    }),
};
