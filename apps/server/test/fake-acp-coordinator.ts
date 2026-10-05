import { existsSync } from 'node:fs';
import { appendFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as acp from '@agentclientprotocol/sdk';
import { conflictTurn, parallelBlock, pieceExtras } from './fake-acp-parallel.ts';
import { codexLimited, rateLimited } from './fake-acp-limits.ts';
import { FAKE_PLAN_OPTIONS } from './fake-acp-plans.ts';
import { PLAN_FIRST_ASK, write, type RoleTurn } from './fake-acp-roles.ts';

export const PIECE_CHECK_SCRIPT = `import { readFileSync } from 'node:fs';
const file = process.argv[2];
const lines = readFileSync(file, 'utf8').trim().split('\\n');
if (lines.at(-1) === 'broken') {
  console.error(file + ' is broken');
  process.exit(1);
}
console.log(file + ' is fine');
`;

interface FakePiece {
  key: string;
  title: string;
  file: string;
  dependsOn: string[];
}

const PIECES: FakePiece[] = [
  { key: 'P1', title: 'Store', file: 'store.ts', dependsOn: [] },
  { key: 'P2', title: 'API', file: 'api.ts', dependsOn: ['P1'] },
  { key: 'P3', title: 'View', file: 'view.ts', dependsOn: ['P2'] },
];

const DOCS_PIECE: FakePiece = { key: 'P3', title: 'View', file: 'README.md', dependsOn: ['P2'] };

function pieceJson(piece: FakePiece, cyclic: boolean, docs: boolean): Record<string, unknown> {
  if (docs && piece.key === DOCS_PIECE.key) {
    return {
      ...pieceJson(DOCS_PIECE, cyclic, false),
      checks: [`grep -q ${DOCS_PIECE.key} ${DOCS_PIECE.file}`],
    };
  }
  return {
    key: piece.key,
    title: piece.title,
    goal: `Build the ${piece.title.toLowerCase()}`,
    owns: [piece.file],
    reads: piece.dependsOn.map((key) => PIECES.find((other) => other.key === key)!.file),
    dependsOn: cyclic && piece.key === 'P1' ? ['P3'] : piece.dependsOn,
    contract: `${piece.title.toLowerCase()}(): string`,
    acceptance: [`${piece.file} exists`],
    checks: [`${process.execPath} piece-check.mjs ${piece.file}`],
    size: 'S',
  };
}

function repairing(text: string): boolean {
  return text.includes('## Problems with your last pieces block');
}

async function proposeInPlanMode(turn: RoleTurn, plan: string): Promise<void> {
  const toolCall = {
    toolCallId: 'coordinator-plan',
    title: 'Approve Plan',
    kind: 'switch_mode' as const,
    status: 'pending' as const,
    rawInput: { plan },
  };
  await turn.update({ sessionUpdate: 'tool_call', ...toolCall });
  await turn.client.request(acp.methods.client.session.requestPermission, {
    sessionId: turn.sessionId,
    toolCall,
    options: FAKE_PLAN_OPTIONS,
  });
  await turn.say('No response requested.');
}

async function coordinator(turn: RoleTurn): Promise<acp.StopReason> {
  const cyclic =
    turn.text.includes('#alwaysbad') || (turn.text.includes('#badpieces') && !repairing(turn.text));
  const block = parallelBlock(turn.text) ?? {
    pieces: PIECES.map((piece) => pieceJson(piece, cyclic, turn.text.includes('#docspiece'))),
    integration: turn.text.includes('#glue') ? 'Wire the view into glue.ts' : null,
  };
  const split = `Here is the split.\n\n\`\`\`pieces\n${JSON.stringify(block, null, 2)}\n\`\`\``;
  if (turn.text.includes('#planfile') && !repairing(turn.text)) {
    await proposeInPlanMode(turn, split);
    return 'end_turn';
  }
  await turn.say(split);
  return 'end_turn';
}

function untilStopped(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) resolve();
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

async function askToRun(turn: RoleTurn, command: string, reason?: string): Promise<boolean> {
  const toolCall = {
    toolCallId: `run-${command.replace(/\W+/g, '-')}`,
    title: command,
    kind: 'execute' as const,
    status: 'pending' as const,
    rawInput: { command },
  };
  await turn.update({ sessionUpdate: 'tool_call', ...toolCall });
  const answer = (await turn.client.request(acp.methods.client.session.requestPermission, {
    sessionId: turn.sessionId,
    toolCall,
    options: [
      { optionId: 'yes', name: 'Yes', kind: 'allow_once' },
      { optionId: 'no', name: 'No', kind: 'reject_once' },
    ],
    ...(reason ? { _meta: { permission: { description: `Reason: ${reason}` } } } : {}),
  })) as acp.RequestPermissionResponse;
  const allowed = answer.outcome.outcome === 'selected' && answer.outcome.optionId === 'yes';
  await turn.update({
    sessionUpdate: 'tool_call_update',
    toolCallId: toolCall.toolCallId,
    status: allowed ? 'completed' : 'failed',
  });
  return allowed;
}

export const TARGETED_CHECK = 'cd . && npx vitest run store.test.ts 2>&1 | tail -20';

const UNREADABLE_LINE = "export const trim = (s: string) => s.replace(/^-|-$/g, '');";

async function build(turn: RoleTurn, file: string, line: string): Promise<void> {
  if (!turn.text.includes('#heredoc')) {
    await write(turn, file, line);
    return;
  }
  const body = `${line}\nexport const ok = (n: number) => n >= 2;\n${UNREADABLE_LINE}`;
  const command = `cat >> ${file} <<'EOF'\n${body}\nEOF`;
  if (await askToRun(turn, command)) await appendFile(join(turn.cwd, file), `${line}\n`);
}

async function strayWrites(turn: RoleTurn, key: string): Promise<void> {
  const tag = (name: string, piece: string) => turn.text.includes(name) && key === piece;
  if (tag('#gitstash', 'P1')) await askToRun(turn, 'git stash');
  if (tag('#addpkg', 'P1')) await askToRun(turn, 'pnpm add left-pad');
  if (tag('#targeted', 'P1'))
    await askToRun(turn, TARGETED_CHECK, 'This command requires approval');
  if (tag('#allnx', 'P1')) await askToRun(turn, 'npx nx run-many --target=test');
  if (tag('#strayedit', 'P2')) await write(turn, 'view.ts', 'edited by P2');
  if (tag('#shellwrite', 'P2')) await writeFile(join(turn.cwd, 'view.ts'), 'shell write by P2\n');
  if (tag('#shellstray', 'P2')) await writeFile(join(turn.cwd, 'stray.ts'), 'shell stray\n');
}

function pieceKey(text: string): string | null {
  return /## Your piece: (\w+)/.exec(text)?.[1] ?? null;
}

function ownedFile(text: string): string {
  const owned = /own these files[^\n]*\n- (\S+)/.exec(text)?.[1];
  return owned ?? 'unknown.ts';
}

const steers: string[] = [];
const steerWaiters = new Set<() => void>();

export const steerParams = (params: unknown) =>
  params as { prompt: { type: string; text?: string }[] };

export function steerRequest(ctx: { params: ReturnType<typeof steerParams> }) {
  steers.push(ctx.params.prompt.map((block) => block.text ?? '').join(''));
  for (const wake of steerWaiters) wake();
  return { outcome: 'injected' };
}

function mainRoot(cwd: string): string {
  return cwd.split('/.spark/worktrees/')[0]!;
}

async function holdUntilReleased(turn: RoleTurn): Promise<string | null> {
  const marker = join(mainRoot(turn.cwd), '.git', 'release-P2');
  while (!existsSync(marker) && steers.length === 0 && !turn.signal.aborted) {
    await new Promise<void>((resolve) => {
      const wake = () => resolve();
      steerWaiters.add(wake);
      setTimeout(() => {
        steerWaiters.delete(wake);
        resolve();
      }, 50);
    });
  }
  return steers.shift() ?? null;
}

function changesNothing(turn: RoleTurn, key: string): boolean {
  if (key !== 'P1') return false;
  if (turn.text.includes('#nochangeever')) return true;
  return turn.text.includes('#nochange') && !turn.text.includes('changed none of your files');
}

async function heldTurn(turn: RoleTurn, key: string, file: string): Promise<boolean> {
  const noted = turn.text.includes('## Note from the coordinator');
  if (turn.text.includes('#editslow') && key === 'P2') {
    await write(turn, file, `started by ${key}`);
    await untilStopped(turn.signal);
    return true;
  }
  if (!turn.text.includes('#holdpiece') || key !== 'P2' || noted) return false;
  await write(turn, file, `started by ${key}`);
  const steer = await holdUntilReleased(turn);
  if (steer) await write(turn, file, 'steered');
  return false;
}

async function piece(turn: RoleTurn): Promise<acp.StopReason> {
  const key = pieceKey(turn.text)!;
  const file = ownedFile(turn.text);
  const fixing = turn.text.includes("The project's checks failed");
  const breaks = turn.text.includes('#piecefix') && key === 'P2';
  const handoff =
    turn.text.includes('#handoff') && key === 'P1' && !turn.text.includes('## Handoff');
  if (rateLimited(turn, key, /#ratelimit(?!after)/))
    throw new acp.RequestError(429, 'Too Many Requests');
  if (await codexLimited(turn, key, file)) return 'end_turn';
  if (changesNothing(turn, key)) {
    await turn.say(`The write to ${file} was refused, so I changed nothing.`);
    return 'end_turn';
  }
  if (turn.text.includes('#slowpiece') && key === 'P2') await untilStopped(turn.signal);
  await pieceExtras(turn, key);
  if (await heldTurn(turn, key, file)) return 'end_turn';
  await strayWrites(turn, key);
  await build(turn, file, fixing ? 'fixed' : `built by ${key}`);
  if (rateLimited(turn, key, /#ratelimitafter/)) {
    throw new acp.RequestError(429, 'Too Many Requests');
  }
  if (turn.text.includes('## Note from the coordinator')) await write(turn, file, 'noted');
  if (existsSync(join(turn.cwd, 'main-change.txt'))) await write(turn, file, 'saw main');
  if (!fixing && (breaks || handoff)) await write(turn, file, 'broken');
  if (handoff) {
    await turn.update({ sessionUpdate: 'usage_update', used: 160_000, size: 200_000 });
  }
  await turn.say(`Built ${key} in ${file}${fixing ? ' and fixed the check' : ''}.`);
  return 'end_turn';
}

async function integrator(turn: RoleTurn): Promise<acp.StopReason> {
  const settled = await conflictTurn(turn);
  if (settled) return settled;
  await write(turn, 'glue.ts', 'export const glued = true;');
  await turn.say('Wired the pieces together in glue.ts.');
  return 'end_turn';
}

export const FAKE_PIECES_PLAN = PIECES.map(
  (piece, index) => `${index + 1}. ${piece.title}: build it in \`${piece.file}\``,
).join('\n');

async function planner(turn: RoleTurn): Promise<acp.StopReason> {
  await turn.say(`# Plan\n\n${FAKE_PIECES_PLAN}`);
  return 'end_turn';
}

export function coordinatorRoleFor(
  text: string,
): ((turn: RoleTurn) => Promise<acp.StopReason>) | null {
  if (text.includes(PLAN_FIRST_ASK) && text.includes('#pieces')) return planner;
  if (text.includes('Role: Coordinator.')) return coordinator;
  if (pieceKey(text)) return piece;
  if (text.includes('Role: Integrator.')) return integrator;
  return null;
}
