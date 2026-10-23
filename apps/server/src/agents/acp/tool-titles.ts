import type * as acp from '@agentclientprotocol/sdk';
import { friendlyStep } from '@spark-outpost/contracts';
import { objectFields } from './object-fields.ts';

export function toolNameOf(toolCall: Pick<acp.ToolCallUpdate, '_meta'>): string | null {
  const named = objectFields(toolCall).name;
  if (typeof named === 'string' && named.trim()) return named.trim();
  const meta = objectFields(objectFields(toolCall._meta).claudeCode).toolName;
  return typeof meta === 'string' && meta.trim() ? meta.trim() : null;
}

const ABSOLUTE_PATH = /(^|[\s(])(\/[^\s`'")]+)/g;

function asCommand(title: string, kind: string | null | undefined): string {
  const runs = kind === 'execute' && title !== 'Terminal' && !title.includes('`');
  return runs ? `\`${title}\`` : title;
}

export function describeTool(title: string, kind?: string | null): string {
  const trimmed = title.trim();
  if (!trimmed) return 'Using a tool';
  const friendly = friendlyStep(trimmed);
  if (friendly !== trimmed) return friendly;
  return asCommand(trimmed, kind)
    .split('`')
    .map((part, index) =>
      index % 2 === 1
        ? part
        : part.replace(ABSOLUTE_PATH, (_match, lead: string, path: string) => {
            const name = path.split('/').filter(Boolean).at(-1) ?? path;
            return `${lead}\`${name}\``;
          }),
    )
    .join('`');
}

const UNADDRESSED_FETCH = 'Fetch';

export function awaitsAddress(title: string, kind: string | null | undefined): boolean {
  return kind === 'fetch' && title.trim() === UNADDRESSED_FETCH;
}

const TARGET_CHARS = 400;

const OPENS_PULL_REQUEST =
  /\bgh\s+pr\s+create\b|\bhub\s+pull-request\b|\bglab\s+mr\s+create\b|create_pull_request/i;

export function opensPullRequest(title: string | null | undefined, rawInput: unknown): boolean {
  if (title && OPENS_PULL_REQUEST.test(title)) return true;
  if (rawInput === undefined || rawInput === null) return false;
  try {
    return OPENS_PULL_REQUEST.test(JSON.stringify(rawInput) ?? '');
  } catch {
    return false;
  }
}

function isEmptyInput(value: unknown): boolean {
  if (Array.isArray(value)) return value.length === 0;
  return typeof value === 'object' && value !== null && Object.keys(value).length === 0;
}

export function toolTarget(
  locations: readonly { path: string; line?: number | null }[] | null | undefined,
  rawInput: unknown,
): string | null {
  const paths = (locations ?? []).map((location) => `${location.path}:${location.line ?? ''}`);
  let input = '';
  if (rawInput !== undefined && rawInput !== null && !isEmptyInput(rawInput)) {
    try {
      input = JSON.stringify(rawInput) ?? '';
    } catch {
      input = '';
    }
  }
  const target = [paths.join(','), input].filter(Boolean).join(' ');
  return target ? target.slice(0, TARGET_CHARS) : null;
}
