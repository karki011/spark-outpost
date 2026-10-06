import { modePosture, type ModePosture, type SparkActionName } from '@spark-outpost/contracts';
import type { Queryable } from '../../persistence/db.ts';

export interface ActionFacts {
  posture: ModePosture;
  requested: boolean;
  observed: boolean;
}

export type ActionPath = 'perform' | 'confirm';

const PERFORMING_POSTURES: ReadonlySet<ModePosture> = new Set(['auto', 'full_access']);

const CLAUSE = '[^.?!\\n]{0,40}';

function asked(verbs: string, nouns: string): RegExp {
  return new RegExp(`\\b(${verbs})\\b${CLAUSE}\\b(${nouns})\\b`, 'i');
}

const MCP_NOUN = 'mcp|mcp servers?';

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
  add_mcp_server: asked('add|create|set up|install|connect|configure|register', MCP_NOUN),
  update_mcp_server: asked('change|update|rename|edit|fix|reconfigure|point', MCP_NOUN),
  switch_mcp_server: asked('turn on|turn off|enable|disable|switch', MCP_NOUN),
  remove_mcp_server: asked('remove|delete|uninstall|drop', MCP_NOUN),
  read_page: asked(
    'read|look|check|see|inspect|review|screenshot|summari[sz]e',
    'page|tab|browser|site|website',
  ),
  browser_sign_in: null,
  post_slack: asked(
    'post|send|share|reply|tell|message|notify|announce|update',
    'slack|channel|thread',
  ),
};

export function explicitlyAsked(action: SparkActionName, request: string): boolean {
  return REQUESTS[action]?.test(request) ?? false;
}

export function actionPath(facts: ActionFacts): ActionPath {
  if (facts.observed) return 'confirm';
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

export async function actionFacts(
  db: Queryable,
  place: { runId: string; observed: boolean },
  action: SparkActionName,
): Promise<ActionFacts> {
  const run = await runFacts(db, place.runId);
  return {
    posture: modePosture(run.provider, run.mode),
    requested: explicitlyAsked(action, run.request ?? ''),
    observed: place.observed,
  };
}
