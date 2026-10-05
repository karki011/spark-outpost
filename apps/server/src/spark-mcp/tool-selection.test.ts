import { describe, expect, it } from 'vitest';
import { EVERYTHING_AVAILABLE, unavailableNote, type SparkAvailability } from './availability.ts';
import { sparkInstructionsFor, sparkToolsFor } from './server.ts';

const NOTHING: SparkAvailability = {
  tickets: false,
  slack: false,
  pull_requests: false,
  project: false,
  browser: false,
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
    [
      'spark_pull_requests',
      'spark_pr',
      'spark_pr_follow_up',
      'spark_open_pr',
      'spark_pr_follow_up_round',
    ],
  ],
  ['project', ['spark_map', 'spark_find']],
  [
    'browser',
    [
      'spark_browser_open',
      'spark_browser_tabs',
      'spark_browser_read',
      'spark_browser_screenshot',
      'spark_browser_logs',
      'spark_browser_preview',
    ],
  ],
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
    expect(note).toContain('connect Jira or Linear in Settings → Connectors');
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

  it('mentions the Browser pane only when its tools are offered', () => {
    expect(sparkInstructionsFor(EVERYTHING_AVAILABLE)).toContain('spark_browser_*');
    expect(sparkInstructionsFor(NOTHING)).not.toContain('spark_browser_*');
  });
});
