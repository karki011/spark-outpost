import {
  REMOTE_SWITCH_LABELS,
  approvalPayloadSchema,
  atlassianDeletes,
  isCalendarAction,
  isMacAction,
  isSecretFileName,
  type RemoteSwitch,
  type RemoteSwitches,
} from '@spark-outpost/contracts';
import { AGENT_MODE_FIELDS, CARD_ROUTE, ROUTE_RULES, type RemoteRule } from './route-rules.ts';

const WEB_APP_ROUTE = 'GET /{*path}';
const API_PREFIX = '/api';

interface Pattern {
  route: string;
  method: string;
  segments: string[];
  rule: RemoteRule;
}

export type RemoteDecision =
  | { kind: 'refuse'; reason: string }
  | { kind: 'pairing' }
  | { kind: 'allow'; blockedFields: readonly string[]; card: boolean };

function segmentsOf(path: string): string[] {
  return path
    .replace(/\/+$/, '')
    .split('/')
    .slice(1)
    .map((segment) => segment.toLowerCase());
}

const PATTERNS: Pattern[] = [...ROUTE_RULES]
  .filter(([route]) => route !== WEB_APP_ROUTE)
  .map(([route, rule]) => {
    const [method, path] = route.split(' ') as [string, string];
    return { route, method, segments: segmentsOf(path), rule };
  });

function isParam(segment: string): boolean {
  return segment.startsWith(':');
}

function matches(pattern: Pattern, method: string, segments: string[]): boolean {
  if (pattern.method !== method || pattern.segments.length !== segments.length) return false;
  return pattern.segments.every(
    (expected, index) =>
      (isParam(expected) && segments[index]!.length > 0) || expected === segments[index],
  );
}

function underApi(segments: string[]): boolean {
  return `/${segments[0] ?? ''}` === API_PREFIX;
}

function matchedRoutes(method: string, path: string): { route: string; rule: RemoteRule }[] {
  const verb = method === 'HEAD' ? 'GET' : method;
  const segments = segmentsOf(path);
  if (!underApi(segments)) {
    const rule = ROUTE_RULES.get(WEB_APP_ROUTE);
    return verb === 'GET' && rule ? [{ route: WEB_APP_ROUTE, rule }] : [];
  }
  return PATTERNS.filter((pattern) => matches(pattern, verb, segments));
}

function refusal(rule: RemoteRule, switches: RemoteSwitches): string | null {
  if (rule === 'always' || rule === 'pairing') return null;
  if (rule === 'never') return 'This is only available on your Mac.';
  if (rule === 'passkey') return switches.passkeys ? null : switchRefusal('passkeys');
  return switches[rule] ? null : switchRefusal(rule);
}

export function remoteDecision(
  method: string,
  path: string,
  switches: RemoteSwitches,
): RemoteDecision {
  const matched = matchedRoutes(method, path);
  if (matched.length === 0)
    return { kind: 'refuse', reason: 'This is only available on your Mac.' };
  for (const { rule } of matched) {
    const reason = refusal(rule, switches);
    if (reason) return { kind: 'refuse', reason };
  }
  const pairing = matched.filter(({ rule }) => rule === 'pairing' || rule === 'passkey').length;
  if (pairing === matched.length) return { kind: 'pairing' };
  if (pairing > 0) return { kind: 'refuse', reason: 'This is only available on your Mac.' };
  const blockedFields = switches.agentMode
    ? []
    : matched.flatMap(({ route }) => AGENT_MODE_FIELDS[route] ?? []);
  return {
    kind: 'allow',
    blockedFields,
    card: matched.some(({ route }) => route === CARD_ROUTE),
  };
}

export function blockedFieldIn(body: unknown, fields: readonly string[]): string | null {
  if (typeof body !== 'object' || body === null) return null;
  return fields.find((field) => field in body) ?? null;
}

function baseName(path: string): string {
  return path.split('/').at(-1) ?? path;
}

export const MAC_CARD_REFUSAL =
  'Mac control, calendar and browser sign-in cards are answered on your Mac.';

export function macOnlyCard(payload: unknown): boolean {
  const parsed = approvalPayloadSchema.safeParse(payload);
  const action = parsed.success ? parsed.data.sparkAction?.action : undefined;
  if (action === 'browser_handoff') return true;
  return action !== undefined && (isMacAction(action) || isCalendarAction(action));
}

export function cardSwitch(payload: unknown): RemoteSwitch | null {
  const parsed = approvalPayloadSchema.safeParse(payload);
  if (!parsed.success) return 'highRiskCards';
  const card = parsed.data;
  const action = card.sparkAction;
  if (action?.action === 'browser_sign_in') return 'signIns';
  if (action?.action === 'ask_spark' && action.op === 'answer_card') return 'highRiskCards';
  const editsAtlassian = action?.action === 'jira_edit' || action?.action === 'confluence_edit';
  if (editsAtlassian && atlassianDeletes(action)) {
    return 'highRiskCards';
  }
  const paths = [...card.paths, ...(card.fullPaths ?? [])];
  const highRisk =
    card.gitControl !== undefined ||
    card.forcePush !== undefined ||
    card.instructionFiles !== undefined ||
    paths.some((path) => isSecretFileName(baseName(path)));
  return highRisk ? 'highRiskCards' : null;
}

export function switchRefusal(name: RemoteSwitch): string {
  return `Turned off for remote control on your Mac: ${REMOTE_SWITCH_LABELS[name]}.`;
}
