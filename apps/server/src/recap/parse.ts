import {
  RECAP_ITEMS_MAX,
  RECAP_REFINE_TEXT_MAX_LENGTH,
  RECAP_SECTIONS,
  RECAP_TEXT_MAX_LENGTH,
  recapReplySchema,
  type RecapBody,
  type RecapItem,
  type RecapReply,
  type RecapSection,
} from '@spark-outpost/contracts';
import { ellipsize, oneLine } from '../digest/text.ts';
import type { RecapFact } from './facts.ts';

const REFERENCE = /#\d+\b|\b[A-Z][A-Z0-9]{1,9}-\d+\b|\b[A-Z]{2,6}\d{5,}\b/g;

export function referencesIn(text: string): string[] {
  return text.match(REFERENCE) ?? [];
}

function jsonPart(text: string): string | null {
  const unfenced = text.replace(/```(?:json)?/gi, '');
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  return start >= 0 && end > start ? unfenced.slice(start, end + 1) : null;
}

function replyOf(text: string): RecapReply | null {
  const json = jsonPart(text);
  if (!json) return null;
  try {
    const reply = recapReplySchema.safeParse(JSON.parse(json));
    return reply.success ? reply.data : null;
  } catch {
    return null;
  }
}

function sentence(text: string | null | undefined): string | null {
  const clean = oneLine(text ?? '');
  return clean ? ellipsize(clean, RECAP_TEXT_MAX_LENGTH) : null;
}

function grounded(
  raw: RecapReply[RecapSection][number],
  section: RecapSection,
  facts: ReadonlyMap<string, RecapFact>,
): RecapItem | null {
  const cited = raw.facts.flatMap((id) => facts.get(id) ?? []);
  if (cited.length === 0) return null;
  const me = sentence(raw.me);
  const manager = section === 'you' ? null : sentence(raw.manager);
  if (!me || (section !== 'you' && !manager)) return null;
  const allowed = new Set(cited.flatMap((fact) => fact.refs));
  const named = [...referencesIn(me), ...referencesIn(manager ?? '')];
  if (named.some((ref) => !allowed.has(ref))) return null;
  if (section === 'help' && cited.every((fact) => fact.waitingOnYou)) return null;
  const linked = cited.find((fact) => fact.url) ?? null;
  return {
    me,
    manager,
    url: linked?.url ?? null,
    chatId: (linked ?? cited[0])?.chatId ?? null,
  };
}

export function parseRecapReply(text: string, facts: readonly RecapFact[]): RecapBody | null {
  const reply = replyOf(text);
  if (!reply) return null;
  const byId = new Map(facts.map((fact) => [fact.id, fact] as const));
  const body = Object.fromEntries(
    RECAP_SECTIONS.map((section) => [
      section,
      reply[section]
        .map((raw) => grounded(raw, section, byId))
        .filter((item): item is RecapItem => item !== null)
        .slice(0, RECAP_ITEMS_MAX),
    ]),
  ) as RecapBody;
  const empty = RECAP_SECTIONS.every((section) => body[section].length === 0);
  return empty && facts.length > 0 ? null : body;
}

function unfenced(text: string): string {
  const trimmed = text.trim();
  const fence = /^```[a-z]*\n([\s\S]*?)\n```$/i.exec(trimmed);
  return fence?.[1]?.trim() ?? trimmed;
}

export function groundRefinedText(
  text: string,
  facts: readonly RecapFact[],
  draft: string,
): string | null {
  const allowed = new Set([...facts.flatMap((fact) => fact.refs), ...referencesIn(draft)]);
  const cleaned = unfenced(text)
    .replace(REFERENCE, (ref) => (allowed.has(ref) ? ref : ''))
    .replace(/\(\s*\)/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +([,.;:])/g, '$1')
    .replace(/,([.;:])/g, '$1')
    .trim();
  return cleaned ? cleaned.slice(0, RECAP_REFINE_TEXT_MAX_LENGTH) : null;
}
