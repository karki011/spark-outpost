import { z } from 'zod';

export const GOOGLE_CALENDAR_LIST_SCOPE =
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly';
export const GOOGLE_EVENTS_READ_SCOPE = 'https://www.googleapis.com/auth/calendar.events.readonly';
export const GOOGLE_EVENTS_EDIT_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

export const GOOGLE_CALENDAR_SCOPES = [
  'openid',
  'email',
  GOOGLE_CALENDAR_LIST_SCOPE,
  GOOGLE_EVENTS_READ_SCOPE,
] as const;

export const GOOGLE_EDIT_SCOPES = [...GOOGLE_CALENDAR_SCOPES, GOOGLE_EVENTS_EDIT_SCOPE] as const;

export function googleScopesRead(scopes: readonly string[]): boolean {
  const granted = new Set(scopes);
  const events = granted.has(GOOGLE_EVENTS_READ_SCOPE) || granted.has(GOOGLE_EVENTS_EDIT_SCOPE);
  return granted.has(GOOGLE_CALENDAR_LIST_SCOPE) && events;
}

export function googleScopesEdit(scopes: readonly string[]): boolean {
  return scopes.includes(GOOGLE_EVENTS_EDIT_SCOPE);
}

export const GOOGLE_EDIT_DECLINED =
  'Google didn’t allow Spark to change events, so Agents can edit stays off.';

export const GOOGLE_EDIT_LOST =
  'Google no longer lets Spark change events on this account, so Agents can edit is off.';

export const GOOGLE_EDIT_NEEDS_GRANT =
  'Allow Spark to change events on this Google account first: turn on Agents can edit and finish in Google.';

export const GOOGLE_TESTING_LINE =
  'Google sign-in expires every 7 days until Spark’s Google app is verified.';

export const GOOGLE_EVENT_ID_PREFIX = 'google:';

export function isGoogleEventId(id: string): boolean {
  return id.startsWith(GOOGLE_EVENT_ID_PREFIX);
}

export const googleAccountStateSchema = z.enum(['syncing', 'ready', 'sign_in_again', 'error']);
export type GoogleAccountState = z.infer<typeof googleAccountStateSchema>;

export const googleAccountStatusSchema = z.object({
  id: z.uuid(),
  email: z.string().max(320),
  state: googleAccountStateSchema,
  message: z.string().max(500).nullable(),
  canEdit: z.boolean(),
});
export type GoogleAccountStatus = z.infer<typeof googleAccountStatusSchema>;

export const googleSignInFlowSchema = z.object({
  status: z.enum(['idle', 'waiting', 'connected', 'failed']),
  authorizeUrl: z.url().nullable(),
  expiresAt: z.iso.datetime({ offset: true }).nullable(),
  message: z.string().max(500).nullable(),
});
export type GoogleSignInFlow = z.infer<typeof googleSignInFlowSchema>;

export const calendarGoogleStatusSchema = z.object({
  available: z.boolean(),
  testing: z.boolean(),
  accounts: z.array(googleAccountStatusSchema),
  signIn: googleSignInFlowSchema,
});
export type CalendarGoogleStatus = z.infer<typeof calendarGoogleStatusSchema>;

export const startGoogleSignInSchema = z
  .object({ accountId: z.uuid().optional(), editCalendar: z.uuid().optional() })
  .strict()
  .refine((request) => !request.editCalendar || request.accountId, {
    message: 'Allowing edits needs the Google account.',
  });
export type StartGoogleSignIn = z.infer<typeof startGoogleSignInSchema>;
