export const APP_LOCK_IDLE_MINUTES = [1, 5, 15, 30] as const;
export type AppLockIdleMinutes = (typeof APP_LOCK_IDLE_MINUTES)[number];

export const WRONG_CODES_ALLOWED = 5;
export const RETRY_WAIT_MS = 60_000;

export interface AppLockSettings {
  enabled: boolean;
  idleMinutes: AppLockIdleMinutes;
  onSleep: boolean;
  touchId: boolean;
  hideNotifications: boolean;
}

export interface AppLockStatus extends AppLockSettings {
  locked: boolean;
  hasCode: boolean;
  touchIdAvailable: boolean;
  retryAt: number | null;
}

export interface StoredCode {
  salt: string;
  hash: string;
}

export interface AppLockRecord {
  settings: AppLockSettings;
  code: StoredCode | null;
}

export interface AppLockState extends AppLockRecord {
  locked: boolean;
  wrongCodes: number;
  retryAt: number | null;
}

export type AppLockPatch = Partial<AppLockSettings>;

export const DEFAULT_APP_LOCK_SETTINGS: AppLockSettings = {
  enabled: false,
  idleMinutes: 5,
  onSleep: true,
  touchId: true,
  hideNotifications: true,
};

const FLAGS = ['enabled', 'onSleep', 'touchId', 'hideNotifications'] as const;
const SALT = /^[0-9a-f]{32}$/;
const HASH = /^[0-9a-f]{128}$/;
const CODE = /^[0-9]{6}$/;

export function isLockCode(value: unknown): value is string {
  return typeof value === 'string' && CODE.test(value);
}

function isIdleMinutes(value: unknown): value is AppLockIdleMinutes {
  return APP_LOCK_IDLE_MINUTES.some((minutes) => minutes === value);
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function parseCode(value: unknown): StoredCode | null {
  const { salt, hash } = recordOf(value);
  if (typeof salt !== 'string' || typeof hash !== 'string') return null;
  return SALT.test(salt) && HASH.test(hash) ? { salt, hash } : null;
}

function savedFlag(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function parseJson(raw: string | null): unknown {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function parseAppLockRecord(raw: string | null): AppLockRecord {
  const saved = recordOf(parseJson(raw));
  const code = parseCode(saved.code);
  const defaults = DEFAULT_APP_LOCK_SETTINGS;
  return {
    settings: {
      enabled: code !== null && savedFlag(saved.enabled, defaults.enabled),
      idleMinutes: isIdleMinutes(saved.idleMinutes) ? saved.idleMinutes : defaults.idleMinutes,
      onSleep: savedFlag(saved.onSleep, defaults.onSleep),
      touchId: savedFlag(saved.touchId, defaults.touchId),
      hideNotifications: savedFlag(saved.hideNotifications, defaults.hideNotifications),
    },
    code,
  };
}

export function serializeAppLockRecord(record: AppLockRecord): string {
  return `${JSON.stringify({ ...record.settings, code: record.code }, null, 2)}\n`;
}

export function parseAppLockPatch(value: unknown): AppLockPatch | null {
  if (!value || typeof value !== 'object') return null;
  const given = value as Record<string, unknown>;
  const patch: AppLockPatch = {};
  for (const flag of FLAGS) {
    if (given[flag] === undefined) continue;
    if (typeof given[flag] !== 'boolean') return null;
    patch[flag] = given[flag];
  }
  if (given.idleMinutes !== undefined) {
    if (!isIdleMinutes(given.idleMinutes)) return null;
    patch.idleMinutes = given.idleMinutes;
  }
  return patch;
}

export function startingState(record: AppLockRecord): AppLockState {
  return { ...record, locked: canLock(record), wrongCodes: 0, retryAt: null };
}

export function canLock(record: AppLockRecord): boolean {
  return record.settings.enabled && record.code !== null;
}

export function lockedState(state: AppLockState): AppLockState {
  return canLock(state) && !state.locked ? { ...state, locked: true } : state;
}

export function unlockedState(state: AppLockState): AppLockState {
  return { ...state, locked: false, wrongCodes: 0, retryAt: null };
}

export function codeRefused(state: AppLockState, now: number): boolean {
  return state.retryAt !== null && now < state.retryAt;
}

export function afterWrongCode(state: AppLockState, now: number): AppLockState {
  const wrongCodes = state.wrongCodes + 1;
  if (wrongCodes < WRONG_CODES_ALLOWED) return { ...state, wrongCodes, retryAt: null };
  return { ...state, wrongCodes: 0, retryAt: now + RETRY_WAIT_MS };
}

export function patchedSettings(state: AppLockState, patch: AppLockPatch): AppLockSettings {
  if (state.locked) return state.settings;
  const next = { ...state.settings, ...patch };
  return { ...next, enabled: next.enabled && state.code !== null };
}

export function locksWhenIdle(state: AppLockState, idleSeconds: number): boolean {
  return canLock(state) && !state.locked && idleSeconds >= state.settings.idleMinutes * 60;
}

export function locksOnSleep(state: AppLockState): boolean {
  return canLock(state) && !state.locked && state.settings.onSleep;
}

export function watchesIdle(status: AppLockStatus): boolean {
  return status.enabled && status.hasCode && !status.locked;
}

export function statusOf(
  state: AppLockState,
  touchIdAvailable: boolean,
  now: number,
): AppLockStatus {
  return {
    ...state.settings,
    locked: state.locked,
    hasCode: state.code !== null,
    touchIdAvailable,
    retryAt: codeRefused(state, now) ? state.retryAt : null,
  };
}
