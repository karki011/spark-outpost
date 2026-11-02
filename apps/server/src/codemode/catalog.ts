import { z } from 'zod';
import type { SparkScope } from '../spark-mcp/deps.ts';
import type { SparkTool } from '../spark-mcp/tool.ts';

const RESULT_HINTS: Readonly<Record<string, string>> = {
  spark_tickets:
    'Successful data depends on action: list (default) returns {items: [{source, key, title, status, section, url, pullRequest?, development?}], total, offset, nextOffset?, summary, problems}; search returns {items: [{source, key, title, status, statusGroup, url}], total, offset, nextOffset?, problems}; read returns {untrusted, ticket: {source, key, title, status, description, descriptionNextOffset?, comments, pullRequests, development?}}. Read ticket fields from data.ticket, and list/search rows from data.items. These are key fields, not exhaustive shapes.',
  spark_pull_requests:
    'Successful data is {project, repo, via, state, pulls: [{number, title, author, state, draft, head, base, url, reviewState, ci, mergeable, mergeState, createdAt, updatedAt}]}. Iterate data.pulls, not data.items. ci is {state, failing?: string[]}; mergeable may be null.',
  spark_pr:
    'Successful data has top-level {project, repo, via, number, title, body, state, merged, draft, head, base, url, reviewState, ci, checks, reviews, additions, deletions, files, reviewComments, issueComments}. Read data.title directly; there is no data.pr wrapper. files, reviewComments and issueComments each have {total, offset, items, nextOffset?}; reviews is [{user, state}], checks is an array, and ci is {state, failing?: string[]}. These are key fields, not exhaustive shapes.',
  spark_docs:
    'Successful data depends on arguments: no page/query returns {sections: [{section, pages: [{page, title, type, summary}]}]}; query returns {matches: [{page, title, type, heading, link, snippet, text}]}; page returns {page, title, section, type, summary, link, headings: [{text, anchor}], sections: [{anchor, link, text}]}. For page text use data.sections.map(section => section.text); for search use data.matches. Empty searches also return sections and note.',
  spark_guide:
    'Successful data with section or query is {matches: [{id, title, text}]}; read text with data.matches.map(match => match.text), not data.text or data.content. With no section/query data is {sections: [{id, title}]}. An empty search returns {matches: [], sections: [{id, title}], note}. Always check result.isError and that result.data exists before reading these fields.',
};

export function codeModeOffered(scope: Partial<SparkScope>): boolean {
  return (
    process.env.SPARK_CODE_MODE !== '0' &&
    scope.codeMode === true &&
    Boolean(scope.runId && scope.conversationId && scope.actions) &&
    scope.rebinds !== true
  );
}

export function codeModeTools(tools: readonly SparkTool[]): readonly SparkTool[] {
  return tools.filter(
    (tool) => Object.hasOwn(RESULT_HINTS, tool.name) && !tool.acts && !tool.assistantOnly,
  );
}

export function describeCodeModeTools(tools: readonly SparkTool[], query?: string) {
  const search = query?.trim().toLowerCase();
  return codeModeTools(tools)
    .filter(
      (tool) =>
        !search || `${tool.name} ${tool.title} ${tool.description}`.toLowerCase().includes(search),
    )
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: z.toJSONSchema(z.object(tool.input), { io: 'input' }),
      resultHint: RESULT_HINTS[tool.name],
    }));
}
