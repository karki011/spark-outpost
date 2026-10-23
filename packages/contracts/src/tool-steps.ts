export const SPARK_TOOL_STEPS: Readonly<Record<string, string>> = {
  spark_providers: 'Checking AI providers',
  spark_connectors: 'Checking connectors',
  spark_settings: 'Reading Spark settings',
  spark_projects: 'Looking at projects',
  spark_map: 'Reading the project map',
  spark_find: 'Finding code',
  spark_chats: 'Looking at chats',
  spark_chat: 'Reading a chat',
  spark_chat_history: 'Reading chat history',
  spark_attention: 'Checking what needs you',
  spark_run: 'Checking run status',
  spark_task: 'Reading the task and plan',
  spark_audit: 'Reading the audit',
  spark_tickets: 'Looking at tickets',
  spark_analytics: 'Reading analytics',
  spark_activity: 'Checking recent activity',
  spark_brief: 'Reading the morning brief',
  spark_spend: 'Checking spend',
  spark_models: 'Reading model cards',
  spark_terminals: 'Checking terminals',
  spark_terminal_run: 'Running a command in a Spark terminal',
  spark_sparks: 'Looking at Sparks',
  spark_guide: 'Reading the Spark guide',
  spark_docs: 'Reading the user guide',
  spark_pull_requests: 'Checking pull requests',
  spark_pr: 'Reading a pull request',
  spark_pr_follow_up: 'Checking PR follow-up',
  spark_create_ticket: 'Creating a ticket',
  spark_comment_ticket: 'Commenting on a ticket',
  spark_start_chat: 'Starting a chat',
  spark_send_to_chat: 'Sending a message to a chat',
  spark_stop_chat: 'Stopping a chat',
  spark_archive_chat: 'Archiving a chat',
  spark_answer_card: 'Answering a card',
  spark_pause: 'Pausing or resuming Spark',
  spark_start_ticket: 'Starting work on a ticket',
  spark_post_outpost: 'Posting in an outpost',
  spark_clear_finished: 'Clearing a finished chat',
  spark_set_aside: 'Setting a card aside',
  spark_meeting: 'Handling a meeting alert',
  spark_transition_ticket: 'Moving a ticket',
  spark_assign_ticket: 'Assigning a ticket',
  spark_open_pr: 'Opening a PR',
  spark_push: 'Pushing the branch',
  spark_pull_request: 'Opening the pull request',
  spark_pr_follow_up_round: 'Requesting a PR follow-up round',
  spark_create_spark: 'Adding a Spark',
  spark_update_spark: 'Changing a Spark',
  spark_mcp_servers: 'Looking at MCP servers',
  spark_add_mcp_server: 'Adding an MCP server',
  spark_update_mcp_server: 'Changing an MCP server',
  spark_switch_mcp_server: 'Switching an MCP server',
  spark_remove_mcp_server: 'Removing an MCP server',
  spark_browser_open: 'Opening a page in the browser',
  spark_browser_act: 'Acting on a page',
  spark_mac_apps: 'Listing Mac apps',
  spark_mac_read: 'Reading a Mac app',
  spark_mac_act: 'Acting in a Mac app',
  spark_calendar: 'Reading your calendar',
  spark_calendar_edit: 'Changing your calendar',
  spark_jira: 'Reading Jira',
  spark_jira_edit: 'Changing Jira',
  spark_confluence: 'Reading Confluence',
  spark_confluence_edit: 'Changing Confluence',
  spark_servicenow: 'Reading ServiceNow',
  spark_servicenow_edit: 'Changing ServiceNow',
  spark_browser_tabs: 'Looking at browser tabs',
  spark_browser_read: 'Reading a page',
  spark_browser_screenshot: 'Taking a screenshot of a page',
  spark_browser_logs: 'Reading page logs',
  spark_browser_devtools: 'Using developer tools on a page',
  spark_browser_preview: 'Checking the preview server',
  spark_browser_signins: 'Listing saved sign-ins',
  spark_browser_sign_in: 'Signing in with a saved sign-in',
  spark_slack: 'Reading Slack',
  spark_slack_post: 'Posting to Slack',
  spark_artifact: 'Making an artifact',
  spark_outpost: 'Reading the outpost',
  spark_outpost_ask: 'Asking another chat',
  spark_outpost_note: 'Leaving a note in the outpost',
  spark_outpost_draft: 'Proposing sub-task chats',
  spark_outpost_start: 'Starting sub-task chats',
};

