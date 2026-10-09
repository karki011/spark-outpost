import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { RemotePasskey } from '@spark-outpost/contracts';
import { createPasskey, saveProblemOf } from './passkey-browser.ts';
import { phoneApi, phoneKeys } from './phone-api.ts';
import { PASSKEY_EXISTS, PASSKEY_NOT_SAVED } from './phone-copy.ts';

class PasskeyPromptError extends Error {}

async function askAuthenticator(options: Awaited<ReturnType<typeof phoneApi.passkeyOptions>>) {
  try {
    const registration = await createPasskey(options);
    if (registration) return registration;
  } catch (error) {
    throw new PasskeyPromptError(
      saveProblemOf(error) === 'exists' ? PASSKEY_EXISTS : PASSKEY_NOT_SAVED,
    );
  }
  throw new PasskeyPromptError(PASSKEY_NOT_SAVED);
}

async function savePasskey(): Promise<RemotePasskey[]> {
  const options = await phoneApi.passkeyOptions();
  return phoneApi.savePasskey(await askAuthenticator(options));
}

export function useSavePasskey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: savePasskey,
    onSuccess: (passkeys) => queryClient.setQueryData(phoneKeys.passkeys, passkeys),
  });
}
