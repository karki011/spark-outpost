import { describe, expect, it } from 'vitest';
import { friendlyStep, humanizeToolName, isWebToolTitle, parseMcpTool } from './tool-steps.ts';

describe('friendlyStep', () => {
  it('names Spark tools in plain words, from Claude and Codex', () => {
    expect(friendlyStep('mcp__spark__spark_projects')).toBe('Looking at projects');
    expect(friendlyStep('mcp__spark__spark_map')).toBe('Reading the project map');
    expect(friendlyStep('mcp__spark__spark_pull_requests')).toBe('Checking pull requests');
    expect(friendlyStep('mcp.spark.spark_open_pr')).toBe('Opening a PR');
    expect(friendlyStep('spark_tickets')).toBe('Looking at tickets');
  });

  it('names other MCP tools by tool and server', () => {
    expect(friendlyStep('mcp__github__create_pull_request')).toBe(
      'Using create pull request (github)',
    );
    expect(friendlyStep('mcp.linear-server.listIssues')).toBe('Using list issues (linear server)');
    expect(friendlyStep('mcp__spark__spark_something_new')).toBe(
      'Using spark something new (spark)',
    );
  });

  it('turns bare agent tool names and snake names into words', () => {
    expect(friendlyStep('WebSearch')).toBe('Searching the web');
    expect(friendlyStep('TodoWrite')).toBe('Updating the to-do list');
    expect(friendlyStep('lookup_weather')).toBe('Using lookup weather');
  });

  it('reads grep titles as a search for the pattern', () => {
    expect(friendlyStep('grep -i -n "AI_USER" /work/apps/web/src')).toBe(
      'Search for `AI_USER` in `src`',
    );
    expect(friendlyStep('grep --include="*.ts" "useQuery"')).toBe('Search for `useQuery`');
  });

  it('names web reads in the past tense, fetches by their site', () => {
    expect(friendlyStep('Fetch https://docs.github.com/en/rest?x=1')).toBe(
      'Fetched docs.github.com',
    );
    expect(friendlyStep('Open page: https://user@example.com/a')).toBe('Fetched example.com');
    for (const title of ['Search "react 20 release"', 'Web search', 'Web search: react 20']) {
      expect(friendlyStep(title)).toBe('Searched the web');
      expect(isWebToolTitle(title)).toBe(true);
    }
    expect(isWebToolTitle('Read `table.tsx`')).toBe(false);
  });

  it('leaves titles that already read well alone', () => {
    for (const title of [
      'Read `table.tsx`',
      'Thinking',
      'Searched the web',
      'Continued session',
      '`pnpm test`',
      'Looking at projects',
      'Find `src` `*.ts`',
    ]) {
      expect(friendlyStep(title)).toBe(title);
      expect(friendlyStep(friendlyStep(title))).toBe(title);
    }
  });
});

describe('parseMcpTool', () => {
  it('splits Claude and Codex MCP names', () => {
    expect(parseMcpTool('mcp__plugin_x__do_it')).toEqual({ server: 'plugin_x', tool: 'do_it' });
    expect(parseMcpTool('mcp.github.get_issue')).toEqual({ server: 'github', tool: 'get_issue' });
    expect(parseMcpTool('Read file')).toBeNull();
  });

  it('humanizes names', () => {
    expect(humanizeToolName('getPullRequest_files')).toBe('get pull request files');
  });
});
