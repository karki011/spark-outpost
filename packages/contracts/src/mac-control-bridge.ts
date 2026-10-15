import { z } from 'zod';
import { BROWSER_READ_MAX_CHARS, BROWSER_READ_MIN_CHARS } from './browser-bridge.ts';
import {
  macHelperKeySchema,
  macIdentitySchema,
  macReadScopeSchema,
  macRefSchema,
  macScrollDirectionSchema,
  macTargetSchema,
  macWindowSchema,
} from './mac-control-helper.ts';

export const MAC_REQUEST_TIMEOUT_MS = 30_000;
export const MAC_ACCESSIBILITY_SETTINGS_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility';

const chat = { chatId: z.uuid(), runId: z.uuid().nullable() };
const pid = z.number().int().positive();

export const macRefusalKindSchema = z.enum([
  'system_settings',
  'security_prompt',
  'passwords',
  'browser',
  'spark',
  'impostor',
]);

export const macReadModeSchema = z.enum(['tree', 'text']);
export type MacReadMode = z.infer<typeof macReadModeSchema>;

export const macHostRequestSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('apps'), ...chat }),
  z.object({ op: z.literal('resolve'), ...chat, app: z.string().min(1).max(200) }),
  z.object({
    op: z.literal('read'),
    ...chat,
    pid,
    window: z.number().int().min(0).max(49).optional(),
    ref: macRefSchema.optional(),
    scope: macReadScopeSchema.optional(),
    mode: macReadModeSchema,
    offset: z.number().int().min(0),
    maxChars: z.number().int().min(BROWSER_READ_MIN_CHARS).max(BROWSER_READ_MAX_CHARS),
  }),
  z.object({
    op: z.literal('target'),
    ...chat,
    pid,
    ref: macRefSchema.optional(),
    focused: z.boolean().optional(),
    menu: z.array(z.string().min(1).max(200)).min(1).max(8).optional(),
    refind: z.boolean(),
  }),
  z.object({
    op: z.literal('act'),
    ...chat,
    pid,
    app: z.string().max(200),
    action: z.enum(['press', 'key', 'scroll']),
    ref: macRefSchema.optional(),
    key: macHelperKeySchema.optional(),
    direction: macScrollDirectionSchema.optional(),
    expect: macIdentitySchema.optional(),
    did: z.string().max(300),
  }),
  z.object({ op: z.literal('open'), ...chat, bundleId: z.string().min(1).max(200) }),
  z.object({ op: z.literal('end_run'), ...chat }),
]);
export type MacHostRequest = z.infer<typeof macHostRequestSchema>;
export type MacHostOp = MacHostRequest['op'];

export const macAppSchema = z.object({
  pid: pid.nullable(),
  name: z.string().max(200),
  bundleId: z.string().max(200).nullable(),
  frontmost: z.boolean(),
  windows: z.array(macWindowSchema).max(50),
  refused: macRefusalKindSchema.nullable(),
});
export type MacApp = z.infer<typeof macAppSchema>;

export const macHostResultSchemas = {
  apps: z.object({ apps: z.array(macAppSchema).max(200) }),
  resolve: z.object({ app: macAppSchema }),
  read: z.object({
    app: macAppSchema,
    window: macWindowSchema,
    scope: z.enum(['window', 'sheet', 'menu', 'ref']),
    rootRef: macRefSchema,
    mode: macReadModeSchema,
    text: z.string().max(BROWSER_READ_MAX_CHARS),
    total: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(),
    nextOffset: z.number().int().nonnegative().nullable(),
    leftOut: z.number().int().nonnegative(),
    masked: z.number().int().nonnegative(),
    truncated: z.boolean(),
  }),
  target: z.object({ app: macAppSchema, target: macTargetSchema }),
  act: z.object({ did: z.string().max(300) }),
  open: z.object({ app: macAppSchema }),
  end_run: z.object({ ended: z.boolean() }),
} satisfies Record<MacHostOp, z.ZodType>;

export const macHostErrorCodeSchema = z.enum([
  'not_trusted',
  'screen_locked',
  'paused_by_user',
  'stopped',
  'refused',
  'no_app',
  'no_window',
  'gone',
  'changed',
  'not_pressable',
  'not_found',
  'cancelled',
  'failed',
]);
export type MacHostErrorCode = z.infer<typeof macHostErrorCodeSchema>;

export const macBridgeToHostSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('mac:request'),
    id: z.string().min(1).max(64),
    request: macHostRequestSchema,
  }),
  z.object({ kind: z.literal('mac:cancel'), id: z.string().min(1).max(64) }),
]);
export type MacBridgeToHost = z.infer<typeof macBridgeToHostSchema>;

export const macBridgeFromHostSchema = z.discriminatedUnion('ok', [
  z.object({
    kind: z.literal('mac:response'),
    id: z.string(),
    ok: z.literal(true),
    result: z.unknown(),
  }),
  z.object({
    kind: z.literal('mac:response'),
    id: z.string(),
    ok: z.literal(false),
    code: macHostErrorCodeSchema,
    message: z.string().max(500),
  }),
]);
export type MacBridgeFromHost = z.infer<typeof macBridgeFromHostSchema>;

export const macControlStatusSchema = z.object({
  supported: z.boolean(),
  trusted: z.boolean(),
  helper: z.enum(['ready', 'missing', 'failed']),
});
export type MacControlStatus = z.infer<typeof macControlStatusSchema>;

export const macIndicatorSchema = z.object({
  app: z.string().max(200).nullable(),
  did: z.string().max(300).nullable(),
  paused: z.boolean(),
});
export type MacIndicator = z.infer<typeof macIndicatorSchema>;
