import { z } from 'zod';
import { guideSections } from '../guide/sections.ts';
import { searchGuide } from '../guide/search.ts';
import { limitInput, sparkTool, SparkToolError, type SparkToolContext } from '../tool.ts';

function sectionList() {
  return guideSections.map((section) => ({ id: section.id, title: section.title }));
}

async function guide(args: {
  query?: string | undefined;
  section?: string | undefined;
  limit: number;
}) {
  if (args.section) {
    const found = guideSections.find((section) => section.id === args.section);
    if (!found) {
      const ids = guideSections.map((section) => section.id).join(', ');
      throw new SparkToolError(`No guide section "${args.section}". Known sections: ${ids}`);
    }
    return { matches: [{ id: found.id, title: found.title, text: found.text }] };
  }
  if (!args.query) {
    return { sections: sectionList() };
  }
  const results = searchGuide(guideSections, args.query, args.limit);
  if (results.length === 0) {
    return {
      matches: [],
      sections: sectionList(),
      note: 'No guide section matched that query. Here are all section titles; try spark_guide again with one of their ids as `section`.',
    };
  }
  const byId = new Map(guideSections.map((section) => [section.id, section]));
  return {
    matches: results.map((result) => {
      const section = byId.get(result.id);
      return { id: result.id, title: result.title, text: section?.text ?? '' };
    }),
  };
}

export const guideTool = sparkTool({
  name: 'spark_guide',
  title: 'Spark guide',
  description:
    "Answers how-to and how-does-it-work questions about Spark Outpost itself, from a small curated index built from Spark's own docs (providers, agent modes and autonomy levels, approvals and safety, worktrees, the coordinator, Ship, tickets, MCP servers, analytics and more). Pass a `query` to search it, or `section` for one exact section by id.",
  input: {
    query: z.string().max(300).optional(),
    section: z.string().max(80).optional(),
    limit: limitInput(3, 5),
  },
  run: (args, _context: SparkToolContext) => guide(args),
});
