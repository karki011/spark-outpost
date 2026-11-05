import { describe, expect, it } from 'vitest';
import {
  el,
  frame,
  idsOf,
  loginDom,
  passwordStepDom,
  usernameStepDom,
} from './sign-in-dom.fixture.ts';
import {
  SIGN_IN_REASONS,
  candidateNodes,
  chooseSignInFields,
  signInCandidates,
} from './sign-in-fields.ts';
import type { DomNode } from './sensitive-nodes.ts';

function planFor(root: DomNode, hidden: DomNode[] = []) {
  const candidates = signInCandidates(root);
  const visible = new Set(candidateNodes(candidates));
  for (const node of hidden) visible.delete(node.backendNodeId);
  return chooseSignInFields(candidates, visible);
}

describe('finding the sign-in fields', () => {
  it('pairs the password with the username of the same form', () => {
    const { root, username, password } = loginDom();
    expect(planFor(root)).toEqual({
      step: 'credentials',
      username: username.backendNodeId,
      password: password.backendNodeId,
    });
  });

  it('ignores a search box outside the form and fields that cannot be typed in', () => {
    const { root, username, password } = loginDom();
    const page = el('HTML', {}, [
      el('INPUT', { type: 'search', name: 'q' }),
      el('FORM', {}, [el('INPUT', { type: 'text', name: 'q' }), el('BUTTON')]),
      el('INPUT', { type: 'text', name: 'username', disabled: '' }),
      root,
    ]);
    expect(planFor(page)).toMatchObject({
      username: username.backendNodeId,
      password: password.backendNodeId,
    });
  });

  it('takes the username page of a two-step sign-in', () => {
    const { root, username } = usernameStepDom();
    expect(planFor(root)).toEqual({ step: 'username', username: username.backendNodeId });
  });

  it('skips a password field the first step keeps hidden', () => {
    const hidden = el('INPUT', { type: 'password' });
    const username = el('INPUT', { type: 'email' });
    const root = el('HTML', {}, [el('FORM', {}, [username, hidden, el('BUTTON')])]);
    expect(planFor(root, [hidden])).toEqual({ step: 'username', username: username.backendNodeId });
  });

  it('takes the password page of a two-step sign-in', () => {
    const { root, password } = passwordStepDom();
    expect(planFor(root)).toEqual({
      step: 'credentials',
      username: null,
      password: password.backendNodeId,
    });
  });

  it('prefers the one field that is marked as the username', () => {
    const company = el('INPUT', { type: 'text', name: 'company' });
    const username = el('INPUT', { type: 'text', autocomplete: 'username' });
    const password = el('INPUT', { type: 'password' });
    const root = el('FORM', {}, [company, username, password, el('INPUT', { type: 'submit' })]);
    expect(planFor(root)).toMatchObject({ username: username.backendNodeId });
  });

  it.each([
    [
      'two unmarked text fields',
      () =>
        el('FORM', {}, [
          el('INPUT', { type: 'text', name: 'a' }),
          el('INPUT', { type: 'text', name: 'b' }),
          el('INPUT', { type: 'password' }),
          el('BUTTON'),
        ]),
      SIGN_IN_REASONS.manyUsernames,
    ],
    [
      'two sign-in forms',
      () => el('HTML', {}, [loginDom().root, loginDom().root]),
      SIGN_IN_REASONS.manyForms,
    ],
    [
      'a form with two password fields',
      () =>
        el('FORM', {}, [
          el('INPUT', { type: 'email' }),
          el('INPUT', { type: 'password' }),
          el('INPUT', { type: 'password' }),
          el('BUTTON'),
        ]),
      SIGN_IN_REASONS.newPassword,
    ],
    [
      'a new-password field',
      () =>
        el('FORM', {}, [
          el('INPUT', { type: 'email' }),
          el('INPUT', { type: 'password', autocomplete: 'new-password' }),
          el('BUTTON'),
        ]),
      SIGN_IN_REASONS.newPassword,
    ],
    [
      'a password field inside a frame',
      () => el('HTML', {}, [frame(loginDom().root)]),
      SIGN_IN_REASONS.framed,
    ],
    [
      'a password field outside any form',
      () => el('HTML', {}, [el('INPUT', { type: 'email' }), el('INPUT', { type: 'password' })]),
      SIGN_IN_REASONS.noForm,
    ],
    [
      'a form with no submit button',
      () =>
        el('FORM', {}, [
          el('INPUT', { type: 'email' }),
          el('INPUT', { type: 'password' }),
          el('BUTTON', { type: 'button' }),
        ]),
      SIGN_IN_REASONS.noSubmit,
    ],
    ['a page with no form', () => el('HTML', {}, [el('P')]), SIGN_IN_REASONS.notFound],
    [
      'two username-only forms',
      () => el('HTML', {}, [usernameStepDom().root, usernameStepDom().root]),
      SIGN_IN_REASONS.manyForms,
    ],
  ])('refuses %s', (_name, build, reason) => {
    expect(planFor(build())).toEqual({ step: 'none', reason });
  });

  it('does not treat a lone unmarked text field as a username step', () => {
    const root = el('FORM', {}, [el('INPUT', { type: 'text', name: 'q' }), el('BUTTON')]);
    expect(planFor(root)).toEqual({ step: 'none', reason: SIGN_IN_REASONS.notFound });
  });

  it('lists every candidate so their visibility can be checked', () => {
    const { root, username, password } = loginDom();
    const framed = loginDom();
    const page = el('HTML', {}, [root, frame(framed.root)]);
    expect(new Set(candidateNodes(signInCandidates(page)))).toEqual(
      idsOf(username, password, framed.password),
    );
  });
});
