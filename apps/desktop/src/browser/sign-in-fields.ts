import { attributesOf, isSensitiveField, type DomNode } from './sensitive-nodes.ts';

export interface UsernameField {
  node: number;
  named: boolean;
}

export interface SignInForm {
  passwords: number[];
  usernames: UsernameField[];
  setsPassword: boolean;
  submits: boolean;
}

export interface SignInCandidates {
  forms: SignInForm[];
  framedPasswords: number[];
  loosePasswords: number[];
}

export type SignInPlan =
  | { step: 'credentials'; username: number | null; password: number }
  | { step: 'username'; username: number }
  | { step: 'none'; reason: string };

export const SIGN_IN_REASONS = {
  notFound: 'Spark could not find a sign-in form on this page. Nothing was filled.',
  manyForms:
    'This page has more than one sign-in form, so Spark could not tell which to use. Nothing was filled.',
  manyUsernames:
    'Spark could not tell which field takes the username in the sign-in form. Nothing was filled.',
  newPassword:
    'This looks like a form that sets a new password, not a sign-in form. Nothing was filled.',
  framed:
    'The sign-in form is inside a frame. Spark fills only the page itself. Nothing was filled.',
  noSubmit: 'The sign-in form has no submit button Spark can use. Nothing was filled.',
  noForm:
    'The password field is not inside a form, so Spark could not tell what belongs to it. Nothing was filled.',
} as const;

const TEXT_TYPES = new Set(['', 'text', 'email', 'tel']);
const USERNAME_AUTOCOMPLETE = /(^|\s)(username|email)(\s|$)/i;
const NEW_PASSWORD = /(^|\s)new-password(\s|$)/i;
const SUBMIT_INPUTS = new Set(['submit', 'image']);
const USERNAME_HINT = /user|e-?mail|login|account|identifier|phone/i;

function editable(attributes: Map<string, string>): boolean {
  return !attributes.has('disabled') && !attributes.has('readonly');
}

function looksLikeUsername(attributes: Map<string, string>): boolean {
  if ((attributes.get('type') ?? '').toLowerCase() === 'email') return true;
  if (USERNAME_AUTOCOMPLETE.test(attributes.get('autocomplete') ?? '')) return true;
  return ['name', 'id', 'aria-label', 'placeholder'].some((name) =>
    USERNAME_HINT.test(attributes.get(name) ?? ''),
  );
}

interface Place {
  form: SignInForm | null;
  framed: boolean;
}

function noteInput(node: DomNode, place: Place, found: SignInCandidates): void {
  const attributes = attributesOf(node);
  if (!editable(attributes)) return;
  const type = (attributes.get('type') ?? '').toLowerCase();
  if (type === 'password') {
    if (place.framed) found.framedPasswords.push(node.backendNodeId);
    else if (!place.form) found.loosePasswords.push(node.backendNodeId);
    else {
      place.form.passwords.push(node.backendNodeId);
      if (NEW_PASSWORD.test(attributes.get('autocomplete') ?? '')) place.form.setsPassword = true;
    }
    return;
  }
  if (place.framed || !place.form || !TEXT_TYPES.has(type) || isSensitiveField(node)) return;
  place.form.usernames.push({ node: node.backendNodeId, named: looksLikeUsername(attributes) });
}

function submits(node: DomNode): boolean {
  const attributes = attributesOf(node);
  if (attributes.has('disabled')) return false;
  const type = (attributes.get('type') ?? '').toLowerCase();
  const tag = node.nodeName.toUpperCase();
  if (tag === 'BUTTON') return type === '' || type === 'submit';
  return tag === 'INPUT' && SUBMIT_INPUTS.has(type);
}

function walk(node: DomNode, place: Place, found: SignInCandidates): void {
  const tag = node.nodeName.toUpperCase();
  let here = place;
  if (tag === 'FORM' && !place.framed) {
    const form: SignInForm = { passwords: [], usernames: [], setsPassword: false, submits: false };
    found.forms.push(form);
    here = { form, framed: false };
  }
  if (here.form && submits(node)) here.form.submits = true;
  if (tag === 'INPUT') noteInput(node, here, found);
  for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? [])]) {
    walk(child, here, found);
  }
  if (node.contentDocument) walk(node.contentDocument, { form: null, framed: true }, found);
}

export function signInCandidates(root: DomNode): SignInCandidates {
  const found: SignInCandidates = { forms: [], framedPasswords: [], loosePasswords: [] };
  walk(root, { form: null, framed: false }, found);
  return found;
}

export function candidateNodes(candidates: SignInCandidates): number[] {
  return [
    ...candidates.forms.flatMap((form) => [
      ...form.passwords,
      ...form.usernames.map((field) => field.node),
    ]),
    ...candidates.framedPasswords,
    ...candidates.loosePasswords,
  ];
}

function usernameOf(fields: readonly UsernameField[]): number | null | 'unclear' {
  if (fields.length === 0) return null;
  if (fields.length === 1) return fields[0]!.node;
  const named = fields.filter((field) => field.named);
  return named.length === 1 ? named[0]!.node : 'unclear';
}

const none = (reason: string): SignInPlan => ({ step: 'none', reason });

export function chooseSignInFields(
  candidates: SignInCandidates,
  visible: ReadonlySet<number>,
): SignInPlan {
  const forms = candidates.forms.map((form) => ({
    passwords: form.passwords.filter((node) => visible.has(node)),
    usernames: form.usernames.filter((field) => visible.has(field.node)),
    setsPassword: form.setsPassword,
    submits: form.submits,
  }));
  const withPassword = forms.filter((form) => form.passwords.length > 0);
  if (withPassword.length > 1) return none(SIGN_IN_REASONS.manyForms);
  const form = withPassword[0];
  if (form) {
    if (form.passwords.length > 1 || form.setsPassword) return none(SIGN_IN_REASONS.newPassword);
    const username = usernameOf(form.usernames);
    if (username === 'unclear') return none(SIGN_IN_REASONS.manyUsernames);
    if (!form.submits && username !== null) return none(SIGN_IN_REASONS.noSubmit);
    return { step: 'credentials', username, password: form.passwords[0]! };
  }
  if (candidates.framedPasswords.some((node) => visible.has(node))) {
    return none(SIGN_IN_REASONS.framed);
  }
  if (candidates.loosePasswords.some((node) => visible.has(node))) {
    return none(SIGN_IN_REASONS.noForm);
  }
  const usernameOnly = forms.filter(
    (candidate) => candidate.usernames.length === 1 && candidate.usernames[0]!.named,
  );
  if (usernameOnly.length > 1) return none(SIGN_IN_REASONS.manyForms);
  const first = usernameOnly[0];
  return first
    ? { step: 'username', username: first.usernames[0]!.node }
    : none(SIGN_IN_REASONS.notFound);
}
