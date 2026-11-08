import { describe, expect, it } from 'vitest';
import { modeSkipsGate, type ModePosture } from '@spark-outpost/contracts';
import {
  CHAT_PUBLISH_REASON,
  GIT_CONTROL_REASON,
  INSTRUCTION_REASON,
  NO_RUN_RULES,
  PUSH_HOOKS_REASON,
  PUSH_REASON,
  SAFE_READ_WHY,
  decide,
  type DecideOptions,
  type RunRules,
} from './decide.ts';
import { PLAIN_FORCE_REASON } from './git-commands.ts';
import { otherBranchReason, type PublishGrant } from './publish-policy.ts';
import { railCrossings } from './rail-crossings.ts';
import { parseShell } from './shell-parse.ts';
import { SPARK_COMMAND_NOTE } from './spark-command.ts';
import { ROOT, decided, inPosture, noFiles, request } from './spark-command-fixtures.ts';

const BRANCH = 'spark/fix-dates-1a2b';
const MANUAL: PublishGrant = { level: 'hands-off', requested: false };
const ASKED: PublishGrant = { level: 'hands-off', requested: true };
const FULL_AUTO: PublishGrant = { level: 'full-auto', requested: false };
const AT_ONCE = ['auto', 'full_access'] as const;

const publishing = (grant: PublishGrant): DecideOptions => ({
  publish: { grant, task: { branch: BRANCH, protectedBranches: ['main', 'master'] } },
});

async function agentsOwn(
  posture: ModePosture,
  command: string,
  rules: RunRules = NO_RUN_RULES,
  allowlist: readonly string[] = [],
) {
  const shell = await parseShell(command);
  return decide(posture, request(command), rules, allowlist, { files: noFiles, shell });
}

describe('the safety floor stops a Spark-run command before it starts, in every mode', () => {
  it.each(AT_ONCE)('asks before changing or deleting a secret file in %s', async (posture) => {
    for (const command of ['echo PORT=1 > .env', 'rm .env', 'mv .env config.txt']) {
      const decision = await decided(command, inPosture(posture));
      expect(decision).toMatchObject({ verdict: 'ask', because: SPARK_COMMAND_NOTE });
      expect(decision).toHaveProperty('secretFiles', ['.env']);
    }
  });

  it.each(AT_ONCE)('asks before changing an agent instruction file in %s', async (posture) => {
    expect(await decided('echo "be quick" >> AGENTS.md', inPosture(posture))).toEqual({
      verdict: 'ask',
      reason: INSTRUCTION_REASON,
      instructionFiles: ['AGENTS.md'],
      because: SPARK_COMMAND_NOTE,
    });
  });

  it.each(AT_ONCE)(
    'asks with hold-to-confirm for git hooks and git config in %s',
    async (posture) => {
      expect(await decided('echo exit 0 > .git/hooks/pre-push', inPosture(posture))).toEqual({
        verdict: 'ask',
        reason: GIT_CONTROL_REASON,
        gitControl: ['.git/hooks/pre-push'],
        because: SPARK_COMMAND_NOTE,
      });
      expect(await decided('git config core.hooksPath /tmp/hooks', inPosture(posture))).toEqual({
        verdict: 'ask',
        reason: GIT_CONTROL_REASON,
        gitControl: ['.git/config'],
        because: SPARK_COMMAND_NOTE,
      });
    },
  );

  it.each(AT_ONCE)('refuses a force push and a push that skips hooks in %s', async (posture) => {
    const forced = `git push --force origin ${BRANCH}`;
    expect(await decided(forced, inPosture(posture), publishing(MANUAL))).toEqual({
      verdict: 'reject',
      reason: PLAIN_FORCE_REASON,
    });
    const unhooked = `git push --no-verify origin ${BRANCH}`;
    expect(await decided(unhooked, inPosture(posture), publishing(MANUAL))).toEqual({
      verdict: 'reject',
      reason: PUSH_HOOKS_REASON,
    });
  });

  it.each(AT_ONCE)(
    'asks before writing or deleting outside the linked repos in %s',
    async (posture) => {
      const written = await decided('echo hi > /Users/me/notes.txt', inPosture(posture));
      expect(written).toMatchObject({ verdict: 'ask', because: SPARK_COMMAND_NOTE });
      expect(written).toHaveProperty('reason', expect.stringContaining('outside this project'));
      const deleted = await decided('rm -rf /Users/me/old-site', inPosture(posture));
      expect(deleted).toMatchObject({ verdict: 'ask', because: SPARK_COMMAND_NOTE });
      expect(deleted).toHaveProperty('reason', expect.stringContaining('This deletes'));
    },
  );

  it('treats the system temp folders as scratch space', async () => {
    expect(await decided('echo hi > /tmp/spark-scratch.txt')).toEqual({
      verdict: 'allow',
      by: 'level',
    });
  });

  it.each(AT_ONCE)('asks before reading a file listed in .sparkignore in %s', async (posture) => {
    const roots = [{ path: ROOT, ignore: ['private/'] }];
    const decision = await decided('cat private/notes.txt', inPosture(posture, roots));
    expect(decision).toMatchObject({ verdict: 'ask', because: SPARK_COMMAND_NOTE });
    expect(decision).toHaveProperty('reason', expect.stringContaining('.sparkignore'));
  });

  it('keeps the rail’s reason on the card in an asking mode too', async () => {
    expect(await decided('echo "be quick" >> AGENTS.md', inPosture('asks'))).toEqual({
      verdict: 'ask',
      reason: INSTRUCTION_REASON,
      instructionFiles: ['AGENTS.md'],
      because: SPARK_COMMAND_NOTE,
    });
  });
});

