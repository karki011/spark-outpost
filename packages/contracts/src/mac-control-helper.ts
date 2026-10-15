import { z } from 'zod';

export const MAC_HELPER_NAME = 'spark-mac-control';
export const MAC_HELPER_SILENT_MS = 30_000;
export const MAC_READ_NODES_MAX = 5_000;
export const MAC_READ_DEPTH_MAX = 30;
export const MAC_VALUE_MAX = 160;
export const MAC_REF = /^ax_[1-9]\d{0,8}$/;

export const macRefSchema = z.string().regex(MAC_REF);
const pid = z.number().int().positive();
const text = (max: number) => z.string().max(max).nullable();

export const macSignatureSchema = z.object({
  valid: z.boolean(),
  apple: z.boolean(),
  teamId: text(20),
});
export type MacSignature = z.infer<typeof macSignatureSchema>;

export const macWindowSchema = z.object({ index: z.number().int().min(0), title: text(300) });
export type MacWindow = z.infer<typeof macWindowSchema>;

export const macRunningAppSchema = z.object({
  pid,
  name: z.string().max(200),
  bundleId: text(200),
  path: text(4096),
  frontmost: z.boolean(),
  signature: macSignatureSchema,
  windows: z.array(macWindowSchema).max(50),
});
export type MacRunningApp = z.infer<typeof macRunningAppSchema>;

export const macIdentitySchema = z.object({
  role: z.string().max(100),
  subrole: text(100),
  title: text(300),
  description: text(300),
  identifier: text(300),
});
export type MacIdentity = z.infer<typeof macIdentitySchema>;

export const macNodeSchema = macIdentitySchema.extend({
  ref: macRefSchema,
  depth: z.number().int().min(0).max(64),
  value: text(400),
  enabled: z.boolean(),
  focused: z.boolean(),
  secure: z.boolean(),
  actions: z.array(z.string().max(60)).max(20),
});
export type MacNode = z.infer<typeof macNodeSchema>;

export const macReadScopeSchema = z.enum(['window', 'sheet', 'menu']);
export type MacReadScope = z.infer<typeof macReadScopeSchema>;

export const macTargetStateSchema = z.enum(['alive', 'gone', 'refound']);

export const macTargetSchema = z.object({
  ref: macRefSchema,
  state: macTargetStateSchema,
  pid,
  window: macWindowSchema.nullable(),
  identity: macIdentitySchema,
  ancestors: z.array(z.string().max(300)).max(3),
  actions: z.array(z.string().max(60)).max(20),
  secure: z.boolean(),
});
export type MacTarget = z.infer<typeof macTargetSchema>;

export const macHelperKeySchema = z.enum(['space', 'return', 'enter']);
export type MacHelperKey = z.infer<typeof macHelperKeySchema>;

export const macScrollDirectionSchema = z.enum(['up', 'down', 'left', 'right']);
export type MacScrollDirection = z.infer<typeof macScrollDirectionSchema>;

export const macHelperRequestSchema = z.discriminatedUnion('op', [
  z.object({ id: z.string(), op: z.literal('status') }),
  z.object({ id: z.string(), op: z.literal('prompt') }),
  z.object({ id: z.string(), op: z.literal('apps') }),
  z.object({
    id: z.string(),
    op: z.literal('read'),
    pid,
    window: z.number().int().min(0).optional(),
    ref: macRefSchema.optional(),
    scope: macReadScopeSchema.optional(),
  }),
  z.object({ id: z.string(), op: z.literal('target'), ref: macRefSchema, refind: z.boolean() }),
  z.object({ id: z.string(), op: z.literal('focused'), pid }),
  z.object({
    id: z.string(),
    op: z.literal('menu'),
    pid,
    path: z.array(z.string().min(1).max(200)).min(1).max(8),
  }),
  z.object({
    id: z.string(),
    op: z.literal('press'),
    ref: macRefSchema,
    expect: macIdentitySchema,
  }),
  z.object({
    id: z.string(),
    op: z.literal('key'),
    ref: macRefSchema,
    key: macHelperKeySchema,
    expect: macIdentitySchema,
  }),
  z.object({
    id: z.string(),
    op: z.literal('scroll'),
    pid,
    ref: macRefSchema.optional(),
    direction: macScrollDirectionSchema,
  }),
  z.object({ id: z.string(), op: z.literal('open'), bundleId: z.string().min(1).max(200) }),
]);
export type MacHelperRequest = z.infer<typeof macHelperRequestSchema>;
export type MacHelperOp = MacHelperRequest['op'];

export const macStatusSchema = z.object({
  trusted: z.boolean(),
  locked: z.boolean(),
  secureInput: z.boolean(),
  idleSeconds: z.number().min(0),
  frontmostPid: pid.nullable(),
});
export type MacStatus = z.infer<typeof macStatusSchema>;

export const macReadResultSchema = z.object({
  window: macWindowSchema,
  scope: z.enum(['window', 'sheet', 'menu', 'ref']),
  rootRef: macRefSchema,
  nodes: z.array(macNodeSchema).max(MAC_READ_NODES_MAX),
  truncated: z.boolean(),
});
export type MacReadResult = z.infer<typeof macReadResultSchema>;

const done = z.object({ done: z.literal(true) });

export const macHelperResultSchemas = {
  status: macStatusSchema,
  prompt: z.object({ trusted: z.boolean() }),
  apps: z.object({ apps: z.array(macRunningAppSchema).max(200) }),
  read: macReadResultSchema,
  target: macTargetSchema,
  focused: macTargetSchema.nullable(),
  menu: macTargetSchema,
  press: done,
  key: done,
  scroll: done,
  open: z.object({ pid }),
} satisfies Record<MacHelperOp, z.ZodType>;

export const macHelperErrorCodeSchema = z.enum([
  'not_trusted',
  'no_app',
  'no_window',
  'gone',
  'changed',
  'not_pressable',
  'not_found',
  'ax_failed',
  'invalid',
]);
export type MacHelperErrorCode = z.infer<typeof macHelperErrorCodeSchema>;

export const macHelperResponseSchema = z.union([
  z.object({ id: z.string(), ok: z.literal(true), result: z.unknown() }),
  z.object({
    id: z.string(),
    ok: z.literal(false),
    code: macHelperErrorCodeSchema,
    message: z.string().max(500),
  }),
]);
export type MacHelperResponse = z.infer<typeof macHelperResponseSchema>;
