import {
  modePosture,
  type AssistantActs,
  type ModePosture,
  type SparkActionName,
} from '@spark-outpost/contracts';
import { userText, type UserTextInput } from '../../sub-chats/user-asked.ts';
import type { Queryable } from '../../persistence/db.ts';
import { commandNames, namesChat, replaceMentions } from './ask-spark-limits.ts';

export interface ActionFacts {
  posture: ModePosture;
  requested: boolean;
}

export type ActionPath = 'perform' | 'confirm';

const PERFORMING_POSTURES: ReadonlySet<ModePosture> = new Set(['auto', 'full_access']);

const CHILD_READS: ReadonlySet<SparkActionName> = new Set([
  'atlassian_read',
  'servicenow_read',
  'calendar_read',
  'read_page',
]);

const CLAUSE = '[^.?!\\n]{0,40}';

function asked(verbs: string, nouns: string): RegExp {
  return new RegExp(`\\b(${verbs})\\b${CLAUSE}\\b(${nouns})\\b`, 'i');
}

const MCP_NOUN = 'mcp|mcp servers?';
const SETUP_NOUN =
  'providers?|connectors?|connections?|claude|codex|z\\.?ai|endpoints?|atlassian|jira|confluence|servicenow|linear|github|slack|calendars?|google|microsoft|outlook|zoom|mcp';
const TICKET_NOUN = 'tickets?|issues?|[A-Z][A-Z0-9]+-\\d+|[A-Z]{2,8}\\d{4,12}';
const RECORD_NOUN =
  'servicenow|records?|incidents?|requests?|tasks?|problems?|changes?|tickets?|[A-Z]{2,8}\\d{4,12}';
const CREW_NOUN = 'sparks?|teammates?|skills?|workflows?|crew|spark\\.md';
const CREW_CREATE_VERB = 'create|add|make|build|set up|draft|write';
const CREW_CHANGE_VERB =
  'change|update|edit|rename|fix|rewrite|improve|tweak|adjust|delete|remove|revise';

const SPLIT_REQUEST = asked(
  'start|split|spin up|kick off|launch|create',
  'sub-?chats?|sub-?tasks?|parallel chats?|separate chats?',
);
const SEND_VERB = 'send|tell|ask|message|forward|pass|relay|share|notify|ping|reply';

