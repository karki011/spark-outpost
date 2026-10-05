import { signInOriginProblem } from '@spark-outpost/contracts';
import type { Cdp } from './cdp.ts';
import type { AxNode } from './outline.ts';
import { boxOf } from './page-read.ts';
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

const STARTS = new Set([
  'Page.frameStartedLoading',
  'Page.frameRequestedNavigation',
  'Page.frameNavigated',
]);
const ENDS = new Set(['Page.loadEventFired', 'Page.navigatedWithinDocument']);
const ENTER = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
const SELECT_ALL = { key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65 };

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

async function hasFocus(cdp: Cdp, node: number): Promise<boolean> {
  const { nodes } = await cdp.send<{ nodes: AxNode[] }>('Accessibility.getPartialAXTree', {
    backendNodeId: node,
    fetchRelatives: false,
  });
  return nodes.some(
    (candidate) =>
      candidate.backendDOMNodeId === node &&
      (candidate.properties ?? []).some(
        (property) => property.name === 'focused' && property.value.value === true,
      ),
  );
}

async function typeInto(cdp: Cdp, node: number, text: string): Promise<void> {
  await cdp.send('DOM.focus', { backendNodeId: node });
  if (!(await hasFocus(cdp, node))) throw new SignInError('failed', SIGN_IN_FOCUS_LOST);
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    ...SELECT_ALL,
    commands: ['selectAll'],
  });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...SELECT_ALL });
  await cdp.send('Input.insertText', { text });
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pageSettles(cdp: Cdp, timing: SignInTiming, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    let loading = false;
    let stop: () => void = () => undefined;
    const timers: NodeJS.Timeout[] = [];
    const finish = () => {
      for (const timer of timers) clearTimeout(timer);
      stop();
      signal.removeEventListener('abort', finish);
      resolve();
    };
    stop = cdp.listen((method) => {
      if (STARTS.has(method)) loading = true;
      if (ENDS.has(method)) timers.push(setTimeout(finish, timing.restMs));
    });
    timers.push(
      setTimeout(() => {
        if (!loading) finish();
      }, timing.settleMs),
      setTimeout(finish, timing.loadMs),
    );
    signal.addEventListener('abort', finish, { once: true });
  });
}

async function submit(cdp: Cdp, timing: SignInTiming, signal: AbortSignal): Promise<void> {
  const settled = pageSettles(cdp, timing, signal);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...ENTER, text: '\r' });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...ENTER });
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
    for (const node of filled) options.filled?.(node);
  }
}
