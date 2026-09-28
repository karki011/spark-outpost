import { z } from 'zod';
import { connectableIdSchema } from '@spark-outpost/contracts';
import { DEFAULT_BRANCH_PREFIX } from './projects/worktrees.ts';
import { DEFAULT_KEYCHAIN_SERVICE } from './setup/secrets.ts';

const providerUrl = z
  .url()
  .refine((value) => {
    const url = new URL(value);
    return url.protocol === 'https:' || url.hostname === '127.0.0.1';
  }, 'Provider URLs must use HTTPS, or 127.0.0.1 for local test stubs.')
  .transform((value) => value.replace(/\/$/, ''));

/** Keys for the memory store (tests and benches): a connection's API key, or 'github' for Ship. */
const memorySecretsSchema = z.partialRecord(
  z.union([connectableIdSchema, z.literal('github')]),
  z.string().min(1),
);

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

const memorySecrets = z
  .string()
  .default('{}')
  .transform((value, context) => {
    const parsed = memorySecretsSchema.safeParse(parseJson(value));
    if (parsed.success) return parsed.data;
    context.addIssue({
      code: 'custom',
      message: 'MEMORY_SECRETS must map connection IDs to keys.',
    });
    return z.NEVER;
  });

const configSchema = z.object({
  DATABASE_URL: z.url(),
  API_HOST: z.literal('127.0.0.1').default('127.0.0.1'),
  API_PORT: z.coerce.number().int().positive().default(4318),
  ALLOWED_ORIGINS: z
    .string()
    .default('http://localhost:5173,http://127.0.0.1:5173')
    .transform((value) => value.split(',').map((origin) => origin.trim())),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
  LEASE_SECONDS: z.coerce.number().int().min(5).default(30),
  SESSION_IDLE_MINUTES: z.coerce.number().int().min(1).default(30),
  SESSION_OPEN_LIMIT: z.coerce.number().int().min(1).max(64).default(8),
  AUDIT_RETENTION_DAYS: z.coerce.number().int().min(1).default(90),
  OUTCOME_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.2),
  ORCHESTRATION_COST_CAP_USD: z.coerce.number().positive().optional(),
  AGENT_RUNTIME: z.enum(['acp', 'fake']).default('acp'),
  FAKE_ACP_AGENT: z.string().min(1).optional(),
  SECRET_STORE: z.enum(['keychain', 'memory']).default('keychain'),
  MEMORY_SECRETS: memorySecrets,
  CLI_LOOKUP_LOGIN_SHELL: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  ANTHROPIC_BASE_URL: providerUrl.default('https://api.anthropic.com'),
  OPENAI_BASE_URL: providerUrl.default('https://api.openai.com'),
  TYPESAFE_BASE_URL: providerUrl.default('https://api.typesafe.ai'),
  ZAI_BASE_URL: providerUrl.default('https://api.z.ai/api/anthropic'),
  GITHUB_API_URL: providerUrl.optional(),
  KEYCHAIN_SERVICE: z.string().min(1).default(DEFAULT_KEYCHAIN_SERVICE),
  BRANCH_PREFIX: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/)
    .default(DEFAULT_BRANCH_PREFIX),
  BACKUP_DIR: z.string().min(1).optional(),
  WEB_ROOT: z.string().min(1).optional(),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const fields = result.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(
      `Invalid configuration: ${fields}. Run pnpm db:setup to create .local/credentials.env.`,
    );
  }
  return result.data;
}
