import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type * as acp from '@agentclientprotocol/sdk';

interface RailTurn {
  text: string;
  cwd: string;
  update(value: acp.SessionUpdate): Promise<void>;
}

export const OUTSIDE_FILE = '/spark-outside-test/notes.txt';

export async function railCrossings(turn: RailTurn): Promise<void> {
  if (turn.text.includes('#outsidewrite')) {
    await turn.update({
      sessionUpdate: 'tool_call',
      toolCallId: 'rail-outside',
      title: `Write ${OUTSIDE_FILE}`,
      kind: 'edit',
      status: 'in_progress',
      locations: [{ path: OUTSIDE_FILE }],
      content: [{ type: 'diff', path: OUTSIDE_FILE, oldText: 'old notes', newText: 'new notes' }],
    });
    await turn.update({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'rail-outside',
      status: 'completed',
    });
  }
  if (turn.text.includes('#agentsedit')) {
    await writeFile(join(turn.cwd, 'AGENTS.md'), '# Changed by the agent\n');
  }
}
