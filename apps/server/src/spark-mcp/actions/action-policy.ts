import { modePosture, type ModePosture, type SparkActionName } from '@spark-outpost/contracts';
import { userText, type UserTextInput } from '../../outposts/user-asked.ts';
import type { Queryable } from '../../persistence/db.ts';

export interface ActionFacts {
  posture: ModePosture;
  requested: boolean;
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
  open_page: asked(
    'open|browse|visit|go to|search|research|look up|find|check|read',
    'page|site|website|web|online|internet|url|link|docs|documentation',
  ),
  act_page: asked(
    'click|type|fill|submit|press|search|browse|use|navigate|try',
    'page|site|website|web|form|button|browser|online',
  ),
  browser_sign_in: null,
  browser_handoff: null,
  mac_use_app: null,
  mac_act: asked(
    'press|click|use|operate|control|calculate|choose|select|scroll|open',
    'apps?|calculator|notes|textedit|mail|buttons?|menus?|mac|windows?',
  ),
  mac_press: null,
  post_slack: asked(
    'post|send|share|reply|tell|message|notify|announce|update',
    'slack|channel|thread',
  ),
  calendar_read: asked(
    "what|what's|whats|when|show|list|check|read|look|see|find|am i|do i|tell me",
    'calendar|schedule|agenda|events?|meetings?|free|busy|appointments?',
  ),
  calendar_edit: asked(
    'add|create|schedule|book|put|move|reschedule|shift|change|update|rename|edit|delete|remove|cancel|set',
    'calendar|events?|meetings?|appointments?|blocks?|reminders?|alarms?|alerts?|today|tomorrow|tonight|\\d{1,2}:\\d{2}|\\d{1,2} ?(?:am|pm)',
  ),
  atlassian_read: asked(
    'read|look|check|see|find|search|show|list|summari[sz]e|open|query',
    'jira|jql|confluence|cql|wiki|pages?|docs?|spaces?|tickets?|issues?|[A-Z][A-Z0-9]+-\\d+',
  ),
  jira_edit: asked(
    'change|update|edit|rename|retitle|rewrite|set|fix|delete|remove|label|reprioriti[sz]e',
    'tickets?|issues?|comments?|[A-Z][A-Z0-9]+-\\d+|summary|description|labels?|priority',
  ),
  start_outpost: asked(
    'start|split|spin up|kick off|launch|create',
    'sub-?chats?|outposts?|sub-?tasks?|parallel chats?|separate chats?',
  ),
  confluence_edit: asked(
    'create|write|add|draft|publish|change|update|edit|rename|rewrite|delete|remove|trash|comment|post',
    'confluence|wiki|pages?|docs?|comments?',
  ),
};

export function explicitlyAsked(action: SparkActionName, request: string): boolean {
  return REQUESTS[action]?.test(request) ?? false;
}

export function actionPath(facts: ActionFacts): ActionPath {
  if (PERFORMING_POSTURES.has(facts.posture)) return 'perform';
  if (facts.posture === 'edits' && facts.requested) return 'perform';
  return 'confirm';
}

interface RunFacts {
  provider: string | null;
  mode: string | null;
  request: string | null;
  outpost_run: boolean | null;
  from_user: boolean | null;
  spark_rule_retry?: boolean | null;
}

async function runFacts(db: Queryable, runId: string): Promise<RunFacts> {
  const { rows } = await db.query<RunFacts>(
    `SELECT r.provider, m.content AS request,
            CASE WHEN r.mode = 'chat' AND c.session_type IS DISTINCT FROM 'terminal'
                   AND r.agent_mode IS NOT NULL THEN r.agent_mode
              ELSE COALESCE(r.used_mode, CASE WHEN c.session_type = 'terminal' THEN NULL
                ELSE r.agent_mode END) END AS mode,
            COALESCE((SELECT p.source FROM runs p WHERE p.id = r.parent_run_id), r.source)
              = 'outpost' AS outpost_run,
            COALESCE((SELECT p.source FROM runs p WHERE p.id = r.parent_run_id), r.source)
              = 'spark_rule' AS spark_rule_retry,
            (SELECT post.from_user FROM outpost_posts post
             WHERE post.id = r.user_message_id) AS from_user
     FROM runs r JOIN conversations c ON c.id = r.conversation_id
       LEFT JOIN messages m ON m.id = r.user_message_id
     WHERE r.id = $1`,
    [runId],
  );
  return (
    rows[0] ?? { provider: null, mode: null, request: null, outpost_run: null, from_user: null }
  );
}

function runText(run: RunFacts): UserTextInput {
  return {
    userRequest: run.request ?? '',
    outpostRequest: run.outpost_run === true ? { fromUser: run.from_user === true } : null,
    sparkRuleRetry: run.spark_rule_retry === true,
  };
}

export async function actionFacts(
  db: Queryable,
  runId: string,
  action: SparkActionName,
): Promise<ActionFacts> {
  const run = await runFacts(db, runId);
  return {
    posture: modePosture(run.provider, run.mode),
    requested: explicitlyAsked(action, userText(runText(run))),
  };
}
