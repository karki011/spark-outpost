export const SPARK_MENTIONS_MAX = 3;
export const SPARK_HANDOFF_NOTE_MAX = 1200;

export interface SparkMention<T> {
  spark: T;
  start: number;
  end: number;
}

const OPENS_MENTION = /[\s(["'“‘]/u;
const CONTINUES_WORD = /[\p{L}\p{N}_]/u;

function nameAt<T extends { name: string }>(
  text: string,
  at: number,
  sparks: readonly T[],
): SparkMention<T> | null {
  for (const spark of sparks) {
    const name = spark.name.trim();
    const end = at + 1 + name.length;
    if (!name || text.slice(at + 1, end).toLowerCase() !== name.toLowerCase()) continue;
    const next = text.charAt(end);
    if (next && CONTINUES_WORD.test(next)) continue;
    return { spark, start: at, end };
  }
  return null;
}

export function findSparkMentions<T extends { name: string }>(
  text: string,
  sparks: readonly T[],
): SparkMention<T>[] {
  if (sparks.length === 0) return [];
  const longestFirst = [...sparks].sort((a, b) => b.name.length - a.name.length);
  const found: SparkMention<T>[] = [];
  for (let at = text.indexOf('@'); at !== -1; at = text.indexOf('@', at + 1)) {
    if (at > 0 && !OPENS_MENTION.test(text.charAt(at - 1))) continue;
    const mention = nameAt(text, at, longestFirst);
    if (!mention || found.some((earlier) => earlier.spark === mention.spark)) continue;
    found.push(mention);
    if (found.length === SPARK_MENTIONS_MAX) break;
  }
  return found;
}

export function withoutShadowed<T>(
  mentions: readonly SparkMention<T>[],
  longer: readonly Pick<SparkMention<unknown>, 'start' | 'end'>[],
): SparkMention<T>[] {
  return mentions.filter(
    (mention) => !longer.some((other) => other.start === mention.start && other.end > mention.end),
  );
}

const BETWEEN_LEADING_MENTIONS = /^[\s,&+]*(?:and\b[\s,]*)?$/i;
const HANDS_BACK =
  /\b(?:and then|then|after that|afterwards|once (?:it|he|she|they)(?:'s|’s| is| are| has| have)? (?:done|finished)|when (?:it|he|she|they)(?:'s|’s| is| are)? (?:done|finished))\b/i;

export function sparksLeadMessage(
  text: string,
  mentions: readonly Pick<SparkMention<unknown>, 'start' | 'end'>[],
): boolean {
  let cursor = 0;
  for (const mention of mentions) {
    if (!BETWEEN_LEADING_MENTIONS.test(text.slice(cursor, mention.start))) return false;
    cursor = mention.end;
  }
  return mentions.length > 0;
}

export function mainAgentContinues(
  text: string,
  mentions: readonly Pick<SparkMention<unknown>, 'start' | 'end'>[],
): boolean {
  if (mentions.length === 0) return true;
  if (!sparksLeadMessage(text, mentions)) return true;
  return HANDS_BACK.test(text.slice(mentions.at(-1)!.end));
}

export function sparkMentionText(name: string): string {
  return `@${name.trim()}`;
}

export function sparkWho(spark: { name: string; role: string }): string {
  return spark.role ? `${spark.name} · ${spark.role}` : spark.name;
}

export const SPARK_MENTION_HINT =
  '@Spark hands this one job to that Spark as a read-only subagent with its own context. Talk to… makes the whole chat a chat with a Spark.';
