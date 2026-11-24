import { z } from 'zod';
import { googleAccountStatusSchema, googleSignInFlowSchema } from './calendar-google.ts';

export const MICROSOFT_READ_SCOPE = 'Calendars.Read';
export const MICROSOFT_EDIT_SCOPE = 'Calendars.ReadWrite';

export const MICROSOFT_CALENDAR_SCOPES = [
  'openid',
  'email',
  'offline_access',
  'User.Read',
  MICROSOFT_READ_SCOPE,
] as const;

export const MICROSOFT_EDIT_SCOPES = [...MICROSOFT_CALENDAR_SCOPES, MICROSOFT_EDIT_SCOPE] as const;

const GRAPH_SCOPE_PREFIX = 'https://graph.microsoft.com/';

export function microsoftScopeNames(scopes: readonly string[]): Set<string> {
  return new Set(
    scopes.map((scope) => {
      const lower = scope.toLowerCase();
      return lower.startsWith(GRAPH_SCOPE_PREFIX) ? lower.slice(GRAPH_SCOPE_PREFIX.length) : lower;
    }),
  );
}

export function microsoftScopesEdit(scopes: readonly string[]): boolean {
  return microsoftScopeNames(scopes).has(MICROSOFT_EDIT_SCOPE.toLowerCase());
}

export function microsoftScopesRead(scopes: readonly string[]): boolean {
  return (
    microsoftScopeNames(scopes).has(MICROSOFT_READ_SCOPE.toLowerCase()) ||
    microsoftScopesEdit(scopes)
  );
}

export const MICROSOFT_EDIT_DECLINED =
  'Microsoft didn’t allow Spark to change events, so Agents can edit stays off.';

export const MICROSOFT_EDIT_LOST =
  'Microsoft no longer lets Spark change events on this account, so Agents can edit is off.';

export const MICROSOFT_EDIT_NEEDS_GRANT =
  'Allow Spark to change events on this Microsoft account first: turn on Agents can edit and finish in Microsoft.';

export const MICROSOFT_EVENT_ID_PREFIX = 'microsoft:';

export function isMicrosoftEventId(id: string): boolean {
  return id.startsWith(MICROSOFT_EVENT_ID_PREFIX);
}

export const calendarMicrosoftStatusSchema = z.object({
  available: z.boolean(),
  accounts: z.array(googleAccountStatusSchema),
  signIn: googleSignInFlowSchema,
});
export type CalendarMicrosoftStatus = z.infer<typeof calendarMicrosoftStatusSchema>;

export const startMicrosoftSignInSchema = z
  .object({ accountId: z.uuid().optional(), editCalendar: z.uuid().optional() })
  .strict()
  .refine((request) => !request.editCalendar || request.accountId, {
    message: 'Allowing edits needs the Microsoft account.',
  });
