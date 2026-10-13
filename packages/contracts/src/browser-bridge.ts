import { z } from 'zod';
import {
  BROWSER_TABS_MAX,
  BROWSER_URL_MAX,
  browserPlaceSchema,
  browserTabSchema,
} from './browser.ts';
import {
  BROWSER_ACT_LINE_MAX,
  BROWSER_ACT_TEXT_MAX,
  browserActDirectionSchema,
  browserActKeySchema,
  browserActKindSchema,
  browserActTargetSchema,
} from './browser-act.ts';
import { SIGN_IN_ORIGIN_MAX, SIGN_IN_PASSWORD_MAX, SIGN_IN_USERNAME_MAX } from './sign-ins.ts';

export const BROWSER_HOST_ENV = 'SPARK_BROWSER_HOST';
export const BROWSER_REQUEST_TIMEOUT_MS = 30_000;
export const BROWSER_READ_MAX_CHARS = 12_000;
export const BROWSER_LOG_ENTRIES_MAX = 200;
export const BROWSER_LOG_TEXT_MAX = 500;

const chat = { chatId: z.uuid(), runId: z.uuid().nullable() };
const tab = z.string().min(1).max(40).optional();

export const browserReadModeSchema = z.enum(['tree', 'text']);
export type BrowserReadMode = z.infer<typeof browserReadModeSchema>;

export const browserLogKindSchema = z.enum(['console', 'network']);
export type BrowserLogKind = z.infer<typeof browserLogKindSchema>;

export const browserHostRequestSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('open'),
    ...chat,
    url: z.string().min(1).max(BROWSER_URL_MAX),
    tab,
    projectId: z.uuid().nullable(),
    keepSignIns: z.boolean(),
    roots: z.array(z.string().max(4096)).max(16),
  }),
  z.object({ op: z.literal('tabs'), ...chat }),
  z.object({
    op: z.literal('read'),
    ...chat,
    tab,
    mode: browserReadModeSchema,
    ref: z.string().max(20).optional(),
    offset: z.number().int().min(0),
  }),
  z.object({
    op: z.literal('screenshot'),
    ...chat,
    tab,
    ref: z.string().max(20).optional(),
    fullPage: z.boolean(),
  }),
  z.object({
    op: z.literal('logs'),
    ...chat,
    tab,
    kind: browserLogKindSchema,
    filter: z.string().max(200).optional(),
    limit: z.number().int().min(1).max(BROWSER_LOG_ENTRIES_MAX),
  }),
  z.object({ op: z.literal('end_run'), ...chat }),
  z.object({ op: z.literal('page'), ...chat, tab, ref: z.string().max(20).optional() }),
  z.object({
    op: z.literal('act'),
    ...chat,
    tab,
    action: browserActKindSchema,
    ref: z.string().max(20).optional(),
    text: z.string().max(BROWSER_ACT_TEXT_MAX).optional(),
    key: browserActKeySchema.optional(),
    direction: browserActDirectionSchema.optional(),
    origin: z.string().min(1).max(300),
  }),
  z.object({
    op: z.literal('sign_in'),
    ...chat,
    tab: z.string().min(1).max(40),
    origin: z.string().min(1).max(SIGN_IN_ORIGIN_MAX),
    username: z.string().min(1).max(SIGN_IN_USERNAME_MAX),
    password: z.string().min(1).max(SIGN_IN_PASSWORD_MAX),
  }),
]);
export type BrowserHostRequest = z.infer<typeof browserHostRequestSchema>;
export type BrowserHostOp = BrowserHostRequest['op'];

const tabFacts = {
  tabId: z.string(),
  url: z.string().max(BROWSER_URL_MAX),
  title: z.string().max(300),
  place: browserPlaceSchema,
  owner: z.enum(['agent', 'user']),
};

export const browserOpenResultSchema = z.object({
  ...tabFacts,
  status: z.number().int().nullable(),
  reused: z.boolean(),
});
export type BrowserOpenResult = z.infer<typeof browserOpenResultSchema>;

export const browserTabsResultSchema = z.object({
  tabs: z.array(browserTabSchema).max(BROWSER_TABS_MAX),
});
export type BrowserTabsResult = z.infer<typeof browserTabsResultSchema>;

