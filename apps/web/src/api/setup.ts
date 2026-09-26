import {
  setupStateSchema,
  verifyEventSchema,
  type ConnectableId,
  type ProviderId,
  type SetupState,
  type UpdateProfileRequest,
  type UpdateProviderDefaultsRequest,
  type VerifyEvent,
  type VerifyRequest,
} from '@spark-outpost/contracts';
import { ApiError, request } from './client.ts';

export const setupKey = ['setup'] as const;

export const setupApi = {
  get: (): Promise<SetupState> => request(setupStateSchema, '/setup'),
  updateProfile: (update: UpdateProfileRequest): Promise<SetupState> =>
    request(setupStateSchema, '/profile', { method: 'PATCH', body: JSON.stringify(update) }),
  updateDefaults: (
    provider: ProviderId,
    update: UpdateProviderDefaultsRequest,
  ): Promise<SetupState> =>
    request(setupStateSchema, `/providers/${provider}/defaults`, {
      method: 'PATCH',
      body: JSON.stringify(update),
    }),
  sendTestMessage: (provider: ProviderId): Promise<SetupState> =>
    request(setupStateSchema, `/providers/${provider}/test`, { method: 'POST', body: '{}' }),
  disconnect: (provider: ConnectableId): Promise<SetupState> =>
    request(setupStateSchema, `/providers/${provider}/connection`, {
      method: 'DELETE',
      body: '{}',
    }),
};

export async function verifyProvider(
  provider: ConnectableId,
  body: VerifyRequest,
  onEvent: (event: VerifyEvent) => void,
): Promise<void> {
  const response = await fetch(`/api/providers/${provider}/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok || !response.body) {
    throw new ApiError(response.status, `Verification could not start (${response.status}).`);
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = verifyEventSchema.safeParse(JSON.parse(line));
      if (event.success) onEvent(event.data);
    }
  }
}
