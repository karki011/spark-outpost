import type {
  RecapBody,
  RecapItem,
  RecapRefine,
  RecapSection,
  RecapState,
  RecapTotals,
  RecapVoice,
  WeekRecap,
} from '@spark-outpost/contracts';
import { formatCost } from '../../usage/format.ts';

export const SECTION_LABELS: Record<RecapSection, string> = {
  done: 'Done this week',
  progress: 'In progress',
  help: 'Could use your help',
  you: 'Waiting on you',
};

export const SECTION_EMPTY: Record<RecapSection, string> = {
  done: 'Nothing finished yet this week.',
  progress: 'Nothing in progress.',
  help: 'Nothing waiting on anyone.',
  you: 'Nothing waiting on you.',
};

export function sectionsFor(voice: RecapVoice): RecapSection[] {
  return voice === 'me' ? ['done', 'progress', 'help', 'you'] : ['done', 'progress', 'help'];
}

export function itemText(item: RecapItem, voice: RecapVoice): string {
  return voice === 'manager' ? (item.manager ?? item.me) : item.me;
}

function linked(text: string, url: string | null): string {
  if (!url) return text;
  const ref = /#\d+\b|\b[A-Z][A-Z0-9]{1,9}-\d+\b|\b[A-Z]{2,6}\d{5,}\b/.exec(text);
  if (!ref) return text;
  return `${text.slice(0, ref.index)}[${ref[0]}](${url})${text.slice(ref.index + ref[0].length)}`;
}

export function copyText(body: RecapBody, voice: RecapVoice): string {
  return sectionsFor(voice)
    .filter((section) => section !== 'you')
    .flatMap((section) => {
      const lead = body[section][0];
      if (!lead) return [];
      return [`**${SECTION_LABELS[section]}:** ${linked(itemText(lead, voice), lead.url)}`];
    })
    .join('\n');
}

export function plainText(markdown: string): string {
  return markdown
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|\W)[*_]([^*_\n]+)[*_](?=\W|$)/g, '$1$2');
}

export function latestRefined(refines: readonly RecapRefine[], voice: RecapVoice): string | null {
  const ready = refines.filter((refine) => refine.voice === voice && refine.status === 'ready');
  return ready.at(-1)?.textOut ?? null;
}

export function refining(refines: readonly RecapRefine[]): RecapRefine | null {
  return refines.find((refine) => refine.status === 'running') ?? null;
}

export function lastRefineError(refines: readonly RecapRefine[]): string | null {
  const last = refines.at(-1);
  return last?.status === 'failed' ? last.error : null;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function totalsLine(totals: RecapTotals): string {
  return [
    plural(totals.chats, 'chat', 'chats'),
    totals.merged > 0 ? `${plural(totals.merged, 'pull request', 'pull requests')} merged` : null,
    totals.open > 0 ? `${totals.open} open` : null,
    totals.tickets > 0 ? `${plural(totals.tickets, 'ticket', 'tickets')} moved` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

export function weekRange(recap: WeekRecap): string {
  const format = new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  return `${format.format(new Date(recap.since))} – ${format.format(new Date(recap.until))}`;
}

export function recapMeta(recap: WeekRecap, refines: readonly RecapRefine[]): string {
  const costs = [recap.costUsd, ...refines.map((refine) => refine.costUsd)].filter(
    (cost): cost is number => cost !== null,
  );
  const total = costs.reduce((sum, cost) => sum + cost, 0);
  return [
    recap.modelLabel ? `Written by ${recap.modelLabel}` : null,
    costs.length > 0 ? formatCost(total, recap.costSource ?? undefined) : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

export type RecapView = 'hidden' | 'early' | 'offer' | 'writing' | 'ready' | 'failed';

export function recapView(state: RecapState | undefined): RecapView {
  if (!state || !state.available) return 'hidden';
  const status = state.recap?.status;
  if (status === 'running') return 'writing';
  if (status === 'ready') return 'ready';
  if (status === 'failed') return 'failed';
  if (!state.enabled) return 'hidden';
  return state.due ? 'offer' : 'early';
}
