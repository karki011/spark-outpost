import { z } from 'zod';
import type { ApprovalKind, ApprovalOption } from './approvals.ts';
import { isSecretFileName } from './secret-files.ts';

export const quickAnswerSchema = z.object({
  allow: z.string().min(1),
  deny: z.string().min(1),
  payloadHash: z.string().min(1),
});
export type QuickAnswer = z.infer<typeof quickAnswerSchema>;

export interface QuickAnswerInput {
  kind: ApprovalKind;
  payloadKeys: readonly string[];
  command: unknown;
  paths: unknown;
  fullPaths: unknown;
  truncated: unknown;
  diffCount: number;
  options: unknown;
  payloadHash: string | null;
}

const ORDINARY_KINDS: readonly ApprovalKind[] = ['execute', 'edit', 'other'];
const PLAIN_KEYS = new Set([
  'command',
  'cwd',
  'paths',
  'fullPaths',
  'diffs',
  'truncated',
  'agentReason',
]);

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function plainOptions(value: unknown): { allow: string; deny: string } | null {
  if (!Array.isArray(value)) return null;
  const offered = value.filter(
    (option): option is ApprovalOption =>
      typeof option === 'object' &&
      option !== null &&
      typeof (option as ApprovalOption).optionId === 'string' &&
      (option as ApprovalOption).optionId.length > 0 &&
      !(option as ApprovalOption).unavailableReason,
  );
  const allow = offered.find((option) => option.kind === 'allow_once');
  const deny = offered.find((option) => option.kind === 'reject_once');
  return allow && deny ? { allow: allow.optionId, deny: deny.optionId } : null;
}

export function quickAnswerOf(input: QuickAnswerInput): QuickAnswer | null {
  if (!ORDINARY_KINDS.includes(input.kind)) return null;
  if (input.payloadKeys.some((key) => !PLAIN_KEYS.has(key))) return null;
  if (input.diffCount > 0 || input.truncated === true || !input.payloadHash) return null;
  const command = typeof input.command === 'string' ? input.command.trim() : '';
  const paths = [...strings(input.paths), ...strings(input.fullPaths)];
  if (!command && paths.length === 0) return null;
  if (paths.some((path) => isSecretFileName(baseName(path)))) return null;
  const options = plainOptions(input.options);
  if (!options) return null;
  return { ...options, payloadHash: input.payloadHash };
}
