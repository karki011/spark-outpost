import { isSecretFileName, type FileFocus } from '@spark-outpost/contracts';
import type { ProviderOutput } from '../../providers/provider.ts';
import { objectFields } from './object-fields.ts';

const PATH_CHARS = 4096;
const PATH_FIELDS = ['file_path', 'path', 'notebook_path'] as const;
const ACTIONS: Readonly<Record<string, FileFocus['action']>> = { read: 'read', edit: 'edit' };

type Location = { path: string; line?: number | null };
type Content = { type: string; path?: string };

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

function shown(path: string): boolean {
  return path !== '' && path.length <= PATH_CHARS && !isSecretFileName(fileName(path));
}

export function editedFiles(
  kind: string | null | undefined,
  locations: readonly Location[] | null | undefined,
  rawInput: unknown,
  content: readonly Content[] | null | undefined,
): FileFocus[] {
  const first = fileFocus(kind, locations, rawInput);
  if (kind !== 'edit') return first ? [first] : [];
  const paths = (content ?? []).flatMap((item) =>
    item.type === 'diff' && typeof item.path === 'string' ? [item.path] : [],
  );
  const rest = [...new Set(paths)]
    .filter((path) => path !== first?.path && shown(path))
    .map((path): FileFocus => ({ path, line: null, limit: null, action: 'edit' }));
  return first ? [first, ...rest] : rest;
}

export interface FocusTracker {
  see(
    toolCallId: string,
    kind: string | null | undefined,
    locations: readonly Location[] | null | undefined,
    rawInput: unknown,
    content?: readonly Content[] | null,
  ): ProviderOutput[];
  done(toolCallId: string): void;
}

export function createFocusTracker(): FocusTracker {
  const seen = new Map<string, string>();
  return {
    see(toolCallId, kind, locations, rawInput, content) {
      const focuses = editedFiles(kind, locations, rawInput, content);
      if (focuses.length === 0) return [];
      const key = JSON.stringify(focuses);
      if (seen.get(toolCallId) === key) return [];
      seen.set(toolCallId, key);
      return focuses.map((focus) => ({ kind: 'file_focus', ...focus }));
    },
    done(toolCallId) {
      seen.delete(toolCallId);
    },
  };
}
