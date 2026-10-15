import { describe, expect, it } from 'vitest';
import { createCommandTracker } from '../agents/acp/command-output.ts';
import { createRailWatch } from '../agents/acp/rail-watch.ts';
import { createTurnMapper } from '../agents/acp/subagent-updates.ts';
import { toolCallEnded, toolCallStarted, type RecordedTool } from './chat-record-updates.ts';

const ROOT = '/work/project';

function replay(tool: RecordedTool, output: string) {
  const mapper = createTurnMapper('Claude Code', false);
  const commands = createCommandTracker(false);
  return [toolCallStarted(tool, ROOT), toolCallEnded(tool, output, false)].flatMap((update) => [
    ...mapper.map(update),
    ...commands.see(update),
  ]);
}

describe('a Terminal tool call as a chat would have seen it', () => {
  it('turns a Bash call into a command with its real text and output', () => {
    const outputs = replay(
      { id: 'toolu_1', name: 'Bash', input: { command: 'npm test', description: 'Run tests' } },
      'all passed',
    );
    expect(outputs).toContainEqual(
      expect.objectContaining({ kind: 'command_started', id: 'toolu_1', command: 'npm test' }),
    );
    expect(outputs).toContainEqual(
      expect.objectContaining({ kind: 'command_finished', failed: false }),
    );
  });

  it('names the edited file in the step', () => {
    const outputs = replay(
      {
        id: 'toolu_2',
        name: 'Edit',
        input: { file_path: `${ROOT}/src/app.ts`, old_string: 'a', new_string: 'b' },
      },
      'ok',
    );
    const started = outputs.find((output) => output.kind === 'step_started');
    expect(JSON.stringify(started)).toContain('app.ts');
  });

  it('reports a read of a secret file by its path, and an unasked push as a crossing', async () => {
    const watch = createRailWatch({ roots: [{ path: ROOT, ignore: [] }], cwd: ROOT });
    const read = { id: 'toolu_3', name: 'Read', input: { file_path: `${ROOT}/.env` } };
    await watch.observe(toolCallStarted(read, ROOT));
    const seen = await watch.observe(toolCallEnded(read, 'TOKEN=x', false));
    expect(seen.secretReads).toEqual(['.env']);
    const push = {
      id: 'toolu_4',
      name: 'Bash',
      input: { command: 'git push --force origin main' },
    };
    await watch.observe(toolCallStarted(push, ROOT));
    const pushed = await watch.observe(toolCallEnded(push, 'done', false));
    expect(pushed.rails.map((rail) => rail.rail)).toContain('force_push');
  });

  it('raises no crossing for a call that Claude asked about first', async () => {
    const watch = createRailWatch({ roots: [{ path: ROOT, ignore: [] }], cwd: ROOT });
    const push = {
      id: 'toolu_5',
      name: 'Bash',
      input: { command: 'git push --force origin main' },
    };
    await watch.observe(toolCallStarted(push, ROOT));
    watch.asked(push.id);
    const pushed = await watch.observe(toolCallEnded(push, 'done', false));
    expect(pushed.rails).toEqual([]);
  });
});
