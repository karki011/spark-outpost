import { describe, expect, it } from 'vitest';
import type { Cdp, CdpListener } from './cdp.ts';
import type { DomNode } from './sensitive-nodes.ts';
import { el, frame, loginDom, passwordStepDom, usernameStepDom } from './sign-in-dom.fixture.ts';
import { SIGN_IN_REASONS } from './sign-in-fields.ts';
import {
  SIGN_IN_FAILED,
  SIGN_IN_FOCUS_LOST,
  SIGN_IN_NO_PASSWORD_STEP,
  SignInError,
  signInOnPage,
  type SignInTiming,
} from './sign-in.ts';

const USERNAME = 'vault-user@example.test';
const PASSWORD = 'vault-Passw0rd!-unit';
const ORIGIN = 'https://staging.example.com';
const TIMING: SignInTiming = { settleMs: 5, loadMs: 60, restMs: 1, fieldMs: 40, pollMs: 5 };

interface Typed {
  node: number | null;
  text: string;
}

class FakePage {
  url = `${ORIGIN}/login`;
  dom: DomNode = el('HTML');
  focused: number | null = null;
  stealsFocus = false;
  failing: string | null = null;
  readonly typed: Typed[] = [];
  readonly sent: string[] = [];
  submits = 0;
  onSubmit: (page: FakePage) => void = () => undefined;
  private readonly listeners = new Set<CdpListener>();

  emit(method: string): void {
    for (const listener of this.listeners) listener(method, {});
  }

  readonly cdp: Cdp = {
    send: (method, params = {}) => Promise.resolve(this.answer(method, params) as never),
    listen: (listener) => {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    },
    detach: () => this.listeners.clear(),
  };

  private answer(method: string, params: Record<string, unknown>): unknown {
    this.sent.push(method);
    if (method === this.failing) throw new Error(`${method} broke with ${PASSWORD}`);
    if (method === 'Page.getFrameTree') return { frameTree: { frame: { url: this.url } } };
    if (method === 'DOM.getDocument') return { root: this.dom };
    if (method === 'DOM.getBoxModel') return { model: { border: [0, 0, 9, 0, 9, 9, 0, 9] } };
    if (method === 'DOM.focus') {
      this.focused = this.stealsFocus ? null : Number(params.backendNodeId);
    }
    if (method === 'Accessibility.getPartialAXTree') {
      const node = Number(params.backendNodeId);
      return {
        nodes: [
          {
            nodeId: '1',
            backendDOMNodeId: node,
            properties: [{ name: 'focused', value: { value: this.focused === node } }],
          },
        ],
      };
    }
    if (method === 'Input.insertText') {
      this.typed.push({ node: this.focused, text: String(params.text) });
    }
    if (method === 'Input.dispatchKeyEvent' && params.type === 'keyDown') {
      this.submits += 1;
      this.onSubmit(this);
    }
    return {};
  }
}

const values = { username: USERNAME, password: PASSWORD };
const signIn = (page: FakePage, origin = ORIGIN, more: string[] = []) =>
  signInOnPage(page.cdp, { ...values, sites: [origin, ...more] }, { timing: TIMING });

async function refusal(work: Promise<unknown>): Promise<SignInError> {
  const error = await work.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(SignInError);
  return error as SignInError;
}

