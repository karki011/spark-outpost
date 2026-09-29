import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as acp from '@agentclientprotocol/sdk';
import { write, type RoleTurn } from './fake-acp-roles.ts';

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

function pieceJson(piece: FakePiece, cyclic: boolean) {
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

async function coordinator(turn: RoleTurn): Promise<acp.StopReason> {
  const cyclic =
    turn.text.includes('#alwaysbad') || (turn.text.includes('#badpieces') && !repairing(turn.text));
  const block = {
    pieces: PIECES.map((piece) => pieceJson(piece, cyclic)),
    integration: turn.text.includes('#glue') ? 'Wire the view into glue.ts' : null,
  };
  await turn.say(`Here is the split.\n\n\`\`\`pieces\n${JSON.stringify(block, null, 2)}\n\`\`\``);
  return 'end_turn';
}

function untilStopped(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) resolve();
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

async function askToRun(turn: RoleTurn, command: string): Promise<void> {
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
  })) as acp.RequestPermissionResponse;
  const allowed = answer.outcome.outcome === 'selected' && answer.outcome.optionId === 'yes';
  await turn.update({
    sessionUpdate: 'tool_call_update',
    toolCallId: toolCall.toolCallId,
    status: allowed ? 'completed' : 'failed',
  });
}

async function strayWrites(turn: RoleTurn, key: string): Promise<void> {
  const tag = (name: string, piece: string) => turn.text.includes(name) && key === piece;
  if (tag('#gitstash', 'P1')) await askToRun(turn, 'git stash');
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

async function piece(turn: RoleTurn): Promise<acp.StopReason> {
  const key = pieceKey(turn.text)!;
  const file = ownedFile(turn.text);
  const fixing = turn.text.includes("The project's checks failed");
  const breaks = turn.text.includes('#piecefix') && key === 'P2';
  const handoff =
    turn.text.includes('#handoff') && key === 'P1' && !turn.text.includes('## Handoff');
  if (turn.text.includes('#slowpiece') && key === 'P2') await untilStopped(turn.signal);
  await strayWrites(turn, key);
  await write(turn, file, fixing ? 'fixed' : `built by ${key}`);
  if (!fixing && (breaks || handoff)) await write(turn, file, 'broken');
  if (handoff) {
    await turn.update({ sessionUpdate: 'usage_update', used: 160_000, size: 200_000 });
  }
  await turn.say(`Built ${key} in ${file}${fixing ? ' and fixed the check' : ''}.`);
  return 'end_turn';
}

async function integrator(turn: RoleTurn): Promise<acp.StopReason> {
  await write(turn, 'glue.ts', 'export const glued = true;');
  await turn.say('Wired the pieces together in glue.ts.');
  return 'end_turn';
}

export function coordinatorRoleFor(
  text: string,
): ((turn: RoleTurn) => Promise<acp.StopReason>) | null {
  if (text.includes('Role: Coordinator.')) return coordinator;
  if (pieceKey(text)) return piece;
  if (text.includes('Role: Integrator.')) return integrator;
  return null;
}
