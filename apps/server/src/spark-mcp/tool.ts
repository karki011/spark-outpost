import { z } from 'zod';
import type { SparkScope, SparkToolDeps } from './deps.ts';

export interface SparkToolContext {
  deps: SparkToolDeps;
  scope: SparkScope;
  signal?: AbortSignal;
}

export type SparkBlock =
  { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };

export class SparkBlocks {
  readonly blocks: readonly SparkBlock[];

  constructor(blocks: readonly SparkBlock[]) {
    this.blocks = blocks;
  }
}

export type SparkToolNeed =
  | 'tickets'
  | 'slack'
  | 'pull_requests'
  | 'project'
  | 'publish'
  | 'pull_request_create'
  | 'browser'
  | 'outpost'
  | 'outpost_draft';

export interface SparkTool {
  name: string;
  title: string;
  description: string;
  acts?: boolean;
  privateData?: boolean | PrivateData<unknown>;
  needs?: SparkToolNeed;
  input: z.ZodRawShape;
  run(args: unknown, context: SparkToolContext): Promise<unknown>;
}

export type PrivateData<Args> = (args: Args, context: SparkToolContext) => Promise<boolean>;

export class SparkToolError extends Error {}

export function sparkTool<Shape extends z.ZodRawShape>(
  definition: Omit<SparkTool, 'input' | 'run' | 'privateData'> & {
    input: Shape;
    privateData?: boolean | PrivateData<z.output<z.ZodObject<Shape>>>;
    run(args: z.output<z.ZodObject<Shape>>, context: SparkToolContext): Promise<unknown>;
  },
): SparkTool {
  const schema = z.object(definition.input);
  const { privateData, ...rest } = definition;
  const reads: boolean | PrivateData<unknown> | undefined =
    typeof privateData === 'function'
      ? (args, context) => privateData(schema.parse(args ?? {}), context)
      : privateData;
  return {
    ...rest,
    ...(reads === undefined ? {} : { privateData: reads }),
    run: (args, context) => definition.run(schema.parse(args ?? {}), context),
  };
}

export async function returnsPrivateData(
  tool: SparkTool,
  args: unknown,
  context: SparkToolContext,
): Promise<boolean> {
  if (typeof tool.privateData !== 'function') return tool.privateData === true;
  return tool.privateData(args, context);
}

const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export const uuidInput = z
  .string()
  .max(36)
  .refine((value) => UUID.test(value), 'Pass an id (a UUID).');

export const limitInput = (fallback: number, max: number) =>
  z.number().int().min(1).max(max).default(fallback);

export const offsetInput = z
  .number()
  .int()
  .min(0)
  .default(0)
  .describe('Skip this many; pass nextOffset from the last result.');
