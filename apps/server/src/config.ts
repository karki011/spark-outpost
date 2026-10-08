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

const memorySecretsSchema = z.partialRecord(
  z.union([
    connectableIdSchema,
    z.literal('github'),
    z.enum(['ticket:linear', 'ticket:jira', 'slack:bot', 'slack:user', 'slack:app']),
    z.templateLiteral(['signin:', z.uuid()]),
  ]),
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
  SESSION_IDLE_MINUTES: z.coerce.number().int().min(1).default(240),
  AUDIT_RETENTION_DAYS: z.coerce.number().int().min(1).default(90),
  OUTCOME_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.2),
  AGENT_RUNTIME: z.enum(['acp', 'fake']).default('acp'),
  COORDINATOR_MODE: z.enum(['off', 'shadow', 'in_order', 'parallel']).default('parallel'),
  PARALLEL_AGENT_LIMIT: z.coerce.number().int().min(1).max(32).default(6),
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
  GITHUB_LOGIN_URL: providerUrl.optional(),
  SPARK_GITHUB_APP_CLIENT_ID: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9.]{0,64}$/)
    .default(''),
  SPARK_GITHUB_APP_SLUG: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9-]{0,64}$/)
    .default(''),
  LINEAR_API_URL: providerUrl.optional(),
  SLACK_API_URL: providerUrl.optional(),
  SPARK_SLACK_CLIENT_ID: z
    .string()
    .trim()
    .regex(/^(?:\d{1,20}\.\d{1,20})?$/)
    .default(''),
  SPARK_LINK_SCHEME: z
    .string()
    .regex(/^[a-z][a-z0-9-]*$/)
    .optional(),
  KEYCHAIN_SERVICE: z.string().min(1).default(DEFAULT_KEYCHAIN_SERVICE),
  BRANCH_PREFIX: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/)
    .default(DEFAULT_BRANCH_PREFIX),
  BACKUP_DIR: z.string().min(1).optional(),
  MAP_ROOT_PREFIX: z.string().min(1).optional(),
  CLONE_TEST_ROOT: z.string().min(1).optional(),
  WEB_ROOT: z.string().min(1).optional(),
  SPARK_APP_VERSION: z.string().min(1).optional(),
  SPARK_LOG_DIR: z.string().min(1).optional(),
  SPARK_DATA_DIR: z.string().min(1).optional(),
  MORNING_BRIEF: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
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
