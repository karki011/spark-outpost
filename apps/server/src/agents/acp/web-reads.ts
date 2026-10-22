import { browserOrigin } from '@spark-outpost/contracts';
import { objectFields } from './object-fields.ts';

export const WEB_SEARCH_LABEL = 'web search';
const PAGE_ACTIONS = new Set(['openPage', 'findInPage']);
const SETTLED = new Set(['completed', 'failed']);
const CALL_FIELDS = ['name', 'kind', 'rawInput', '_meta'] as const;

export interface WebReadWatch {
  see(update: unknown): string[];
}

function pageLabel(url: unknown): string {
  const origin = typeof url === 'string' ? browserOrigin(url) : null;
  return origin && origin !== 'file://' ? `web page ${origin}` : 'web page';
}

function toolName(call: Record<string, unknown>): unknown {
  return call.name ?? objectFields(objectFields(call._meta).claudeCode).toolName;
}

export function webReadLabel(call: Record<string, unknown>): string | null {
  const rawInput = objectFields(call.rawInput);
  const name = toolName(call);
  if (name === 'WebFetch') return pageLabel(rawInput.url);
  if (name === 'WebSearch') return WEB_SEARCH_LABEL;
  if (rawInput.type !== 'webSearch') return null;
  const action = objectFields(rawInput.action);
  return PAGE_ACTIONS.has(String(action.type)) ? pageLabel(action.url) : WEB_SEARCH_LABEL;
}

export function createWebReadWatch(): WebReadWatch {
  const calls = new Map<string, Record<string, unknown>>();
  return {
    see(update) {
      const fields = objectFields(update);
      const id = fields.toolCallId;
      const kind = fields.sessionUpdate;
      if (typeof id !== 'string' || (kind !== 'tool_call' && kind !== 'tool_call_update')) {
        return [];
      }
      const call = { ...calls.get(id) };
      for (const field of CALL_FIELDS) {
        if (fields[field] !== undefined && fields[field] !== null) call[field] = fields[field];
      }
      if (!SETTLED.has(String(fields.status))) {
        calls.set(id, call);
        return [];
      }
      calls.delete(id);
      const label = fields.status === 'completed' ? webReadLabel(call) : null;
      return label ? [label] : [];
    },
  };
}
