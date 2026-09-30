import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import type { Ratings } from '../../packages/contracts/src/index.ts';
import { decideIntake } from '../../apps/server/src/orchestration/intake.ts';
import { namedFiles } from '../../apps/server/src/orchestration/context.ts';
import { routeBuilder, type RouteContext } from '../../apps/server/src/orchestration/routing.ts';
import {
  replayCandidates,
  replayChats,
  replayCorpus,
  type ReplayChat,
  type ReplayItem,
} from './replay-corpus.ts';

const { values } = parseArgs({
  options: {
    out: { type: 'string' },
    baseline: { type: 'string' },
    ratings: { type: 'string' },
  },
});

interface Pick {
  id: string;
  chat: string;
  model: string | null;
  rule: string;
}

function contextFor(chat: ReplayChat, request: string): RouteContext {
  return {
    routing: 'auto',
    chat: { provider: chat.provider, model: chat.model, modelLabel: chat.label, effort: 'medium' },
    providerEffort: null,
    candidates: replayCandidates,
    request,
    now: new Date('2026-09-30T12:00:00Z'),
  };
}

function pickFor(item: ReplayItem, chat: ReplayChat, ratings: Ratings | null): Pick {
  const decisions = decideIntake(null, {
    request: item.request,
    mode: 'do',
    level: 'hands-off',
    firstMessage: !item.followUp,
    namedFiles: namedFiles([item.request]).length,
    currentTask: item.followUp
      ? { taskId: 't', previousRequest: '', summary: '', lastReplyAt: null }
      : null,
  });
  const facts = {
    trivial: decisions.trivial,
    destructive: decisions.destructive,
    vague: decisions.calls.vague?.value === true,
    continues: decisions.continues,
    ratings,
  };
  const route = routeBuilder(contextFor(chat, item.request), facts);
  return {
    id: item.id,
    chat: chat.name,
    model: route.pick.modelLabel ?? route.pick.model,
    rule: route.rule,
  };
}

function key(pick: Pick): string {
  return `${pick.id}|${pick.chat}`;
}

function compare(baseline: readonly Pick[], picks: readonly Pick[]): void {
  const before = new Map(baseline.map((pick) => [key(pick), pick]));
  const changed = picks.filter((pick) => before.get(key(pick))?.model !== pick.model);
  const same = picks.length - changed.length;
  console.log(`Agreement: ${same}/${picks.length} (${((same / picks.length) * 100).toFixed(1)}%)`);
  for (const pick of changed) {
    const old = before.get(key(pick));
    console.log(
      `  ${pick.id} [${pick.chat}] ${old?.model} (${old?.rule}) → ${pick.model} (${pick.rule})`,
    );
  }
}

const rated: Record<string, Ratings> = values.ratings
  ? (JSON.parse(await readFile(values.ratings, 'utf8')) as Record<string, Ratings>)
  : {};
const picks = replayCorpus().flatMap((item) =>
  replayChats.map((chat) => pickFor(item, chat, rated[item.id] ?? null)),
);
const tally = new Map<string, number>();
for (const pick of picks) {
  const name = `${pick.chat} → ${pick.model}`;
  tally.set(name, (tally.get(name) ?? 0) + 1);
}
console.log(`${picks.length} routes over ${picks.length / replayChats.length} requests`);
for (const [name, count] of [...tally].sort()) console.log(`  ${name}: ${count}`);
if (values.baseline) {
  compare(JSON.parse(await readFile(values.baseline, 'utf8')) as Pick[], picks);
}
if (values.out) await writeFile(values.out, `${JSON.stringify(picks, null, 2)}\n`);
