import { describe, expect, it } from 'vitest';
import { heldInTestRun } from '../crew-flows/held-sends.ts';
import { EVERYTHING_AVAILABLE } from './availability.ts';
import { SPARK_TOOLS, sparkToolsFor } from './server.ts';

const POST = 'spark_github_review_post';

const names = (scope: { reviewRun?: boolean }, available = EVERYTHING_AVAILABLE) =>
  sparkToolsFor(scope, available).map((tool) => tool.name);

describe('Spark tools in a pull request review run', () => {
  it('offers no tool that acts or sends except posting on the reviewed pull request', () => {
    const offered = sparkToolsFor({ reviewRun: true }, EVERYTHING_AVAILABLE);
    const sending = offered.filter((tool) => heldInTestRun(tool)).map((tool) => tool.name);
    expect(sending).toEqual([POST]);
    for (const tool of [
      'spark_slack_post',
      'spark_browser_open',
      'spark_browser_act',
      'spark_jira_edit',
      'spark_servicenow_edit',
      'spark_calendar_edit',
      'spark_mac_act',
      'spark_push',
      'spark_pull_request',
      'spark_terminal_run',
      'spark_artifact',
      'spark_crew_edit',
      'spark_rules_edit',
      'spark_comment_ticket',
    ]) {
      expect(offered.map((each) => each.name)).not.toContain(tool);
    }
  });

  it('keeps the read tools', () => {
    const offered = names({ reviewRun: true });
    for (const tool of ['spark_docs', 'spark_guide', 'spark_pr', 'spark_slack', 'spark_jira']) {
      expect(offered).toContain(tool);
    }
  });

  it('offers posting only while the user allows it', () => {
    expect(names({ reviewRun: true })).toContain(POST);
    expect(
      names({ reviewRun: true }, { ...EVERYTHING_AVAILABLE, github_review_post: false }),
    ).not.toContain(POST);
  });

  it('leaves an ordinary chat turn unchanged', () => {
    const offered = names({});
    const sending = SPARK_TOOLS.filter((tool) => heldInTestRun(tool) && !tool.assistantOnly);
    expect(sending.map((tool) => tool.name)).toContain('spark_browser_open');
    for (const tool of sending) expect(offered).toContain(tool.name);
  });
});
