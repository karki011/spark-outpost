import { signInOriginProblem } from '@spark-outpost/contracts';
import type { Cdp } from './cdp.ts';
import { focusNode, pressKey, replaceFocusedText } from './page-input.ts';
import { boxOf } from './page-read.ts';
import { pageSettles } from './page-settle.ts';
import type { DomNode } from './sensitive-nodes.ts';
import {
  SIGN_IN_REASONS,
  candidateNodes,
  chooseSignInFields,
  signInCandidates,
  type SignInPlan,
} from './sign-in-fields.ts';

export class SignInError extends Error {
  readonly code: 'not_allowed' | 'no_form' | 'failed';

  constructor(code: 'not_allowed' | 'no_form' | 'failed', message: string) {
    super(message);
    this.code = code;
  }
}

export interface SignInValues {
  origin: string;
  username: string;
  password: string;
}

export interface SignInTiming {
  settleMs: number;
  loadMs: number;
  restMs: number;
  fieldMs: number;
  pollMs: number;
}

export interface SignInOutcome {
  url: string;
  steps: 1 | 2;
}

export const SIGN_IN_TIMING: SignInTiming = {
  settleMs: 1500,
  loadMs: 8000,
  restMs: 300,
  fieldMs: 6000,
  pollMs: 250,
};

export const SIGN_IN_FAILED = 'Spark could not fill the sign-in form on this page.';
export const SIGN_IN_FOCUS_LOST =
  'The page moved the cursor away from the sign-in field, so Spark stopped before typing.';
export const SIGN_IN_NO_PASSWORD_STEP =
  'The page did not show a password field after the username step. The password was not filled.';

async function pageUrl(cdp: Cdp): Promise<string> {
  const { frameTree } = await cdp.send<{ frameTree: { frame: { url: string } } }>(
    'Page.getFrameTree',
  );
  return frameTree.frame.url;
}

async function requireOrigin(cdp: Cdp, origin: string): Promise<void> {
  const problem = signInOriginProblem(origin, await pageUrl(cdp));
  if (problem) throw new SignInError('not_allowed', `${problem} Nothing more was filled.`);
}

async function planOf(cdp: Cdp): Promise<SignInPlan> {
  const { root } = await cdp.send<{ root: DomNode }>('DOM.getDocument', {
    depth: -1,
    pierce: true,
  });
  const candidates = signInCandidates(root);
  const visible = new Set<number>();
  for (const node of candidateNodes(candidates)) {
    const box = await boxOf(cdp, node);
    if (box && box.width > 0 && box.height > 0) visible.add(node);
  }
  return chooseSignInFields(candidates, visible);
}

async function typeInto(cdp: Cdp, node: number, text: string): Promise<void> {
  if (!(await focusNode(cdp, node))) throw new SignInError('failed', SIGN_IN_FOCUS_LOST);
  await replaceFocusedText(cdp, text);
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function submit(cdp: Cdp, timing: SignInTiming, signal: AbortSignal): Promise<void> {
  const settled = pageSettles(cdp, timing, signal);
  await pressKey(cdp, 'Enter');
  await settled;
}

type Credentials = Extract<SignInPlan, { step: 'credentials' }>;

async function passwordStep(
  cdp: Cdp,
  origin: string,
  timing: SignInTiming,
  signal: AbortSignal,
): Promise<Credentials> {
  const deadline = Date.now() + timing.fieldMs;
  for (;;) {
    await requireOrigin(cdp, origin);
    const plan = await planOf(cdp).catch((): SignInPlan => ({
      step: 'none',
      reason: SIGN_IN_REASONS.notFound,
    }));
    if (plan.step === 'credentials') return plan;
    if (plan.step === 'none' && plan.reason !== SIGN_IN_REASONS.notFound) {
      throw new SignInError('no_form', plan.reason);
    }
    if (signal.aborted || Date.now() >= deadline) {
      throw new SignInError('no_form', SIGN_IN_NO_PASSWORD_STEP);
    }
    await pause(timing.pollMs);
  }
}

async function fillCredentials(
  cdp: Cdp,
  plan: Credentials,
  values: SignInValues,
  filled: number[],
): Promise<void> {
  if (plan.username !== null) {
    filled.push(plan.username);
    await typeInto(cdp, plan.username, values.username);
  }
  await requireOrigin(cdp, values.origin);
  filled.push(plan.password);
  await typeInto(cdp, plan.password, values.password);
}

async function run(
  cdp: Cdp,
  values: SignInValues,
  timing: SignInTiming,
  signal: AbortSignal,
  filled: number[],
): Promise<SignInOutcome> {
  await cdp.send('Page.enable');
  await requireOrigin(cdp, values.origin);
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => undefined);
  const first = await planOf(cdp);
  if (first.step === 'none') throw new SignInError('no_form', first.reason);
  if (first.step === 'credentials') {
    await fillCredentials(cdp, first, values, filled);
    await submit(cdp, timing, signal);
    return { url: await pageUrl(cdp), steps: 1 };
  }
  filled.push(first.username);
  await typeInto(cdp, first.username, values.username);
  await submit(cdp, timing, signal);
  const second = await passwordStep(cdp, values.origin, timing, signal);
  await fillCredentials(cdp, second, values, filled);
  await submit(cdp, timing, signal);
  return { url: await pageUrl(cdp), steps: 2 };
}

export interface SignInOptions {
  timing?: SignInTiming;
  signal?: AbortSignal;
  filled?: (node: number) => void;
}

export async function signInOnPage(
  cdp: Cdp,
  values: SignInValues,
  options: SignInOptions = {},
): Promise<SignInOutcome> {
  const filled: number[] = [];
  try {
    return await run(
      cdp,
      values,
      options.timing ?? SIGN_IN_TIMING,
      options.signal ?? new AbortController().signal,
      filled,
    );
  } catch (error) {
    if (error instanceof SignInError) throw error;
    throw new SignInError('failed', SIGN_IN_FAILED);
  } finally {
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false }).catch(() => undefined);
    for (const node of filled) options.filled?.(node);
  }
}
