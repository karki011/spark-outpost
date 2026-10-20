import { describe, expect, it } from 'vitest';
import { EVERYTHING_AVAILABLE, unavailableNote, type SparkAvailability } from './availability.ts';
import { sparkInstructionsFor, sparkToolsFor } from './server.ts';

const NOTHING: SparkAvailability = {
  tickets: false,
  slack: false,
  pull_requests: false,
  project: false,
  publish: false,
  pull_request_create: false,
  browser: false,
  mac: false,
  outpost: false,
  outpost_draft: false,
  outpost_start: false,
  calendar_read: false,
  calendar_edit: false,
  jira: false,
  confluence: false,
};

const GROUPS: [keyof SparkAvailability, string[]][] = [
  [
    'tickets',
    [
      'spark_tickets',
      'spark_create_ticket',
      'spark_comment_ticket',
      'spark_transition_ticket',
      'spark_assign_ticket',
    ],
  ],
  ['slack', ['spark_slack', 'spark_slack_post']],
  [
    'pull_requests',
    ['spark_pull_requests', 'spark_pr', 'spark_pr_follow_up', 'spark_pr_follow_up_round'],
  ],
  ['project', ['spark_map', 'spark_find', 'spark_terminal_run']],
  ['publish', ['spark_push']],
  ['pull_request_create', ['spark_pull_request']],
  [
    'browser',
    [
      'spark_browser_open',
      'spark_browser_act',
      'spark_browser_tabs',
      'spark_browser_read',
      'spark_browser_screenshot',
      'spark_browser_logs',
      'spark_browser_devtools',
      'spark_browser_preview',
      'spark_browser_signins',
      'spark_browser_sign_in',
    ],
  ],
  ['outpost', ['spark_outpost', 'spark_outpost_ask', 'spark_outpost_note']],
  ['outpost_draft', ['spark_outpost_draft']],
  ['outpost_start', ['spark_outpost_start']],
  ['jira', ['spark_jira', 'spark_jira_edit']],
  ['confluence', ['spark_confluence', 'spark_confluence_edit']],
];

const names = (available: SparkAvailability, readOnly = false) =>
  sparkToolsFor({ readOnly }, available).map((tool) => tool.name);

describe('which Spark tools a session is offered', () => {
  it.each(GROUPS)('offers the %s tools only when they can be used', (need, tools) => {
    const withGroup = names({ ...NOTHING, [need]: true });
    const without = names({ ...EVERYTHING_AVAILABLE, [need]: false });
    for (const tool of tools) {
      expect(withGroup, tool).toContain(tool);
      expect(without, tool).not.toContain(tool);
    }
    expect(names(EVERYTHING_AVAILABLE).length - without.length).toBe(tools.length);
  });

  it('always offers the tools that say what is connected and how Spark works', () => {
    expect(names(NOTHING)).toEqual(
      expect.arrayContaining([
        'spark_connectors',
        'spark_projects',
        'spark_guide',
        'spark_docs',
        'spark_attention',
        'spark_add_mcp_server',
      ]),
    );
  });

  it('keeps the same tools in the same order for the same answers', () => {
    expect(names(NOTHING)).toEqual(names({ ...NOTHING }));
    const everything = names(EVERYTHING_AVAILABLE);
    expect(names(NOTHING)).toEqual(everything.filter((name) => names(NOTHING).includes(name)));
  });

  it('offers a read-only session no action tools, whatever is connected', () => {
    const offered = sparkToolsFor({ readOnly: true }, EVERYTHING_AVAILABLE);
    expect(offered.some((tool) => tool.acts)).toBe(false);
    expect(offered.map((tool) => tool.name)).toContain('spark_tickets');
  });
});

describe('what a session is told about tools it was not offered', () => {
  it('says how to get each missing group and when it arrives', () => {
    const note = unavailableNote(NOTHING);
    expect(note).toContain('connect Atlassian or Linear in Settings → Connectors');
    expect(note).toContain('connect Slack in Settings → Connectors');
    expect(note).toContain('connect GitHub in Settings → Connectors and link a project');
    expect(note).toContain('spark_map and spark_find (link a project to the chat)');
    expect(note).toContain('next message');
    expect(sparkInstructionsFor(NOTHING)).toContain(note);
  });

  it('names only the groups that are missing, and nothing when all are offered', () => {
    const note = unavailableNote({ ...EVERYTHING_AVAILABLE, tickets: false, browser: false });
    expect(note).toContain('ticket tools');
    expect(note).not.toContain('Slack');
    expect(note).not.toContain('Browser');
    expect(unavailableNote(EVERYTHING_AVAILABLE)).toBe('');
  });

  it('mentions the outpost tools only when one of them is offered', () => {
    expect(sparkInstructionsFor({ ...NOTHING, outpost: true })).toContain('spark_outpost*');
    expect(sparkInstructionsFor({ ...NOTHING, outpost_draft: true })).toContain('spark_outpost*');
    expect(sparkInstructionsFor(NOTHING)).not.toContain('spark_outpost*');
    expect(unavailableNote(NOTHING)).not.toContain('outpost');
  });

  it('mentions the Browser pane only when its tools are offered', () => {
    expect(sparkInstructionsFor(EVERYTHING_AVAILABLE)).toContain('spark_browser_*');
    expect(sparkInstructionsFor(NOTHING)).not.toContain('spark_browser_*');
  });
});