const AGENT_TOOL_STEPS: Readonly<Record<string, string>> = {
  Agent: 'Starting a subagent',
  Task: 'Starting a subagent',
  SubagentHandback: 'Reporting back',
  TaskOutput: 'Checking a background task',
  wait: 'Waiting for sub-agents',
  Bash: 'Running a command',
  BashOutput: 'Checking command output',
  KillBash: 'Stopping a command',
  KillShell: 'Stopping a command',
  Read: 'Reading a file',
  Write: 'Writing a file',
  Edit: 'Editing a file',
  MultiEdit: 'Editing a file',
  NotebookEdit: 'Editing a notebook',
  Glob: 'Finding files',
  Grep: 'Searching files',
  WebFetch: 'Fetching a page',
  WebSearch: 'Searching the web',
  Monitor: 'Watching a command',
  TaskStop: 'Stopping a background task',
  ListMcpResources: 'Listing MCP resources',
  ReadMcpResource: 'Reading an MCP resource',
  TodoWrite: 'Updating the to-do list',
  ToolSearch: 'Loading tools',
  Skill: 'Loading a skill',
};

export interface McpTool {
  server: string;
  tool: string;
}

const CLAUDE_MCP = /^mcp__(.+?)__(.+)$/;
const CODEX_MCP = /^mcp\.([^.\s]+)\.(\S+)$/;

export function parseMcpTool(title: string): McpTool | null {
  const trimmed = title.trim();
  const match = CLAUDE_MCP.exec(trimmed) ?? CODEX_MCP.exec(trimmed);
  if (!match) return null;
  return { server: match[1]!, tool: match[2]! };
}

export function humanizeToolName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function mcpStep({ server, tool }: McpTool): string {
  const spark = SPARK_TOOL_STEPS[tool];
  if (spark) return spark;
  return `Using ${humanizeToolName(tool)} (${humanizeToolName(server)})`;
}

const GREP_TITLE = /^grep\b.*"([^"]+)"(?:\s+(\S+))?\s*$/;

function baseName(path: string): string {
  return (
    path
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .at(-1) || path
  );
}

function grepStep(title: string): string | null {
  const match = GREP_TITLE.exec(title);
  if (!match) return null;
  const where = match[2] ? ` in \`${baseName(match[2])}\`` : '';
  return `Search for \`${match[1]}\`${where}`;
}

const FETCH_TITLE = /^(?:Fetch|Open page:) https?:\/\/(?:[^@/?#\s]*@)?([^/?#:\s]+)\S*$/;
const WEB_SEARCH_STEP = 'Searched the web';
const WEB_SEARCH_TITLE = /^(?:Search ".*"|Web search(?:: .*)?)$/s;

function webStep(title: string): string | null {
  if (WEB_SEARCH_TITLE.test(title)) return WEB_SEARCH_STEP;
  const host = FETCH_TITLE.exec(title)?.[1];
  return host ? `Fetched ${host}` : null;
}

export function isWebToolTitle(title: string): boolean {
  return webStep(title.trim()) !== null;
}

export function friendlyStep(title: string): string {
  const trimmed = title.trim();
  const mcp = parseMcpTool(trimmed);
  if (mcp) return mcpStep(mcp);
  const named = SPARK_TOOL_STEPS[trimmed] ?? AGENT_TOOL_STEPS[trimmed];
  if (named) return named;
  return grepStep(trimmed) ?? webStep(trimmed) ?? snakeStep(trimmed);
}

const SNAKE_NAME = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/;

function snakeStep(title: string): string {
  return SNAKE_NAME.test(title) ? `Using ${humanizeToolName(title)}` : title;
}

export const WRITE_UP_STEP = 'Writing up results';
export const CONTINUED_SESSION_STEP = 'Continued session';

const SPARK_NOTES = [
  /^Working on \S+ in (?:this chat's worktree|your checkout)\./,
  /^Allowed .+ \([^()]+\)$/s,
  /^Denied: .+ \(you denied it\)$/s,
  /^Using .+ · \S+ effort$/,
  /^Using .+'s defaults$/,
];

export function placeNoteText(branch: string, inPlace: boolean): string {
  return inPlace
    ? `Working on ${branch} in your checkout.`
    : `Working on ${branch} in this chat's worktree.`;
}

export function isSparkNote(name: string): boolean {
  if (name === WRITE_UP_STEP || name === CONTINUED_SESSION_STEP) return true;
  return SPARK_NOTES.some((note) => note.test(name));
}

const TOOL_LABELS: Readonly<Record<string, string>> = {
  WebFetch: 'Web fetch',
  WebSearch: 'Web search',
  TodoWrite: 'To-do',
  PowerShell: 'PowerShell',
};

const UNNAMED_TOOLS = new Set(['exec_command', 'write_stdin']);

function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function toolLabel(name: string | null | undefined): string | null {
  const trimmed = name?.trim() ?? '';
  if (!trimmed || UNNAMED_TOOLS.has(trimmed)) return null;
  const mcp = parseMcpTool(trimmed);
  if (mcp) return SPARK_TOOL_STEPS[mcp.tool] ?? `${mcp.server} · ${mcp.tool}`;
  const known = TOOL_LABELS[trimmed] ?? SPARK_TOOL_STEPS[trimmed];
  return known ?? sentenceCase(humanizeToolName(trimmed));
}