const REQUESTS: Readonly<Record<SparkActionName, RegExp | null>> = {
  open_pr: asked('open|create|make|raise|submit|send|ship|put up', 'pr|prs|pull requests?'),
  create_ticket: asked(
    'create|file|open|make|raise|add|log',
    'tickets?|issues?|bugs?|stor(?:y|ies)',
  ),
  comment_ticket: asked('comment|reply|post|note|write', TICKET_NOUN),
  transition_ticket: asked(
    'move|transition|mark|set|close|resolve',
    `${TICKET_NOUN}|done|in progress|in review`,
  ),
  assign_ticket: asked('assign|unassign|take', `${TICKET_NOUN}|me`),
  pr_follow_up: null,
  pr_follow_up_round: asked('follow[- ]?up|address|fix|handle', 'feedback|comments?|reviews?'),
  create_teammate: asked(CREW_CREATE_VERB, CREW_NOUN),
  update_teammate: asked(CREW_CHANGE_VERB, CREW_NOUN),
  delete_teammate: asked('delete|remove|drop|get rid of', 'sparks?|teammates?'),
  prepare_setup: asked('connect|set up|configure|add|link|sign in|prepare', SETUP_NOUN),
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
  ask_spark: null,
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
  publish_artifact: asked(
    'make|build|create|draw|show|publish|update|change|render|chart|plot|design',
    'artifacts?|pages?|dashboards?|charts?|diagrams?|reports?|graphs?|visuali[sz]ations?|apps?|slides?|mockups?',
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
  servicenow_read: asked(
    'read|look|check|see|find|search|show|list|summari[sz]e|open|query',
    RECORD_NOUN,
  ),
  servicenow_edit: asked(
    'change|update|edit|set|note|comment|reply|tell|move|resolve|close|cancel|reprioriti[sz]e',
    `${RECORD_NOUN}|callers?|work notes?`,
  ),
  send_to_chat: asked(SEND_VERB, 'chats?|sub-?chats?'),
  start_sub_chats: SPLIT_REQUEST,
  stop_sub_chat: asked('stop|cancel|halt|kill|end', 'sub-?chats?|chats?'),
  rules_edit: null,
  plugins_edit: null,
  workflow_control: asked(
    'run|start|launch|kick off|stop|cancel|schedule|unschedule|trigger|turn on|turn off|set up',
    'workflows?|schedules?|triggers?',
  ),
  crew_edit: asked(`${CREW_CREATE_VERB}|${CREW_CHANGE_VERB}`, CREW_NOUN),
  link_repo: null,
  github_read: asked(
    'read|look|check|see|find|search|show|list|explain|study|research|explore|clone|copy|download',
    'github|repos?|repositor(?:y|ies)|code|codebase|source',
  ),
  clone_repo: null,
  confluence_edit: asked(
    'create|write|add|draft|publish|change|update|edit|rename|rewrite|delete|remove|trash|comment|post',
    'confluence|wiki|pages?|docs?|comments?',
  ),
};

export function explicitlyAsked(action: SparkActionName, request: string): boolean {
  return REQUESTS[action]?.test(request) ?? false;
}

export function assistantPosture(acts: AssistantActs): ModePosture {
  return acts === 'act' ? 'auto' : 'asks';
}

export function actionPath(facts: ActionFacts): ActionPath {
  if (PERFORMING_POSTURES.has(facts.posture)) return 'perform';
  if (facts.posture === 'edits' && facts.requested) return 'perform';
  return 'confirm';
}

export function modeAsks(facts: ActionFacts): boolean {
  return actionPath({ ...facts, requested: false }) === 'confirm';
}

interface RunFacts {
  provider: string | null;
  mode: string | null;
  request: string | null;
  child?: boolean | null;
  chosen_mode?: string | null;
  spark_rule_retry?: boolean | null;
  assistant_sent?: boolean | null;
  assistant_acts?: AssistantActs | null;
}

async function runFacts(db: Queryable, runId: string): Promise<RunFacts> {
  const { rows } = await db.query<RunFacts>(
    `SELECT r.provider, m.content AS request,
            r.role = 'spark' AS child, r.agent_mode AS chosen_mode,
            CASE WHEN r.mode = 'chat' AND c.session_type IS DISTINCT FROM 'terminal'
                   AND r.agent_mode IS NOT NULL THEN r.agent_mode
              ELSE COALESCE(r.used_mode, CASE WHEN c.session_type = 'terminal' THEN NULL
                ELSE r.agent_mode END) END AS mode,
            COALESCE((SELECT p.source FROM runs p WHERE p.id = r.parent_run_id), r.source)
              = 'spark_rule' AS spark_rule_retry,
            (COALESCE((SELECT p.source FROM runs p WHERE p.id = r.parent_run_id), r.source)
              IN ('assistant', 'workflow', 'chat') OR COALESCE(r.role = 'spark', false)
              OR COALESCE((r.route->'spark') ? 'step', false)) AS assistant_sent,
            (SELECT pf.assistant_acts FROM profiles pf
             WHERE pf.workspace_id = c.workspace_id
               AND pf.assistant_conversation_id = c.id) AS assistant_acts
     FROM runs r JOIN conversations c ON c.id = r.conversation_id
       LEFT JOIN messages m ON m.id = r.user_message_id
     WHERE r.id = $1`,
    [runId],
  );
  return rows[0] ?? { provider: null, mode: null, request: null };
}

export async function userWroteTurn(db: Queryable, runId: string): Promise<boolean> {
  const run = await runFacts(db, runId);
  if (run.provider === null && run.mode === null) return false;
  if (run.assistant_sent === true || run.spark_rule_retry === true) return false;
  return !(await followUpRun(db, runId));
}

const NAMED_CHAT = 'zqnamedmentionqz';
const OTHER_CHAT = 'zqothermentionqz';
const AWAITS_REPLY =
  /(?:,?\s*\b(?:and|then)\s+)?\bwait(?:ing)?\s+(?:for|until|till)\s+(?:(?:its|their|the|a|an)\s+|it\s+(?:to\s+)?)?(?:repl(?:y|ies)|answers?|responses?|responds?)\b/gi;

function withoutWaitForReply(text: string): string {
  const named = text.indexOf(NAMED_CHAT);
  return text.replace(AWAITS_REPLY, (wait: string, at: number) =>
    named >= 0 && at > named ? '' : wait,
  );
}

function isPlaceholder(title: string): boolean {
  const name = title.trim().toLowerCase();
  return name === NAMED_CHAT || name === OTHER_CHAT;
}

export function askedToSend(
  request: string,
  chatTitle: string,
  longerTitles: readonly string[] = [],
): boolean {
  if ([chatTitle, ...longerTitles].some(isPlaceholder)) return false;
  if (request.toLowerCase().includes(NAMED_CHAT) || request.toLowerCase().includes(OTHER_CHAT)) {
    return false;
  }
  const withoutOthers = longerTitles.reduce(
    (text, other) => replaceMentions(text, other, OTHER_CHAT),
    request,
  );
  if (!namesChat(withoutOthers, chatTitle)) return false;
  const plain = withoutWaitForReply(replaceMentions(withoutOthers, chatTitle, NAMED_CHAT));
  return commandNames(plain, SEND_VERB, NAMED_CHAT);
}

async function titlesContaining(db: Queryable, runId: string, title: string): Promise<string[]> {
  const { rows } = await db.query<{ title: string }>(
    `SELECT c.title FROM conversations c
     WHERE c.workspace_id = (SELECT o.workspace_id FROM runs r
         JOIN conversations o ON o.id = r.conversation_id WHERE r.id = $1)
       AND lower(c.title) <> lower($2) AND position(lower($2) in lower(c.title)) > 0`,
    [runId, title.trim()],
  );
  return rows.map((row) => row.title);
}

export async function userAskedToSend(
  db: Queryable,
  runId: string,
  chatTitle: string,
): Promise<boolean> {
  if (!(await userWroteTurn(db, runId))) return false;
  const request = userText(runText(await runFacts(db, runId)));
  if (!namesChat(request, chatTitle)) return false;
  return askedToSend(request, chatTitle, await titlesContaining(db, runId, chatTitle));
}

async function followUpRun(db: Queryable, runId: string): Promise<boolean> {
  const { rows } = await db.query<{ follow_up: boolean }>(
    `SELECT COALESCE((SELECT p.source FROM runs p WHERE p.id = r.parent_run_id), r.source)
              = 'pr_follow_up' AS follow_up
     FROM runs r WHERE r.id = $1`,
    [runId],
  );
  return rows[0]?.follow_up === true;
}

function runText(run: RunFacts): UserTextInput {
  return {
    userRequest: run.request ?? '',
    sparkRuleRetry: run.spark_rule_retry === true,
    assistantSent: run.assistant_sent === true,
  };
}

export async function actionFacts(
  db: Queryable,
  runId: string,
  action: SparkActionName,
): Promise<ActionFacts> {
  const run = await runFacts(db, runId);
  const mode = run.child === true && CHILD_READS.has(action) ? (run.chosen_mode ?? null) : run.mode;
  return {
    posture: run.assistant_acts
      ? assistantPosture(run.assistant_acts)
      : modePosture(run.provider, mode),
    requested: explicitlyAsked(action, userText(runText(run))),
  };
}