export const browserReadResultSchema = z.object({
  ...tabFacts,
  mode: browserReadModeSchema,
  text: z.string().max(BROWSER_READ_MAX_CHARS),
  total: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  nextOffset: z.number().int().nonnegative().nullable(),
  masked: z.number().int().nonnegative(),
});
export type BrowserReadResult = z.infer<typeof browserReadResultSchema>;

export const browserScreenshotResultSchema = z.object({
  ...tabFacts,
  data: z.string().max(12_000_000),
  mediaType: z.enum(['image/png', 'image/jpeg']),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  masked: z.number().int().nonnegative(),
});
export type BrowserScreenshotResult = z.infer<typeof browserScreenshotResultSchema>;

export const browserLogEntrySchema = z.object({
  at: z.string(),
  level: z.string().max(20),
  text: z.string().max(BROWSER_LOG_TEXT_MAX),
  source: z.string().max(300).nullable(),
  status: z.number().int().nullable(),
  method: z.string().max(12).nullable(),
});
export type BrowserLogEntry = z.infer<typeof browserLogEntrySchema>;

export const browserLogsResultSchema = z.object({
  ...tabFacts,
  kind: browserLogKindSchema,
  entries: z.array(browserLogEntrySchema).max(BROWSER_LOG_ENTRIES_MAX),
  dropped: z.number().int().nonnegative(),
});
export type BrowserLogsResult = z.infer<typeof browserLogsResultSchema>;

export const browserEndRunResultSchema = z.object({ closed: z.number().int().nonnegative() });

export const browserPageResultSchema = z.object({
  ...tabFacts,
  target: browserActTargetSchema.nullable().optional(),
});
export type BrowserPageResult = z.infer<typeof browserPageResultSchema>;

export const browserActResultSchema = z.object({
  ...tabFacts,
  action: browserActKindSchema,
  target: browserActTargetSchema.nullable(),
  from: z.string().max(BROWSER_URL_MAX),
  did: z.string().max(BROWSER_ACT_LINE_MAX),
});
export type BrowserActResult = z.infer<typeof browserActResultSchema>;

export const browserSignInResultSchema = z.object({
  ...tabFacts,
  steps: z.union([z.literal(1), z.literal(2)]),
});
export type BrowserSignInResult = z.infer<typeof browserSignInResultSchema>;

export const browserHostResultSchemas = {
  open: browserOpenResultSchema,
  tabs: browserTabsResultSchema,
  read: browserReadResultSchema,
  screenshot: browserScreenshotResultSchema,
  logs: browserLogsResultSchema,
  end_run: browserEndRunResultSchema,
  page: browserPageResultSchema,
  act: browserActResultSchema,
  sign_in: browserSignInResultSchema,
} as const;

export const browserHostErrorCodeSchema = z.enum([
  'no_tab',
  'no_ref',
  'not_allowed',
  'tab_limit',
  'user_picking',
  'load_failed',
  'no_form',
  'sensitive_field',
  'page_changed',
  'cancelled',
  'failed',
]);
export type BrowserHostErrorCode = z.infer<typeof browserHostErrorCodeSchema>;

export const browserBridgeToHostSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('browser:request'),
    id: z.string().min(1).max(64),
    request: browserHostRequestSchema,
  }),
  z.object({ kind: z.literal('browser:cancel'), id: z.string().min(1).max(64) }),
  z.object({
    kind: z.literal('browser:ports'),
    ports: z.array(z.number().int().min(1).max(65_535)).max(8),
  }),
]);
export type BrowserBridgeToHost = z.infer<typeof browserBridgeToHostSchema>;

export const browserBridgeFromHostSchema = z.discriminatedUnion('ok', [
  z.object({
    kind: z.literal('browser:response'),
    id: z.string(),
    ok: z.literal(true),
    result: z.unknown(),
  }),
  z.object({
    kind: z.literal('browser:response'),
    id: z.string(),
    ok: z.literal(false),
    code: browserHostErrorCodeSchema,
    message: z.string().max(500),
  }),
]);
export type BrowserBridgeFromHost = z.infer<typeof browserBridgeFromHostSchema>;
