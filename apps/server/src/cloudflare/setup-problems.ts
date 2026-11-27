import type { CloudflareSetupStep, CloudflareSharePermission } from '@spark-outpost/contracts';
import { CloudflareApiError } from './account-api.ts';
import { SHARE_WORKER_NAME } from './share-install.ts';

export const CLOUDFLARE_DASH_URL = 'https://dash.cloudflare.com';

export const SETUP_UNAVAILABLE = 'This build can’t set up Cloudflare for you. Set it up by hand.';
export const SETUP_TIMED_OUT = 'Cloudflare didn’t send you back in time. Allow it again.';
export const SETUP_DENIED = 'The sign-in was cancelled in Cloudflare.';
export const SETUP_WRONG_STATE =
  'That sign-in answer doesn’t match the one Spark is waiting for. Allow it again.';
export const SETUP_SIGN_IN_ENDED = 'The Cloudflare sign-in ended. Allow it again to continue.';
export const SETUP_UNREACHABLE =
  'Spark couldn’t reach Cloudflare. Check your connection and try again.';
export const SETUP_R2_OFF =
  'R2 storage isn’t turned on in this Cloudflare account. Turn it on in Cloudflare, then check again. Cloudflare asks for a payment method; R2 has a free allowance.';
export const SETUP_NO_SUBDOMAIN =
  'This account has no workers.dev address yet. Open Workers & Pages in Cloudflare once to create it, then check again.';
export const SETUP_WORKER_EXISTS = `This account already has a worker named ${SHARE_WORKER_NAME}. Connect it by hand with its address and upload key, or delete it in Cloudflare and set up again.`;
export const SETUP_NOT_ANSWERING =
  'The share service was created but isn’t answering yet. Try again in a minute.';
export const SETUP_KEY_NOT_SAVED =
  'Spark couldn’t save the upload key in your keychain. Try again.';
export const SETUP_NO_WORKER_FILE =
  'This build is missing the share service’s code. Set it up by hand.';

export const SETUP_NOT_ALLOWED: Record<CloudflareSharePermission, string> = {
  account: 'Cloudflare didn’t give Spark permission to see which account this is. Allow it again.',
  storage: 'Cloudflare didn’t give Spark permission to create storage. Allow it and try again.',
  workers: 'Cloudflare didn’t give Spark permission to create a worker. Allow it and try again.',
};

type Fix = CloudflareSetupStep['fix'];

export class StepFailure extends Error {
  readonly fix: Fix;
  readonly fixUrl: string | null;

  constructor(problem: string, fix: Fix, fixUrl: string | null = null) {
    super(problem);
    this.fix = fix;
    this.fixUrl = fixUrl;
  }
}

export function stepFailure(
  error: unknown,
  permission: CloudflareSharePermission,
  accountId: string | null,
): StepFailure {
  if (error instanceof StepFailure) return error;
  if (!(error instanceof CloudflareApiError)) {
    return new StepFailure('Something went wrong on this computer. Try again.', 'retry');
  }
  if (error.kind === 'unreachable') return new StepFailure(SETUP_UNREACHABLE, 'retry');
  if (error.kind === 'permission') return new StepFailure(SETUP_NOT_ALLOWED[permission], 'allow');
  if (error.kind === 'r2Off') {
    const url = accountId ? `${CLOUDFLARE_DASH_URL}/${accountId}/r2/overview` : CLOUDFLARE_DASH_URL;
    return new StepFailure(SETUP_R2_OFF, 'cloudflare', url);
  }
  return new StepFailure(`Cloudflare refused: ${error.message}`, 'retry');
}
