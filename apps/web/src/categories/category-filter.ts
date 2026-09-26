import { categoryLabel, categorySchema, type Category } from '@spark-outpost/contracts';

export interface ChatFilter {
  text: string;
  category: Category | null;
  unknownCategory: string | null;
}

const FILTER_TOKEN = /^is:(.*)$/i;

const ALIASES: Record<string, Category> = {
  bug: 'bug_fix',
  fix: 'bug_fix',
  debug: 'debugging',
  reading: 'research',
  doc: 'docs',
  documentation: 'docs',
  config: 'setup',
  configuration: 'setup',
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
  for (const word of input.trim().split(/\s+/).filter(Boolean)) {
    const keyword = FILTER_TOKEN.exec(word)?.[1];
    if (keyword === undefined) {
      words.push(word);
      continue;
    }
    if (!keyword) continue;
    category = categoryFromKeyword(keyword);
    unknownCategory = category ? null : keyword;
  }
  return { text: words.join(' '), category, unknownCategory };
}

export function isFiltering(filter: ChatFilter): boolean {
  return filter.category !== null || filter.unknownCategory !== null;
}

export function matchesFilter(filter: ChatFilter, category: Category | null): boolean {
  if (filter.unknownCategory !== null) return false;
  return filter.category === null || filter.category === category;
}
