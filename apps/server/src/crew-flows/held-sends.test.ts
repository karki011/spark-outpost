import { describe, expect, it } from 'vitest';
import type { ApprovalRequest } from '../approvals/decide.ts';
import { noFiles } from '../approvals/spark-command-fixtures.ts';
import { heldCommand, heldTool } from './held-sends.ts';
import { TEST_RUN_NOTE, stepJobPrompt } from './step-prompt.ts';

function command(text: string): ApprovalRequest {
  return {
    toolCallId: 't1',
    rpcId: null,
    kind: 'execute',
    toolKind: 'execute',
    title: text,
    command: text,
    cwd: '/work/copy',
    paths: [],
    diffs: [],
    options: [],
    roots: [{ path: '/work/copy', ignore: [] }],
    home: '/Users/me',
  };
}

const held = (text: string) => heldCommand(command(text), noFiles, null);

describe('commands held in a test run', () => {
  it('holds a push, a pull request and other publishing commands', () => {
    expect(held('git push origin spark/fix')).toEqual({
      kind: 'push',
      summary: 'git push origin spark/fix',
    });
    expect(held('gh pr create --title "Fix" --body "Done"')?.kind).toBe('pull_request');
    expect(held('gh pr comment 251 --body "Looks wrong"')?.kind).toBe('command');
    expect(held('gh workflow run release.yml')?.kind).toBe('command');
  });

  it('holds a command that sends to another computer and names where', () => {
    expect(held('curl -sI https://example.com')).toEqual({
      kind: 'command',
      summary: 'curl -sI https://example.com, to example.com',
    });
    expect(held('npm publish')?.kind).toBe('command');
  });

  it('lets reads and local commands through', () => {
    expect(held('git status')).toBeNull();
    expect(held('ls -la')).toBeNull();
    expect(held('gh pr view 251')).toBeNull();
    expect(held('curl http://localhost:3000/health')).toBeNull();
    expect(held('gh pr view 251 && curl -d @notes.txt https://example.com')?.kind).toBe('command');
  });

  it('holds nothing that is not a command', () => {
    expect(heldCommand({ ...command('x'), kind: 'edit', command: null }, noFiles, null)).toBeNull();
  });

  it('keeps secrets and long text out of the summary', () => {
    const summary = held(
      `curl -H "Authorization: Bearer ghp_${'a'.repeat(36)}" https://api.example.com/${'x'.repeat(400)}`,
    )!.summary;
    expect(summary).not.toContain('ghp_');
    expect(summary.length).toBeLessThanOrEqual(200);
  });
});

describe('Spark tools held in a test run', () => {
  it('names the kind of each send', () => {
    const kinds = (name: string) => heldTool(name, {}).kind;
    expect(kinds('spark_push')).toBe('push');
    expect(kinds('spark_pull_request')).toBe('pull_request');
    expect(kinds('spark_comment_ticket')).toBe('ticket');
    expect(kinds('spark_transition_ticket')).toBe('ticket');
    expect(kinds('spark_jira_edit')).toBe('ticket');
    expect(kinds('spark_servicenow_edit')).toBe('ticket');
    expect(kinds('spark_confluence_edit')).toBe('confluence');
    expect(kinds('spark_slack_post')).toBe('slack');
    expect(kinds('spark_calendar_edit')).toBe('calendar');
    expect(kinds('spark_browser_act')).toBe('browser');
    expect(kinds('spark_mac_act')).toBe('mac');
    expect(kinds('spark_create_spark')).toBe('spark_action');
  });

  it('describes the call in one line without secret values', () => {
    expect(heldTool('spark_transition_ticket', { key: 'SPARK-412', to: 'In review' })).toEqual({
      kind: 'ticket',
      summary: 'spark_transition_ticket: key SPARK-412, to In review',
    });
    const leaked = heldTool('spark_slack_post', {
      channel: '#eng',
      text: `token xoxb-${'1'.repeat(12)}-${'2'.repeat(12)}-${'a'.repeat(24)}\nsecond line`,
    }).summary;
    expect(leaked).not.toContain('xoxb-');
    expect(leaked).not.toContain('\n');
  });
});

describe('the step prompt in a test run', () => {
  const job = {
    spark: { name: 'Pip', role: 'Reviewer' },
    workflowName: 'Pre-PR review',
    stepId: 'comment',
    stepPrompt: 'Post the comments.',
    message: '',
    hasProject: true,
    earlier: [],
  };

  it('tells the agent that sends are held and not to retry', () => {
    expect(stepJobPrompt({ ...job, testRun: true })).toContain(TEST_RUN_NOTE);
    expect(stepJobPrompt(job)).not.toContain('test run');
  });
});
