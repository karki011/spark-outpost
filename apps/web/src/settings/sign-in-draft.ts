import {
  SIGN_IN_LABEL_MAX,
  SIGN_IN_PASSWORD_MAX,
  SIGN_IN_PASSWORD_MIN,
  SIGN_IN_SITES_MAX,
  SIGN_IN_USERNAME_MAX,
  SIGN_IN_USERNAME_MIN,
  signInOriginOf,
  type SavedSignIn,
  type UpdateSignInRequest,
} from '@spark-outpost/contracts';

export type SignInField = 'label' | 'origin' | 'sites' | 'username' | 'password';

export interface SignInDraft {
  label: string;
  origin: string;
  sites: string;
  username: string;
  password: string;
}

export type SignInErrors = Partial<Record<SignInField, string>>;

export function draftOf(saved: SavedSignIn | null): SignInDraft {
  return {
    label: saved?.label ?? '',
    origin: saved?.origin ?? '',
    sites: (saved?.sites ?? []).join(', '),
    username: '',
    password: '',
  };
}

export function withSite(saved: SavedSignIn, site: string): UpdateSignInRequest {
  return { label: saved.label, origin: saved.origin, sites: [...new Set([...saved.sites, site])] };
}

function typedSites(text: string): { sites: string[]; bad: string | null } {
  const typed = text
    .split(/[\s,]+/)
    .map((site) => site.trim())
    .filter((site) => site !== '');
  const bad = typed.find((site) => signInOriginOf(site) === null) ?? null;
  const sites = [
    ...new Set(typed.map((site) => signInOriginOf(site)).filter((site) => site !== null)),
  ];
  return { sites, bad };
}

function secretError(value: string, name: string, min: number, max: number, kept: boolean) {
  if (value === '' && kept) return undefined;
  if (value.length < min) return `Type the ${name} (at least ${min} characters).`;
  return value.length > max ? `Use a ${name} of ${max} characters or fewer.` : undefined;
}

export function checkedSignIn(
  draft: SignInDraft,
  saved: SavedSignIn | null,
): { request: UpdateSignInRequest | null; errors: SignInErrors } {
  const label = draft.label.trim();
  const kept = saved !== null && saved.username !== null;
  const errors: SignInErrors = {};
  if (label === '') errors.label = 'Type a label, such as Staging admin.';
  else if (label.length > SIGN_IN_LABEL_MAX) {
    errors.label = `Use a label of ${SIGN_IN_LABEL_MAX} characters or fewer.`;
  }
  if (signInOriginOf(draft.origin) === null) {
    errors.origin =
      'Type the site as https://… or a local address such as localhost:3000. Plain http works only for local addresses.';
  }
  const { sites, bad } = typedSites(draft.sites);
  if (bad !== null)
    errors.sites = `${bad} is not a site Spark can sign in on. Use https://… or a local address.`;
  else if (sites.length > SIGN_IN_SITES_MAX) {
    errors.sites = `A sign-in can have ${SIGN_IN_SITES_MAX} more sites at most.`;
  }
  const username = secretError(
    draft.username,
    'username',
    SIGN_IN_USERNAME_MIN,
    SIGN_IN_USERNAME_MAX,
    kept,
  );
  const password = secretError(
    draft.password,
    'password',
    SIGN_IN_PASSWORD_MIN,
    SIGN_IN_PASSWORD_MAX,
    kept,
  );
  if (username) errors.username = username;
  if (password) errors.password = password;
  if (Object.keys(errors).length > 0) return { request: null, errors };
  return {
    request: {
      label,
      origin: draft.origin.trim(),
      sites,
      ...(draft.username === '' ? {} : { username: draft.username }),
      ...(draft.password === '' ? {} : { password: draft.password }),
    },
    errors,
  };
}