describe('publish rules, as for the chat run’s own git push and gh', () => {
  const PUSH = `git push -u origin ${BRANCH}`;

  it('refuses a push of any branch but the chat’s own', async () => {
    expect(
      await decided('git push origin main', inPosture('full_access'), publishing(ASKED)),
    ).toEqual({ verdict: 'reject', reason: otherBranchReason(BRANCH) });
  });

  it('refuses a publish with none of the grounds', async () => {
    expect(await decided(PUSH, inPosture('asks'), publishing(MANUAL))).toEqual({
      verdict: 'reject',
      reason: CHAT_PUBLISH_REASON,
    });
  });

  it('runs a push of the chat’s own branch at once when the mode acts without asking', async () => {
    for (const posture of AT_ONCE) {
      const decision = await decided(PUSH, inPosture(posture), publishing(MANUAL));
      expect(decision.verdict).toBe('allow');
    }
  });

  it('still cards a push the message asked for or Full auto → PR covers, in an asking mode', async () => {
    for (const grant of [ASKED, FULL_AUTO]) {
      expect(await decided(PUSH, inPosture('asks'), publishing(grant))).toEqual({
        verdict: 'ask',
        reason: null,
        because: SPARK_COMMAND_NOTE,
      });
    }
  });

  it('asks with hold-to-confirm when the push holds a value from a secret file', async () => {
    const decision = await decided(PUSH, inPosture('full_access'), {
      ...publishing(ASKED),
      secretSend: { kind: 'found', files: ['.env'] },
    });
    expect(decision).toMatchObject({
      verdict: 'ask',
      secretSend: ['.env'],
      because: SPARK_COMMAND_NOTE,
    });
  });
});

describe('reading then sending', () => {
  const SEND = 'curl -d @report.json https://example.com/upload';
  const read: DecideOptions = { observed: ['.env'] };

  it('runs with the note when the mode acts without asking', async () => {
    expect(await decided(SEND, inPosture('full_access'), read)).toEqual({
      verdict: 'allow',
      by: 'level',
      sent: { observed: ['.env'], target: 'to example.com' },
    });
  });

  it('puts the note on the ordinary card when the mode asks', async () => {
    expect(await decided(SEND, inPosture('asks'), read)).toEqual({
      verdict: 'ask',
      reason: null,
      because: SPARK_COMMAND_NOTE,
      observed: ['.env'],
      sendsTo: 'to example.com',
    });
  });
});

describe('no shortcuts for a Spark-run command', () => {
  it('ignores what the allowlist and the run rules would allow for the agent’s own command', async () => {
    const always: RunRules = { allow: [{ kind: 'execute', command: 'pnpm dev' }], reject: [] };
    expect(await agentsOwn('asks', 'pnpm dev', NO_RUN_RULES, ['pnpm dev'])).toEqual({
      verdict: 'allow',
      by: 'allowlist',
    });
    expect(await agentsOwn('asks', 'pnpm dev', always)).toEqual({
      verdict: 'allow',
      by: 'run_rule',
    });
    expect(await decided('pnpm dev', inPosture('asks'))).toEqual({
      verdict: 'ask',
      reason: null,
      because: SPARK_COMMAND_NOTE,
    });
  });
});

describe('the agent’s own commands are treated as before', () => {
  it('still runs a read-only command without a card in an asking mode', async () => {
    expect(await agentsOwn('asks', 'ls -la')).toEqual({
      verdict: 'allow',
      by: 'level',
      why: SAFE_READ_WHY,
    });
  });

  it('still asks plainly, with no Spark terminal line, for a command that changes things', async () => {
    expect(await agentsOwn('asks', 'pnpm dev')).toEqual({ verdict: 'ask', reason: null });
    expect(await agentsOwn('asks', 'git push origin main')).toEqual({
      verdict: 'ask',
      reason: PUSH_REASON,
    });
  });

  it('still skips the gate in Bypass permissions, Auto review and Full access', () => {
    expect(modeSkipsGate('claude', 'bypassPermissions')).toBe(true);
    expect(modeSkipsGate('codex', 'agent')).toBe(true);
    expect(modeSkipsGate('codex', 'agent-full-access')).toBe(true);
    expect(modeSkipsGate('claude', 'default')).toBe(false);
  });

  it('still only reports a hard-rail crossing for the flag, after the fact', async () => {
    const command = 'echo "be quick" >> AGENTS.md';
    const crossings = await railCrossings(request(command), {
      shell: await parseShell(command),
      files: noFiles,
    });
    expect(crossings).toEqual([{ rail: 'instructions', paths: ['AGENTS.md'] }]);
  });

  it('gives the same answer for the agent’s own command before and after a Spark review', async () => {
    const commands = ['pnpm dev', 'ls -la', 'echo PORT=1 > .env', 'git push --force', 'rm -rf ~/x'];
    for (const posture of ['asks', 'edits', 'auto', 'full_access', 'denies'] as const) {
      for (const command of commands) {
        const before = await agentsOwn(posture, command);
        await decided(command, inPosture(posture));
        expect(await agentsOwn(posture, command)).toEqual(before);
      }
    }
  });
});