describe('signing in on a page', () => {
  it('types the username and password into their own fields and submits once', async () => {
    const page = new FakePage();
    const login = loginDom();
    page.dom = login.root;
    page.onSubmit = (current) => {
      current.url = `${ORIGIN}/home?session=1`;
      current.emit('Page.frameNavigated');
      current.emit('Page.loadEventFired');
    };
    const hidden: number[] = [];
    const outcome = await signInOnPage(
      page.cdp,
      { ...values, sites: [ORIGIN] },
      {
        timing: TIMING,
        filled: (node) => hidden.push(node),
      },
    );
    expect(page.typed).toEqual([
      { node: login.username.backendNodeId, text: USERNAME },
      { node: login.password.backendNodeId, text: PASSWORD },
    ]);
    expect(page.submits).toBe(1);
    expect(outcome).toEqual({ url: `${ORIGIN}/home?session=1`, steps: 1 });
    expect(hidden).toEqual([login.username.backendNodeId, login.password.backendNodeId]);
  });

  it.each([
    ['another site', 'https://other.example.com/login'],
    ['a look-alike host', 'https://staging.example.com.evil.test/login'],
    ['the same host on another port', 'https://staging.example.com:8443/login'],
    ['the same host over http', 'http://staging.example.com/login'],
    ['a file', 'file:///tmp/login.html'],
    ['a blank tab', 'about:blank'],
  ])('fills nothing when the tab is on %s', async (_name, url) => {
    const page = new FakePage();
    page.dom = loginDom().root;
    page.url = url;
    const error = await refusal(signIn(page));
    expect(error.code).toBe('not_allowed');
    expect(page.sent.filter((method) => method.startsWith('Input.'))).toEqual([]);
    expect(page.sent).not.toContain('DOM.focus');
  });

  it('refuses a sign-in saved for a plain http site that is not local', async () => {
    const page = new FakePage();
    page.dom = loginDom().root;
    page.url = 'http://intranet.example.com/login';
    const error = await refusal(signIn(page, 'http://intranet.example.com'));
    expect(error.code).toBe('not_allowed');
    expect(page.typed).toEqual([]);
  });

  it('signs in on a local development host over http', async () => {
    const page = new FakePage();
    page.dom = loginDom().root;
    page.url = 'http://app.localhost:3000/login';
    await signIn(page, 'http://app.localhost:3000');
    expect(page.typed.map((entry) => entry.text)).toEqual([USERNAME, PASSWORD]);
  });

  it('follows a username page to the password page on the same site', async () => {
    const page = new FakePage();
    const first = usernameStepDom();
    const second = passwordStepDom();
    page.dom = first.root;
    page.onSubmit = (current) => {
      if (current.submits !== 1) return;
      current.dom = second.root;
      current.url = `${ORIGIN}/login/password`;
      current.emit('Page.navigatedWithinDocument');
    };
    const outcome = await signIn(page);
    expect(page.typed).toEqual([
      { node: first.username.backendNodeId, text: USERNAME },
      { node: second.password.backendNodeId, text: PASSWORD },
    ]);
    expect(page.submits).toBe(2);
    expect(outcome.steps).toBe(2);
  });

  it('never types the password when the username step leaves the site', async () => {
    const page = new FakePage();
    page.dom = usernameStepDom().root;
    page.onSubmit = (current) => {
      current.dom = passwordStepDom().root;
      current.url = 'https://login.other-idp.example/authorize';
    };
    const error = await refusal(signIn(page));
    expect(error.code).toBe('not_allowed');
    expect(page.typed.map((entry) => entry.text)).toEqual([USERNAME]);
  });

  it('follows a username step to a listed sign-in site and types the password there', async () => {
    const page = new FakePage();
    page.dom = usernameStepDom().root;
    page.onSubmit = (current) => {
      if (current.submits > 1) return;
      current.dom = passwordStepDom().root;
      current.url = 'https://acme.okta.example/signin/verify';
    };
    const outcome = await signIn(page, ORIGIN, ['https://acme.okta.example']);
    expect(outcome.steps).toBe(2);
    expect(page.typed.map((entry) => entry.text)).toEqual([USERNAME, PASSWORD]);
  });

  it('types nothing when a listed site redirects to one that is not listed before the form', async () => {
    const page = new FakePage();
    page.dom = loginDom().root;
    let checks = 0;
    const answer = page.cdp.send;
    page.cdp.send = (method, params) => {
      if (method === 'Page.getFrameTree' && ++checks === 2) page.url = 'https://evil.example/login';
      return answer(method, params);
    };
    const error = await refusal(signIn(page, ORIGIN, ['https://acme.okta.example']));
    expect(error.code).toBe('not_allowed');
    expect(error.message).toContain('the tab is on https://evil.example');
    expect(page.typed).toEqual([]);
  });

  it('gives up when no password field follows the username step', async () => {
    const page = new FakePage();
    page.dom = usernameStepDom().root;
    const error = await refusal(signIn(page));
    expect(error.message).toBe(SIGN_IN_NO_PASSWORD_STEP);
    expect(page.typed.map((entry) => entry.text)).toEqual([USERNAME]);
  });

  it.each([
    ['in a frame', () => el('HTML', {}, [frame(loginDom().root)]), SIGN_IN_REASONS.framed],
    [
      'ambiguous',
      () => el('HTML', {}, [loginDom().root, loginDom().root]),
      SIGN_IN_REASONS.manyForms,
    ],
    ['missing', () => el('HTML'), SIGN_IN_REASONS.notFound],
  ])('fills nothing when the form is %s', async (_name, build, reason) => {
    const page = new FakePage();
    page.dom = build();
    const error = await refusal(signIn(page));
    expect(error).toMatchObject({ code: 'no_form', message: reason });
    expect(page.sent.filter((method) => method.startsWith('Input.'))).toEqual([]);
  });

  it('stops before typing when the page takes the focus away', async () => {
    const page = new FakePage();
    page.dom = loginDom().root;
    page.stealsFocus = true;
    const error = await refusal(signIn(page));
    expect(error.message).toBe(SIGN_IN_FOCUS_LOST);
    expect(page.typed).toEqual([]);
    expect(page.submits).toBe(0);
  });

  it('reports a browser failure without repeating what it was typing', async () => {
    const page = new FakePage();
    page.dom = loginDom().root;
    page.failing = 'Input.insertText';
    const error = await refusal(signIn(page));
    expect(error.message).toBe(SIGN_IN_FAILED);
    expect(error.message).not.toContain(PASSWORD);
    expect(error.message).not.toContain(USERNAME);
  });
});
