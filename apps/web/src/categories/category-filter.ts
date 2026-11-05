import {
  categoryLabel,
  categorySchema,
  teammateFilterKey,
  type Category,
  type TeammateTag,
} from '@spark-outpost/contracts';

export interface ChatFilter {
  text: string;
  category: Category | null;
  unknownCategory: string | null;
  teammate: string | null;
}

const FILTER_TOKEN = /^is:(.*)$/i;
const TEAMMATE_TOKEN = /^with:(.*)$/i;

const ALIASES: Record<string, Category> = {
  bug: 'bug_fix',
  fix: 'bug_fix',
  debug: 'bug_fix',
  debugging: 'bug_fix',
  reading: 'research',
  investigate: 'research',
  design: 'plan',
  doc: 'docs',
  documentation: 'docs',
  test: 'tests',
  setup: 'config',
  configuration: 'config',
  chore: 'config',
  questions: 'question',
};

const normalise = (value: string) => value.toLowerCase().replace(/[^a-z]/g, '');

const KEYS = new Map<string, Category>([
  ...Object.entries(ALIASES),
  ...categorySchema.options.flatMap((category): [string, Category][] => [
    [normalise(category), category],
    [normalise(categoryLabel(category)), category],
  ]),
]);

export function categoryFromKeyword(keyword: string): Category | null {
  return KEYS.get(normalise(keyword)) ?? null;
}

export function parseChatFilter(input: string): ChatFilter {
  const words: string[] = [];
  let category: Category | null = null;
  let unknownCategory: string | null = null;
  let teammate: string | null = null;
  for (const word of input.trim().split(/\s+/).filter(Boolean)) {
    const withName = TEAMMATE_TOKEN.exec(word)?.[1];
    if (withName !== undefined) {
      teammate = teammateFilterKey(withName) || null;
      continue;
    }
    const keyword = FILTER_TOKEN.exec(word)?.[1];
    if (keyword === undefined) {
      words.push(word);
      continue;
    }
    if (!keyword) continue;
    category = categoryFromKeyword(keyword);
    unknownCategory = category ? null : keyword;
  }
  return { text: words.join(' '), category, unknownCategory, teammate };
}

export function isFiltering(filter: ChatFilter): boolean {
  return filter.category !== null || filter.unknownCategory !== null || filter.teammate !== null;
}

export function matchesTeammate(
  filter: ChatFilter,
  teammate: TeammateTag | null | undefined,
): boolean {
  return (
    filter.teammate === null ||
    (teammate ? teammateFilterKey(teammate.name) : null) === filter.teammate
  );
}

export function withTeammateToken(input: string, name: string | null): string {
  const rest = input
    .trim()
    .split(/\s+/)
    .filter((word) => word && !TEAMMATE_TOKEN.test(word));
  return [...rest, ...(name ? [`with:${teammateFilterKey(name)}`] : [])].join(' ');
}

export function matchesFilter(filter: ChatFilter, category: Category | null): boolean {
  if (filter.unknownCategory !== null) return false;
  return filter.category === null || filter.category === category;
}
