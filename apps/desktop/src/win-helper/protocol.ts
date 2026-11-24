import { z } from 'zod';

export const WIN_HELPER_PROTOCOL = 1;
export const WIN_HELPER_EXE = 'spark-win-helper.exe';
export const HELLO_MESSAGE_MAX = 200;

export const HELLO_OUTCOMES = ['verified', 'cancelled', 'unavailable', 'error'] as const;
export type HelloOutcome = (typeof HELLO_OUTCOMES)[number];

export type WinHelperRequest =
  | { op: 'status' }
  | { op: 'hello.available' }
  | { op: 'hello.verify'; message: string; window: string | null };

export type WinHelperOp = WinHelperRequest['op'];

export const winHelperResultSchemas = {
  status: z.object({ protocol: z.number().int() }),
  'hello.available': z.object({ available: z.boolean() }),
  'hello.verify': z.object({ outcome: z.enum(HELLO_OUTCOMES) }),
} satisfies Record<WinHelperOp, z.ZodType>;

export type WinHelperResult<Op extends WinHelperOp> = z.infer<(typeof winHelperResultSchemas)[Op]>;

export const winHelperLineSchema = z.union([
  z.object({ id: z.string(), ok: z.literal(true), result: z.unknown() }),
  z.object({
    id: z.string().nullable(),
    ok: z.literal(false),
    code: z.string(),
    message: z.string(),
  }),
]);

const KEPT_ENV = ['SystemRoot', 'windir'] as const;

export function winHelperEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const name of KEPT_ENV) {
    const value = env[name];
    if (value) kept[name] = value;
  }
  return kept;
}
