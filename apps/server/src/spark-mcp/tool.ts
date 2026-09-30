import { z } from 'zod';
import type { SparkScope, SparkToolDeps } from './deps.ts';

export interface SparkToolContext {
  deps: SparkToolDeps;
  scope: SparkScope;
  signal?: AbortSignal;
}

export interface SparkTool {
  name: string;
  title: string;
  description: string;
  acts?: boolean;
  input: z.ZodRawShape;
  run(args: unknown, context: SparkToolContext): Promise<unknown>;
}

export class SparkToolError extends Error {}

export function sparkTool<Shape extends z.ZodRawShape>(
  definition: Omit<SparkTool, 'input' | 'run'> & {
    input: Shape;
    run(args: z.output<z.ZodObject<Shape>>, context: SparkToolContext): Promise<unknown>;
  },
): SparkTool {
  const schema = z.object(definition.input);
  return {
    ...definition,
    run: (args, context) => definition.run(schema.parse(args ?? {}), context),
  };
}

export const limitInput = (fallback: number, max: number) =>
  z.number().int().min(1).max(max).default(fallback).describe(`How many to return (1-${max}).`);

export const offsetInput = z
  .number()
  .int()
  .min(0)
  .default(0)
  .describe('How many to skip, for paging. Use nextOffset from the previous result.');
