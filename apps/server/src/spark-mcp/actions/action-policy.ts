import {
  modePosture,
  type InvolvementLevel,
  type ModePosture,
  type SparkActionName,
} from '@spark-outpost/contracts';
import { resolveChatSettings } from '../../persistence/chat-settings.ts';
import type { Queryable } from '../../persistence/db.ts';

export interface ActionFacts {
  posture: ModePosture;
  level: InvolvementLevel | null;
  requested: boolean;
  observed: boolean;
}

export type ActionPath = 'perform' | 'confirm';

const PERFORMING_POSTURES: ReadonlySet<ModePosture> = new Set(['auto', 'full_access']);

const CLAUSE = '[^.?!\\n]{0,40}';

function asked(verbs: string, nouns: string): RegExp {
  return new RegExp(`\\b(${verbs})\\b${CLAUSE}\\b(${nouns})\\b`, 'i');
}

const REQUESTS: Readonly<Record<SparkActionName, RegExp | null>> = {
  open_pr: asked('open|create|make|raise|submit|send|ship|put up', 'pr|prs|pull requests?'),
  create_ticket: asked(
    'create|file|open|make|raise|add|log',
    'tickets?|issues?|bugs?|stor(?:y|ies)',
  ),
  comment_ticket: asked('comment|reply|post|note|write', 'tickets?|issues?|[A-Z][A-Z0-9]+-\\d+'),
  transition_ticket: asked(
    'move|transition|mark|set|close|resolve',
    'tickets?|issues?|[A-Z][A-Z0-9]+-\\d+|done|in progress|in review',
  ),
  assign_ticket: asked('assign|unassign|take', 'tickets?|issues?|[A-Z][A-Z0-9]+-\\d+|me'),
  pr_follow_up: null,
  pr_follow_up_round: asked('follow[- ]?up|address|fix|handle', 'feedback|comments?|reviews?'),
  create_teammate: asked('add|create|make|set up', 'sparks?|teammates?'),
  update_teammate: asked('change|update|rename|edit', 'sparks?|teammates?'),
};

export function explicitlyAsked(action: SparkActionName, request: string): boolean {
  return REQUESTS[action]?.test(request) ?? false;
}

export function actionPath(facts: ActionFacts): ActionPath {
  if (facts.observed) return 'confirm';
  if (facts.level === 'full-auto') return 'perform';
  if (PERFORMING_POSTURES.has(facts.posture)) return 'perform';
  if (facts.posture === 'edits' && facts.requested) return 'perform';
  return 'confirm';
}

interface RunFacts {
  provider: string | null;
  mode: string | null;
  request: string | null;
}

async function runFacts(db: Queryable, runId: string): Promise<RunFacts> {
  const { rows } = await db.query<RunFacts>(
    `SELECT r.provider, COALESCE(r.used_mode, r.agent_mode) AS mode, m.content AS request
     FROM runs r LEFT JOIN messages m ON m.id = r.user_message_id
     WHERE r.id = $1`,
    [runId],
  );
  return rows[0] ?? { provider: null, mode: null, request: null };
}

async function chatLevel(
  db: Queryable,
  conversationId: string | null,
): Promise<InvolvementLevel | null> {
  if (!conversationId) return null;
  const settings = await resolveChatSettings(db, conversationId).catch(() => null);
  return settings?.level ?? null;
}

export async function actionFacts(
  db: Queryable,
  place: { runId: string; conversationId: string | null; observed: boolean },
  action: SparkActionName,
): Promise<ActionFacts> {
  const run = await runFacts(db, place.runId);
  return {
    posture: modePosture(run.provider, run.mode),
    level: await chatLevel(db, place.conversationId),
    requested: explicitlyAsked(action, run.request ?? ''),
    observed: place.observed,
  };
}
