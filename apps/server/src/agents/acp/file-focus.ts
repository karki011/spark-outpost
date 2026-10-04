import { isSecretFileName, type FileFocus } from '@spark-outpost/contracts';
import type { ProviderOutput } from '../../providers/provider.ts';
import { objectFields } from './object-fields.ts';

const PATH_CHARS = 4096;
const PATH_FIELDS = ['file_path', 'path', 'notebook_path'] as const;
const ACTIONS: Readonly<Record<string, FileFocus['action']>> = { read: 'read', edit: 'edit' };

type Location = { path: string; line?: number | null };

function fileName(path: string): string {
  return path.split(/[\\/]/).at(-1) ?? path;
}

function wholeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

function inputPath(input: Record<string, unknown>): string | null {
  const found = PATH_FIELDS.map((field) => input[field]).find(
    (value): value is string => typeof value === 'string' && value !== '',
  );
  return found ?? null;
}

export function fileFocus(
  kind: string | null | undefined,
  locations: readonly Location[] | null | undefined,
  rawInput: unknown,
): FileFocus | null {
  const action = kind ? ACTIONS[kind] : undefined;
  if (!action) return null;
  const input = objectFields(rawInput);
  const location = locations?.[0];
  const path = location?.path || inputPath(input);
  if (!path || path.length > PATH_CHARS || isSecretFileName(fileName(path))) return null;
  return {
    path,
    line: wholeNumber(location?.line),
    limit: action === 'read' ? wholeNumber(input.limit) : null,
    action,
  };
}

export interface FocusTracker {
  see(
    toolCallId: string,
    kind: string | null | undefined,
    locations: readonly Location[] | null | undefined,
    rawInput: unknown,
  ): ProviderOutput[];
  done(toolCallId: string): void;
}

export function createFocusTracker(): FocusTracker {
  const seen = new Map<string, string>();
  return {
    see(toolCallId, kind, locations, rawInput) {
      const focus = fileFocus(kind, locations, rawInput);
      if (!focus) return [];
      const key = JSON.stringify(focus);
      if (seen.get(toolCallId) === key) return [];
      seen.set(toolCallId, key);
      return [{ kind: 'file_focus', ...focus }];
    },
    done(toolCallId) {
      seen.delete(toolCallId);
    },
  };
}
