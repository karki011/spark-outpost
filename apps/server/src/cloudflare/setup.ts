import {
  CLOUDFLARE_SETUP_STEPS,
  CLOUDFLARE_SHARE_PERMISSIONS,
  type CloudflareSetup,
  type CloudflareSetupStep,
  type CloudflareSetupStepId,
  type CloudflareSharePermission,
} from '@spark-outpost/contracts';
import { startLoopback, type Loopback, type LoopbackCallback } from '../calendar/cloud/loopback.ts';
import { newPkce, sameText } from '../setup/pkce.ts';
import {
  createBucket,
  enableWorkersDev,
  firstAccount,
  scriptExists,
  setSchedule,
  uploadScript,
  workersSubdomain,
  type CloudflareAccount,
  type CloudflareAccountApi,
} from './account-api.ts';
import { checkShareService, type ServiceCheck } from './check.ts';
import type { CloudflareClientConfig } from './client.ts';
import type { CloudflareLink } from './link.ts';
import {
  CLOUDFLARE_SCOPES,
  CloudflareSignInError,
  cloudflareAuthorizeUrl,
  exchangeCloudflareCode,
  revokeCloudflareToken,
  type CloudflareToken,
} from './oauth.ts';
import {
  CLOUDFLARE_DASH_URL,
  SETUP_DENIED,
  SETUP_KEY_NOT_SAVED,
  SETUP_NOT_ALLOWED,
  SETUP_NOT_ANSWERING,
  SETUP_NO_SUBDOMAIN,
  SETUP_NO_WORKER_FILE,
  SETUP_SIGN_IN_ENDED,
  SETUP_TIMED_OUT,
  SETUP_UNAVAILABLE,
  SETUP_WORKER_EXISTS,
  SETUP_WRONG_STATE,
  StepFailure,
  stepFailure,
} from './setup-problems.ts';
import {
  SHARE_BUCKET_NAME,
  SHARE_WORKER_CRON,
  SHARE_WORKER_NAME,
  newShareKeys,
  shareWorkerOrigin,
  shareWorkerUpload,
  type ShareKeys,
} from './share-install.ts';

export const CLOUDFLARE_SIGN_IN_TTL_MS = 10 * 60_000;
export const CLOUDFLARE_CALLBACK_PATH = '/oauth/callback';
const EXPIRY_MARGIN_MS = 60_000;
const ANSWER_TRIES = 8;
const ANSWER_WAIT_MS = 3_000;

