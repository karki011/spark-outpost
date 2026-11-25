import {
  MCP_NAME_PATTERN,
  setupTargets,
  type SetupFields,
  type SetupTarget,
} from '@spark-outpost/contracts';
import { redactText } from '../../audit/redact.ts';

const CHOICES: Record<string, readonly string[]> = {
  method: ['cli', 'api_key'],
  keyHeader: ['bearer', 'x-api-key'],
  authKind: ['basic', 'api_key'],
};
const ADDRESSES = new Set(['baseUrl', 'siteUrl', 'instanceUrl']);
const SECRET_NAME = /key|token|secret|password|credential/i;

function addressProblem(field: string, value: string): string | null {
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return `${field} is not a web address.`;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    return `${field} must be a web address.`;
  if (url.username || url.password) return `${field} must not hold a login.`;
  if (url.search || url.hash) return `${field} must not hold a query or fragment.`;
  return null;
}

function valueProblem(field: string, value: string): string | null {
  const choices = CHOICES[field];
  if (choices) return choices.includes(value) ? null : `${field} is one of: ${choices.join(', ')}.`;
  const address = ADDRESSES.has(field) ? addressProblem(field, value) : null;
  if (address) return address;
  if (redactText(value) !== value) {
    return `${field} looks like a secret. Secrets are typed by the user.`;
  }
  if (field === 'server' && !MCP_NAME_PATTERN.test(value)) return 'server is an MCP server name.';
  return null;
}

export function setupFieldProblem(target: SetupTarget, fields: SetupFields): string | null {
  const allowed = setupTargets[target].fields;
  for (const [field, value] of Object.entries(fields)) {
    if (!allowed.includes(field)) {
      if (SECRET_NAME.test(field)) {
        return `Never pass ${field}: the user types keys, tokens and passwords themselves.`;
      }
      const list = allowed.length > 0 ? allowed.join(', ') : 'none';
      return `${setupTargets[target].name} takes these fields: ${list}.`;
    }
    const problem = valueProblem(field, value);
    if (problem) return problem;
  }
  return null;
}
