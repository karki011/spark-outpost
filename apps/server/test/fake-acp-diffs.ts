import type * as acp from '@agentclientprotocol/sdk/unstable';

type Update = (value: acp.SessionUpdate) => Promise<void>;
type Say = (chunk: string) => Promise<void>;

export const DIFF_SECRET_VALUE = 'hunter2-plain-secret-value';
export const BIG_LINES = 9000;
export const DIFF_API_KEY = 'sk-proj-abcdefghijklmnopqrstuvwx';

const edit = (
  toolCallId: string,
  path: string,
  oldText: string | null,
  newText: string,
): acp.SessionUpdate => ({
  sessionUpdate: 'tool_call',
  toolCallId,
  title: `Edit ${path}`,
  kind: 'edit',
  status: 'completed',
  locations: [{ path }],
  rawInput: { file_path: path },
  content: [{ type: 'diff', path, oldText, newText }],
});

export async function diffsTurn(update: Update, say: Say): Promise<acp.StopReason> {
  await update(
    edit('d1', '/work/app/src/notes.ts', 'one\ntwo\n', `one\n2\nthree\nkey=${DIFF_API_KEY}\n`),
  );
  await update(edit('d2', '/work/app/.env', 'TOKEN=old\n', `TOKEN=${DIFF_SECRET_VALUE}\n`));
  const big = Array.from({ length: BIG_LINES }, (_, index) => `line ${index} of the big file`);
  await update(edit('d3', '/work/app/src/big.ts', null, `${big.join('\n')}\n`));
  await say('Edited three files.');
  return 'end_turn';
}
