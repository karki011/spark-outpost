export interface SearchableSection<Id extends string = string> {
  id: Id;
  label: string;
  groupLabel: string;
  rows: readonly string[];
}

export interface SettingsMatch<Id extends string = string> {
  section: Id;
  sectionLabel: string;
  groupLabel: string;
  row: string | null;
}

const LABEL_START = 0;
const WORD_STARTS = 1;
const INSIDE_WORDS = 2;
const GROUP_WORD_STARTS = 3;

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function labelScore(label: string, phrase: string, words: readonly string[]): number | null {
  const text = normalize(label);
  if (text.startsWith(phrase)) return LABEL_START;
  const labelWords = text.split(' ');
  if (words.every((word) => labelWords.some((candidate) => candidate.startsWith(word)))) {
    return WORD_STARTS;
  }
  if (words.every((word) => text.includes(word))) return INSIDE_WORDS;
  return null;
}

function sectionScore(
  section: SearchableSection,
  phrase: string,
  words: readonly string[],
): number | null {
  const own = labelScore(section.label, phrase, words);
  if (own !== null) return own;
  const group = labelScore(section.groupLabel, phrase, words);
  return group === LABEL_START || group === WORD_STARTS ? GROUP_WORD_STARTS : null;
}

interface Ranked<Id extends string> {
  match: SettingsMatch<Id>;
  score: number;
  order: number;
}

export function searchSettings<Id extends string>(
  query: string,
  sections: readonly SearchableSection<Id>[],
): SettingsMatch<Id>[] {
  const phrase = normalize(query);
  if (!phrase) return [];
  const words = phrase.split(' ');
  const ranked: Ranked<Id>[] = [];
  sections.forEach((section) => {
    const base = {
      section: section.id,
      sectionLabel: section.label,
      groupLabel: section.groupLabel,
    };
    const score = sectionScore(section, phrase, words);
    if (score !== null) ranked.push({ match: { ...base, row: null }, score, order: ranked.length });
    section.rows.forEach((row) => {
      const rowScore = labelScore(row, phrase, words);
      if (rowScore === null) return;
      ranked.push({ match: { ...base, row }, score: rowScore, order: ranked.length });
    });
  });
  return ranked.sort((a, b) => a.score - b.score || a.order - b.order).map((entry) => entry.match);
}