export interface CloudflareSetupDeps {
  client: CloudflareClientConfig | null;
  fetch: typeof fetch;
  link: CloudflareLink;
  check: ServiceCheck;
  readWorker: (file: string) => Promise<string>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface CloudflareSetupService {
  view(): CloudflareSetup;
  start(): Promise<CloudflareSetup>;
  cancel(): Promise<CloudflareSetup>;
  settled(): Promise<void>;
}

interface Pending {
  state: string;
  verifier: string;
  redirectUri: string;
  authorizeUrl: string;
  loopback: Loopback;
  timer: NodeJS.Timeout;
}

interface Progress {
  account: CloudflareAccount | null;
  granted: string[] | null;
  pendingKeys: ShareKeys | null;
  uploadKey: string | null;
  origin: string | null;
}

const STEP_PERMISSION: Record<CloudflareSetupStepId, CloudflareSharePermission> = {
  signIn: 'account',
  bucket: 'storage',
  worker: 'workers',
  connect: 'workers',
};

const todo = (id: CloudflareSetupStepId): CloudflareSetupStep => ({
  id,
  state: 'todo',
  problem: null,
  fix: null,
  fixUrl: null,
});

const freshSteps = () => CLOUDFLARE_SETUP_STEPS.map(todo);
const freshProgress = (): Progress => ({
  account: null,
  granted: null,
  pendingKeys: null,
  uploadKey: null,
  origin: null,
});

export function createCloudflareSetup(deps: CloudflareSetupDeps): CloudflareSetupService {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const client = deps.client;
  let status: CloudflareSetup['status'] = 'idle';
  let steps = freshSteps();
  let progress = freshProgress();
  let token: CloudflareToken | null = null;
  let pending: Pending | null = null;
  let generation = 0;
  let signInAttempt = 0;
  let work: Promise<void> = Promise.resolve();

  const set = (id: CloudflareSetupStepId, change: Partial<CloudflareSetupStep>) => {
    steps = steps.map((step) => (step.id === id ? { ...todo(id), ...change } : step));
  };

  const stop = (id: CloudflareSetupStepId, failure: StepFailure) => {
    set(id, {
      state: 'failed',
      problem: failure.message,
      fix: failure.fix,
      fixUrl: failure.fixUrl,
    });
    status = 'stopped';
  };

  const clearPending = () => {
    if (!pending) return;
    clearTimeout(pending.timer);
    pending.loopback.close();
    pending = null;
  };

  const dropToken = async () => {
    const live = token;
    token = null;
    if (live && client)
      await revokeCloudflareToken({ fetch: deps.fetch, client }, live.accessToken);
  };

  const tokenLive = () => token !== null && token.expiresAt - EXPIRY_MARGIN_MS > now();

  const api = (permission: CloudflareSharePermission): CloudflareAccountApi => {
    if (!client) throw new StepFailure(SETUP_UNAVAILABLE, null);
    if (!token || !tokenLive()) throw new StepFailure(SETUP_SIGN_IN_ENDED, 'allow');
    if (!token.scopes.includes(CLOUDFLARE_SCOPES[permission])) {
      throw new StepFailure(SETUP_NOT_ALLOWED[permission], 'allow');
    }
    return { fetch: deps.fetch, apiUrl: client.apiUrl, token: token.accessToken };
  };

  const accountId = (): string => {
    if (!progress.account) throw new StepFailure(SETUP_SIGN_IN_ENDED, 'allow');
    return progress.account.id;
  };

  const installWorker = async () => {
    const id = accountId();
    const workers = api('workers');
    const subdomain = await workersSubdomain(workers, id);
    if (!subdomain) {
      throw new StepFailure(
        SETUP_NO_SUBDOMAIN,
        'cloudflare',
        `${CLOUDFLARE_DASH_URL}/${id}/workers-and-pages`,
      );
    }
    if (!progress.uploadKey) {
      const exists = await scriptExists(workers, id, SHARE_WORKER_NAME);
      if (exists && !progress.pendingKeys) throw new StepFailure(SETUP_WORKER_EXISTS, null);
      if (!exists) {
        const module = await deps.readWorker(client!.workerFile).catch(() => {
          throw new StepFailure(SETUP_NO_WORKER_FILE, null);
        });
        progress.pendingKeys ??= newShareKeys();
        await uploadScript(workers, id, shareWorkerUpload(module, progress.pendingKeys));
      }
      progress.uploadKey = progress.pendingKeys!.uploadKey;
      progress.pendingKeys = null;
    }
    await setSchedule(workers, id, SHARE_WORKER_NAME, SHARE_WORKER_CRON);
    await enableWorkersDev(workers, id, SHARE_WORKER_NAME);
    progress.origin = shareWorkerOrigin(subdomain);
  };

  const connect = async (mine: number) => {
    const { origin, uploadKey } = progress;
    if (!origin || !uploadKey) throw new StepFailure(SETUP_NOT_ANSWERING, 'retry');
    const current = () => mine === generation;
    for (let attempt = 1; attempt <= ANSWER_TRIES && current(); attempt += 1) {
      const checked = await checkShareService(deps.check, origin, uploadKey);
      if (checked.problem === null) {
        const saved = await deps.link.save(origin, uploadKey, checked.maxDays, current);
        if (!saved && current()) throw new StepFailure(SETUP_KEY_NOT_SAVED, 'retry');
        return;
      }
      if (attempt < ANSWER_TRIES) await sleep(ANSWER_WAIT_MS);
    }
    throw new StepFailure(SETUP_NOT_ANSWERING, 'retry');
  };

  const WORK: Record<Exclude<CloudflareSetupStepId, 'signIn'>, (mine: number) => Promise<void>> = {
    bucket: () => createBucket(api('storage'), accountId(), SHARE_BUCKET_NAME),
    worker: installWorker,
    connect,
  };

  const run = async (mine: number) => {
    status = 'working';
    for (const id of ['bucket', 'worker', 'connect'] as const) {
      if (steps.find((step) => step.id === id)?.state === 'done') continue;
      set(id, { state: 'working' });
      try {
        await WORK[id](mine);
      } catch (error) {
        if (mine !== generation) return;
        stop(id, stepFailure(error, STEP_PERMISSION[id], progress.account?.id ?? null));
        return;
      }
      if (mine !== generation) return;
      set(id, { state: 'done' });
    }
    status = 'done';
    progress = { ...progress, uploadKey: null };
    await dropToken();
  };

  const finish = async (waiting: Pending, callback: LoopbackCallback, mine: number) => {
    if (!callback.state || !sameText(callback.state, waiting.state)) {
      stop('signIn', new StepFailure(SETUP_WRONG_STATE, 'allow'));
      return;
    }
    if (callback.error || !callback.code || !client) {
      stop('signIn', new StepFailure(SETUP_DENIED, 'allow'));
      return;
    }
    status = 'working';
    set('signIn', { state: 'working' });
    try {
      const fresh = await exchangeCloudflareCode(
        { fetch: deps.fetch, client },
        { code: callback.code, verifier: waiting.verifier, redirectUri: waiting.redirectUri },
        now(),
      );
      const abandon = () => revokeCloudflareToken({ fetch: deps.fetch, client }, fresh.accessToken);
      if (mine !== generation) {
        await abandon();
        return;
      }
      await dropToken();
      if (mine !== generation) {
        await abandon();
        return;
      }
      token = fresh;
      const account = await firstAccount(api('account'));
      if (mine !== generation) return;
      if (progress.account && progress.account.id !== account.id) {
        steps = freshSteps();
        progress = freshProgress();
      }
      progress = { ...progress, account, granted: fresh.scopes };
    } catch (error) {
      if (mine !== generation) return;
      await dropToken();
      const failure =
        error instanceof CloudflareSignInError
          ? new StepFailure(error.message, 'allow')
          : stepFailure(error, 'account', null);
      stop('signIn', new StepFailure(failure.message, 'allow'));
      return;
    }
    set('signIn', { state: 'done' });
    await run(mine);
  };

  const signIn = async (config: CloudflareClientConfig) => {
    clearPending();
    const pkce = newPkce();
    const mine = generation;
    const attempt = (signInAttempt += 1);
    let waiting: Pending | null = null;
    const loopback = await startLoopback(
      'Cloudflare',
      (callback) => {
        if (!waiting || pending !== waiting) return;
        const answered = waiting;
        clearPending();
        work = finish(answered, callback, mine);
      },
      CLOUDFLARE_CALLBACK_PATH,
    );
    if (mine !== generation || attempt !== signInAttempt) {
      loopback.close();
      return;
    }
    const timer = setTimeout(() => {
      if (pending !== waiting) return;
      clearPending();
      stop('signIn', new StepFailure(SETUP_TIMED_OUT, 'allow'));
    }, CLOUDFLARE_SIGN_IN_TTL_MS);
    timer.unref();
    waiting = {
      state: pkce.state,
      verifier: pkce.verifier,
      redirectUri: loopback.redirectUri,
      authorizeUrl: cloudflareAuthorizeUrl(config, pkce, loopback.redirectUri),
      loopback,
      timer,
    };
    pending = waiting;
    status = 'waiting';
    steps = steps.map((step) => (step.state === 'failed' ? todo(step.id) : step));
    set('signIn', { state: 'working' });
  };

  const canResume = (): boolean => {
    const failed = steps.find((step) => step.state === 'failed');
    if (status !== 'stopped' || !failed || failed.fix === 'allow' || failed.id === 'signIn') {
      return false;
    }
    return failed.id === 'connect' || tokenLive();
  };

  const view = (): CloudflareSetup => ({
    available: client !== null,
    status,
    authorizeUrl: pending?.authorizeUrl ?? null,
    account: progress.account?.name ?? null,
    signedIn: tokenLive(),
    permissions: CLOUDFLARE_SHARE_PERMISSIONS.map((id) => ({
      id,
      state: !progress.granted
        ? 'needed'
        : progress.granted.includes(CLOUDFLARE_SCOPES[id])
          ? 'allowed'
          : 'missing',
    })),
    steps,
  });

  return {
    view,
    settled: () => work,
    async start() {
      if (!client) throw new StepFailure(SETUP_UNAVAILABLE, null);
      if (status === 'working') return view();
      if (status === 'done') {
        steps = freshSteps();
        progress = freshProgress();
      }
      if (canResume()) {
        const mine = generation;
        status = 'working';
        work = run(mine);
        return view();
      }
      await signIn(client);
      return view();
    },
    async cancel() {
      generation += 1;
      clearPending();
      status = 'idle';
      steps = freshSteps();
      progress = freshProgress();
      await dropToken();
      return view();
    },
  };
}
