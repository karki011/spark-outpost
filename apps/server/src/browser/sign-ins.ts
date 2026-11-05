import {
  SIGN_INS_PER_PROJECT_MAX,
  maskUsername,
  signInOriginOf,
  type CreateSignInRequest,
  type SavedSignIn,
  type UpdateSignInRequest,
} from '@spark-outpost/contracts';
import {
  countSignInRows,
  deleteSignInRow,
  getSignInRow,
  insertSignInRow,
  listSignInRows,
  signInRefs,
  updateSignInRow,
  type SignInRow,
} from '../persistence/browser-sign-ins.ts';
import type { Queryable } from '../persistence/db.ts';
import { newId } from '../persistence/ids.ts';
import type { SecretStore } from '../setup/secrets.ts';

export interface SignInDeps {
  db: Queryable;
  secrets: SecretStore;
}

export interface SignInSecret {
  username: string;
  password: string;
}

export class SignInProblem extends Error {}

export const SIGN_IN_ORIGIN_HELP =
  'Type the site as https://… or a local address such as http://localhost:3000. Plain http works only for localhost, 127.0.0.1, *.localhost and *.test.';
export const SIGN_IN_NOT_FOUND = 'That sign-in is no longer saved.';
export const SIGN_IN_MISSING_SECRET =
  'This sign-in is missing from the keychain. Save its username and password again in Settings.';

const keychainRef = (id: string) => `signin:${id}` as const;

function isSecretRef(ref: string): ref is `signin:${string}` {
  return ref.startsWith('signin:');
}

export async function readSignInSecret(
  secrets: Pick<SecretStore, 'get'>,
  ref: string,
): Promise<SignInSecret | null> {
  if (!isSecretRef(ref)) return null;
  const raw = await secrets.get(ref);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SignInSecret>;
    return typeof parsed.username === 'string' && typeof parsed.password === 'string'
      ? { username: parsed.username, password: parsed.password }
      : null;
  } catch {
    return null;
  }
}

async function writeSecret(secrets: SecretStore, ref: string, secret: SignInSecret) {
  if (!isSecretRef(ref)) throw new SignInProblem(SIGN_IN_MISSING_SECRET);
  await secrets.set(ref, JSON.stringify(secret));
}

async function forgetSecret(secrets: SecretStore, ref: string): Promise<void> {
  if (isSecretRef(ref)) await secrets.delete(ref).catch(() => undefined);
}

function saved(row: SignInRow, secret: SignInSecret | null): SavedSignIn {
  return {
    id: row.id,
    projectId: row.project_id,
    label: row.label,
    origin: row.origin,
    sites: row.sites,
    refusedSite: row.refused_site,
    username: secret ? maskUsername(secret.username) : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function originOf(typed: string): string {
  const origin = signInOriginOf(typed);
  if (!origin) throw new SignInProblem(SIGN_IN_ORIGIN_HELP);
  return origin;
}

function sitesOf(origin: string, typed: readonly string[] | undefined): string[] {
  const sites = (typed ?? []).map(originOf).filter((site) => site !== origin);
  return [...new Set(sites)];
}

export async function listSignIns(deps: SignInDeps, projectId: string): Promise<SavedSignIn[]> {
  const rows = await listSignInRows(deps.db, projectId);
  return Promise.all(
    rows.map(async (row) => saved(row, await readSignInSecret(deps.secrets, row.keychain_ref))),
  );
}

export async function createSignIn(
  deps: SignInDeps,
  projectId: string,
  request: CreateSignInRequest,
): Promise<SavedSignIn> {
  const origin = originOf(request.origin);
  if ((await countSignInRows(deps.db, projectId)) >= SIGN_INS_PER_PROJECT_MAX) {
    throw new SignInProblem(`A project can keep ${SIGN_INS_PER_PROJECT_MAX} sign-ins.`);
  }
  const id = newId();
  const secret = { username: request.username, password: request.password };
  const row = await insertSignInRow(deps.db, {
    id,
    projectId,
    label: request.label,
    origin,
    sites: sitesOf(origin, request.sites),
    keychainRef: keychainRef(id),
  });
  try {
    await writeSecret(deps.secrets, row.keychain_ref, secret);
  } catch (error) {
    await deleteSignInRow(deps.db, projectId, id);
    throw error;
  }
  return saved(row, secret);
}

export async function updateSignIn(
  deps: SignInDeps,
  projectId: string,
  id: string,
  request: UpdateSignInRequest,
): Promise<SavedSignIn> {
  const origin = originOf(request.origin);
  const before = await getSignInRow(deps.db, projectId, id);
  if (!before) throw new SignInProblem(SIGN_IN_NOT_FOUND);
  const kept = await readSignInSecret(deps.secrets, before.keychain_ref);
  const username = request.username ?? kept?.username;
  const password = request.password ?? kept?.password;
  if (username === undefined || password === undefined) {
    throw new SignInProblem(SIGN_IN_MISSING_SECRET);
  }
  const secret = { username, password };
  const sites = request.sites === undefined ? before.sites : request.sites;
  const row = await updateSignInRow(deps.db, projectId, id, {
    label: request.label,
    origin,
    sites: sitesOf(origin, sites),
  });
  if (!row) throw new SignInProblem(SIGN_IN_NOT_FOUND);
  if (request.username !== undefined || request.password !== undefined) {
    await writeSecret(deps.secrets, row.keychain_ref, secret);
  }
  return saved(row, secret);
}

export async function deleteSignIn(deps: SignInDeps, projectId: string, id: string): Promise<void> {
  const row = await deleteSignInRow(deps.db, projectId, id);
  if (row) await forgetSecret(deps.secrets, row.keychain_ref);
}

export async function forgettingProjectSignIns<T>(
  deps: SignInDeps,
  projectId: string,
  remove: () => Promise<T>,
): Promise<T> {
  const refs = await signInRefs(deps.db, projectId);
  const removed = await remove();
  for (const ref of refs) await forgetSecret(deps.secrets, ref);
  return removed;
}

export async function projectSignInSecrets(
  deps: { db: Queryable; secrets: Pick<SecretStore, 'get'> },
  projectId: string,
): Promise<SignInSecret[]> {
  const rows = await listSignInRows(deps.db, projectId);
  const secrets = await Promise.all(
    rows.map((row) => readSignInSecret(deps.secrets, row.keychain_ref)),
  );
  return secrets.filter((secret) => secret !== null);
}
