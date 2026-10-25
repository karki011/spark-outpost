import { describe, expect, it } from 'vitest';
import {
  friendlyStep,
  humanizeToolName,
  isSparkNote,
  isWebToolTitle,
  parseMcpTool,
  placeNoteText,
  toolLabel,
} from './tool-steps.ts';

describe('friendlyStep', () => {
  it('distinguishes Code Mode discovery from composed reads for both providers', () => {
    for (const name of ['spark_execute', 'mcp.spark.spark_execute', 'mcp__spark__spark_execute']) {
      expect(friendlyStep(name)).toBe('Using Code Mode');
      expect(friendlyStep(name, {})).toBe('Finding Code Mode tools');
      expect(friendlyStep(name, { query: 'guide' })).toBe('Finding Code Mode tools');
      expect(friendlyStep(name, { code: 'return await tools.call("spark_guide", {});' })).toBe(
        'Combining reads with Code Mode',
      );
    }
  });

  it('reads Codex MCP argument envelopes without mistaking execution for discovery', () => {
    const name = 'mcp.spark.spark_execute';
    const envelope = (args: unknown) => ({
      tool: 'spark_execute',
      server: 'spark',
      arguments: args,
    });
    expect(friendlyStep(name, envelope({ query: 'spark_guide' }))).toBe('Finding Code Mode tools');
    expect(
      friendlyStep(name, envelope({ code: 'return await tools.call("spark_guide", {});' })),
    ).toBe('Combining reads with Code Mode');
    expect(friendlyStep(name, envelope(null))).toBe('Finding Code Mode tools');
  });

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

describe('isSparkNote', () => {
  it("knows Spark's own bookkeeping steps", () => {
    for (const note of [
      placeNoteText('spark/x', false),
      placeNoteText('main', true),
      'Writing up results',
      'Continued session',
      'Allowed Edit `a.ts` (you allowed it)',
      'Allowed Run `ls` (you allowed it for this chat)',
      'Allowed Run `ls` (you always allow it in this project)',
      'Allowed `aws sts get-caller-identity --query Arn` (Bypass permissions mode)',
      'Allowed Run `pnpm lint` (on the project allowlist)',
      'Allowed `make build` (allowed for this run)',
      'Allowed `ls -la` (a read-only command inside the project)',
      'Allowed `echo "(x)"` (Automatic in an Ask turn)',
      'Allowed `ls` (Default (recommended) mode)',
      'Denied: Run `rm x` (you denied it)',
      'Using Opus 5.5 · medium effort',
      "Using Claude's defaults",
    ]) {
      expect(isSparkNote(note)).toBe(true);
    }
  });

  it('keeps tool steps and warnings', () => {
    for (const step of [
      'Read `a.ts`',
      'Using get issue (linear)',
      'Using get issue',
      "Using Claude's default model; Fable 5 isn't available",
      'Warning: Claude switched to Bypass permissions mode',
      'Installing dependencies in this chat’s copy',
      'Allowed list',
      'Allowed hosts (example.com) were updated by the agent',
      'Allowed origins (example.com)',
    ]) {
      expect(isSparkNote(step)).toBe(false);
    }
  });
});

describe('toolLabel', () => {
  it('keeps agent tool names that already read as words', () => {
    for (const name of ['Read', 'Grep', 'Glob', 'Bash', 'Edit', 'Write', 'Skill']) {
      expect(toolLabel(name)).toBe(name);
    }
    expect(toolLabel('PowerShell')).toBe('PowerShell');
  });

  it('spells out the few names that do not', () => {
    expect(toolLabel('WebFetch')).toBe('Web fetch');
    expect(toolLabel('WebSearch')).toBe('Web search');
    expect(toolLabel('TodoWrite')).toBe('To-do');
  });

  it('names MCP tools by server and tool, and Spark tools by what they do', () => {
    expect(toolLabel('mcp__github__create_issue')).toBe('github · create_issue');
    expect(toolLabel('mcp__spark__spark_docs')).toBe('Reading the user guide');
    expect(toolLabel('spark_tickets')).toBe('Looking at tickets');
  });

  it('splits unknown names into words', () => {
    expect(toolLabel('NotebookEdit')).toBe('Notebook edit');
    expect(toolLabel('view_image')).toBe('View image');
    expect(toolLabel(' AskUserQuestion ')).toBe('Ask user question');
  });

  it('has no label for a missing name or a shell name that hides the action', () => {
    expect(toolLabel(undefined)).toBeNull();
    expect(toolLabel(null)).toBeNull();
    expect(toolLabel('  ')).toBeNull();
    expect(toolLabel('exec_command')).toBeNull();
    expect(toolLabel('write_stdin')).toBeNull();
  });
});
